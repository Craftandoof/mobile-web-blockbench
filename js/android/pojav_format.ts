/**
 * Port do formato de controles do PojavLauncher (CustomControls / ControlData / ControlDrawerData /
 * ControlJoystickData, versão 8). Os nomes dos campos são IDÊNTICOS aos do Gson do Pojav, então os
 * arquivos .json trocam de mão entre os dois sem conversão.
 * Fonte: net.kdt.pojavlaunch.customcontrols.* (PojavLauncherTeam/PojavLauncher, ramo v3_openjdk)
 */

export const SPECIAL = {
	KEYBOARD: -1, TOGGLECTRL: -2, MOUSEPRI: -3, MOUSESEC: -4, VIRTUALMOUSE: -5,
	MOUSEMID: -6, SCROLLUP: -7, SCROLLDOWN: -8, MENU: -9,
} as const;

export const SPECIAL_LIST: { code: number; name: string; label: string }[] = [
	{ code: -1, name: 'Keyboard', label: 'Teclado' },
	{ code: -2, name: 'GUI', label: 'Mostrar/ocultar controles (GUI)' },
	{ code: -3, name: 'PRI', label: 'Mouse: botão esquerdo' },
	{ code: -4, name: 'SEC', label: 'Mouse: botão direito' },
	{ code: -5, name: 'Mouse', label: 'Mouse virtual (liga/desliga)' },
	{ code: -6, name: 'MID', label: 'Mouse: botão do meio' },
	{ code: -7, name: 'SCROLLUP', label: 'Rolar para cima' },
	{ code: -8, name: 'SCROLLDOWN', label: 'Rolar para baixo' },
	{ code: -9, name: 'MENU', label: 'Menu do app' },
];

export type Orientation = 'DOWN' | 'LEFT' | 'UP' | 'RIGHT' | 'FREE';
export const ORIENTATIONS: Orientation[] = ['DOWN', 'LEFT', 'UP', 'RIGHT', 'FREE'];

export interface ControlData {
	name: string;
	dynamicX: string;
	dynamicY: string;
	width: number;   // dp
	height: number;  // dp
	keycodes: number[]; // 4 posições; 0 = vazio; negativo = botão especial
	isToggle: boolean;
	passThruEnabled: boolean;
	isSwipeable: boolean;
	opacity: number;       // 0..1
	bgColor: number;       // ARGB com sinal (int32), como no Java
	strokeColor: number;
	strokeWidth: number;   // dp
	cornerRadius: number;  // 0..100 %
	displayInGame: boolean;
	displayInMenu: boolean;
	[extra: string]: any;  // campos desconhecidos passam intactos (round-trip)
}
export interface DrawerData {
	buttonProperties: ControlData[];
	properties: ControlData;
	orientation: Orientation;
}
export interface JoystickData extends ControlData {
	forwardLock: boolean;
	absolute: boolean;
}
export interface Layout {
	version: number;
	scaledAt: number;
	mControlDataList: ControlData[];
	mDrawerDataList: DrawerData[];
	mJoystickDataList: JoystickData[];
}

export const LAYOUT_VERSION = 8;

// ---------------------------------------------------------------- construtores com os defaults do Pojav

export function inflateKeycodes(k: number[] | undefined): number[] {
	const out = [0, 0, 0, 0];
	(k || []).slice(0, 4).forEach((v, i) => { out[i] = Number(v) || 0; });
	return out;
}

export function newControl(p: Partial<ControlData> = {}): ControlData {
	return {
		name: 'button', dynamicX: '0.5 * ${screen_width}', dynamicY: '0.5 * ${screen_height}',
		width: 50, height: 50, isToggle: false, passThruEnabled: false, isSwipeable: false,
		opacity: 1, bgColor: 0x4D000000 | 0, strokeColor: 0xFFFFFFFF | 0, strokeWidth: 0, cornerRadius: 0,
		displayInGame: true, displayInMenu: true,
		...p,
		keycodes: inflateKeycodes(p.keycodes),
	};
}
export function newDrawer(p: Partial<ControlData> = {}): DrawerData {
	return { buttonProperties: [], properties: newControl({ name: 'Drawer', ...p }), orientation: 'LEFT' };
}
export function newJoystick(p: Partial<ControlData> = {}): JoystickData {
	return { ...newControl({ name: 'joystick', width: 130, height: 130, cornerRadius: 100, ...p }), forwardLock: false, absolute: false };
}
export function newLayout(): Layout {
	return { version: LAYOUT_VERSION, scaledAt: 100, mControlDataList: [], mDrawerDataList: [], mJoystickDataList: [] };
}

