/** Menus do editor de controles (equivalente ao EditControlSideDialog / ControlLayout do Pojav). */
import { Controls, Item } from './touch_controls';
import { KEYS } from './keymap';
import { ControlData, JoystickData, ORIENTATIONS, Orientation, SPECIAL_LIST, argbToHex, argbAlpha, cssToArgb } from './pojav_format';
import { UI_CLASS } from './input_emulator';
import {
	h, openDrawer, closeAll, getRoot, item, section, hint, row, slider, textRow, selectRow, toggleRow,
	colorRow, chips, toast, confirmDialog, promptDialog, Drawer,
} from './ui_kit';

// ------------------------------------------------------------------ opções de teclas

const KEY_OPTIONS = [
	{ value: '0', label: '— nenhuma —' },
	...SPECIAL_LIST.map(s => ({ value: String(s.code), label: s.label, group: 'Especiais' })),
	...KEYS.map(k => ({ value: String(k.glfw), label: k.label, group: 'Teclas' })),
];
const ORIENT_LABEL: Record<Orientation, string> = { DOWN: 'Para baixo', LEFT: 'Para a esquerda', UP: 'Para cima', RIGHT: 'Para a direita', FREE: 'Livre' };

// ------------------------------------------------------------------ propriedades do item selecionado

const KIND_LABEL: Record<string, string> = { button: 'Botão', joystick: 'Joystick', drawer: 'Drawer', sub: 'Sub-botão' };

