/**
 * `fs` do Node para o WebView do Android.
 * Fala com a classe Java NativeFs (exposta como `BBNativeFs`), que tem métodos SÍNCRONOS de strings:
 *   resposta = "O" + carga   (sucesso)   |   "E:CODIGO:mensagem"   (erro)
 * Os dados binários trafegam em base64.
 */
import { Buffer } from 'buffer';
import type { PathModule } from './path';

export type BufferEncoding = 'utf8' | 'utf-8' | 'hex' | 'base64' | 'base64url' | 'ascii' | 'latin1' | 'binary' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le';

export interface NativeFs {
	stat(path: string): string;                              // O{"t":"f"|"d","s":tamanho,"m":mtimeMs}
	readFile(path: string): string;                          // O<base64>
	writeFile(path: string, base64: string, append: string): string;   // "1" = anexar
	readdir(path: string): string;                           // O[["nome","f"|"d"],...]
	mkdir(path: string, recursive: string): string;          // "1" = recursivo
	rm(path: string, recursive: string): string;             // arquivo, pasta vazia, ou pasta inteira se recursivo
	rename(from: string, to: string): string;
	copyFile(from: string, to: string): string;
	realpath(path: string): string;                          // O<caminho>
	roots(): string;                                         // O{"external","files","cache","release","abi","hasAll"}
}

const ERRNO: Record<string, number> = { EPERM: -1, ENOENT: -2, EIO: -5, EACCES: -13, EEXIST: -17, ENOTDIR: -20, EISDIR: -21, EINVAL: -22, ENOSYS: -38, ENOTEMPTY: -39 };
const DESC: Record<string, string> = {
	EPERM: 'operation not permitted', ENOENT: 'no such file or directory', EIO: 'i/o error', EACCES: 'permission denied',
	EEXIST: 'file already exists', ENOTDIR: 'not a directory', EISDIR: 'illegal operation on a directory',
	EINVAL: 'invalid argument', ENOSYS: 'function not implemented', ENOTEMPTY: 'directory not empty',
};

export function fsError(code: string, syscall: string, path?: string, extra?: string) {
	const e: any = new Error(`${code}: ${DESC[code] || extra || 'error'}, ${syscall}${path !== undefined ? ` '${path}'` : ''}${code === 'ENOSYS' && extra ? ' — ' + extra : ''}`);
	e.errno = ERRNO[code] ?? -1;
	e.code = code;
	e.syscall = syscall;
	if (path !== undefined) e.path = path;
	return e;
}

export class Stats {
	dev = 0; ino = 0; mode: number; nlink = 1; uid = 0; gid = 0; rdev = 0; size: number; blksize = 4096; blocks: number;
	atimeMs: number; mtimeMs: number; ctimeMs: number; birthtimeMs: number;
	atime: Date; mtime: Date; ctime: Date; birthtime: Date;
	private _dir: boolean;
	constructor(isDir: boolean, size: number, mtimeMs: number) {
		this._dir = isDir;
		this.mode = isDir ? 0o40755 : 0o100644;
		this.size = isDir ? 4096 : size;
		this.blocks = Math.ceil(this.size / 512);
		this.atimeMs = this.mtimeMs = this.ctimeMs = this.birthtimeMs = mtimeMs;
		this.atime = new Date(mtimeMs); this.mtime = new Date(mtimeMs); this.ctime = new Date(mtimeMs); this.birthtime = new Date(mtimeMs);
	}
	isFile() { return !this._dir; }
	isDirectory() { return this._dir; }
	isSymbolicLink() { return false; }
	isFIFO() { return false; }
	isSocket() { return false; }
	isBlockDevice() { return false; }
	isCharacterDevice() { return false; }
}

export class Dirent {
	name: string; parentPath: string; path: string;
	private _dir: boolean;
	constructor(name: string, isDir: boolean, parent: string) { this.name = name; this._dir = isDir; this.parentPath = parent; this.path = parent; }
	isFile() { return !this._dir; }
	isDirectory() { return this._dir; }
	isSymbolicLink() { return false; }
	isFIFO() { return false; }
	isSocket() { return false; }
	isBlockDevice() { return false; }
	isCharacterDevice() { return false; }
}

type Enc = BufferEncoding | undefined;
const encOf = (o: any): Enc => (typeof o === 'string' ? (o as BufferEncoding) : o && o.encoding ? o.encoding : undefined);

