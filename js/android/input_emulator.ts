/**
 * Emulação de entrada para o Blockbench dentro do WebView:
 *  - teclas (códigos GLFW do Pojav → KeyboardEvent do DOM, com modificadores)
 *  - mouse (botões, scroll, ponteiro virtual estilo trackpad)
 *  - teclado virtual do Android
 */
import { KEY_BY_GLFW, KEYS } from './keymap';

export const UI_CLASS = 'bb-android-ui';

/** CSS px por dp. 1 no normal; >1 quando o viewport é forçado a ser largo (modo desktop). */
export function uiScale(): number {
	const sw = (typeof screen !== 'undefined' && screen.width) || window.innerWidth;
	const u = window.innerWidth / sw;
	return u > 1.15 ? u : 1;
}
export const isUi = (t: any): boolean => !!(t && t.closest && t.closest('.' + UI_CLASS));

// ------------------------------------------------------------------ teclado

const held = new Map<number, number>();
const MOD = {
	ctrl: [341, 345], shift: [340, 344], alt: [342, 346], meta: [343, 347],
};
const isHeld = (codes: number[]) => codes.some(c => (held.get(c) || 0) > 0);
export function currentMods() {
	return { ctrlKey: isHeld(MOD.ctrl), shiftKey: isHeld(MOD.shift), altKey: isHeld(MOD.alt), metaKey: isHeld(MOD.meta) };
}

let lastFocus: HTMLElement | null = null;
if (typeof document !== 'undefined') {
	document.addEventListener('focusin', e => {
		const t = e.target as HTMLElement;
		if (t && t !== document.body && !isUi(t)) lastFocus = t;
	}, true);
}
/** Devolve o foco ao último campo do Blockbench (o menu do app rouba o foco ao ser tocado). */
export function refocusExternal() {
	const a = document.activeElement as HTMLElement | null;
	if ((!a || a === document.body || isUi(a)) && lastFocus && lastFocus.isConnected) {
		try { lastFocus.focus({ preventScroll: true }); } catch { /* ok */ }
	}
}
function keyTarget(): EventTarget {
	const a = document.activeElement as HTMLElement | null;
	if (a && a.id === 'bb-android-kb') return document.body;
	if (!a || a === document.body || isUi(a)) {
		refocusExternal();
		const b = document.activeElement as HTMLElement | null;
		return b && b !== document.body && !isUi(b) ? b : document.body;
	}
	return a;
}
function isEditable(el: any): boolean {
	if (!el) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'TEXTAREA') return true;
	if (tag === 'INPUT') return !/^(button|checkbox|radio|range|color|file|submit|reset|image)$/i.test(el.type);
	return false;
}

function makeKeyEvent(type: string, p: { key: string; code: string; keyCode: number }, extra: any = {}): KeyboardEvent {
	const ev = new KeyboardEvent(type, {
		key: p.key, code: p.code, bubbles: true, cancelable: true, composed: true, view: window,
		...currentMods(), ...extra,
	} as KeyboardEventInit);
	// Blockbench usa event.which / keyCode: o construtor nem sempre os aceita
	Object.defineProperty(ev, 'keyCode', { get: () => p.keyCode });
	Object.defineProperty(ev, 'which', { get: () => p.keyCode });
	return ev;
}