export function openPropertiesDrawer(it: Item | null = Controls.selected) {
	if (!it) { toast('Selecione um controle primeiro (toque nele no modo de edição).'); return; }
	const d = it.data;
	const dr = openDrawer({ title: `${KIND_LABEL[it.kind]}: ${d.name}`, side: 'right' });
	const B = dr.body;
	const upd = (rebuild = false) => Controls.changed(rebuild);

	B.append(
		textRow('Nome', d.name, v => { d.name = v; dr.setTitle(`${KIND_LABEL[it.kind]}: ${v}`); upd(); }),
	);

	if (it.kind === 'joystick') {
		B.append(
			section('Teclas do joystick'),
			hint('Cima, esquerda, baixo, direita. Vazio = W, A, S, D.'),
		);
		['Cima', 'Esquerda', 'Baixo', 'Direita'].forEach((lab, i) =>
			B.append(selectRow(lab, KEY_OPTIONS, String(d.keycodes[i] || 0), v => { d.keycodes[i] = Number(v); upd(); })));
		const j = d as JoystickData;
		B.append(
			toggleRow('Travar para frente', !!j.forwardLock, v => { j.forwardLock = v; upd(); }),
			toggleRow('Posição absoluta', !!j.absolute, v => { j.absolute = v; upd(); }),
		);
	} else if (it.kind !== 'drawer') {
		B.append(section('Mapeamento (até 4 teclas ao mesmo tempo)'));
		[0, 1, 2, 3].forEach(i =>
			B.append(selectRow('Tecla ' + (i + 1), KEY_OPTIONS, String(d.keycodes[i] || 0), v => { d.keycodes[i] = Number(v); upd(); })));
		B.append(
			toggleRow('Alternar (toggle)', d.isToggle, v => { d.isToggle = v; upd(); }),
			toggleRow('Repassar toque ao mouse', d.passThruEnabled, v => { d.passThruEnabled = v; upd(); }),
			toggleRow('Deslizar (swipe)', d.isSwipeable, v => { d.isSwipeable = v; upd(); }),
		);
	}

	if (it.kind === 'drawer') {
		B.append(
			section('Drawer'),
			selectRow('Orientação', ORIENTATIONS.map(o => ({ value: o, label: ORIENT_LABEL[o] })), it.drawer!.orientation,
				v => { it.drawer!.orientation = v as Orientation; upd(true); }),
			hint(`${it.drawer!.buttonProperties.length} sub-botão(ões). Toque no drawer na tela de edição para abrir/fechar a lista.`),
			item('Adicionar sub-botão', () => { Controls.addSubButton(it); dr.close(); }, { icon: '＋' }),
		);
	}

	B.append(
		section('Aparência'),
		slider('Opacidade', { min: 0, max: 100, value: Math.round(d.opacity * 100), format: v => v + '%', onInput: v => { d.opacity = v / 100; upd(); } }),
		colorRow('Fundo', argbToHex(d.bgColor), argbAlpha(d.bgColor), (hex, a) => { d.bgColor = cssToArgb(hex, a); upd(); }),
		colorRow('Borda', argbToHex(d.strokeColor), argbAlpha(d.strokeColor), (hex, a) => { d.strokeColor = cssToArgb(hex, a); upd(); }),
		slider('Espessura da borda', { min: 0, max: 20, step: 0.5, value: d.strokeWidth, format: v => v + ' dp', onInput: v => { d.strokeWidth = v; upd(); } }),
	);
	if (it.kind !== 'joystick') {
		B.append(slider('Arredondamento', { min: 0, max: 100, value: d.cornerRadius, format: v => v + '%', onInput: v => { d.cornerRadius = v; upd(); } }));
	}

	B.append(
		section('Tamanho e posição'),
		textRow('Largura (dp)', String(d.width), v => { d.width = Math.max(10, Number(v) || d.width); if (it.kind === 'joystick') d.height = d.width; upd(); }, 'number'),
	);
	if (it.kind !== 'joystick') B.append(textRow('Altura (dp)', String(d.height), v => { d.height = Math.max(10, Number(v) || d.height); upd(); }, 'number'));
	const free = !(it.kind === 'sub' && it.owner!.drawer!.orientation !== 'FREE');
	if (free) {
		B.append(
			textRow('Posição X', d.dynamicX, v => { d.dynamicX = v; upd(); }),
			textRow('Posição Y', d.dynamicY, v => { d.dynamicY = v; upd(); }),
			hint('Variáveis: ${screen_width} ${screen_height} ${width} ${height} ${margin} ${top} ${left} ${right} ${bottom} ${preferred_scale}. Aceita + − × ÷ ( ) dp() px().'),
		);
	} else B.append(hint('A posição deste sub-botão é controlada pelo drawer.'));

	B.append(
		section('Visibilidade'),
		toggleRow('Mostrar em jogo (modo normal)', d.displayInGame, v => { d.displayInGame = v; upd(); }),
		toggleRow('Mostrar em menus', d.displayInMenu, v => { d.displayInMenu = v; upd(); }),
		section('Ações'),
		item('Duplicar', () => { Controls.cloneSelected(); dr.close(); toast('Duplicado no centro da tela'); }, { icon: '⧉' }),
		item('Excluir', async () => {
			if (await confirmDialog({ title: 'Excluir controle', message: `Excluir "${d.name}"?`, confirmLabel: 'Excluir', danger: true })) { Controls.deleteSelected(); dr.close(); }
		}, { icon: '🗑', kind: 'danger' }),
	);
}

// ------------------------------------------------------------------ barra de edição na tela

let bar: HTMLElement | null = null;
let barUnsub: (() => void) | null = null;

function ensureBar() {
	if (bar) return;
	const mk = (label: string, fn: () => void, primary = false) => {
		const b = h('button', { class: primary ? 'primary' : '' }, label);
		b.addEventListener('click', fn);
		return b;
	};
	bar = h('div', { id: 'bb-android-editbar', class: UI_CLASS },
		mk('＋ Botão', () => Controls.addButton()),
		mk('＋ Joystick', () => Controls.addJoystick()),
		mk('＋ Drawer', () => Controls.addDrawer()),
		mk('＋ Sub', () => { const s = Controls.selected; if (s?.kind === 'drawer') Controls.addSubButton(s); else if (s?.kind === 'sub') Controls.addSubButton(s.owner!); else toast('Selecione um drawer'); }),
		mk('Propriedades', () => openPropertiesDrawer()),
		mk('Duplicar', () => { if (Controls.selected) Controls.cloneSelected(); else toast('Nada selecionado'); }),
		mk('Excluir', async () => {
			const s = Controls.selected;
			if (!s) { toast('Nada selecionado'); return; }
			if (await confirmDialog({ title: 'Excluir controle', message: `Excluir "${s.data.name}"?`, confirmLabel: 'Excluir', danger: true })) Controls.deleteSelected();
		}),
		mk('Concluir', () => Controls.setEditing(false), true),
	);
	getRoot().appendChild(bar);
	barUnsub = Controls.subscribe(() => { if (!Controls.editing) hideBar(); });
}
function hideBar() {
	bar?.remove(); bar = null;
	barUnsub?.(); barUnsub = null;
}

