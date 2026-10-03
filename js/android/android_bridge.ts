/**
 * Android (Capacitor) bridge for the Blockbench WEB build.
 * Does nothing in a normal browser. In the Android app it:
 *  1. replaces the web "download" export with a native Save dialog (real file name, user-chosen location)
 *  2. flushes + auto-restores open projects so work survives the app being killed
 *  3. starts a foreground service that keeps the process alive in the background
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

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

async function toBlob(content: any, savetype: string | undefined): Promise<Blob> {
	if (content instanceof Blob) return content;
	if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) return new Blob([content as any]);
	if (typeof content === 'string') {
		if (savetype === 'image') {
			// data: URL or blob:/http URL of a texture
			const res = await fetch(content);
			return await res.blob();
		}
		return new Blob([content], { type: 'text/plain;charset=utf-8' });
	}
	throw new Error('Unsupported export content');
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve((r.result as string).split(',')[1] || '');
		r.onerror = () => reject(r.error);
		r.readAsDataURL(blob);
	});
}

export const AndroidBridge = {
	active: isNative,

	/** Returns true if the export was handled natively; false lets the original web code run. */
	exportFile(options: any, callback?: (name: string) => void): boolean {
		if (!isNative || options.custom_writer) return false;

		let name: string = options.name || 'file';
		const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
		if (options.extensions instanceof Array && options.extensions[0] && !options.extensions.includes(ext)) {
			name += '.' + options.extensions[0];
		}
		(async () => {
			try {
				const savetype = typeof options.savetype === 'function' ? options.savetype(name) : options.savetype;
				const blob = await toBlob(options.content, savetype);
				const data = await blobToBase64(blob);
				const res = await Native.saveFile({ name, mime: mimeFor(name), data });
				if (res && res.cancelled) return;
				if (typeof callback === 'function') callback((res && res.name) || name);
			} catch (err: any) {
				console.error('Android save failed', err);
				(window as any).Blockbench?.showQuickMessage?.('Save failed: ' + (err?.message || err), 4000);
			}
		})();
		return true;
	},

	async setKeepAlive(enabled: boolean) {
		if (!isNative) return;
		localStorage.setItem('bb_android_keepalive', enabled ? '1' : '0');
		if (enabled) await Native.startKeepAlive(); else await Native.stopKeepAlive();
	},
	async requestBatteryExemption() {
		if (isNative) await Native.requestBatteryExemption();
	},
};

if (isNative) try {
	(window as any).AndroidBridge = AndroidBridge;

	// --- Session persistence ---
	const flush = () => {
		try {
			const w = window as any;
			if (w.AutoBackup?.db && w.Project) w.AutoBackup.backupOpenProject();
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

	// --- Keep-alive ---
	if (localStorage.getItem('bb_android_keepalive') !== '0') {
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
