/** Kit de interface do fork Android: tudo em DOM puro, sem depender do Vue do Blockbench. */
import { UI_CLASS } from './input_emulator';

// ------------------------------------------------------------------ armazenamento persistente (localStorage)

export const Store = {
	get<T>(key: string, def: T): T {
		try {
			const v = localStorage.getItem('bb_android_' + key);
			return v === null ? def : (JSON.parse(v) as T);
		} catch { return def; }
	},
	set(key: string, value: any) {
		try { localStorage.setItem('bb_android_' + key, JSON.stringify(value)); } catch { /* cheio/bloqueado */ }
	},
	remove(key: string) {
		try { localStorage.removeItem('bb_android_' + key); } catch { /* ok */ }
	},
};

// ------------------------------------------------------------------ escala (modo "versão de computador")

/** CSS px por dp. 1 no normal; >1 quando o viewport é forçado a ser largo (modo desktop). */
export function uiScale(): number {
	const sw = (typeof screen !== 'undefined' && screen.width) || window.innerWidth;
	const u = window.innerWidth / sw;
	return u > 1.15 ? u : 1;
}

// ------------------------------------------------------------------ DOM helper

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === undefined || v === null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'style' && typeof v === 'string') el.style.cssText = v;
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
		else if (k === 'value') (el as any).value = v;
		else if (k === 'checked' || k === 'disabled' || k === 'selected') (el as any)[k] = !!v;
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c as any);
	return el;
}

// ------------------------------------------------------------------ estilos

