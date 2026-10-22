import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryController, type MetadataCache, type TFile } from 'obsidian';
import { arrowEnds, arrowHead, buildGraph, linkCounts, linkRelations, relationColors, relationName, toSvg, type Edge, type ResolvedReference } from '../src/graph';
import { bindPro, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS } from '../src/settings';
import { GraphView, KEY, TIP_RELATIONS, relationsForFile } from '../src/view';
import type { Theme } from '../src/theme';

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

const theme: Theme = {
	background: '#fff',
	node: '#888',
	line: '#ccc',
	shared: '#00f',
	text: '#000',
	accent: '#f0f',
	font: 'sans-serif',
	palette: ['#c00', '#0c0', '#00c', '#cc0', '#0cc', '#c0c', '#600', '#060'],
	ramp: ['#222'],
};

function pro(on: boolean): void {
	bindPro({ isPro: () => on, onChange: () => () => undefined } as never);
}

function view(values: Record<string, unknown> = {}): GraphView {
	const plugin = { settings: { ...DEFAULT_SETTINGS }, views: new Set<GraphView>() };
	const v = new GraphView(new QueryController() as never, createDiv(), plugin as never);
	Object.assign(v, { config: { get: (key: string) => values[key], set: (key: string, value: unknown) => (values[key] = value), getAsPropertyId: () => null, getDisplayName: (p: string) => p } });
	return v;
}

