/** Menus do editor de controles (equivalente ao EditControlSideDialog / ControlLayout do Pojav). */
import { Controls, Item, defaultLayout } from './touch_controls';
import { KEYS } from './keymap';
import { JoystickData, ORIENTATIONS, Orientation, SPECIAL_LIST, argbToHex, argbAlpha, cssToArgb } from './pojav_format';
import {
	h, openDrawer, closeAll, closeDrawer, focusDrawer, item, section, hint, slider, textRow, selectRow, toggleRow,
	colorRow, toast, confirmDialog, promptDialog, Drawer,
} from './ui_kit';

// ------------------------------------------------------------------ opções de teclas

const KEY_OPTIONS = [
	{ value: '0', label: '— nenhuma —' },
	...SPECIAL_LIST.map(s => ({ value: String(s.code), label: s.label, group: 'Especiais' })),
	...KEYS.map(k => ({ value: String(k.glfw), label: k.label, group: 'Teclas' })),
];
const ORIENT_LABEL: Record<Orientation, string> = { DOWN: 'Para baixo', LEFT: 'Para a esquerda', UP: 'Para cima', RIGHT: 'Para a direita', FREE: 'Livre' };
const KIND_LABEL: Record<string, string> = { button: 'Botão', joystick: 'Joystick', drawer: 'Drawer', sub: 'Sub-botão' };

// ------------------------------------------------------------------ propriedades do controle selecionado

