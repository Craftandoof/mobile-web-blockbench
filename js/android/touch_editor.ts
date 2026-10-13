/** Menus do editor de controles (equivalente ao EditControlSideDialog / ControlLayout do Pojav). */
import { Controls, Item, defaultLayout } from './touch_controls';
import { t } from './i18n';
import { KEYS } from './keymap';
import { JoystickData, ORIENTATIONS, Orientation, SPECIAL_LIST, argbToHex, argbAlpha, cssToArgb } from './pojav_format';
import {
	h, openDrawer, closeAll, closeDrawer, focusDrawer, item, section, hint, slider, textRow, selectRow, toggleRow,
	colorRow, toast, confirmDialog, promptDialog, Drawer,
} from './ui_kit';

// ------------------------------------------------------------------ opções de teclas

const keyOptions = () => [
	{ value: '0', label: t('— nenhuma —') },
	...SPECIAL_LIST.map(s => ({ value: String(s.code), label: s.label, group: t('Especiais') })),
	...KEYS.map(k => ({ value: String(k.glfw), label: t(k.label), group: t('Teclas') })),
];
const orientLabel = (): Record<Orientation, string> => ({ DOWN: t('Para baixo'), LEFT: t('Para a esquerda'), UP: t('Para cima'), RIGHT: t('Para a direita'), FREE: t('Livre') });
const kindLabel = (): Record<string, string> => ({ button: t('Botão'), joystick: t('Joystick'), drawer: t('Drawer'), sub: t('Sub-botão') });

// ------------------------------------------------------------------ propriedades do controle selecionado

