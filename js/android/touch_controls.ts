/**
 * Controles na tela no estilo PojavLauncher (botões, drawers, joystick, mouse virtual),
 * lendo/gravando o mesmo JSON do Pojav. Cada perfil = um arquivo de controles.
 */
import {
	ControlData, DrawerData, JoystickData, Layout, SPECIAL, Orientation,
	newControl, newDrawer, newJoystick, newLayout, specialButton, cloneControl, cloneLayout,
	argbToCss, evalDynamic, parseLayout, serializeLayout, LAYOUT_VERSION,
} from './pojav_format';
import * as Input from './input_emulator';
import { UI_CLASS } from './input_emulator';
import { h, Store, uiScale, toast } from './ui_kit';

export type Kind = 'button' | 'drawer' | 'sub' | 'joystick';

export interface Item {
	kind: Kind;
	data: ControlData;
	drawer?: DrawerData;      // kind === 'drawer'
	owner?: Item;             // kind === 'sub' → item do drawer
	el: HTMLElement;
	rect: { x: number; y: number; w: number; h: number };  // CSS px
	toggled: boolean;
	pressed: boolean;
	open: boolean;            // drawer: sub-botões visíveis
	subs: Item[];
}

const PREF_BUTTON_SIZE = 100;
const MARGIN_DP = 2;

// ------------------------------------------------------------------ layout padrão (modelo Blockbench)

export function defaultLayout(): Layout {
	const L = newLayout();
	const key = (name: string, keys: number[], x: string, y: string, extra: Partial<ControlData> = {}) =>
		L.mControlDataList.push(newControl({ name, keycodes: keys, dynamicX: x, dynamicY: y, ...extra }));
	const bottom = '${bottom} - ${margin}';
	key('Ctrl', [341], '${margin}', bottom, { isToggle: true });
	key('Shift', [340], '${margin} * 2 + ${width}', bottom, { isToggle: true });
	key('Alt', [342], '${margin} * 3 + ${width} * 2', bottom, { isToggle: true });
	key('Undo', [341, 90], '${right} - ${margin} - ${width}', bottom);
	key('Redo', [341, 89], '${right}', bottom);
	key('Del', [261], '${right}', '${bottom} - ${margin} * 2 - ${height}');
	L.mControlDataList.push(specialButton(SPECIAL.MOUSEPRI, '${margin}', '${screen_height} * 0.5 - ${height} - ${margin}'));
	L.mControlDataList.push(specialButton(SPECIAL.MOUSESEC, '${margin}', '${screen_height} * 0.5 + ${margin}'));
	L.mControlDataList.push(specialButton(SPECIAL.MOUSEMID, '${margin}', '${screen_height} * 0.5 + ${height} + ${margin} * 3'));
	L.mControlDataList.push(specialButton(SPECIAL.SCROLLUP, '${right}', '${screen_height} * 0.5 - ${height} - ${margin}'));
	L.mControlDataList.push(specialButton(SPECIAL.SCROLLDOWN, '${right}', '${screen_height} * 0.5 + ${margin}'));
	L.mControlDataList.push(specialButton(SPECIAL.KEYBOARD, '${margin}', '${margin}'));
	L.mControlDataList.push(specialButton(SPECIAL.TOGGLECTRL, '${margin} * 2 + 80', '${margin}', ));
	L.mControlDataList.push(specialButton(SPECIAL.VIRTUALMOUSE, '${right}', '${margin}'));
	const d = newDrawer({ name: 'Editar', dynamicX: '${screen_width} * 0.5 - ${width} / 2', dynamicY: '${bottom} - ${margin}' });
	d.orientation = 'UP';
	const sub = (name: string, keys: number[]) => d.buttonProperties.push(newControl({ name, keycodes: keys }));
	sub('Copiar', [341, 67]); sub('Colar', [341, 86]); sub('Tudo', [341, 65]); sub('Salvar', [341, 83]);
	L.mDrawerDataList.push(d);
	return L;
}

// ------------------------------------------------------------------ perfis (persistência)

