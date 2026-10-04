/**
 * "Ignorar limitação de arquivo": o Blockbench passa ao seletor de arquivos uma lista de extensões
 * (ex.: plugins = ".js", modelos = ".bbmodel,.json,..."). No Android o seletor do sistema usa essa lista como
 * filtro de tipo MIME e acaba escondendo/recusando arquivos que o Blockbench consegue ler (como plugins .js).
 * Com a opção ligada o seletor abre SEM filtro e a extensão deixa de ser exigida.
 */
import { Store } from './ui_kit';

const KEY = 'ignore_file_limits';

export const ignoreFileLimits = (): boolean => Store.get<boolean>(KEY, false);
export const setIgnoreFileLimits = (on: boolean) => Store.set(KEY, on);

/** Abre o seletor de arquivos sem nenhum filtro de tipo. */
export function pickAnyFile(multiple: boolean, cb: (files: File[]) => void) {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = multiple;
	// sem atributo accept: o Android lista todos os arquivos
	input.style.cssText = 'position:fixed;left:-999px;top:-999px;opacity:0';
	input.addEventListener('change', () => {
		const files = Array.from(input.files || []);
		input.remove();
		if (files.length) cb(files);
	});
	input.addEventListener('cancel', () => input.remove());
	document.body.appendChild(input);
	input.click();
}
