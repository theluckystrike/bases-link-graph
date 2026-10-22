// Pure graph logic for the Bases Link Graph view: no Obsidian imports, so vitest and the golden vectors run it as is.
//   buildGraph: rows of a base -> nodes and edges (links between rows, and Pro edges from shared property values)
//   sizeScale / colorScale: a property's values -> node radius and color slot plus legend
//   toSvg: a drawn graph -> a standalone SVG document (Pro export)

export type Scalar = string | number | boolean;
export type PropValue = Scalar | Scalar[] | null;

export type LinkSource = 'all' | 'body' | 'frontmatter';

export interface ResolvedReference {
	target: string | null;
	/** The cache key for a property link. Body links have no key. */
	key?: string;
}

/** Count resolved references, with an optional filter for frontmatter property names. */
export function linkCounts(refs: ResolvedReference[], properties: string[] = []): Record<string, number> {
	const names = properties.map((p) => p.trim().replace(/^note\./, '')).filter(Boolean);
	const counts = new Map<string, number>();
	for (const ref of refs) {
		if (!ref.target) continue;
		// List and object links can have a cache key such as "parent.0" or "parent,0".
		if (names.length > 0 && !names.some((p) => ref.key === p || ref.key?.startsWith(`${p}.`) || ref.key?.startsWith(`${p},`))) continue;
		counts.set(ref.target, (counts.get(ref.target) ?? 0) + 1);
	}
	return Object.fromEntries(counts);
}

/** Relation name for body links and embeds, which have no property key. */
export const BODY_RELATION = 'body';

/** The property name of a cache key: "parent.0", "parent,1" and "parent" all give "parent". */
export function relationName(key: string | undefined): string {
	if (key === undefined) return BODY_RELATION;
	return key.replace(/([.,]\d+)+$/, '');
}

/** Code-unit order, so the result does not depend on the locale. */
function byText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Relation names for each resolved target, sorted. Applies the same property filter as `linkCounts`.
 * A property link is named by its property, a body link or embed is "body". Unresolved targets are skipped.
 */
export function linkRelations(refs: ResolvedReference[], properties: string[] = []): Record<string, string[]> {
	const names = properties.map((p) => p.trim().replace(/^note\./, '')).filter(Boolean);
	const out = new Map<string, Set<string>>();
	for (const ref of refs) {
		if (!ref.target) continue;
		if (names.length > 0 && !names.some((p) => ref.key === p || ref.key?.startsWith(`${p}.`) || ref.key?.startsWith(`${p},`))) continue;
		const set = out.get(ref.target) ?? new Set<string>();
		set.add(relationName(ref.key));
		out.set(ref.target, set);
	}
	return Object.fromEntries([...out].map(([target, set]) => [target, [...set].sort(byText)]));
}

/** One row of the base. `links` = resolved link targets (vault paths) with the number of links to each. */
export interface NodeInput {
	id: string;
	label: string;
	links: Record<string, number>;
	props?: Record<string, PropValue>;
	/** Target path -> relation names of the links to it (see `linkRelations`). Optional. */
	relations?: Record<string, string[]>;
}

/** One relation of a link edge: its name and the row index of the note that links. */
export interface Relation {
	name: string;
	from: number;
}

export interface GraphOptions {
	/** Keep rows with no edge. Default true, so the node count equals the row count. */
	showOrphans?: boolean;
	/** Draw edges for links between rows. Default true. */
	linkEdges?: boolean;
	/** Pro: property names whose equal values join two rows. */
	sharedProps?: string[];
	/** A value shared by up to this many rows joins every pair; a larger group is joined as a chain in row order. */
	maxGroup?: number;
	/** Pro: keep only rows within `depth` edges of this row id. */
	focus?: string | null;
	depth?: number;
}

export interface GraphNode {
	id: string;
	label: string;
	/** Index of the row in the input. */
	row: number;
	degree: number;
}

