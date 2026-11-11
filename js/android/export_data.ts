/**
 * Converte o `content` que o Blockbench entrega ao exportar em bytes + base64 para o módulo nativo gravar.
 * Sem FileReader/Blob no meio: o conteúdo vira Uint8Array direto e o tamanho é conferido na gravação,
 * para um arquivo nunca sair "vazio" em silêncio.
 */
import { t } from './i18n';

function dataUrlToBytes(url: string): Uint8Array {
	const comma = url.indexOf(',');
	if (comma < 0) throw new Error(t('data URL inválida'));
	const meta = url.slice(5, comma), payload = url.slice(comma + 1);
	if (/;base64/i.test(meta)) {
		const bin = atob(payload.replace(/\s/g, ''));
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	return new TextEncoder().encode(decodeURIComponent(payload));
}

export async function contentToBytes(content: any, savetype?: string): Promise<Uint8Array> {
	if (content && typeof content.then === 'function') content = await content;
	if (typeof content === 'function') content = await content();
	if (content === undefined || content === null) throw new Error(t('o Blockbench não entregou conteúdo para salvar'));
	if (typeof content === 'string') {
		if (savetype === 'image' && /^data:/i.test(content)) return dataUrlToBytes(content);
		if (savetype === 'image' && /^(blob:|https?:)/i.test(content)) {
			const res = await fetch(content);
			return new Uint8Array(await res.arrayBuffer());
		}
		return new TextEncoder().encode(content);
	}
	if (typeof Blob !== 'undefined' && content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
	if (content instanceof ArrayBuffer) return new Uint8Array(content.slice(0));
	if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
	if (Array.isArray(content) && content.every(n => typeof n === 'number')) return Uint8Array.from(content);
	throw new Error(t('tipo de conteúdo não suportado para salvar: ') + Object.prototype.toString.call(content));
}

export function bytesToBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let bin = '';
	for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
	return btoa(bin);
}

// ---- envio em pedaços para o arquivo temporário nativo (BBNativeStage)
export interface StageApi { begin(): string; append(id: string, b64: string): string; size(id: string): string; discard(id: string): string }
export const stageApi = (): StageApi | null => (typeof window !== 'undefined' && (window as any).BBNativeStage) || null;

const ok = (r: string): string => {
	if (typeof r !== 'string' || r[0] !== 'O') throw new Error(typeof r === 'string' && r.startsWith('E:') ? r.split(':').slice(2).join(':') : t('resposta inválida do módulo nativo'));
	return r.slice(1);
};

/** Grava os bytes no arquivo temporário nativo, em pedaços de 384 KB (nunca um base64 gigante de uma vez). Devolve o id. */
export function stageBytes(bytes: Uint8Array): string {
	const api = stageApi();
	if (!api) throw new Error(t('módulo nativo de preparo indisponível'));
	const id = ok(api.begin());
	try {
		const STEP = 384 * 1024;
		for (let i = 0; i < bytes.length; i += STEP) ok(api.append(id, bytesToBase64(bytes.subarray(i, i + STEP))));
		if (Number(ok(api.size(id))) !== bytes.length) throw new Error(t('o arquivo temporário ficou com tamanho diferente'));
		return id;
	} catch (e) {
		try { api.discard(id); } catch { /* ok */ }
		throw e;
	}
}
export const discardStage = (id: string) => { try { stageApi()?.discard(id); } catch { /* ok */ } };
