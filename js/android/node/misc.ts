/** Módulos de Node (além de fs e path) que os plugins desktop usam, adaptados ao WebView do Android. */
import { Buffer } from 'buffer/';
import type { BufferEncoding } from './fs';
// @ts-ignore (pako 1.x não traz tipos)
import pako from 'pako';

const unsupported = (what: string) => {
	const e: any = new Error(`ENOSYS: ${what} não é suportado no Android`);
	e.code = 'ENOSYS'; e.errno = -38;
	return e;
};

// ------------------------------------------------------------------ events

export class EventEmitter {
	private _ev: Record<string, { fn: Function; once: boolean }[]> = {};
	on(name: string, fn: Function) { (this._ev[name] ||= []).push({ fn, once: false }); return this; }
	addListener(name: string, fn: Function) { return this.on(name, fn); }
	prependListener(name: string, fn: Function) { (this._ev[name] ||= []).unshift({ fn, once: false }); return this; }
	once(name: string, fn: Function) { (this._ev[name] ||= []).push({ fn, once: true }); return this; }
	off(name: string, fn: Function) { this._ev[name] = (this._ev[name] || []).filter(l => l.fn !== fn); return this; }
	removeListener(name: string, fn: Function) { return this.off(name, fn); }
	removeAllListeners(name?: string) { if (name) delete this._ev[name]; else this._ev = {}; return this; }
	emit(name: string, ...args: any[]) {
		const list = (this._ev[name] || []).slice();
		if (name === 'error' && !list.length) throw args[0] instanceof Error ? args[0] : new Error('Unhandled error: ' + String(args[0]));
		for (const l of list) { if (l.once) this.off(name, l.fn); l.fn.apply(this, args); }
		return list.length > 0;
	}
	listenerCount(name: string) { return (this._ev[name] || []).length; }
	listeners(name: string) { return (this._ev[name] || []).map(l => l.fn); }
	eventNames() { return Object.keys(this._ev); }
	setMaxListeners(_n: number) { return this; }
	getMaxListeners() { return 10; }
}

// ------------------------------------------------------------------ zlib (pako)

const toBuf = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
const zin = (d: any): Uint8Array => (typeof d === 'string' ? Buffer.from(d) : d instanceof ArrayBuffer ? new Uint8Array(d) : d);
const zerr = (e: any) => { const err: any = new Error(typeof e === 'string' ? e : (e && e.message) || 'zlib error'); err.code = 'Z_DATA_ERROR'; err.errno = -3; return err; };
const zrun = (fn: () => Uint8Array) => { try { return toBuf(fn()); } catch (e) { throw zerr(e); } };
const lv = (o: any) => (o && typeof o.level === 'number' && o.level >= 0 ? { level: o.level } : {});
const isGzip = (d: Uint8Array) => d.length > 2 && d[0] === 0x1f && d[1] === 0x8b;

export function createZlib() {
	const sync: Record<string, (d: any, o?: any) => Buffer> = {
		inflateSync: d => zrun(() => pako.inflate(zin(d))),
		inflateRawSync: d => zrun(() => pako.inflateRaw(zin(d))),
		deflateSync: (d, o) => zrun(() => pako.deflate(zin(d), lv(o))),
		deflateRawSync: (d, o) => zrun(() => pako.deflateRaw(zin(d), lv(o))),
		gzipSync: (d, o) => zrun(() => pako.gzip(zin(d), lv(o))),
		gunzipSync: d => zrun(() => pako.ungzip(zin(d))),
		unzipSync: d => { const u = zin(d); return zrun(() => (isGzip(u) ? pako.ungzip(u) : pako.inflate(u))); },
	};
	const z: Record<string, any> = { ...sync };
	for (const name of Object.keys(sync)) {
		const base = name.slice(0, -4);
		z[base] = (d: any, a?: any, b?: any) => {
			const cb = typeof a === 'function' ? a : b;
			const opts = typeof a === 'function' ? undefined : a;
			let res: Buffer | undefined, err: any = null;
			try { res = sync[name](d, opts); } catch (e) { err = e; }
			setTimeout(() => (err ? cb(err) : cb(null, res)), 0);
		};
	}
	z.constants = { Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_SYNC_FLUSH: 2, Z_FINISH: 4 };
	z.Z_NO_COMPRESSION = 0; z.Z_BEST_SPEED = 1; z.Z_BEST_COMPRESSION = 9; z.Z_DEFAULT_COMPRESSION = -1;
	for (const s of ['createGzip', 'createGunzip', 'createInflate', 'createDeflate', 'createInflateRaw', 'createDeflateRaw', 'brotliCompressSync', 'brotliDecompressSync']) z[s] = () => { throw unsupported('zlib.' + s); };
	return z;
}