export interface Edge {
	source: number;
	target: number;
	kind: 'link' | 'shared';
	/** Number of links (both ways) or number of shared values. */
	weight: number;
	/** Link edges: true when both notes link to each other. */
	mutual?: boolean;
	/** Link edges, only when a row has `relations`: sorted by name, then by the row that links. */
	relations?: Relation[];
	/** Shared edges: the property and the shared values (display form, sorted). */
	prop?: string;
	values?: string[];
}

export interface Graph {
	nodes: GraphNode[];
	edges: Edge[];
	/** Rows left out: orphans hidden by showOrphans false, rows outside the local depth. */
	hidden: { orphans: number; outside: number };
}

export const DEFAULT_MAX_GROUP = 12;
export const MAX_DEPTH = 5;

/** Display form of a property value: trimmed, a wikilink becomes its target, a tag keeps its text. */
export function displayValue(v: Scalar): string {
	let s = String(v).trim();
	const wiki = /^!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(s);
	if (wiki) s = wiki[1]!.trim();
	return s;
}

/** Key for comparing values: display form, case-insensitive, a leading # ignored. Empty means no value. */
export function valueKey(v: Scalar): string {
	return displayValue(v).replace(/^#/, '').toLowerCase();
}

function asList(v: PropValue | undefined): Scalar[] {
	if (v === null || v === undefined) return [];
	return Array.isArray(v) ? v : [v];
}

function pairKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Link edges between rows of the base: one edge per pair, weight = links both ways, mutual when both link. */
function linkEdges(rows: NodeInput[], index: Map<string, number>): Edge[] {
	const byPair = new Map<string, Edge>();
	const named = rows.some((r) => r.relations !== undefined);
	rows.forEach((row, i) => {
		for (const [target, count] of Object.entries(row.links)) {
			const j = index.get(target);
			if (j === undefined || j === i || !(count > 0)) continue;
			const key = pairKey(i, j);
			let e = byPair.get(key);
			if (!e) {
				e = { source: i, target: j, kind: 'link', weight: count, mutual: false };
				if (named) e.relations = [];
				byPair.set(key, e);
			} else {
				e.weight += count;
				if (e.source === j) e.mutual = true;
			}
			for (const name of row.relations?.[target] ?? []) e.relations?.push({ name, from: i });
		}
	});
	const edges = [...byPair.values()];
	for (const e of edges) e.relations?.sort((a, b) => byText(a.name, b.name) || a.from - b.from);
	return edges;
}

/** Ends of an edge that get an arrowhead: the target of a link, both ends of a mutual link, none for shared values. */
export function arrowEnds(e: Edge): ('source' | 'target')[] {
	if (e.kind !== 'link') return [];
	return e.mutual ? ['source', 'target'] : ['target'];
}

/** The relation that colors a link edge: the first in name order, or null. */
export function edgeRelation(e: Edge): string | null {
	return e.relations?.[0]?.name ?? null;
}

/** Relation names of a link edge without repeats, in name order. */
export function relationNames(e: Edge): string[] {
	return [...new Set((e.relations ?? []).map((r) => r.name))];
}

/** Pro: edges between rows that share a value of one of `props`. One edge per pair and property. */
function sharedEdges(rows: NodeInput[], props: string[], maxGroup: number): Edge[] {
	const out: Edge[] = [];
	for (const prop of props) {
		const groups = new Map<string, { label: string; rows: number[] }>();
		rows.forEach((row, i) => {
			const seen = new Set<string>();
			for (const v of asList(row.props?.[prop])) {
				const key = valueKey(v);
				if (!key || seen.has(key)) continue;
				seen.add(key);
				const g = groups.get(key) ?? { label: displayValue(v), rows: [] };
				g.rows.push(i);
				groups.set(key, g);
			}
		});
		const byPair = new Map<string, Edge>();
		const add = (a: number, b: number, label: string) => {
			const key = pairKey(a, b);
			const e = byPair.get(key);
			if (e) {
				e.weight++;
				e.values!.push(label);
			} else byPair.set(key, { source: Math.min(a, b), target: Math.max(a, b), kind: 'shared', weight: 1, prop, values: [label] });
		};
		for (const g of groups.values()) {
			if (g.rows.length < 2) continue;
			if (g.rows.length <= maxGroup) {
				for (let a = 0; a < g.rows.length; a++) for (let b = a + 1; b < g.rows.length; b++) add(g.rows[a]!, g.rows[b]!, g.label);
			} else {
				for (let a = 0; a + 1 < g.rows.length; a++) add(g.rows[a]!, g.rows[a + 1]!, g.label);
			}
		}
		for (const e of byPair.values()) {
			e.values!.sort((x, y) => x.localeCompare(y));
			out.push(e);
		}
	}
	return out;
}

/** Rows within `depth` edges of `focus` (breadth-first over all edges, both ways). */
export function withinDepth(n: number, edges: Edge[], focus: number, depth: number): Set<number> {
	const adj: number[][] = Array.from({ length: n }, () => []);
	for (const e of edges) {
		adj[e.source]!.push(e.target);
		adj[e.target]!.push(e.source);
	}
	const keep = new Set<number>([focus]);
	let frontier = [focus];
	for (let d = 0; d < depth && frontier.length > 0; d++) {
		const next: number[] = [];
		for (const i of frontier) {
			for (const j of adj[i]!) {
				if (keep.has(j)) continue;
				keep.add(j);
				next.push(j);
			}
		}
		frontier = next;
	}
	return keep;
}

/** Builds the graph of the rows of a base. Row ids must be unique; a later duplicate is ignored. */
export function buildGraph(input: NodeInput[], opts: GraphOptions = {}): Graph {
	const rows: NodeInput[] = [];
	const index = new Map<string, number>();
	for (const r of input) {
		if (index.has(r.id)) continue;
		index.set(r.id, rows.length);
		rows.push(r);
	}
	const maxGroup = Math.max(2, Math.floor(opts.maxGroup ?? DEFAULT_MAX_GROUP));
	let edges = [...(opts.linkEdges === false ? [] : linkEdges(rows, index)), ...sharedEdges(rows, opts.sharedProps ?? [], maxGroup)];
	let keep: Set<number> | null = null;
	let outside = 0;
	const focus = opts.focus ? index.get(opts.focus) : undefined;
	const depth = Math.min(MAX_DEPTH, Math.max(0, Math.floor(opts.depth ?? 0)));
	if (focus !== undefined && depth > 0) {
		keep = withinDepth(rows.length, edges, focus, depth);
		outside = rows.length - keep.size;
		edges = edges.filter((e) => keep!.has(e.source) && keep!.has(e.target));
	}
	const degree = new Array<number>(rows.length).fill(0);
	for (const e of edges) {
		degree[e.source]!++;
		degree[e.target]!++;
	}
	let orphans = 0;
	const map = new Map<number, number>();
	const nodes: GraphNode[] = [];
	rows.forEach((r, i) => {
		if (keep && !keep.has(i)) return;
		if (opts.showOrphans === false && degree[i] === 0) {
			orphans++;
			return;
		}
		map.set(i, nodes.length);
		nodes.push({ id: r.id, label: r.label, row: i, degree: degree[i]! });
	});
	const out = edges.filter((e) => map.has(e.source) && map.has(e.target)).map((e) => ({ ...e, source: map.get(e.source)!, target: map.get(e.target)! }));
	return { nodes, edges: out, hidden: { orphans, outside } };
}

/**
 * A number from a property value: 12, "12", "1,200.5", "$3.50", "12 %", "-4". Booleans count as 1 and 0.
 * Anything else (dates, words, empty) gives null.
 */
export function parseNumber(v: PropValue | undefined): number | null {
	if (v === null || v === undefined) return null;
	if (Array.isArray(v)) return v.length === 1 ? parseNumber(v[0]) : null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'boolean') return v ? 1 : 0;
	const s = v.trim().replace(/^[$€£¥]\s*/, '').replace(/\s*%$/, '');
	if (!/^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(s) || !/\d/.test(s)) return null;
	return Number(s.replace(/,/g, ''));
}