const CSS = `
.bb-android-ui{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
#bb-android-root{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99990;font-family:var(--font-main,Roboto,system-ui,sans-serif);font-size:14px;color:var(--color-text,#e5e7eb);transform-origin:0 0}
#bb-android-root *{box-sizing:border-box}
#bb-android-fab{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);width:44px;height:44px;border-radius:50%;
 border:1px solid var(--color-border,#3a4150);background:var(--color-ui,#1d222b);color:var(--color-text,#e5e7eb);font-size:22px;line-height:42px;text-align:center;
 pointer-events:auto;cursor:pointer;user-select:none;touch-action:manipulation;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.45)}
#bb-android-fab:active{background:var(--color-selected,#2d3542)}
.bbk-layer{position:fixed;inset:0;pointer-events:none}
.bbk-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);pointer-events:auto;opacity:0;transition:opacity .18s}
.bbk-layer.open .bbk-scrim{opacity:1}
.bbk-drawer{position:absolute;top:0;bottom:0;width:min(86vw,360px);max-width:100%;background:var(--color-back,#14181e);border-right:1px solid var(--color-border,#3a4150);
 display:flex;flex-direction:column;pointer-events:auto;transform:translateX(-102%);transition:transform .2s ease,filter .2s;box-shadow:4px 0 18px rgba(0,0,0,.5);padding-top:env(safe-area-inset-top,0px)}
.bbk-drawer.right{right:0;left:auto;border-right:0;border-left:1px solid var(--color-border,#3a4150);transform:translateX(102%);box-shadow:-4px 0 18px rgba(0,0,0,.5)}
.bbk-drawer.left{left:0}
.bbk-layer.open .bbk-drawer{transform:none}
.bbk-layer.behind .bbk-drawer{pointer-events:none;filter:brightness(.55)}
.bbk-layer.behind .bbk-scrim{pointer-events:none}
.bbk-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--color-border,#3a4150);flex:0 0 auto}
.bbk-head h2{margin:0;font-size:16px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bbk-icon{width:36px;height:36px;border-radius:8px;border:0;background:var(--color-button,#272d38);color:inherit;font-size:18px;cursor:pointer;flex:0 0 auto}
.bbk-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:8px 10px 16px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.bbk-item{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:10px 12px;margin:0 0 6px;border:0;border-radius:8px;background:var(--color-button,#272d38);color:inherit;font-size:15px;text-align:left;cursor:pointer}
.bbk-item:active{background:var(--color-selected,#344050)}
.bbk-item small{display:block;opacity:.65;font-size:12px;margin-top:2px}
.bbk-item .bbk-grow{flex:1;min-width:0}
.bbk-item.danger{color:#ff8a80}
.bbk-item.primary{background:var(--color-accent,#3e90ff);color:#fff}
.bbk-item[disabled]{opacity:.45;pointer-events:none}
.bbk-sec{margin:14px 2px 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.bbk-row{display:flex;align-items:center;gap:10px;margin:0 0 8px;min-height:40px}
.bbk-row>label{flex:0 0 38%;font-size:13px;opacity:.85}
.bbk-row>.bbk-ctl{flex:1;min-width:0;display:flex;align-items:center;gap:8px}
.bbk-row input[type=text],.bbk-row input[type=number],.bbk-row select,.bbk-row textarea,.bbk-text{width:100%;min-height:36px;padding:6px 8px;border-radius:6px;border:1px solid var(--color-border,#3a4150);background:var(--color-dark,#0e1116);color:inherit;font:inherit}
.bbk-row input[type=range]{width:100%}
.bbk-row input[type=color]{width:44px;height:32px;padding:0;border:1px solid var(--color-border,#3a4150);background:none;border-radius:6px}
.bbk-val{min-width:44px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8;font-size:13px}
.bbk-switch{position:relative;width:46px;height:26px;flex:0 0 auto;border-radius:13px;background:#4a5262;transition:background .15s}
.bbk-switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .15s}
.bbk-switch.on{background:var(--color-accent,#3e90ff)}
.bbk-switch.on::after{transform:translateX(20px)}
.bbk-hint{font-size:12px;opacity:.6;margin:-2px 2px 10px}
.bbk-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.bbk-chip{padding:7px 12px;border-radius:16px;border:1px solid var(--color-border,#3a4150);background:var(--color-button,#272d38);color:inherit;font-size:13px;cursor:pointer}
.bbk-chip.on{background:var(--color-accent,#3e90ff);border-color:transparent;color:#fff}
.bbk-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);pointer-events:auto;z-index:99999}
.bbk-modal>div{width:min(88vw,340px);background:var(--color-back,#14181e);border:1px solid var(--color-border,#3a4150);border-radius:12px;padding:16px}
.bbk-modal h3{margin:0 0 8px;font-size:16px}.bbk-modal p{margin:0 0 14px;opacity:.85;line-height:1.35}
.bbk-modal .bbk-actions{display:flex;gap:8px;justify-content:flex-end}.bbk-modal .bbk-actions .bbk-item{width:auto;margin:0;min-height:40px}
#bb-android-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);transform:translateX(-50%);max-width:88vw;padding:10px 16px;border-radius:20px;background:rgba(20,24,30,.95);border:1px solid var(--color-border,#3a4150);color:#fff;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:100100}
#bb-android-toast.show{opacity:1}
#bb-android-vmouse{position:fixed;left:0;top:0;z-index:100200;pointer-events:none;display:none;will-change:transform}
/* ---------- controles na tela ---------- */
#bb-android-controls{position:fixed;inset:0;pointer-events:none;z-index:99000;touch-action:none}
.bbc{position:absolute;display:flex;align-items:center;justify-content:center;color:#fff;font:14px/1.1 var(--font-main,Roboto,system-ui,sans-serif);text-align:center;
 overflow:hidden;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;padding:4px;word-break:break-word}
.bbc.active::after,.bbc.toggled::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.24);border-radius:inherit;pointer-events:none}
.bbc.toggled::after{background:rgba(62,144,255,.5)}
.bbc.hidden{display:none}
.bbc.joy{border-radius:50%;padding:0}
.bbc .knob{position:absolute;width:42%;height:42%;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid rgba(255,255,255,.85);pointer-events:none}
.bbc.joy.locked .knob{background:rgba(62,144,255,.8)}
.editing .bbc{outline:1px dashed rgba(255,255,255,.55)}
.editing .bbc.selected{outline:2px solid #ffd54f}
.bbc .rz{position:absolute;right:0;bottom:0;width:22px;height:22px;background:linear-gradient(135deg,transparent 50%,#ffd54f 50%);display:none;touch-action:none}
.editing .bbc.selected .rz{display:block}
#bb-android-editbar{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:96vw;padding:6px;border-radius:12px;background:rgba(20,24,30,.92);border:1px solid var(--color-border,#3a4150);pointer-events:auto;z-index:99100}
#bb-android-editbar button{min-height:34px;padding:0 10px;border:0;border-radius:8px;background:var(--color-button,#272d38);color:#fff;font-size:13px}
#bb-android-editbar button.primary{background:var(--color-accent,#3e90ff)}
`;

export function injectStyle() {
	if (document.getElementById('bb-android-style')) return;
	const st = document.createElement('style');
	st.id = 'bb-android-style';
	st.textContent = CSS;
	document.head.appendChild(st);
}

// ------------------------------------------------------------------ raiz (zoom no modo desktop)

let root: HTMLElement | null = null;
export function getRoot(): HTMLElement {
	if (root && root.isConnected) return root;
	root = h('div', { id: 'bb-android-root', class: UI_CLASS });
	document.body.appendChild(root);
	applyScale();
	return root;
}
export function applyScale() {
	if (!root) return;
	const u = uiScale();
	(root.style as any).zoom = u === 1 ? '' : String(u);
}