function insertForKey(info: { key: string; code: string }, target: any) {
	if (!isEditable(target) || target !== document.activeElement) return;
	const m = currentMods();
	if (m.ctrlKey || m.altKey || m.metaKey) return;
	try {
		if (info.key.length === 1) {
			let ch = info.key;
			if (m.shiftKey && /[a-z]/.test(ch)) ch = ch.toUpperCase();
			if (!document.execCommand('insertText', false, ch)) throw new Error('execCommand');
		} else if (info.key === 'Backspace') document.execCommand('delete');
		else if (info.key === 'Delete') document.execCommand('forwardDelete');
		else if (info.key === 'Enter' && (target.tagName === 'TEXTAREA' || target.isContentEditable)) document.execCommand('insertLineBreak');
	} catch {
		if (info.key.length === 1 && typeof target.setRangeText === 'function') {
			target.setRangeText(info.key, target.selectionStart ?? 0, target.selectionEnd ?? 0, 'end');
			target.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}
}

export function keyDown(glfw: number) {
	const info = KEY_BY_GLFW[glfw];
	if (!info) return;
	const n = (held.get(glfw) || 0) + 1;
	held.set(glfw, n);
	if (n > 1) return;
	const target = keyTarget();
	const ev = makeKeyEvent('keydown', info);
	target.dispatchEvent(ev);
	if (!ev.defaultPrevented) insertForKey(info, target);
}
export function keyUp(glfw: number) {
	const info = KEY_BY_GLFW[glfw];
	if (!info) return;
	const n = (held.get(glfw) || 0) - 1;
	if (n > 0) { held.set(glfw, n); return; }
	if (!held.has(glfw)) return;
	held.delete(glfw);
	keyTarget().dispatchEvent(makeKeyEvent('keyup', info));
}
export function tapKey(glfw: number) { keyDown(glfw); keyUp(glfw); }

export function releaseAllKeys() {
	for (const k of [...held.keys()]) { held.set(k, 1); keyUp(k); }
}

const BY_CHAR: Record<string, number> = {};
for (const k of KEYS) if (k.key.length === 1 && !(k.code in BY_CHAR) && !k.code.startsWith('Numpad')) BY_CHAR[k.key] = k.glfw;

/** Digita texto: usa eventos de tecla quando há tecla correspondente, senão insere direto. */
export function typeText(text: string) {
	for (const ch of Array.from(text)) {
		if (ch === '\n') { tapKey(257); continue; }
		if (ch === '\t') { tapKey(258); continue; }
		const lower = ch.toLowerCase();
		const glfw = BY_CHAR[lower];
		if (glfw !== undefined && lower.length === 1) {
			const upper = ch !== lower;
			if (upper) keyDown(340);
			tapKey(glfw);
			if (upper) keyUp(340);
		} else {
			const target = keyTarget() as any;
			const p = { key: ch, code: '', keyCode: 0 };
			const ev = makeKeyEvent('keydown', p);
			target.dispatchEvent(ev);
			if (!ev.defaultPrevented && isEditable(target) && target === document.activeElement) {
				try { document.execCommand('insertText', false, ch); } catch { /* sem suporte */ }
			}
			target.dispatchEvent(makeKeyEvent('keyup', p));
		}
	}
}

// ------------------------------------------------------------------ mouse

export type MouseBtn = 'left' | 'middle' | 'right';
const BTN_INDEX: Record<MouseBtn, number> = { left: 0, middle: 1, right: 2 };
const BTN_MASK: Record<MouseBtn, number> = { left: 1, right: 2, middle: 4 };

export const Mouse = {
	x: Math.round((typeof window !== 'undefined' ? window.innerWidth : 800) / 2),
	y: Math.round((typeof window !== 'undefined' ? window.innerHeight : 600) / 2),
	buttons: 0,
	virtual: false,
	sensitivity: 1.4,
	/** multiplicador do tamanho do cursor virtual (0.25 – 1.5) */
	size: 1,
};
let downAt: Record<string, { x: number; y: number; t: number }> = {};
let lastClick = { t: 0, x: 0, y: 0 };
let cursorEl: HTMLElement | null = null;

function pointTarget(): Element {
	const stack = document.elementsFromPoint ? document.elementsFromPoint(Mouse.x, Mouse.y) : [];
	for (const el of stack) if (!isUi(el)) return el;
	return document.body;
}

let moveDX = 0, moveDY = 0;
function fire(type: string, target: Element, button: number, extra: any = {}) {
	const init: any = {
		bubbles: true, cancelable: true, composed: true, view: window,
		clientX: Mouse.x, clientY: Mouse.y, screenX: Mouse.x, screenY: Mouse.y,
		movementX: moveDX, movementY: moveDY,
		button, buttons: Mouse.buttons, ...currentMods(), ...extra,
	};
	let ev: Event;
	if (type.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
		ev = new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: Mouse.buttons ? 0.5 : 0 });
	} else if (type === 'wheel' && typeof WheelEvent !== 'undefined') {
		ev = new WheelEvent(type, init);
	} else {
		ev = new MouseEvent(type.startsWith('pointer') ? 'mouse' + type.slice(7) : type, init);
	}
	target.dispatchEvent(ev);
	return ev;
}