/** A 2D context stand-in that records the calls that paint makes. */
function recorder() {
	const calls: { fn: string; style: unknown }[] = [];
	const state: Record<string, unknown> = {};
	const ctx = new Proxy(state, {
		get(target, prop: string) {
			if (prop in target) return target[prop];
			return (..._args: unknown[]) => calls.push({ fn: prop, style: prop === 'fill' ? target.fillStyle : prop === 'stroke' ? target.strokeStyle : undefined });
		},
		set(target, prop: string, value) {
			target[prop] = value;
			return true;
		},
	});
	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Sets a graph with fixed node positions on the view, as render() would. */
function place(v: GraphView, edges: Edge[], labels: string[]): void {
	const n = labels.length;
	Object.assign(v, {
		graph: { nodes: labels.map((label, i) => ({ id: `${label}.md`, label, row: i, degree: 1 })), edges, hidden: { orphans: 0, outside: 0 } },
		layout: { n, x: Float64Array.from(labels.map((_, i) => i * 100)), y: new Float64Array(n) },
		radius: new Float64Array(n).fill(5),
	});
}

describe('linkRelations (criterion 5)', () => {
	const refs: ResolvedReference[] = [
		{ target: 'P.md', key: 'parent.0' },
		{ target: 'P.md', key: 'parent,1' },
		{ target: 'Q.md', key: 'parent' },
		{ target: 'P.md' },
		{ target: null, key: 'parent' },
		{ target: 'R.md', key: 'friend.0' },
	];

	it('maps parent.0, parent,1 and parent to parent, body links to body, and skips unresolved targets', () => {
		expect(linkRelations(refs)).toEqual({ 'P.md': ['body', 'parent'], 'Q.md': ['parent'], 'R.md': ['friend'] });
		expect(relationName('parent.0')).toBe('parent');
		expect(relationName('parent,1')).toBe('parent');
		expect(relationName('parent.0.2')).toBe('parent');
		expect(relationName(undefined)).toBe('body');
	});

	it('applies the property filter of linkCounts, which stays as it was', () => {
		expect(linkRelations(refs, ['parent'])).toEqual({ 'P.md': ['parent'], 'Q.md': ['parent'] });
		expect(linkRelations(refs, ['note.friend'])).toEqual({ 'R.md': ['friend'] });
		expect(linkCounts(refs, ['parent'])).toEqual({ 'P.md': 2, 'Q.md': 1 });
		expect(linkCounts(refs)).toEqual({ 'P.md': 3, 'Q.md': 1, 'R.md': 1 });
	});
});

describe('relationsForFile (behavior 11)', () => {
	const file = { path: 'Notes/A.md' } as TFile;
	const cache = {
		resolvedLinks: {},
		getFileCache: () => ({
			links: [{ link: 'B#Heading' }, { link: 'Missing' }],
			embeds: [{ link: 'C' }],
			frontmatterLinks: [{ link: 'B', key: 'parent.0' }, { link: 'C', key: 'friend' }],
		}),
		getFirstLinkpathDest: (path: string) => (path === 'B' || path === 'C' ? { path: `Notes/${path}.md` } : null),
	} as unknown as MetadataCache;

	it('All links reads property and body links, with no property filter', () => {
		expect(relationsForFile(cache, file, 'all', ['parent'])).toEqual({ 'Notes/B.md': ['body', 'parent'], 'Notes/C.md': ['body', 'friend'] });
	});

	it('Note body names every link and embed body', () => {
		expect(relationsForFile(cache, file, 'body', [])).toEqual({ 'Notes/B.md': ['body'], 'Notes/C.md': ['body'] });
	});

	it('Properties uses the selected properties only', () => {
		expect(relationsForFile(cache, file, 'frontmatter', ['parent'])).toEqual({ 'Notes/B.md': ['parent'] });
		expect(relationsForFile(cache, file, 'frontmatter', [])).toEqual({ 'Notes/B.md': ['parent'], 'Notes/C.md': ['friend'] });
	});
});

describe('relations on link edges', () => {
	it('criterion 6: parent one way and friend the other way give one mutual edge with both relations', () => {
		const g = buildGraph([
			{ id: 'a', label: 'a', links: { b: 1 }, relations: { b: ['parent'] } },
			{ id: 'b', label: 'b', links: { a: 1 }, relations: { a: ['friend'] } },
		]);
		expect(g.edges).toEqual([
			{
				source: 0,
				target: 1,
				kind: 'link',
				weight: 2,
				mutual: true,
				relations: [
					{ name: 'friend', from: 1 },
					{ name: 'parent', from: 0 },
				],
			},
		]);
		expect(arrowEnds(g.edges[0]!)).toEqual(['source', 'target']);
	});

	it('behavior 13: without relations on any row, edges have no relations key', () => {
		const g = buildGraph([
			{ id: 'a', label: 'a', links: { b: 1 } },
			{ id: 'b', label: 'b', links: {} },
		]);
		expect(g.edges).toEqual([{ source: 0, target: 1, kind: 'link', weight: 1, mutual: false }]);
		expect('relations' in g.edges[0]!).toBe(false);
	});

	it('a row without relations still gives the edge an empty list when other rows have them', () => {
		const g = buildGraph([
			{ id: 'a', label: 'a', links: { b: 1 } },
			{ id: 'b', label: 'b', links: { c: 1 }, relations: { c: ['up'] } },
			{ id: 'c', label: 'c', links: {} },
		]);
		expect(g.edges.map((e) => e.relations)).toEqual([[], [{ name: 'up', from: 1 }]]);
	});

	it('arrows: the target of a link, both ends of a mutual link, none on shared values', () => {
		expect(arrowEnds({ source: 0, target: 1, kind: 'link', weight: 1, mutual: false })).toEqual(['target']);
		expect(arrowEnds({ source: 0, target: 1, kind: 'shared', weight: 1, prop: 'team', values: ['a'] })).toEqual([]);
	});

	it('the arrowhead tip touches the target circle and the head is null on a short line', () => {
		const head = arrowHead(0, 0, 100, 0, 10, 8)!;
		expect(head[0]).toEqual([90, 0]);
		expect(head[1]).toEqual([82, 4]);
		expect(head[2]).toEqual([82, -4]);
		expect(arrowHead(0, 0, 15, 0, 10, 8)).toBeNull();
	});
});

describe('relation colors (criterion 7)', () => {
	it('with ten relation names, eight slots: seven names, then the rest share "Other"', () => {
		const names = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'];
		const edges: Edge[] = names.map((name, i) => ({ source: 0, target: i + 1, kind: 'link', weight: 1, relations: [{ name, from: 0 }] }));
		edges.push({ source: 0, target: 1, kind: 'shared', weight: 1, prop: 'team', values: ['x'] });
		const c = relationColors(edges);
		expect(c.kind).toBe('category');
		expect(c.slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7, 7, -1]);
		expect(c.legend.map((l) => [l.label, l.count, l.slot])).toEqual([...names.slice(0, 7).map((n, s) => [n, 1, s]), ['Other', 3, 7]]);
	});

	it('names that look like numbers stay categories, and an edge without a relation is not in the legend', () => {
		const edges: Edge[] = Array.from({ length: 10 }, (_, i) => ({ source: 0, target: i + 1, kind: 'link' as const, weight: 1, relations: [{ name: String(i), from: 0 }] }));
		edges.push({ source: 1, target: 2, kind: 'link', weight: 1, relations: [] });
		const c = relationColors(edges);
		expect(c.kind).toBe('category');
		expect(c.slots[10]).toBe(-1);
		expect(c.legend.some((l) => l.slot < 0)).toBe(false);
	});

	it('the edge color is its first relation in name order, and the legend counts edges', () => {
		const edges: Edge[] = [
			{ source: 0, target: 1, kind: 'link', weight: 1, relations: [{ name: 'parent', from: 0 }] },
			{ source: 1, target: 2, kind: 'link', weight: 1, relations: [{ name: 'parent', from: 1 }] },
			{ source: 2, target: 3, kind: 'link', weight: 2, mutual: true, relations: [{ name: 'friend', from: 3 }, { name: 'parent', from: 2 }] },
		];
		const c = relationColors(edges);
		expect(c.legend.map((l) => `${l.label} (${l.count})`)).toEqual(['parent (2)', 'friend (1)']);
		expect(c.slots).toEqual([0, 0, 1]);
	});
});