export interface SizeOptions {
	min?: number;
	max?: number;
	/** Radius for a row with no number. Default min. */
	fallback?: number;
}

/** Smallest and largest number. A loop, not Math.min(...xs): a spread of 200,000 values overflows the stack. */
function extent(xs: number[]): [number, number] {
	let lo = Infinity;
	let hi = -Infinity;
	for (const x of xs) {
		if (x < lo) lo = x;
		if (x > hi) hi = x;
	}
	return [lo, hi];
}

/** Radius per row: square-root scale from the smallest to the largest number, so area follows the value. */
export function sizeScale(values: (number | null)[], opts: SizeOptions = {}): number[] {
	const min = opts.min ?? 4;
	const max = opts.max ?? 16;
	const fallback = opts.fallback ?? min;
	const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
	if (nums.length === 0) return values.map(() => fallback);
	const [lo, hi] = extent(nums);
	const round = (x: number) => Math.round(x * 100) / 100;
	if (hi === lo) return values.map((v) => (v === null ? fallback : round((min + max) / 2)));
	return values.map((v) => (v === null || !Number.isFinite(v) ? fallback : round(min + (max - min) * Math.sqrt((v - lo) / (hi - lo)))));
}

export interface LegendItem {
	label: string;
	count: number;
	/** Palette slot; -1 = no value (drawn in the default node color). */
	slot: number;
}