// ------------------------------------------------------------------ crypto: md5 / sha1 / sha256 (síncronos)

function padMessage(data: Uint8Array, littleEndian: boolean): Uint8Array {
	const bitLenHi = Math.floor((data.length * 8) / 0x100000000), bitLenLo = (data.length * 8) >>> 0;
	const total = (((data.length + 8) >> 6) + 1) << 6;
	const out = new Uint8Array(total);
	out.set(data);
	out[data.length] = 0x80;
	const dv = new DataView(out.buffer);
	if (littleEndian) { dv.setUint32(total - 8, bitLenLo, true); dv.setUint32(total - 4, bitLenHi, true); }
	else { dv.setUint32(total - 8, bitLenHi, false); dv.setUint32(total - 4, bitLenLo, false); }
	return out;
}
const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

function sha1(data: Uint8Array): Uint8Array {
	let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
	const m = padMessage(data, false), dv = new DataView(m.buffer), w = new Int32Array(80);
	for (let off = 0; off < m.length; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
		for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
		let a = h0, b = h1, c = h2, d = h3, e = h4;
		for (let i = 0; i < 80; i++) {
			let f: number, k: number;
			if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
			else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
			else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
			else { f = b ^ c ^ d; k = 0xCA62C1D6; }
			const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
			e = d; d = c; c = rotl(b, 30); b = a; a = t;
		}
		h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
	}
	const out = new Uint8Array(20), o = new DataView(out.buffer);
	[h0, h1, h2, h3, h4].forEach((v, i) => o.setInt32(i * 4, v, false));
	return out;
}

const K256 = new Int32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function sha256(data: Uint8Array): Uint8Array {
	const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
	const m = padMessage(data, false), dv = new DataView(m.buffer), w = new Int32Array(64);
	for (let off = 0; off < m.length; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
		}
		let [a, b, c, d, e, f, g, h] = H;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const mj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + mj) | 0;
			h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
		}
		H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
	}
	const out = new Uint8Array(32), o = new DataView(out.buffer);
	for (let i = 0; i < 8; i++) o.setInt32(i * 4, H[i], false);
	return out;
}

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);
function md5(data: Uint8Array): Uint8Array {
	let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
	const m = padMessage(data, true), dv = new DataView(m.buffer);
	for (let off = 0; off < m.length; off += 64) {
		let A = a0, B = b0, C = c0, D = d0;
		for (let i = 0; i < 64; i++) {
			let F: number, g: number;
			if (i < 16) { F = (B & C) | (~B & D); g = i; }
			else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
			else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
			else { F = C ^ (B | ~D); g = (7 * i) % 16; }
			F = (F + A + MD5_K[i] + dv.getInt32(off + g * 4, true)) | 0;
			A = D; D = C; C = B;
			B = (B + rotl(F, MD5_S[(i >> 4) * 4 + (i % 4)])) | 0;
		}
		a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
	}
	const out = new Uint8Array(16), o = new DataView(out.buffer);
	[a0, b0, c0, d0].forEach((v, i) => o.setInt32(i * 4, v, true));
	return out;
}

const HASHES: Record<string, (d: Uint8Array) => Uint8Array> = { md5, sha1, sha256, 'sha-1': sha1, 'sha-256': sha256 };

