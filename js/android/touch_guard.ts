/**
 * Isola o HUD (controles na tela, ☰ e menus) do Blockbench:
 *  1. `event.touches` dos eventos do Blockbench não conta dedos que começaram em controles do app
 *     (o OrbitControls faz `touches.length == 2` = pinça: um dedo no botão + um na tela virava zoom/pan);
 *  2. toques no HUD não geram clique/mouse "de compatibilidade" no que estiver embaixo
 *     (acontecia quando o botão sumia ou mudava no meio do toque, ex.: GUI, drawers);
 *  3. modificadores segurados no HUD (Ctrl/Shift/Alt) valem para os toques/cliques reais no Blockbench
 *     (seleção múltipla de keyframes com Shift/Ctrl).
 */
import { isUi, currentMods } from './input_emulator';

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
	if ((e as any).bbSynthetic || isUi(e.target)) { return; }
	if (Date.now() - lastHud.t < SWALLOW_MS && Math.hypot(e.clientX - lastHud.x, e.clientY - lastHud.y) < SWALLOW_PX) {
		e.stopImmediatePropagation();
		if (e.cancelable) e.preventDefault();
		return;
	}
	applyModifiers(e);
}

let installed = false;
export function installTouchGuard() {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) window.addEventListener(t, onTouch as any, { capture: true, passive: true });
	for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) window.addEventListener(t, onMouseLike as any, true);
	for (const t of ['pointerdown', 'pointerup', 'pointermove', 'wheel']) window.addEventListener(t, applyModifiers as any, true);
}

/** Zera o estado (usado nos testes e ao desligar o app). */
export function resetTouchGuard() { uiTouches.clear(); lastHud = { x: -9999, y: -9999, t: 0 }; }
