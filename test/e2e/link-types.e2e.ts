import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Arrows, relation names and link colors on the family sample (6 notes). Properties parent and friend give 7 link
// edges: Tom, Mia -> Rose; Leo, Zoe -> Tom; Sam -> Mia (parent); Zoe -> Sam and Leo <-> Sam (friend, the one mutual edge).
// Rose links to Mia in the note body, which the Properties source leaves out.
const DIR = 'Bases Link Graph';
const BASE = `${DIR}/Family tree.base`;
const TOM = `${DIR}/Family/Tom.md`;
const path = (name: string) => `${DIR}/Family/${name}.md`;

interface LinkState {
	nodes: number;
	links: number;
	mutual: number;
	cooled: boolean;
	arrows: boolean;
	arrowTips: string[];
	/** Per link edge: its first relation and the color that paint uses for it. */
	edges: { relation: string; color: string }[];
	line: string;
	legendLinks: string[];
	legendTitle: string;
	proNote: boolean;
}

async function linkState(): Promise<LinkState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface V {
			graph: { nodes: unknown[]; edges: { kind: string; mutual?: boolean; relations?: { name: string }[] }[] } | null;
			layout: { alpha: number; alphaMin: number; alphaTarget: number } | null;
			opts: { arrows: boolean } | null;
			arrowTips: string[];
			containerEl: HTMLElement;
			currentTheme(): { line: string };
			edgeColor(k: number, t: unknown): string;
			draw(): void;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const v = [...(p?.views ?? [])].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop();
		if (!v || !v.graph || !v.layout) return null;
		const t = v.currentTheme();
		v.draw();
		const el = v.containerEl;
		return {
			nodes: v.graph.nodes.length,
			links: v.graph.edges.filter((e) => e.kind === 'link').length,
			mutual: v.graph.edges.filter((e) => e.kind === 'link' && e.mutual).length,
			cooled: v.layout.alpha < v.layout.alphaMin && v.layout.alphaTarget === 0,
			arrows: v.opts?.arrows ?? false,
			arrowTips: [...v.arrowTips].sort(),
			edges: v.graph.edges.flatMap((e, k) => (e.kind === 'link' ? [{ relation: e.relations?.[0]?.name ?? '', color: v.edgeColor(k, t) }] : [])),
			line: t.line,
			legendLinks: Array.from(el.querySelectorAll('.bases-link-graph-legend.is-shown .bases-link-graph-legend-row.is-link')).map((r) => r.textContent ?? ''),
			legendTitle: el.querySelector('.bases-link-graph-legend.is-shown .bases-link-graph-legend-links')?.textContent ?? '',
			proNote: el.querySelector('.bases-link-graph-pro-note') !== null,
		};
	}, pluginId);
}

async function waitFor(pred: (s: LinkState) => boolean, msg: string, timeout = 30000): Promise<LinkState> {
	let last: LinkState | null = null;
	await browser.waitUntil(
		async () => {
			last = await linkState();
			return last !== null && pred(last);
		},
		{ timeout, interval: 250, timeoutMsg: `${msg}; last state ${JSON.stringify(last)}` },
	);
	return last!;
}

/** Pro on with a stubbed GitHub Sponsors reply, Pro off with sign out. No real request. */
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