class Hash {
	private chunks: Uint8Array[] = [];
	constructor(private algo: string) {}
	update(data: any, enc?: BufferEncoding) {
		this.chunks.push(typeof data === 'string' ? Buffer.from(data, enc || 'utf8') : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
		return this;
	}
	digest(enc?: BufferEncoding | 'buffer') {
		const total = this.chunks.reduce((n, c) => n + c.length, 0);
		const all = new Uint8Array(total);
		let o = 0;
		for (const c of this.chunks) { all.set(c, o); o += c.length; }
		const out = toBuf(HASHES[this.algo](all));
		return enc && enc !== 'buffer' ? out.toString(enc) : out;
	}
}

export function createCrypto() {
	const rnd = (n: number) => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536))); return Buffer.from(u.buffer); };
	return {
		createHash(algo: string) {
			const a = String(algo).toLowerCase();
			if (!HASHES[a]) throw new Error(`Digest method not supported: ${algo} (suportados: md5, sha1, sha256)`);
			return new Hash(a);
		},
		getHashes: () => ['md5', 'sha1', 'sha256'],
		randomBytes(n: number, cb?: Function) { const b = rnd(n); if (cb) { setTimeout(() => cb(null, b), 0); return undefined as any; } return b; },
		randomUUID: () => (crypto as any).randomUUID ? (crypto as any).randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ rnd(1)[0] & 15 >> Number(c) / 4).toString(16)),
		randomInt(a: number, b?: number) { const [min, max] = b === undefined ? [0, a] : [a, b]; return min + Math.floor((rnd(4).readUInt32LE(0) / 0x100000000) * (max - min)); },
		webcrypto: (typeof crypto !== 'undefined' ? crypto : undefined),
		createHmac() { throw unsupported('crypto.createHmac'); },
		createCipheriv() { throw unsupported('crypto.createCipheriv'); },
	};
}

// ------------------------------------------------------------------ os / process

export interface Roots { external: string; files: string; cache: string; release?: string; abi?: string; hasAll?: boolean }

export function createOs(roots: Roots) {
	return {
		EOL: '\n',
		platform: () => 'android', type: () => 'Linux', arch: () => (roots.abi || 'arm64').includes('64') ? 'arm64' : 'arm',
		release: () => roots.release || '', version: () => `Android ${roots.release || ''}`.trim(),
		homedir: () => roots.external, tmpdir: () => roots.cache, hostname: () => 'android', endianness: () => 'LE',
		userInfo: () => ({ username: 'android', uid: -1, gid: -1, shell: null, homedir: roots.external }),
		cpus: () => Array.from({ length: (navigator as any).hardwareConcurrency || 4 }, () => ({ model: 'ARM', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } })),
		totalmem: () => ((navigator as any).deviceMemory || 4) * 1024 ** 3, freemem: () => ((navigator as any).deviceMemory || 4) * 512 * 1024 ** 2,
		uptime: () => performance.now() / 1000, loadavg: () => [0, 0, 0], networkInterfaces: () => ({}), constants: {},
	};
}