export interface ColorResult {
	kind: 'category' | 'number' | 'none';
	/** Palette slot per row; -1 = no value. */
	slots: number[];
	legend: LegendItem[];
}

/** Formats a bin edge: integers as is, else up to 2 decimals. */
function fmt(x: number): string {
	return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

/**
 * Palette slot per row from one property.
 *   Numbers (every value a number, more distinct numbers than slots): `bins` equal-width ranges, slots 0..bins-1.
 *   Otherwise categories by count (ties by name); when there are more than `slots`, the rest share the last slot "Other".
 * Lists use their first value. No value = slot -1, listed last in the legend as "(no value)".
 */
export function colorScale(values: PropValue[], opts: { slots?: number; bins?: number; categories?: boolean } = {}): ColorResult {
	const slots = Math.max(2, opts.slots ?? 8);
	const bins = Math.max(2, Math.min(slots, opts.bins ?? 5));
	const first = values.map((v) => {
		const l = asList(v);
		return l.length > 0 && valueKey(l[0]!) !== '' ? l[0]! : null;
	});
	const empty = first.filter((v) => v === null).length;
	const noneItem = empty > 0 ? [{ label: '(no value)', count: empty, slot: -1 }] : [];
	const present = first.filter((v): v is Scalar => v !== null);
	if (present.length === 0) return { kind: 'none', slots: values.map(() => -1), legend: noneItem };
	const nums = first.map((v) => (v === null ? null : parseNumber(v)));
	const xs = nums.filter((n): n is number => n !== null);
	// Distinct numbers, not distinct text: "1" and "1.0" are one number, and equal numbers give a bin width of 0.
	if (!opts.categories && xs.length === present.length && new Set(xs).size > slots) {
		const [lo, hi] = extent(xs);
		const w = (hi - lo) / bins;
		const slotOf = (n: number) => Math.min(bins - 1, Math.floor((n - lo) / w));
		const counts = new Array<number>(bins).fill(0);
		const out = nums.map((n) => (n === null ? -1 : slotOf(n)));
		for (const s of out) if (s >= 0) counts[s]!++;
		const legend = counts.map((count, s) => ({ label: `${fmt(lo + s * w)} to ${fmt(s === bins - 1 ? hi : lo + (s + 1) * w)}`, count, slot: s }));
		return { kind: 'number', slots: out, legend: [...legend, ...noneItem] };
	}
	const groups = new Map<string, { label: string; count: number }>();
	for (const v of present) {
		const k = valueKey(v);
		const g = groups.get(k) ?? { label: displayValue(v), count: 0 };
		g.count++;
		groups.set(k, g);
	}
	const ranked = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));
	const overflow = ranked.length > slots;
	const named = overflow ? ranked.slice(0, slots - 1) : ranked;
	const slotByKey = new Map(named.map(([k], s) => [k, s]));
	const otherSlot = slots - 1;
	const out = first.map((v) => (v === null ? -1 : (slotByKey.get(valueKey(v)) ?? otherSlot)));
	const legend: LegendItem[] = named.map(([, g], s) => ({ label: g.label, count: g.count, slot: s }));
	if (overflow) legend.push({ label: 'Other', count: ranked.slice(slots - 1).reduce((a, [, g]) => a + g.count, 0), slot: otherSlot });
	return { kind: 'category', slots: out, legend: [...legend, ...noneItem] };
}