export function openPropertiesDrawer(it: Item | null = Controls.selected) {
	if (!it) { toast('Selecione um controle primeiro (toque nele no modo de edição).'); return; }
	closeDrawer('props');
	const d = it.data;
	const dr = openDrawer({ id: 'props', title: `${KIND_LABEL[it.kind]}: ${d.name}` });
	const B = dr.body;
	const upd = (rebuild = false) => Controls.changed(rebuild);

	B.append(textRow('Nome', d.name, v => { d.name = v; dr.setTitle(`${KIND_LABEL[it.kind]}: ${v}`); upd(); }));

	if (it.kind === 'joystick') {
		B.append(section('Teclas do joystick'), hint('Cima, esquerda, baixo, direita. Vazio = W, A, S, D.'));
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
			hint(`${it.drawer!.buttonProperties.length} sub-botão(ões). Na edição, toque no drawer para abrir/fechar a lista.`),
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

// ------------------------------------------------------------------ entrar / sair da edição

/** "Editar Perfil de Touch": entra direto no modo de edição; o ☰ passa a abrir o menu de edição. */
export async function startEditing() {
	if (!Controls.layout) {
		const name = await promptDialog({ title: 'Nome do perfil', value: 'Blockbench', placeholder: 'Crie um perfil para editar' });
		if (!name) return;
		Controls.setActive(Controls.createProfile(name));
	}
	closeAll();
	Controls.setEditing(true);
	toast('Modo de edição: arraste os controles e toque em ☰ para criar, ajustar e salvar', 4200);
}

function saveAndExit() {
	Controls.setEditing(false);
	closeAll();
	toast('Perfil salvo');
}

// ------------------------------------------------------------------ menu de edição (aberto pelo ☰ durante a edição)

export function openEditMenu() {
	if (focusDrawer('edit-menu')) return;
	const dr = openDrawer({ id: 'edit-menu', title: 'Editar Perfil de Touch' });
	const draw = () => {
		const B = dr.body;
		const keepScroll = B.scrollTop;
		B.replaceChildren();
		const L = Controls.layout;
		if (!L) { B.append(hint('Nenhum perfil ativo.')); return; }
		const sel = Controls.selected;
		B.append(
			hint(`Perfil: ${Controls.profileName(Controls.activeId!)} — ${L.mControlDataList.length} botões, ${L.mJoystickDataList.length} joysticks, ${L.mDrawerDataList.length} drawers.`),
			item('Salvar e sair da edição', saveAndExit, { icon: '✓', kind: 'primary', hint: 'Grava o perfil e volta ao menu normal' }),
			section('Controle selecionado'),
		);
		if (sel) {
			B.append(
				hint(`${KIND_LABEL[sel.kind]} "${sel.data.name}"`),
				item('Propriedades', () => openPropertiesDrawer(sel), { icon: '✎', hint: 'Teclas, aparência, tamanho e posição' }),
				item('Duplicar', () => { Controls.cloneSelected(); toast('Duplicado no centro da tela'); }, { icon: '⧉' }),
			);
			if (sel.kind === 'drawer') B.append(item('Adicionar sub-botão', () => { Controls.addSubButton(sel); openPropertiesDrawer(); }, { icon: '＋' }));
			if (sel.kind === 'sub') B.append(item('Adicionar outro sub-botão', () => { Controls.addSubButton(sel.owner!); openPropertiesDrawer(); }, { icon: '＋' }));
			B.append(item('Excluir', async () => {
				if (await confirmDialog({ title: 'Excluir controle', message: `Excluir "${sel.data.name}"?`, confirmLabel: 'Excluir', danger: true })) Controls.deleteSelected();
			}, { icon: '🗑', kind: 'danger' }));
		} else B.append(hint('Feche o menu e toque em um controle na tela para selecioná-lo.'));

		B.append(
			section('Criar'),
			item('Criar novo Botão', () => { Controls.addButton(); openPropertiesDrawer(); }, { icon: '▢' }),
			item('Criar Joystick', () => { Controls.addJoystick(); openPropertiesDrawer(); }, { icon: '◉' }),
			item('Criar Drawer', () => { Controls.addDrawer(); openPropertiesDrawer(); }, { icon: '☷', hint: 'Grupo de botões que abre e fecha' }),
			section('Botão especial'),
			hint('Mouse, rolagem, teclado virtual, mostrar/ocultar controles (GUI) e menu.'),
			h('div', { class: 'bbk-chips' }, ...SPECIAL_LIST.map(s => {
				const c = h('button', { class: 'bbk-chip', title: s.label }, s.name);
				c.addEventListener('click', () => { Controls.addSpecial(s.code); toast(`Botão ${s.name} criado no centro da tela`); });
				return c;
			})),

			section('Grade e encaixe'),
			slider('Grade', { min: 1, max: 32, value: Controls.grid, format: v => v <= 1 ? 'desligada' : `${v}×${v}`, onInput: v => Controls.setGrid(v) }),
			hint('Divide a tela em N×N células; ao arrastar ou redimensionar, os controles encaixam nas linhas.'),
			toggleRow('Mostrar a grade na tela', Controls.showGrid, v => Controls.setShowGrid(v)),
			toggleRow('Grudar nos outros controles', Controls.magnet, v => Controls.setMagnet(v)),
			hint('Alinha bordas e centros e encosta os controles uns nos outros com uma pequena folga, mostrando linhas-guia.'),

			section('Perfil'),
			item('Restaurar layout padrão', async () => {
				if (await confirmDialog({ title: 'Restaurar padrão', message: 'Substitui os controles deste perfil pelo layout padrão do Blockbench (ainda dá para descartar).', confirmLabel: 'Restaurar', danger: true })) {
					Controls.replaceLayout(defaultLayout());
					toast('Layout padrão restaurado');
				}
			}, { icon: '↺', kind: 'danger' }),
			item('Descartar alterações', async () => {
				if (await confirmDialog({ title: 'Descartar alterações', message: 'Volta o perfil ao estado em que estava antes de começar a editar e sai da edição.', confirmLabel: 'Descartar', danger: true })) {
					Controls.cancelEditing(); closeAll(); toast('Alterações descartadas');
				}
			}, { icon: '✕', kind: 'danger' }),
		);
		B.scrollTop = keepScroll;
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
	if (focusDrawer('profiles')) return;
	const dr: Drawer = openDrawer({ id: 'profiles', title: 'Trocar Perfil de Touch' });
	const draw = () => {
		const B = dr.body;
		const keepScroll = B.scrollTop;
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
			B.append(h('div', { class: 'bbk-row profile' }, sel,
				mini('⬆', 'Exportar', () => { const e = Controls.exportProfile(p.id); if (e) saveJson(e.name, e.json); }),
				mini('✎', 'Renomear', async () => { const n = await promptDialog({ title: 'Renomear perfil', value: p.name }); if (n) Controls.renameProfile(p.id, n); }),
				mini('🗑', 'Excluir', async () => { if (await confirmDialog({ title: 'Excluir perfil', message: `Excluir "${p.name}"?`, confirmLabel: 'Excluir', danger: true })) Controls.deleteProfile(p.id); })));
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
		B.scrollTop = keepScroll;
	};
	draw();
	const un = Controls.subscribe(() => { if (dr.el.isConnected) draw(); });
	const close = dr.close;
	dr.close = () => { un(); close(); };
}