interface ProfileRec { name: string; layout: Layout }
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const state = {
	profiles: {} as Record<string, ProfileRec>,
	active: null as string | null,
	layout: null as Layout | null,
	items: [] as Item[],
	root: null as HTMLElement | null,
	editing: false,
	visible: true,
	selected: null as Item | null,
	listeners: new Set<() => void>(),
	onMenu: null as null | (() => void),
	started: false,
};

const emit = () => state.listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });

function loadStore() {
	state.profiles = Store.get<Record<string, ProfileRec>>('touch_profiles', {});
	state.active = Store.get<string | null>('touch_active', null);
	if (state.active && !state.profiles[state.active]) state.active = null;
}
function saveStore() {
	Store.set('touch_profiles', state.profiles);
	Store.set('touch_active', state.active);
}

// ------------------------------------------------------------------ métricas / posições

function metrics() {
	const U = uiScale();
	const dpr = window.devicePixelRatio || 1;
	const pxPerCss = dpr / U;
	return { U, dpr, pxPerCss, sw: window.innerWidth * pxPerCss, sh: window.innerHeight * pxPerCss };
}
const scaleFactor = () => PREF_BUTTON_SIZE / ((state.layout?.scaledAt) || 100);

function sizeCss(d: ControlData) {
	const { U } = metrics();
	const f = scaleFactor();
	return { w: d.width * f * U, h: d.height * f * U };
}
function evalPos(expr: string, d: ControlData): number {
	const m = metrics();
	const { w, h: hh } = sizeCss(d);
	const wPx = w * m.pxPerCss, hPx = hh * m.pxPerCss;
	try {
		const px = evalDynamic(expr, {
			top: 0, left: 0, right: m.sw - wPx, bottom: m.sh - hPx, width: wPx, height: hPx,
			screen_width: m.sw, screen_height: m.sh, margin: MARGIN_DP * m.dpr, preferred_scale: PREF_BUTTON_SIZE,
		}, m.dpr);
		return px / m.pxPerCss;
	} catch (e) {
		console.warn('Expressão de posição inválida:', expr, e);
		return 0;
	}
}
export function generateDynamicX(xCss: number, d: ControlData): string {
	const m = metrics();
	const x = xCss * m.pxPerCss, w = sizeCss(d).w * m.pxPerCss;
	return x + w / 2 > m.sw / 2 ? `${(x + w) / m.sw} * \${screen_width} - \${width}` : `${x / m.sw} * \${screen_width}`;
}
export function generateDynamicY(yCss: number, d: ControlData): string {
	const m = metrics();
	const y = yCss * m.pxPerCss, hh = sizeCss(d).h * m.pxPerCss;
	return y + hh / 2 > m.sh / 2 ? `${(y + hh) / m.sh} * \${screen_height} - \${height}` : `${y / m.sh} * \${screen_height}`;
}

const isHideable = (d: ControlData) => !d.keycodes.includes(SPECIAL.TOGGLECTRL) && !d.keycodes.includes(SPECIAL.VIRTUALMOUSE);

function applyStyle(it: Item) {
	const d = it.data;
	const { U } = metrics();
	const { w, h: hh } = sizeCss(d);
	const s = it.el.style;
	it.rect.w = w; it.rect.h = hh;
	s.width = w + 'px'; s.height = hh + 'px';
	s.left = it.rect.x + 'px'; s.top = it.rect.y + 'px';
	s.background = argbToCss(d.bgColor);
	s.border = `${d.strokeWidth * U}px solid ${argbToCss(d.strokeColor)}`;
	s.borderRadius = it.kind === 'joystick' ? '50%' : `${(Math.min(w, hh) / 2) * (d.cornerRadius / 100)}px`;
	s.opacity = String(d.opacity);
	s.fontSize = 14 * U + 'px';
	if (it.kind !== 'joystick') {
		it.el.firstChild && it.el.firstChild.nodeType === 3 ? (it.el.firstChild.textContent = d.name) : it.el.prepend(document.createTextNode(d.name));
	}
	it.el.classList.toggle('toggled', it.toggled && d.isToggle);
	it.el.classList.toggle('active', it.pressed && !d.isToggle);
}

