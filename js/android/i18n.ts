/**
 * Idiomas do fork Android. As chaves são os próprios textos em português (pt-BR), então `t('texto')` devolve o
 * texto original em pt-BR e a tradução nos demais. Padrão: inglês. Textos com variáveis usam {0}, {1}...
 * O idioma do menu (o fork) e o do Blockbench inteiro são guardados separadamente: ver `applyLanguageChoice`.
 */
import { DICT } from './i18n_dict';

export type LangCode = 'en' | 'pt-BR' | 'es' | 'ru' | 'zh';
export const LANGS: { code: LangCode; name: string; blockbench: string }[] = [
	{ code: 'en', name: 'English', blockbench: 'en' },
	{ code: 'pt-BR', name: 'Português (Brasil)', blockbench: 'pt_br' },
	{ code: 'es', name: 'Español', blockbench: 'es' },
	{ code: 'ru', name: 'Русский', blockbench: 'ru' },
	{ code: 'zh', name: '中文', blockbench: 'zh' },
];
export const DEFAULT_LANG: LangCode = 'en';

const KEY_LANG = 'bb_android_lang';           // idioma do menu do fork
const KEY_DONE = 'bb_android_lang_done';      // a escolha inicial (obrigatória) já foi feita?
const KEY_SCOPE = 'bb_android_lang_scope';    // 'app' | 'menu'

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* bloqueado */ } };

let current: LangCode | null = null;
export function getLang(): LangCode {
	if (current) return current;
	const v = read(KEY_LANG) as LangCode | null;
	current = v && LANGS.some(l => l.code === v) ? v : DEFAULT_LANG;
	return current;
}
export const langChosen = () => read(KEY_DONE) === '1';
export const getScope = (): 'app' | 'menu' => (read(KEY_SCOPE) === 'app' ? 'app' : 'menu');

export function fmt(s: string, args: any[]): string {
	return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m)) : s;
}

/** Traduz um texto escrito em pt-BR. Sem tradução, cai para o inglês e por fim para o próprio texto. */
export function t(pt: string, ...args: any[]): string {
	const l = getLang();
	if (l === 'pt-BR') return fmt(pt, args);
	const d = DICT as Record<string, Record<string, string>>;
	return fmt(d[l]?.[pt] ?? d.en?.[pt] ?? pt, args);
}

/** Grava a escolha. Em "app" também ajusta o idioma do próprio Blockbench (vale após recarregar). */
export function applyLanguageChoice(code: LangCode, scope: 'app' | 'menu') {
	current = code;
	write(KEY_LANG, code);
	write(KEY_SCOPE, scope);
	write(KEY_DONE, '1');
	if (scope === 'app') setBlockbenchLanguage(LANGS.find(l => l.code === code)!.blockbench);
}

function setBlockbenchLanguage(bb: string) {
	try {
		const w = window as any;
		if (w.settings?.language) { w.settings.language.value = bb; w.Settings?.saveLocalStorages?.(); }
	} catch { /* o Blockbench ainda não terminou de carregar */ }
	try {
		const raw = read('settings');
		const obj = raw ? JSON.parse(raw) : {};
		obj.language = { ...(obj.language || {}), value: bb };
		write('settings', JSON.stringify(obj));
	} catch { /* ok */ }
}

/** Usa um idioma só na tela (sem gravar), para mostrar o passo seguinte já traduzido. */
export function previewLanguage(code: LangCode) { current = code; }
export const blockbenchLanguage = (): string => { try { return (window as any).Language?.code || 'en'; } catch { return 'en'; } };
