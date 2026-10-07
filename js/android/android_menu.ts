/** Menu flutuante do fork Android: botão ☰ arrastável + menus laterais empilhados. */
import { Controls } from './touch_controls';
import * as Input from './input_emulator';
import { UI_CLASS } from './input_emulator';
import { startEditing, openEditMenu, openProfilesDrawer } from './touch_editor';
import { openSendKeyboard } from './send_keyboard';
import { ignoreFileLimits, setIgnoreFileLimits } from './file_limits';
import {
	h, Store, injectStyle, getRoot, applyScale, uiScale, openDrawer, closeAll, drawerCount, focusDrawer,
	item, section, hint, slider, toggleItem, toast, confirmDialog, pickSelectOption,
} from './ui_kit';

export interface MenuHost {
	isNative: boolean;
	keepAliveEnabled(): boolean;
	setKeepAlive(on: boolean): Promise<void>;
	setFullscreen(on: boolean): Promise<void>;
	setFillScreen(on: boolean): Promise<void>;
	pluginCompat: {
		enabled(): boolean;
		setEnabled(on: boolean): void;
		hasAllFilesAccess(): boolean;
		requestAllFilesAccess(): Promise<void>;
		revokeAll(): void;
		permissionCount(): number;
	};
	forceQuit(): Promise<void>;
	flush(): void;
}

const FORCE_DESKTOP_KEY = 'bb_android_force_desktop'; // lido também pelo script injetado no index.html
export const isForceDesktop = () => { try { return localStorage.getItem(FORCE_DESKTOP_KEY) === '1'; } catch { return false; } };

const FAB_BASE = 44;
let host: MenuHost;
let fab: HTMLElement;

// ------------------------------------------------------------------ FAB: opacidade, tamanho, posição

function applyFabOpacity() {
	const pct = Store.get<number>('fab_opacity', 100);
	fab.style.opacity = String(Math.max(0, Math.min(100, pct)) / 100);
}
function fabSizePx() { return FAB_BASE * Math.max(30, Math.min(150, Store.get<number>('fab_size', 100))) / 100; }
function applyFabSize() {
	getRoot().style.setProperty('--fab-size', fabSizePx() + 'px');
	applyFabPos();
}

type FabPos = { x: number; y: number } | null;
/** Posição guardada como fração da tela (centro do botão), para sobreviver a rotação/resize. */
const fabDraggable = () => Store.get<boolean>('fab_draggable', false);
function applyFabPos() {
	const pos = fabDraggable() ? Store.get<FabPos>('fab_pos', null) : null;
	if (!pos) { fab.style.left = ''; fab.style.top = ''; fab.style.transform = ''; return; }
	const u = uiScale(), half = (fabSizePx() * u) / 2;
	const cx = Math.max(half, Math.min(window.innerWidth - half, pos.x * window.innerWidth));
	const cy = Math.max(half, Math.min(window.innerHeight - half, pos.y * window.innerHeight));
	fab.style.left = (cx / u) + 'px';
	fab.style.top = (cy / u) + 'px';
	fab.style.transform = 'translate(-50%, -50%)';
}
function moveFab(clientX: number, clientY: number, persist: boolean) {
	const pos = { x: clientX / window.innerWidth, y: clientY / window.innerHeight };
	Store.set('fab_pos', pos);   // grava sempre: applyFabPos lê do Store e faz o clamp
	applyFabPos();
	if (!persist) return;
}

function setupFabDrag() {
	let drag: { id: number; sx: number; sy: number; moved: boolean } | null = null;
	let suppress = false;
	fab.addEventListener('pointerdown', e => {
		if (!fabDraggable()) return;
		drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
		try { fab.setPointerCapture(e.pointerId); } catch { /* ok */ }
	});
	fab.addEventListener('pointermove', e => {
		if (!drag || e.pointerId !== drag.id) return;
		if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) {
			drag.moved = true;
			fab.classList.add('dragging');
		}
		if (drag.moved) moveFab(e.clientX, e.clientY, false);
	});
	const end = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		if (drag.moved) { suppress = true; setTimeout(() => { suppress = false; }, 80); }
		fab.classList.remove('dragging');
		drag = null;
	};
	fab.addEventListener('pointerup', end);
	fab.addEventListener('pointercancel', end);
	fab.addEventListener('click', () => { if (!suppress) onFabClick(); });
}

