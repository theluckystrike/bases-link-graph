import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph';
import { bounds, createLayout, hitTest, reheat, run, tick } from '../src/layout';

/** 500 rows, each linking to 3 others: the size the view must handle at interactive speed. */
function bigGraph(n = 500) {
	const rows = Array.from({ length: n }, (_, i) => ({ id: `n${i}.md`, label: `n${i}`, links: Object.fromEntries([1, 7, 31].map((d) => [`n${(i * 3 + d) % n}.md`, 1])) }));
	return buildGraph(rows);
}

const dist = (l: { x: Float64Array; y: Float64Array }, a: number, b: number) => Math.hypot(l.x[a]! - l.x[b]!, l.y[a]! - l.y[b]!);

describe('force layout', () => {
	it('is deterministic: the same input gives the same positions', () => {
		const g = bigGraph(120);
		const edges = g.edges.map((e) => [e.source, e.target] as [number, number]);
		const a = createLayout(g.nodes.length, edges);
		const b = createLayout(g.nodes.length, edges);
		run(a, 300);
		run(b, 300);
		expect(Array.from(a.x)).toEqual(Array.from(b.x));
		expect(Array.from(a.y)).toEqual(Array.from(b.y));
	});

	it('cools down and stops', () => {
		const l = createLayout(3, [[0, 1], [1, 2]]);
		const ticks = run(l, 5000);
		expect(ticks).toBeGreaterThan(50);
		expect(ticks).toBeLessThan(1000);
		expect(tick(l)).toBe(false);
		reheat(l, 0.3);
		expect(tick(l)).toBe(true);
	});

	it('pulls linked nodes together and pushes unlinked nodes apart', () => {
		// Two triangles with no link between them.
		const l = createLayout(6, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3]], { linkDistance: 50 });
		run(l, 1000);
		const inside = [dist(l, 0, 1), dist(l, 1, 2), dist(l, 3, 4)];
		for (const d of inside) expect(d).toBeGreaterThan(20);
		for (const d of inside) expect(d).toBeLessThan(110);
		expect(dist(l, 0, 3)).toBeGreaterThan(Math.max(...inside));
	});

	it('keeps saved positions fixed and places a new node next to its saved neighbour', () => {
		const l = createLayout(3, [[0, 1], [1, 2]], {}, [[100, 100], [200, 100], null], true);
		run(l, 500);
		expect([l.x[0], l.y[0], l.x[1], l.y[1]]).toEqual([100, 100, 200, 100]);
		expect(dist(l, 1, 2)).toBeLessThan(150);
	});

	it('separates nodes that start on the same spot', () => {
		const l = createLayout(2, [], {}, [[0, 0], [0, 0]]);
		run(l, 200);
		expect(dist(l, 0, 1)).toBeGreaterThan(5);
	});

	it('uses the grid above 1,200 nodes and still spreads the graph', () => {
		const g = bigGraph(1300);
		const l = createLayout(g.nodes.length, g.edges.map((e) => [e.source, e.target] as [number, number]));
		run(l, 60);
		const [x0, y0, x1, y1] = bounds(l);
		expect(x1 - x0).toBeGreaterThan(300);
		expect(y1 - y0).toBeGreaterThan(300);
		expect(Array.from(l.x).every(Number.isFinite)).toBe(true);
	});

	it('500 nodes settle at interactive speed', () => {
		const g = bigGraph(500);
		expect(g.nodes).toHaveLength(500);
		const l = createLayout(500, g.edges.map((e) => [e.source, e.target] as [number, number]));
		const t0 = performance.now();
		const ticks = run(l, 1000);
		const ms = performance.now() - t0;
		const perTick = ms / ticks;
		console.log(`perf: 500 nodes, ${g.edges.length} edges, ${ticks} ticks in ${ms.toFixed(0)} ms (${perTick.toFixed(2)} ms per tick)`);
		// One frame runs ticks for 8 ms. Strict budget: 2 ms per tick (4 ticks per frame). Busy machines get 4x.
		expect(perTick).toBeLessThan(process.env.FX_PERF_STRICT === '1' ? 2 : 8);
	});

	it('run stops at the time budget', () => {
		const g = bigGraph(500);
		const l = createLayout(500, g.edges.map((e) => [e.source, e.target] as [number, number]));
		let t = 0;
		// The clock reads 1 at the start and goes up by 1 at each check (every 8 ticks); check 11 is past 10 ms.
		const ticks = run(l, 1000, 10, () => (t += 1));
		expect(ticks).toBe(88);
	});
});

describe('hit test and bounds', () => {
	it('finds the node under the pointer, the last drawn first', () => {
		const l = createLayout(2, [], {}, [[0, 0], [4, 0]]);
		expect(hitTest(l, [5, 5], 3, 0, 0)).toBe(1);
		expect(hitTest(l, [5, 5], -4, 0, 0)).toBe(0);
		expect(hitTest(l, [5, 5], 30, 30, 0)).toBe(-1);
		expect(hitTest(l, [5, 5], 11, 0, 2)).toBe(1);
	});

	it('bounds of an empty layout', () => {
		expect(bounds(createLayout(0, []))).toEqual([0, 0, 0, 0]);
	});
});