function placeAll() {
	const margin = MARGIN_DP * metrics().U;
	for (const it of state.items) {
		if (it.kind === 'sub' && it.owner && it.owner.drawer!.orientation !== 'FREE') continue; // posicionado pelo drawer
		it.rect.x = evalPos(it.data.dynamicX, it.data);
		it.rect.y = evalPos(it.data.dynamicY, it.data);
	}
	for (const it of state.items) {
		if (it.kind !== 'drawer') continue;
		const o: Orientation = it.drawer!.orientation;
		const { w, h: hh } = sizeCss(it.data);
		it.subs.forEach((sub, i) => {
			if (o === 'FREE') return;
			sub.data.width = it.data.width; sub.data.height = it.data.height;
			const n = i + 1;
			sub.rect.x = o === 'RIGHT' ? it.rect.x + (w + margin) * n : o === 'LEFT' ? it.rect.x - (w + margin) * n : it.rect.x;
			sub.rect.y = o === 'DOWN' ? it.rect.y + (hh + margin) * n : o === 'UP' ? it.rect.y - (hh + margin) * n : it.rect.y;
		});
	}
	for (const it of state.items) { applyStyle(it); applyVisibility(it); }
}

function applyVisibility(it: Item) {
	let show = it.data.displayInMenu;
	if (!state.editing) {
		if (!state.visible && isHideable(it.data)) show = false;
		if (it.kind === 'sub' && it.owner && !it.owner.open) show = false;
		if (it.kind === 'sub' && it.owner && !state.visible) show = false;
	} else show = true;
	it.el.classList.toggle('hidden', !show);
	it.el.classList.toggle('selected', state.selected === it);
}

// ------------------------------------------------------------------ montagem dos itens

function makeItem(kind: Kind, data: ControlData, extra: Partial<Item> = {}): Item {
	const el = h('div', { class: 'bbc ' + UI_CLASS + (kind === 'joystick' ? ' joy' : '') });
	const it: Item = { kind, data, el, rect: { x: 0, y: 0, w: 0, h: 0 }, toggled: false, pressed: false, open: false, subs: [], ...extra };
	if (kind === 'joystick') el.append(h('div', { class: 'knob' }));
	el.append(h('div', { class: 'rz' }));
	bind(it);
	return it;
}

function build() {
	const L = state.layout!;
	state.items = [];
	state.root!.replaceChildren();
	for (const d of L.mControlDataList) state.items.push(makeItem('button', d));
	for (const j of L.mJoystickDataList) state.items.push(makeItem('joystick', j));
	for (const dr of L.mDrawerDataList) {
		const di = makeItem('drawer', dr.properties, { drawer: dr });
		di.open = state.editing;
		state.items.push(di);
		for (const b of dr.buttonProperties) {
			const si = makeItem('sub', b, { owner: di });
			di.subs.push(si);
			state.items.push(si);
		}
	}
	for (const it of state.items) state.root!.append(it.el);
	placeAll();
	if (state.selected && !state.items.some(i => i.data === state.selected!.data)) state.selected = null;
	else if (state.selected) state.selected = state.items.find(i => i.data === state.selected!.data) || null;
}

// ------------------------------------------------------------------ pressionar / soltar

function special(code: number, down: boolean) {
	switch (code) {
		case SPECIAL.KEYBOARD: if (down) Input.toggleSoftKeyboard(); break;
		case SPECIAL.TOGGLECTRL: if (down) Controls.toggleVisible(); break;
		case SPECIAL.VIRTUALMOUSE: if (down) Input.toggleVirtualMouse(); break;
		case SPECIAL.MOUSEPRI: down ? Input.mouseDown('left') : Input.mouseUp('left'); break;
		case SPECIAL.MOUSEMID: down ? Input.mouseDown('middle') : Input.mouseUp('middle'); break;
		case SPECIAL.MOUSESEC: down ? Input.mouseDown('right') : Input.mouseUp('right'); break;
		case SPECIAL.SCROLLUP: if (!down) Input.wheel(-100); break;
		case SPECIAL.SCROLLDOWN: if (!down) Input.wheel(100); break;
		case SPECIAL.MENU: if (down) state.onMenu?.(); break;
	}
}
function sendKeys(it: Item, down: boolean) {
	it.pressed = down;
	it.el.classList.toggle('active', down && !it.data.isToggle);
	for (const k of it.data.keycodes) {
		if (k > 0) down ? Input.keyDown(k) : Input.keyUp(k);
		else if (k < 0) special(k, down);
	}
}
function flipToggle(it: Item): boolean {
	if (!it.data.isToggle) return false;
	it.toggled = !it.toggled;
	it.el.classList.toggle('toggled', it.toggled);
	sendKeys(it, it.toggled);
	return true;
}

