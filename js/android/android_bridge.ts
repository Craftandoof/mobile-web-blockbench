/**
 * Android (Capacitor) bridge for the Blockbench WEB build.
 * Does nothing in a normal browser. In the Android app it:
 *  1. replaces the web "download" export with a native Save dialog (real file name, user-chosen location)
 *  2. flushes + auto-restores open projects so work survives the app being killed
 *  3. starts a foreground service that keeps the process alive in the background
 */
import { t } from './i18n';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { initAndroidUi } from './android_menu';
import { ignoreFileLimits, pickAnyFile } from './file_limits';
import { contentToBytes, bytesToBase64, stageApi, stageBytes, discardStage } from './export_data';
import { createNodeCompat, NodeCompat } from './node';
import { createNativeRunner } from './node/native_proc';
import { Store, toast } from './ui_kit';
import { fileManagerEnabled, openFileManager, saveBytesTo, readAsFile, fmHooks } from './file_manager';

let isNative = false;
let Native: any = null;
try {
	isNative = Capacitor.isNativePlatform();
	if (isNative) Native = registerPlugin('BlockbenchNative');
} catch (err) {
	console.error('Android bridge unavailable', err);
	isNative = false;
}

function whenReady(test: () => boolean, run: () => void, timeout = 60000) {
	const start = Date.now();
	const t = setInterval(() => {
		if (test()) { clearInterval(t); run(); }
		else if (Date.now() - start > timeout) clearInterval(t);
	}, 200);
}

function mimeFor(name: string): string {
	// Only well-known types. For anything else (jem, bbmodel, obj, gltf...) use octet-stream:
	// a wrong/unknown mime makes some Android providers append ".txt" or similar to the file name.
	const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
	const map: Record<string, string> = {
		json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
		gif: 'image/gif', zip: 'application/zip', txt: 'text/plain',
	};
	return map[ext] || 'application/octet-stream';
}

// ---- compatibilidade com Node para plugins desktop (fs real via BBNativeFs, path, zlib, crypto...)
let compat: NodeCompat | null = null;
let ffmpegInfo: () => { found: boolean; path?: string; package?: string; version?: string } = () => ({ found: false });
const pluginCompatEnabled = () => isNative && Store.get<boolean>('plugin_compat', true);
function getCompat(): NodeCompat | null {
	if (!isNative) return null;
	if (!compat) {
		compat = createNodeCompat((window as any).BBNativeFs, {
			confirm: m => window.confirm(m),
			toast: m => toast(m),
			openExternal: url => Native.openExternal({ url }),
		});
		// ffmpeg do "FFmpeg Plugin" do PojavLauncher para plugins como o Scene Recorder; sem ele o plugin mostra a tela própria de definir o ffmpeg
		const nr = createNativeRunner((window as any).BBNativeProc, { toast: (m, ms) => toast(m, ms) });
		ffmpegInfo = nr.info;
		compat.setProcessRunner(nr.runner);
	}
	return compat;
}

