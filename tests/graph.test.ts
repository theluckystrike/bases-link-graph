import { describe, expect, it } from 'vitest';
import { buildGraph, displayValue, toSvg, valueKey, withinDepth, xmlEscape } from '../src/graph';
import { mix, parseRgb } from '../src/theme';
import { toPlain, toPropertyId } from '../src/view';

describe('values', () => {
	it('display form and comparison key', () => {
		expect(displayValue('  [[Projects/Alpha|A]] ')).toBe('Projects/Alpha');
		expect(displayValue('[[Alpha#Goals]]')).toBe('Alpha');
		expect(displayValue(12)).toBe('12');
		expect(valueKey('#Work')).toBe('work');
		expect(valueKey(' ')).toBe('');
	});

	it('property ids from typed names', () => {
		expect(toPropertyId('status')).toBe('note.status');
		expect(toPropertyId('file.tags')).toBe('file.tags');
		expect(toPropertyId('formula.score')).toBe('formula.score');
		expect(toPropertyId('  ')).toBeNull();
	});

	it('plain values from Bases values, lists included', () => {
		const v = (s: string, truthy = true) => ({ toString: () => s, isTruthy: () => truthy });
		const list = (items: unknown[]) => ({ toString: () => items.join(', '), isTruthy: () => items.length > 0, length: () => items.length, get: (i: number) => items[i] });
		expect(toPlain(null)).toBeNull();
		expect(toPlain(v('null', false))).toBeNull();
		expect(toPlain(v(''))).toBeNull();
		expect(toPlain(v('0', false))).toBe('0');
		expect(toPlain(v('done'))).toBe('done');
		expect(toPlain(list([v('a'), v(''), v('b')]))).toEqual(['a', 'b']);
	});
});

describe('graph', () => {
	it('node count equals row count by default, with degrees', () => {
		const g = buildGraph([
			{ id: 'a', label: 'a', links: { b: 1, c: 1 } },
			{ id: 'b', label: 'b', links: {} },
			{ id: 'c', label: 'c', links: {} },
			{ id: 'd', label: 'd', links: {} },
		]);
		expect(g.nodes.map((n) => [n.id, n.degree, n.row])).toEqual([
			['a', 2, 0],
			['b', 1, 1],
			['c', 1, 2],
			['d', 0, 3],
		]);
	});

	it('withinDepth with depth 0 keeps only the focus', () => {
		expect([...withinDepth(3, [{ source: 0, target: 1, kind: 'link', weight: 1 }], 0, 0)]).toEqual([0]);
	});

	it('500 rows build in well under a frame', () => {
		const rows = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, links: { [`n${(i + 1) % 500}`]: 1 }, props: { 'note.tags': [`t${i % 10}`] } }));
		const t0 = performance.now();
		const g = buildGraph(rows, { sharedProps: ['note.tags'] });
		const ms = performance.now() - t0;
		expect(g.nodes).toHaveLength(500);
		// 500 links + 10 tags x 50 rows as chains (49 each) = 990 edges.
		expect(g.edges).toHaveLength(500 + 10 * 49);
		expect(ms).toBeLessThan(process.env.FX_PERF_STRICT === '1' ? 20 : 200);
	});
});

describe('svg export', () => {
	it('golden output for two nodes, one dashed edge and a legend', () => {
		const svg = toSvg({
			background: '#ffffff',
			text: '#222222',
			padding: 10,
			fontSize: 10,
			nodes: [
				{ x: 0, y: 0, r: 5, color: '#086ddd', label: 'A' },
				{ x: 100, y: 50, r: 10, color: '#ec7500', label: 'B & <C>' },
			],
			edges: [{ source: 0, target: 1, dashed: true, color: '#7b6cd9', width: 1 }],
			legend: [{ label: 'done (1)', color: '#086ddd' }],
		});
		// Bounds: x -5..121 (label of B is 7 x 3 = 21 px each side), y -5..74 (label line below B: 50 + 10 + 10 + 4).
		// Size 126 + 2 x 10 = 146 wide, 79 + 20 + legend 16 + 5 = 120 high. Legend row y = 120 - 5 - 16 + 5 = 104.
		expect(svg).toBe(
			[
				'<svg xmlns="http://www.w3.org/2000/svg" width="146" height="120" viewBox="0 0 146 120" font-family="sans-serif" font-size="10">',
				'<rect width="100%" height="100%" fill="#ffffff"/>',
				'<g class="edges">',
				'<line x1="15" y1="15" x2="115" y2="65" stroke="#7b6cd9" stroke-width="1" stroke-dasharray="4 3"/>',
				'</g>',
				'<g class="nodes">',
				'<circle cx="15" cy="15" r="5" fill="#086ddd"><title>A</title></circle>',
				'<circle cx="115" cy="65" r="10" fill="#ec7500"><title>B &amp; &lt;C&gt;</title></circle>',
				'</g>',
				'<g class="labels" fill="#222222" text-anchor="middle">',
				'<text x="15" y="30">A</text>',
				'<text x="115" y="85">B &amp; &lt;C&gt;</text>',
				'</g>',
				'<g class="legend" fill="#222222">',
				'<circle cx="10" cy="104" r="4.2" fill="#086ddd"/><text x="20" y="107.3">done (1)</text>',
				'</g>',
				'</svg>',
				'',
			].join('\n'),
		);
	});

	it('an empty graph is still a valid document', () => {
		const svg = toSvg({ background: '#000', text: '#fff', nodes: [], edges: [] });
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg.trim().endsWith('</svg>')).toBe(true);
		expect(xmlEscape(`"'`)).toBe('&quot;&apos;');
	});
});

describe('theme colors', () => {
	it('parses and mixes colors', () => {
		expect(parseRgb('#fff')).toEqual([255, 255, 255]);
		expect(parseRgb('#086ddd')).toEqual([8, 109, 221]);
		expect(parseRgb('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
		expect(parseRgb('hsl(1, 2%, 3%)')).toBeNull();
		expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
		expect(mix('#000000', 'nope', 0.5)).toBe('#000000');
	});
});
