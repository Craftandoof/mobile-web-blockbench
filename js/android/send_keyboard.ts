/**
 * Enviar Input: teclado completo (abas ① e ②). Tocar numa tecla só a SELECIONA (fica destacada);
 * o combo é enviado de uma vez ao tocar em "Enviar tecla" (ex.: Ctrl + Shift + S).
 */
import { KEYS } from './keymap';
import * as Input from './input_emulator';
import { h, openDrawer, focusDrawer, item, section, hint, toast } from './ui_kit';

const GLFW_BY_NAME: Record<string, number> = Object.fromEntries(KEYS.map(k => [k.name, k.glfw]));
const LABEL_BY_GLFW: Record<number, string> = Object.fromEntries(KEYS.map(k => [k.glfw, k.label]));

const SHORT: Record<string, string> = {
	ESCAPE: 'Esc', BACKSPACE: 'Backspace', CAPS_LOCK: 'Capslock', ENTER: 'Enter', TAB: 'Tab', SPACE: 'Space',
	LEFT_SHIFT: 'Shift', RIGHT_SHIFT: 'Shift', LEFT_CONTROL: 'Ctrl', RIGHT_CONTROL: 'Ctrl', LEFT_ALT: 'Alt', RIGHT_ALT: 'Alt',
	LEFT_SUPER: 'Meta', PRINT_SCREEN: 'PrtSc', SCROLL_LOCK: 'Scroll', PAUSE: 'Pause', INSERT: 'Insert', HOME: 'Home', END: 'End',
	PAGE_UP: 'PgUp', PAGE_DOWN: 'PgDn', DELETE: 'Delete', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
	NUM_LOCK: 'Num lk', KP_DIVIDE: '/', KP_MULTIPLY: '*', KP_SUBTRACT: '-', KP_ADD: '+', KP_ENTER: 'Enter', KP_DECIMAL: '.',
	GRAVE_ACCENT: '`', MINUS: '-', EQUAL: '+', LEFT_BRACKET: '[', RIGHT_BRACKET: ']', BACKSLASH: '\\', SEMICOLON: ';',
	APOSTROPHE: "'", COMMA: ',', PERIOD: '.', SLASH: '/',
};
const MODIFIERS = new Set([340, 341, 342, 343, 344, 345, 346, 347]);

type Cell = { k: string; w?: number } | { gap: number };
const K = (k: string, w = 1): Cell => ({ k, w });
const G = (w = 1): Cell => ({ gap: w });
const range = (a: string[]): Cell[] => a.map(k => K(k));

