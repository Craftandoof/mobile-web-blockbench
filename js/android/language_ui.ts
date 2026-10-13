/** Escolha de idioma: obrigatória na primeira abertura; depois, disponível em Configurações Persistentes. */
import { t, LANGS, LangCode, getLang, getScope, previewLanguage, applyLanguageChoice, blockbenchLanguage } from './i18n';
import { UI_CLASS } from './input_emulator';
import { h, getRoot, item, toast, closeAll } from './ui_kit';

interface Opt<T> { value: T; label: string; hint?: string; on?: boolean }

/** Lista de opções em um modal. Com `mandatory`, não há como fechar sem escolher. */
function choose<T>(o: { title: string; message?: string; options: Opt<T>[]; mandatory?: boolean }): Promise<T | null> {
	return new Promise(resolve => {
		const done = (v: T | null) => { modal.remove(); resolve(v); };
		const list = h('div', { class: 'bbk-list' }, ...o.options.map(op => {
			const b = h('button', { class: 'bbk-opt' + (op.on ? ' on' : '') }, op.label, op.hint ? h('small', { style: 'display:block;opacity:.8;font-size:12px;margin-top:2px' }, op.hint) : null);
			b.addEventListener('click', () => done(op.value));
			return b;
		}));
		const modal = h('div', { class: 'bbk-modal ' + UI_CLASS, style: 'z-index:100000' },
			h('div', {}, h('h3', {}, o.title), o.message ? h('p', {}, o.message) : null, list,
				o.mandatory ? null : h('div', { class: 'bbk-actions' }, item(t('Cancelar'), () => done(null)))));
		getRoot().appendChild(modal);
	});
}

/** Fluxo completo. Devolve true se algo foi gravado. */
export async function runLanguageFlow(mandatory: boolean): Promise<boolean> {
	const before = getLang();
	let code: LangCode | null = null;
	let scope: 'app' | 'menu' | null = null;
	while (!scope) {
		previewLanguage(before);
		code = await choose<LangCode>({
			title: t('Escolha o idioma'),
			message: mandatory ? undefined : undefined,
			mandatory,
			options: LANGS.map(l => ({ value: l.code, label: l.name, on: l.code === before })),
		});
		if (!code) { previewLanguage(before); return false; }
		previewLanguage(code);
		scope = await choose<'app' | 'menu'>({
			title: t('Aplicar o idioma em:'),
			message: t('Você poderá mudar depois em Configurações Persistentes.'),
			mandatory,
			options: [
				{ value: 'app', label: t('O app inteiro'), hint: t('Também traduz o próprio Blockbench (recarrega o app para aplicar).'), on: getScope() === 'app' },
				{ value: 'menu', label: t('Somente o menu'), hint: t('Só os menus e controles deste app; o Blockbench continua no idioma dele.'), on: getScope() === 'menu' },
			],
		});
		if (!scope && !mandatory) { previewLanguage(before); return false; }
		// obrigatório: se a escolha do escopo foi cancelada (não deveria), volta ao início
	}
	const bbBefore = blockbenchLanguage();
	applyLanguageChoice(code!, scope);
	const bbTarget = LANGS.find(l => l.code === code)!.blockbench;
	if (scope === 'app' && bbBefore !== bbTarget) {
		toast(t('Idioma alterado'), 1500);
		setTimeout(() => location.reload(), 600);
	} else {
		closeAll();
		toast(t('Idioma alterado'));
	}
	return true;
}
