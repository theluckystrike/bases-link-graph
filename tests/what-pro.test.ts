import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingGates, whatProModel, whatProUrl } from '../src/license/github-obsidian';
import { PRO_FEATURES } from '../src/pro-features';
import { PRO_UI, SPONSORS } from '../src/pro';
import { SAMPLE_ROWS, whatProFeatures } from '../src/what-pro';
import manifest from '../manifest.json';

const ROOT = join(import.meta.dirname, '..');
const read = (file: string): string | null => {
	try {
		return readFileSync(join(ROOT, file), 'utf8');
	} catch {
		return null;
	}
};
const demo = (id: string): HTMLElement => {
	const el = document.createElement('div');
	const f = whatProFeatures().find((x) => x.id === id);
	if (!f) throw new Error(`no feature ${id}`);
	f.demo(el);
	return el;
};

describe('What Pro adds: feature list', () => {
	it('lists the 8 Pro features of the plugin, one line each', () => {
		expect(PRO_FEATURES.map((f) => f.id)).toEqual(['size', 'color', 'link-colors', 'headings', 'shared', 'depth', 'export', 'layout']);
		for (const f of PRO_FEATURES) expect(f.line).toMatch(/^[A-Z].{20,160}\.$/);
		expect(whatProFeatures().map((f) => f.line)).toEqual(PRO_FEATURES.map((f) => f.line));
	});

	it('each listed feature has its Pro gate in src', () => {
		expect(missingGates(PRO_FEATURES, read)).toEqual([]);
	});

	it('negative control: a listed feature without a gate in src fails the gate check', () => {
		const ghost = { id: 'ghost', line: 'Export the graph to a PDF file.', gate: { file: 'src/main.ts', text: "GraphView.needsPro('PDF export')" } };
		expect(missingGates([...PRO_FEATURES, ghost], read)).toEqual(['ghost']);
	});

	it('the README Pro section has the same lines and the same price text', () => {
		const readme = read('README.md') ?? '';
		const section = readme.slice(readme.indexOf('\n## Pro\n'));
		expect(section.startsWith('\n## Pro\n')).toBe(true);
		for (const f of PRO_FEATURES) expect(section).toContain(`\n- ${f.line}\n`);
		expect(section).toContain(PRO_UI.priceText);
	});
});

describe('What Pro adds: price and button', () => {
	it('the Sponsor $15 once button opens the one-time tab with metadata_source=<plugin id>-whatpro', () => {
		const m = whatProModel(null, { pluginId: manifest.id, features: PRO_FEATURES, priceText: PRO_UI.priceText }, SPONSORS);
		expect(m.sponsorText).toBe('Sponsor $15 once');
		expect(m.sponsorUrl).toBe('https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=bases-link-graph-whatpro');
		expect(m.sponsorUrl).toBe(whatProUrl(SPONSORS, manifest.id));
		expect(m.priceText).toBe(PRO_UI.priceText);
	});
});

describe('What Pro adds: demos on sample rows', () => {
	const codes = (el: HTMLElement): string[] => [...el.querySelectorAll('code')].map((c) => c.textContent ?? '');
	for (const id of ['size', 'color', 'link-colors', 'headings', 'shared', 'depth']) {
		it(`${id}: draws the sample graph as an SVG`, () => {
			const svg = demo(id).querySelector('svg');
			expect(svg).not.toBeNull();
			expect(svg?.querySelectorAll('circle').length).toBeGreaterThan(0);
		});
	}
	it('size: the radius follows the pages', () => {
		expect(codes(demo('size'))).toMatchInlineSnapshot(`
			[
			  "Dune: 412 pages, radius 10.88
			Children of Dune: 444 pages, radius 11.34
			Middlemarch: 880 pages, radius 16
			Silas Marner: 183 pages, radius 4
			Frank Herbert: no pages value, radius 4
			George Eliot: no pages value, radius 4
			Reading list: no pages value, radius 4",
			]
		`);
	});
	it('color: the legend counts each genre', () => {
		expect(codes(demo('color'))).toMatchInlineSnapshot(`
			[
			  "Novel (2)
			Person (2)
			Science fiction (2)
			(no value) (1)",
			]
		`);
	});
	it('link colors: the Links legend counts each relation', () => {
		expect(codes(demo('link-colors'))).toMatchInlineSnapshot(`
			[
			  "author (4)
			next (2)
			sequel of (1)",
			]
		`);
	});
	it('headings: free headings hang from the note; Pro nests them and hides level 3', () => {
		expect(codes(demo('headings'))).toMatchInlineSnapshot(`
			[
			  "Dune hangs from Dune notes (note)
			Book 1 hangs from Dune notes (note)
			Arrakis hangs from Dune notes (note)
			Book 2 hangs from Dune notes (note)",
			  "Dune hangs from Dune notes (note)
			Book 1 hangs from Dune (heading)
			Book 2 hangs from Dune (heading)",
			]
		`);
	});
	it('shared: books of one author get a shared edge', () => {
		expect(codes(demo('shared'))).toMatchInlineSnapshot(`
			[
			  "Dune and Children of Dune: author Frank Herbert
			Middlemarch and Silas Marner: author George Eliot",
			]
		`);
	});
	it('depth: only the notes 1 link away from Dune', () => {
		expect(codes(demo('depth'))).toMatchInlineSnapshot(`
			[
			  "Dune, Children of Dune, Frank Herbert, Reading list",
			]
		`);
	});
	it('export: the SVG text of the sample graph', () => {
		const text = codes(demo('export'))[0] ?? '';
		expect(text.startsWith('<svg')).toBe(true);
	});
	it('layout: the positions that Save layout writes', () => {
		expect(codes(demo('layout'))).toMatchInlineSnapshot(`
			[
			  "graphLayout:
			  Dune.md: [154, 0]
			  Children of Dune.md: [96, 120]
			  Middlemarch.md: [-34, 150]
			  Silas Marner.md: [-139, 67]
			  Frank Herbert.md: [-139, -67]
			  George Eliot.md: [-34, -150]
			  Reading list.md: [96, -120]",
			]
		`);
	});
	it('the demos do not change the sample rows', () => {
		const before = JSON.stringify(SAMPLE_ROWS);
		for (const f of whatProFeatures()) f.demo(document.createElement('div'));
		expect(JSON.stringify(SAMPLE_ROWS)).toBe(before);
	});
});

describe('What Pro adds: entry points', () => {
	const main = read('src/main.ts') ?? '';
	it('has one command and opens the window only from a user action', () => {
		expect(main).toContain("this.addCommand({ id: 'what-pro-adds', name: WHAT_PRO_TITLE, callback: () => this.openWhatPro() });");
		// onload never opens it: the only calls are inside callbacks.
		const onload = main.slice(main.indexOf('async onload()'), main.indexOf('onunload()'));
		expect(onload.match(/openWhatPro\(\)/g)).toHaveLength(2);
		expect(onload).toContain('bindWhatPro(() => this.openWhatPro());');
	});
	it('has the settings button and the notice link', () => {
		expect(read('src/settings.ts')).toContain('sponsorsSettingItemsWithWhatPro(this.plugin.pro, PRO_UI, () => this.plugin.openWhatPro())');
		expect(read('src/pro.ts')).toContain('showProNoticeWithWhatPro(manager, lead, () => whatPro?.());');
	});
});
