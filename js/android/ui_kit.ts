/** Kit de interface do fork Android: tudo em DOM puro, sem depender do Vue do Blockbench. */
import { UI_CLASS, uiScale } from './input_emulator';
export { uiScale };

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
#bb-android-root{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99990;font-family:var(--font-main,Roboto,system-ui,sans-serif);font-size:14px;color:var(--color-text,#e5e7eb);transform-origin:0 0;--fab-size:44px}
#bb-android-root *{box-sizing:border-box}
/* O Blockbench estiliza todo <button> (altura 32px, largura mín. 100px, sombra, :hover). Aqui tudo é zerado. */
#bb-android-root button{all:unset;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;-webkit-user-select:none}
#bb-android-root #bb-android-fab{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);width:var(--fab-size);height:var(--fab-size);border-radius:50%;
 display:flex;align-items:center;justify-content:center;border:1px solid var(--color-border,#3a4150);background:var(--color-ui,#1d222b);color:var(--color-text,#e5e7eb);
 font-size:calc(var(--fab-size) * .5);line-height:1;pointer-events:auto;touch-action:none;box-shadow:0 2px 8px rgba(0,0,0,.45)}
#bb-android-root #bb-android-fab:active{background:var(--color-selected,#2d3542)}
#bb-android-root #bb-android-fab.editing{border-color:var(--color-accent,#3e90ff);box-shadow:0 0 0 2px var(--color-accent,#3e90ff),0 2px 8px rgba(0,0,0,.45)}
#bb-android-root #bb-android-fab.dragging{opacity:1 !important;box-shadow:0 0 0 2px #ffd54f,0 4px 14px rgba(0,0,0,.6)}
#bb-android-root .bbk-layer{position:fixed;inset:0;pointer-events:none}
#bb-android-root .bbk-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);pointer-events:auto;opacity:0;transition:opacity .18s}
#bb-android-root .bbk-layer.open .bbk-scrim{opacity:1}
#bb-android-root .bbk-layer.closing,#bb-android-root .bbk-layer.closing *{pointer-events:none !important}
#bb-android-root .bbk-drawer{position:absolute;top:0;bottom:0;left:0;width:min(86vw,360px);max-width:100%;background:var(--color-back,#14181e);border-right:1px solid var(--color-border,#3a4150);
 display:flex;flex-direction:column;pointer-events:auto;transform:translateX(-102%);transition:transform .2s ease,filter .2s;box-shadow:4px 0 18px rgba(0,0,0,.5);padding-top:env(safe-area-inset-top,0px)}
