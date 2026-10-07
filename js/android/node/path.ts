/** `path` do Node (POSIX) para o WebView. Mesma semântica de path.posix; o cwd padrão é configurável. */

function normalizeString(path: string, allowAboveRoot: boolean): string {
	let res = '';
	let lastSegmentLength = 0;
	let lastSlash = -1;
	let dots = 0;
	let code = 0;
	for (let i = 0; i <= path.length; ++i) {
		if (i < path.length) code = path.charCodeAt(i);
		else if (code === 47) break;
		else code = 47;
		if (code === 47) {
			if (lastSlash === i - 1 || dots === 1) {
				// nada
			} else if (dots === 2) {
				if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
					if (res.length > 2) {
						const lastSlashIndex = res.lastIndexOf('/');
						if (lastSlashIndex === -1) { res = ''; lastSegmentLength = 0; }
						else { res = res.slice(0, lastSlashIndex); lastSegmentLength = res.length - 1 - res.lastIndexOf('/'); }
						lastSlash = i; dots = 0;
						continue;
					} else if (res.length !== 0) {
						res = ''; lastSegmentLength = 0; lastSlash = i; dots = 0;
						continue;
					}
				}
				if (allowAboveRoot) { res += res.length > 0 ? '/..' : '..'; lastSegmentLength = 2; }
			} else {
				if (res.length > 0) res += '/' + path.slice(lastSlash + 1, i);
				else res = path.slice(lastSlash + 1, i);
				lastSegmentLength = i - lastSlash - 1;
			}
			lastSlash = i; dots = 0;
		} else if (code === 46 && dots !== -1) {
			++dots;
		} else {
			dots = -1;
		}
	}
	return res;
}

function check(path: any, name = 'path') {
	if (typeof path !== 'string') throw new TypeError(`The "${name}" argument must be of type string. Received ${path === null ? 'null' : typeof path}`);
}

export interface PathModule {
	sep: string; delimiter: string;
	resolve(...paths: string[]): string;
	normalize(path: string): string;
	isAbsolute(path: string): boolean;
	join(...paths: string[]): string;
	relative(from: string, to: string): string;
	dirname(path: string): string;
	basename(path: string, suffix?: string): string;
	extname(path: string): string;
	format(obj: { dir?: string; root?: string; base?: string; name?: string; ext?: string }): string;
	parse(path: string): { root: string; dir: string; base: string; ext: string; name: string };
	toNamespacedPath(path: string): string;
	posix: PathModule;
	setCwd(dir: string): void;
}