function onFabClick() {
	if (drawerCount() > 0) { closeAll(); return; }
	if (Controls.editing) openEditMenu(); else openMain();
}

// ------------------------------------------------------------------ menu principal

function openMain() {
	if (focusDrawer('main')) return;
	const dr = openDrawer({ id: 'main', title: 'Blockbench Android' });
	dr.body.append(
		item('Enviar Input', () => openSendKeyboard(), { icon: '⌨', hint: 'Teclado completo: selecione teclas e envie o atalho de uma vez' }),
		item('Abrir Configurações Persistentes', () => openSettings(), { icon: '⚙', hint: 'Menu flutuante, mouse, Keep Alive, tela cheia e controles de touch' }),
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

// ------------------------------------------------------------------ Configurações Persistentes

function openSettings() {
	if (focusDrawer('settings')) return;
	const dr = openDrawer({ id: 'settings', title: 'Configurações Persistentes' });
	const draw = () => {
		const B = dr.body;
		const keepScroll = B.scrollTop;
		B.replaceChildren();
		B.append(
			section('Menu flutuante'),
			slider('Opacidade do Menu Flutuante', {
				min: 0, max: 100, value: Store.get<number>('fab_opacity', 100), format: v => v + '%',
				onInput: v => { Store.set('fab_opacity', v); applyFabOpacity(); },
			}),
			hint('Em 0% o botão fica invisível, mas continua clicável (e arrastável) onde estiver.'),
			slider('Tamanho do Menu Flutuante', {
				min: 30, max: 150, value: Store.get<number>('fab_size', 100), format: v => v + '%',
				onInput: v => { Store.set('fab_size', v); applyFabSize(); },
			}),
			toggleItem('Menu flutuante deslizável', {
				value: fabDraggable(),
				hint: 'Permite arrastar o botão ☰ para qualquer lugar da tela. Desligado, ele fica fixo no topo central',
				onChange: on => { Store.set('fab_draggable', on); applyFabPos(); draw(); },
			}),
			...(fabDraggable() ? [item('Restaurar posição do menu flutuante', () => { Store.remove('fab_pos'); applyFabPos(); toast('Menu flutuante de volta ao topo central'); }, { icon: '⌖' })] : []),

			section('Mouse virtual'),
			slider('Tamanho do Mouse', {
				min: 25, max: 150, value: Store.get<number>('mouse_size', 100), format: v => v + '%',
				onInput: v => { Store.set('mouse_size', v); Input.setMouseSize(v / 100); },
			}),

			section('Processo'),
			toggleItem('Desativar Keep Alive do Blockbench', {
				value: !host.keepAliveEnabled(),
				hint: 'Sem o serviço em primeiro plano o Android pode encerrar o app em segundo plano',
				onChange: async off => {
					try { await host.setKeepAlive(!off); toast(off ? 'Keep Alive desativado' : 'Keep Alive ativado'); }
					catch (e: any) { toast('Falha: ' + (e?.message || e), 3500); }
				},
			}),

			section('Tela'),
			toggleItem('Modo Tela Cheia (Android)', {
				value: Store.get<boolean>('fullscreen', false),
				hint: 'Esconde a barra de status e a de navegação; deslize da borda para vê-las',
				onChange: async on => {
					Store.set('fullscreen', on);
					try { await host.setFullscreen(on); } catch (e: any) { toast('Falha: ' + (e?.message || e), 3500); }
				},
			}),
			toggleItem('Preencher a tela inteira', {
				value: Store.get<boolean>('fill_screen', false),
				hint: 'Usa também a área do recorte da câmera (notch) e das bordas, sem a faixa preta. Algum botão do Blockbench pode ficar sob a câmera',
				onChange: async on => {
					Store.set('fill_screen', on);
					try { await host.setFillScreen(on); } catch (e: any) { toast('Falha: ' + (e?.message || e), 3500); }
				},
			}),
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

			section('Plugins desktop (Node)'),
			toggleItem('Compatibilidade com plugins desktop', {
				value: host.pluginCompat.enabled(),
				hint: 'Libera na loja os plugins marcados "só no app" e emula fs, path, zlib, crypto e outros módulos do Node. Cada plugin pede permissão antes de acessar arquivos',
				onChange: on => { host.pluginCompat.setEnabled(on); toast(on ? 'Plugins desktop liberados' : 'Plugins desktop bloqueados de novo'); draw(); },
			}),
			item('Acesso a todos os arquivos', async () => {
				if (host.pluginCompat.hasAllFilesAccess()) { toast('O acesso a todos os arquivos já está concedido'); return; }
				try { await host.pluginCompat.requestAllFilesAccess(); toast('Ative "Permitir acesso a todos os arquivos" e volte ao app', 4500); }
				catch (e: any) { toast('Falha: ' + (e?.message || e), 3500); }
			}, { icon: host.pluginCompat.hasAllFilesAccess() ? '✓' : '⚠', hint: host.pluginCompat.hasAllFilesAccess() ? 'Concedido: os plugins podem ler e gravar fora da pasta do app (se você permitir)' : 'Não concedido: sem isso os plugins só enxergam as pastas do próprio app. Toque para conceder' }),
			item('Revogar permissões dos plugins', async () => {
				const n = host.pluginCompat.permissionCount();
				if (!n) { toast('Nenhum plugin tem permissão guardada'); return; }
				if (await confirmDialog({ title: 'Revogar permissões', message: `${n} plugin(s) têm permissões guardadas (arquivos, rede, processos...). Eles vão perguntar de novo.`, confirmLabel: 'Revogar', danger: true })) { host.pluginCompat.revokeAll(); toast('Permissões revogadas'); draw(); }
			}, { icon: '⛔', hint: `${host.pluginCompat.permissionCount()} plugin(s) com permissão guardada` }),

			section('Arquivos'),
			toggleItem('Ignorar limitação de arquivo', {
				value: ignoreFileLimits(),
				hint: 'O seletor lista qualquer tipo de arquivo e o Blockbench deixa de exigir a extensão esperada (.bbmodel, .js dos plugins etc.)',
				onChange: on => { setIgnoreFileLimits(on); toast(on ? 'Limitação de arquivo ignorada' : 'Limitação de arquivo restaurada'); },
			}),

			section('Controles de touch'),
			item('Editar Perfil de Touch', () => { startEditing(); }, {
				icon: '✎',
				hint: Controls.layout ? `Perfil ativo: ${Controls.profileName(Controls.activeId!)} — abre direto o modo de edição` : 'Nenhum perfil ativo — cria um e abre o modo de edição',
			}),
			item('Trocar Perfil de Touch', () => openProfilesDrawer(), { icon: '⇄', hint: 'Escolher, criar, importar ou exportar perfis' }),
		);
		B.scrollTop = keepScroll;
	};
	draw();
	const un = Controls.subscribe(() => { if (dr.el.isConnected) draw(); });
	const onVisible = () => { if (document.visibilityState === 'visible' && dr.el.isConnected) draw(); };
	document.addEventListener('visibilitychange', onVisible);
	const close = dr.close;
	dr.close = () => { un(); document.removeEventListener('visibilitychange', onVisible); close(); };
}

// ------------------------------------------------------------------ inicialização

export function initAndroidUi(h_: MenuHost) {
	host = h_;
	const start = () => {
		injectStyle();
		const root = getRoot();
		fab = h('button', { id: 'bb-android-fab', class: UI_CLASS, 'aria-label': 'Menu do Blockbench Android' }, '☰');
		root.appendChild(fab);
		setupFabDrag();
		applyFabOpacity();
		applyFabSize();
		Input.setMouseSize(Store.get<number>('mouse_size', 100) / 100);
		window.addEventListener('resize', () => { applyScale(); applyFabPos(); });
		document.addEventListener('bb-android-select', (e: any) => pickSelectOption(e.detail));
		Controls.onMenu(() => { if (!drawerCount()) { if (Controls.editing) openEditMenu(); else openMain(); } });
		Controls.subscribe(() => fab.classList.toggle('editing', Controls.editing));
		Controls.init();
		// tela cheia: reaplica ao voltar para o app (o Android pode ter mostrado as barras)
		if (Store.get<boolean>('fullscreen', false)) host.setFullscreen(true).catch(() => { /* sem suporte */ });
		if (Store.get<boolean>('fill_screen', false)) host.setFillScreen(true).catch(() => { /* sem suporte */ });
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible' && Store.get<boolean>('fullscreen', false)) host.setFullscreen(true).catch(() => { /* ok */ });
		});
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
	else start();
}
