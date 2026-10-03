/** Menu flutuante do fork Android: botão ☰ no topo central + menus laterais empilhados. */
import { Controls } from './touch_controls';
import * as Input from './input_emulator';
import { UI_CLASS } from './input_emulator';
import { KEYS } from './keymap';
import { openEditorDrawer, openProfilesDrawer } from './touch_editor';
import {
	h, Store, injectStyle, getRoot, applyScale, openDrawer, closeAll, drawerCount, topDrawer,
	item, section, hint, slider, toggleItem, selectRow, row, toast, confirmDialog,
} from './ui_kit';

export interface MenuHost {
	isNative: boolean;
	keepAliveEnabled(): boolean;
	setKeepAlive(on: boolean): Promise<void>;
	forceQuit(): Promise<void>;
	flush(): void;
}

const FORCE_DESKTOP_KEY = 'bb_android_force_desktop'; // lido também pelo script injetado no index.html

export const isForceDesktop = () => { try { return localStorage.getItem(FORCE_DESKTOP_KEY) === '1'; } catch { return false; } };

let host: MenuHost;
let fab: HTMLElement;

// ------------------------------------------------------------------ FAB

function applyFabOpacity() {
	const pct = Store.get<number>('fab_opacity', 100);
	fab.style.opacity = String(Math.max(0, Math.min(100, pct)) / 100);
}

function toggleMain() {
	if (drawerCount() > 0) closeAll(); else openMain();
}

// ------------------------------------------------------------------ menu principal

function openMain() {
	const dr = openDrawer({ title: 'Blockbench Android', side: 'left' });
	dr.body.append(
		item('Enviar Input', () => openSendInput(), { icon: '⌨', hint: 'Digitar texto e enviar teclas/atalhos para o Blockbench' }),
		item('Abrir Configurações Persistentes', () => openSettings(), { icon: '⚙', hint: 'Menu flutuante, Keep Alive, modo computador e controles de touch' }),
		item('Forçar Encerramento', () => forceQuit(), { icon: '⏻', kind: 'danger', hint: 'Fecha o Blockbench e o serviço Keep Alive' }),
	);
}

async function forceQuit() {
	const ok = await confirmDialog({
		title: 'Forçar Encerramento',
		message: 'O Blockbench e o serviço Keep Alive serão encerrados. Os projetos abertos ficam no backup automático e voltam na próxima abertura.',
		confirmLabel: 'Encerrar', danger: true,
	});
	if (!ok) return;
	try { host.flush(); } catch { /* segue */ }
	toast('Encerrando…', 1200);
	setTimeout(() => { host.forceQuit().catch(() => window.close()); }, 450);
}

// ------------------------------------------------------------------ Enviar Input

const QUICK_KEYS: [string, number][] = [
	['Esc', 256], ['Enter', 257], ['Tab', 258], ['⌫', 259], ['Del', 261],
	['←', 263], ['↑', 265], ['↓', 264], ['→', 262], ['Home', 268], ['End', 269], ['PgUp', 266], ['PgDn', 267],
];