export const AndroidBridge = {
	active: isNative,

	/** Returns true if the export was handled natively; false lets the original web code run. */
	exportFile(options: any, callback?: (name: string) => void): boolean {
		if (!isNative || options.custom_writer) return false;

		let name: string = options.name || 'file';
		const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
		if (!ignoreFileLimits() && options.extensions instanceof Array && options.extensions[0] && !options.extensions.includes(ext)) {
			name += '.' + options.extensions[0];
		}
		(window as any).__bbSaving = true;
		(async () => {
			try {
				const savetype = typeof options.savetype === 'function' ? options.savetype(name) : options.savetype;
				const bytes = await contentToBytes(options.content, savetype);
				if (bytes.length === 0) {
					// nunca criar um arquivo vazio em silêncio
					console.warn('Exportação sem conteúdo', { name, savetype, type: typeof options.content });
					toast(t('Nada foi salvo: o conteúdo gerado para "{0}" está vazio', name));
					return;
				}
				if (fileManagerEnabled()) {
					// gerenciador de arquivos do app: escolhe pasta + nome e grava direto (sem o seletor do Android)
					const pick = await openFileManager({ mode: 'save', name, extensions: options.extensions, title: options.title });
					if (!pick) return;                                  // cancelado
					if (pick.kind === 'path') {
						saveBytesTo(pick.path, bytes);
						toast(t('Salvo em {0}', pick.path), 3500);
						if (typeof callback === 'function') callback(pick.path.slice(pick.path.lastIndexOf('/') + 1));
						return;
					}
					// 'system': segue para o seletor do Android abaixo
				}
				const payload: any = { name, mime: mimeFor(name), size: bytes.length };
				let stageId = '';
				if (stageApi()) { stageId = stageBytes(bytes); payload.stage = stageId; }
				else payload.data = bytesToBase64(bytes);
				let res: any;
				try { res = await Native.saveFile(payload); } catch (err) { if (stageId) discardStage(stageId); throw err; }
				if (res && res.cancelled) return;
				if (res && typeof res.bytes === 'number' && res.bytes !== bytes.length) throw new Error(t('foram gravados {0} de {1} bytes', res.bytes, bytes.length));
				if (typeof callback === 'function') callback((res && res.name) || name);
			} catch (err: any) {
				console.error('Android save failed', err);
				toast(t('Falha ao salvar: ') + (err?.message || err), 5000);
			} finally {
				(window as any).__bbSaving = false;
			}
		})();
		return true;
	},

	/** True quando plugins desktop podem ser instalados/executados (compatibilidade com Node ligada). */
	nodeCompatActive(): boolean { return pluginCompatEnabled(); },
	/** require() de Node para o plugin (ver js/android/node). undefined = comportamento do navegador. */
	pluginRequire(plugin: any) { return pluginCompatEnabled() ? getCompat()!.requireFor(plugin) : undefined; },

	/**
	 * Plugue um executor de programas (ex.: ffmpeg) no child_process emulado dos plugins desktop.
	 * fn(cmd, args, options) deve devolver um objeto com eventos 'close'/'error' e, se houver saída, stdout/stderr
	 * (EventEmitter). Passe null para remover.
	 */
	setProcessRunner(fn: ((cmd: string, args: string[], options: any) => any) | null) { getCompat()?.setProcessRunner(fn); },

	/** True quando a opção "Ignorar limitação de arquivo" está ligada. */
	ignoreFileLimits(): boolean { return isNative && ignoreFileLimits(); },

	/** Abre o gerenciador de arquivos do app (ou o seletor sem filtro). Devolve true se tratou a importação. */
	importFile(options: any, cb: (files: File[]) => void): boolean {
		if (!isNative) return false;
		const accept = !ignoreFileLimits() && options?.extensions?.length ? '.' + options.extensions.join(',.') : undefined;
		if (fileManagerEnabled()) {
			(async () => {
				try {
					const pick = await openFileManager({ mode: 'open', extensions: options?.extensions, multiple: options?.multiple === true, title: options?.title });
					if (!pick) return;
					if (pick.kind === 'system') { pickAnyFile(options?.multiple === true, cb, accept); return; }
					const paths = pick.kind === 'path' ? [pick.path] : pick.paths;
					cb(paths.map(p => readAsFile(p)));
				} catch (err: any) {
					console.error('Android open failed', err);
					toast(t('Falha ao abrir: ') + (err?.message || err), 5000);
				}
			})();
			return true;
		}
		if (!ignoreFileLimits()) return false;
		pickAnyFile(options?.multiple === true, cb);
		return true;
	},

	async setKeepAlive(enabled: boolean) {
		if (!isNative) return;
		localStorage.setItem('bb_android_keepalive', enabled ? '1' : '0');
		if (enabled) await Native.startKeepAlive(); else await Native.stopKeepAlive();
	},
	keepAliveEnabled(): boolean {
		return localStorage.getItem('bb_android_keepalive') !== '0';
	},
	/** Tela cheia imersiva do Android (esconde barra de status e de navegação). */
	async setFullscreen(on: boolean) {
		if (!isNative) {
			try {
				if (on) await document.documentElement.requestFullscreen();
				else if (document.fullscreenElement) await document.exitFullscreen();
			} catch { /* o navegador pode exigir gesto do usuário */ }
			return;
		}
		await Native.setFullscreen({ enabled: on });
	},
	/** Desenha também sob o recorte da câmera e as bordas (sem a faixa preta). */
	async setFillScreen(on: boolean) {
		if (!isNative) return;
		await Native.setFillScreen({ enabled: on });
	},
	/** Para o serviço Keep Alive, fecha a Activity e encerra o processo. */
	async forceQuit() {
		if (!isNative) { window.close(); return; }
		await Native.forceQuit();
	},
	async requestBatteryExemption() {
		if (isNative) await Native.requestBatteryExemption();
	},
};

