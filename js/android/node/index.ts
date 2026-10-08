/**
 * Camada de compatibilidade com Node para plugins "desktop" no Android.
 * Espelha getPluginScopedRequire() do Blockbench desktop: módulos seguros saem direto, os demais pedem
 * permissão por plugin (guardada), e `fs` aceita `scope` (pasta) como no desktop.
 */
import { Buffer } from 'buffer/';
import { createPath, PathModule } from './path';
import { createFs, createScopedFs, NativeFs, NodeFs } from './fs';
import * as M from './misc';

export interface CompatHost extends M.ShellHost {
	/** Pergunta sim/não de forma SÍNCRONA (window.confirm), porque require() é síncrono. */
	confirm(message: string): boolean;
}
export interface PluginRef { id: string; name?: string; title?: string }
export interface RequireOptions { scope?: string; message?: string; optional?: boolean; show_permission_dialog?: boolean }

const SAFE_APIS = ['path', 'crypto', 'events', 'zlib', 'timers', 'url', 'string_decoder', 'querystring', 'constants', 'buffer', 'perf_hooks'];
const REQUESTABLE_APIS = ['fs', 'process', 'child_process', 'https', 'net', 'tls', 'util', 'os', 'v8', 'dialog', 'clipboard', 'shell'];
const DESCRIPTIONS: Record<string, string> = {
	fs: 'acessar os arquivos do aparelho', process: 'acessar informações do processo', child_process: 'executar programas externos',
	https: 'fazer requisições de rede', net: 'abrir conexões de rede', tls: 'abrir conexões de rede seguras', util: 'usar utilitários do sistema',
	os: 'ler informações do sistema operacional', v8: 'acessar o motor V8', dialog: 'abrir diálogos do sistema',
	clipboard: 'acessar a área de transferência', shell: 'abrir links e arquivos no sistema',
};
const PERMS_KEY = 'bb_android_plugin_perms';

type Perms = Record<string, { allowed: Record<string, true | { directories: string[] }> }>;
const loadPerms = (): Perms => { try { return JSON.parse(localStorage.getItem(PERMS_KEY) || '{}') || {}; } catch { return {}; } };
const savePerms = (p: Perms) => { try { localStorage.setItem(PERMS_KEY, JSON.stringify(p)); } catch { /* cheio */ } };

/** Quando o módulo nativo (BBNativeFs) não existe: tudo que toca arquivos falha com mensagem clara. */
const missingNative = (): NativeFs => {
	const fail = () => 'E:ENOSYS:acesso nativo a arquivos indisponível (reinstale o APK mais recente)';
	return { stat: fail, readFile: fail, writeFile: fail, readdir: fail, mkdir: fail, rm: fail, rename: fail, copyFile: fail, realpath: fail, roots: () => 'O' + JSON.stringify({ external: '/storage/emulated/0', files: '/data', cache: '/data', hasAll: false }) };
};