export function createFs(native: NativeFs, path: PathModule) {
	const unit = (res: string, syscall: string, p?: string): string => {
		if (typeof res !== 'string' || !res) throw fsError('EIO', syscall, p, 'resposta vazia do módulo nativo');
		if (res[0] === 'O') return res.slice(1);
		const i1 = res.indexOf(':', 2);
		const code = res.slice(2, i1 < 0 ? undefined : i1);
		throw fsError(code || 'EIO', syscall, p, i1 < 0 ? '' : res.slice(i1 + 1));
	};

	const toPath = (p: any, name = 'path'): string => {
		if (typeof p === 'string') return path.resolve(p);
		if (p instanceof URL) {
			if (p.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
			return path.resolve(decodeURIComponent(p.pathname));
		}
		if (p && typeof p === 'object' && typeof (p as any).length === 'number' && (p as any).buffer) return path.resolve(Buffer.from(p as any).toString());
		throw new TypeError(`The "${name}" argument must be of type string or an instance of Buffer or URL. Received ${p === null ? 'null' : typeof p}`);
	};

	const toBuffer = (data: any, encoding?: BufferEncoding): Buffer => {
		if (typeof data === 'string') return Buffer.from(data, encoding || 'utf8');
		if (Buffer.isBuffer(data)) return data;
		if (data instanceof ArrayBuffer) return Buffer.from(data);
		if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		throw new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView.');
	};

	// ------------------------------------------------------------------ sync
	const statRaw = (p: string, syscall: string) => JSON.parse(unit(native.stat(p), syscall, p)) as { t: 'f' | 'd'; s: number; m: number };

	function statSync(p: any, options?: any) {
		const full = toPath(p);
		try {
			const r = statRaw(full, 'stat');
			return new Stats(r.t === 'd', r.s, r.m);
		} catch (e: any) {
			if (options && options.throwIfNoEntry === false && e.code === 'ENOENT') return undefined;
			if (e && e.path !== undefined) e.path = String(p);
			throw e;
		}
	}
	function existsSync(p: any): boolean {
		try { statRaw(toPath(p), 'stat'); return true; } catch { return false; }
	}
	function readFileSync(p: any, options?: any) {
		const full = toPath(p);
		const b64 = unit(native.readFile(full), 'open', full);
		const buf = Buffer.from(b64, 'base64');
		const enc = encOf(options);
		return enc && (enc as string) !== 'buffer' ? buf.toString(enc) : buf;
	}
	function writeFileSync(p: any, data: any, options?: any) {
		const full = toPath(p);
		const enc = encOf(options);
		const append = options && typeof options === 'object' && typeof options.flag === 'string' && options.flag[0] === 'a';
		unit(native.writeFile(full, toBuffer(data, enc).toString('base64'), append ? '1' : '0'), 'open', full);
	}
	function appendFileSync(p: any, data: any, options?: any) {
		const full = toPath(p);
		unit(native.writeFile(full, toBuffer(data, encOf(options)).toString('base64'), '1'), 'open', full);
	}
	function readdirSync(p: any, options?: any): any {
		const full = toPath(p);
		const withTypes = !!(options && typeof options === 'object' && options.withFileTypes);
		const recursive = !!(options && typeof options === 'object' && options.recursive);
		const list = (dir: string, rel: string, out: any[]) => {
			const entries = JSON.parse(unit(native.readdir(dir), 'scandir', dir)) as [string, 'f' | 'd'][];
			entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
			for (const [name, t] of entries) {
				const relName = rel ? rel + '/' + name : name;
				out.push(withTypes ? new Dirent(name, t === 'd', rel ? path.join(full, rel) : full) : relName);
				if (recursive && t === 'd') list(dir + '/' + name, relName, out);
			}
		};
		const out: any[] = [];
		list(full, '', out);
		return out;
	}
	function mkdirSync(p: any, options?: any) {
		const full = toPath(p);
		const recursive = !!(options && typeof options === 'object' && options.recursive);
		if (!recursive) { unit(native.mkdir(full, '0'), 'mkdir', full); return undefined; }
		// devolve o primeiro diretório criado (como o Node)
		let first: string | undefined;
		let cur = full;
		const missing: string[] = [];
		while (true) {
			try {
				const r = statRaw(cur, 'stat');
				if (r.t !== 'd') throw fsError('ENOTDIR', 'mkdir', full);
				break;
			} catch (e: any) {
				if (e.code !== 'ENOENT') throw e;
				missing.push(cur);
				const up = path.dirname(cur);
				if (up === cur) break;
				cur = up;
			}
		}
		if (missing.length) first = missing[missing.length - 1];
		unit(native.mkdir(full, '1'), 'mkdir', full);
		return first;
	}
	function rmSync(p: any, options?: any) {
		const full = toPath(p);
		const recursive = !!(options && options.recursive), force = !!(options && options.force);
		let st: { t: 'f' | 'd' } | null = null;
		try { st = statRaw(full, 'rm'); } catch (e: any) { if (e.code === 'ENOENT' && force) return; throw e; }
		if (st && st.t === 'd' && !recursive) { const e: any = fsError('EISDIR', 'rm', full); e.code = 'ERR_FS_EISDIR'; e.message = `Path is a directory: rm returned EISDIR (is a directory) ${full}`; throw e; }
		unit(native.rm(full, recursive ? '1' : '0'), 'rm', full);
	}
	function rmdirSync(p: any, options?: any) {
		const full = toPath(p);
		const st = statRaw(full, 'rmdir');
		if (st.t !== 'd') throw fsError('ENOTDIR', 'rmdir', full);
		unit(native.rm(full, options && options.recursive ? '1' : '0'), 'rmdir', full);
	}
	function unlinkSync(p: any) {
		const full = toPath(p);
		const st = statRaw(full, 'unlink');
		if (st.t === 'd') throw fsError('EISDIR', 'unlink', full);
		unit(native.rm(full, '0'), 'unlink', full);
	}
	function renameSync(a: any, b: any) {
		const from = toPath(a, 'oldPath'), to = toPath(b, 'newPath');
		unit(native.rename(from, to), 'rename', from);
	}
	function copyFileSync(a: any, b: any, mode?: number) {
		const from = toPath(a, 'src'), to = toPath(b, 'dest');
		if (mode && (mode & 1) && existsSync(to)) throw fsError('EEXIST', 'copyfile', from);
		unit(native.copyFile(from, to), 'copyfile', from);
	}
	function accessSync(p: any, _mode?: number) { statRaw(toPath(p), 'access'); }
	function realpathSync(p: any) {
		const full = toPath(p);
		return unit(native.realpath(full), 'realpath', full);
	}
	function mkdtempSync(prefix: string) {
		for (let i = 0; i < 20; i++) {
			const name = prefix + Math.random().toString(36).slice(2, 8).padEnd(6, '0');
			if (!existsSync(name)) { mkdirSync(name, { recursive: true }); return name; }
		}
		throw fsError('EEXIST', 'mkdtemp', prefix);
	}
	function truncateSync(p: any, len = 0) {
		const buf = readFileSync(p) as Buffer;
		writeFileSync(p, len >= buf.length ? Buffer.concat([buf, Buffer.alloc(len - buf.length)]) : buf.subarray(0, len));
	}

	const sync: Record<string, (...a: any[]) => any> = {
		statSync, lstatSync: statSync, existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync,
		rmSync, rmdirSync, unlinkSync, renameSync, copyFileSync, accessSync, realpathSync, mkdtempSync, truncateSync,
		chmodSync() {}, chownSync() {}, utimesSync() {}, fsyncSync() {},
	};

	// ------------------------------------------------------------------ callbacks e promises derivados
	const out: Record<string, any> = { ...sync };
	const promises: Record<string, any> = {};
	for (const name of Object.keys(sync)) {
		if (name === 'existsSync') continue;
		const base = name.slice(0, -4);
		const fn = sync[name];
		out[base] = (...args: any[]) => {
			const cb = args.pop();
			if (typeof cb !== 'function') throw new TypeError('The "cb" argument must be of type function.');
			let res: any, err: any = null;
			try { res = fn(...args); } catch (e) { err = e; }
			setTimeout(() => (err ? cb(err) : cb(null, res)), 0);
		};
		promises[base] = async (...args: any[]) => fn(...args);
	}
	out.exists = (p: any, cb: (e: boolean) => void) => { const r = existsSync(p); setTimeout(() => cb(r), 0); };
	promises.constants = undefined;
	delete promises.constants;
	out.promises = promises;

	// ------------------------------------------------------------------ watchFile / watch (por polling)
	const watchers = new Map<string, Map<Function, any>>();
	const snapshot = (p: string) => { const s = statSync(p, { throwIfNoEntry: false }); return s || new Stats(false, 0, 0); };
	out.watchFile = (p: any, a?: any, b?: any) => {
		const listener = typeof a === 'function' ? a : b;
		const interval = (a && typeof a === 'object' && a.interval) || 5007;
		const full = toPath(p);
		let prev: any = snapshot(full);
		const t = setInterval(() => {
			const cur: any = snapshot(full);
			if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) { const old = prev; prev = cur; try { listener(cur, old); } catch (e) { console.error(e); } }
		}, interval);
		if (!watchers.has(full)) watchers.set(full, new Map());
		watchers.get(full)!.set(listener, t);
	};
	out.unwatchFile = (p: any, listener?: Function) => {
		const full = toPath(p);
		const m = watchers.get(full);
		if (!m) return;
		for (const [fn, t] of Array.from(m.entries())) if (!listener || fn === listener) { clearInterval(t); m.delete(fn); }
		if (!m.size) watchers.delete(full);
	};
	out.watch = (p: any, a?: any, b?: any) => {
		const listener = typeof a === 'function' ? a : b;
		const full = toPath(p);
		let prev: any = snapshot(full);
		const handlers: Function[] = listener ? [listener] : [];
		const t = setInterval(() => {
			const cur: any = snapshot(full);
			if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) { prev = cur; handlers.forEach(h => h('change', path.basename(full))); }
		}, 1000);
		return { close() { clearInterval(t); }, on(ev: string, fn: Function) { if (ev === 'change') handlers.push(fn); return this; }, ref() { return this; }, unref() { return this; } };
	};

	out.constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1, COPYFILE_FICLONE: 2, O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2 };
	out.F_OK = 0; out.R_OK = 4; out.W_OK = 2; out.X_OK = 1;
	out.Stats = Stats; out.Dirent = Dirent;
	for (const unsupported of ['createReadStream', 'createWriteStream', 'openSync', 'open', 'readSync', 'writeSync', 'closeSync', 'fstatSync', 'symlinkSync', 'readlinkSync', 'linkSync']) {
		out[unsupported] = () => { throw fsError('ENOSYS', unsupported, undefined, 'não suportado no Android'); };
	}
	return out;
}