const active = new Map<number, { item: Item; out: boolean }>();

function itemAt(x: number, y: number): Item | null {
	for (let i = state.items.length - 1; i >= 0; i--) {
		const it = state.items[i];
		if (it.el.classList.contains('hidden') || it.kind === 'joystick') continue;
		const r = it.rect;
		if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return it;
	}
	return null;
}

// ------------------------------------------------------------------ joystick

const JOY_DEFAULT = [87, 65, 83, 68]; // W A S D (GLFW), igual ao Pojav
const joy = new Map<Item, { pid: number; ox: number; oy: number; keys: Set<number>; locked: boolean; top: boolean }>();

function joyKeys(it: Item): number[] {
	return [0, 1, 2, 3].map(i => it.data.keycodes[i] > 0 ? it.data.keycodes[i] : JOY_DEFAULT[i]);
}
function joyApply(it: Item, want: Set<number>, st: { keys: Set<number> }) {
	for (const k of st.keys) if (!want.has(k)) Input.keyUp(k);
	for (const k of want) if (!st.keys.has(k)) Input.keyDown(k);
	st.keys = want;
}
function joyUpdate(it: Item, st: NonNullable<ReturnType<typeof joy.get>>, cx: number, cy: number) {
	const r = it.rect.w / 2;
	let dx = cx - st.ox, dy = cy - st.oy;
	const mag = Math.hypot(dx, dy);
	if (mag > r) { dx = dx / mag * r; dy = dy / mag * r; }
	const knob = it.el.querySelector('.knob') as HTMLElement;
	const kw = it.rect.w * 0.42;
	knob.style.left = (it.rect.w / 2 - kw / 2 + dx) + 'px';
	knob.style.top = (it.rect.h / 2 - kw / 2 + dy) + 'px';
	const nx = dx / r, ny = dy / r;
	const [up, left, down, right] = joyKeys(it);
	const want = new Set<number>();
	if (Math.hypot(nx, ny) > 0.25) {
		if (ny < -0.38) want.add(up);
		if (ny > 0.38) want.add(down);
		if (nx < -0.38) want.add(left);
		if (nx > 0.38) want.add(right);
	}
	st.top = (it.data as JoystickData).forwardLock && Math.hypot(nx, ny) > 0.9 && ny < -0.7;
	if (st.top) want.add(341); // Ctrl = correr, como o forward lock do Pojav
	joyApply(it, want, st);
}
function joyReset(it: Item) {
	const knob = it.el.querySelector('.knob') as HTMLElement;
	knob.style.left = (it.rect.w / 2 - it.rect.w * 0.21) + 'px';
	knob.style.top = (it.rect.h / 2 - it.rect.w * 0.21) + 'px';
}

// ------------------------------------------------------------------ eventos dos elementos