if (isNative) try {
	(window as any).AndroidBridge = AndroidBridge;

	// --- Session persistence ---
	// Backup do projeto aberto. Com modelos grandes (ex.: centenas de animações) cada backup recompila o projeto
	// inteiro: por isso não repete se nada mudou, e não roda enquanto um salvamento/seletor está aberto
	// (era nessa hora, com a memória no limite, que o app podia fechar).
	let lastKey = '', lastAt = 0;
	const flush = (force?: any) => {
		try {
			const w = window as any;
			if (!(w.AutoBackup?.db && w.Project)) return;
			if (w.__bbSaving && force !== true) return;
			const P = w.Project;
			const key = [P.uuid, P.undo?.index ?? '', P.saved ? 1 : 0, P.textures?.length ?? '', w.Animation?.all?.length ?? '', P.name].join('|');
			if (key === lastKey && Date.now() - lastAt < 120000) return;
			lastKey = key; lastAt = Date.now();
			w.AutoBackup.backupOpenProject();
		} catch (e) { console.error(e); }
	};
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flush();
	});
	window.addEventListener('pagehide', flush);

	whenReady(() => !!((window as any).Blockbench && (window as any).AutoBackup), () => {
		(window as any).Blockbench.on('save_editor_state', flush);
	});
	// Reopening of previous projects happens in AutoBackup.initialize() (see patches/js_auto_backup.ts.patch)

	fmHooks.requestAllFiles = () => { Native.requestAllFilesAccess(); };
	if (pluginCompatEnabled()) { try { getCompat()?.installGlobals(); } catch (e) { console.error('Compat Node:', e); } }

	// --- Menu flutuante, Enviar Input, configurações e controles de touch ---
	initAndroidUi({
		isNative,
		keepAliveEnabled: () => AndroidBridge.keepAliveEnabled(),
		setKeepAlive: enabled => AndroidBridge.setKeepAlive(enabled),
		setFullscreen: on => AndroidBridge.setFullscreen(on),
		setFillScreen: on => AndroidBridge.setFillScreen(on),
		pluginCompat: {
			enabled: () => pluginCompatEnabled(),
			setEnabled: on => { Store.set('plugin_compat', on); if (on) getCompat()?.installGlobals(); },
			hasAllFilesAccess: () => !!getCompat()?.hasAllFilesAccess(),
			ffmpegStatus: () => { getCompat(); return ffmpegInfo(); },
			openFfmpegPage: () => Native.openExternal({ url: 'https://github.com/PojavLauncherTeam/FFmpegPlugin' }),
			requestAllFilesAccess: () => Native.requestAllFilesAccess(),
			revokeAll: () => getCompat()?.revokeAll(),
			permissionCount: () => Object.keys(getCompat()?.permissions() || {}).length,
		},
		forceQuit: () => AndroidBridge.forceQuit(),
		flush,
	});

	// --- Keep-alive ---
	if (AndroidBridge.keepAliveEnabled()) {
		(async () => {
			try {
				await Native.requestPermissions({ permissions: ['notifications'] });
			} catch (e) { /* denied: service still runs, notification is just hidden */ }
			try { await Native.startKeepAlive(); } catch (e) { console.error(e); }
		})();
	}
} catch (err) {
	console.error('Android bridge init failed', err);
}
