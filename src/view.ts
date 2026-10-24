import { BasesView, BooleanValue, NumberValue, StringValue, Keymap, MarkdownView, Menu, Notice, parseLinktext, resolveSubpath, setIcon, type BasesAllOptions, type BasesPropertyId, type BasesViewConfig, type HoverParent, type HoverPopover, type MetadataCache, type QueryController, type TFile } from 'obsidian';
import { arrowEnds, arrowHead, arrowSize, buildGraph, colorScale, headingLinkText, keyMatches, linkCounts, linkRelations, parseNumber, relationColors, relationName, sizeScale, type ColorResult, type Graph, type HeadingInput, type HeadingMode, type LinkSource, type NodeInput, type PropValue, type ResolvedReference, type SectionRef } from './graph';
import { bounds, createLayout, hitTest, reheat, run, tick, type LayoutState } from './layout';
import { isPro, onProChange } from './pro';
import { readTheme, type Theme } from './theme';
import type BasesLinkGraphPlugin from './main';

export const VIEW_ID = 'bases-link-graph';
/** Keys in the base file. Not "groupBy" or other names that Bases reserves for its own view settings. */
export const KEY = {
	labels: 'graphLabels',
	orphans: 'graphOrphans',
	spacing: 'graphSpacing',
	linkSource: 'graphLinkSource',
	linkProperties: 'graphLinkProperties',
	sizeBy: 'graphSizeBy',
	colorBy: 'graphColorBy',
	shared: 'graphSharedProps',
	depth: 'graphDepth',
	focus: 'graphFocus',
	layout: 'graphLayout',
	arrows: 'graphArrows',
	linkColors: 'graphLinkColors',
	headings: 'graphHeadings',
	headingChain: 'graphHeadingChain',
	headingLevel: 'graphHeadingLevel',
} as const;

/** Radius of a heading node in layout units; a block node is half a unit smaller. */
export const SUB_RADIUS = 3.5;

/** Most relation lines in the hover card; the rest show as "+N more". */
export const TIP_RELATIONS = 8;

type Labels = 'auto' | 'always' | 'hover';

export interface ViewOptions {
	labels: Labels;
	showOrphans: boolean;
	spacing: number;
	linkSource: LinkSource;
	linkProperties: string[];
	/** Free: arrowheads at the target of each link. */
	arrows: boolean;
	/** Pro: link edges colored by their relation, with a "Links" legend. */
	linkColors: boolean;
	/** Free: headings and blocks as child nodes. */
	headings: HeadingMode;
	/** Pro: headings hang from their parent heading. */
	headingChain: boolean;
	/** Pro: deepest heading level shown (6 = all). */
	headingLevel: number;
	sizeBy: BasesPropertyId | null;
	colorBy: BasesPropertyId | null;
	shared: BasesPropertyId[];
	depth: number;
	focus: string | null;
	saved: Record<string, [number, number]> | null;
	/** A Pro option is set but Pro is off, so it is ignored. */
	proIgnored: boolean;
}

export interface GraphStats {
	rows: number;
	nodes: number;
	edges: number;
	buildMs: number;
	layoutMs: number;
	ticks: number;
	drawMs: number;
	frames: number;
}

/** Property id from a name typed in the options: "status" -> note.status; "file.tags" stays. */
export function toPropertyId(name: string): BasesPropertyId | null {
	const s = name.trim();
	if (!s) return null;
	return (/^(note|formula|file)\./.test(s) ? s : `note.${s}`) as BasesPropertyId;
}

/** Converts a Bases value to plain data: lists stay lists, empty values become null. */
export function toPlain(v: unknown): PropValue {
	if (v === null || v === undefined) return null;
	if (v instanceof BooleanValue) return v.isTruthy();
	if (v instanceof NumberValue) {
		const n = Number(v.toString());
		return Number.isFinite(n) ? n : null;
	}
	if (v instanceof StringValue) return v.toString() || null;
	const val = v as { toString(): string; isTruthy?(): boolean; length?: unknown; get?: unknown };
	if (typeof val.length === 'function' && typeof val.get === 'function') {
		const list = val as unknown as { length(): number; get(i: number): unknown };
		const out: (string | number | boolean)[] = [];
		for (let i = 0; i < list.length(); i++) {
			const item = toPlain(list.get(i));
			if (item !== null && !Array.isArray(item)) out.push(item);
		}
		return out;
	}
	const s = val.toString();
	if (s === '' || (s === 'null' && val.isTruthy?.() === false)) return null;
	return s;
}

interface Pointer {
	mode: 'node' | 'pan';
	node: number;
	startX: number;
	startY: number;
	moved: boolean;
	wasFixed: boolean;
	/** The node that a drag moves: the node itself, or the note of a heading or block node. */
	drag: number;
}

/** Resolve links through the public metadata cache, with the source note as context. */
export function linksForFile(cache: MetadataCache, file: TFile, source: LinkSource, properties: string[]): Record<string, number> {
	if (source === 'all') return cache.resolvedLinks[file.path] ?? {};
	const meta = cache.getFileCache(file);
	const refs = source === 'frontmatter' ? (meta?.frontmatterLinks ?? []) : [...(meta?.links ?? []), ...(meta?.embeds ?? [])];
	return linkCounts(refs.map((ref) => ({
		target: cache.getFirstLinkpathDest(parseLinktext(ref.link).path, file.path)?.path ?? null,
		key: 'key' in ref ? ref.key : undefined,
	})), source === 'frontmatter' ? properties : []);
}

/**
 * Relation names for each target of the note: property links by property name, body links and embeds as "body".
 * Reads the same references as the link source: "All links" reads both, with no property filter.
 */
export function relationsForFile(cache: MetadataCache, file: TFile, source: LinkSource, properties: string[]): Record<string, string[]> {
	const meta = cache.getFileCache(file);
	const resolve = (link: string) => cache.getFirstLinkpathDest(parseLinktext(link).path, file.path)?.path ?? null;
	const refs: ResolvedReference[] = [];
	if (source !== 'body') for (const ref of meta?.frontmatterLinks ?? []) refs.push({ target: resolve(ref.link), key: ref.key });
	if (source !== 'frontmatter') for (const ref of [...(meta?.links ?? []), ...(meta?.embeds ?? [])]) refs.push({ target: resolve(ref.link) });
	return linkRelations(refs, source === 'frontmatter' ? properties : []);
}

