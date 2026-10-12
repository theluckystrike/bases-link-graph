import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-link-graph.json';
import * as graph from '../src/graph';
import type { Edge, GraphOptions, NodeInput } from '../src/graph';

interface Case {
	name: string;
	function?: 'sizeScale' | 'colorScale' | 'parseNumber' | 'linkCounts';
	args: unknown[];
	expected: unknown;
}

function edgeRow(e: Edge): unknown[] {
	return e.kind === 'link' ? [e.source, e.target, e.kind, e.weight, e.mutual] : [e.source, e.target, e.kind, e.weight, e.prop, e.values];
}

describe('golden vectors (packages/spec/vectors/bases-link-graph.json)', () => {
	const cases = vectors.cases as Case[];
	it('has at least 20 buildGraph cases and 30 in all', () => {
		expect(cases.filter((c) => !c.function).length).toBeGreaterThanOrEqual(20);
		expect(cases.length).toBeGreaterThanOrEqual(30);
	});
	for (const c of cases) {
		it(c.name, () => {
			if (c.function) {
				const fn = graph[c.function] as (...a: unknown[]) => unknown;
				expect(fn(...c.args)).toEqual(c.expected);
				return;
			}
			const [rows, opts] = c.args as [NodeInput[], GraphOptions];
			const g = graph.buildGraph(rows, opts);
			const got: Record<string, unknown> = { nodes: g.nodes.map((n) => n.id), edges: g.edges.map(edgeRow), hidden: g.hidden };
			const want = c.expected as Record<string, unknown>;
			expect(Object.fromEntries(Object.keys(want).map((k) => [k, got[k]]))).toEqual(want);
		});
	}
});