/** Fecha os menus e deixa arrastar/redimensionar direto na tela. */
export function startOnScreenEditing() {
	if (!Controls.layout) { toast('Crie ou escolha um perfil primeiro.'); return; }
	closeAll();
	Controls.setEditing(true);
	ensureBar();
	toast('Toque para selecionar · arraste para mover · canto amarelo redimensiona', 3200);
}

// ------------------------------------------------------------------ Editar Perfil de Touch

export function openEditorDrawer() {
	const dr = openDrawer({ title: 'Editar Perfil de Touch', side: 'left' });
	const draw = () => {
		const B = dr.body;
		B.replaceChildren();
		if (!Controls.layout) {
			B.append(
				hint('Nenhum perfil de touch ativo. Crie um perfil com o layout padrão do Blockbench ou importe um arquivo de controles do Pojav.'),
				item('Criar perfil novo (layout padrão)', async () => {
					const name = await promptDialog({ title: 'Nome do perfil', value: 'Blockbench' });
					if (!name) return;
					Controls.setActive(Controls.createProfile(name));
				}, { icon: '＋', kind: 'primary' }),
				item('Trocar / importar perfil', () => openProfilesDrawer(), { icon: '⇄' }),
			);
			return;
		}
		const L = Controls.layout;
		B.append(
			hint(`Perfil: ${Controls.profileName(Controls.activeId!)} — ${L.mControlDataList.length} botões, ${L.mJoystickDataList.length} joysticks, ${L.mDrawerDataList.length} drawers.`),
			item('Editar na tela', () => startOnScreenEditing(), { icon: '✥', hint: 'Arrastar, redimensionar e selecionar controles', kind: 'primary' }),
			section('Criar'),
			item('Criar novo Botão', () => { Controls.addButton(); startOnScreenEditing(); openPropertiesDrawer(); }, { icon: '▢' }),
			item('Criar Joystick', () => { Controls.addJoystick(); startOnScreenEditing(); openPropertiesDrawer(); }, { icon: '◉' }),
			item('Criar Drawer', () => { Controls.addDrawer(); startOnScreenEditing(); openPropertiesDrawer(); }, { icon: '☷', hint: 'Grupo de botões que abre e fecha' }),
			section('Botão especial'),
			hint('Mouse, rolagem, teclado virtual, mostrar/ocultar controles (GUI) e menu.'),
		);
		const chipsWrap = h('div', { class: 'bbk-chips' }, ...SPECIAL_LIST.map(s => {
			const c = h('button', { class: 'bbk-chip' }, s.name);
			c.title = s.label;
			c.addEventListener('click', () => { Controls.addSpecial(s.code); startOnScreenEditing(); toast(`Botão ${s.name} criado`); });
			return c;
		}));
		B.append(chipsWrap,
			section('Perfil'),
			item('Restaurar layout padrão', async () => {
				if (await confirmDialog({ title: 'Restaurar padrão', message: 'Substitui os controles deste perfil pelo layout padrão do Blockbench.', confirmLabel: 'Restaurar', danger: true })) {
					const { defaultLayout } = await import('./touch_controls');
					const id = Controls.activeId!;
					const name = Controls.profileName(id);
					Controls.deleteProfile(id);
					Controls.setActive(Controls.createProfile(name, defaultLayout()));
					draw();
				}
			}, { icon: '↺', kind: 'danger' }),
		);
	};
	draw();
	const un = Controls.subscribe(() => { if (dr.el.isConnected) draw(); });
	const close = dr.close;
	dr.close = () => { un(); close(); };
}