/** The headings of a note in file order, from the metadata cache. */
export function headingsForFile(cache: MetadataCache, file: TFile): HeadingInput[] {
	return (cache.getFileCache(file)?.headings ?? []).map((h) => ({ heading: h.heading, level: h.level, line: h.position.start.line }));
}

/**
 * Heading mode: one entry per reference of the note, with the same link source and property filter as the edges.
 * Obsidian resolves the subpath, so "C basics" finds the heading "C# basics" and "A#B" finds B under A.
 * A link with no file part ("[[#Heading]]") points to the note itself. Unresolved notes are skipped.
 */
export function sectionRefsForFile(cache: MetadataCache, file: TFile, source: LinkSource, properties: string[], resolve: typeof resolveSubpath = resolveSubpath): SectionRef[] {
	const meta = cache.getFileCache(file);
	const names = properties.map((p) => p.trim().replace(/^note\./, '')).filter(Boolean);
	const out: SectionRef[] = [];
	const add = (link: string, line: number | null, relation: string) => {
		const { path, subpath } = parseLinktext(link);
		const target = path === '' ? file : cache.getFirstLinkpathDest(path, file.path);
		if (!target) return;
		const ref: SectionRef = { line, target: target.path, relation };
		if (subpath) {
			const tcache = cache.getFileCache(target);
			const res = tcache ? resolve(tcache, subpath) : null;
			if (res?.type === 'heading') ref.heading = tcache?.headings?.indexOf(res.current) ?? -1;
			else if (res?.type === 'block') ref.block = { id: res.block.id, line: res.block.position.start.line };
			else if (!res) ref.missing = true;
			if (ref.heading === -1) {
				delete ref.heading;
				ref.missing = true;
			}
		}
		out.push(ref);
	};
	if (source !== 'body') {
		for (const ref of meta?.frontmatterLinks ?? []) {
			if (source === 'frontmatter' && names.length > 0 && !keyMatches(ref.key, names)) continue;
			add(ref.link, null, relationName(ref.key));
		}
	}
	if (source !== 'frontmatter') for (const ref of [...(meta?.links ?? []), ...(meta?.embeds ?? [])]) add(ref.link, ref.position.start.line, relationName(undefined));
	return out;
}

/** Bases view that draws the notes of a base as a force-directed graph on a canvas. */
export class GraphView extends BasesView implements HoverParent {
	type = VIEW_ID;
	hoverPopover: HoverPopover | null = null;
	graph: Graph | null = null;
	layout: LayoutState | null = null;
	radius = new Float64Array(0);
	color: ColorResult | null = null;
	/** Pro: color slot per edge of the graph, from its first relation. */
	linkColor: ColorResult | null = null;
	/** Paths of the nodes that got an arrowhead in the last paint, one entry per arrowhead. */
	arrowTips: string[] = [];
	stats: GraphStats | null = null;
	opts: ViewOptions | null = null;
	/** Screen = layout x zoom + offset, in CSS pixels. */
	zoom = 1;
	tx = 0;
	ty = 0;
	hover = -1;
	theme: Theme | null = null;
	private paths = new Set<string>();
	private neighbours: number[][] = [];
	private readonly root: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly bar: HTMLElement;
	private readonly legendEl: HTMLElement;
	private readonly tip: HTMLElement;
	private timer: number | null = null;
	private raf: number | null = null;
	private pointer: Pointer | null = null;
	private fitted = false;
	/** Last saved value of "Color links by relation"; null before the first render. */
	private lastLinkColors: boolean | null = null;

	constructor(
		controller: QueryController,
		readonly containerEl: HTMLElement,
		private readonly plugin: BasesLinkGraphPlugin,
	) {
		super(controller);
		this.root = containerEl.createDiv({ cls: 'bases-link-graph' });
		this.bar = this.root.createDiv({ cls: 'bases-link-graph-bar', text: 'Drawing the graph...' });
		// The canvas sits absolutely inside a flex box, so its pixel size never feeds back into the layout.
		this.canvas = this.root.createDiv({ cls: 'bases-link-graph-stage' }).createEl('canvas', { cls: 'bases-link-graph-canvas' });
		this.legendEl = this.root.createDiv({ cls: 'bases-link-graph-legend' });
		this.tip = this.root.createDiv({ cls: 'bases-link-graph-tip' });
	}

	/**
	 * Events go here, not in the constructor: Bases can unload a view and load the same object again (for example
	 * when the plugin reloads with a base open), and an unload removes everything that was registered.
	 */
	onload(): void {
		this.plugin.views.add(this);
		this.registerEvent(
			this.app.metadataCache.on('resolve', (file) => {
				if (this.paths.has(file.path)) this.schedule();
			}),
		);
		this.registerEvent(this.app.workspace.on('css-change', () => this.refreshTheme()));
		this.register(onProChange(() => this.schedule(0)));
		this.bindPointer();
		// No ResizeObserver: next to the observers of Bases it reports "ResizeObserver loop" errors when the plugin
		// reloads. The workspace resize event covers pane and window changes; draw() checks the size on every frame.
		this.registerEvent(this.app.workspace.on('resize', () => this.resize()));
		if (this.graph) this.schedule(0);
	}

	onunload(): void {
		this.plugin.views.delete(this);
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.stop();
	}

	onDataUpdated(): void {
		this.schedule(0);
	}

