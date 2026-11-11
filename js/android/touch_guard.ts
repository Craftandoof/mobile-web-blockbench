/**
 * Isola o HUD (controles na tela, ☰ e menus) do Blockbench:
 *  1. `event.touches` dos eventos do Blockbench não conta dedos que começaram em controles do app
 *     (o OrbitControls faz `touches.length == 2` = pinça: um dedo no botão + um na tela virava zoom/pan);
 *  2. toques no HUD não geram clique/mouse "de compatibilidade" no que estiver embaixo
 *     (acontecia quando o botão sumia ou mudava no meio do toque, ex.: GUI, drawers);
 *  3. modificadores segurados no HUD (Ctrl/Shift/Alt) valem para os toques/cliques reais no Blockbench
 *     (seleção múltipla de keyframes com Shift/Ctrl).
 */
import { isUi, currentMods, mouseActive } from './input_emulator';

const uiTouches = new Set<number>();
let lastHud = { x: -9999, y: -9999, t: 0 };
const SWALLOW_MS = 450, SWALLOW_PX = 56;

const listOf = (l: TouchList | undefined | null): Touch[] => (l ? Array.from(l) : []);

function withoutUi(list: TouchList): any {
	const arr: any = listOf(list).filter(t => !uiTouches.has(t.identifier));
	arr.item = (i: number) => arr[i] ?? null;
	return arr;
}

function onTouch(e: TouchEvent) {
	const ui = isUi(e.target);
	if (ui) {
		if (e.type === 'touchstart') for (const t of listOf(e.changedTouches)) uiTouches.add(t.identifier);
		if (e.type === 'touchend' || e.type === 'touchcancel') {
			for (const t of listOf(e.changedTouches)) uiTouches.delete(t.identifier);
			const t = listOf(e.changedTouches)[0];
			if (t) lastHud = { x: t.clientX, y: t.clientY, t: Date.now() };
		}
		return;
	}
	if (listOf(e.touches).length === 0) uiTouches.clear();
	if (uiTouches.size && e.touches) {
		try { Object.defineProperty(e, 'touches', { value: withoutUi(e.touches), configurable: true }); } catch { /* somente leitura */ }
	}
	applyModifiers(e);
}

const MODS: [keyof ReturnType<typeof currentMods>][] = [['ctrlKey'], ['shiftKey'], ['altKey'], ['metaKey']];
function applyModifiers(e: Event) {
	if ((e as any).bbSynthetic) return;
	const m = currentMods();
	for (const [k] of MODS) if (m[k] && !(e as any)[k]) { try { Object.defineProperty(e, k, { value: true, configurable: true }); } catch { /* ok */ } }
}

/** Eventos de mouse gerados pelo navegador logo depois de um toque no HUD não podem chegar ao Blockbench. */
function onMouseLike(e: MouseEvent) {
	if ((e as any).bbSynthetic) return;
	if (isUi(e.target)) {
		// mouse/click de compatibilidade nascido no touchpad: o navegador gera isso depois de um toque e, se
		// subisse, o Blockbench contaria como clique real por baixo do cursor virtual
		if (e.isTrusted && (e.target as Element)?.id === 'bb-android-touchpad') { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); }
		return;
	}
	// com o mouse ativo, nenhum toque NOVO do usuário pode chegar ao Blockbench (só o cursor virtual age)
	if (mouseActive() && e.isTrusted && (e as any).sourceCapabilities?.firesTouchEvents) {
		e.stopImmediatePropagation();
		if (e.cancelable) e.preventDefault();
		return;
	}
	if (Date.now() - lastHud.t < SWALLOW_MS && Math.hypot(e.clientX - lastHud.x, e.clientY - lastHud.y) < SWALLOW_PX) {
		e.stopImmediatePropagation();
		if (e.cancelable) e.preventDefault();
		return;
	}
	applyModifiers(e);
}

// Dedos que começaram com o mouse ativo e fora do HUD/touchpad (ex.: troca do ponteiro no meio do toque).
const blockedPointers = new Set<number>(), blockedTouches = new Set<number>();
function swallow(e: Event) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); }
function onPointerGate(e: PointerEvent) {
	if (!e.isTrusted || e.pointerType === 'mouse' || (e as any).bbSynthetic || isUi(e.target)) return;
	const id = e.pointerId;
	if (e.type === 'pointerdown') {
		if (mouseActive()) { blockedPointers.add(id); swallow(e); }
		return;
	}
	if (blockedPointers.has(id)) {
		swallow(e);
		if (e.type === 'pointerup' || e.type === 'pointercancel') blockedPointers.delete(id);
	}
}
function onTouchGate(e: TouchEvent) {
	if (!e.isTrusted || isUi(e.target)) return;
	if (e.type === 'touchstart' && mouseActive()) {
		for (const t of listOf(e.changedTouches)) blockedTouches.add(t.identifier);
		swallow(e);
		return;
	}
	const ids = listOf(e.changedTouches).map(t => t.identifier);
	if (ids.length && ids.every(i => blockedTouches.has(i))) {
		swallow(e);
		if (e.type === 'touchend' || e.type === 'touchcancel') ids.forEach(i => blockedTouches.delete(i));
	}
}

let installed = false;
export function installTouchGuard() {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	// o porteiro roda ANTES de tudo (registrado primeiro, em captura)
	for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(t, onPointerGate as any, true);
	for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) window.addEventListener(t, onTouchGate as any, { capture: true, passive: false });
	for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) window.addEventListener(t, onTouch as any, { capture: true, passive: true });
	for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) window.addEventListener(t, onMouseLike as any, true);
	for (const t of ['pointerdown', 'pointerup', 'pointermove', 'wheel']) window.addEventListener(t, applyModifiers as any, true);
}

/** Zera o estado (usado nos testes e ao desligar o app). */
export function resetTouchGuard() { blockedPointers.clear(); blockedTouches.clear(); uiTouches.clear(); lastHud = { x: -9999, y: -9999, t: 0 }; }