describe('view options for link types', () => {
	it('criterion 8: an old view with no arrows and no linkColors key draws no arrows and no link colors', () => {
		pro(true);
		const v = view({});
		const opts = v.options();
		expect(opts).toMatchObject({ arrows: false, linkColors: false, proIgnored: false });
		place(v, [{ source: 0, target: 1, kind: 'link', weight: 1, mutual: true, relations: [{ name: 'parent', from: 0 }] }], ['A', 'B']);
		v.opts = { ...opts, labels: 'hover' };
		const { ctx, calls } = recorder();
		v.paint(ctx, theme, 1, -1);
		expect(v.arrowTips).toEqual([]);
		expect(calls.filter((c) => c.fn === 'stroke').map((c) => c.style)).toEqual([theme.line]);
		expect(calls.filter((c) => c.fn === 'fill').length).toBe(2);
	});

	it('both options are read from the view; link colors need Pro and are kept but ignored without it', () => {
		pro(false);
		expect(view({ [KEY.arrows]: true, [KEY.linkColors]: true }).options()).toMatchObject({ arrows: true, linkColors: false, proIgnored: true });
		expect(view({ [KEY.arrows]: 'yes' }).options()).toMatchObject({ arrows: false, proIgnored: false });
		pro(true);
		expect(view({ [KEY.arrows]: true, [KEY.linkColors]: true }).options()).toMatchObject({ arrows: true, linkColors: true, proIgnored: false });
	});

	it('a free user who turns link colors on gets the Pro notice once; an option saved before is not a turn-on', () => {
		pro(false);
		const notice = vi.spyOn(GraphView, 'needsPro').mockImplementation(() => undefined);
		const values: Record<string, unknown> = { [KEY.linkColors]: true };
		const saved = view(values);
		saved.checkLinkColors();
		expect(notice).not.toHaveBeenCalled();
		const v = view({});
		v.checkLinkColors();
		v.config.set(KEY.linkColors, true);
		v.checkLinkColors();
		v.checkLinkColors();
		expect(notice).toHaveBeenCalledTimes(1);
		expect(notice).toHaveBeenCalledWith('Link colors by relation');
		pro(true);
		const p = view({});
		p.checkLinkColors();
		p.config.set(KEY.linkColors, true);
		p.checkLinkColors();
		expect(notice).toHaveBeenCalledTimes(1);
	});
});