	/** Redraws after `delay` ms; calls in between restart the wait. */
	schedule(delay = this.plugin.settings.debounceMs): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.render();
		}, delay);
	}

	/** The view options from the base file. Pro options are dropped when Pro is off. */
	options(): ViewOptions {
		const c = this.config;
		const pro = isPro();
		const labels = c.get(KEY.labels);
		const spacing = Number(c.get(KEY.spacing));
		const linkSource = c.get(KEY.linkSource);
		const linkProperties = c.get(KEY.linkProperties);
		const depth = Number(c.get(KEY.depth));
		const focus = c.get(KEY.focus);
		const layout = c.get(KEY.layout);
		const sharedRaw = c.get(KEY.shared);
		const shared = (Array.isArray(sharedRaw) ? sharedRaw : []).filter((x): x is string => typeof x === 'string').map(toPropertyId).filter((x): x is BasesPropertyId => x !== null);
		const sizeBy = c.getAsPropertyId(KEY.sizeBy);
		const colorBy = c.getAsPropertyId(KEY.colorBy);
		const saved = layout && typeof layout === 'object' && !Array.isArray(layout) ? (layout as Record<string, [number, number]>) : null;
		const linkColors = c.get(KEY.linkColors) === true;
		const headings = c.get(KEY.headings);
		const headingChain = c.get(KEY.headingChain) === true;
		const levelRaw = Number(c.get(KEY.headingLevel));
		const headingLevel = Number.isFinite(levelRaw) && levelRaw >= 1 && levelRaw <= 6 ? Math.round(levelRaw) : 6;
		const headingsOn = headings === 'linked' || headings === 'all';
		// The heading options are hidden while headings are off, so they count as Pro use only when headings are on.
		const anyPro = sizeBy !== null || colorBy !== null || shared.length > 0 || depth > 0 || saved !== null || linkColors || (headingsOn && (headingChain || headingLevel < 6));
		return {
			labels: labels === 'always' || labels === 'hover' ? labels : 'auto',
			showOrphans: c.get(KEY.orphans) !== false,
			spacing: Number.isFinite(spacing) && spacing >= 20 && spacing <= 200 ? spacing : 60,
			linkSource: linkSource === 'body' || linkSource === 'frontmatter' ? linkSource : 'all',
			linkProperties: Array.isArray(linkProperties) ? linkProperties.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [],
			arrows: c.get(KEY.arrows) === true,
			linkColors: pro && linkColors,
			headings: headings === 'linked' || headings === 'all' ? headings : 'off',
			headingChain: pro && headingChain,
			headingLevel: pro ? headingLevel : 6,
			sizeBy: pro ? sizeBy : null,
			colorBy: pro ? colorBy : null,
			shared: pro ? shared : [],
			depth: pro && Number.isFinite(depth) ? Math.max(0, Math.min(5, Math.round(depth))) : 0,
			focus: pro && typeof focus === 'string' && focus ? focus : null,
			saved: pro ? saved : null,
			proIgnored: !pro && anyPro,
		};
	}

	/** Rows of the base as graph input: path, name, resolved links and the property values that the options use. */
	private input(opts: ViewOptions): NodeInput[] {
		const props = [opts.sizeBy, opts.colorBy, ...opts.shared].filter((p): p is BasesPropertyId => p !== null);
		return this.data.data.map((e) => {
			const values: Record<string, PropValue> = {};
			for (const p of props) values[p] = toPlain(e.getValue(p));
			const cache = this.app.metadataCache;
			if (opts.headings !== 'off') {
				return { id: e.file.path, label: e.file.basename, links: {}, props: values, headings: headingsForFile(cache, e.file), refs: sectionRefsForFile(cache, e.file, opts.linkSource, opts.linkProperties) };
			}
			return { id: e.file.path, label: e.file.basename, links: linksForFile(cache, e.file, opts.linkSource, opts.linkProperties), props: values, relations: relationsForFile(cache, e.file, opts.linkSource, opts.linkProperties) };
		});
	}

	/** Builds the graph from the current rows and starts the layout. */
	render(): void {
		// A Pro change or a note edit can arrive before Bases has given this view its first data.
		if (!(this.data as BasesView['data'] | undefined)) return;
		const t0 = performance.now();
		const opts = this.options();
		this.opts = opts;
		this.checkLinkColors();
		const input = this.input(opts);
		this.paths = new Set(input.map((r) => r.id));
		const g = buildGraph(input, { showOrphans: opts.showOrphans, sharedProps: opts.shared, focus: opts.focus, depth: opts.focus ? opts.depth : 0, headings: opts.headings, chain: opts.headingChain, maxLevel: opts.headingLevel });
		this.graph = g;
		this.neighbours = g.nodes.map(() => []);
		for (const e of g.edges) {
			this.neighbours[e.source]!.push(e.target);
			this.neighbours[e.target]!.push(e.source);
		}
		// Size and color read the notes only. Heading and block nodes are small and drawn in the muted sub color.
		const notes = g.nodes.flatMap((n, i) => (n.sub ? [] : [i]));
		const rowsOf = notes.map((i) => input[g.nodes[i]!.row]!);
		const noteRadius = opts.sizeBy ? sizeScale(rowsOf.map((r) => parseNumber(r.props?.[opts.sizeBy!] ?? null)), { min: 4, max: 18, fallback: 3 }) : notes.map((i) => Math.min(14, 4 + Math.sqrt(g.nodes[i]!.degree) * 1.6));
		this.radius = Float64Array.from(g.nodes, (n) => (n.sub ? (n.sub.kind === 'block' ? SUB_RADIUS - 0.5 : SUB_RADIUS) : 0));
		notes.forEach((i, k) => {
			this.radius[i] = noteRadius[k]!;
		});
		const noteColor = opts.colorBy ? colorScale(rowsOf.map((r) => r.props?.[opts.colorBy!] ?? null)) : null;
		if (noteColor) {
			const slots = new Array<number>(g.nodes.length).fill(-1);
			notes.forEach((i, k) => {
				slots[i] = noteColor.slots[k]!;
			});
			this.color = { ...noteColor, slots };
		} else this.color = null;
		this.linkColor = opts.linkColors ? relationColors(g.edges) : null;
		const buildMs = performance.now() - t0;
		this.startLayout(g, opts);
		this.stats = { rows: input.length, nodes: g.nodes.length, edges: g.edges.length, buildMs, layoutMs: this.stats?.layoutMs ?? 0, ticks: 0, drawMs: 0, frames: 0 };
		const t1 = performance.now();
		const warm = run(this.layout!, this.plugin.settings.animate ? 120 : 1000, this.plugin.settings.animate ? 50 : 400);
		this.stats.layoutMs = performance.now() - t1;
		this.stats.ticks = warm;
		this.drawBar();
		this.drawLegend();
		if (!this.fitted || opts.saved === null) this.fit();
		this.draw();
		this.animate();
	}

	/** A free user turned "Color links by relation" on: say that it is Pro. The option stays saved and is ignored. */
	checkLinkColors(): void {
		const on = this.config.get(KEY.linkColors) === true;
		if (on && this.lastLinkColors === false && !isPro()) GraphView.needsPro('Link colors by relation');
		this.lastLinkColors = on;
	}

	/** New layout; nodes keep their last position (or the saved layout) so an edit does not scramble the graph. */
	private startLayout(g: Graph, opts: ViewOptions): void {
		const prev = new Map<string, [number, number]>();
		const old = this.layout;
		if (old && this.graph) {
			// this.graph is already the new graph; positions come from the old node order kept on the layout.
			const ids = (old as LayoutState & { ids?: string[] }).ids ?? [];
			ids.forEach((id, i) => prev.set(id, [old.x[i]!, old.y[i]!]));
		}
		const saved = g.nodes.map((n) => opts.saved?.[n.id] ?? prev.get(n.id) ?? null);
		const edges = g.edges.map((e) => [e.source, e.target] as [number, number]);
		const parents = g.nodes.map((n) => (n.sub ? n.sub.parent : -1));
		const l = createLayout(g.nodes.length, edges, { linkDistance: opts.spacing }, saved, opts.saved !== null, parents);
		(l as LayoutState & { ids?: string[] }).ids = g.nodes.map((n) => n.id);
		if (prev.size > 0 && opts.saved === null && saved.every((p) => p !== null)) l.alpha = 0.1;
		this.layout = l;
	}

	private stop(): void {
		if (this.raf !== null) window.cancelAnimationFrame(this.raf);
		this.raf = null;
	}

	/** Runs layout ticks in animation frames (8 ms each) until the layout cools down, drawing each frame. */
	private animate(): void {
		this.stop();
		const step = () => {
			this.raf = null;
			const l = this.layout;
			if (!l || !this.root.isConnected) return;
			const t0 = performance.now();
			let more = true;
			while (more && performance.now() - t0 < 8) more = tick(l);
			if (this.stats) this.stats.ticks = l.ticks;
			if (!this.fitted || (!this.pointer && l.ticks < 200 && this.opts?.saved === null)) this.fit();
			this.draw();
			if (more || l.alphaTarget > 0) this.raf = window.requestAnimationFrame(step);
		};
		this.raf = window.requestAnimationFrame(step);
	}

	/** Zoom and offset so that the whole graph fits the canvas. */
	fit(): void {
		const l = this.layout;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (!l || w === 0 || h === 0) return;
		const [x0, y0, x1, y1] = bounds(l);
		const pad = 40;
		const k = Math.min(2, (w - 2 * pad) / Math.max(1, x1 - x0), (h - 2 * pad) / Math.max(1, y1 - y0));
		this.zoom = Math.max(0.05, k);
		this.tx = w / 2 - ((x0 + x1) / 2) * this.zoom;
		this.ty = h / 2 - ((y0 + y1) / 2) * this.zoom;
		this.fitted = true;
	}

	private resize(): void {
		const r = window.devicePixelRatio || 1;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w === 0 || h === 0) return;
		const changed = this.canvas.width !== Math.round(w * r) || this.canvas.height !== Math.round(h * r);
		this.canvas.width = Math.round(w * r);
		this.canvas.height = Math.round(h * r);
		if (!this.fitted || changed) this.fit();
		this.draw();
	}

	private refreshTheme(): void {
		this.theme = null;
		this.drawLegend();
		this.draw();
	}

	/** Fill color of node i. */
	nodeColor(i: number, t: Theme): string {
		if (this.graph?.nodes[i]?.sub) return t.sub ?? t.node;
		const slot = this.color?.slots[i] ?? -1;
		if (slot < 0) return t.node;
		return this.color?.kind === 'number' ? (t.ramp[slot] ?? t.node) : (t.palette[slot % t.palette.length] ?? t.node);
	}

	/** Palette color of a slot, or the fallback for no slot. */
	private slotColor(slot: number, t: Theme, fallback: string): string {
		return slot < 0 ? fallback : (t.palette[slot % t.palette.length] ?? fallback);
	}

	/** Line color of edge k when it is not lit: shared values, the relation color (Pro), or the theme line color. */
	edgeColor(k: number, t: Theme): string {
		const e = this.graph?.edges[k];
		if (e?.kind === 'shared') return t.shared;
		if (e?.kind === 'part') return t.line;
		return this.slotColor(this.linkColor?.slots[k] ?? -1, t, t.line);
	}

	/** Draws the graph to the view canvas. */
	draw(): void {
		const ctx = this.canvas.getContext('2d');
		const l = this.layout;
		const g = this.graph;
		if (!ctx || !l || !g) return;
		const t0 = performance.now();
		this.theme ??= readTheme(this.root, this.canvas);
		const r = window.devicePixelRatio || 1;
		if (this.canvas.width !== Math.round(this.canvas.clientWidth * r) || this.canvas.height !== Math.round(this.canvas.clientHeight * r)) {
			this.resize();
			return;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.setTransform(r * this.zoom, 0, 0, r * this.zoom, r * this.tx, r * this.ty);
		this.paint(ctx, this.theme, this.zoom, this.hover);
		if (this.stats) {
			this.stats.drawMs = performance.now() - t0;
			this.stats.frames++;
		}
	}

	/** Paints edges, nodes and labels with the current transform. Shared by the view and the PNG export (allLabels true). */
	paint(ctx: CanvasRenderingContext2D, t: Theme, zoom: number, hover: number, allLabels = false): void {
		const l = this.layout!;
		const g = this.graph!;
		const near = hover >= 0 ? new Set([hover, ...(this.neighbours[hover] ?? [])]) : null;
		const lw = 1 / zoom;
		const arrows = this.opts?.arrows === true;
		this.arrowTips = [];
		for (const kind of ['part', 'shared', 'link'] as const) {
			ctx.setLineDash(kind === 'shared' ? [4 * lw, 3 * lw] : []);
			g.edges.forEach((e, k) => {
				if (e.kind !== kind) return;
				const lit = near !== null && (e.source === hover || e.target === hover);
				const width = kind === 'part' ? (lit ? 1.5 : 0.75) : lit ? 2 : Math.min(3, 1 + Math.log2(e.weight));
				ctx.globalAlpha = near && !lit ? 0.15 : kind === 'link' ? 0.8 : 0.55;
				ctx.strokeStyle = lit ? t.accent : this.edgeColor(k, t);
				ctx.lineWidth = lw * width;
				ctx.beginPath();
				ctx.moveTo(l.x[e.source]!, l.y[e.source]!);
				ctx.lineTo(l.x[e.target]!, l.y[e.target]!);
				ctx.stroke();
				if (!arrows) return;
				ctx.fillStyle = ctx.strokeStyle;
				for (const end of arrowEnds(e)) {
					const [from, to] = end === 'target' ? [e.source, e.target] : [e.target, e.source];
					const head = arrowHead(l.x[from]!, l.y[from]!, l.x[to]!, l.y[to]!, this.radius[to] ?? 5, arrowSize(width) * lw);
					if (!head) continue;
					ctx.beginPath();
					ctx.moveTo(head[0]![0], head[0]![1]);
					ctx.lineTo(head[1]![0], head[1]![1]);
					ctx.lineTo(head[2]![0], head[2]![1]);
					ctx.closePath();
					ctx.fill();
					this.arrowTips.push(g.nodes[to]!.id);
				}
			});
		}
		ctx.setLineDash([]);
		for (let i = 0; i < l.n; i++) {
			ctx.globalAlpha = near && !near.has(i) ? 0.25 : 1;
			ctx.fillStyle = i === hover ? t.accent : this.nodeColor(i, t);
			ctx.beginPath();
			ctx.arc(l.x[i]!, l.y[i]!, this.radius[i] ?? 5, 0, Math.PI * 2);
			ctx.fill();
		}
		this.paintLabels(ctx, t, zoom, near, allLabels);
		ctx.globalAlpha = 1;
	}

	private paintLabels(ctx: CanvasRenderingContext2D, t: Theme, zoom: number, near: Set<number> | null, allLabels: boolean): void {
		const l = this.layout!;
		const g = this.graph!;
		const mode = this.opts?.labels ?? 'auto';
		const all = allLabels || mode === 'always' || (mode === 'auto' && zoom >= 0.75);
		if (!all && !near) return;
		const size = 12 / zoom;
		ctx.font = `${size}px ${t.font}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.fillStyle = t.text;
		const small = `${size * 0.85}px ${t.font}`;
		for (let i = 0; i < l.n; i++) {
			if (!all && !near?.has(i)) continue;
			const sub = g.nodes[i]!.sub !== undefined;
			ctx.font = sub ? small : `${size}px ${t.font}`;
			ctx.globalAlpha = near && !near.has(i) ? 0.3 : sub ? 0.8 : 1;
			ctx.fillText(g.nodes[i]!.label, l.x[i]!, l.y[i]! + (this.radius[i] ?? 5) + 2 / zoom);
		}
	}

	/** Screen position (CSS px, relative to the canvas) of the node with this path, for tests and the tooltip. */
	screenPos(path: string): { x: number; y: number } | null {
		const i = this.graph?.nodes.findIndex((n) => n.id === path) ?? -1;
		if (i < 0 || !this.layout) return null;
		return { x: this.layout.x[i]! * this.zoom + this.tx, y: this.layout.y[i]! * this.zoom + this.ty };
	}

	private toLayout(evt: MouseEvent): [number, number] {
		const rect = this.canvas.getBoundingClientRect();
		return [(evt.clientX - rect.left - this.tx) / this.zoom, (evt.clientY - rect.top - this.ty) / this.zoom];
	}

	private nodeAt(evt: MouseEvent): number {
		if (!this.layout) return -1;
		const [x, y] = this.toLayout(evt);
		return hitTest(this.layout, this.radius, x, y, 3 / this.zoom);
	}

	private bindPointer(): void {
		const c = this.canvas;
		this.registerDomEvent(c, 'pointerdown', (evt) => this.onDown(evt));
		this.registerDomEvent(c, 'pointermove', (evt) => this.onMove(evt));
		this.registerDomEvent(c, 'pointerup', (evt) => this.onUp(evt));
		// Touch scroll or a system gesture cancels the pointer with no pointerup. Without this the drag stays on and the layout never cools.
		this.registerDomEvent(c, 'pointercancel', () => this.endDrag());
		this.registerDomEvent(c, 'pointerleave', () => this.setHover(-1, null));
		this.registerDomEvent(c, 'dblclick', (evt) => {
			if (this.nodeAt(evt) < 0) {
				this.fit();
				this.draw();
			}
		});
		this.registerDomEvent(c, 'contextmenu', (evt) => this.onMenu(evt));
		this.registerDomEvent(c, 'wheel', (evt) => this.onWheel(evt), { passive: false });
	}

	private onDown(evt: PointerEvent): void {
		if (evt.button !== 0) return;
		const i = this.nodeAt(evt);
		this.canvas.setPointerCapture(evt.pointerId);
		// A heading or block node sits on a ring around its note, so a drag on it moves the note.
		let drag = i;
		while (drag >= 0 && (this.layout!.parent[drag] ?? -1) >= 0) drag = this.layout!.parent[drag]!;
		this.pointer = { mode: i >= 0 ? 'node' : 'pan', node: i, drag, startX: evt.clientX, startY: evt.clientY, moved: false, wasFixed: drag >= 0 && this.layout!.fixed[drag] === 1 };
	}

	private onMove(evt: PointerEvent): void {
		const p = this.pointer;
		if (!p) {
			const i = this.nodeAt(evt);
			this.setHover(i, evt);
			return;
		}
		const dx = evt.clientX - p.startX;
		const dy = evt.clientY - p.startY;
		if (!p.moved && dx * dx + dy * dy < 16) return;
		p.moved = true;
		if (p.mode === 'pan') {
			this.tx += evt.movementX;
			this.ty += evt.movementY;
			this.draw();
			return;
		}
		const l = this.layout!;
		const [x, y] = this.toLayout(evt);
		l.x[p.drag] = x;
		l.y[p.drag] = y;
		l.fixed[p.drag] = 1;
		l.alphaTarget = 0.1;
		reheat(l, 0.1);
		if (this.raf === null) this.animate();
	}

	private onUp(evt: PointerEvent): void {
		if (this.canvas.hasPointerCapture(evt.pointerId)) this.canvas.releasePointerCapture(evt.pointerId);
		const p = this.endDrag();
		if (p && !p.moved && p.mode === 'node') this.open(p.node, Keymap.isModEvent(evt));
	}

	/** Ends a pan or a node drag and lets the layout cool. Returns the pointer that ended. */
	private endDrag(): Pointer | null {
		const p = this.pointer;
		this.pointer = null;
		if (!p) return null;
		if (p.mode === 'node' && this.layout) {
			this.layout.alphaTarget = 0;
			if (!p.wasFixed && this.opts?.saved === null) this.layout.fixed[p.drag] = 0;
			if (this.opts?.saved) this.layout.fixed[p.drag] = 1;
		}
		return p;
	}

	/**
	 * Opens the note of node i (in a new tab with Ctrl or Cmd). Opens the file itself, not a link to its path:
	 * openLinkText cuts a name such as "C# guide.md" at the # and can create a new empty note.
	 */
	open(i: number, newTab: boolean | 'tab' | 'split' | 'window' = false): void {
		const n = this.graph?.nodes[i];
		const file = n ? this.app.vault.getFileByPath(this.notePath(i)) : null;
		if (!file) return;
		// A heading or block node opens its note at the heading or block. The subpath goes in the ephemeral state, as
		// openLinkText does, so a "#" in the file name cannot cut the path.
		const sub = n?.sub;
		const leaf = this.app.workspace.getLeaf(newTab);
		if (!sub) {
			void leaf.openFile(file);
			return;
		}
		// The subpath scrolls to the first heading with that path. Then the cursor goes to the line of this node,
		// so a second heading with the same text ("Notes [2]") opens at its own line.
		void leaf.openFile(file, { eState: { subpath: this.subpathOf(i) } }).then(() => GraphView.showLine(leaf.view, file.path, sub.line));
	}

	/** Puts the cursor on `line` and scrolls to it, in the Markdown view of `path`. */
	static showLine(view: unknown, path: string, line: number): void {
		if (!(view instanceof MarkdownView) || view.file?.path !== path) return;
		if (view.getMode() === 'preview') {
			// The ephemeral line waits for the render, as the subpath scroll does, and runs after it.
			// applyScroll alone runs before the render and the subpath scroll then moves the view to the first heading.
			view.setEphemeralState({ line });
			return;
		}
		const pos = { line, ch: 0 };
		view.editor.setCursor(pos);
		view.editor.scrollIntoView({ from: pos, to: pos }, true);
	}

	/** Vault path of the note of node i (for a heading or block node, its note). */
	notePath(i: number): string {
		const n = this.graph?.nodes[i];
		if (!n) return '';
		return n.sub ? (this.graph?.nodes[n.sub.parent] && !this.graph.nodes[n.sub.parent]!.sub ? this.graph.nodes[n.sub.parent]!.id : this.rowPath(n.row)) : n.id;
	}

	/** Vault path of row r of the last drawn graph. */
	private rowPath(r: number): string {
		return this.graph?.nodes.find((x) => !x.sub && x.row === r)?.id ?? this.data.data[r]?.file.path ?? '';
	}

	/** "#Heading" or "#^block" for a heading or block node, as a link writes it; "" for a note. */
	subpathOf(i: number): string {
		const s = this.graph?.nodes[i]?.sub;
		if (!s) return '';
		// A nested path ("#Chapter 2#Summary") finds the right one of two headings with the same text.
		return s.kind === 'block' ? `#^${s.name}` : `#${(s.trail ?? [s.name]).map(headingLinkText).join('#')}`;
	}

	private onWheel(evt: WheelEvent): void {
		evt.preventDefault();
		// A legend or toolbar can change the stage height after its first draw.
		// Resize before the gesture, so draw() does not fit away its pan or zoom.
		const ratio = window.devicePixelRatio || 1;
		if (this.canvas.width !== Math.round(this.canvas.clientWidth * ratio) || this.canvas.height !== Math.round(this.canvas.clientHeight * ratio)) this.resize();
		// Pixel scroll is a two-finger swipe on a trackpad. Ctrl-wheel is the
		// browser's pinch signal. The setting keeps mouse-wheel zoom as the default.
		if (this.plugin.settings.trackpad && !evt.ctrlKey && !evt.metaKey) {
			const unit = evt.deltaMode === 1 ? 16 : evt.deltaMode === 2 ? Math.max(1, this.canvas.clientHeight) : 1;
			this.tx -= evt.deltaX * unit;
			this.ty -= evt.deltaY * unit;
			this.draw();
			return;
		}
		const rect = this.canvas.getBoundingClientRect();
		const mx = evt.clientX - rect.left;
		const my = evt.clientY - rect.top;
		const factor = this.plugin.settings.trackpad ? 0.01 : 0.0015;
		const k = Math.max(0.05, Math.min(8, this.zoom * Math.exp(-evt.deltaY * factor)));
		this.tx = mx - ((mx - this.tx) * k) / this.zoom;
		this.ty = my - ((my - this.ty) * k) / this.zoom;
		this.zoom = k;
		this.draw();
	}

	private setHover(i: number, evt: MouseEvent | null): void {
		if (i === this.hover) {
			if (i >= 0 && evt) this.placeTip(evt);
			return;
		}
		this.hover = i;
		this.canvas.toggleClass('is-over-node', i >= 0);
		this.draw();
		const n = i >= 0 ? this.graph?.nodes[i] : undefined;
		if (!n || !evt) {
			this.tip.removeClass('is-shown');
			return;
		}
		this.fillTip(i);
		this.placeTip(evt);
		this.app.workspace.trigger('hover-link', { event: evt, source: VIEW_ID, hoverParent: this, targetEl: this.canvas, sourcePath: '', ...this.hoverTarget(i) });
	}

	/**
	 * Link text for the page preview of node i. The subpath previews the first heading with that path. When that is not
	 * the line of this node ("Notes [2]"), the preview shows the note and scrolls to the line of this node.
	 */
	hoverTarget(i: number): { linktext: string; state?: { scroll: number } } {
		const n = this.graph?.nodes[i];
		if (!n) return { linktext: '' };
		if (!n.sub) return { linktext: n.id };
		const path = this.notePath(i);
		const subpath = this.subpathOf(i);
		const file = this.app.vault.getFileByPath(path);
		const cache = file ? this.app.metadataCache.getFileCache(file) : null;
		const hit = cache ? resolveSubpath(cache, subpath) : null;
		if (n.sub.kind === 'block' || !hit || hit.start.line === n.sub.line) return { linktext: `${path}${subpath}` };
		return { linktext: path, state: { scroll: n.sub.line } };
	}

	private fillTip(i: number): void {
		const n = this.graph!.nodes[i]!;
		this.tip.empty();
		const note = n.sub ? this.graph!.nodes.find((x) => !x.sub && x.row === n.row) : undefined;
		this.tip.createDiv({ cls: 'bases-link-graph-tip-title', text: n.sub ? `${note?.label ?? ''} › ${n.label}` : n.label });
		const links = this.graph!.edges.filter((e) => e.kind === 'link' && (e.source === i || e.target === i)).length;
		this.tip.createDiv({ text: `${links} ${links === 1 ? 'link' : 'links'} in this base` });
		const lines = this.relationLines(i);
		for (const line of lines.slice(0, TIP_RELATIONS)) this.tip.createDiv({ cls: 'bases-link-graph-tip-relation', text: line });
		if (lines.length > TIP_RELATIONS) this.tip.createDiv({ cls: 'bases-link-graph-tip-relation', text: `+${lines.length - TIP_RELATIONS} more` });
		for (const p of [this.opts?.sizeBy, this.opts?.colorBy]) {
			if (!p) continue;
			const entry = this.data.data[n.row];
			const v = entry ? toPlain(entry.getValue(p)) : null;
			this.tip.createDiv({ text: `${this.config.getDisplayName(p)}: ${v === null ? '(no value)' : Array.isArray(v) ? v.join(', ') : String(v)}` });
		}
		this.tip.addClass('is-shown');
	}

	/** "parent → Atlas" for each relation from node i, then "friend ← Bea" for each relation to it. */
	relationLines(i: number): string[] {
		const g = this.graph;
		const n = g?.nodes[i];
		if (!g || !n) return [];
		const out: { dir: number; name: string; label: string }[] = [];
		for (const e of g.edges) {
			if (e.kind !== 'link' || (e.source !== i && e.target !== i)) continue;
			const other = g.nodes[e.source === i ? e.target : e.source]!;
			for (const r of e.relations ?? []) out.push({ dir: (r.node !== undefined ? r.node === i : r.from === n.row) ? 0 : 1, name: r.name, label: other.label });
		}
		out.sort((a, b) => a.dir - b.dir || a.name.localeCompare(b.name) || a.label.localeCompare(b.label));
		return out.map((r) => `${r.name} ${r.dir === 0 ? '→' : '←'} ${r.label}`);
	}

	private placeTip(evt: MouseEvent): void {
		const rect = this.root.getBoundingClientRect();
		this.tip.setCssStyles({ left: `${evt.clientX - rect.left + 14}px`, top: `${evt.clientY - rect.top + 14}px` });
	}

	private onMenu(evt: MouseEvent): void {
		const i = this.nodeAt(evt);
		const n = i >= 0 ? this.graph?.nodes[i] : undefined;
		if (!n) return;
		evt.preventDefault();
		const menu = new Menu();
		menu.addItem((it) => it.setTitle('Open in new tab').setIcon('file-plus').onClick(() => this.open(i, 'tab')));
		menu.addItem((it) =>
			it
				.setTitle(isPro() ? 'Show only notes near this one' : 'Show only notes near this one (Pro)')
				.setIcon('locate-fixed')
				.onClick(() => this.setFocus(this.notePath(i))),
		);
		if (this.opts?.focus) menu.addItem((it) => it.setTitle('Show all notes').setIcon('locate-off').onClick(() => this.setFocus(null)));
		menu.showAtMouseEvent(evt);
	}

	/** Pro: local depth around one note. Depth 1 when none is set yet. */
	setFocus(path: string | null): void {
		if (path !== null && !isPro()) {
			GraphView.needsPro('Local depth');
			return;
		}
		this.config.set(KEY.focus, path);
		if (path !== null && !(Number(this.config.get(KEY.depth)) > 0)) this.config.set(KEY.depth, 1);
		this.fitted = false;
		this.schedule(0);
	}

	private drawBar(): void {
		const g = this.graph!;
		const o = this.opts!;
		this.bar.empty();
		const links = g.edges.filter((e) => e.kind === 'link').length;
		const shared = g.edges.filter((e) => e.kind === 'shared').length;
		const subs = g.nodes.filter((n) => n.sub).length;
		const notes = g.nodes.length - subs;
		const parts = [`${notes} ${notes === 1 ? 'note' : 'notes'}`, `${links} ${links === 1 ? 'link' : 'links'}`];
		if (o.headings !== 'off') parts.push(`${subs} ${subs === 1 ? 'heading or block' : 'headings and blocks'}`);
		if (g.missing) parts.push(`${g.missing} heading or block ${g.missing === 1 ? 'link' : 'links'} not found`);
		if (shared > 0) parts.push(`${shared} shared values`);
		if (o.linkSource === 'body') parts.push('Body links only');
		if (o.linkSource === 'frontmatter') parts.push(o.linkProperties.length > 0 ? `Properties: ${o.linkProperties.join(', ')}` : 'Property links only');
		if (g.hidden.orphans > 0) parts.push(`${g.hidden.orphans} without links hidden`);
		this.bar.createSpan({ cls: 'bases-link-graph-count', text: parts.join(' · ') });
		if (o.focus) {
			const chip = this.bar.createSpan({ cls: 'bases-link-graph-focus', text: `Near ${o.focus.replace(/^.*\//, '').replace(/\.md$/, '')}, depth ${o.depth}` });
			const x = chip.createSpan({ cls: 'bases-link-graph-clear', attr: { 'aria-label': 'Show all notes' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.setFocus(null));
		}
		if (o.proIgnored) this.bar.createSpan({ cls: 'bases-link-graph-pro-note', text: 'Size, color, shared values, depth, link colors, heading nesting, heading levels and saved layouts are Pro features. They are off.' });
		this.button('maximize', 'Fit to view', () => {
			this.fit();
			this.draw();
		});
		if (!isPro()) return;
		this.button('save', 'Save layout', () => void this.plugin.saveLayout(this));
		if (o.saved) this.button('rotate-ccw', 'Reset layout', () => void this.plugin.resetLayout(this));
		this.button('image', 'Export PNG', () => void this.plugin.exportView(this, 'png'));
		this.button('file-code', 'Export SVG', () => void this.plugin.exportView(this, 'svg'));
	}

	private button(icon: string, label: string, fn: () => void): void {
		const b = this.bar.createEl('button', { cls: 'bases-link-graph-button clickable-icon', attr: { 'aria-label': label } });
		setIcon(b, icon);
		b.addEventListener('click', fn);
	}

	/** Two parts: node colors under the "Color by" name (Pro), then "Links" with one line per relation (Pro). */
	private drawLegend(): void {
		this.legendEl.empty();
		const c = this.color;
		const nodes = c !== null && c.legend.length > 0 && this.opts?.colorBy ? this.opts.colorBy : null;
		const links = this.linkLegendColors();
		if (!nodes && links.length === 0) {
			this.legendEl.removeClass('is-shown');
			return;
		}
		if (nodes) {
			this.legendEl.createDiv({ cls: 'bases-link-graph-legend-title', text: this.config.getDisplayName(nodes) });
			for (const item of this.legendColors()) this.legendRow(item, false);
		}
		if (links.length > 0) {
			this.legendEl.createDiv({ cls: 'bases-link-graph-legend-title bases-link-graph-legend-links', text: 'Links' });
			for (const item of links) this.legendRow(item, true);
		}
		this.legendEl.addClass('is-shown');
	}

	private legendRow(item: { label: string; color: string }, line: boolean): void {
		const row = this.legendEl.createDiv({ cls: line ? 'bases-link-graph-legend-row is-link' : 'bases-link-graph-legend-row' });
		const sw = row.createSpan({ cls: line ? 'bases-link-graph-swatch is-line' : 'bases-link-graph-swatch' });
		sw.setCssStyles({ backgroundColor: item.color });
		row.createSpan({ text: item.label });
	}

	/** Pro: the "Links" legend entries with their colors and edge counts, for the view and the SVG export. */
	linkLegendColors(): { label: string; color: string }[] {
		const c = this.linkColor;
		if (!c || !this.opts?.linkColors) return [];
		const t = this.currentTheme();
		return c.legend.map((item) => ({ label: `${item.label} (${item.count})`, color: this.slotColor(item.slot, t, t.line) }));
	}

	/** Legend entries with their colors, for the SVG export. */
	legendColors(): { label: string; color: string }[] {
		const c = this.color;
		const t = this.theme ?? readTheme(this.root, this.canvas);
		if (!c || !this.opts?.colorBy) return [];
		return c.legend.map((item) => ({ label: `${item.label} (${item.count})`, color: item.slot < 0 ? t.node : c.kind === 'number' ? (t.ramp[item.slot] ?? t.node) : (t.palette[item.slot % t.palette.length] ?? t.node) }));
	}

	currentTheme(): Theme {
		this.theme ??= readTheme(this.root, this.canvas);
		return this.theme;
	}

	/** Is this view in the active tab? */
	isActive(): boolean {
		const leafEl = this.app.workspace.getMostRecentLeaf()?.view.containerEl ?? null;
		return leafEl !== null && this.containerEl.isConnected && leafEl.contains(this.containerEl);
	}

	/** Shows a notice that a feature needs Pro. */
	static needsPro(feature: string): void {
		new Notice(`${feature} is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
	}
}

/** The options shown in the view options menu of the base. */
export function viewOptions(config: BasesViewConfig): BasesAllOptions[] {
	return [
		{ type: 'dropdown', key: KEY.labels, displayName: 'Labels', default: 'auto', options: { auto: 'When zoomed in', always: 'Always', hover: 'On hover only' } },
		{ type: 'toggle', key: KEY.orphans, displayName: 'Show notes without links', default: true },
		{ type: 'slider', key: KEY.spacing, displayName: 'Link length', default: 60, min: 20, max: 200, step: 10 },
		{ type: 'dropdown', key: KEY.linkSource, displayName: 'Draw links from', default: 'all', options: { all: 'All links', body: 'Note body', frontmatter: 'Properties' } },
		{ type: 'multitext', key: KEY.linkProperties, displayName: 'Link properties (empty = all)', default: [], shouldHide: () => config.get(KEY.linkSource) !== 'frontmatter' },
		{ type: 'toggle', key: KEY.arrows, displayName: 'Show arrows', default: false },
		{ type: 'dropdown', key: KEY.headings, displayName: 'Headings and blocks', default: 'off', options: { off: 'Off', linked: 'Linked headings and blocks', all: 'All headings' } },
		{
			type: 'group',
			displayName: 'Pro',
			items: [
				{ type: 'property', key: KEY.sizeBy, displayName: 'Size by', placeholder: 'Number of links' },
				{ type: 'property', key: KEY.colorBy, displayName: 'Color by', placeholder: 'One color' },
				{ type: 'multitext', key: KEY.shared, displayName: 'Join notes that share', default: [] },
				{ type: 'slider', key: KEY.depth, displayName: 'Local depth (0 = all notes)', default: 0, min: 0, max: 5, step: 1 },
				{ type: 'toggle', key: KEY.linkColors, displayName: 'Color links by relation', default: false },
				{ type: 'toggle', key: KEY.headingChain, displayName: 'Nest headings under their parent heading', default: false, shouldHide: () => config.get(KEY.headings) !== 'linked' && config.get(KEY.headings) !== 'all' },
				{ type: 'slider', key: KEY.headingLevel, displayName: 'Deepest heading level', default: 6, min: 1, max: 6, step: 1, shouldHide: () => config.get(KEY.headings) !== 'linked' && config.get(KEY.headings) !== 'all' },
			],
		},
	];
}