// ------------------------------------------------------------------ Trocar Perfil de Touch

function saveJson(name: string, json: string) {
	const file = name.replace(/[\\/:*?"<>|]+/g, '_') + '.json';
	const w = window as any;
	const opts = { name: file, extensions: ['json'], type: 'JSON', savetype: 'text', content: json };
	if (w.AndroidBridge?.active) w.AndroidBridge.exportFile(opts, () => toast('Perfil exportado: ' + file));
	else if (w.Blockbench?.export) w.Blockbench.export(opts);
}

function pickFile(accept: string): Promise<File | null> {
	return new Promise(resolve => {
		const inp = h('input', { type: 'file', accept, style: 'position:fixed;left:-999px;top:-999px;opacity:0' });
		inp.addEventListener('change', () => { resolve(inp.files && inp.files[0] || null); inp.remove(); });
		inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
		document.body.appendChild(inp);
		inp.click();
	});
}

export function openProfilesDrawer() {
	const dr: Drawer = openDrawer({ title: 'Trocar Perfil de Touch', side: 'left' });
	const draw = () => {
		const B = dr.body;
		B.replaceChildren();
		const activeId = Controls.activeId;
		B.append(
			item('Nenhum (desativar controles)', () => { Controls.setActive(null); toast('Controles de touch desativados'); }, { icon: activeId === null ? '✓' : '○' }),
			section('Perfis'),
		);
		const list = Controls.profiles();
		if (!list.length) B.append(hint('Nenhum perfil ainda. Crie um novo ou importe um arquivo de controles do PojavLauncher (.json).'));
		for (const p of list) {
			const sel = item(p.name, () => { Controls.setActive(p.id); toast('Perfil ativo: ' + p.name); }, { icon: p.id === activeId ? '✓' : '○' });
			const mini = (txt: string, label: string, fn: () => void) => {
				const b = h('button', { class: 'bbk-icon', title: label, 'aria-label': label }, txt);
				b.addEventListener('click', fn);
				return b;
			};
			const wrap = h('div', { class: 'bbk-row', style: 'gap:6px;margin-bottom:6px' },
				h('div', { style: 'flex:1;min-width:0' }, sel),
				mini('⬆', 'Exportar', () => { const e = Controls.exportProfile(p.id); if (e) saveJson(e.name, e.json); }),
				mini('✎', 'Renomear', async () => { const n = await promptDialog({ title: 'Renomear perfil', value: p.name }); if (n) Controls.renameProfile(p.id, n); }),
				mini('🗑', 'Excluir', async () => { if (await confirmDialog({ title: 'Excluir perfil', message: `Excluir "${p.name}"?`, confirmLabel: 'Excluir', danger: true })) Controls.deleteProfile(p.id); }));
			(sel as HTMLElement).style.margin = '0';
			B.append(wrap);
		}
		B.append(
			section('Adicionar'),
			item('Novo perfil (layout padrão)', async () => {
				const name = await promptDialog({ title: 'Nome do perfil', value: 'Blockbench ' + (list.length + 1) });
				if (!name) return;
				Controls.setActive(Controls.createProfile(name));
			}, { icon: '＋' }),
			item('Importar perfil (.json do Pojav)', async () => {
				const f = await pickFile('.json,application/json,text/plain');
				if (!f) return;
				try {
					const id = Controls.importProfile(f.name.replace(/\.[^.]+$/, '') || 'Importado', await f.text());
					Controls.setActive(id);
					toast('Perfil importado');
				} catch (e: any) { toast('Falha ao importar: ' + (e?.message || e), 4500); }
			}, { icon: '⬇', hint: 'Compatível com o formato de controles do PojavLauncher (v2–v8)' }),
		);
	};
	draw();
	const un = Controls.subscribe(() => { if (dr.el.isConnected) draw(); });
	const close = dr.close;
	dr.close = () => { un(); close(); };
}