#bb-android-root .bbk-drawer.wide{width:min(96vw,900px)}
#bb-android-root .bbk-layer.open .bbk-drawer{transform:none}
#bb-android-root .bbk-layer.behind .bbk-drawer{pointer-events:none;filter:brightness(.55)}
#bb-android-root .bbk-layer.behind .bbk-scrim{pointer-events:none}
#bb-android-root .bbk-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--color-border,#3a4150);flex:0 0 auto}
#bb-android-root .bbk-head h2{margin:0;font-size:16px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bb-android-root .bbk-icon{display:flex;align-items:center;justify-content:center;width:36px;height:36px;flex:0 0 36px;border-radius:8px;background:var(--color-button,#272d38);color:inherit;font-size:18px;line-height:1}
#bb-android-root .bbk-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:8px 10px 16px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
#bb-android-root .bbk-item{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:10px 12px;margin:0 0 6px;border-radius:8px;background:var(--color-button,#272d38);color:inherit;font-size:15px;text-align:left;line-height:1.25}
#bb-android-root .bbk-item:active{background:var(--color-selected,#344050)}
#bb-android-root .bbk-item small{display:block;opacity:.65;font-size:12px;margin-top:2px}
#bb-android-root .bbk-item .bbk-grow{flex:1;min-width:0}
#bb-android-root .bbk-item.danger{color:#ff8a80}
#bb-android-root .bbk-item.primary{background:var(--color-accent,#3e90ff);color:#fff}
#bb-android-root .bbk-sec{margin:14px 2px 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
#bb-android-root .bbk-row{display:flex;align-items:center;gap:10px;margin:0 0 8px;min-height:40px}
#bb-android-root .bbk-row>label{flex:0 0 38%;font-size:13px;opacity:.85}
#bb-android-root .bbk-row>.bbk-ctl{flex:1;min-width:0;display:flex;align-items:center;gap:8px}
#bb-android-root .bbk-row.profile{gap:6px}
#bb-android-root .bbk-row.profile .bbk-item{margin:0;flex:1;min-width:0}
#bb-android-root input[type=text],#bb-android-root input[type=number],#bb-android-root select,#bb-android-root textarea,#bb-android-root .bbk-text{display:block;width:100%;min-height:36px;padding:6px 8px;border-radius:6px;border:1px solid var(--color-border,#3a4150);background:var(--color-dark,#0e1116);color:inherit;font:inherit}
#bb-android-root input[type=range]{width:100%}
#bb-android-root input[type=color]{width:44px;height:32px;padding:0;border:1px solid var(--color-border,#3a4150);background:none;border-radius:6px}
#bb-android-root .bbk-val{min-width:44px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8;font-size:13px}
#bb-android-root .bbk-switch{position:relative;width:46px;height:26px;flex:0 0 46px;border-radius:13px;background:#4a5262;transition:background .15s;cursor:pointer}
#bb-android-root .bbk-switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .15s}
#bb-android-root .bbk-switch.on{background:var(--color-accent,#3e90ff)}
#bb-android-root .bbk-switch.on::after{transform:translateX(20px)}
#bb-android-root .bbk-hint{font-size:12px;opacity:.6;margin:-2px 2px 10px;line-height:1.35}
#bb-android-root .bbk-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
#bb-android-root .bbk-chip{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:16px;border:1px solid var(--color-border,#3a4150);background:var(--color-button,#272d38);color:inherit;font-size:13px;line-height:1}
#bb-android-root .bbk-chip.on{background:var(--color-accent,#3e90ff);border-color:transparent;color:#fff}
#bb-android-root .bbk-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);pointer-events:auto;z-index:99999}
#bb-android-root .bbk-modal>div{width:min(88vw,340px);background:var(--color-back,#14181e);border:1px solid var(--color-border,#3a4150);border-radius:12px;padding:16px}
#bb-android-root .bbk-modal h3{margin:0 0 8px;font-size:16px}
#bb-android-root .bbk-modal p{margin:0 0 14px;opacity:.85;line-height:1.35}
#bb-android-root .bbk-modal .bbk-actions{display:flex;gap:8px;justify-content:flex-end}
#bb-android-root .bbk-modal .bbk-actions .bbk-item{width:auto;margin:0;min-height:40px}
#bb-android-root .bbk-list{max-height:62vh;overflow-y:auto;margin:0 0 10px}
#bb-android-root .bbk-opt{display:block;width:100%;min-height:44px;padding:10px 12px;margin:0 0 4px;border-radius:8px;background:var(--color-button,#272d38);color:inherit;text-align:left;font-size:15px}
#bb-android-root .bbk-opt.on{background:var(--color-accent,#3e90ff);color:#fff}
/* ---------- teclado de envio ---------- */
#bb-android-root .bbk-tabs{display:flex;margin:0 0 8px;border-bottom:1px solid var(--color-border,#3a4150)}
#bb-android-root .bbk-tab{flex:1;padding:10px 0;text-align:center;font-size:15px;border-bottom:3px solid transparent;opacity:.7}
#bb-android-root .bbk-tab.on{border-bottom-color:var(--color-accent,#3e90ff);opacity:1}
#bb-android-root .bbk-kb-row{display:flex;gap:4px;margin:0 0 4px}
#bb-android-root .bbk-key{display:flex;align-items:center;justify-content:center;flex:1 1 0;min-width:0;height:42px;padding:0 2px;border-radius:8px;background:var(--color-button,#272d38);color:inherit;font-size:clamp(10px,1.7vw,15px);text-align:center;overflow:hidden;white-space:nowrap}
#bb-android-root .bbk-key.on{background:var(--color-accent,#3e90ff);color:#fff}
#bb-android-root .bbk-key.gap{visibility:hidden;pointer-events:none}
#bb-android-root .bbk-combo{min-height:34px;padding:6px 10px;margin:8px 0;border-radius:8px;background:var(--color-dark,#0e1116);font-variant-numeric:tabular-nums}
#bb-android-root .bbk-actions-row{display:flex;gap:8px;margin-top:8px}
#bb-android-root .bbk-actions-row .bbk-item{margin:0;justify-content:center;flex:1}
#bb-android-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);transform:translateX(-50%);max-width:88vw;padding:10px 16px;border-radius:20px;background:rgba(20,24,30,.95);border:1px solid var(--color-border,#3a4150);color:#fff;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:100100}
#bb-android-toast.show{opacity:1}
#bb-android-vmouse{position:fixed;left:0;top:0;z-index:100200;pointer-events:none;display:none;will-change:transform}
/* ---------- touchpad (mouse ativo) ---------- */
#bb-android-touchpad{position:fixed;inset:0;z-index:98000;display:none;touch-action:none;-webkit-user-select:none;user-select:none;background:transparent}
html.bb-mouse-active,html.bb-mouse-active body{touch-action:none}
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
.bbc .rz{position:absolute;right:0;bottom:0;width:24px;height:24px;background:linear-gradient(135deg,transparent 50%,#ffd54f 50%);display:none;touch-action:none}
.editing .bbc.selected .rz{display:block}
#bb-android-grid{position:absolute;inset:0;pointer-events:none;display:none}
.editing #bb-android-grid.on{display:block}
#bb-android-guides{position:absolute;inset:0;pointer-events:none}
#bb-android-guides div{position:absolute;background:#ffd54f;opacity:.9}
`;

export function injectStyle() {
	if (document.getElementById('bb-android-style')) return;
	const st = document.createElement('style');
	st.id = 'bb-android-style';
	st.textContent = CSS;
	document.head.appendChild(st);
}

// ------------------------------------------------------------------ isolamento de eventos

/** Toques/cliques nos controles e menus do app não devem chegar aos handlers globais do Blockbench (document). */
export function isolateEvents(el: HTMLElement) {
	for (const t of ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel'])
		el.addEventListener(t, e => e.stopPropagation(), { passive: true });
}

// ------------------------------------------------------------------ raiz (zoom no modo desktop)

let root: HTMLElement | null = null;
export function getRoot(): HTMLElement {
	if (root && root.isConnected) return root;
	root = h('div', { id: 'bb-android-root', class: UI_CLASS });
	document.body.appendChild(root);
	isolateEvents(root);
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
	/** evita abrir duas vezes o mesmo menu: se já existir, fecha o que está por cima dele */
	id?: string;
	title: string;
	side?: 'left' | 'right';
	/** painel largo (teclado de envio) */
	wide?: boolean;
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
	id?: string;
}

const stack: Drawer[] = [];
function refreshStack() {
	root?.classList.toggle('has-drawer', stack.length > 0);
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

/** Se já há um menu com esse id, traz ele para o topo (fechando o que está por cima) e devolve true. */
export function focusDrawer(id: string): boolean {
	const i = stack.findIndex(d => d.id === id);
	if (i < 0) return false;
	while (stack.length - 1 > i) stack[stack.length - 1].close();
	return true;
}

/** Fecha o menu com esse id (e os que estão por cima dele), se existir. */
export function closeDrawer(id: string) {
	const i = stack.findIndex(d => d.id === id);
	if (i < 0) return;
	while (stack.length > i) stack[stack.length - 1].close();
}

export function openDrawer(opts: DrawerOpts): Drawer {
	const side = opts.side || 'left';
	const modal = opts.modal !== false;
	const closeBtn = h('button', { class: 'bbk-icon', 'aria-label': 'Fechar' }, stack.length ? '‹' : '✕');
	const title = h('h2', {}, opts.title);
	const body = h('div', { class: 'bbk-body' });
	const panel = h('aside', { class: 'bbk-drawer ' + side + (opts.wide ? ' wide' : '') }, h('div', { class: 'bbk-head' }, closeBtn, title), body);
	const scrim = modal ? h('div', { class: 'bbk-scrim' }) : null;
	const layer = h('div', { class: 'bbk-layer' }, scrim, panel);
	layer.style.zIndex = String(20 + stack.length);
	if (!modal) layer.style.pointerEvents = 'none';
	getRoot().appendChild(layer);

	const drawer: Drawer = {
		el: layer, body, opts, id: opts.id,
		setTitle: t => { title.textContent = t; },
		close: () => {
			const i = stack.indexOf(drawer);
			if (i < 0) return;
			stack.splice(i, 1);
			layer.classList.remove('open');
			layer.classList.add('closing');
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

/** Lista de opções no lugar do popup nativo do <select>, que não abre com clique sintético. */
export function pickSelectOption(sel: HTMLSelectElement) {
	if (sel.multiple) return;
	const done = () => modal.remove();
	const list = h('div', { class: 'bbk-list' });
	for (const opt of Array.from(sel.options)) {
		const b = h('button', { class: 'bbk-opt' + (opt.selected ? ' on' : ''), disabled: opt.disabled }, opt.textContent || opt.value);
		b.addEventListener('click', () => {
			if (sel.value !== opt.value) {
				sel.value = opt.value;
				sel.dispatchEvent(new Event('input', { bubbles: true }));
				sel.dispatchEvent(new Event('change', { bubbles: true }));
			}
			done();
		});
		list.append(b);
	}
	const modal = h('div', { class: 'bbk-modal ' + UI_CLASS }, h('div', {}, list, h('div', { class: 'bbk-actions' }, item('Cancelar', done))));
	modal.addEventListener('click', e => { if (e.target === modal) done(); });
	getRoot().appendChild(modal);
}