function bind(it: Item) {
	const el = it.el;
	const rz = el.querySelector('.rz') as HTMLElement;

	// ---- modo de edição: selecionar / arrastar / redimensionar
	let drag: null | { pid: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } = null;
	let rsz: null | { pid: number; sx: number; sy: number; w: number; h: number } = null;

	rz.addEventListener('pointerdown', e => {
		if (!state.editing) return;
		e.stopPropagation(); e.preventDefault();
		rz.setPointerCapture?.(e.pointerId);
		const { w, h: hh } = sizeCss(it.data);
		rsz = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, w, h: hh };
	});
	rz.addEventListener('pointermove', e => {
		if (!rsz || e.pointerId !== rsz.pid) return;
		const { U } = metrics();
		const f = scaleFactor();
		const nw = Math.max(20, rsz.w + (e.clientX - rsz.sx)), nh = Math.max(20, rsz.h + (e.clientY - rsz.sy));
		it.data.width = Math.round(nw / U / f);
		it.data.height = it.kind === 'joystick' ? it.data.width : Math.round(nh / U / f);
		placeAll();
	});
	const rzEnd = (e: PointerEvent) => {
		if (!rsz || e.pointerId !== rsz.pid) return;
		rsz = null;
		keepPosition(it);
		Controls.persist(); emit();
	};
	rz.addEventListener('pointerup', rzEnd);
	rz.addEventListener('pointercancel', rzEnd);

	el.addEventListener('pointerdown', e => {
		if (state.editing) {
			e.preventDefault();
			el.setPointerCapture?.(e.pointerId);
			Controls.select(it);
			drag = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: it.rect.x, oy: it.rect.y, moved: false };
			return;
		}
		e.preventDefault();
		el.setPointerCapture?.(e.pointerId);
		const pid = e.pointerId;
		if (it.kind === 'joystick') {
			const prev = joy.get(it);
			if (prev) { joyApply(it, new Set(), prev); el.classList.remove('locked'); joy.delete(it); }
			const o = (it.data as JoystickData).absolute ? { x: e.clientX, y: e.clientY } : { x: it.rect.x + it.rect.w / 2, y: it.rect.y + it.rect.h / 2 };
			const st = { pid, ox: o.x, oy: o.y, keys: new Set<number>(), locked: false, top: false };
			joy.set(it, st);
			joyUpdate(it, st, e.clientX, e.clientY);
			return;
		}
		active.set(pid, { item: it, out: false });
		if (it.kind === 'drawer') return;
		if (!it.data.isToggle) sendKeys(it, true);
	});

	el.addEventListener('pointermove', e => {
		if (state.editing) {
			if (!drag || e.pointerId !== drag.pid) return;
			if (it.kind === 'sub' && it.owner!.drawer!.orientation !== 'FREE') return;
			const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
			if (Math.hypot(dx, dy) > 4) drag.moved = true;
			it.rect.x = drag.ox + dx; it.rect.y = drag.oy + dy;
			el.style.left = it.rect.x + 'px'; el.style.top = it.rect.y + 'px';
			if (it.kind === 'drawer') { it.data.dynamicX = generateDynamicX(it.rect.x, it.data); it.data.dynamicY = generateDynamicY(it.rect.y, it.data); placeAll(); }
			return;
		}
		if (it.kind === 'joystick') {
			const st = joy.get(it);
			if (st && st.pid === e.pointerId) joyUpdate(it, st, e.clientX, e.clientY);
			return;
		}
		const a = active.get(e.pointerId);
		if (!a) return;
		const cur = a.item;
		if (cur.data.passThruEnabled && (Input.Mouse.virtual || Input.Mouse.buttons)) {
			Input.moveBy(e.movementX || 0, e.movementY || 0);
		}
		const under = itemAt(e.clientX, e.clientY);
		if (under === cur) { a.out = false; return; }
		if (cur.data.isSwipeable && !a.out) { if (!flipToggle(cur)) sendKeys(cur, false); }
		a.out = true;
		if (under && under.kind !== 'drawer' && under.data.isSwipeable) {
			a.item = under; a.out = false;
			if (!under.data.isToggle) sendKeys(under, true);
		}
	});

	const end = (e: PointerEvent) => {
		if (state.editing) {
			if (drag && e.pointerId === drag.pid) {
				if (drag.moved && !(it.kind === 'sub' && it.owner!.drawer!.orientation !== 'FREE')) {
					it.data.dynamicX = generateDynamicX(it.rect.x, it.data);
					it.data.dynamicY = generateDynamicY(it.rect.y, it.data);
					placeAll();
					Controls.persist(); emit();
				}
				drag = null;
			}
			return;
		}
		if (it.kind === 'joystick') {
			const st = joy.get(it);
			if (!st || st.pid !== e.pointerId) return;
			if (st.top) { st.locked = true; el.classList.add('locked'); return; }  // mantém Ctrl+frente
			joyApply(it, new Set(), st); joy.delete(it); joyReset(it);
			return;
		}
		const a = active.get(e.pointerId);
		if (!a) return;
		active.delete(e.pointerId);
		const cur = a.item;
		if (cur.kind === 'drawer') {
			if (!a.out && e.type === 'pointerup') { cur.open = !cur.open; placeAll(); }
			return;
		}
		if (!flipToggle(cur)) sendKeys(cur, false);
	};
	el.addEventListener('pointerup', end);
	el.addEventListener('pointercancel', end);
}

