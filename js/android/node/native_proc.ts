/**
 * Executor de processos do child_process emulado, ligado à classe Java NativeProc (window.BBNativeProc).
 * Roda o ffmpeg do "FFmpeg Plugin" do PojavLauncher; qualquer outro comando (ou ffmpeg ausente) devolve null,
 * o que mantém o ENOENT padrão e deixa o próprio plugin (ex.: Scene Recorder) mostrar a tela de definir o ffmpeg.
 */
import { t } from '../i18n';
import { Buffer } from 'buffer/';
import { EventEmitter, ProcessRunner } from './misc';

export interface NativeProcApi {
	findFfmpeg(): string;
	outputDir(unused: string): string;
	start(json: string): string;
	write(id: string, b64: string): string;
	pending(id: string): string;
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
				host.toast(t('FFmpeg do Pojav não encontrado. Instale o "FFmpeg Plugin" do PojavLauncher; se preferir, defina o ffmpeg na tela do plugin.'));
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
			setTimeout(() => {
				const er = Object.assign(e, { syscall: 'spawn ' + cmd, path: cmd });
				if (child.listenerCount('error')) child.emit('error', er); else host.toast(t('FFmpeg não iniciou: ') + er.message, 6000);
				child.stdout?.end(); child.stderr?.end(); child.emit('close', -2, null);
			}, 0);
			return child;
		}
		const id = String(started.id);
		child.pid = started.id;

		// Erros de escrita nunca podem derrubar o Blockbench: sem ouvinte, o EventEmitter do Node lançaria uma exceção.
		const reportError = (e: any) => {
			const stdin = child.stdin;
			if (stdin && stdin.listenerCount('error')) stdin.emit('error', e);
			else if (child.listenerCount('error')) child.emit('error', e);
			else console.warn('[ffmpeg stdin]', e && e.message);
		};

		if (wantsPipe(stdio, 0)) {
			// Fila no lado JS com contrapressão: os quadros da gravação chegam bem mais rápido do que o ffmpeg consome.
			// Mandar tudo de uma vez enche a memória do app (e o app fecha). Aqui só enviamos mais quando o lado nativo esvazia.
			const MAX_CHUNK = 256 * 1024, NATIVE_HIGH = 6 * 1024 * 1024, JS_HIGH = 48 * 1024 * 1024, JS_LOW = 12 * 1024 * 1024;
			type Item = { data: Uint8Array; off: number; cb?: () => void };
			const q: Item[] = [];
			let queued = 0, ending = false, closed = false, broken = false, needDrain = false, pumping = false;
			const stdin: any = new EventEmitter();
			stdin.writable = true;
			const pumpLoop = () => {
				if (pumping) return;
				pumping = true;
				const tick = () => {
					if (closed) { pumping = false; return; }
					let sent = 0;
					try {
						while (q.length && !broken) {
							const pend = parseInt(unwrap(api.pending(id)), 10) || 0;
							if (pend >= NATIVE_HIGH) break;
							const it = q[0];
							const end = Math.min(it.data.length, it.off + MAX_CHUNK);
							unwrap(api.write(id, toB64(it.data.subarray(it.off, end))));
							queued -= end - it.off; sent += end - it.off;
							it.off = end;
							if (it.off >= it.data.length) { q.shift(); if (it.cb) setTimeout(it.cb, 0); }
							if (sent >= 2 * 1024 * 1024) break;   // devolve o controle à interface
						}
					} catch (e: any) {
						broken = true;
						q.length = 0; queued = 0;
						reportError(e);
					}
					if (needDrain && queued <= JS_LOW) { needDrain = false; stdin.emit('drain'); }
					if (!q.length || broken) {
						pumping = false;
						if (ending && !closed) { closed = true; try { unwrap(api.closeStdin(id)); } catch { /* já encerrou */ } stdin.emit('finish'); }
						return;
					}
					setTimeout(tick, 8);
				};
				setTimeout(tick, 0);
			};
			stdin.write = (chunk: any, enc?: any, cb?: any) => {
				const done = typeof enc === 'function' ? enc : cb;
				if (closed || ending) { if (done) setTimeout(() => done(new Error('write after end')), 0); return false; }
				const buf: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8') : chunk;
				q.push({ data: buf, off: 0, cb: done });
				queued += buf.length;
				pumpLoop();
				if (queued > JS_HIGH) { needDrain = true; return false; }
				return true;
			};
			stdin.end = (chunk?: any, enc?: any, cb?: any) => {
				if (chunk && typeof chunk !== 'function') stdin.write(chunk, enc);
				const done = [chunk, enc, cb].find(x => typeof x === 'function');
				if (done) stdin.once('finish', done);
				if (ending) return;
				ending = true; stdin.writable = false;
				if (!q.length && !pumping) { closed = true; try { unwrap(api.closeStdin(id)); } catch { /* já encerrou */ } setTimeout(() => stdin.emit('finish'), 0); }
				else pumpLoop();
			};
			stdin.destroy = () => { q.length = 0; queued = 0; stdin.end(); };
			stdin.cork = () => {}; stdin.uncork = () => {};
			child.stdin = stdin;
			child.__dropInput = () => { closed = true; q.length = 0; queued = 0; };
		} else {
			child.stdin = null;
			try { api.closeStdin(id); } catch { /* ok */ }
		}
		child.kill = () => { child.killed = true; child.__dropInput?.(); try { api.kill(id); } catch { /* ok */ } return true; };

		let errTail = '';
		const timer = setInterval(() => {
			let r: { o: string; e: string; x: number | null };
			try { r = JSON.parse(unwrap(api.poll(id))); } catch { clearInterval(timer); child.stdout?.end(); child.stderr?.end(); child.emit('close', -1, null); return; }
			if (r.o) child.stdout?.push(Buffer.from(r.o, 'base64'));
			if (r.e) {
				const eb = Buffer.from(r.e, 'base64');
				errTail = (errTail + eb.toString('utf8')).slice(-1500);
				child.stderr?.push(eb);
			}
			if (r.x !== null && r.x !== undefined) {
				clearInterval(timer);
				child.exitCode = r.x;
				child.stdout?.end(); child.stderr?.end();
				child.emit('exit', r.x, null);
				child.emit('close', r.x, null);
				child.__dropInput?.();
				if (r.x === 0) host.toast(t('FFmpeg concluiu. Se o arquivo foi gerado com nome simples, está em: {0}', started.cwd), 6000);
				else if (!child.killed) {
					const last = errTail.split(/\r?\n|\r/).map(x => x.trim()).filter(Boolean).slice(-2).join(' | ');
					host.toast(t('FFmpeg terminou com erro ({0}). {1}', r.x, last), 9000);
				}
			}
		}, 40);
		return child;
	};

	return { runner, info };
}