/** Sets one option of the visible graph view, as the view options menu does, and redraws. */
async function setOption(key: string, value: unknown): Promise<void> {
	await browser.executeObsidian(
		({ app }, id, k, val) => {
			interface V {
				containerEl: HTMLElement;
				graph: unknown;
				config: { set(key: string, value: unknown): void };
				schedule(delay: number): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop()!;
			v.config.set(k, val);
			v.schedule(0);
		},
		pluginId,
		key,
		value,
	);
}

const EXPECTED_TIPS = ['Leo', 'Mia', 'Rose', 'Rose', 'Sam', 'Sam', 'Tom', 'Tom'].map(path);

describe(`${pluginId} link types in the real app`, function () {
	before(async function () {
		await setPro(false);
	});

	after(async function () {
		await setPro(false);
	});

	it('criterion 1: arrowheads at each target and two on the one mutual edge, saved with the view', async function () {
		await obsidianPage.openFile(BASE);
		const s = await waitFor((x) => x.nodes === 6 && x.links === 7 && x.arrowTips.length === 8, 'expected 6 notes, 7 property links and 8 arrowheads');
		expect(s.arrows).toBe(true);
		expect(s.mutual).toBe(1);
		expect(s.arrowTips).toEqual(EXPECTED_TIPS);
		const before = await obsidianPage.read(BASE);
		try {
			await setOption('graphArrows', false);
			await waitFor((x) => !x.arrows && x.arrowTips.length === 0 && x.links === 7, 'arrows did not turn off');
			await browser.waitUntil(async () => (await obsidianPage.read(BASE)).includes('graphArrows: false'), { timeout: 10000, timeoutMsg: 'the option was not saved in the base file' });
		} finally {
			await obsidianPage.write(BASE, before);
		}
		await obsidianPage.openFile('Welcome.md');
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.arrows && x.arrowTips.length === 8, 'arrows did not come back from the base file');
	});

	it('criterion 2: hover over a node lists its relations, without Pro', async function () {
		await setPro(false);
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.nodes === 6 && x.links === 7 && x.cooled, 'layout did not settle');
		const pt = await browser.executeObsidian(({ app }, id, p) => {
			interface V {
				containerEl: HTMLElement;
				graph: unknown;
				screenPos(path: string): { x: number; y: number } | null;
			}
			const pl = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...pl.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop()!;
			const pos = v.screenPos(p)!;
			const rect = v.containerEl.querySelector('canvas')!.getBoundingClientRect();
			return { x: Math.round(rect.left + pos.x), y: Math.round(rect.top + pos.y) };
		}, pluginId, TOM);
		await browser.action('pointer').move({ x: pt.x + 40, y: pt.y + 40 }).move({ x: pt.x, y: pt.y }).perform();
		let lines: string[] = [];
		await browser.waitUntil(
			async () => {
				lines = await browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .bases-link-graph-tip.is-shown .bases-link-graph-tip-relation')).map((el) => el.textContent ?? ''));
				return lines.length > 0;
			},
			{ timeout: 5000, timeoutMsg: 'no relation lines in the hover card of Tom' },
		);
		expect(lines).toEqual(['parent → Rose', 'parent ← Leo', 'parent ← Zoe']);
	});

	it('criterion 3: Pro colors parent and friend links apart with a "Links" legend; without Pro, the theme line color', async function () {
		await setPro(false);
		await obsidianPage.openFile(BASE);
		const free = await waitFor((x) => x.links === 7, 'free graph not drawn');
		expect(new Set(free.edges.map((e) => e.color))).toEqual(new Set([free.line]));
		expect(free.legendLinks).toEqual([]);
		expect(free.proNote).toBe(true);
		await setPro(true);
		const s = await waitFor((x) => x.legendLinks.length === 2, 'expected the "Links" legend with 2 relations');
		expect(s.legendTitle).toBe('Links');
		expect(s.legendLinks).toEqual(['parent (5)', 'friend (2)']);
		expect(s.proNote).toBe(false);
		const parent = new Set(s.edges.filter((e) => e.relation === 'parent').map((e) => e.color));
		const friend = new Set(s.edges.filter((e) => e.relation === 'friend').map((e) => e.color));
		expect(parent.size).toBe(1);
		expect(friend.size).toBe(1);
		expect([...parent][0]).not.toBe([...friend][0]);
		expect(parent.has(s.line) || friend.has(s.line)).toBe(false);
	});

	it('criterion 4: the SVG export has both edge colors and the "Links" legend part', async function () {
		await setPro(true);
		await obsidianPage.openFile(BASE);
		const s = await waitFor((x) => x.legendLinks.length === 2 && x.cooled, 'Pro view not ready');
		const parent = s.edges.find((e) => e.relation === 'parent')!.color;
		const friend = s.edges.find((e) => e.relation === 'friend')!.color;
		const svg = await browser.executeObsidian(async ({ app }, id) => {
			interface P {
				targetView(): unknown;
				exportView(v: unknown, kind: 'svg'): Promise<{ path: string } | null>;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			const out = await p.exportView(p.targetView(), 'svg');
			const file = out ? app.vault.getFileByPath(out.path) : null;
			const text = file ? await app.vault.read(file) : '';
			if (file) await app.vault.delete(file);
			return text;
		}, pluginId);
		expect(svg).toContain(`stroke="${parent}"`);
		expect(svg).toContain(`stroke="${friend}"`);
		expect(svg).toContain('<g class="legend-links"');
		expect(svg).toContain('>Links</text>');
		expect(svg).toContain('>parent (5)</text>');
		expect(svg).toContain('>friend (2)</text>');
		expect((svg.match(/<polygon class="arrow"/g) ?? []).length).toBe(8);
		await setPro(false);
	});
});
