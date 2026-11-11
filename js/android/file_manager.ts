/**
 * Gerenciador de arquivos nativo do app (no estilo do seletor da Godot): navega pelas pastas do aparelho,
 * salva com o nome e a pasta que você escolher, abre vários arquivos e cria/renomeia/exclui pastas e arquivos.
 * Usa o BBNativeFs (Java) — com "acesso a todos os arquivos" vê o armazenamento inteiro; sem ele, só as pastas do app,
 * e o botão do topo leva ao seletor do Android.
 */
import { UI_CLASS } from './input_emulator';
import { Store, getRoot, h, toast, confirmDialog, promptDialog } from './ui_kit';
import { t } from './i18n';
import { ignoreFileLimits } from './file_limits';

// ------------------------------------------------------------------ acesso ao BBNativeFs

interface Fs {
	stat(p: string): string; readFile(p: string): string; writeFile(p: string, b64: string, append: string): string;
	listdir(p: string): string; readChunk(p: string, off: string, len: string): string; mkdir(p: string, rec: string): string;
	rm(p: string, rec: string): string; rename(a: string, b: string): string; roots(): string; userDirs(): string;
}
const fsn = (): Fs | null => (typeof window !== 'undefined' && (window as any).BBNativeFs) || null;
function unwrap(r: string): string {
	if (typeof r !== 'string') throw new Error(t('resposta inválida do módulo nativo'));
	if (r[0] === 'O') return r.slice(1);
	if (r.startsWith('E:')) { const [, code, ...m] = r.split(':'); throw Object.assign(new Error(m.join(':') || code), { code }); }
	throw new Error(t('resposta inválida do módulo nativo'));
}
const call = (f: (fs: Fs) => string): string => { const fs = fsn(); if (!fs) throw new Error(t('módulo nativo indisponível')); return unwrap(f(fs)); };

export const fmHooks: { requestAllFiles: (() => void) | null } = { requestAllFiles: null };
const KEY_ON = 'native_fm';
export const fileManagerEnabled = (): boolean => !!fsn() && Store.get<boolean>(KEY_ON, true);
export const setFileManagerEnabled = (on: boolean) => Store.set(KEY_ON, on);

const sep = (p: string) => (p.endsWith('/') ? p : p + '/');
const dirname = (p: string) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const extOf = (n: string) => (n.includes('.') ? n.split('.').pop()!.toLowerCase() : '');

// ------------------------------------------------------------------ leitura e gravação (em pedaços)

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
function bytesToB64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as any);
	return btoa(bin);
}
const exists = (p: string): { dir: boolean; size: number } | null => {
	try { const o = JSON.parse(call(fs => fs.stat(p))); return { dir: o.t === 'd', size: o.s }; } catch { return null; }
};

/** Grava `bytes` em `path` por um arquivo temporário e confere o tamanho antes de trocar pelo definitivo. */
export function saveBytesTo(path: string, bytes: Uint8Array) {
	const tmp = sep(dirname(path)) + '.' + basename(path) + '.bbpart';
	const STEP = 512 * 1024;
	try {
		if (bytes.length === 0) call(fs => fs.writeFile(tmp, '', '0'));
		for (let i = 0; i < bytes.length; i += STEP) call(fs => fs.writeFile(tmp, bytesToB64(bytes.subarray(i, i + STEP)), i === 0 ? '0' : '1'));
		const st = exists(tmp);
		if (!st || st.size !== bytes.length) throw new Error(t('foram gravados {0} de {1} bytes', st ? st.size : 0, bytes.length));
		if (exists(path)) call(fs => fs.rm(path, '0'));
		call(fs => fs.rename(tmp, path));
	} catch (e) {
		try { call(fs => fs.rm(tmp, '0')); } catch { /* ok */ }
		throw e;
	}
}

export function readAsFile(path: string): File {
	const st = exists(path);
	if (!st) throw new Error(t('arquivo não encontrado: {0}', path));
	const parts: BlobPart[] = [];
	if (st.size <= 6 * 1024 * 1024) parts.push(b64ToBytes(call(fs => fs.readFile(path))) as BlobPart);
	else for (let off = 0; off < st.size; off += 2 * 1024 * 1024) parts.push(b64ToBytes(call(fs => fs.readChunk(path, String(off), String(2 * 1024 * 1024)))) as BlobPart);
	return new File(parts, basename(path));
}