function openSendInput() {
	const dr = openDrawer({ title: 'Enviar Input', side: 'left' });
	const mods = { ctrl: false, shift: false, alt: false };
	const MODK = { ctrl: 341, shift: 340, alt: 342 } as const;

	const withMods = (fn: () => void) => {
		Input.refocusExternal();
		(Object.keys(mods) as (keyof typeof mods)[]).forEach(m => { if (mods[m]) Input.keyDown(MODK[m]); });
		try { fn(); } finally {
			(Object.keys(mods) as (keyof typeof mods)[]).forEach(m => { if (mods[m]) Input.keyUp(MODK[m]); });
		}
	};

	const ta = h('textarea', { class: 'bbk-text', rows: 3, placeholder: 'Texto para enviar…', style: 'width:100%;margin-bottom:8px' });
	const send = item('Enviar texto', () => {
		const t = ta.value;
		if (!t) return;
		withMods(() => Input.typeText(t));
		ta.value = '';
	}, { icon: '➤', kind: 'primary' });

	const modChips = h('div', { class: 'bbk-chips' });
	(['ctrl', 'shift', 'alt'] as const).forEach(m => {
		const c = h('button', { class: 'bbk-chip' }, m === 'ctrl' ? 'Ctrl' : m === 'shift' ? 'Shift' : 'Alt');
		c.addEventListener('click', () => { mods[m] = !mods[m]; c.classList.toggle('on', mods[m]); });
		modChips.append(c);
	});

	const quick = h('div', { class: 'bbk-chips' }, ...QUICK_KEYS.map(([label, code]) => {
		const c = h('button', { class: 'bbk-chip' }, label);
		c.addEventListener('click', () => withMods(() => Input.tapKey(code)));
		return c;
	}));

	let chosen = 83; // S (Ctrl+S)
	const keySel = selectRow('Tecla', KEYS.map(k => ({ value: String(k.glfw), label: k.label, group: k.glfw >= 290 && k.glfw <= 314 ? 'Funções' : k.glfw < 128 ? 'Caracteres' : 'Outras' })), String(chosen), v => { chosen = Number(v); });

	dr.body.append(
		hint('O texto vai para o campo do Blockbench que estava em foco (ou para a janela, se nenhum).'),
		ta, send,
		section('Modificadores (valem para os envios abaixo)'), modChips,
		section('Teclas rápidas'), quick,
		section('Qualquer tecla'), keySel,
		item('Enviar tecla (com modificadores)', () => withMods(() => Input.tapKey(chosen)), { icon: '⌘' }),
	);
	const close = dr.close;
	dr.close = () => { Input.releaseAllKeys(); close(); };
}

// ------------------------------------------------------------------ Configurações Persistentes

function openSettings() {
	const dr = openDrawer({ title: 'Configurações Persistentes', side: 'right' });
	const B = dr.body;

	B.append(
		section('Menu flutuante'),
		slider('Opacidade do Menu Flutuante', {
			min: 0, max: 100, value: Store.get<number>('fab_opacity', 100), format: v => v + '%',
			onInput: v => { Store.set('fab_opacity', v); applyFabOpacity(); },
		}),
		hint('Em 0% o botão fica invisível, mas continua clicável no centro superior da tela.'),

		section('Processo'),
		toggleItem('Desativar Keep Alive do Blockbench', {
			value: !host.keepAliveEnabled(),
			hint: 'Sem o serviço em primeiro plano o Android pode encerrar o app em segundo plano',
			onChange: async off => {
				try { await host.setKeepAlive(!off); toast(off ? 'Keep Alive desativado' : 'Keep Alive ativado'); }
				catch (e: any) { toast('Falha: ' + (e?.message || e), 3500); }
			},
		}),

		section('Interface'),
		toggleItem('Forçar Versão de Computador (Web)', {
			value: isForceDesktop(),
			hint: 'Usa o layout de desktop do Blockbench em vez do layout para celular',
			onChange: async on => {
				try { localStorage.setItem(FORCE_DESKTOP_KEY, on ? '1' : '0'); } catch { /* ok */ }
				const ok = await confirmDialog({
					title: 'Recarregar interface',
					message: 'Para aplicar, o Blockbench precisa recarregar. Os projetos abertos voltam automaticamente.',
					confirmLabel: 'Recarregar', cancelLabel: 'Depois',
				});
				if (ok) { try { host.flush(); } catch { /* ok */ } setTimeout(() => location.reload(), 500); }
				else toast('Será aplicado na próxima abertura', 3000);
			},
		}),

		section('Controles de touch'),
		item('Editar Perfil de Touch', () => openEditorDrawer(), { icon: '✎', hint: Controls.layout ? 'Perfil ativo: ' + Controls.profileName(Controls.activeId!) : 'Nenhum perfil ativo' }),
		item('Trocar Perfil de Touch', () => openProfilesDrawer(), { icon: '⇄', hint: 'Escolher, criar, importar ou exportar perfis' }),
	);
}

// ------------------------------------------------------------------ inicialização

export function initAndroidUi(h_: MenuHost) {
	host = h_;
	const start = () => {
		injectStyle();
		const root = getRoot();
		fab = h('button', { id: 'bb-android-fab', class: UI_CLASS, 'aria-label': 'Menu do Blockbench Android' }, '☰');
		fab.addEventListener('click', toggleMain);
		root.appendChild(fab);
		applyFabOpacity();
		window.addEventListener('resize', applyScale);
		Controls.onMenu(() => { if (!drawerCount()) openMain(); });
		Controls.init();
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
	else start();
}

export { topDrawer, row };