export function specialButton(code: number, x = '${margin}', y = '${margin}'): ControlData {
	const s = SPECIAL_LIST.find(e => e.code === code)!;
	const wide = code === SPECIAL.KEYBOARD || code === SPECIAL.VIRTUALMOUSE;
	return newControl({ name: s.name, keycodes: [code], dynamicX: x, dynamicY: y, width: wide ? 80 : 50, height: wide ? 30 : 50 });
}

export function cloneControl<T extends ControlData>(c: T): T {
	return JSON.parse(JSON.stringify(c));
}
export function cloneLayout(l: Layout): Layout {
	return JSON.parse(JSON.stringify(l));
}

// ---------------------------------------------------------------- cores

/** int32 ARGB (Java) → rgba() CSS */
export function argbToCss(n: number): string {
	const u = n >>> 0;
	const a = ((u >>> 24) & 255) / 255;
	return `rgba(${(u >>> 16) & 255}, ${(u >>> 8) & 255}, ${u & 255}, ${Math.round(a * 1000) / 1000})`;
}
/** #rrggbb + alpha(0..1) → int32 ARGB (Java) */
export function cssToArgb(hex: string, alpha: number): number {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	const rgb = m ? parseInt(m[1], 16) : 0;
	const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
	return ((a << 24) | rgb) | 0;
}
export function argbToHex(n: number): string {
	return '#' + ((n >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
}
export function argbAlpha(n: number): number {
	return ((n >>> 24) & 255) / 255;
}

// ---------------------------------------------------------------- avaliador de ${variáveis} + matemática

export interface PosVars { [k: string]: number }

/** Mesma semântica do Pojav: ${var} → valor; depois + - * / ( ) e as funções dp() e px(). */
export function evalDynamic(expr: string, vars: PosVars, dpr: number): number {
	const text = String(expr).replace(/\$\{(\w+)\}/g, (_, name) => {
		if (!(name in vars)) throw new Error('Variável desconhecida: ' + name);
		return '(' + vars[name] + ')';
	});
	let i = 0;
	const peek = () => text[i];
	const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
	function number(): number {
		ws();
		const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
		if (!m) throw new Error('Expressão inválida em: ' + text.slice(i, i + 12));
		i += m[0].length;
		return parseFloat(m[0]);
	}
	function primary(): number {
		ws();
		const c = peek();
		if (c === '(') { i++; const v = sum(); ws(); if (peek() !== ')') throw new Error('Falta )'); i++; return v; }
		if (c === '-') { i++; return -primary(); }
		if (c === '+') { i++; return primary(); }
		if (c && /[a-z]/i.test(c)) {
			const m = /^[a-z_]\w*/i.exec(text.slice(i))!;
			i += m[0].length;
			ws();
			if (peek() !== '(') throw new Error('Função inválida: ' + m[0]);
			i++; const arg = sum(); ws(); if (peek() !== ')') throw new Error('Falta )'); i++;
			if (m[0] === 'dp') return arg / dpr;   // px → dp
			if (m[0] === 'px') return arg * dpr;   // dp → px
			throw new Error('Função desconhecida: ' + m[0]);
		}
		return number();
	}
	function product(): number {
		let v = primary();
		for (;;) {
			ws();
			if (peek() === '*') { i++; v *= primary(); }
			else if (peek() === '/') { i++; v /= primary(); }
			else return v;
		}
	}
	function sum(): number {
		let v = product();
		for (;;) {
			ws();
			if (peek() === '+') { i++; v += product(); }
			else if (peek() === '-') { i++; v -= product(); }
			else return v;
		}
	}
	const result = sum();
	ws();
	if (i < text.length) throw new Error('Sobrou texto na expressão: ' + text.slice(i, i + 12));
	return result;
}

// ---------------------------------------------------------------- importação / conversão de versões

function fillControl(raw: any): ControlData {
	const base = newControl();
	const c: ControlData = Object.assign(base, raw || {});
	c.keycodes = inflateKeycodes(raw?.keycodes);
	if (typeof c.dynamicX !== 'string' || !c.dynamicX.trim()) c.dynamicX = '0';
	if (typeof c.dynamicY !== 'string' || !c.dynamicY.trim()) c.dynamicY = '0';
	// campos só de runtime/obsoletos não precisam ir adiante
	delete c.isHideable;
	return c;
}

function convertStrokeWidth(l: Layout, dpr: number) {
	const conv = (stroke: number, w: number, h: number) => {
		const max = Math.max(w * dpr, h * dpr);
		return Math.trunc((max / 2) * (stroke / 100)) / dpr;
	};
	l.mControlDataList.forEach(d => { d.strokeWidth = conv(d.strokeWidth, d.width, d.height); });
	l.mDrawerDataList.forEach(d => {
		d.properties.strokeWidth = conv(d.properties.strokeWidth, d.properties.width, d.properties.height);
		d.buttonProperties.forEach(b => { b.strokeWidth = conv(b.strokeWidth, d.properties.width, d.properties.width); });
	});
}

/**
 * Lê um layout do Pojav (versões 2 a 8) e devolve no formato v8.
 * v1 (anterior a 2021) não tem versão e usa percentuais: não suportado.
 */
export function parseLayout(input: string | object, dpr = 1, screenPx = { w: 1920, h: 1080 }): Layout {
	let raw: any;
	try { raw = typeof input === 'string' ? JSON.parse(input) : input; }
	catch { throw new Error('Arquivo não é um JSON válido.'); }
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Formato de controles inválido.');
	if (!('version' in raw)) throw new Error('Layout v1 do Pojav (sem "version") não é suportado.');
	const version = Number(raw.version);
	if (!(version >= 2 && version <= 8)) throw new Error('Versão de layout não suportada: ' + raw.version);

	const layout = newLayout();
	layout.scaledAt = Number(raw.scaledAt) > 0 ? Number(raw.scaledAt) : 100;
	layout.mControlDataList = (raw.mControlDataList || []).map((r: any) => {
		const c = fillControl(r);
		if (version === 2) {
			if (!r.dynamicX && typeof r.x === 'number') c.dynamicX = (r.x / screenPx.w) + ' * ${screen_width}';
			if (!r.dynamicY && typeof r.y === 'number') c.dynamicY = (r.y / screenPx.h) + ' * ${screen_height}';
		}
		return c;
	});
	layout.mDrawerDataList = (raw.mDrawerDataList || []).map((r: any) => {
		const props = fillControl(r.properties);
		if (version === 2) {
			if (!r.properties?.dynamicX && typeof r.properties?.x === 'number') props.dynamicX = (r.properties.x / screenPx.w) + ' * ${screen_width}';
			if (!r.properties?.dynamicY && typeof r.properties?.y === 'number') props.dynamicY = (r.properties.y / screenPx.h) + ' * ${screen_height}';
		}
		const o = ORIENTATIONS.includes(r.orientation) ? r.orientation : 'LEFT';
		return { buttonProperties: (r.buttonProperties || []).map(fillControl), properties: props, orientation: o } as DrawerData;
	});
	layout.mJoystickDataList = (raw.mJoystickDataList || []).map((r: any) => {
		const j = fillControl(r) as JoystickData;
		j.forwardLock = !!r?.forwardLock;
		j.absolute = !!r?.absolute;
		return j;
	});

	if (version <= 5) convertStrokeWidth(layout, dpr);          // v3–5 → v6
	if (version <= 7) {                                          // v6–7 → v8: joystick deve ser quadrado
		for (const d of layout.mJoystickDataList) {
			if (d.height > d.width) {
				const ratio = d.height / d.width;
				d.dynamicX = d.dynamicX.split('${height}').join('(' + ratio + ' * ${height})');
				d.dynamicY = d.dynamicY.split('${height}').join('(' + ratio + ' * ${height})') + ' + (' + (ratio - 1) + ' * ${height})';
				d.height = d.width;
			}
		}
	}
	layout.version = LAYOUT_VERSION;
	return layout;
}

export function serializeLayout(l: Layout): string {
	const out = { ...l, version: LAYOUT_VERSION };
	return JSON.stringify(out, (k, v) => (k.startsWith('_') ? undefined : v), 2);
}