function updateCursor() {
	if (!cursorEl) return;
	cursorEl.style.display = Mouse.virtual ? 'block' : 'none';
	cursorEl.style.transformOrigin = '0 0';
	cursorEl.style.transform = `translate(${Mouse.x}px, ${Mouse.y}px) scale(${Mouse.size * uiScale()})`;
}
export function setMouseSize(size: number) {
	Mouse.size = Math.max(0.25, Math.min(1.5, size));
	updateCursor();
}
function ensureCursor() {
	if (cursorEl || typeof document === 'undefined') return;
	cursorEl = document.createElement('div');
	cursorEl.id = 'bb-android-vmouse';
	cursorEl.className = UI_CLASS;
	cursorEl.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16 26.5 L11.5 17.5 L19.5 17.5 Z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/></svg>';
	document.body.appendChild(cursorEl);
	updateCursor();
}

let hoverEl: Element | null = null;
const HOVER_ATTR = 'data-bb-hover';
const chainOf = (el: Element | null) => { const a: Element[] = []; for (let n = el; n; n = n.parentElement) a.push(n); return a; };

/**
 * Dispara over/enter/out/leave como um mouse de verdade (os menus do Blockbench abrem por mouseenter/mouseover)
 * e marca a cadeia sob o cursor com data-bb-hover, que faz o papel do :hover real (ver instalarHoverShim).
 */
function updateHover(next: Element | null) {
	const prev = hoverEl;
	if (prev === next) return;
	hoverEl = next;
	const prevChain = chainOf(prev), nextChain = chainOf(next);
	if (prev) {
		fire('pointerout', prev, -1, { relatedTarget: next });
		fire('mouseout', prev, 0, { relatedTarget: next });
		for (const el of prevChain) if (!nextChain.includes(el)) {
			el.removeAttribute(HOVER_ATTR);
			fire('pointerleave', el, -1, { bubbles: false, relatedTarget: next });
			fire('mouseleave', el, 0, { bubbles: false, relatedTarget: next });
		}
	}
	if (next) {
		for (const el of nextChain) if (!el.hasAttribute(HOVER_ATTR)) el.setAttribute(HOVER_ATTR, '');
		fire('pointerover', next, -1, { relatedTarget: prev });
		fire('mouseover', next, 0, { relatedTarget: prev });
		for (const el of nextChain.slice().reverse()) if (!prevChain.includes(el)) {
			fire('pointerenter', el, -1, { bubbles: false, relatedTarget: prev });
			fire('mouseenter', el, 0, { bubbles: false, relatedTarget: prev });
		}
	}
}

// ---- :hover do mouse virtual
// Eventos sintéticos não atualizam o :hover real do navegador, e o Blockbench consulta :hover em vários pontos
// (menus e submenus, painel sob o mouse, outliner...). Com o mouse virtual ativo, qualquer seletor com ":hover"
// passa a significar "tem data-bb-hover", e as regras CSS de :hover são duplicadas para o mesmo atributo.
let hoverShimInstalled = false;
let hoverShimOn = false;
const rewriteHover = (sel: any) => (hoverShimOn && typeof sel === 'string' && sel.indexOf(':hover') >= 0) ? sel.replace(/:hover/g, '[' + HOVER_ATTR + ']') : sel;

function installHoverShim() {
	if (hoverShimInstalled || typeof Element === 'undefined') return;
	hoverShimInstalled = true;
	const patch = (proto: any, names: string[]) => {
		if (!proto) return;
		for (const name of names) {
			const orig = proto[name];
			if (typeof orig !== 'function') continue;
			proto[name] = function (this: any, sel: any, ...rest: any[]) { return orig.call(this, rewriteHover(sel), ...rest); };
		}
	};
	patch(Element.prototype, ['matches', 'webkitMatchesSelector', 'closest', 'querySelector', 'querySelectorAll']);
	patch(typeof Document !== 'undefined' ? Document.prototype : null, ['querySelector', 'querySelectorAll']);
	patch(typeof DocumentFragment !== 'undefined' ? DocumentFragment.prototype : null, ['querySelector', 'querySelectorAll']);
	// jQuery guardou o matches nativo ao carregar: $(el).is(':hover') não passa pelo protótipo
	const jq = (window as any).jQuery || (window as any).$;
	if (jq && jq.find && typeof jq.find.matchesSelector === 'function') {
		const orig = jq.find.matchesSelector;
		jq.find.matchesSelector = (elem: any, expr: any) => orig(elem, rewriteHover(expr));
	}
}