// ------------------------------------------------------------------ estilo

const CSS = `
#bb-android-root .fm{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;background:var(--color-back,#14181e);color:var(--color-text,#e6e6e6);pointer-events:auto;font-size:15px;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
#bb-android-root .bbk-modal{z-index:100002}
#bb-android-root .fm button{all:unset;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent}
#bb-android-root .fm-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--color-border,#3a4150)}
#bb-android-root .fm-head h3{margin:0;flex:1;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bb-android-root .fm button.fm-btn{min-height:40px;min-width:40px;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:var(--color-button,#272d38);white-space:nowrap}
#bb-android-root .fm button.fm-btn.primary{background:var(--color-accent,#3e90ff);color:#fff}
#bb-android-root .fm button.fm-btn.danger{background:#b3402f;color:#fff}
#bb-android-root .fm button.fm-btn[disabled]{opacity:.45}
#bb-android-root .fm-bar{display:flex;align-items:center;gap:6px;padding:6px 10px}
#bb-android-root .fm-path{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;padding:8px 10px;border-radius:8px;background:var(--color-dark,#0e1116);font-family:monospace;font-size:13px}
#bb-android-root .fm-short{display:flex;gap:6px;overflow-x:auto;padding:0 10px 6px}
#bb-android-root .fm button.fm-chip{flex:none;min-height:34px;padding:0 12px;display:inline-flex;align-items:center;border-radius:17px;background:var(--color-button,#272d38);font-size:13px}
#bb-android-root .fm button.fm-chip.on{background:var(--color-accent,#3e90ff);color:#fff}
#bb-android-root .fm-banner{margin:0 10px 6px;padding:8px 10px;border-radius:8px;background:#5a4a1a;font-size:13px;display:flex;gap:8px;align-items:center}
#bb-android-root .fm-banner span{flex:1}
#bb-android-root .fm-list{flex:1;min-height:0;overflow-y:auto;border-top:1px solid var(--color-border,#3a4150);-webkit-overflow-scrolling:touch}
#bb-android-root .fm-row{display:flex;align-items:center;gap:10px;min-height:54px;padding:0 6px 0 12px;border-bottom:1px solid rgba(255,255,255,.06)}
#bb-android-root .fm-row.sel{background:rgba(62,144,255,.25)}
#bb-android-root .fm-row .ic{font-size:22px;width:28px;text-align:center;flex:none}
#bb-android-root .fm-row .tx{flex:1;min-width:0}
#bb-android-root .fm-row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bb-android-root .fm-row .sub{font-size:12px;opacity:.65}
#bb-android-root .fm .fm-row button.more{flex:none;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;opacity:.8}
#bb-android-root .fm-empty{padding:28px 16px;text-align:center;opacity:.65}
#bb-android-root .fm-foot{display:flex;gap:8px;align-items:center;padding:8px 10px;border-top:1px solid var(--color-border,#3a4150)}
#bb-android-root .fm-foot input{flex:1;min-width:0;min-height:42px;padding:0 10px;border-radius:8px;border:1px solid var(--color-border,#3a4150);background:var(--color-dark,#0e1116);color:inherit;font-size:15px}
`;
function injectFmStyle() {
	if (document.getElementById('bb-android-fm-style')) return;
	const st = document.createElement('style');
	st.id = 'bb-android-fm-style';
	st.textContent = CSS;
	document.head.appendChild(st);
}

// ------------------------------------------------------------------ interface

export type FmMode = 'save' | 'open' | 'browse';
export interface FmOptions { mode: FmMode; title?: string; name?: string; extensions?: string[]; multiple?: boolean }
export type FmResult = { kind: 'path'; path: string } | { kind: 'paths'; paths: string[] } | { kind: 'system' } | null;

interface Entry { name: string; dir: boolean; size: number; mtime: number }