/**
 * Pro: color slot per edge from its first relation (always categories; more than `slots` names share "Other").
 * Shared edges and link edges without a relation get slot -1. The legend counts link edges and leaves out "(no value)".
 */
export function relationColors(edges: Edge[], slots = 8): ColorResult {
	const link = edges.map((e) => (e.kind === 'link' ? edgeRelation(e) : null));
	const c = colorScale(link, { slots, categories: true });
	return { ...c, legend: c.legend.filter((item) => item.slot >= 0) };
}

/**
 * Arrowhead at the `to` end of a line from (ax, ay) to (bx, by): the tip touches the circle of radius `r` around b.
 * Returns the tip and the two back corners, or null when the line is too short to show one.
 */
export function arrowHead(ax: number, ay: number, bx: number, by: number, r: number, size: number): [number, number][] | null {
	const dx = bx - ax;
	const dy = by - ay;
	const d = Math.hypot(dx, dy);
	if (!(d > r + size)) return null;
	const ux = dx / d;
	const uy = dy / d;
	const tx = bx - ux * r;
	const ty = by - uy * r;
	const half = size * 0.5;
	return [
		[tx, ty],
		[tx - ux * size - uy * half, ty - uy * size + ux * half],
		[tx - ux * size + uy * half, ty - uy * size - ux * half],
	];
}

/** Arrowhead length for a line of this width factor, in the units of the line. */
export function arrowSize(width: number): number {
	return 8 + 2 * width;
}

/** Escapes text for XML content and attribute values. */
export function xmlEscape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export interface SvgNode {
	x: number;
	y: number;
	r: number;
	color: string;
	label: string;
}

export interface SvgEdge {
	source: number;
	target: number;
	dashed?: boolean;
	color: string;
	width: number;
	/** Ends that get an arrowhead (see `arrowEnds`). */
	arrows?: ('source' | 'target')[];
	/** Relation names of a link edge, shown as the line's title. */
	relations?: string[];
}

export interface SvgModel {
	nodes: SvgNode[];
	edges: SvgEdge[];
	background: string;
	text: string;
	/** Space around the drawing, in px. */
	padding?: number;
	fontSize?: number;
	legend?: { label: string; color: string }[];
	/** Pro: the "Links" part of the legend, one line swatch per relation. */
	linkLegend?: { label: string; color: string }[];
}

const r1 = (x: number) => String(Math.round(x * 10) / 10);