export function openPropertiesDrawer(it: Item | null = Controls.selected) {
	if (!it) { toast(t('Selecione um controle primeiro (toque nele no modo de edição).')); return; }
	closeDrawer('props');
	const d = it.data;
	const dr = openDrawer({ id: 'props', title: `${kindLabel()[it.kind]}: ${d.name}` });
	const B = dr.body;
	const upd = (rebuild = false) => Controls.changed(rebuild);

	B.append(textRow(t('Nome'), d.name, v => { d.name = v; dr.setTitle(`${kindLabel()[it.kind]}: ${v}`); upd(); }));

	if (it.kind === 'joystick') {
		B.append(section(t('Teclas do joystick')), hint(t('Cima, esquerda, baixo, direita. Vazio = W, A, S, D.')));
		[t('Cima'), t('Esquerda'), t('Baixo'), t('Direita')].forEach((lab, i) =>
			B.append(selectRow(lab, keyOptions(), String(d.keycodes[i] || 0), v => { d.keycodes[i] = Number(v); upd(); })));
		const j = d as JoystickData;
		B.append(
			toggleRow(t('Travar para frente'), !!j.forwardLock, v => { j.forwardLock = v; upd(); }),
			toggleRow(t('Posição absoluta'), !!j.absolute, v => { j.absolute = v; upd(); }),
		);
	} else if (it.kind !== 'drawer') {
		B.append(section(t('Mapeamento (até 4 teclas ao mesmo tempo)')));
		[0, 1, 2, 3].forEach(i =>
			B.append(selectRow(t('Tecla ') + (i + 1), keyOptions(), String(d.keycodes[i] || 0), v => { d.keycodes[i] = Number(v); upd(); })));
		B.append(
			toggleRow(t('Alternar (toggle)'), d.isToggle, v => { d.isToggle = v; upd(); }),
			toggleRow(t('Repassar toque ao mouse'), d.passThruEnabled, v => { d.passThruEnabled = v; upd(); }),
			toggleRow(t('Deslizar (swipe)'), d.isSwipeable, v => { d.isSwipeable = v; upd(); }),
		);
	}

	if (it.kind === 'drawer') {
		B.append(
			section(t('Drawer')),
			selectRow(t('Orientação'), ORIENTATIONS.map(o => ({ value: o, label: orientLabel()[o] })), it.drawer!.orientation,
				v => { it.drawer!.orientation = v as Orientation; upd(true); }),
			hint(t('{0} sub-botão(ões). Na edição, toque no drawer para abrir/fechar a lista.', it.drawer!.buttonProperties.length)),
			item(t('Adicionar sub-botão'), () => { Controls.addSubButton(it); dr.close(); }, { icon: '＋' }),
		);
	}

	B.append(
		section(t('Aparência')),
		slider(t('Opacidade'), { min: 0, max: 100, value: Math.round(d.opacity * 100), format: v => v + '%', onInput: v => { d.opacity = v / 100; upd(); } }),
		colorRow(t('Fundo'), argbToHex(d.bgColor), argbAlpha(d.bgColor), (hex, a) => { d.bgColor = cssToArgb(hex, a); upd(); }),
		colorRow(t('Borda'), argbToHex(d.strokeColor), argbAlpha(d.strokeColor), (hex, a) => { d.strokeColor = cssToArgb(hex, a); upd(); }),
		slider(t('Espessura da borda'), { min: 0, max: 20, step: 0.5, value: d.strokeWidth, format: v => v + ' dp', onInput: v => { d.strokeWidth = v; upd(); } }),
	);
	if (it.kind !== 'joystick') {
		B.append(slider(t('Arredondamento'), { min: 0, max: 100, value: d.cornerRadius, format: v => v + '%', onInput: v => { d.cornerRadius = v; upd(); } }));
	}

	B.append(
		section(t('Tamanho e posição')),
		textRow(t('Largura (dp)'), String(d.width), v => { d.width = Math.max(10, Number(v) || d.width); if (it.kind === 'joystick') d.height = d.width; upd(); }, 'number'),
	);
	if (it.kind !== 'joystick') B.append(textRow(t('Altura (dp)'), String(d.height), v => { d.height = Math.max(10, Number(v) || d.height); upd(); }, 'number'));
	const free = !(it.kind === 'sub' && it.owner!.drawer!.orientation !== 'FREE');
	if (free) {
		B.append(
			textRow(t('Posição X'), d.dynamicX, v => { d.dynamicX = v; upd(); }),
			textRow(t('Posição Y'), d.dynamicY, v => { d.dynamicY = v; upd(); }),
			hint('Variáveis: ${screen_width} ${screen_height} ${width} ${height} ${margin} ${top} ${left} ${right} ${bottom} ${preferred_scale}. Aceita + − × ÷ ( ) dp() px().'),
		);
	} else B.append(hint(t('A posição deste sub-botão é controlada pelo drawer.')));

	B.append(
		section(t('Visibilidade')),
		toggleRow(t('Mostrar em jogo (modo normal)'), d.displayInGame, v => { d.displayInGame = v; upd(); }),
		toggleRow(t('Mostrar em menus'), d.displayInMenu, v => { d.displayInMenu = v; upd(); }),
		section(t('Ações')),
		item(t('Duplicar'), () => { Controls.cloneSelected(); dr.close(); toast(t('Duplicado no centro da tela')); }, { icon: '⧉' }),
		item(t('Excluir'), async () => {
			if (await confirmDialog({ title: t('Excluir controle'), message: t('Excluir "{0}"?', d.name), confirmLabel: t('Excluir'), danger: true })) { Controls.deleteSelected(); dr.close(); }
		}, { icon: '🗑', kind: 'danger' }),
	);
}

// ------------------------------------------------------------------ entrar / sair da edição

/** "Editar Perfil de Touch": entra direto no modo de edição; o ☰ passa a abrir o menu de edição. */
export async function startEditing() {
	if (!Controls.layout) {
		const name = await promptDialog({ title: t('Nome do perfil'), value: 'Blockbench', placeholder: t('Crie um perfil para editar') });
		if (!name) return;
		Controls.setActive(Controls.createProfile(name));
	}
	closeAll();
	Controls.setEditing(true);
	toast(t('Modo de edição: arraste os controles e toque em ☰ para criar, ajustar e salvar'), 4200);
}

