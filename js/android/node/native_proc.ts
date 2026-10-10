/**
 * Executor de processos do child_process emulado, ligado à classe Java NativeProc (window.BBNativeProc).
 * Roda o ffmpeg do "FFmpeg Plugin" do PojavLauncher; qualquer outro comando (ou ffmpeg ausente) devolve null,
 * o que mantém o ENOENT padrão e deixa o próprio plugin (ex.: Scene Recorder) mostrar a tela de definir o ffmpeg.
 */
import { Buffer } from 'buffer/';
import { EventEmitter, ProcessRunner } from './misc';

export interface NativeProcApi {
	findFfmpeg(): string;
	outputDir(unused: string): string;
	start(json: string): string;
	write(id: string, b64: string): string;
	closeStdin(id: string): string;
	poll(id: string): string;
	kill(id: string): string;
}
export interface FfmpegInfo { found: boolean; path?: string; libraryPath?: string; package?: string; version?: string }
export interface RunnerHost { toast(msg: string, ms?: number): void }

const unwrap = (res: string): string => {
	if (typeof res === 'string' && res[0] === 'O') return res.slice(1);
	const i = typeof res === 'string' ? res.indexOf(':', 2) : -1;
	const e: any = new Error(i < 0 ? 'falha no executor nativo' : res.slice(i + 1));
	e.code = i < 0 ? 'EIO' : res.slice(2, i);
	throw e;
};

const toB64 = (u: Uint8Array) => { let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000) as any); return btoa(bin); };

/** Fluxo legível (stdout/stderr): eventos 'data'/'end' e iteração assíncrona (for await), como o do Node. */
class PipeStream extends EventEmitter {
	private queue: any[] = [];
	private waiters: ((r: IteratorResult<any>) => void)[] = [];
	private ended = false;
	private enc: string | undefined;
	private size = 0;
	readable = true;
	setEncoding(e: string) { this.enc = e; return this; }
	push(chunk: Buffer) {
		const data = this.enc ? chunk.toString(this.enc as any) : chunk;
		const w = this.waiters.shift();
		if (w) w({ value: data, done: false });
		else {
			this.queue.push(data);
			this.size += chunk.length;
			while (this.size > (1 << 20) && this.queue.length > 1) { const d = this.queue.shift(); this.size -= d.length; }   // ninguém lê: guarda só o final
		}
		this.emit('data', data);
	}
	end() {
		if (this.ended) return;
		this.ended = true;
		this.readable = false;
		for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
		this.emit('end');
		this.emit('close');
	}
	[Symbol.asyncIterator]() {
		return {
			next: (): Promise<IteratorResult<any>> => {
				if (this.queue.length) { const v = this.queue.shift(); this.size -= v.length; return Promise.resolve({ value: v, done: false }); }
				if (this.ended) return Promise.resolve({ value: undefined, done: true });
				return new Promise(res => this.waiters.push(res));
			},
			return: async () => ({ value: undefined, done: true }),
		};
	}
	resume() { return this; }
	pause() { return this; }
	pipe() { throw new Error('pipe() não é suportado'); }
}

const wantsPipe = (stdio: any, index: number): boolean => {
	if (stdio === undefined || stdio === null) return true;
	const v = typeof stdio === 'string' ? stdio : stdio[index];
	return v === undefined || v === 'pipe' || v === 'overlapped';
};

export function createNativeRunner(api: NativeProcApi | undefined, host: RunnerHost) {
	let warned = false;
	const info = (): FfmpegInfo => {
		try { return api ? JSON.parse(unwrap(api.findFfmpeg())) : { found: false }; } catch { return { found: false }; }
	};
	const isFfmpeg = (cmd: string) => /(^|\/)(ffmpeg|ffmpeg\.exe|libffmpeg\.so)$/i.test(String(cmd));

	const runner: ProcessRunner = (cmd, args, options) => {
		if (!api || !isFfmpeg(cmd)) return null;
		if (!info().found) {
			if (!warned) {
				warned = true;
				host.toast('FFmpeg do Pojav não encontrado. Instale o "FFmpeg Plugin" do PojavLauncher; se preferir, defina o ffmpeg na tela do plugin.');
			}
			return null;                       // o plugin segue para a tela dele de definir o ffmpeg
		}
		const stdio = options && options.stdio;
		const child: any = new EventEmitter();
		child.stdout = wantsPipe(stdio, 1) ? new PipeStream() : null;
		child.stderr = wantsPipe(stdio, 2) ? new PipeStream() : null;
		child.pid = undefined;
		child.killed = false;
		child.exitCode = null;

		let started: { id: number; cwd: string };
		try {
			started = JSON.parse(unwrap(api.start(JSON.stringify({ cmd, args: (args || []).map(String), cwd: options && options.cwd ? String(options.cwd) : '' }))));
		} catch (e: any) {
			setTimeout(() => { child.emit('error', Object.assign(e, { syscall: 'spawn ' + cmd, path: cmd })); child.stdout?.end(); child.stderr?.end(); child.emit('close', -2, null); }, 0);
			return child;
		}
		const id = String(started.id);
		child.pid = started.id;

		if (wantsPipe(stdio, 0)) {
			const stdin: any = new EventEmitter();
			stdin.writable = true;
			stdin.write = (chunk: any, enc?: any, cb?: any) => {
				const buf: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8') : chunk;
				try { unwrap(api.write(id, toB64(buf))); } catch (e) { child.emit('error', e); }
				const done = typeof enc === 'function' ? enc : cb;
				if (done) setTimeout(done, 0);
				return true;
			};
			stdin.end = (chunk?: any, enc?: any, cb?: any) => {
				if (chunk && typeof chunk !== 'function') stdin.write(chunk, enc);
				try { unwrap(api.closeStdin(id)); } catch { /* já encerrou */ }
				stdin.writable = false;
				const done = [chunk, enc, cb].find(x => typeof x === 'function');
				if (done) setTimeout(done, 0);
				stdin.emit('finish');
			};
			stdin.destroy = () => stdin.end();
			child.stdin = stdin;
		} else {
			child.stdin = null;
			try { api.closeStdin(id); } catch { /* ok */ }
		}
		child.kill = () => { child.killed = true; try { api.kill(id); } catch { /* ok */ } return true; };

		const timer = setInterval(() => {
			let r: { o: string; e: string; x: number | null };
			try { r = JSON.parse(unwrap(api.poll(id))); } catch { clearInterval(timer); child.stdout?.end(); child.stderr?.end(); child.emit('close', -1, null); return; }
			if (r.o) child.stdout?.push(Buffer.from(r.o, 'base64'));
			if (r.e) child.stderr?.push(Buffer.from(r.e, 'base64'));
			if (r.x !== null && r.x !== undefined) {
				clearInterval(timer);
				child.exitCode = r.x;
				child.stdout?.end(); child.stderr?.end();
				child.emit('exit', r.x, null);
				child.emit('close', r.x, null);
				if (r.x === 0) host.toast('FFmpeg concluiu. Os arquivos gerados ficam em: ' + started.cwd, 6000);
			}
		}, 40);
		return child;
	};

	return { runner, info };
}