const PAGE1: Cell[][] = [
	[K('ESCAPE', 1.3), G(0.9), ...range(['F1', 'F2', 'F3', 'F4']), G(0.4), ...range(['F5', 'F6', 'F7', 'F8']), G(0.4), ...range(['F9', 'F10', 'F11', 'F12'])],
	[K('GRAVE_ACCENT'), ...range(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'MINUS', 'EQUAL']), K('BACKSPACE', 2)],
	[K('TAB', 1.5), ...range(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'LEFT_BRACKET', 'RIGHT_BRACKET']), K('BACKSLASH', 1.5)],
	[K('CAPS_LOCK', 1.8), ...range(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'SEMICOLON', 'APOSTROPHE']), K('ENTER', 2.2)],
	[K('LEFT_SHIFT', 2.4), ...range(['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'COMMA', 'PERIOD', 'SLASH']), K('RIGHT_SHIFT', 2.4)],
	[K('LEFT_CONTROL', 1.4), K('LEFT_SUPER', 1.2), K('LEFT_ALT', 1.4), K('SPACE', 6), K('RIGHT_ALT', 1.4), K('RIGHT_CONTROL', 1.4)],
];
const NAV: Cell[][] = [
	[K('PRINT_SCREEN'), K('SCROLL_LOCK'), K('PAUSE')],
	[K('INSERT'), K('HOME'), K('PAGE_UP')],
	[K('DELETE'), K('END'), K('PAGE_DOWN')],
	[G(3)],
	[G(1), K('UP'), G(1)],
	[K('LEFT'), K('DOWN'), K('RIGHT')],
];
const PAD: Cell[][] = [
	[K('NUM_LOCK'), K('KP_DIVIDE'), K('KP_MULTIPLY'), K('KP_SUBTRACT')],
	[K('KP_7'), K('KP_8'), K('KP_9'), K('KP_ADD')],
	[K('KP_4'), K('KP_5'), K('KP_6'), G(1)],
	[K('KP_1'), K('KP_2'), K('KP_3'), K('KP_ENTER')],
	[K('KP_0', 2), K('KP_DECIMAL'), G(1)],
];

const labelOf = (name: string) => SHORT[name] || (LABEL_BY_GLFW[GLFW_BY_NAME[name]] ?? name);

export function sendCombo(keys: number[]) {
	Input.refocusExternal();
	const mods = keys.filter(k => MODIFIERS.has(k));
	const rest = keys.filter(k => !MODIFIERS.has(k));
	const down = [...mods, ...rest];
	try {
		for (const k of down) Input.keyDown(k);
	} finally {
		for (const k of down.slice().reverse()) Input.keyUp(k);
	}
}

export function openSendKeyboard() {
	if (focusDrawer('send-input')) return;
	const dr = openDrawer({ id: 'send-input', title: 'Enviar Input', wide: true });
	const B = dr.body;
	let selected: number[] = [];
	let keep = false;
	let page = 1;

	const combo = h('div', { class: 'bbk-combo' });
	const keyEls = new Map<number, HTMLElement[]>();

	const refresh = () => {
		combo.textContent = selected.length
			? selected.map(k => SHORT[KEYS.find(x => x.glfw === k)?.name || ''] || LABEL_BY_GLFW[k] || String(k)).join(' + ')
			: 'Nenhuma tecla selecionada — toque nas teclas e depois em "Enviar tecla"';
		for (const [k, els] of keyEls) els.forEach(el => el.classList.toggle('on', selected.includes(k)));
	};
	const toggle = (k: number) => {
		selected = selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k];
		refresh();
	};

	const buildRows = (rows: Cell[][]) => rows.map(r => h('div', { class: 'bbk-kb-row' }, ...r.map(c => {
		if ('gap' in c) return h('div', { class: 'bbk-key gap', style: `flex-grow:${c.gap}` });
		const k = GLFW_BY_NAME[c.k];
		const el = h('button', { class: 'bbk-key', style: `flex-grow:${c.w ?? 1}`, 'data-glfw': k }, labelOf(c.k));
		el.addEventListener('click', () => toggle(k));
		const list = keyEls.get(k) || [];
		list.push(el);
		keyEls.set(k, list);
		return el;
	})));

	const tabs = h('div', { class: 'bbk-tabs' });
	const t1 = h('button', { class: 'bbk-tab on' }, '①');
	const t2 = h('button', { class: 'bbk-tab' }, '②');
	tabs.append(t1, t2);
	const pane = h('div', {});
	const show = (n: number) => {
		page = n;
		t1.classList.toggle('on', n === 1);
		t2.classList.toggle('on', n === 2);
		keyEls.clear();
		if (n === 1) pane.replaceChildren(...buildRows(PAGE1));
		else pane.replaceChildren(h('div', { style: 'display:flex;gap:24px;justify-content:space-between;align-items:flex-end;flex-wrap:wrap' },
			h('div', { style: 'flex:0 1 38%;min-width:180px' }, ...buildRows(NAV)),
			h('div', { style: 'flex:0 1 44%;min-width:200px' }, ...buildRows(PAD))));
		refresh();
	};
	t1.addEventListener('click', () => show(1));
	t2.addEventListener('click', () => show(2));

	// texto livre
	const input = h('input', { type: 'text', class: 'bbk-text', placeholder: 'Texto para enviar…', style: 'flex:1' });
	const sendText = () => {
		const t = input.value;
		if (!t) return;
		Input.refocusExternal();
		Input.typeText(t);
		input.value = '';
	};
	input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });

	const keepChip = h('button', { class: 'bbk-chip' }, 'Manter seleção após enviar');
	keepChip.addEventListener('click', () => { keep = !keep; keepChip.classList.toggle('on', keep); });

	B.append(
		section('Texto'),
		h('div', { class: 'bbk-actions-row', style: 'margin:0 0 4px' }, input, item('Enviar texto', sendText, { icon: '➤' })),
		section('Teclas'),
		hint('Toque nas teclas para selecioná-las (ficam destacadas, sem enviar). Depois toque em "Enviar tecla" para enviar todas juntas.'),
		tabs, pane, combo,
		h('div', { class: 'bbk-actions-row' },
			item('Limpar', () => { selected = []; refresh(); }, { icon: '✕' }),
			item('Enviar tecla', () => {
				if (!selected.length) { toast('Selecione ao menos uma tecla'); return; }
				sendCombo(selected);
				if (!keep) { selected = []; refresh(); }
			}, { icon: '➤', kind: 'primary' })),
		h('div', { style: 'margin-top:8px' }, keepChip),
	);
	show(1);
	void page;
}