// ------------------------------------------------------------------ menus laterais empilhados

export interface DrawerOpts {
	title: string;
	side?: 'left' | 'right';
	/** modal = com fundo escurecido; não modal = painel que deixa a tela de trás interativa */
	modal?: boolean;
	onClose?: () => void;
}
export interface Drawer {
	el: HTMLElement;
	body: HTMLElement;
	setTitle(t: string): void;
	close(): void;
	opts: DrawerOpts;
}

const stack: Drawer[] = [];
function refreshStack() {
	stack.forEach((d, i) => {
		const behind = i < stack.length - 1;
		d.el.classList.toggle('behind', behind);
		if (behind) d.el.setAttribute('inert', ''); else d.el.removeAttribute('inert');
	});
}

/**
 * Botão Voltar do Android: com menu aberto, fecha o menu e NÃO deixa o popstate do Blockbench (web.ts)
 * rodar (ele desfaria uma edição). Registrado na avaliação do módulo, antes do web.ts, e em captura.
 */
if (typeof window !== 'undefined') {
	window.addEventListener('popstate', e => {
		if (!stack.length) return;
		e.stopImmediatePropagation();
		closeTop();
		try { history.pushState({}, ''); } catch { /* ok */ }
	}, true);
}

export function openDrawer(opts: DrawerOpts): Drawer {
	const side = opts.side || 'left';
	const modal = opts.modal !== false;
	const closeBtn = h('button', { class: 'bbk-icon', 'aria-label': 'Fechar' }, stack.length ? '‹' : '✕');
	const title = h('h2', {}, opts.title);
	const body = h('div', { class: 'bbk-body' });
	const panel = h('aside', { class: 'bbk-drawer ' + side }, h('div', { class: 'bbk-head' }, closeBtn, title), body);
	const scrim = modal ? h('div', { class: 'bbk-scrim' }) : null;
	const layer = h('div', { class: 'bbk-layer' }, scrim, panel);
	layer.style.zIndex = String(20 + stack.length);
	if (!modal) layer.style.pointerEvents = 'none';
	getRoot().appendChild(layer);

	const drawer: Drawer = {
		el: layer, body, opts,
		setTitle: t => { title.textContent = t; },
		close: () => {
			const i = stack.indexOf(drawer);
			if (i < 0) return;
			stack.splice(i, 1);
			layer.classList.remove('open');
			refreshStack();
			setTimeout(() => layer.remove(), 220);
			try { opts.onClose?.(); } catch (e) { console.error(e); }
		},
	};
	closeBtn.addEventListener('click', () => drawer.close());
	scrim?.addEventListener('click', () => { if (stack[stack.length - 1] === drawer) drawer.close(); });
	stack.push(drawer);
	refreshStack();
	requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
	// garante um estado de histórico para o botão Voltar do Android
	try { history.pushState({}, ''); } catch { /* ok */ }
	return drawer;
}
export const topDrawer = () => stack[stack.length - 1] || null;
export function closeTop() { topDrawer()?.close(); }
export function closeAll() { while (stack.length) stack[stack.length - 1].close(); }
export const drawerCount = () => stack.length;

// ------------------------------------------------------------------ widgets

export function item(label: string, onClick: () => void, opts: { hint?: string; icon?: string; kind?: 'danger' | 'primary'; right?: Child } = {}) {
	return h('button', { class: 'bbk-item ' + (opts.kind || ''), onclick: onClick },
		opts.icon ? h('span', {}, opts.icon) : null,
		h('span', { class: 'bbk-grow' }, label, opts.hint ? h('small', {}, opts.hint) : null),
		opts.right || null);
}
export const section = (t: string) => h('div', { class: 'bbk-sec' }, t);
export const hint = (t: string) => h('div', { class: 'bbk-hint' }, t);