function humanSize(n: number): string {
	if (n < 1024) return n + ' B';
	if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
	if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
	return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function fileIcon(name: string): string {
	const e = extOf(name);
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tga'].includes(e)) return '🖼️';
	if (['bbmodel', 'json', 'jem', 'jpm', 'obj', 'gltf', 'glb', 'fbx', 'mcmeta', 'geo'].includes(e)) return '🧊';
	if (['mp4', 'webm', 'mkv', 'avi', 'mov', 'gif'].includes(e)) return '🎞️';
	if (['ogg', 'wav', 'mp3'].includes(e)) return '🎵';
	if (['js', 'ts'].includes(e)) return '📜';
	if (['zip', 'jar', '7z', 'rar'].includes(e)) return '📦';
	return '📄';
}

let current: { close: () => void } | null = null;

export function openFileManager(opts: FmOptions): Promise<FmResult> {
	return new Promise<FmResult>(resolve => {
		current?.close();
		injectFmStyle();
		const mode = opts.mode;
		const exts = (opts.extensions || []).map(e => e.replace(/^\./, '').toLowerCase()).filter(Boolean);
		let filterOn = exts.length > 0 && !ignoreFileLimits();
		let sort = Store.get<'name' | 'date' | 'size'>('fm_sort', 'name');
		let cwd = '';
		let entries: Entry[] = [];
		let hasAll = false;
		const picked = new Set<string>();
		let finished = false;

		const done = (r: FmResult) => {
			if (finished) return;
			finished = true;
			document.removeEventListener('visibilitychange', onVis);
			box.remove();
			current = null;
			resolve(r);
		};
		current = { close: () => done(null) };

		const title = h('h3', {}, opts.title || (mode === 'save' ? t('Salvar arquivo') : mode === 'open' ? t('Abrir arquivo') : t('Gerenciador de arquivos')));
		const pathEl = h('div', { class: 'fm-path' });
		const list = h('div', { class: 'fm-list' });
		const shortRow = h('div', { class: 'fm-short' });
		const bannerHost = h('div', {});
		const nameInput = h('input', { type: 'text', value: opts.name || '', placeholder: t('Nome do arquivo') });
		const okBtn = h('button', { class: 'fm-btn primary' }, '');

		const btn = (label: string, fn: () => void, cls = '') => h('button', { class: 'fm-btn ' + cls, onclick: fn }, label);

		const head = h('div', { class: 'fm-head' },
			btn('✕', () => done(null)), title,
			mode === 'browse' ? null : btn(t('Seletor do Android'), () => done({ kind: 'system' })));
		const bar = h('div', { class: 'fm-bar' },
			btn('⬆', () => { if (cwd !== '/') go(dirname(cwd)); }),
			pathEl,
			btn('📁＋', async () => {
				const n = await promptDialog({ title: t('Nova pasta'), placeholder: t('Nome da pasta'), confirmLabel: t('Criar') });
				if (!n) return;
				try { call(fs => fs.mkdir(sep(cwd) + n, '0')); refresh(); } catch (e: any) { toast(t('Não foi possível criar a pasta: ') + e.message, 4000); }
			}),
			btn('↻', () => refresh()));
		const sortBtn = btn('', () => { sort = sort === 'name' ? 'date' : sort === 'date' ? 'size' : 'name'; Store.set('fm_sort', sort); render(); });
		const sortLabel = () => { sortBtn.textContent = '↕ ' + (sort === 'name' ? t('Nome') : sort === 'date' ? t('Data') : t('Tamanho')); };

		const foot = h('div', { class: 'fm-foot' });
		if (mode === 'save') {
			okBtn.textContent = t('Salvar');
			okBtn.addEventListener('click', () => confirmSave());
			foot.append(nameInput, okBtn);
		} else if (mode === 'open' && opts.multiple) {
			okBtn.addEventListener('click', () => { if (picked.size) done({ kind: 'paths', paths: [...picked] }); });
			foot.append(h('span', { style: 'flex:1;opacity:.7;font-size:13px' }, t('Toque nos arquivos para marcar')), okBtn);
		}

		const box = h('div', { class: 'fm ' + UI_CLASS }, head, bar, shortRow, bannerHost, list, foot.childNodes.length ? foot : null);
		getRoot().appendChild(box);
		if (!foot.childNodes.length) foot.remove();

		// ---- ações
		function confirmSave() {
			let n = nameInput.value.trim().replace(/[\\/]/g, '_');
			if (!n) { toast(t('Digite um nome para o arquivo')); return; }
			if (exts.length && !ignoreFileLimits() && !exts.includes(extOf(n))) n += '.' + exts[0];
			const p = sep(cwd) + n;
			const st = exists(p);
			if (st && st.dir) { toast(t('Já existe uma pasta com esse nome')); return; }
			if (st) {
				confirmDialog({ title: t('Substituir arquivo?'), message: t('"{0}" já existe nesta pasta.', n), confirmLabel: t('Substituir'), danger: true })
					.then(ok => { if (ok) done({ kind: 'path', path: p }); });
				return;
			}
			done({ kind: 'path', path: p });
		}
		function pickFile(e: Entry) {
			const p = sep(cwd) + e.name;
			if (mode === 'save') { nameInput.value = e.name; return; }
			if (mode === 'browse') return;
			if (opts.multiple) {
				if (picked.has(p)) picked.delete(p); else picked.add(p);
				render();
				return;
			}
			done({ kind: 'path', path: p });
		}
		async function rowMenu(e: Entry) {
			const p = sep(cwd) + e.name;
			const act = await actionSheet(e.name, [
				{ id: 'rename', label: t('Renomear') },
				{ id: 'delete', label: t('Excluir'), danger: true },
			]);
			if (act === 'rename') {
				const n = await promptDialog({ title: t('Renomear'), value: e.name, confirmLabel: t('Renomear') });
				if (!n || n === e.name) return;
				try { call(fs => fs.rename(p, sep(cwd) + n.replace(/[\\/]/g, '_'))); refresh(); } catch (er: any) { toast(t('Não foi possível renomear: ') + er.message, 4000); }
			} else if (act === 'delete') {
				const ok = await confirmDialog({
					title: t('Excluir'), danger: true, confirmLabel: t('Excluir'),
					message: e.dir ? t('A pasta "{0}" e tudo dentro dela serão excluídos. Não dá para desfazer.', e.name) : t('"{0}" será excluído. Não dá para desfazer.', e.name),
				});
				if (!ok) return;
				try { call(fs => fs.rm(p, e.dir ? '1' : '0')); picked.delete(p); refresh(); } catch (er: any) { toast(t('Não foi possível excluir: ') + er.message, 4000); }
			}
		}

		// ---- navegação / desenho
		function go(dir: string) {
			try {
				const st = exists(dir);
				if (!st || !st.dir) throw new Error(t('pasta não encontrada'));
				const rows: any[] = JSON.parse(call(fs => fs.listdir(dir)));
				entries = rows.map(r => ({ name: r[0], dir: r[1] === 'd', size: Number(r[2]) || 0, mtime: Number(r[3]) || 0 }));
				cwd = dir;
				Store.set('fm_dir', dir);
				render();
			} catch (e: any) {
				toast(t('Não foi possível abrir a pasta: ') + (e.message || e), 4000);
			}
		}
		const refresh = () => go(cwd);

		function render() {
			pathEl.textContent = cwd;
			pathEl.scrollLeft = pathEl.scrollWidth;
			sortLabel();
			// atalhos
			shortRow.textContent = '';
			let dirs: Record<string, string> = {};
			try { dirs = JSON.parse(call(fs => fs.userDirs())); } catch { /* sem atalhos */ }
			const shortcuts: [string, string | undefined][] = [
				[t('Armazenamento'), dirs.internal], ['Downloads', dirs.downloads], [t('Documentos'), dirs.documents],
				[t('Imagens'), dirs.pictures], ['DCIM', dirs.dcim], [t('Filmes'), dirs.movies], [t('Pasta do app'), dirs.app], [t('Volumes'), hasAll ? '/storage' : undefined],
			];
			for (const [label, p] of shortcuts) {
				if (!p || !exists(p)) continue;
				shortRow.append(h('button', { class: 'fm-chip' + (cwd === p ? ' on' : ''), onclick: () => go(p) }, label));
			}
			shortRow.append(sortBtn);
			if (exts.length && !ignoreFileLimits() && mode !== 'browse') {
				shortRow.append(h('button', { class: 'fm-chip' + (filterOn ? ' on' : ''), onclick: () => { filterOn = !filterOn; render(); } },
					filterOn ? t('Só {0}', exts.map(e => '.' + e).join(' ')) : t('Todos os arquivos')));
			}
			// aviso de acesso limitado
			bannerHost.textContent = '';
			if (!hasAll) {
				bannerHost.append(h('div', { class: 'fm-banner' },
					h('span', {}, t('Acesso limitado às pastas do app. Conceda "acesso a todos os arquivos" para ver o aparelho inteiro.')),
					btn(t('Conceder'), () => fmHooks.requestAllFiles?.(), 'primary')));
			}
			// lista
			const vis = entries.filter(e => e.dir || mode === 'browse' || !filterOn || exts.includes(extOf(e.name)))
				.sort((a, b) => {
					if (a.dir !== b.dir) return a.dir ? -1 : 1;
					if (sort === 'date') return b.mtime - a.mtime;
					if (sort === 'size' && !a.dir) return b.size - a.size;
					return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
				});
			list.textContent = '';
			if (cwd !== '/') list.append(h('div', { class: 'fm-row', onclick: () => go(dirname(cwd)) }, h('span', { class: 'ic' }, '⬆'), h('div', { class: 'tx' }, h('div', { class: 'nm' }, '..'))));
			if (!vis.length) list.append(h('div', { class: 'fm-empty' }, entries.length ? t('Nenhum arquivo deste tipo aqui. Use "Todos os arquivos" para ver os outros.') : t('Pasta vazia')));
			for (const e of vis) {
				const p = sep(cwd) + e.name;
				const row = h('div', { class: 'fm-row' + (picked.has(p) ? ' sel' : '') },
					h('span', { class: 'ic' }, e.dir ? '📁' : picked.has(p) ? '☑️' : fileIcon(e.name)),
					h('div', { class: 'tx' },
						h('div', { class: 'nm' }, e.name),
						h('div', { class: 'sub' }, e.dir ? t('Pasta') : humanSize(e.size) + (e.mtime ? ' · ' + new Date(e.mtime).toLocaleDateString() : ''))),
					h('button', { class: 'more', onclick: (ev: Event) => { ev.stopPropagation(); rowMenu(e); } }, '⋮'));
				row.addEventListener('click', () => (e.dir ? go(p) : pickFile(e)));
				list.append(row);
			}
			if (mode === 'open' && opts.multiple) {
				okBtn.textContent = t('Abrir ({0})', picked.size);
				okBtn.toggleAttribute('disabled', picked.size === 0);
			}
		}

		// ao voltar da tela de permissão do Android, atualiza o acesso e a lista
		function onVis() {
			if (document.visibilityState !== 'visible' || finished) return;
			try { hasAll = !!JSON.parse(call(fs => fs.roots())).hasAll; } catch { /* ok */ }
			if (cwd) refresh();
		}
		document.addEventListener('visibilitychange', onVis);

		// ---- início
		let roots: any = {};
		try { roots = JSON.parse(call(fs => fs.roots())); hasAll = !!roots.hasAll; } catch (e: any) { toast(t('Módulo nativo indisponível: ') + e.message, 4000); done(null); return; }
		let dirs: Record<string, string> = {};
		try { dirs = JSON.parse(call(fs => fs.userDirs())); } catch { /* ok */ }
		const candidates = [Store.get<string>('fm_dir', ''), hasAll ? dirs.downloads : '', dirs.app, roots.files].filter(Boolean) as string[];
		const start = candidates.find(p => { const s = exists(p); return !!s && s.dir; }) || '/';
		go(start);
	});
}

// ------------------------------------------------------------------ folha de ações simples

function actionSheet(title: string, actions: { id: string; label: string; danger?: boolean }[]): Promise<string | null> {
	return new Promise(resolve => {
		const done = (v: string | null) => { modal.remove(); resolve(v); };
		const modal = h('div', { class: 'bbk-modal ' + UI_CLASS },
			h('div', {},
				h('h3', {}, title),
				...actions.map(a => h('button', { class: 'bbk-opt', style: a.danger ? 'color:#ff8a78' : '', onclick: () => done(a.id) }, a.label)),
				h('div', { class: 'bbk-actions', style: 'margin-top:8px' }, h('button', { class: 'bbk-opt', style: 'text-align:center;margin:0', onclick: () => done(null) }, t('Cancelar')))));
		getRoot().appendChild(modal);
	});
}
