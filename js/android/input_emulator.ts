/**
 * Emulação de entrada para o Blockbench dentro do WebView:
 *  - teclas (códigos GLFW do Pojav → KeyboardEvent do DOM, com modificadores)
 *  - mouse (botões, scroll, ponteiro virtual estilo trackpad)
 *  - teclado virtual do Android
 */
import { KEY_BY_GLFW, KEYS } from './keymap';

export const UI_CLASS = 'bb-android-ui';
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
};
let downAt: Record<string, { x: number; y: number; t: number }> = {};
let lastClick = { t: 0, x: 0, y: 0 };
let cursorEl: HTMLElement | null = null;

function pointTarget(): Element {
	const stack = document.elementsFromPoint ? document.elementsFromPoint(Mouse.x, Mouse.y) : [];
	for (const el of stack) if (!isUi(el)) return el;
	return document.body;
}

function fire(type: string, target: Element, button: number, extra: any = {}) {
	const init: any = {
		bubbles: true, cancelable: true, composed: true, view: window,
		clientX: Mouse.x, clientY: Mouse.y, screenX: Mouse.x, screenY: Mouse.y,
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
	cursorEl.style.transform = `translate(${Mouse.x}px, ${Mouse.y}px)`;
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

export function moveTo(x: number, y: number) {
	Mouse.x = Math.max(0, Math.min(window.innerWidth - 1, x));
	Mouse.y = Math.max(0, Math.min(window.innerHeight - 1, y));
	updateCursor();
	const t = pointTarget();
	fire('pointermove', t, -1);
	fire('mousemove', t, 0);
}
export function moveBy(dx: number, dy: number) { moveTo(Mouse.x + dx, Mouse.y + dy); }

export function mouseDown(btn: MouseBtn) {
	if (Mouse.buttons & BTN_MASK[btn]) return;
	const t = pointTarget();
	const active = document.activeElement as HTMLElement | null;
	if (active && active !== document.body && isEditable(active) && !active.contains(t)) active.blur();
	Mouse.buttons |= BTN_MASK[btn];
	downAt[btn] = { x: Mouse.x, y: Mouse.y, t: Date.now() };
	fire('pointerdown', t, BTN_INDEX[btn]);
	fire('mousedown', t, BTN_INDEX[btn]);
}
export function mouseUp(btn: MouseBtn) {
	if (!(Mouse.buttons & BTN_MASK[btn])) return;
	const t = pointTarget();
	Mouse.buttons &= ~BTN_MASK[btn];
	fire('pointerup', t, BTN_INDEX[btn]);
	fire('mouseup', t, BTN_INDEX[btn]);
	const d = downAt[btn];
	const still = d && Math.hypot(Mouse.x - d.x, Mouse.y - d.y) < 8;
	if (still) {
		if (btn === 'left') {
			fire('click', t, 0);
			const now = Date.now();
			if (now - lastClick.t < 350 && Math.hypot(Mouse.x - lastClick.x, Mouse.y - lastClick.y) < 12) {
				fire('dblclick', t, 0);
				lastClick = { t: 0, x: 0, y: 0 };
			} else lastClick = { t: now, x: Mouse.x, y: Mouse.y };
		} else if (btn === 'right') fire('contextmenu', t, 2);
		else fire('auxclick', t, 1);
	}
}
export function click(btn: MouseBtn = 'left') { mouseDown(btn); mouseUp(btn); }
export function wheel(deltaY: number) { fire('wheel', pointTarget(), 0, { deltaY, deltaX: 0, deltaMode: 0 }); }

export function setVirtualMouse(on: boolean) {
	Mouse.virtual = on;
	ensureCursor();
	updateCursor();
	document.dispatchEvent(new CustomEvent('bb-android-vmouse', { detail: on }));
}
export const toggleVirtualMouse = () => setVirtualMouse(!Mouse.virtual);

// ------------------------------------------------------------------ roteamento de toques (mouse virtual / botões do mouse segurados)

const blockedPointers = new Set<number>();
const blockedTouches = new Set<number>();
let track: { id: number; sx: number; sy: number; lx: number; ly: number; t0: number; moved: boolean } | null = null;

const intercepting = () => Mouse.virtual || Mouse.buttons !== 0;
const stop = (e: Event) => { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); };

function onPointer(e: PointerEvent) {
	if (e.pointerType === 'mouse') return;
	const id = e.pointerId;
	if (e.type === 'pointerdown') {
		if (isUi(e.target)) return;
		if (intercepting()) { blockedPointers.add(id); stop(e); }
		return;
	}
	if (blockedPointers.has(id)) {
		stop(e);
		if (e.type === 'pointerup' || e.type === 'pointercancel') blockedPointers.delete(id);
	}
}
function onTouch(e: TouchEvent) {
	if (e.type === 'touchstart') {
		const t = e.changedTouches[0];
		if (isUi(e.target)) return;
		if (!intercepting()) { if (t) { Mouse.x = t.clientX; Mouse.y = t.clientY; updateCursor(); } return; }
		for (const ch of Array.from(e.changedTouches)) blockedTouches.add(ch.identifier);
		stop(e);
		if (!track && t) {
			track = { id: t.identifier, sx: t.clientX, sy: t.clientY, lx: t.clientX, ly: t.clientY, t0: Date.now(), moved: false };
			if (!Mouse.virtual) moveTo(t.clientX, t.clientY);
		}
		return;
	}
	const mine = Array.from(e.changedTouches).filter(ch => blockedTouches.has(ch.identifier));
	if (!mine.length) return;
	stop(e);
	const t = track && mine.find(ch => ch.identifier === track!.id);
	if (e.type === 'touchmove' && t && track) {
		const dx = t.clientX - track.lx, dy = t.clientY - track.ly;
		track.lx = t.clientX; track.ly = t.clientY;
		if (Math.hypot(t.clientX - track.sx, t.clientY - track.sy) > 8) track.moved = true;
		if (Mouse.virtual) moveBy(dx * Mouse.sensitivity, dy * Mouse.sensitivity); else moveTo(t.clientX, t.clientY);
	} else if (e.type === 'touchend' || e.type === 'touchcancel') {
		if (t && track) {
			if (e.type === 'touchend' && Mouse.virtual && !track.moved && Date.now() - track.t0 < 260) click('left');
			track = null;
		}
		for (const ch of mine) blockedTouches.delete(ch.identifier);
	}
}

let routerInstalled = false;
export function installTouchRouter() {
	if (routerInstalled) return;
	routerInstalled = true;
	const opt = { capture: true, passive: false } as AddEventListenerOptions;
	for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(t, onPointer as any, opt);
	for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) window.addEventListener(t, onTouch as any, opt);
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
