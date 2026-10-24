// Theme colors for the canvas, read from the CSS variables of the current Obsidian theme (light, dark or custom).

export interface Theme {
	background: string;
	node: string;
	line: string;
	shared: string;
	text: string;
	accent: string;
	/** Heading and block nodes: the node color mixed toward the background. */
	sub?: string;
	font: string;
	/** Category colors (8). */
	palette: string[];
	/** Number bins, low to high (5). */
	ramp: string[];
}

const PALETTE_VARS = ['--color-blue', '--color-orange', '--color-green', '--color-purple', '--color-red', '--color-cyan', '--color-yellow', '--color-pink'];

/** "#rgb", "#rrggbb" or "rgb(a)(r, g, b)" -> [r, g, b]; null for anything else. */
export function parseRgb(css: string): [number, number, number] | null {
	const s = css.trim();
	let m = /^#([0-9a-f]{3})$/i.exec(s);
	if (m) return [0, 1, 2].map((k) => parseInt(m![1]![k]! + m![1]![k]!, 16)) as [number, number, number];
	m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
	if (m) return [0, 2, 4].map((k) => parseInt(m![1]!.slice(k, k + 2), 16)) as [number, number, number];
	m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
	if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
	return null;
}

/** Mixes two colors: t = 0 gives a, t = 1 gives b. Returns "#rrggbb", or a when a color cannot be read. */
export function mix(a: string, b: string, t: number): string {
	const x = parseRgb(a);
	const y = parseRgb(b);
	if (!x || !y) return a;
	const hex = x.map((v, k) => Math.round(v + (y[k]! - v) * t).toString(16).padStart(2, '0'));
	return `#${hex.join('')}`;
}

/** The CSS color as the canvas reads it ("#rrggbb" or "rgba(...)"), so the mixing above works for hsl() and names. */
function normalize(ctx: CanvasRenderingContext2D | null, css: string, fallback: string): string {
	const v = css.trim();
	if (!v || !ctx) return v || fallback;
	ctx.fillStyle = fallback;
	ctx.fillStyle = v;
	return String(ctx.fillStyle);
}

/** Reads the theme from the element's computed style. */
export function readTheme(el: HTMLElement, canvas: HTMLCanvasElement): Theme {
	const cs = getComputedStyle(el);
	const ctx = canvas.getContext('2d');
	const get = (name: string, fallback: string) => normalize(ctx, cs.getPropertyValue(name), fallback);
	const accent = get('--interactive-accent', '#7b6cd9');
	const background = get('--background-primary', '#ffffff');
	const palette = PALETTE_VARS.map((v, i) => get(v, ['#086ddd', '#ec7500', '#08b94e', '#7852ee', '#e93147', '#00bfbc', '#e0ac00', '#d53984'][i]!));
	const low = palette[5]!;
	const high = palette[3]!;
	const node = get('--graph-node', get('--text-muted', '#888888'));
	return {
		background,
		node,
		sub: mix(node, background, 0.4),
		line: get('--graph-line', get('--background-modifier-border', '#cccccc')),
		shared: accent,
		text: get('--graph-text', get('--text-normal', '#222222')),
		accent,
		font: cs.getPropertyValue('--font-interface').trim() || 'sans-serif',
		palette,
		ramp: [0, 0.25, 0.5, 0.75, 1].map((t) => mix(low, high, t)),
	};
}
