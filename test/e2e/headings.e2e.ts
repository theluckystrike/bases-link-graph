import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Headings and blocks as nodes (1.5.0, forum topic 6653) on the Book sample: 4 notes and 1 image.
// Reading log links to a heading with an alias, embeds a heading, links a block, a missing heading, a note outside
// the base, the heading "C# basics" as [[Code notes#C basics]] and the first of two "Notes" headings.
// Aging research links a nested heading from its "Ideas" section. Ending Aging embeds the image under "Damage" and
// links [[#Damage]] in the same note. Obsidian resolves every subpath here, not a stand-in.
const DIR = 'Bases Link Graph';
const BOOK = `${DIR}/Book`;
const BASE = `${DIR}/Book graph.base`;
const EA = `${BOOK}/Ending Aging.md`;
const RL = `${BOOK}/Reading log.md`;
const AR = `${BOOK}/Aging research.md`;
const CN = `${BOOK}/Code notes.md`;
const PNG = `${BOOK}/cell-diagram.png`;

interface HeadState {
	view: string;
	nodes: string[];
	/** Heading or block node id -> parent node id. */
	parents: Record<string, string>;
	links: string[];
	parts: number;
	missing: number;
	bar: string;
	proNote: boolean;
	cooled: boolean;
}

async function state(): Promise<HeadState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface N {
			id: string;
			sub?: { parent: number };
		}
		interface V {
			graph: { nodes: N[]; edges: { source: number; target: number; kind: string }[]; missing?: number } | null;
			layout: { alpha: number; alphaMin: number; alphaTarget: number } | null;
			config: { name: string };
			containerEl: HTMLElement;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const v = [...(p?.views ?? [])].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop();
		if (!v || !v.graph || !v.layout) return null;
		const g = v.graph;
		const parents: Record<string, string> = {};
		for (const n of g.nodes) if (n.sub) parents[n.id] = g.nodes[n.sub.parent]?.id ?? '';
		return {
			view: v.config.name,
			nodes: g.nodes.map((n) => n.id).sort(),
			parents,
			links: g.edges.filter((e) => e.kind === 'link').map((e) => `${g.nodes[e.source]!.id} -> ${g.nodes[e.target]!.id}`).sort(),
			parts: g.edges.filter((e) => e.kind === 'part').length,
			missing: g.missing ?? 0,
			bar: v.containerEl.querySelector('.bases-link-graph-count')?.textContent ?? '',
			proNote: v.containerEl.querySelector('.bases-link-graph-pro-note') !== null,
			cooled: v.layout.alpha < v.layout.alphaMin && v.layout.alphaTarget === 0,
		};
	}, pluginId);
}

async function waitFor(pred: (s: HeadState) => boolean, msg: string, timeout = 30000): Promise<HeadState> {
	let last: HeadState | null = null;
	await browser.waitUntil(
		async () => {
			last = await state();
			return last !== null && pred(last);
		},
		{ timeout, interval: 250, timeoutMsg: `${msg}; last state ${JSON.stringify(last)}` },
	);
	return last!;
}

async function openView(name: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, link) => {
		await app.workspace.openLinkText(link, '', false);
	}, `${BASE}#${name}`);
}

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