export function createPath(initialCwd = '/'): PathModule {
	let cwd = initialCwd;
	const p: PathModule = {
		sep: '/',
		delimiter: ':',
		setCwd(dir: string) { cwd = dir; },
		resolve(...args: string[]) {
			let resolvedPath = '';
			let resolvedAbsolute = false;
			for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
				const path = i >= 0 ? args[i] : cwd;
				check(path, `paths[${i}]`);
				if (path.length === 0) continue;
				resolvedPath = `${path}/${resolvedPath}`;
				resolvedAbsolute = path.charCodeAt(0) === 47;
			}
			resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute);
			if (resolvedAbsolute) return `/${resolvedPath}`;
			return resolvedPath.length > 0 ? resolvedPath : '.';
		},
		normalize(path: string) {
			check(path);
			if (path.length === 0) return '.';
			const isAbs = path.charCodeAt(0) === 47;
			const trailing = path.charCodeAt(path.length - 1) === 47;
			path = normalizeString(path, !isAbs);
			if (path.length === 0) {
				if (isAbs) return '/';
				return trailing ? './' : '.';
			}
			if (trailing) path += '/';
			return isAbs ? `/${path}` : path;
		},
		isAbsolute(path: string) { check(path); return path.length > 0 && path.charCodeAt(0) === 47; },
		join(...args: string[]) {
			if (args.length === 0) return '.';
			let joined: string | undefined;
			for (let i = 0; i < args.length; ++i) {
				const arg = args[i];
				check(arg, 'path');
				if (arg.length > 0) joined = joined === undefined ? arg : `${joined}/${arg}`;
			}
			if (joined === undefined) return '.';
			return p.normalize(joined);
		},
		relative(from: string, to: string) {
			check(from, 'from'); check(to, 'to');
			if (from === to) return '';
			from = p.resolve(from);
			to = p.resolve(to);
			if (from === to) return '';
			const fromStart = 1;
			const fromEnd = from.length;
			const fromLen = fromEnd - fromStart;
			const toStart = 1;
			const toLen = to.length - toStart;
			const length = fromLen < toLen ? fromLen : toLen;
			let lastCommonSep = -1;
			let i = 0;
			for (; i < length; i++) {
				const fromCode = from.charCodeAt(fromStart + i);
				if (fromCode !== to.charCodeAt(toStart + i)) break;
				else if (fromCode === 47) lastCommonSep = i;
			}
			if (i === length) {
				if (toLen > length) {
					if (to.charCodeAt(toStart + i) === 47) return to.slice(toStart + i + 1);
					if (i === 0) return to.slice(toStart + i);
				} else if (fromLen > length) {
					if (from.charCodeAt(fromStart + i) === 47) lastCommonSep = i;
					else if (i === 0) lastCommonSep = 0;
				}
			}
			let out = '';
			for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
				if (i === fromEnd || from.charCodeAt(i) === 47) out += out.length === 0 ? '..' : '/..';
			}
			return `${out}${to.slice(toStart + lastCommonSep)}`;
		},
		toNamespacedPath(path: string) { return path; },
		dirname(path: string) {
			check(path);
			if (path.length === 0) return '.';
			const hasRoot = path.charCodeAt(0) === 47;
			let end = -1;
			let matchedSlash = true;
			for (let i = path.length - 1; i >= 1; --i) {
				if (path.charCodeAt(i) === 47) {
					if (!matchedSlash) { end = i; break; }
				} else matchedSlash = false;
			}
			if (end === -1) return hasRoot ? '/' : '.';
			if (hasRoot && end === 1) return '//';
			return path.slice(0, end);
		},
		basename(path: string, suffix?: string) {
			if (suffix !== undefined) check(suffix, 'suffix');
			check(path);
			let start = 0;
			let end = -1;
			let matchedSlash = true;
			if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
				if (suffix === path) return '';
				let extIdx = suffix.length - 1;
				let firstNonSlashEnd = -1;
				for (let i = path.length - 1; i >= 0; --i) {
					const code = path.charCodeAt(i);
					if (code === 47) {
						if (!matchedSlash) { start = i + 1; break; }
					} else {
						if (firstNonSlashEnd === -1) { matchedSlash = false; firstNonSlashEnd = i + 1; }
						if (extIdx >= 0) {
							if (code === suffix.charCodeAt(extIdx)) {
								if (--extIdx === -1) end = i;
							} else { extIdx = -1; end = firstNonSlashEnd; }
						}
					}
				}
				if (start === end) end = firstNonSlashEnd;
				else if (end === -1) end = path.length;
				return path.slice(start, end);
			}
			for (let i = path.length - 1; i >= 0; --i) {
				if (path.charCodeAt(i) === 47) {
					if (!matchedSlash) { start = i + 1; break; }
				} else if (end === -1) { matchedSlash = false; end = i + 1; }
			}
			if (end === -1) return '';
			return path.slice(start, end);
		},
		extname(path: string) {
			check(path);
			let startDot = -1;
			let startPart = 0;
			let end = -1;
			let matchedSlash = true;
			let preDotState = 0;
			for (let i = path.length - 1; i >= 0; --i) {
				const code = path.charCodeAt(i);
				if (code === 47) {
					if (!matchedSlash) { startPart = i + 1; break; }
					continue;
				}
				if (end === -1) { matchedSlash = false; end = i + 1; }
				if (code === 46) {
					if (startDot === -1) startDot = i;
					else if (preDotState !== 1) preDotState = 1;
				} else if (startDot !== -1) preDotState = -1;
			}
			if (startDot === -1 || end === -1 || preDotState === 0 ||
				(preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return '';
			return path.slice(startDot, end);
		},
		format(obj) {
			if (obj === null || typeof obj !== 'object') throw new TypeError('The "pathObject" argument must be of type object');
			const dir = obj.dir || obj.root;
			const base = obj.base || `${obj.name || ''}${obj.ext || ''}`;
			if (!dir) return base;
			return dir === obj.root ? `${dir}${base}` : `${dir}/${base}`;
		},
		parse(path: string) {
			check(path);
			const ret = { root: '', dir: '', base: '', ext: '', name: '' };
			if (path.length === 0) return ret;
			const isAbsolute = path.charCodeAt(0) === 47;
			let start: number;
			if (isAbsolute) { ret.root = '/'; start = 1; } else start = 0;
			let startDot = -1;
			let startPart = 0;
			let end = -1;
			let matchedSlash = true;
			let i = path.length - 1;
			let preDotState = 0;
			for (; i >= start; --i) {
				const code = path.charCodeAt(i);
				if (code === 47) {
					if (!matchedSlash) { startPart = i + 1; break; }
					continue;
				}
				if (end === -1) { matchedSlash = false; end = i + 1; }
				if (code === 46) {
					if (startDot === -1) startDot = i;
					else if (preDotState !== 1) preDotState = 1;
				} else if (startDot !== -1) preDotState = -1;
			}
			if (end !== -1) {
				const start2 = startPart === 0 && isAbsolute ? 1 : startPart;
				if (startDot === -1 || preDotState === 0 ||
					(preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
					ret.base = ret.name = path.slice(start2, end);
				} else {
					ret.name = path.slice(start2, startDot);
					ret.base = path.slice(start2, end);
					ret.ext = path.slice(startDot, end);
				}
			}
			if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
			else if (isAbsolute) ret.dir = '/';
			return ret;
		},
		posix: null as any,
	};
	p.posix = p;
	return p;
}
