import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// Real-app checks of the Bases Link Graph view on the sample vault (30 notes: 6 projects, 12 people, 12 meetings;
// 55 links between them; Lena has no links). The same numbers are pinned in tests/sample.test.ts.
const DIR = 'Bases Link Graph';
const BASE = `${DIR}/Team graph.base`;
const ATLAS = `${DIR}/Notes/Atlas.md`;

interface ViewState {
	rows: number;
	nodes: number;
	links: number;
	shared: number;
	outside: number;
	cooled: boolean;
	legend: string[];
	proNote: boolean;
	buttons: string[];
	stats: { layoutMs: number; drawMs: number; ticks: number; buildMs: number } | null;
	canvas: { w: number; h: number };
	background: string;
}

/** State of the visible graph view (the newest one when there are several). */
async function viewState(): Promise<ViewState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface V {
			graph: { nodes: unknown[]; edges: { kind: string }[]; hidden: { outside: number } } | null;
			data: { data: unknown[] };
			layout: { alpha: number; alphaMin: number; alphaTarget: number } | null;
			stats: ViewState['stats'];
			containerEl: HTMLElement;
			theme: { background: string } | null;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const views = [...(p?.views ?? [])].filter((v) => v.containerEl.isConnected && v.containerEl.offsetParent !== null && v.graph);
		const v = views[views.length - 1];
		if (!v || !v.graph || !v.layout) return null;
		const el = v.containerEl;
		const canvas = el.querySelector('canvas')!;
		return {
			rows: v.data.data.length,
			nodes: v.graph.nodes.length,
			links: v.graph.edges.filter((e) => e.kind === 'link').length,
			shared: v.graph.edges.filter((e) => e.kind === 'shared').length,
			outside: v.graph.hidden.outside,
			cooled: v.layout.alpha < v.layout.alphaMin && v.layout.alphaTarget === 0,
			legend: Array.from(el.querySelectorAll('.bases-link-graph-legend.is-shown .bases-link-graph-legend-row')).map((r) => r.textContent ?? ''),
			proNote: el.querySelector('.bases-link-graph-pro-note') !== null,
			buttons: Array.from(el.querySelectorAll('.bases-link-graph-button')).map((b) => b.getAttribute('aria-label') ?? ''),
			stats: v.stats,
			canvas: { w: canvas.clientWidth, h: canvas.clientHeight },
			background: v.theme?.background ?? '',
		};
	}, pluginId);
}

async function waitFor(pred: (s: ViewState) => boolean, msg: string, timeout = 30000): Promise<ViewState> {
	let last: ViewState | null = null;
	await browser.waitUntil(
		async () => {
			last = await viewState();
			return last !== null && pred(last);
		},
		{ timeout, interval: 250, timeoutMsg: `${msg}; last state ${JSON.stringify(last)}` },
	);
	return last!;
}

/** Pro on: a stubbed GitHub Sponsors reply ($5 a month) and a fake token, then Refresh. Pro off: sign out. No real request. */
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

/** Opens a note that embeds one view of the sample base, so each test sees exactly one graph view. */
async function openEmbed(view: string): Promise<void> {
	const path = `${DIR}/E2E ${view}.md`;
	await obsidianPage.write(path, `![[${BASE}#${view}]]\n`);
	await obsidianPage.openFile(path);
}