/** Screen point of node `node` in the shown graph view, and the line of that node. */
async function nodePoint(node: string): Promise<{ x: number; y: number; line: number }> {
	return browser.executeObsidian(({ app }, id, n) => {
		interface V {
			containerEl: HTMLElement;
			graph: { nodes: { id: string; sub?: { line: number } }[] } | null;
			screenPos(path: string): { x: number; y: number } | null;
		}
		const pl = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
		const v = [...pl.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop()!;
		const pos = v.screenPos(n)!;
		const rect = v.containerEl.querySelector('canvas')!.getBoundingClientRect();
		const line = v.graph?.nodes.find((x) => x.id === n)?.sub?.line ?? -1;
		return { x: Math.round(rect.left + pos.x), y: Math.round(rect.top + pos.y), line };
	}, pluginId, node);
}

/** Lines of the two "Notes" headings in Code notes. */
async function notesLines(): Promise<number[]> {
	return browser.executeObsidian(({ app }, path) => {
		const f = app.vault.getFileByPath(path);
		return ((f ? app.metadataCache.getFileCache(f)?.headings : null) ?? []).filter((x) => x.heading === 'Notes').map((x) => x.position.start.line);
	}, CN);
}

const LINKED_NODES = [AR, CN, `${CN}#C# basics`, `${CN}#Notes`, EA, `${EA}#Damage`, `${EA}#Methods`, `${EA}#Repair`, `${EA}#^q1`, RL, PNG].sort();
const LINKED_LINKS = [
	`${AR} -> ${RL}`,
	`${AR} -> ${EA}#Methods`,
	`${CN} -> ${EA}`,
	`${EA} -> ${PNG}`,
	`${RL} -> ${CN}#C# basics`,
	`${RL} -> ${CN}#Notes`,
	`${RL} -> ${EA}`,
	`${RL} -> ${EA}#Damage`,
	`${RL} -> ${EA}#Repair`,
	`${RL} -> ${EA}#^q1`,
].sort();

describe(`${pluginId} headings and blocks as nodes in the real app`, function () {
	before(async function () {
		await setPro(false);
	});

	after(async function () {
		await setPro(false);
	});

	it('criterion A1: headings off (the default) draws the 1.4.0 graph of notes only', async function () {
		await openView('Notes only');
		const s = await waitFor((x) => x.view === 'Notes only' && x.nodes.length === 5, 'expected 5 notes');
		expect(s.nodes).toEqual([AR, CN, EA, RL, PNG].sort());
		expect(Object.keys(s.parents)).toEqual([]);
		expect(s.links).toEqual([`${AR} -> ${EA}`, `${AR} -> ${RL}`, `${CN} -> ${EA}`, `${EA} -> ${PNG}`, `${RL} -> ${CN}`, `${RL} -> ${EA}`].sort());
		expect(s.bar).toBe('5 notes · 6 links');
	});

	it('criteria A2-A8: linked headings and blocks are child nodes; alias, embed, nested, block, # in a heading, duplicate, same note, missing, outside', async function () {
		await openView('Linked headings');
		const s = await waitFor((x) => x.view === 'Linked headings' && x.nodes.length === LINKED_NODES.length, 'expected 11 nodes in linked mode');
		expect(s.nodes).toEqual(LINKED_NODES);
		expect(s.links).toEqual(LINKED_LINKS);
		expect(s.parts).toBe(6);
		for (const sub of Object.keys(s.parents)) expect(s.parents[sub]).toBe(sub.slice(0, sub.indexOf('.md#') + 3));
		// [[Ending Aging#No such heading]] goes to the note; [[Old plan#Goals]] is outside the base and is not counted.
		expect(s.missing).toBe(1);
		expect(s.bar).toBe('5 notes · 10 links · 6 headings and blocks · 1 heading or block link not found');
		expect(s.proNote).toBe(false);
	});

	it('criterion A9: all headings are nodes, and links start at the heading that holds them', async function () {
		await openView('All headings');
		const s = await waitFor((x) => x.view === 'All headings' && x.nodes.length === 14, 'expected 14 nodes in all mode');
		expect(s.nodes).toContain(`${EA}#Ending Aging`);
		expect(s.nodes).toContain(`${CN}#Notes [2]`);
		expect(s.nodes).toContain(`${AR}#Ideas`);
		expect(s.links).toContain(`${EA}#Damage -> ${PNG}`);
		expect(s.links).toContain(`${AR}#Ideas -> ${EA}#Methods`);
		expect(s.links).toContain(`${EA}#Methods -> ${EA}#Damage`);
		expect(s.links).toContain(`${AR} -> ${RL}`);
		expect(s.links).toHaveLength(11);
		expect(s.parts).toBe(9);
	});

	it('criterion A11: a click on a heading node opens its note at the heading; hover names note and heading', async function () {
		await openView('Linked headings');
		// The node count tells the linked graph from the last all-headings graph, which the same view can still hold.
		await waitFor((x) => x.view === 'Linked headings' && x.nodes.length === LINKED_NODES.length && x.cooled, 'layout did not settle');
		const pt = await browser.executeObsidian(({ app }, id, node) => {
			interface V {
				containerEl: HTMLElement;
				graph: unknown;
				screenPos(path: string): { x: number; y: number } | null;
			}
			const pl = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...pl.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop()!;
			const pos = v.screenPos(node)!;
			const rect = v.containerEl.querySelector('canvas')!.getBoundingClientRect();
			return { x: Math.round(rect.left + pos.x), y: Math.round(rect.top + pos.y) };
		}, pluginId, `${EA}#Repair`);
		await browser.action('pointer').move({ x: pt.x + 40, y: pt.y + 40 }).move({ x: pt.x, y: pt.y }).perform();
		let title = '';
		await browser.waitUntil(
			async () => {
				title = await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .bases-link-graph-tip.is-shown .bases-link-graph-tip-title')?.textContent ?? '');
				return title !== '';
			},
			{ timeout: 5000, timeoutMsg: 'no hover card on the heading node' },
		);
		expect(title).toBe('Ending Aging › Repair');
		await browser.action('pointer').move({ x: pt.x, y: pt.y }).down().up().perform();
		const opened = await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app }, path) => {
					const f = app.workspace.getActiveFile();
					if (f?.path !== path) return false;
					const h = app.metadataCache.getFileCache(f)?.headings?.find((x) => x.heading === 'Repair');
					const editor = app.workspace.activeEditor?.editor;
					return editor && h ? { cursor: editor.getCursor().line, heading: h.position.start.line } : false;
				}, EA),
			{ timeout: 10000, timeoutMsg: 'the click did not open Ending Aging at the heading' },
		);
		expect(opened.cursor).toBe(opened.heading);
	});

	it('criterion A11b: a click on the second of two "Notes" headings opens at the second one (review R1)', async function () {
		await openView('All headings');
		await waitFor((x) => x.view === 'All headings' && x.nodes.includes(`${CN}#Notes [2]`) && x.cooled, 'all headings view did not settle');
		const pt = await browser.executeObsidian(({ app }, id, node) => {
			interface V {
				containerEl: HTMLElement;
				graph: unknown;
				screenPos(path: string): { x: number; y: number } | null;
			}
			const pl = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...pl.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.graph).pop()!;
			const pos = v.screenPos(node)!;
			const rect = v.containerEl.querySelector('canvas')!.getBoundingClientRect();
			return { x: Math.round(rect.left + pos.x), y: Math.round(rect.top + pos.y) };
		}, pluginId, `${CN}#Notes [2]`);
		await browser.action('pointer').move({ x: pt.x + 40, y: pt.y + 40 }).move({ x: pt.x, y: pt.y }).down().up().perform();
		const opened = await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app }, path) => {
					const f = app.workspace.getActiveFile();
					if (f?.path !== path) return false;
					const hs = (app.metadataCache.getFileCache(f)?.headings ?? []).filter((x) => x.heading === 'Notes');
					const editor = app.workspace.activeEditor?.editor;
					return editor && hs.length === 2 ? { cursor: editor.getCursor().line, first: hs[0]!.position.start.line, second: hs[1]!.position.start.line } : false;
				}, CN),
			{ timeout: 10000, timeoutMsg: 'the click did not open Code notes' },
		);
		expect(opened.second).not.toBe(opened.first);
		expect(opened.cursor).toBe(opened.second);
	});

	it('criterion A11b in Reading view: a click on the second "Notes" heading scrolls to the second one (review R2)', async function () {
		const before = await obsidianPage.read(CN);
		// Filler text puts the second "Notes" far below the first, so the scroll position tells the two apart.
		const filler = Array.from({ length: 80 }, (_, k) => `Filler paragraph ${k + 1}.`).join('\n\n');
		await browser.executeObsidian(({ app }) => {
			(app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig('defaultViewMode', 'preview');
		});
		try {
			// Filler after the second section lets the view scroll that heading to the top.
			await obsidianPage.write(CN, `${before.replace('First notes.\n', `First notes.\n\n${filler}\n`)}\n${filler}\n`);
			await browser.waitUntil(async () => (await notesLines())[1]! > 100, { timeout: 10000, timeoutMsg: 'the long Code notes was not indexed' });
			const [first, second] = await notesLines();
			await openView('All headings');
			await waitFor((x) => x.view === 'All headings' && x.nodes.includes(`${CN}#Notes [2]`) && x.cooled, 'all headings view did not settle');
			let pt = await nodePoint(`${CN}#Notes [2]`);
			await browser.waitUntil(async () => (pt = await nodePoint(`${CN}#Notes [2]`)).line === second, { timeout: 10000, timeoutMsg: 'the graph did not redraw the long Code notes' });
			await waitFor((x) => x.cooled, 'layout did not settle after the redraw');
			pt = await nodePoint(`${CN}#Notes [2]`);
			await browser.action('pointer').move({ x: pt.x + 40, y: pt.y + 40 }).move({ x: pt.x, y: pt.y }).down().up().perform();
			let got: { path: string; mode: string; scroll: number } | null = null;
			const ok = await browser
				.waitUntil(
					async () => {
						got = await browser.executeObsidian(({ app, obsidian }) => {
							const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
							return { path: v?.file?.path ?? '', mode: v?.getMode() ?? '', scroll: v ? v.previewMode.getScroll() : -1 };
						});
						return got.path === CN && got.mode === 'preview' && Math.abs(got.scroll - second!) <= 3;
					},
					{ timeout: 10000 },
				)
				.catch(() => false);
			if (!ok) throw new Error(`Reading view did not scroll to the second Notes at line ${second} (first ${first}); last ${JSON.stringify(got)}`);
			expect(second! - first!).toBeGreaterThan(100);
		} finally {
			await browser.executeObsidian(({ app }) => {
				(app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig('defaultViewMode', 'source');
			});
			await obsidianPage.write(CN, before);
		}
		await browser.waitUntil(async () => (await notesLines())[1]! < 20, { timeout: 10000, timeoutMsg: 'Code notes was not restored' });
	});

	it('criterion A11c: the hover preview of the second "Notes" heading shows the second section (review R2)', async function () {
		const events: { linktext: string; scroll: number | null }[] = [];
		await browser.executeObsidian(({ app }, id) => {
			interface PP {
				enabled: boolean;
				enable(save: boolean): Promise<void>;
				instance: { options: Record<string, boolean> };
			}
			const pp = (app as unknown as { internalPlugins: { getPluginById(x: string): PP | null } }).internalPlugins.getPluginById('page-preview')!;
			if (!pp.enabled) void pp.enable(false);
			// The graph is a hover source that needs Ctrl or Cmd by default. The test turns that off, as the user can.
			pp.instance.options[id] = false;
			const w = window as unknown as { __blgHover?: { linktext: string; scroll: number | null }[]; __blgRef?: unknown };
			w.__blgHover = [];
			const ws = app.workspace as unknown as { on(name: string, cb: (e: { linktext: string; state?: { scroll?: number } }) => void): unknown };
			w.__blgRef = ws.on('hover-link', (e) => {
				w.__blgHover!.push({ linktext: e.linktext, scroll: e.state?.scroll ?? null });
			});
		}, pluginId);
		try {
			await openView('All headings');
			await waitFor((x) => x.view === 'All headings' && x.nodes.includes(`${CN}#Notes [2]`) && x.cooled, 'all headings view did not settle');
			const [first, second] = await notesLines();
			const pt = await nodePoint(`${CN}#Notes [2]`);
			expect(pt.line).toBe(second);
			await browser.action('pointer').move({ x: pt.x + 40, y: pt.y + 40 }).move({ x: pt.x, y: pt.y }).perform();
			let shown: { heading: string; next: string } | null = null;
			await browser.waitUntil(
				async () => {
					shown = await browser.execute(() => {
						const pop = [...document.querySelectorAll('.hover-popover')].pop();
						const flash = pop?.querySelector('.markdown-preview-view .is-flashing');
						if (!flash) return null;
						return { heading: flash.textContent?.trim() ?? '', next: flash.nextElementSibling?.textContent?.trim() ?? '' };
					});
					return shown !== null;
				},
				{ timeout: 8000, timeoutMsg: 'no hover preview with a marked section for the second Notes heading' },
			);
			expect(shown).toEqual({ heading: 'Notes', next: 'Second notes with the same heading.' });
			events.push(...(await browser.execute(() => (window as unknown as { __blgHover: { linktext: string; scroll: number | null }[] }).__blgHover)));
			const ev = events.filter((e) => e.linktext.startsWith(CN)).pop();
			expect(ev).toEqual({ linktext: CN, scroll: second });
			expect(second).not.toBe(first);
		} finally {
			await browser.action('pointer').move({ x: 5, y: 5 }).perform();
			await browser.executeObsidian(({ app }, id) => {
				const pp = (app as unknown as { internalPlugins: { getPluginById(x: string): { instance: { options: Record<string, boolean> } } | null } }).internalPlugins.getPluginById('page-preview');
				if (pp) delete pp.instance.options[id];
				const w = window as unknown as { __blgRef?: Parameters<typeof app.workspace.offref>[0] };
				if (w.__blgRef) app.workspace.offref(w.__blgRef);
			}, pluginId);
		}
	});

	it('criterion A10: renaming a heading redraws; its links fall back to the note', async function () {
		await openView('Linked headings');
		await waitFor((x) => x.view === 'Linked headings' && x.nodes.includes(`${EA}#Repair`), 'linked view not drawn');
		const before = await obsidianPage.read(EA);
		try {
			await obsidianPage.write(EA, before.replace('## Repair\n', '## Repair work\n'));
			const s = await waitFor((x) => !x.nodes.includes(`${EA}#Repair`) && x.missing >= 2, 'the renamed heading did not redraw');
			expect(s.links).toContain(`${RL} -> ${EA}`);
			expect(s.nodes).toContain(`${EA}#Damage`);
		} finally {
			await obsidianPage.write(EA, before);
		}
		await waitFor((x) => x.nodes.includes(`${EA}#Repair`) && x.missing === 1, 'the restored heading did not come back');
	});

	it('criterion A12: Pro nests headings and limits the level; free ignores both and shows the Pro note', async function () {
		await setPro(false);
		await openView('Nested');
		const free = await waitFor((x) => x.view === 'Nested' && x.nodes.length === 14, 'free nested view should draw all headings flat');
		expect(free.proNote).toBe(true);
		expect(free.parents[`${EA}#Damage`]).toBe(EA);
		await setPro(true);
		const s = await waitFor((x) => x.view === 'Nested' && !x.nodes.includes(`${EA}#Methods`), 'Pro level limit 2 did not hide Methods');
		expect(s.proNote).toBe(false);
		expect(s.parents[`${EA}#Damage`]).toBe(`${EA}#Ending Aging`);
		expect(s.parents[`${EA}#Repair`]).toBe(`${EA}#Ending Aging`);
		expect(s.parents[`${EA}#^q1`]).toBe(`${EA}#Damage`);
		expect(s.links).toContain(`${AR}#Ideas -> ${EA}#Repair`);
		await setPro(false);
	});
});