export type NodeFs = ReturnType<typeof createFs>;

/** fs restrito a uma pasta (equivalente ao createScopedFS do Blockbench desktop). */
export function createScopedFs(fs: NodeFs, path: PathModule, scope: string) {
	const base = path.resolve(scope);
	const inside = (p: any) => {
		if (typeof p !== 'string' && !(p instanceof URL) && !(p && (p as any).buffer)) return true; // deixa o fs reclamar do tipo
		const r = path.resolve(p instanceof URL ? decodeURIComponent(p.pathname) : String(p));
		return r === base || base === '/' || r.startsWith(base + '/');
	};
	const guard = (fn: Function, pathArgs: number[]) => (...args: any[]) => {
		for (const i of pathArgs) {
			if (i < args.length && args[i] !== undefined && typeof args[i] !== 'function' && !inside(args[i])) {
				throw `Trying to access path "${path.resolve(String(args[i]))}" outside of scoped file system "${base}"`;
			}
		}
		return fn(...args);
	};
	const TWO = new Set(['renameSync', 'rename', 'copyFileSync', 'copyFile']);
	const wrap = (src: Record<string, any>, asPromise = false) => {
		const o: Record<string, any> = {};
		for (const key of Object.keys(src)) {
			const v = src[key];
			if (typeof v === 'function' && key !== 'Stats' && key !== 'Dirent') {
				const g = guard(v, TWO.has(key) ? [0, 1] : [0]);
				// na API de promises o erro de escopo vira rejeição (não exceção síncrona)
				o[key] = asPromise ? (...a: any[]) => { try { return g(...a); } catch (e) { return Promise.reject(e); } } : g;
			} else if (key === 'promises') o.promises = wrap(v, true);
			else o[key] = v;
		}
		return o;
	};
	const scoped = wrap(fs);
	scoped.scope = base;
	return scoped;
}