export function row(label: string, ...ctl: Child[]) {
	return h('div', { class: 'bbk-row' }, h('label', {}, label), h('div', { class: 'bbk-ctl' }, ...ctl));
}
export function slider(label: string, o: { min: number; max: number; step?: number; value: number; format?: (v: number) => string; onInput: (v: number) => void }) {
	const fmt = o.format || (v => String(v));
	const val = h('span', { class: 'bbk-val' }, fmt(o.value));
	const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? 1, value: o.value });
	input.addEventListener('input', () => { const v = Number(input.value); val.textContent = fmt(v); o.onInput(v); });
	return row(label, input, val);
}
export function toggleItem(label: string, o: { value: boolean; hint?: string; onChange: (v: boolean) => void }) {
	const sw = h('span', { class: 'bbk-switch' + (o.value ? ' on' : '') });
	let value = o.value;
	const btn = h('button', { class: 'bbk-item', role: 'switch', 'aria-checked': String(value) },
		h('span', { class: 'bbk-grow' }, label, o.hint ? h('small', {}, o.hint) : null), sw);
	btn.addEventListener('click', () => {
		value = !value;
		sw.classList.toggle('on', value);
		btn.setAttribute('aria-checked', String(value));
		o.onChange(value);
	});
	return btn;
}
export function toggleRow(label: string, value: boolean, onChange: (v: boolean) => void) {
	const sw = h('span', { class: 'bbk-switch' + (value ? ' on' : ''), role: 'switch', 'aria-checked': String(value) });
	sw.addEventListener('click', () => {
		value = !value;
		sw.classList.toggle('on', value);
		sw.setAttribute('aria-checked', String(value));
		onChange(value);
	});
	return row(label, sw);
}
export function textRow(label: string, value: string, onChange: (v: string) => void, type: 'text' | 'number' = 'text') {
	const input = h('input', { type, value });
	input.addEventListener('change', () => onChange(input.value));
	return row(label, input);
}
export function selectRow(label: string, options: { value: string; label: string; group?: string }[], value: string, onChange: (v: string) => void) {
	const sel = h('select', {});
	const groups = new Map<string, HTMLElement>();
	for (const o of options) {
		let parent: HTMLElement = sel;
		if (o.group) {
			if (!groups.has(o.group)) { const g = h('optgroup', { label: o.group }); groups.set(o.group, g); sel.append(g); }
			parent = groups.get(o.group)!;
		}
		parent.append(h('option', { value: o.value, selected: o.value === value }, o.label));
	}
	sel.value = value;
	sel.addEventListener('change', () => onChange(sel.value));
	return row(label, sel);
}
export function colorRow(label: string, hex: string, alpha: number, onChange: (hex: string, alpha: number) => void) {
	const color = h('input', { type: 'color', value: hex });
	const a = h('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(alpha * 100) });
	const fire = () => onChange(color.value, Number(a.value) / 100);
	color.addEventListener('input', fire);
	a.addEventListener('input', fire);
	return row(label, color, a);
}
export function chips<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void) {
	const wrap = h('div', { class: 'bbk-chips' });
	const draw = (v: T) => {
		wrap.replaceChildren(...options.map(o => {
			const c = h('button', { class: 'bbk-chip' + (o.value === v ? ' on' : '') }, o.label);
			c.addEventListener('click', () => { draw(o.value); onChange(o.value); });
			return c;
		}));
	};
	draw(value);
	return wrap;
}

// ------------------------------------------------------------------ toast / confirmação

let toastEl: HTMLElement | null = null;
let toastTimer: any;
export function toast(msg: string, ms = 2400) {
	if (!toastEl || !toastEl.isConnected) {
		toastEl = h('div', { id: 'bb-android-toast', class: UI_CLASS });
		document.body.appendChild(toastEl);
	}
	toastEl.textContent = msg;
	toastEl.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toastEl?.classList.remove('show'), ms);
}

export function confirmDialog(o: { title: string; message: string; confirmLabel?: string; danger?: boolean; cancelLabel?: string }): Promise<boolean> {
	return new Promise(resolve => {
		const done = (v: boolean) => { modal.remove(); resolve(v); };
		const modal = h('div', { class: 'bbk-modal ' + UI_CLASS },
			h('div', {},
				h('h3', {}, o.title), h('p', {}, o.message),
				h('div', { class: 'bbk-actions' },
					item(o.cancelLabel || 'Cancelar', () => done(false)),
					item(o.confirmLabel || 'OK', () => done(true), { kind: o.danger ? 'danger' : 'primary' }))));
		getRoot().appendChild(modal);
	});
}

export function promptDialog(o: { title: string; value?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
	return new Promise(resolve => {
		const input = h('input', { type: 'text', class: 'bbk-text', value: o.value || '', placeholder: o.placeholder || '' });
		const done = (v: string | null) => { modal.remove(); resolve(v); };
		const modal = h('div', { class: 'bbk-modal ' + UI_CLASS },
			h('div', {}, h('h3', {}, o.title), h('p', {}, input),
				h('div', { class: 'bbk-actions' },
					item('Cancelar', () => done(null)),
					item(o.confirmLabel || 'OK', () => done(input.value.trim() || null), { kind: 'primary' }))));
		getRoot().appendChild(modal);
		setTimeout(() => input.focus(), 50);
	});
}
