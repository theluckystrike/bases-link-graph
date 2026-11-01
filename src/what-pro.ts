// "What Pro adds" for this plugin: the Pro lines of pro-features.ts, each with a demo that runs the real graph code
// (buildGraph, sizeScale, colorScale, relationColors, toSvg) on sample rows in the window. A demo never reads or writes
// a vault file and never turns Pro on for a real base.
import type { App } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { demoText, showWhatProAdds, type WhatProDemoFeature, type WhatProModal } from './license/github-obsidian';
import { buildGraph, colorScale, relationColors, relationNames, sizeScale, toSvg, type Graph, type GraphOptions, type NodeInput, type PropValue, type SvgModel } from './graph';
import { PRO_FEATURES } from './pro-features';
import { PRO_UI, SPONSORS } from './pro';
import { readTheme, type Theme } from './theme';
import { KEY } from './view';

const book = (title: string, author: string, pages: number, genre: string, links: Record<string, string[]>): NodeInput => ({
	id: `${title}.md`,
	label: title,
	links: Object.fromEntries(Object.keys(links).map((k) => [k, 1])),
	relations: links,
	props: { author, pages, genre },
});

/** Sample rows of a base: 4 books, 2 authors and a reading list. They live only in this window. */
export const SAMPLE_ROWS: readonly NodeInput[] = [
	book('Dune', 'Frank Herbert', 412, 'Science fiction', { 'Frank Herbert.md': ['author'] }),
	book('Children of Dune', 'Frank Herbert', 444, 'Science fiction', { 'Dune.md': ['sequel of'], 'Frank Herbert.md': ['author'] }),
	book('Middlemarch', 'George Eliot', 880, 'Novel', { 'George Eliot.md': ['author'] }),
	book('Silas Marner', 'George Eliot', 183, 'Novel', { 'George Eliot.md': ['author'] }),
	{ id: 'Frank Herbert.md', label: 'Frank Herbert', links: {}, props: { genre: 'Person' } },
	{ id: 'George Eliot.md', label: 'George Eliot', links: {}, props: { genre: 'Person' } },
	{ id: 'Reading list.md', label: 'Reading list', links: { 'Dune.md': 1, 'Middlemarch.md': 1 }, relations: { 'Dune.md': ['next'], 'Middlemarch.md': ['next'] }, props: {} },
];

/** A note with headings, for the heading demo. */
export const SAMPLE_HEADINGS: NodeInput = {
	id: 'Dune notes.md',
	label: 'Dune notes',
	links: {},
	headings: [
		{ heading: 'Dune', level: 1, line: 0 },
		{ heading: 'Book 1', level: 2, line: 2 },
		{ heading: 'Arrakis', level: 3, line: 4 },
		{ heading: 'Book 2', level: 2, line: 10 },
	],
	refs: [],
};

export interface GraphStyle {
	radius?: number[];
	nodeColor?: (i: number, t: Theme) => string;
	edgeColor?: (k: number, t: Theme) => string;
	legend?: { label: string; color: string }[];
	linkLegend?: { label: string; color: string }[];
}

const rowProp = (g: Graph, rows: readonly NodeInput[], name: string): PropValue[] => g.nodes.map((n) => rows[n.row]?.props?.[name] ?? null);

/** The SVG model of a graph: nodes on a circle (a fixed place, so the demo looks the same each time). */
export function svgModel(g: Graph, t: Theme, style: GraphStyle = {}): SvgModel {
	const count = g.nodes.length;
	const radius = Math.max(60, count * 22);
	return {
		background: t.background,
		text: t.text,
		nodes: g.nodes.map((n, i) => ({
			x: Math.round(radius * Math.cos((2 * Math.PI * i) / count)),
			y: Math.round(radius * Math.sin((2 * Math.PI * i) / count)),
			r: style.radius?.[i] ?? (n.sub ? 3.5 : 6),
			color: style.nodeColor?.(i, t) ?? (n.sub ? (t.sub ?? t.node) : t.node),
			label: n.label,
		})),
		edges: g.edges.map((e, k) => ({ source: e.source, target: e.target, dashed: e.kind === 'shared', color: style.edgeColor?.(k, t) ?? (e.kind === 'shared' ? t.shared : t.line), width: 1.5, relations: relationNames(e) })),
		legend: style.legend,
		linkLegend: style.linkLegend,
	};
}

/** Draws the SVG text of the plugin's export function into el. */
function drawSvg(el: HTMLElement, svg: string): void {
	const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
	const node = el.doc.importNode(doc.documentElement, true) as unknown as SVGElement;
	node.addClass('pf-whatpro-graph');
	node.setCssStyles({ maxWidth: '100%', height: 'auto', maxHeight: '320px', display: 'block' });
	el.appendChild(node);
}

function graphDemo(el: HTMLElement, label: string, opts: GraphOptions, style: (g: Graph, t: Theme) => GraphStyle, rows: readonly NodeInput[] = SAMPLE_ROWS): Graph {
	const g = buildGraph([...rows], opts);
	const t = readTheme(el, el.createEl('canvas'));
	el.lastElementChild?.remove();
	el.createEl('p', { text: label, cls: 'pf-whatpro-demo-label' });
	drawSvg(el, toSvg(svgModel(g, t, style(g, t))));
	return g;
}

