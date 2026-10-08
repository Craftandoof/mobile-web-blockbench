/**
 * Converte o `content` que o Blockbench entrega ao exportar em bytes + base64 para o módulo nativo gravar.
 * Sem FileReader/Blob no meio: o conteúdo vira Uint8Array direto e o tamanho é conferido na gravação,
 * para um arquivo nunca sair "vazio" em silêncio.
 */

function dataUrlToBytes(url: string): Uint8Array {
	const comma = url.indexOf(',');
	if (comma < 0) throw new Error('data URL inválida');
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
	if (content === undefined || content === null) throw new Error('o Blockbench não entregou conteúdo para salvar');
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
	throw new Error('tipo de conteúdo não suportado para salvar: ' + Object.prototype.toString.call(content));
}

export function bytesToBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let bin = '';
	for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
	return btoa(bin);
}