/** Depois de redimensionar, recalcula a expressão para o canto superior esquerdo não "pular". */
function keepPosition(it: Item) {
	if (it.kind === 'sub' && it.owner!.drawer!.orientation !== 'FREE') return;
	it.data.dynamicX = generateDynamicX(it.rect.x, it.data);
	it.data.dynamicY = generateDynamicY(it.rect.y, it.data);
	placeAll();
}

// ------------------------------------------------------------------ API pública

let persistTimer: any;

export const Controls = {
	init() {
		if (state.started) return;
		state.started = true;
		loadStore();
		state.root = h('div', { id: 'bb-android-controls', class: UI_CLASS });
		document.body.appendChild(state.root);
		window.addEventListener('resize', () => { if (state.layout) { placeAll(); } });
		Input.installTouchRouter();
		Controls.loadActive();
	},

	// estado
	get editing() { return state.editing; },
	get selected() { return state.selected; },
	get layout() { return state.layout; },
	get activeId() { return state.active; },
	get visible() { return state.visible; },
	get items() { return state.items; },
	onMenu(fn: () => void) { state.onMenu = fn; },
	subscribe(fn: () => void) { state.listeners.add(fn); return () => state.listeners.delete(fn); },

	// perfis
	profiles() { return Object.entries(state.profiles).map(([id, p]) => ({ id, name: p.name })); },
	profileName(id: string) { return state.profiles[id]?.name || ''; },
	loadActive() {
		Input.releaseAllKeys();
		state.layout = state.active ? cloneLayout(state.profiles[state.active].layout) : null;
		state.selected = null;
		state.root!.style.display = state.layout ? '' : 'none';
		if (state.layout) build(); else { state.items = []; state.root!.replaceChildren(); }
		emit();
	},
	setActive(id: string | null) {
		Controls.persist(true);
		if (state.editing) Controls.setEditing(false);
		state.active = id && state.profiles[id] ? id : null;
		saveStore();
		Controls.loadActive();
	},
	createProfile(name: string, layout?: Layout): string {
		const id = uid();
		state.profiles[id] = { name, layout: layout ? cloneLayout(layout) : defaultLayout() };
		saveStore(); emit();
		return id;
	},
	renameProfile(id: string, name: string) { if (state.profiles[id]) { state.profiles[id].name = name; saveStore(); emit(); } },
	deleteProfile(id: string) {
		clearTimeout(persistTimer);
		delete state.profiles[id];
		if (state.active === id) { state.active = null; saveStore(); Controls.loadActive(); } else { saveStore(); emit(); }
	},
	importProfile(name: string, text: string): string {
		const m = metrics();
		const layout = parseLayout(text, m.dpr, { w: m.sw, h: m.sh });
		return Controls.createProfile(name, layout);
	},
	exportProfile(id: string): { name: string; json: string } | null {
		const p = state.profiles[id];
		if (!p) return null;
		const live = id === state.active && state.layout ? state.layout : p.layout;
		return { name: p.name, json: serializeLayout(live) };
	},

	// persistência do perfil ativo
	persist(immediate = false) {
		// captura perfil e layout AGORA: a gravação atrasada nunca pode cair em outro perfil
		const id = state.active, layout = state.layout;
		if (!id || !layout || !state.profiles[id]) return;
		layout.version = LAYOUT_VERSION;
		const write = () => {
			if (!state.profiles[id]) return; // perfil excluído nesse meio tempo
			state.profiles[id].layout = cloneLayout(layout);
			saveStore();
		};
		clearTimeout(persistTimer);
		if (immediate) write(); else persistTimer = setTimeout(write, 300);
	},

	// visibilidade (botão GUI)
	toggleVisible() { state.visible = !state.visible; placeAll(); emit(); },

	// edição
	setEditing(on: boolean) {
		if (on && !state.layout) return;
		state.editing = on;
		state.root!.classList.toggle('editing', on);
		if (on) Input.releaseAllKeys();
		if (!on) { Controls.persist(true); state.selected = null; }
		state.items.forEach(i => { if (i.kind === 'drawer') i.open = on; });
		placeAll();
		emit();
	},
	select(it: Item | null) {
		state.selected = it;
		state.items.forEach(applyVisibility);
		emit();
	},
	refresh() { if (state.layout) { placeAll(); } },
	rebuild() { if (state.layout) { build(); Controls.persist(); emit(); } },

	addButton(p: Partial<ControlData> = {}) {
		if (!state.layout) return null;
		const d = newControl({ name: 'button', ...p });
		state.layout.mControlDataList.push(d);
		build(); Controls.persist();
		const it = state.items.find(i => i.data === d) || null;
		Controls.select(it);
		return it;
	},
	addSpecial(code: number) {
		return Controls.addButton(specialButton(code, '0.5 * ${screen_width}', '0.5 * ${screen_height}'));
	},
	addJoystick() {
		if (!state.layout) return null;
		const j = newJoystick({ dynamicX: '${margin} * 2', dynamicY: '${bottom} - ${margin} * 2' });
		state.layout.mJoystickDataList.push(j);
		build(); Controls.persist();
		const it = state.items.find(i => i.data === j) || null;
		Controls.select(it);
		return it;
	},
	addDrawer() {
		if (!state.layout) return null;
		const d = newDrawer();
		state.layout.mDrawerDataList.push(d);
		build(); Controls.persist();
		const it = state.items.find(i => i.data === d.properties) || null;
		Controls.select(it);
		return it;
	},
	addSubButton(drawerItem: Item) {
		if (drawerItem.kind !== 'drawer') return null;
		const d = newControl({ name: 'sub', dynamicX: '0.5 * ${screen_width}', dynamicY: '0.5 * ${screen_height}' });
		drawerItem.drawer!.buttonProperties.push(d);
		build(); Controls.persist();
		const it = state.items.find(i => i.data === d) || null;
		Controls.select(it);
		return it;
	},
	cloneSelected() {
		const s = state.selected;
		if (!s || !state.layout) return null;
		const copy = cloneControl(s.data);
		copy.dynamicX = '0.5 * ${screen_width}'; copy.dynamicY = '0.5 * ${screen_height}';
		if (s.kind === 'button') { state.layout.mControlDataList.push(copy); }
		else if (s.kind === 'joystick') { state.layout.mJoystickDataList.push(copy as JoystickData); }
		else if (s.kind === 'sub') { s.owner!.drawer!.buttonProperties.push(copy); }
		else if (s.kind === 'drawer') {
			const dd = JSON.parse(JSON.stringify(s.drawer)) as DrawerData;
			dd.properties.dynamicX = copy.dynamicX; dd.properties.dynamicY = copy.dynamicY;
			state.layout.mDrawerDataList.push(dd);
		}
		build(); Controls.persist(); emit();
		return copy;
	},
	deleteSelected() {
		const s = state.selected;
		if (!s || !state.layout) return;
		const L = state.layout;
		const rm = <T>(arr: T[], v: T) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); };
		if (s.kind === 'button') rm(L.mControlDataList, s.data);
		else if (s.kind === 'joystick') rm(L.mJoystickDataList, s.data as JoystickData);
		else if (s.kind === 'sub') rm(s.owner!.drawer!.buttonProperties, s.data);
		else if (s.kind === 'drawer') rm(L.mDrawerDataList, s.drawer!);
		state.selected = null;
		build(); Controls.persist(); emit();
	},
	/** Chamado pelo editor depois de alterar propriedades do item. */
	changed(rebuildAll = false) {
		if (rebuildAll) build(); else placeAll();
		Controls.persist(); emit();
	},
	toast,
};
