import { BasesView, Keymap, Menu, Notice, setIcon, type BasesAllOptions, type BasesPropertyId, type BasesViewConfig, type HoverParent, type HoverPopover, type QueryController } from 'obsidian';
import { buildGraph, colorScale, parseNumber, sizeScale, type ColorResult, type Graph, type NodeInput, type PropValue } from './graph';
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
	sizeBy: 'graphSizeBy',
	colorBy: 'graphColorBy',
	shared: 'graphSharedProps',
	depth: 'graphDepth',
	focus: 'graphFocus',
	layout: 'graphLayout',
} as const;

type Labels = 'auto' | 'always' | 'hover';

export interface ViewOptions {
	labels: Labels;
	showOrphans: boolean;
	spacing: number;
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
	const val = v as { toString(): string; isTruthy?(): boolean; length?: unknown; get?: unknown };
	if (typeof val.length === 'function' && typeof val.get === 'function') {
		const list = val as unknown as { length(): number; get(i: number): unknown };
		const out: string[] = [];
		for (let i = 0; i < list.length(); i++) {
			const item = toPlain(list.get(i));
			if (item !== null && !Array.isArray(item)) out.push(String(item));
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
}

/** Bases view that draws the notes of a base as a force-directed graph on a canvas. */
export class GraphView extends BasesView implements HoverParent {
	type = VIEW_ID;
	hoverPopover: HoverPopover | null = null;
	graph: Graph | null = null;
	layout: LayoutState | null = null;
	radius = new Float64Array(0);
	color: ColorResult | null = null;
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
		const depth = Number(c.get(KEY.depth));
		const focus = c.get(KEY.focus);
		const layout = c.get(KEY.layout);
		const sharedRaw = c.get(KEY.shared);
		const shared = (Array.isArray(sharedRaw) ? sharedRaw : []).filter((x): x is string => typeof x === 'string').map(toPropertyId).filter((x): x is BasesPropertyId => x !== null);
		const sizeBy = c.getAsPropertyId(KEY.sizeBy);
		const colorBy = c.getAsPropertyId(KEY.colorBy);
		const saved = layout && typeof layout === 'object' && !Array.isArray(layout) ? (layout as Record<string, [number, number]>) : null;
		const anyPro = sizeBy !== null || colorBy !== null || shared.length > 0 || depth > 0 || saved !== null;
		return {
			labels: labels === 'always' || labels === 'hover' ? labels : 'auto',
			showOrphans: c.get(KEY.orphans) !== false,
			spacing: Number.isFinite(spacing) && spacing >= 20 && spacing <= 200 ? spacing : 60,
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
		const links = this.app.metadataCache.resolvedLinks;
		return this.data.data.map((e) => {
			const values: Record<string, PropValue> = {};
			for (const p of props) values[p] = toPlain(e.getValue(p));
			return { id: e.file.path, label: e.file.basename, links: links[e.file.path] ?? {}, props: values };
		});
	}

	/** Builds the graph from the current rows and starts the layout. */
	render(): void {
		// A Pro change or a note edit can arrive before Bases has given this view its first data.
		if (!(this.data as BasesView['data'] | undefined)) return;
		const t0 = performance.now();
		const opts = this.options();
		this.opts = opts;
		const input = this.input(opts);
		this.paths = new Set(input.map((r) => r.id));
		const g = buildGraph(input, { showOrphans: opts.showOrphans, sharedProps: opts.shared, focus: opts.focus, depth: opts.focus ? opts.depth : 0 });
		this.graph = g;
		this.neighbours = g.nodes.map(() => []);
		for (const e of g.edges) {
			this.neighbours[e.source]!.push(e.target);
			this.neighbours[e.target]!.push(e.source);
		}
		const rowsOf = g.nodes.map((n) => input[n.row]!);
		this.radius = Float64Array.from(
			opts.sizeBy ? sizeScale(rowsOf.map((r) => parseNumber(r.props?.[opts.sizeBy!] ?? null)), { min: 4, max: 18, fallback: 3 }) : g.nodes.map((n) => Math.min(14, 4 + Math.sqrt(n.degree) * 1.6)),
		);
		this.color = opts.colorBy ? colorScale(rowsOf.map((r) => r.props?.[opts.colorBy!] ?? null)) : null;
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
		const l = createLayout(g.nodes.length, edges, { linkDistance: opts.spacing }, saved, opts.saved !== null);
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
		const slot = this.color?.slots[i] ?? -1;
		if (slot < 0) return t.node;
		return this.color?.kind === 'number' ? (t.ramp[slot] ?? t.node) : (t.palette[slot % t.palette.length] ?? t.node);
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

	/** Paints edges, nodes and labels with the current transform. Shared by the view and the PNG export. */
	paint(ctx: CanvasRenderingContext2D, t: Theme, zoom: number, hover: number): void {
		const l = this.layout!;
		const g = this.graph!;
		const near = hover >= 0 ? new Set([hover, ...(this.neighbours[hover] ?? [])]) : null;
		const lw = 1 / zoom;
		for (const kind of ['shared', 'link'] as const) {
			ctx.setLineDash(kind === 'shared' ? [4 * lw, 3 * lw] : []);
			for (const e of g.edges) {
				if (e.kind !== kind) continue;
				const lit = near !== null && (e.source === hover || e.target === hover);
				ctx.globalAlpha = near && !lit ? 0.15 : kind === 'shared' ? 0.55 : 0.8;
				ctx.strokeStyle = lit ? t.accent : kind === 'shared' ? t.shared : t.line;
				ctx.lineWidth = lw * (lit ? 2 : Math.min(3, 1 + Math.log2(e.weight)));
				ctx.beginPath();
				ctx.moveTo(l.x[e.source]!, l.y[e.source]!);
				ctx.lineTo(l.x[e.target]!, l.y[e.target]!);
				ctx.stroke();
			}
		}
		ctx.setLineDash([]);
		for (let i = 0; i < l.n; i++) {
			ctx.globalAlpha = near && !near.has(i) ? 0.25 : 1;
			ctx.fillStyle = i === hover ? t.accent : this.nodeColor(i, t);
			ctx.beginPath();
			ctx.arc(l.x[i]!, l.y[i]!, this.radius[i] ?? 5, 0, Math.PI * 2);
			ctx.fill();
		}
		this.paintLabels(ctx, t, zoom, near);
		ctx.globalAlpha = 1;
	}

	private paintLabels(ctx: CanvasRenderingContext2D, t: Theme, zoom: number, near: Set<number> | null): void {
		const l = this.layout!;
		const g = this.graph!;
		const mode = this.opts?.labels ?? 'auto';
		const all = mode === 'always' || (mode === 'auto' && zoom >= 0.75);
		if (!all && !near) return;
		const size = 12 / zoom;
		ctx.font = `${size}px ${t.font}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.fillStyle = t.text;
		for (let i = 0; i < l.n; i++) {
			if (!all && !near?.has(i)) continue;
			ctx.globalAlpha = near && !near.has(i) ? 0.3 : 1;
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
		this.pointer = { mode: i >= 0 ? 'node' : 'pan', node: i, startX: evt.clientX, startY: evt.clientY, moved: false, wasFixed: i >= 0 && this.layout!.fixed[i] === 1 };
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
		l.x[p.node] = x;
		l.y[p.node] = y;
		l.fixed[p.node] = 1;
		l.alphaTarget = 0.1;
		reheat(l, 0.1);
		if (this.raf === null) this.animate();
	}

	private onUp(evt: PointerEvent): void {
		const p = this.pointer;
		this.pointer = null;
		if (!p) return;
		if (this.canvas.hasPointerCapture(evt.pointerId)) this.canvas.releasePointerCapture(evt.pointerId);
		if (p.mode === 'node' && this.layout) {
			this.layout.alphaTarget = 0;
			if (!p.wasFixed && this.opts?.saved === null) this.layout.fixed[p.node] = 0;
			if (this.opts?.saved) this.layout.fixed[p.node] = 1;
		}
		if (!p.moved && p.mode === 'node') this.open(p.node, Keymap.isModEvent(evt));
	}

	/** Opens the note of node i (in a new tab with Ctrl or Cmd). */
	open(i: number, newTab: boolean | 'tab' | 'split' | 'window' = false): void {
		const n = this.graph?.nodes[i];
		if (n) void this.app.workspace.openLinkText(n.id, '', newTab);
	}

	private onWheel(evt: WheelEvent): void {
		evt.preventDefault();
		const rect = this.canvas.getBoundingClientRect();
		const mx = evt.clientX - rect.left;
		const my = evt.clientY - rect.top;
		const k = Math.max(0.05, Math.min(8, this.zoom * Math.exp(-evt.deltaY * 0.0015)));
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
		this.app.workspace.trigger('hover-link', { event: evt, source: VIEW_ID, hoverParent: this, targetEl: this.canvas, linktext: n.id, sourcePath: '' });
	}

	private fillTip(i: number): void {
		const n = this.graph!.nodes[i]!;
		this.tip.empty();
		this.tip.createDiv({ cls: 'bases-link-graph-tip-title', text: n.label });
		const links = this.graph!.edges.filter((e) => e.kind === 'link' && (e.source === i || e.target === i)).length;
		this.tip.createDiv({ text: `${links} ${links === 1 ? 'link' : 'links'} in this base` });
		for (const p of [this.opts?.sizeBy, this.opts?.colorBy]) {
			if (!p) continue;
			const entry = this.data.data[n.row];
			const v = entry ? toPlain(entry.getValue(p)) : null;
			this.tip.createDiv({ text: `${this.config.getDisplayName(p)}: ${v === null ? '(no value)' : Array.isArray(v) ? v.join(', ') : String(v)}` });
		}
		this.tip.addClass('is-shown');
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
				.onClick(() => this.setFocus(n.id)),
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
		const shared = g.edges.length - links;
		const parts = [`${g.nodes.length} ${g.nodes.length === 1 ? 'note' : 'notes'}`, `${links} ${links === 1 ? 'link' : 'links'}`];
		if (shared > 0) parts.push(`${shared} shared values`);
		if (g.hidden.orphans > 0) parts.push(`${g.hidden.orphans} without links hidden`);
		this.bar.createSpan({ cls: 'bases-link-graph-count', text: parts.join(' · ') });
		if (o.focus) {
			const chip = this.bar.createSpan({ cls: 'bases-link-graph-focus', text: `Near ${o.focus.replace(/^.*\//, '').replace(/\.md$/, '')}, depth ${o.depth}` });
			const x = chip.createSpan({ cls: 'bases-link-graph-clear', attr: { 'aria-label': 'Show all notes' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.setFocus(null));
		}
		if (o.proIgnored) this.bar.createSpan({ cls: 'bases-link-graph-pro-note', text: 'Size, color, shared values, depth and saved layouts are Pro features. They are off.' });
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

	private drawLegend(): void {
		this.legendEl.empty();
		const c = this.color;
		if (!c || c.legend.length === 0 || !this.opts?.colorBy) {
			this.legendEl.removeClass('is-shown');
			return;
		}
		this.theme ??= readTheme(this.root, this.canvas);
		const t = this.theme;
		this.legendEl.createDiv({ cls: 'bases-link-graph-legend-title', text: this.config.getDisplayName(this.opts.colorBy) });
		for (const item of c.legend) {
			const row = this.legendEl.createDiv({ cls: 'bases-link-graph-legend-row' });
			const sw = row.createSpan({ cls: 'bases-link-graph-swatch' });
			sw.setCssStyles({ backgroundColor: item.slot < 0 ? t.node : c.kind === 'number' ? (t.ramp[item.slot] ?? t.node) : (t.palette[item.slot % t.palette.length] ?? t.node) });
			row.createSpan({ text: `${item.label} (${item.count})` });
		}
		this.legendEl.addClass('is-shown');
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
	void config;
	return [
		{ type: 'dropdown', key: KEY.labels, displayName: 'Labels', default: 'auto', options: { auto: 'When zoomed in', always: 'Always', hover: 'On hover only' } },
		{ type: 'toggle', key: KEY.orphans, displayName: 'Show notes without links', default: true },
		{ type: 'slider', key: KEY.spacing, displayName: 'Link length', default: 60, min: 20, max: 200, step: 10 },
		{
			type: 'group',
			displayName: 'Pro',
			items: [
				{ type: 'property', key: KEY.sizeBy, displayName: 'Size by', placeholder: 'Number of links' },
				{ type: 'property', key: KEY.colorBy, displayName: 'Color by', placeholder: 'One color' },
				{ type: 'multitext', key: KEY.shared, displayName: 'Join notes that share', default: [] },
				{ type: 'slider', key: KEY.depth, displayName: 'Local depth (0 = all notes)', default: 0, min: 0, max: 5, step: 1 },
			],
		},
	];
}