/** Viewport position of a node's center, and the path of the node that the view's own hit test finds there. */
async function nodePoint(path: string): Promise<{ x: number; y: number; hit: string } | null> {
	return browser.executeObsidian(({ app }, id, p) => {
		interface V {
			containerEl: HTMLElement;
			graph: { nodes: { id: string }[] } | null;
			screenPos(path: string): { x: number; y: number } | null;
			layout: unknown;
			radius: Float64Array;
		}
		const pl = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
		const v = [...pl.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop();
		const pos = v?.screenPos(p);
		if (!v || !pos) return null;
		const rect = v.containerEl.querySelector('canvas')!.getBoundingClientRect();
		const x = Math.round(rect.left + pos.x);
		const y = Math.round(rect.top + pos.y);
		const el = document.elementFromPoint(x, y);
		return { x, y, hit: el?.tagName === 'CANVAS' ? p : (el?.className ?? 'nothing') };
	}, pluginId, path);
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await setPro(false);
	});

	it('draws one node per row of the base: 30 notes, 55 links', async function () {
		await obsidianPage.openFile(BASE);
		const s = await waitFor((x) => x.nodes === 30 && x.cooled, 'expected 30 nodes and a settled layout');
		expect(s.nodes).toBe(s.rows);
		expect(s.links).toBe(55);
		expect(s.shared).toBe(0);
		expect(s.canvas.w).toBeGreaterThan(200);
		expect(s.canvas.h).toBeGreaterThan(200);
	});

	it('a real mouse click on a node opens its note', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.nodes === 30 && x.cooled, 'layout did not settle');
		const pt = await nodePoint(ATLAS);
		expect(pt).not.toBeNull();
		expect(pt!.hit).toBe(ATLAS);
		await browser.action('pointer').move({ x: pt!.x, y: pt!.y }).down({ button: 0 }).pause(60).up({ button: 0 }).perform();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? '')) === ATLAS, { timeout: 10000, timeoutMsg: 'Atlas did not open' });
	});

	it('hover shows the tooltip with the note name', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.nodes === 30 && x.cooled, 'layout did not settle');
		const pt = await nodePoint(ATLAS);
		await browser.action('pointer').move({ x: pt!.x + 40, y: pt!.y + 40 }).move({ x: pt!.x, y: pt!.y }).perform();
		await browser.waitUntil(async () => (await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .bases-link-graph-tip.is-shown .bases-link-graph-tip-title')?.textContent ?? '')) === 'Atlas', {
			timeout: 5000,
			timeoutMsg: 'no tooltip for Atlas',
		});
	});

	it('updates when a note in the base gets a new link', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.links === 55, 'graph not drawn');
		const lena = `${DIR}/Notes/Lena.md`;
		const before = await obsidianPage.read(lena);
		await obsidianPage.write(lena, `${before}\nPairs with [[Gus]].\n`);
		await waitFor((x) => x.links === 56, 'the new link did not appear');
		await obsidianPage.write(lena, before);
		await waitFor((x) => x.links === 55, 'the link did not go away');
	});

	it('follows the theme: dark mode changes the canvas colors', async function () {
		await obsidianPage.openFile(BASE);
		const light = await waitFor((x) => x.nodes === 30 && x.background !== '', 'no theme read');
		await browser.executeObsidian(({ app }) => {
			document.body.classList.toggle('theme-dark');
			document.body.classList.toggle('theme-light');
			app.workspace.trigger('css-change');
		});
		const dark = await waitFor((x) => x.background !== '' && x.background !== light.background, 'background did not change');
		expect(dark.background).not.toBe(light.background);
		await browser.executeObsidian(({ app }) => {
			document.body.classList.toggle('theme-dark');
			document.body.classList.toggle('theme-light');
			app.workspace.trigger('css-change');
		});
	});

	it('after a plugin reload with the base open, the graph runs the new plugin code', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.nodes === 30, 'graph not drawn');
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		const s = await waitFor((x) => x.nodes === 30 && x.cooled, 'no graph view in the reloaded plugin');
		expect(s.nodes).toBe(s.rows);
	});

	it('free version: Pro options in the base file are ignored and said so', async function () {
		await openEmbed('By type');
		const s = await waitFor((x) => x.nodes === 30, 'embedded view not drawn');
		expect(s.legend).toEqual([]);
		expect(s.proNote).toBe(true);
		expect(s.buttons).toEqual(['Fit to view']);
		await openEmbed('Near Atlas');
		const n = await waitFor((x) => x.nodes === 30, 'free version shows all notes');
		expect(n.outside).toBe(0);
	});

	it('Pro: color legend, shared team edges and local depth', async function () {
		await setPro(true);
		await openEmbed('By type');
		const t = await waitFor((x) => x.legend.length === 3, 'expected 3 legend rows');
		expect(t.legend).toEqual(['meeting (12)', 'person (12)', 'project (6)']);
		expect(t.proNote).toBe(false);
		expect(t.buttons).toEqual(['Fit to view', 'Save layout', 'Export PNG', 'Export SVG']);
		await openEmbed('Shared teams');
		const sh = await waitFor((x) => x.shared > 0, 'expected shared value edges');
		expect(sh.links).toBe(55);
		await openEmbed('Near Atlas');
		const near = await waitFor((x) => x.nodes === 7, 'expected Atlas and its 6 neighbours');
		expect(near.outside).toBe(23);
	});

	it('Pro: export PNG and SVG, save and reset the layout', async function () {
		await setPro(true);
		await openEmbed('By type');
		await waitFor((x) => x.legend.length === 3 && x.cooled, 'view not ready');
		const out = await browser.executeObsidian(async ({ app }, id) => {
			interface P {
				targetView(): unknown;
				exportView(v: unknown, kind: 'png' | 'svg'): Promise<{ path: string } | null>;
				saveLayout(v: unknown): Promise<boolean>;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			const v = p.targetView();
			const png = await p.exportView(v, 'png');
			const svg = await p.exportView(v, 'svg');
			const pngFile = png ? app.vault.getFileByPath(png.path) : null;
			const svgFile = svg ? app.vault.getFileByPath(svg.path) : null;
			const bytes = pngFile ? new Uint8Array(await app.vault.readBinary(pngFile)) : new Uint8Array();
			const text = svgFile ? await app.vault.read(svgFile) : '';
			if (pngFile) await app.vault.delete(pngFile);
			if (svgFile) await app.vault.delete(svgFile);
			const saved = await p.saveLayout(v);
			return { pngMagic: Array.from(bytes.slice(0, 4)), pngSize: bytes.length, circles: (text.match(/<circle /g) ?? []).length, lines: (text.match(/<line /g) ?? []).length, saved };
		}, pluginId);
		expect(out.pngMagic).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(out.pngSize).toBeGreaterThan(5000);
		// 30 nodes + 3 legend dots; 55 link lines.
		expect(out.circles).toBe(33);
		expect(out.lines).toBe(55);
		expect(out.saved).toBe(true);
		await browser.waitUntil(async () => (await obsidianPage.read(BASE)).includes('graphLayout'), { timeout: 10000, timeoutMsg: 'layout not saved in the base file' });
		const base = await obsidianPage.read(BASE);
		expect(base).toContain('Atlas.md');
		await waitFor((x) => x.buttons.includes('Reset layout'), 'no Reset layout button');
		await browser.execute(() => (document.querySelector('.workspace-leaf.mod-active .bases-link-graph-button[aria-label="Reset layout"]') as HTMLElement | null)?.click());
		await browser.waitUntil(async () => !(await obsidianPage.read(BASE)).includes('graphLayout'), { timeout: 10000, timeoutMsg: 'layout not removed' });
		await setPro(false);
	});

	it('500 notes: node count equals row count, layout and frames at interactive speed', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Perf').catch(() => undefined);
			const jobs: Promise<unknown>[] = [];
			for (let i = 0; i < 500; i++) {
				const path = `Perf/Note ${String(i).padStart(3, '0')}.md`;
				const links = [1, 7, 31].map((d) => `[[Note ${String((i * 3 + d) % 500).padStart(3, '0')}]]`).join(' ');
				if (!app.vault.getFileByPath(path)) jobs.push(app.vault.create(path, `---\ntags: [perf]\nscore: ${i % 50}\n---\n${links}\n`));
			}
			await Promise.all(jobs);
			// The base sits outside the folder, so it is not a row of itself.
			await app.vault.create('Perf graph.base', 'filters:\n  and:\n    - file.inFolder("Perf")\nviews:\n  - type: bases-link-graph\n    name: Perf\n').catch(() => undefined);
		});
		// Let the metadata cache resolve the new links before the base is opened.
		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app }) => {
					const links = app.metadataCache.resolvedLinks;
					let n = 0;
					for (let i = 0; i < 500; i++) n += Object.keys(links[`Perf/Note ${String(i).padStart(3, '0')}.md`] ?? {}).length;
					return n >= 1490;
				}),
			{ timeout: 60000, timeoutMsg: 'links of the 500 notes not resolved' },
		);
		await obsidianPage.openFile('Perf graph.base');
		const s = await waitFor((x) => x.nodes === 500 && x.cooled, '500 nodes did not settle', 60000);
		expect(s.nodes).toBe(s.rows);
		expect(s.links).toBe(1490);
		const frames = await browser.executeObsidian(({ app }, id) => {
			interface V {
				draw(): void;
				stats: { drawMs: number } | null;
				graph: unknown;
				containerEl: HTMLElement;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop()!;
			const out: number[] = [];
			for (let i = 0; i < 20; i++) {
				v.draw();
				out.push(v.stats?.drawMs ?? -1);
			}
			return out;
		}, pluginId);
		const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
		console.log(`perf: 500 nodes, 1490 links; build ${s.stats?.buildMs.toFixed(1)} ms, warm-up layout ${s.stats?.layoutMs.toFixed(0)} ms, ${s.stats?.ticks} ticks in all; draw avg ${avg.toFixed(2)} ms, max ${Math.max(...frames).toFixed(2)} ms`);
		const strict = process.env.FX_PERF_STRICT === '1';
		expect(avg).toBeLessThan(strict ? 16 : 50);
		expect(s.stats?.layoutMs ?? 9999).toBeLessThan(strict ? 120 : 400);
	});
});
