import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetadataCache, TFile } from 'obsidian';
import { buildGraph } from '../src/graph';
import { GraphView, KEY, linksForFile, viewOptions } from '../src/view';
import { resetPro } from '../src/pro';

afterEach(() => resetPro());

const file = { path: 'Notes/A.md' } as TFile;

function cache() {
	return {
		resolvedLinks: { [file.path]: { 'Notes/B.md': 5, 'Notes/C.md': 1 } },
		getFileCache: vi.fn(() => ({
			links: [{ link: 'B#Heading' }, { link: 'Missing' }],
			embeds: [{ link: 'B#^block' }, { link: 'C' }],
			frontmatterLinks: [{ link: 'B', key: 'parent.0' }, { link: 'B#Heading', key: 'parent.1' }, { link: 'C', key: 'friend' }],
		})),
		getFirstLinkpathDest: vi.fn((path: string) => path === 'B' || path === 'C' ? { path: `Notes/${path}.md` } : null),
	};
}

describe('link-source cache adapter', () => {
	it('all links keeps the resolved cache and does not read individual references', () => {
		const c = cache();
		expect(linksForFile(c as unknown as MetadataCache, file, 'all', ['parent'])).toBe(c.resolvedLinks[file.path]);
		expect(c.getFileCache).not.toHaveBeenCalled();
	});

	it('body includes embeds and resolves headings from the source note', () => {
		const c = cache();
		expect(linksForFile(c as unknown as MetadataCache, file, 'body', ['parent'])).toEqual({ 'Notes/B.md': 2, 'Notes/C.md': 1 });
		expect(c.getFirstLinkpathDest).toHaveBeenCalledWith('B', file.path);
		expect(c.getFirstLinkpathDest).toHaveBeenCalledWith('C', file.path);
	});

	it('properties excludes the body and selects list links by name', () => {
		const c = cache() as unknown as MetadataCache;
		expect(linksForFile(c, file, 'frontmatter', [])).toEqual({ 'Notes/B.md': 2, 'Notes/C.md': 1 });
		expect(linksForFile(c, file, 'frontmatter', ['note.parent'])).toEqual({ 'Notes/B.md': 2 });
		expect(linksForFile(c, file, 'frontmatter', ['missing'])).toEqual({});
	});

	it('a missing cache produces no filtered links', () => {
		const c = { ...cache(), getFileCache: () => null } as unknown as MetadataCache;
		expect(linksForFile(c, file, 'frontmatter', [])).toEqual({});
		expect(linksForFile(c, file, 'body', [])).toEqual({});
		expect(linksForFile(c, { path: 'missing.md' } as TFile, 'all', [])).toEqual({});
	});

	it('filtered links still merge mutual edges and respect the base and orphan options', () => {
		const links = linksForFile(cache() as unknown as MetadataCache, file, 'frontmatter', ['parent']);
		const g = buildGraph([
			{ id: file.path, label: 'A', links: { ...links, 'Outside.md': 1 } },
			{ id: 'Notes/B.md', label: 'B', links: { [file.path]: 1 } },
			{ id: 'Notes/C.md', label: 'C', links: {} },
		], { showOrphans: false });
		expect(g.nodes.map((n) => n.id)).toEqual([file.path, 'Notes/B.md']);
		expect(g.edges).toEqual([{ source: 0, target: 1, kind: 'link', weight: 3, mutual: true }]);
		expect(g.hidden.orphans).toBe(1);
	});
});

describe('free link-source options', () => {
	function options(values: Record<string, unknown>) {
		return GraphView.prototype.options.call({ config: { get: (key: string) => values[key], getAsPropertyId: () => null } } as unknown as GraphView);
	}

	it('old views and invalid settings use all links', () => {
		expect(options({})).toMatchObject({ linkSource: 'all', linkProperties: [], proIgnored: false });
		expect(options({ [KEY.linkSource]: 'invalid', [KEY.linkProperties]: 'parent' })).toMatchObject({ linkSource: 'all', linkProperties: [] });
	});

	it('property selection works when Pro is off', () => {
		expect(options({ [KEY.linkSource]: 'frontmatter', [KEY.linkProperties]: ['parent', null, 42, ' '] })).toMatchObject({ linkSource: 'frontmatter', linkProperties: ['parent'], proIgnored: false });
		expect(options({ [KEY.linkSource]: 'body' }).linkSource).toBe('body');
	});

	it('the property list is shown only for property links', () => {
		const values: Record<string, unknown> = {};
		const opts = viewOptions({ get: (key: string) => values[key] } as never);
		const list = opts.find((o) => 'key' in o && o.key === KEY.linkProperties)!;
		expect(list.shouldHide?.()).toBe(true);
		values[KEY.linkSource] = 'frontmatter';
		expect(list.shouldHide?.()).toBe(false);
		values[KEY.linkSource] = 'body';
		expect(list.shouldHide?.()).toBe(true);
	});
});