function saveAndExit() {
	Controls.setEditing(false);
	closeAll();
	toast(t('Perfil salvo'));
}

// ------------------------------------------------------------------ menu de edição (aberto pelo ☰ durante a edição)

export function openEditMenu() {
	if (focusDrawer('edit-menu')) return;
	const dr = openDrawer({ id: 'edit-menu', title: t('Editar Perfil de Touch') });
	const draw = () => {
		const B = dr.body;
		const keepScroll = B.scrollTop;
		B.replaceChildren();
		const L = Controls.layout;
		if (!L) { B.append(hint(t('Nenhum perfil ativo.'))); return; }
		const sel = Controls.selected;
		B.append(
			hint(t('Perfil: {0} — {1} botões, {2} joysticks, {3} drawers.', Controls.profileName(Controls.activeId!), L.mControlDataList.length, L.mJoystickDataList.length, L.mDrawerDataList.length)),
			item(t('Salvar e sair da edição'), saveAndExit, { icon: '✓', kind: 'primary', hint: t('Grava o perfil e volta ao menu normal') }),
			section(t('Controle selecionado')),
		);
		if (sel) {
			B.append(
				hint(`${kindLabel()[sel.kind]} "${sel.data.name}"`),
				item(t('Propriedades'), () => openPropertiesDrawer(sel), { icon: '✎', hint: t('Teclas, aparência, tamanho e posição') }),
				item(t('Duplicar'), () => { Controls.cloneSelected(); toast(t('Duplicado no centro da tela')); }, { icon: '⧉' }),
			);
			if (sel.kind === 'drawer') B.append(item(t('Adicionar sub-botão'), () => { Controls.addSubButton(sel); openPropertiesDrawer(); }, { icon: '＋' }));
			if (sel.kind === 'sub') B.append(item(t('Adicionar outro sub-botão'), () => { Controls.addSubButton(sel.owner!); openPropertiesDrawer(); }, { icon: '＋' }));
			B.append(item(t('Excluir'), async () => {
				if (await confirmDialog({ title: t('Excluir controle'), message: t('Excluir "{0}"?', sel.data.name), confirmLabel: t('Excluir'), danger: true })) Controls.deleteSelected();
			}, { icon: '🗑', kind: 'danger' }));
		} else B.append(hint(t('Feche o menu e toque em um controle na tela para selecioná-lo.')));

		B.append(
			section(t('Criar')),
			item(t('Criar novo Botão'), () => { Controls.addButton(); openPropertiesDrawer(); }, { icon: '▢' }),
			item(t('Criar Joystick'), () => { Controls.addJoystick(); openPropertiesDrawer(); }, { icon: '◉' }),
			item(t('Criar Drawer'), () => { Controls.addDrawer(); openPropertiesDrawer(); }, { icon: '☷', hint: t('Grupo de botões que abre e fecha') }),
			section(t('Botão especial')),
			hint(t('Mouse, rolagem, teclado virtual, mostrar/ocultar controles (GUI) e menu.')),
			h('div', { class: 'bbk-chips' }, ...SPECIAL_LIST.map(s => {
				const c = h('button', { class: 'bbk-chip', title: s.label }, s.name);
				c.addEventListener('click', () => { Controls.addSpecial(s.code); toast(t('Botão {0} criado no centro da tela', s.name)); });
				return c;
			})),

			section(t('Grade e encaixe')),
			slider(t('Grade'), { min: 1, max: 32, value: Controls.grid, format: v => v <= 1 ? t('desligada') : `${v}×${v}`, onInput: v => Controls.setGrid(v) }),
			hint('Divide a tela em N×N células; ao arrastar ou redimensionar, os controles encaixam nas linhas.'),
			toggleRow(t('Mostrar a grade na tela'), Controls.showGrid, v => Controls.setShowGrid(v)),
			toggleRow(t('Grudar nos outros controles'), Controls.magnet, v => Controls.setMagnet(v)),
			hint(t('Alinha bordas e centros e encosta os controles uns nos outros com uma pequena folga, mostrando linhas-guia.')),

			section(t('Perfil')),
			item(t('Restaurar layout padrão'), async () => {
				if (await confirmDialog({ title: t('Restaurar padrão'), message: t('Substitui os controles deste perfil pelo layout padrão do Blockbench (ainda dá para descartar).'), confirmLabel: t('Restaurar'), danger: true })) {
					Controls.replaceLayout(defaultLayout());
					toast(t('Layout padrão restaurado'));
				}
			}, { icon: '↺', kind: 'danger' }),
			item(t('Descartar alterações'), async () => {
				if (await confirmDialog({ title: t('Descartar alterações'), message: t('Volta o perfil ao estado em que estava antes de começar a editar e sai da edição.'), confirmLabel: t('Descartar'), danger: true })) {
					Controls.cancelEditing(); closeAll(); toast(t('Alterações descartadas'));
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
	if (w.AndroidBridge?.active) w.AndroidBridge.exportFile(opts, () => toast(t('Perfil exportado: ') + file));
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
	const dr: Drawer = openDrawer({ id: 'profiles', title: t('Trocar Perfil de Touch') });
	const draw = () => {
		const B = dr.body;
		const keepScroll = B.scrollTop;
		B.replaceChildren();
		const activeId = Controls.activeId;
		B.append(
			item(t('Nenhum (desativar controles)'), () => { Controls.setActive(null); toast(t('Controles de touch desativados')); }, { icon: activeId === null ? '✓' : '○' }),
			section(t('Perfis')),
		);
		const list = Controls.profiles();
		if (!list.length) B.append(hint(t('Nenhum perfil ainda. Crie um novo ou importe um arquivo de controles do PojavLauncher (.json).')));
		for (const p of list) {
			const sel = item(p.name, () => { Controls.setActive(p.id); toast(t('Perfil ativo: ') + p.name); }, { icon: p.id === activeId ? '✓' : '○' });
			const mini = (txt: string, label: string, fn: () => void) => {
				const b = h('button', { class: 'bbk-icon', title: label, 'aria-label': label }, txt);
				b.addEventListener('click', fn);
				return b;
			};
			B.append(h('div', { class: 'bbk-row profile' }, sel,
				mini('⬆', t('Exportar'), () => { const e = Controls.exportProfile(p.id); if (e) saveJson(e.name, e.json); }),
				mini('✎', t('Renomear'), async () => { const n = await promptDialog({ title: t('Renomear perfil'), value: p.name }); if (n) Controls.renameProfile(p.id, n); }),
				mini('🗑', t('Excluir'), async () => { if (await confirmDialog({ title: t('Excluir perfil'), message: t('Excluir "{0}"?', p.name), confirmLabel: t('Excluir'), danger: true })) Controls.deleteProfile(p.id); })));
		}
		B.append(
			section(t('Adicionar')),
			item(t('Novo perfil (layout padrão)'), async () => {
				const name = await promptDialog({ title: t('Nome do perfil'), value: 'Blockbench ' + (list.length + 1) });
				if (!name) return;
				Controls.setActive(Controls.createProfile(name));
			}, { icon: '＋' }),
			item(t('Importar perfil (.json do Pojav)'), async () => {
				const f = await pickFile('.json,application/json,text/plain');
				if (!f) return;
				try {
					const id = Controls.importProfile(f.name.replace(/\.[^.]+$/, '') || t('Importado'), await f.text());
					Controls.setActive(id);
					toast(t('Perfil importado'));
				} catch (e: any) { toast(t('Falha ao importar: ') + (e?.message || e), 4500); }
			}, { icon: '⬇', hint: t('Compatível com o formato de controles do PojavLauncher (v2–v8)') }),
		);
		B.scrollTop = keepScroll;
	};
	draw();
	const un = Controls.subscribe(() => { if (dr.el.isConnected) draw(); });
	const close = dr.close;
	dr.close = () => { un(); close(); };
}
