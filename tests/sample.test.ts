import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph, colorScale, parseNumber, sizeScale, type NodeInput, type PropValue } from '../src/graph';

// The sample vault of the end-to-end test and the screenshots (test/e2e/vault/Bases Link Graph). The e2e test checks the
// same numbers in the real app, where Obsidian resolves the links; here a small parser does it by file name.
const DIR = join(__dirname, '..', 'test', 'e2e', 'vault', 'Bases Link Graph', 'Notes');

function frontmatter(text: string): Record<string, PropValue> {
	const m = /^---\n([\s\S]*?)\n---/.exec(text);
	const out: Record<string, PropValue> = {};
	let key = '';
	for (const line of (m?.[1] ?? '').split('\n')) {
		const item = /^ {2}- (.*)$/.exec(line);
		if (item && key) (out[key] as string[]).push(item[1]!);
		else {
			const kv = /^(\w+):\s*(.*)$/.exec(line);
			if (!kv) continue;
			key = `note.${kv[1]}`;
			out[key] = kv[2] === '' ? [] : kv[2]!;
		}
	}
	return out;
}

function rows(): NodeInput[] {
	const files = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
	const names = new Set(files.map((f) => f.replace(/\.md$/, '')));
	return files.map((f) => {
		const text = readFileSync(join(DIR, f), 'utf8');
		const links: Record<string, number> = {};
		for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
			const target = m[1]!;
			if (names.has(target)) links[`Bases Link Graph/Notes/${target}.md`] = (links[`Bases Link Graph/Notes/${target}.md`] ?? 0) + 1;
		}
		return { id: `Bases Link Graph/Notes/${f}`, label: f.replace(/\.md$/, ''), links, props: frontmatter(text) };
	});
}

describe('sample vault (Bases Link Graph)', () => {
	it('30 notes, 55 links, one note without links (Lena)', () => {
		const g = buildGraph(rows());
		expect(g.nodes).toHaveLength(30);
		expect(g.edges).toHaveLength(55);
		expect(g.nodes.filter((n) => n.degree === 0).map((n) => n.label)).toEqual(['Lena']);
	});

	it('Near Atlas: depth 1 keeps Atlas, its 3 people and its 3 meetings', () => {
		const g = buildGraph(rows(), { focus: 'Bases Link Graph/Notes/Atlas.md', depth: 1 });
		expect(g.nodes.map((n) => n.label).sort()).toEqual(['2026-09-01 Atlas kickoff', '2026-09-08 Atlas design review', '2026-09-22 Atlas planning', 'Ana', 'Atlas', 'Ben', 'Chen']);
		expect(g.hidden.outside).toBe(23);
	});

	it('Shared teams adds dashed edges; Platform (13 notes) is a chain, Design and Research are full', () => {
		const g = buildGraph(rows(), { sharedProps: ['note.team'] });
		const shared = g.edges.filter((e) => e.kind === 'shared');
		const byTeam = (t: string) => shared.filter((e) => e.values!.includes(t)).length;
		expect(byTeam('Platform')).toBe(12);
		const design = rows().filter((r) => (r.props!['note.team'] as string[]).includes('Design')).length;
		expect(byTeam('Design')).toBe((design * (design - 1)) / 2);
		expect(g.edges.length).toBe(55 + shared.length);
	});

	it('By type: 3 colors (ties by name) and sizes from hours (people and meetings have no hours)', () => {
		const r = rows();
		const c = colorScale(r.map((x) => x.props!['note.type'] ?? null));
		expect(c.legend.map((l) => `${l.label} ${l.count}`)).toEqual(['meeting 12', 'person 12', 'project 6']);
		const sizes = sizeScale(r.map((x) => parseNumber(x.props!['note.hours'] ?? null)), { min: 4, max: 18, fallback: 3 });
		expect(sizes.filter((s) => s > 3)).toHaveLength(6);
		expect(Math.max(...sizes)).toBe(18);
	});
});