let hoverCssSheets = -1;
function syncHoverCss() {
	if (typeof document === 'undefined') return;
	const sheets = Array.from(document.styleSheets).filter(s => (s.ownerNode as any)?.id !== 'bb-android-hover-css');
	if (sheets.length === hoverCssSheets) return;
	hoverCssSheets = sheets.length;
	const out: string[] = [];
	const visit = (rules: any, wrap: (css: string) => string) => {
		for (const r of Array.from(rules || []) as any[]) {
			if (typeof r.selectorText === 'string') {
				if (r.selectorText.includes(':hover')) out.push(wrap(r.selectorText.replace(/:hover/g, '[' + HOVER_ATTR + ']') + '{' + r.style.cssText + '}'));
			} else if (r.media && r.cssRules) visit(r.cssRules, css => wrap('@media ' + r.media.mediaText + '{' + css + '}'));
		}
	};
	for (const sheet of sheets) { try { visit((sheet as CSSStyleSheet).cssRules, css => css); } catch { /* folha de outra origem */ } }
	let style = document.getElementById('bb-android-hover-css') as HTMLStyleElement | null;
	if (!style) { style = document.createElement('style'); style.id = 'bb-android-hover-css'; document.head.appendChild(style); }
	style.textContent = out.join('\n');
}

export function moveTo(x: number, y: number) {
	const nx = Math.max(0, Math.min(window.innerWidth - 1, x)), ny = Math.max(0, Math.min(window.innerHeight - 1, y));
	moveDX = nx - Mouse.x; moveDY = ny - Mouse.y;
	Mouse.x = nx; Mouse.y = ny;
	updateCursor();
	const t = pointTarget();
	updateHover(t);
	fire('pointermove', t, -1);
	fire('mousemove', t, 0);
	if (rangeDrag) setRangeFromPointer(rangeDrag);
	moveDX = moveDY = 0;
}
export function moveBy(dx: number, dy: number) { moveTo(Mouse.x + dx, Mouse.y + dy); }

const FOCUSABLE = 'input,textarea,select,button,a[href],[tabindex],[contenteditable=""],[contenteditable="true"]';
let rangeDrag: HTMLInputElement | null = null;

function setRangeFromPointer(el: HTMLInputElement) {
	const r = el.getBoundingClientRect();
	if (!r.width) return;
	const min = Number(el.min || 0), max = Number(el.max || 100), step = Number(el.step || 1) || 1;
	let v = min + Math.max(0, Math.min(1, (Mouse.x - r.left) / r.width)) * (max - min);
	v = Math.round((v - min) / step) * step + min;
	const next = String(Math.max(min, Math.min(max, v)));
	if (el.value !== next) {
		el.value = next;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}
}