export function createNodeCompat(nativeIn: NativeFs | undefined, host: CompatHost) {
	const native = nativeIn || missingNative();
	const readRoots = (): M.Roots => {
		try { const r = native.roots(); if (r[0] === 'O') return JSON.parse(r.slice(1)); } catch { /* usa o padrão */ }
		return { external: '/storage/emulated/0', files: '/data', cache: '/data' };
	};
	let roots = readRoots();
	const path: PathModule = createPath(roots.external);
	const fs: NodeFs = createFs(native, path);

	// instâncias preguiçosas
	const cache: Record<string, any> = {};
	const make: Record<string, () => any> = {
		path: () => path, buffer: () => ({ Buffer }), crypto: () => M.createCrypto(), events: () => Object.assign(M.EventEmitter, { EventEmitter: M.EventEmitter }),
		zlib: () => M.createZlib(), timers: () => M.createTimers(), url: () => M.createUrl(), string_decoder: () => M.createStringDecoder(),
		querystring: () => M.createQuerystring(), constants: () => ({}), perf_hooks: () => ({ performance }),
		process: () => M.createProcess(roots, () => path.resolve('.')), child_process: () => M.createChildProcess(), https: () => M.createHttps(),
		net: () => M.createNet(), tls: () => M.createNet(), util: () => M.createUtil(), os: () => M.createOs(roots), clipboard: () => M.createClipboard(),
		shell: () => M.createShell(host, p => fs.rmSync(p, { recursive: true, force: true })),
		v8: () => { throw M.unsupported('v8'); },
		dialog: () => {
			const no = (n: string) => () => { throw M.unsupported('dialog.' + n); };
			return { showMessageBoxSync: (o: any) => (host.confirm(`${o?.message || ''}\n${o?.detail || ''}`) ? 0 : (o?.cancelId ?? 1)), showMessageBox: async (o: any) => ({ response: host.confirm(`${o?.message || ''}\n${o?.detail || ''}`) ? 0 : (o?.cancelId ?? 1) }), showOpenDialogSync: no('showOpenDialogSync'), showSaveDialogSync: no('showSaveDialogSync'), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) };
		},
	};
	const get = (name: string) => (cache[name] ||= make[name]());

	function ensurePermission(plugin: PluginRef, name: string, options: RequireOptions): boolean {
		const perms = loadPerms();
		const entry = perms[plugin.id]?.allowed?.[name];
		if (entry === true) return true;
		if (name === 'fs' && options.scope && entry && typeof entry === 'object') {
			if (entry.directories.some(d => options.scope!.startsWith(d))) return true;
		}
		if (options.show_permission_dialog === false) return false;

		roots = readRoots();
		const label = plugin.name || plugin.title || plugin.id;
		let what = DESCRIPTIONS[name] || `usar o módulo "${name}"`;
		let extra = '';
		if (name === 'fs' && options.scope) { what = 'acessar uma pasta'; extra = `\nPasta: ${options.scope.replace(/\n/g, '')}`; }
		if (name === 'fs' && !roots.hasAll) extra += '\n\nObs.: o app ainda não tem "acesso a todos os arquivos". Ative em Configurações Persistentes > Plugins desktop.';
		const text = `O plugin "${label}" (${plugin.id}) quer permissão para ${what}.${extra}${options.optional === false ? '\n\nEssa permissão é necessária para o plugin funcionar.' : ''}${options.message ? `\n\n"${options.message}"` : ''}\n\nOK = permitir sempre para este plugin\nCancelar = negar`;
		const allowed = host.confirm(text);
		if (!allowed) { console.warn(`Acesso a "${name}" negado ao plugin ${plugin.id}`); return false; }
		const p = loadPerms();
		p[plugin.id] ||= { allowed: {} };
		if (name === 'fs' && options.scope) {
			const cur = p[plugin.id].allowed.fs;
			const dirs = cur && typeof cur === 'object' ? cur.directories : [];
			dirs.push(options.scope);
			p[plugin.id].allowed.fs = { directories: dirs };
		} else p[plugin.id].allowed[name] = true;
		savePerms(p);
		return true;
	}

	function requireFor(plugin: PluginRef) {
		return function require(moduleId: string, options: RequireOptions = {}) {
			const name = String(moduleId).replace(/^node:/, '');
			if (SAFE_APIS.includes(name)) return get(name);
			if (!REQUESTABLE_APIS.includes(name)) throw `The module "${moduleId}" is not supported`;
			if (!ensurePermission(plugin, name, options)) return undefined;
			if (name === 'fs') return options.scope ? createScopedFs(fs, path, options.scope) : fs;
			return get(name);
		};
	}

	const systemInfo = () => {
		roots = readRoots();
		return {
			platform: 'android', home_directory: roots.external, appdata_directory: roots.files, user_data_directory: roots.files,
			desktop_directory: roots.external, temp_directory: roots.cache, arch: get('os').arch(), os_version: get('os').version(),
		};
	};

	/** Globais que o Blockbench desktop também expõe (window.Buffer, PathModule, SystemInfo). */
	function installGlobals() {
		const w = window as any;
		if (typeof w.Buffer === 'undefined') w.Buffer = Buffer;
		if (!w.PathModule) w.PathModule = path;
		if (!w.SystemInfo) w.SystemInfo = systemInfo();
	}

	return {
		requireFor, installGlobals, fs, path, systemInfo,
		hasAllFilesAccess: () => !!readRoots().hasAll,
		permissions: () => loadPerms(),
		revokeAll: () => savePerms({}),
		setProcessRunner: M.setProcessRunner,
		SAFE_APIS, REQUESTABLE_APIS,
	};
}

export type NodeCompat = ReturnType<typeof createNodeCompat>;