describe('paint with arrows and link colors', () => {
	const edges: Edge[] = [
		{ source: 0, target: 1, kind: 'link', weight: 1, mutual: false, relations: [{ name: 'parent', from: 0 }] },
		{ source: 1, target: 2, kind: 'link', weight: 2, mutual: true, relations: [{ name: 'friend', from: 1 }, { name: 'friend', from: 2 }] },
		{ source: 0, target: 2, kind: 'shared', weight: 1, prop: 'team', values: ['x'] },
	];

	it('free: arrowheads at each target and at both ends of the mutual edge, none on shared edges, theme line color', () => {
		pro(false);
		const v = view({ [KEY.arrows]: true, [KEY.linkColors]: true });
		place(v, edges, ['A', 'B', 'C']);
		v.opts = { ...v.options(), labels: 'hover' };
		const { ctx, calls } = recorder();
		v.paint(ctx, theme, 1, -1);
		expect(v.arrowTips).toEqual(['B.md', 'B.md', 'C.md']);
		expect(calls.filter((c) => c.fn === 'stroke').map((c) => c.style)).toEqual([theme.shared, theme.line, theme.line]);
	});

	it('Pro: each link edge in the color of its first relation; a lit edge keeps the hover color', () => {
		pro(true);
		const v = view({ [KEY.arrows]: true, [KEY.linkColors]: true });
		place(v, edges, ['A', 'B', 'C']);
		v.opts = { ...v.options(), labels: 'hover' };
		v.linkColor = relationColors(edges);
		const { ctx, calls } = recorder();
		v.paint(ctx, theme, 1, -1);
		const strokes = calls.filter((c) => c.fn === 'stroke').map((c) => c.style);
		expect(strokes[1]).not.toBe(strokes[2]);
		expect(strokes.slice(1)).toEqual([v.edgeColor(0, theme), v.edgeColor(1, theme)]);
		expect(v.linkLegendColors().map((l) => l.label)).toEqual(['friend (1)', 'parent (1)']);
		const lit = recorder();
		v.paint(lit.ctx, theme, 1, 0);
		expect(lit.calls.filter((c) => c.fn === 'stroke').map((c) => c.style)[1]).toBe(theme.accent);
	});

	it('the zoom scales the arrowhead with the line', () => {
		pro(false);
		const v = view({ [KEY.arrows]: true });
		place(v, [edges[0]!], ['A', 'B']);
		v.opts = { ...v.options(), labels: 'hover' };
		const size = (zoom: number) => {
			const pts: number[] = [];
			const ctx = new Proxy({} as Record<string, unknown>, {
				get: (t, p: string) => (p in t ? t[p] : p === 'moveTo' || p === 'lineTo' ? (x: number) => pts.push(x) : () => undefined),
				set: (t, p: string, val) => ((t[p] = val), true),
			});
			v.paint(ctx as unknown as CanvasRenderingContext2D, theme, zoom, -1);
			// Line: moveTo 0, lineTo 100; head: tip 95, then a back corner at 95 minus the arrowhead size.
			return pts[2]! - pts[3]!;
		};
		expect(size(1)).toBeCloseTo(10);
		expect(size(2)).toBeCloseTo(5);
	});
});

