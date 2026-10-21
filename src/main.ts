import { Notice, Plugin, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { toSvg, type SvgModel } from './graph';
import { bounds } from './layout';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, BasesLinkGraphSettingTab, normalizeSettings, type BasesLinkGraphSettings } from './settings';
import { GraphView, KEY, VIEW_ID, viewOptions } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** PNG export: pixels per layout unit, and the largest side in pixels. */
const PNG_SCALE = 2;
const PNG_MAX_SIDE = 8000;
/** The largest canvas area that iOS and iPadOS draw. A larger canvas gives no PNG. */
const PNG_MAX_AREA = 16_777_216;

/** Pixels per layout unit for a PNG of w x h layout units: 2 or less, inside the side and area limits. */
export function pngScale(w: number, h: number): number {
	const W = Math.max(1, w);
	const H = Math.max(1, h);
	const k = Math.min(PNG_SCALE, PNG_MAX_SIDE / W, PNG_MAX_SIDE / H, Math.sqrt(PNG_MAX_AREA / (W * H)));
	// Math.ceil in renderPng can add 1 pixel to each side; take that off the area limit.
	return Math.ceil(W * k) * Math.ceil(H * k) > PNG_MAX_AREA ? k * 0.999 : k;
}

/** "2026-10-10 1857" in local time, for export file names. No moment: the directory scanner cannot type it. */
export function fileStamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

export default class BasesLinkGraphPlugin extends Plugin {
	settings: BasesLinkGraphSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: BasesLinkGraphSettingTab | null = null;
	/** Open graph views. A view adds itself when created and removes itself on unload. */
	readonly views = new Set<GraphView>();

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new BasesLinkGraphSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerHoverLinkSource(VIEW_ID, { display: 'Bases Link Graph', defaultMod: true });
		const ok = this.registerBasesView(VIEW_ID, {
			name: 'Link graph',
			icon: 'git-fork',
			factory: (controller, containerEl) => new GraphView(controller, containerEl, this),
			options: viewOptions,
		});
		if (!ok) console.warn('Bases Link Graph: Bases is turned off in this vault, so the view is not available.');
		this.addViewCommand('fit', 'Fit the graph to the view', (v) => {
			v.fit();
			v.draw();
		});
		this.addViewCommand('export-png', 'Export the graph as a PNG image', (v) => void this.exportView(v, 'png'));
		this.addViewCommand('export-svg', 'Export the graph as an SVG image', (v) => void this.exportView(v, 'svg'));
		this.addViewCommand('save-layout', 'Save the layout of the graph', (v) => void this.saveLayout(v));
		this.app.workspace.onLayoutReady(() => {
			void this.reopenStaleBases();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	/**
	 * After a plugin update or reload, Bases keeps showing the graph views of the old plugin code. This opens each
	 * such base tab again, so its graph runs the current code. A first start finds none.
	 */
	async reopenStaleBases(): Promise<number> {
		let n = 0;
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const el = leaf.view.containerEl;
			const stale = el.querySelector('.bases-link-graph') !== null && ![...this.views].some((v) => el.contains(v.containerEl));
			if (!stale) continue;
			const state = leaf.getViewState();
			await leaf.setViewState({ type: 'empty' });
			await leaf.setViewState(state);
			n++;
		}
		return n;
	}

	private addViewCommand(id: string, name: string, fn: (v: GraphView) => void): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = this.targetView();
				if (!view) return false;
				if (!checking) fn(view);
				return true;
			},
		});
	}

	/** The graph view in the active tab, or else the one drawn last. */
	targetView(): GraphView | null {
		const open = [...this.views].filter((v) => v.graph !== null);
		return open.find((v) => v.isActive()) ?? open[open.length - 1] ?? null;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<BasesLinkGraphSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Pro: stores the node positions in the base file, with this view. */
	async saveLayout(view: GraphView): Promise<boolean> {
		if (!isPro()) {
			GraphView.needsPro('Saved layouts');
			return false;
		}
		const l = view.layout;
		const g = view.graph;
		if (!l || !g) return false;
		const pos: Record<string, [number, number]> = {};
		g.nodes.forEach((n, i) => {
			pos[n.id] = [Math.round(l.x[i]!), Math.round(l.y[i]!)];
		});
		view.config.set(KEY.layout, pos);
		new Notice(`Saved the layout of ${g.nodes.length} notes in the base file.`);
		view.schedule(0);
		return true;
	}

	/** Pro: removes the saved layout, so the graph lays itself out again. */
	async resetLayout(view: GraphView): Promise<void> {
		view.config.set(KEY.layout, null);
		view.schedule(0);
		await Promise.resolve();
	}

	/** The drawn graph as an SVG model in layout coordinates. */
	svgModel(view: GraphView): SvgModel {
		const l = view.layout!;
		const g = view.graph!;
		const t = view.currentTheme();
		return {
			background: t.background,
			text: t.text,
			nodes: g.nodes.map((n, i) => ({ x: l.x[i]!, y: l.y[i]!, r: view.radius[i] ?? 5, color: view.nodeColor(i, t), label: n.label })),
			edges: g.edges.map((e) => ({ source: e.source, target: e.target, dashed: e.kind === 'shared', color: e.kind === 'shared' ? t.shared : t.line, width: Math.min(3, 1 + Math.log2(e.weight)) })),
			legend: view.legendColors(),
		};
	}

	/** The whole graph as a PNG, drawn off screen at 2 pixels per unit with every label shown. */
	async renderPng(view: GraphView): Promise<ArrayBuffer> {
		const l = view.layout!;
		const [x0, y0, x1, y1] = bounds(l);
		const pad = 40;
		const scale = pngScale(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
		const canvas = createEl('canvas');
		canvas.width = Math.ceil((x1 - x0 + 2 * pad) * scale);
		canvas.height = Math.ceil((y1 - y0 + 2 * pad) * scale);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('No 2D canvas');
		const t = view.currentTheme();
		ctx.fillStyle = t.background;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(scale, 0, 0, scale, (pad - x0) * scale, (pad - y0) * scale);
		view.paint(ctx, t, 1, -1, true);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('PNG encoding failed');
		return blob.arrayBuffer();
	}

	/** Pro: writes the graph to a new PNG or SVG file next to new notes. */
	async exportView(view: GraphView, kind: 'png' | 'svg'): Promise<TFile | null> {
		if (!isPro()) {
			GraphView.needsPro('Export');
			return null;
		}
		if (!view.layout || !view.graph) return null;
		const stamp = fileStamp(new Date());
		const title = `${(view.config.name || 'Link graph').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()} ${stamp}`;
		const folder = this.app.fileManager.getNewFileParent('');
		const base = normalizePath(`${folder.path === '/' ? '' : folder.path + '/'}${title}`);
		let path = `${base}.${kind}`;
		for (let n = 2; this.app.vault.getAbstractFileByPath(path) && n < 1000; n++) path = `${base} ${n}.${kind}`;
		try {
			const file = kind === 'svg' ? await this.app.vault.create(path, toSvg(this.svgModel(view))) : await this.app.vault.createBinary(path, await this.renderPng(view));
			new Notice(`Exported the graph of ${view.graph.nodes.length} notes to ${file.path}`);
			return file;
		} catch (e) {
			console.error('Bases Link Graph: export failed', e);
			new Notice(`Could not export the graph: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}
}