/** A standalone SVG of the graph: the view box fits every node and label, then a legend at the bottom left. */
export function toSvg(m: SvgModel): string {
	const pad = m.padding ?? 24;
	const fs = m.fontSize ?? 12;
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const n of m.nodes) {
		const half = (n.label.length * fs * 0.3) | 0;
		x0 = Math.min(x0, n.x - Math.max(n.r, half));
		x1 = Math.max(x1, n.x + Math.max(n.r, half));
		y0 = Math.min(y0, n.y - n.r);
		y1 = Math.max(y1, n.y + n.r + fs + 4);
	}
	if (m.nodes.length === 0) {
		x0 = y0 = 0;
		x1 = y1 = 100;
	}
	const legend = m.legend ?? [];
	const linkLegend = m.linkLegend ?? [];
	// The "Links" part has a title row, then one row per relation.
	const linkRows = linkLegend.length > 0 ? linkLegend.length + 1 : 0;
	const legendH = (legend.length + linkRows) * (fs + 6);
	const w = x1 - x0 + 2 * pad;
	const h = y1 - y0 + 2 * pad + (legendH > 0 ? legendH + pad / 2 : 0);
	const ox = pad - x0;
	const oy = pad - y0;
	const out: string[] = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${r1(w)}" height="${r1(h)}" viewBox="0 0 ${r1(w)} ${r1(h)}" font-family="sans-serif" font-size="${fs}">`);
	out.push(`<rect width="100%" height="100%" fill="${xmlEscape(m.background)}"/>`);
	out.push('<g class="edges">');
	for (const e of m.edges) {
		const a = m.nodes[e.source];
		const b = m.nodes[e.target];
		if (!a || !b) continue;
		const dash = e.dashed ? ' stroke-dasharray="4 3"' : '';
		const line = `<line x1="${r1(a.x + ox)}" y1="${r1(a.y + oy)}" x2="${r1(b.x + ox)}" y2="${r1(b.y + oy)}" stroke="${xmlEscape(e.color)}" stroke-width="${r1(e.width)}"${dash}`;
		out.push(e.relations && e.relations.length > 0 ? `${line}><title>${xmlEscape(e.relations.join(', '))}</title></line>` : `${line}/>`);
		for (const end of e.arrows ?? []) {
			const [from, to] = end === 'target' ? [a, b] : [b, a];
			const head = arrowHead(from.x + ox, from.y + oy, to.x + ox, to.y + oy, to.r, arrowSize(e.width));
			if (head) out.push(`<polygon class="arrow" points="${head.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ')}" fill="${xmlEscape(e.color)}"/>`);
		}
	}
	out.push('</g>', '<g class="nodes">');
	for (const n of m.nodes) out.push(`<circle cx="${r1(n.x + ox)}" cy="${r1(n.y + oy)}" r="${r1(n.r)}" fill="${xmlEscape(n.color)}"><title>${xmlEscape(n.label)}</title></circle>`);
	out.push('</g>', `<g class="labels" fill="${xmlEscape(m.text)}" text-anchor="middle">`);
	for (const n of m.nodes) out.push(`<text x="${r1(n.x + ox)}" y="${r1(n.y + oy + n.r + fs)}">${xmlEscape(n.label)}</text>`);
	out.push('</g>');
	if (legend.length > 0) {
		out.push(`<g class="legend" fill="${xmlEscape(m.text)}">`);
		legend.forEach((item, i) => {
			const y = h - pad / 2 - legendH + i * (fs + 6) + fs / 2;
			out.push(`<circle cx="${r1(pad)}" cy="${r1(y)}" r="${r1(fs / 2.4)}" fill="${xmlEscape(item.color)}"/><text x="${r1(pad + fs)}" y="${r1(y + fs / 3)}">${xmlEscape(item.label)}</text>`);
		});
		out.push('</g>');
	}
	if (linkLegend.length > 0) {
		const rowY = (i: number) => h - pad / 2 - legendH + (legend.length + i) * (fs + 6) + fs / 2;
		out.push(`<g class="legend-links" fill="${xmlEscape(m.text)}">`);
		out.push(`<text x="${r1(pad - fs / 2.4)}" y="${r1(rowY(0) + fs / 3)}" font-weight="bold">Links</text>`);
		linkLegend.forEach((item, i) => {
			const y = rowY(i + 1);
			out.push(`<line x1="${r1(pad - fs / 2.4)}" y1="${r1(y)}" x2="${r1(pad + fs / 2.4)}" y2="${r1(y)}" stroke="${xmlEscape(item.color)}" stroke-width="2"/><text x="${r1(pad + fs)}" y="${r1(y + fs / 3)}">${xmlEscape(item.label)}</text>`);
		});
		out.push('</g>');
	}
	out.push('</svg>');
	return out.join('\n') + '\n';
}