export function mouseDown(btn: MouseBtn) {
	if (Mouse.buttons & BTN_MASK[btn]) return;
	const t = pointTarget();
	updateHover(t);
	Mouse.buttons |= BTN_MASK[btn];
	syncTouchpad();
	downAt[btn] = { x: Mouse.x, y: Mouse.y, t: Date.now() };
	fire('pointerdown', t, BTN_INDEX[btn]);
	const md = fire('mousedown', t, BTN_INDEX[btn]);
	// o mousedown sintético não move o foco nem arrasta controles nativos: faz isso à mão
	if (btn === 'left' && !md.defaultPrevented) {
		const f = (t.closest && t.closest(FOCUSABLE)) as HTMLElement | null;
		const active = document.activeElement as HTMLElement | null;
		if (f && f !== active) { try { f.focus({ preventScroll: true }); } catch { /* ok */ } }
		else if (!f && active && active !== document.body && isEditable(active)) active.blur();
		if (f && f.tagName === 'INPUT' && (f as HTMLInputElement).type === 'range') { rangeDrag = f as HTMLInputElement; setRangeFromPointer(rangeDrag); }
	}
}
export function mouseUp(btn: MouseBtn) {
	if (!(Mouse.buttons & BTN_MASK[btn])) return;
	const t = pointTarget();
	Mouse.buttons &= ~BTN_MASK[btn];
	fire('pointerup', t, BTN_INDEX[btn]);
	fire('mouseup', t, BTN_INDEX[btn]);
	if (btn === 'left' && rangeDrag) { rangeDrag.dispatchEvent(new Event('change', { bubbles: true })); rangeDrag = null; }
	const d = downAt[btn];
	const still = d && Math.hypot(Mouse.x - d.x, Mouse.y - d.y) < 8;
	if (still) {
		if (btn === 'left') {
			const now = Date.now();
			const dbl = now - lastClick.t < 350 && Math.hypot(Mouse.x - lastClick.x, Mouse.y - lastClick.y) < 12;
			const ck = fire('click', t, 0, { detail: dbl ? 2 : 1 });
			const sel = t.closest && t.closest('select') as HTMLSelectElement | null;
			if (sel && !sel.disabled && !ck.defaultPrevented) document.dispatchEvent(new CustomEvent('bb-android-select', { detail: sel }));
			if (dbl) { fire('dblclick', t, 0, { detail: 2 }); lastClick = { t: 0, x: 0, y: 0 }; }
			else lastClick = { t: now, x: Mouse.x, y: Mouse.y };
		} else if (btn === 'right') fire('contextmenu', t, 2);
		else fire('auxclick', t, 1);
	}
	syncTouchpad();
}
export function click(btn: MouseBtn = 'left') { mouseDown(btn); mouseUp(btn); }
function canScroll(el: Element, dy: number, dx: number): boolean {
	const cs = getComputedStyle(el);
	const oy = /(auto|scroll|overlay)/.test(cs.overflowY), ox = /(auto|scroll|overlay)/.test(cs.overflowX);
	if (dy && oy && el.scrollHeight > el.clientHeight + 1) {
		if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
	}
	if (dx && ox && el.scrollWidth > el.clientWidth + 1) {
		if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
	}
	return false;
}

/** Roda o scroll: dispara o evento wheel (apps que tratam a roda) e, se ninguém tratou, rola o container (o wheel sintético não rola sozinho). */
export function wheel(deltaY: number, deltaX = 0) {
	const t = pointTarget();
	if (currentMods().shiftKey && !deltaX) { deltaX = deltaY; deltaY = 0; }
	const ev = fire('wheel', t, 0, { deltaY, deltaX, deltaMode: 0 });
	if (ev.defaultPrevented) return;
	for (let el: Element | null = t; el; el = el.parentElement) {
		if (canScroll(el, deltaY, deltaX)) { el.scrollTop += deltaY; el.scrollLeft += deltaX; return; }
	}
}

export function setVirtualMouse(on: boolean) {
	Mouse.virtual = on;
	syncTouchpad();
	ensureCursor();
	updateCursor();
	document.dispatchEvent(new CustomEvent('bb-android-vmouse', { detail: on }));
}
export const toggleVirtualMouse = () => setVirtualMouse(!Mouse.virtual);

// ------------------------------------------------------------------ touchpad (como o Pojav)
// Com o mouse ativo (cursor virtual ligado, ou algum botão do mouse apertado) uma camada cobre o app, abaixo dos
// controles e dos menus: os dedos NUNCA chegam ao Blockbench; servem só para mover o cursor, tocar (clique) e rolar.
// Isso evita o clique real duplicado, o :hover real e o zoom de pinça do Android.

let padEl: HTMLElement | null = null;
const pads = new Map<number, { x: number; y: number; sx: number; sy: number; t0: number; moved: boolean }>();
let padScrollY: number | null = null;

export const mouseActive = () => Mouse.virtual || Mouse.buttons !== 0;