export function createProcess(roots: Roots, cwd: () => string) {
	const ee: any = new EventEmitter();
	return Object.assign(ee, {
		platform: 'android', arch: (roots.abi || 'arm64').includes('64') ? 'arm64' : 'arm', pid: 1, ppid: 0, title: 'blockbench',
		version: 'v20.0.0', versions: { node: '20.0.0', blockbench: 'android' }, argv: [] as string[], execArgv: [] as string[], execPath: '',
		env: { HOME: roots.external, TMPDIR: roots.cache, USER: 'android', USERNAME: 'android', LANG: 'pt_BR.UTF-8' } as Record<string, string>,
		cwd, chdir() { throw unsupported('process.chdir'); }, exit(code?: number) { console.warn('process.exit(' + (code ?? 0) + ') ignorado no Android'); },
		nextTick(fn: Function, ...a: any[]) { queueMicrotask(() => fn(...a)); },
		hrtime: Object.assign((prev?: [number, number]) => { const t = performance.now(); const s = Math.floor(t / 1000), n = Math.floor((t % 1000) * 1e6); return prev ? [s - prev[0], n - prev[1]] : [s, n]; }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
		uptime: () => performance.now() / 1000, memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
		stdout: { write: (s: any) => { console.log(String(s).replace(/\n$/, '')); return true; }, isTTY: false, columns: 80 },
		stderr: { write: (s: any) => { console.error(String(s).replace(/\n$/, '')); return true; }, isTTY: false, columns: 80 },
		emitWarning: (w: any) => console.warn(w),
	});
}

// ------------------------------------------------------------------ child_process / net / https / tls

export type ProcessRunner = (cmd: string, args: string[], options: any) => any;
let runner: ProcessRunner | null = null;
/** Ponto de extensão: um executor nativo (ex.: ffmpeg do Pojav) pode ser plugado aqui. */
export function setProcessRunner(fn: ProcessRunner | null) { runner = fn; }

function notFoundChild(cmd: string) {
	const child: any = new EventEmitter();
	child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
	child.stdin = { write() { return false; }, end() {}, on() { return child.stdin; } };
	child.kill = () => false; child.pid = undefined;
	setTimeout(() => {
		const e: any = new Error(`spawn ${cmd} ENOENT`);
		e.code = 'ENOENT'; e.errno = -2; e.syscall = `spawn ${cmd}`; e.path = cmd;
		child.emit('error', e);
		child.emit('close', -2, null);
	}, 0);
	return child;
}
export function createChildProcess() {
	const run = (cmd: string, args: string[], options: any) => (runner ? runner(cmd, args, options) : notFoundChild(cmd));
	const execLike = (cmdline: string, args: any, options: any, cb?: Function) => {
		const callback = [args, options, cb].find(x => typeof x === 'function');
		const cmd = String(cmdline).split(/\s+/)[0];
		const child = runner ? runner(cmd, [], {}) : notFoundChild(cmd);
		if (callback) {
			let out = '', err = '';
			child.stdout?.on('data', (d: any) => { out += d; }); child.stderr?.on('data', (d: any) => { err += d; });
			child.on('error', (e: any) => callback(e, '', ''));
			child.on('close', (code: number) => { if (code !== -2) callback(code ? Object.assign(new Error('Command failed: ' + cmdline), { code }) : null, out, err); });
		}
		return child;
	};
	return {
		spawn: (cmd: string, args?: any, options?: any) => run(cmd, Array.isArray(args) ? args : [], (Array.isArray(args) ? options : args) || {}),
		exec: (cmd: string, a?: any, b?: any, c?: Function) => execLike(cmd, a, b, c),
		execFile: (cmd: string, a?: any, b?: any, c?: Function) => execLike(cmd, a, b, c),
		spawnSync: (cmd: string) => ({ pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null, error: Object.assign(new Error(`spawnSync ${cmd} ENOENT`), { code: 'ENOENT' }) }),
		execSync: (cmd: string) => { throw Object.assign(new Error(`Command failed: ${cmd} (processos externos não são suportados no Android)`), { code: 'ENOENT' }); },
		execFileSync: (cmd: string) => { throw Object.assign(new Error(`Command failed: ${cmd} (processos externos não são suportados no Android)`), { code: 'ENOENT' }); },
		fork: () => { throw unsupported('child_process.fork'); },
	};
}

export function createNet() {
	class Socket extends EventEmitter {
		connect(..._a: any[]) { setTimeout(() => this.emit('error', Object.assign(unsupported('sockets TCP/pipe (net)'), { code: 'ENOSYS' })), 0); return this; }
		write() { return false; } end() { return this; } destroy() { return this; } setEncoding() { return this; } setTimeout() { return this; } on(n: string, f: Function) { return super.on(n, f); }
	}
	return {
		Socket,
		connect: (..._a: any[]) => new Socket().connect(),
		createConnection: (..._a: any[]) => new Socket().connect(),
		createServer: () => { throw unsupported('net.createServer'); },
		isIP: (s: string) => (/^\d+\.\d+\.\d+\.\d+$/.test(s) ? 4 : s.includes(':') ? 6 : 0),
	};
}

export function createHttps() {
	const fail = () => { throw unsupported('https.request/get (use fetch)'); };
	return { request: fail, get: fail, createServer: fail, Agent: class {} };
}

// ------------------------------------------------------------------ util / url / timers / string_decoder / querystring

export function createUtil() {
	const inspect = (v: any, opts?: any): string => {
		if (typeof v === 'string') return v;
		try { return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Map ? Object.fromEntries(x) : x instanceof Set ? [...x] : x), opts?.compact === false ? 2 : undefined) ?? String(v); } catch { return String(v); }
	};
	const format = (f: any, ...args: any[]) => {
		if (typeof f !== 'string') return [f, ...args].map(a => inspect(a)).join(' ');
		let i = 0;
		let s = f.replace(/%[sdifjoO%]/g, m => {
			if (m === '%%') return '%';
			if (i >= args.length) return m;
			const a = args[i++];
			switch (m) { case '%s': return String(a); case '%d': return String(Number(a)); case '%i': return String(parseInt(a)); case '%f': return String(parseFloat(a)); default: return inspect(a); }
		});
		for (; i < args.length; i++) s += ' ' + inspect(args[i]);
		return s;
	};
	const promisify = (fn: Function) => (...args: any[]) => new Promise((resolve, reject) => fn(...args, (err: any, ...res: any[]) => (err ? reject(err) : resolve(res.length > 1 ? res : res[0]))));
	return {
		inspect, format, promisify, TextEncoder, TextDecoder,
		inherits(ctor: any, superCtor: any) { Object.setPrototypeOf(ctor.prototype, superCtor.prototype); },
		deprecate: (fn: Function) => fn,
		isDeepStrictEqual: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b),
		types: {
			isPromise: (v: any) => v instanceof Promise, isDate: (v: any) => v instanceof Date, isRegExp: (v: any) => v instanceof RegExp,
			isTypedArray: (v: any) => ArrayBuffer.isView(v) && !(v instanceof DataView), isUint8Array: (v: any) => v instanceof Uint8Array,
			isArrayBuffer: (v: any) => v instanceof ArrayBuffer, isMap: (v: any) => v instanceof Map, isSet: (v: any) => v instanceof Set,
		},
	};
}