describe('hover card relations (behavior 14)', () => {
	it('lists outgoing relations first, then incoming, as "name → note" and "name ← note"', () => {
		const v = view();
		place(
			v,
			[
				{ source: 0, target: 1, kind: 'link', weight: 1, relations: [{ name: 'parent', from: 0 }] },
				{ source: 2, target: 0, kind: 'link', weight: 2, mutual: true, relations: [{ name: 'friend', from: 2 }, { name: 'parent', from: 0 }] },
				{ source: 0, target: 2, kind: 'shared', weight: 1, prop: 'team', values: ['x'] },
			],
			['Tom', 'Rose', 'Bea'],
		);
		expect(v.relationLines(0)).toEqual(['parent → Bea', 'parent → Rose', 'friend ← Bea']);
		expect(v.relationLines(1)).toEqual(['parent ← Tom']);
	});

	it(`shows at most ${TIP_RELATIONS} lines and then "+N more"`, () => {
		const v = view();
		const labels = ['Hub', ...Array.from({ length: 11 }, (_, i) => `N${i}`)];
		place(v, labels.slice(1).map((_, i) => ({ source: 0, target: i + 1, kind: 'link' as const, weight: 1, relations: [{ name: 'child', from: 0 }] })), labels);
		v.opts = { ...v.options() };
		(v as unknown as { fillTip(i: number): void }).fillTip(0);
		const tip = v.containerEl.querySelector('.bases-link-graph-tip')!;
		const rows = Array.from(tip.querySelectorAll('.bases-link-graph-tip-relation')).map((el) => el.textContent);
		expect(rows).toHaveLength(TIP_RELATIONS + 1);
		expect(rows[0]).toBe('child → N0');
		expect(rows[TIP_RELATIONS]).toBe('+3 more');
	});
});

describe('legend and SVG export with link types', () => {
	it('the view legend gets a "Links" part with names, colors and counts (Pro)', () => {
		pro(true);
		const v = view({ [KEY.linkColors]: true });
		const edges: Edge[] = [
			{ source: 0, target: 1, kind: 'link', weight: 1, relations: [{ name: 'parent', from: 0 }] },
			{ source: 1, target: 2, kind: 'link', weight: 1, relations: [{ name: 'friend', from: 1 }] },
		];
		place(v, edges, ['A', 'B', 'C']);
		v.opts = v.options();
		v.linkColor = relationColors(edges);
		Object.assign(v, { theme });
		(v as unknown as { drawLegend(): void }).drawLegend();
		const el = v.containerEl.querySelector('.bases-link-graph-legend.is-shown')!;
		expect(el.querySelector('.bases-link-graph-legend-links')?.textContent).toBe('Links');
		expect(Array.from(el.querySelectorAll('.bases-link-graph-legend-row.is-link')).map((r) => r.textContent)).toEqual(['friend (1)', 'parent (1)']);
		expect(el.querySelectorAll('.bases-link-graph-swatch.is-line')).toHaveLength(2);
	});

	it('SVG: arrowheads, colored lines with their relation, and a "Links" legend part after the node legend', () => {
		const svg = toSvg({
			background: '#fff',
			text: '#000',
			padding: 10,
			fontSize: 10,
			nodes: [
				{ x: 0, y: 0, r: 5, color: '#888', label: 'A' },
				{ x: 100, y: 0, r: 5, color: '#888', label: 'B' },
			],
			edges: [{ source: 0, target: 1, color: '#c00', width: 1, arrows: ['source', 'target'], relations: ['friend', 'parent'] }],
			legend: [{ label: 'person (2)', color: '#888' }],
			linkLegend: [{ label: 'friend (1)', color: '#c00' }],
		});
		expect(svg).toContain('<line x1="15" y1="15" x2="115" y2="15" stroke="#c00" stroke-width="1"><title>friend, parent</title></line>');
		expect(svg.match(/<polygon class="arrow" [^>]*fill="#c00"\/>/g)).toHaveLength(2);
		expect(svg).toContain('<polygon class="arrow" points="110,15 100,20 100,10" fill="#c00"/>');
		expect(svg).toContain('<g class="legend-links" fill="#000">');
		expect(svg).toContain('font-weight="bold">Links</text>');
		expect(svg).toContain('stroke="#c00" stroke-width="2"/><text x="20"');
		expect(svg.indexOf('class="legend"')).toBeLessThan(svg.indexOf('class="legend-links"'));
		// Drawing y -5..19 (24) + 2 x 10 padding, then three legend rows (one node value, the title, one relation): 3 x 16 + 5.
		expect(svg).toContain('height="97"');
	});
});