export function syncTouchpad() {
	const on = mouseActive();
	hoverShimOn = on;
	if (padEl) padEl.style.display = on ? 'block' : 'none';
	if (typeof document !== 'undefined') document.documentElement.classList.toggle('bb-mouse-active', on);
	if (on) syncHoverCss();
	else { pads.clear(); padScrollY = null; updateHover(null); }
}

function padPointer(e: PointerEvent) { e.preventDefault(); e.stopPropagation(); }

function onPadDown(e: PointerEvent) {
	if (e.pointerType === 'mouse') return;       // mouse físico: deixa passar
	padPointer(e);
	try { padEl!.setPointerCapture(e.pointerId); } catch { /* ok */ }
	pads.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: Date.now(), moved: false });
	if (pads.size === 1 && !Mouse.virtual) moveTo(e.clientX, e.clientY);   // sem cursor virtual: posição absoluta
	if (pads.size >= 2) { for (const p of pads.values()) p.moved = true; padScrollY = null; }
}
function onPadMove(e: PointerEvent) {
	const p = pads.get(e.pointerId);
	if (!p) return;
	padPointer(e);
	const dx = e.clientX - p.x, dy = e.clientY - p.y;
	p.x = e.clientX; p.y = e.clientY;
	if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) p.moved = true;
	if (pads.size >= 2) {
		// dois dedos = rolagem
		const ys = Array.from(pads.values()).slice(0, 2).map(q => q.y);
		const avg = (ys[0] + ys[1]) / 2;
		if (padScrollY !== null) wheel(padScrollY - avg);
		padScrollY = avg;
		return;
	}
	if (Mouse.virtual) moveBy(dx * Mouse.sensitivity, dy * Mouse.sensitivity); else moveTo(e.clientX, e.clientY);
}
function onPadEnd(e: PointerEvent) {
	const p = pads.get(e.pointerId);
	if (!p) return;
	padPointer(e);
	const lone = pads.size === 1;
	pads.delete(e.pointerId);
	if (pads.size < 2) padScrollY = null;
	// toque curto, sem arrastar, com o cursor virtual = clique esquerdo (como no Pojav)
	if (lone && e.type === 'pointerup' && Mouse.virtual && !p.moved && Date.now() - p.t0 < 260) click('left');
}

let touchpadInstalled = false;
export function installTouchpad() {
	if (touchpadInstalled || typeof document === 'undefined') return;
	touchpadInstalled = true;
	installHoverShim();
	padEl = document.createElement('div');
	padEl.id = 'bb-android-touchpad';
	padEl.className = UI_CLASS;
	document.body.appendChild(padEl);
	padEl.addEventListener('pointerdown', onPadDown);
	padEl.addEventListener('pointermove', onPadMove);
	padEl.addEventListener('pointerup', onPadEnd);
	padEl.addEventListener('pointercancel', onPadEnd);
	for (const t of ['touchstart', 'touchmove', 'touchend', 'contextmenu']) padEl.addEventListener(t, e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); }, { passive: false });
	syncTouchpad();
}

// ------------------------------------------------------------------ teclado virtual do Android

const SENT = '\u200b';
let kbEl: HTMLInputElement | null = null;
function ensureKb(): HTMLInputElement {
	if (kbEl) return kbEl;
	const el = document.createElement('input');
	el.id = 'bb-android-kb';
	el.className = UI_CLASS;
	el.type = 'text';
	el.autocomplete = 'off';
	el.setAttribute('autocapitalize', 'off');
	el.setAttribute('autocorrect', 'off');
	el.spellcheck = false;
	el.value = SENT;
	el.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;border:0;padding:0;z-index:-1';
	el.addEventListener('input', () => {
		const v = el.value;
		if (v.length < SENT.length) tapKey(259);
		else if (v.length > SENT.length) typeText(v.replace(SENT, ''));
		el.value = SENT;
		try { el.setSelectionRange(1, 1); } catch { /* ok */ }
	});
	el.addEventListener('keydown', e => {
		if (e.key === 'Enter') { e.preventDefault(); tapKey(257); }
	});
	document.body.appendChild(el);
	kbEl = el;
	return el;
}
export function toggleSoftKeyboard() {
	const el = ensureKb();
	if (document.activeElement === el) el.blur(); else el.focus();
}