export function fileURLToPath(u: any) {
	const url = typeof u === 'string' ? new URL(u) : u;
	if (url.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
	return decodeURIComponent(url.pathname);
}
export function pathToFileURL(p: string) { return new URL('file://' + encodeURI(p).replace(/[?#]/g, encodeURIComponent)); }

export function createUrl() {
	return {
		URL, URLSearchParams, fileURLToPath, pathToFileURL,
		parse(s: string) { try { const u = new URL(s, 'file:///'); return { protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, query: u.search.slice(1), hash: u.hash, href: u.href }; } catch { return { href: s, pathname: s }; } },
		format: (u: any) => (typeof u === 'string' ? u : u.href || String(u)),
	};
}

export function createTimers() {
	return { setTimeout: setTimeout.bind(globalThis), clearTimeout: clearTimeout.bind(globalThis), setInterval: setInterval.bind(globalThis), clearInterval: clearInterval.bind(globalThis), setImmediate: (fn: Function, ...a: any[]) => setTimeout(fn, 0, ...a), clearImmediate: (t: any) => clearTimeout(t) };
}

export function createStringDecoder() {
	return {
		StringDecoder: class {
			private d: TextDecoder;
			constructor(enc = 'utf8') { this.d = new TextDecoder(enc.replace('utf8', 'utf-8')); }
			write(b: any) { return this.d.decode(b, { stream: true }); }
			end(b?: any) { return b ? this.d.decode(b) : this.d.decode(); }
		},
	};
}

export function createQuerystring() {
	return {
		parse(s: string) { const o: Record<string, any> = {}; new URLSearchParams(s).forEach((v, k) => { o[k] = k in o ? [].concat(o[k], v as any) : v; }); return o; },
		stringify(o: Record<string, any>) { const p = new URLSearchParams(); for (const k of Object.keys(o || {})) for (const v of ([] as any[]).concat(o[k])) p.append(k, String(v)); return p.toString(); },
		escape: encodeURIComponent, unescape: decodeURIComponent,
	};
}

// ------------------------------------------------------------------ shell / clipboard (via host)

export interface ShellHost { toast(msg: string): void; openExternal(url: string): Promise<void>; }

export function createShell(host: ShellHost, rm: (p: string) => void) {
	return {
		openExternal: (url: string) => host.openExternal(String(url)),
		showItemInFolder: (p: string) => { host.toast('Arquivo: ' + p); },
		openPath: async (p: string) => { host.toast('Abra manualmente: ' + p); return ''; },
		trashItem: async (p: string) => { rm(p); },
		beep() {},
	};
}

export function createClipboard() {
	return {
		writeText: (t: string) => { navigator.clipboard?.writeText(String(t)).catch(() => {}); },
		readText: () => { console.warn('clipboard.readText é síncrono no desktop e indisponível no Android; devolvendo vazio'); return ''; },
		readImage: () => ({ isEmpty: () => true, toDataURL: () => '', toPNG: () => Buffer.alloc(0) }),
		writeImage() {},
	};
}

export { Buffer, unsupported };