const slotColor = (slot: number, t: Theme): string => (slot < 0 ? t.node : (t.palette[slot % t.palette.length] ?? t.node));

const DEMOS: Record<string, (el: HTMLElement) => void> = {
	size: (el) => {
		const g = buildGraph([...SAMPLE_ROWS]);
		const pages = rowProp(g, SAMPLE_ROWS, 'pages').map((v) => (typeof v === 'number' ? v : null));
		const radius = sizeScale(pages);
		graphDemo(el, 'Size by pages:', {}, () => ({ radius }));
		demoText(el, 'Node radius from the property pages:', g.nodes.map((n, i) => `${n.label}: ${pages[i] === null || pages[i] === undefined ? 'no pages value' : `${pages[i]} pages`}, radius ${radius[i]}`).join('\n'));
	},
	color: (el) => {
		const g = buildGraph([...SAMPLE_ROWS]);
		const c = colorScale(rowProp(g, SAMPLE_ROWS, 'genre'));
		graphDemo(el, 'Color by genre, with the legend:', {}, (_g, t) => ({ nodeColor: (i) => slotColor(c.slots[i] ?? -1, t), legend: c.legend.map((l) => ({ label: `${l.label} (${l.count})`, color: slotColor(l.slot, t) })) }));
		demoText(el, 'Legend:', c.legend.map((l) => `${l.label} (${l.count})`).join('\n'));
	},
	'link-colors': (el) => {
		const g = buildGraph([...SAMPLE_ROWS]);
		const c = relationColors(g.edges);
		graphDemo(el, 'Links colored by relation:', {}, (_g, t) => ({ edgeColor: (k) => slotColor(c.slots[k] ?? -1, t), linkLegend: c.legend.map((l) => ({ label: `${l.label} (${l.count})`, color: slotColor(l.slot, t) })) }));
		demoText(el, 'The Links legend:', c.legend.map((l) => `${l.label} (${l.count})`).join('\n'));
	},
	headings: (el) => {
		const parents = (g: Graph): string =>
			g.nodes
				.filter((n) => n.sub)
				.map((n) => `${n.label} hangs from ${g.nodes[n.sub?.parent ?? -1]?.label ?? '?'}${n.sub?.kind === 'heading' && g.nodes[n.sub.parent]?.sub ? ' (heading)' : ' (note)'}`)
				.join('\n');
		const free = buildGraph([SAMPLE_HEADINGS], { headings: 'all' });
		graphDemo(el, 'Nested headings, levels 1 and 2:', { headings: 'all', chain: true, maxLevel: 2 }, () => ({}), [SAMPLE_HEADINGS]);
		const pro = buildGraph([SAMPLE_HEADINGS], { headings: 'all', chain: true, maxLevel: 2 });
		demoText(el, 'Free version: each heading hangs from the note.', parents(free));
		demoText(el, 'Pro, nested, deepest level 2:', parents(pro));
	},
	shared: (el) => {
		const g = graphDemo(el, 'Dashed edges join books with the same author:', { sharedProps: ['author'] }, () => ({}));
		const rows = g.edges.filter((e) => e.kind === 'shared').map((e) => `${g.nodes[e.source]?.label} and ${g.nodes[e.target]?.label}: ${e.prop} ${(e.values ?? []).join(', ')}`);
		demoText(el, 'Shared values:', rows.join('\n'));
	},
	depth: (el) => {
		const g = graphDemo(el, 'Only the notes near Dune, depth 1:', { focus: 'Dune.md', depth: 1 }, (graph, t) => ({ nodeColor: (i) => (graph.nodes[i]?.id === 'Dune.md' ? t.accent : t.node) }));
		demoText(el, `Near Dune, depth 1. ${g.hidden.outside} notes are hidden:`, g.nodes.map((n) => n.label).join(', '));
	},
	export: (el) => {
		const g = buildGraph([...SAMPLE_ROWS]);
		const svg = toSvg(svgModel(g, readTheme(el, el.createEl('canvas'))));
		el.lastElementChild?.remove();
		drawSvg(el, svg);
		const head = svg.split('\n').slice(0, 2).join('\n');
		demoText(el, `The SVG file of the sample graph has ${svg.length} characters and starts with:`, head.length > 300 ? `${head.slice(0, 300)}...` : head);
	},
	layout: (el) => {
		const g = buildGraph([...SAMPLE_ROWS]);
		const m = svgModel(g, readTheme(el, el.createEl('canvas')));
		el.lastElementChild?.remove();
		const lines = g.nodes.map((n, i) => `  ${n.id}: [${m.nodes[i]?.x ?? 0}, ${m.nodes[i]?.y ?? 0}]`);
		demoText(el, 'Save layout writes the node positions into the view of the base file:', `${KEY.layout}:\n${lines.join('\n')}`);
	},
};

export function whatProFeatures(): WhatProDemoFeature[] {
	return PRO_FEATURES.map((f) => ({ ...f, demo: DEMOS[f.id] ?? ((el: HTMLElement) => void el.createEl('p', { text: f.line })) }));
}

export function openWhatPro(app: App, pro: SponsorsManager | null, pluginId: string, pluginName: string): WhatProModal {
	return showWhatProAdds(app, pro, { pluginId, pluginName, features: whatProFeatures(), priceText: PRO_UI.priceText }, SPONSORS);
}
