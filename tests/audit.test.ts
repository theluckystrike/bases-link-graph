import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryController } from 'obsidian';
import { colorScale, sizeScale } from '../src/graph';
import BasesLinkGraphPlugin, { pngScale } from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS } from '../src/settings';
import { GraphView } from '../src/view';
import { createLayout } from '../src/layout';
import type { Theme } from '../src/theme';

afterEach(() => resetPro());

const theme: Theme = { background: '#fff', node: '#888', line: '#ccc', shared: '#00f', text: '#000', accent: '#f0f', font: 'sans-serif', palette: ['#111'], ramp: ['#222'] };

function view(): GraphView {
	const plugin = { settings: { ...DEFAULT_SETTINGS }, views: new Set<GraphView>() };
	return new GraphView(new QueryController() as never, createDiv(), plugin as never);
}

describe('open a node', () => {
	it('opens the row file itself, also when its name has a # or ^ that a link would cut off', () => {
		const v = view();
		const file = { path: 'Notes/C# guide ^1.md' };
		const openFile = vi.fn(async () => undefined);
		const openLinkText = vi.fn(async () => undefined);
		const getLeaf = vi.fn(() => ({ openFile }));
		const workspace = { openLinkText, getLeaf };
		Object.assign(v, {
			graph: { nodes: [{ id: file.path, label: 'C# guide ^1', row: 0, degree: 0 }], edges: [], hidden: { orphans: 0, outside: 0 } },
			app: { vault: { getFileByPath: (p: string) => (p === file.path ? file : null) }, workspace },
		});
		v.open(0, 'tab');
		expect(openLinkText).not.toHaveBeenCalled();
		expect(getLeaf).toHaveBeenCalledWith('tab');
		expect(openFile).toHaveBeenCalledWith(file);
	});

	it('does not create a note when the row file is gone', () => {
		const v = view();
		const openLinkText = vi.fn(async () => undefined);
		const getLeaf = vi.fn();
		const workspace = { openLinkText, getLeaf };
		Object.assign(v, {
			graph: { nodes: [{ id: 'gone.md', label: 'gone', row: 0, degree: 0 }], edges: [], hidden: { orphans: 0, outside: 0 } },
			app: { vault: { getFileByPath: () => null }, workspace },
		});
		v.open(0);
		expect(openLinkText).not.toHaveBeenCalled();
		expect(getLeaf).not.toHaveBeenCalled();
	});
});

describe('pointer cancel', () => {
	it('a cancelled drag ends the drag, so the layout cools and no note opens', () => {
		const v = view();
		v.load();
		const l = createLayout(1, []);
		const canvas = (v as unknown as { canvas: HTMLCanvasElement }).canvas;
		Object.assign(v, { opts: { saved: null }, layout: l, radius: new Float64Array([10]), graph: { nodes: [{ id: 'a.md', label: 'a', row: 0, degree: 0 }], edges: [], hidden: { orphans: 0, outside: 0 } } });
		const open = vi.spyOn(v, 'open').mockImplementation(() => undefined);
		Object.assign(v as object, { pointer: { mode: 'node', node: 0, startX: 0, startY: 0, moved: true, wasFixed: false } });
		l.fixed[0] = 1;
		l.alphaTarget = 0.1;
		canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
		expect((v as unknown as { pointer: unknown }).pointer).toBeNull();
		expect(l.alphaTarget).toBe(0);
		expect(l.fixed[0]).toBe(0);
		expect(open).not.toHaveBeenCalled();
		v.unload();
	});
});

describe('PNG export', () => {
	it('keeps the canvas inside the mobile canvas limits', () => {
		for (const [w, h] of [[100, 100], [5000, 5000], [20000, 300], [1, 40000]] as const) {
			const k = pngScale(w, h);
			expect(k).toBeGreaterThan(0);
			expect(k).toBeLessThanOrEqual(2);
			expect(Math.ceil(w * k) * Math.ceil(h * k)).toBeLessThanOrEqual(16_777_216);
			expect(Math.max(Math.ceil(w * k), Math.ceil(h * k))).toBeLessThanOrEqual(8000);
		}
		expect(pngScale(100, 100)).toBe(2);
	});

	it('draws every label when the view shows labels on hover only', () => {
		const v = view();
		Object.assign(v, {
			layout: createLayout(2, []),
			radius: new Float64Array([5, 5]),
			graph: { nodes: [{ id: 'a.md', label: 'a', row: 0, degree: 0 }, { id: 'b.md', label: 'b', row: 1, degree: 0 }], edges: [], hidden: { orphans: 0, outside: 0 } },
			opts: { labels: 'hover' },
		});
		const fillText = vi.fn();
		const ctx = { setLineDash: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillText } as unknown as CanvasRenderingContext2D;
		v.paint(ctx, theme, 1, -1, true);
		expect(fillText.mock.calls.map((c) => c[0] as string)).toEqual(['a', 'b']);
	});

	it('a failed write shows a notice and does not reject', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const plugin = Object.create(BasesLinkGraphPlugin.prototype) as BasesLinkGraphPlugin;
		Object.assign(plugin, {
			app: {
				fileManager: { getNewFileParent: () => ({ path: '/' }) },
				vault: { getAbstractFileByPath: () => null, create: () => Promise.reject(new Error('disk full')) },
			},
		});
		vi.spyOn(plugin, 'svgModel').mockReturnValue({ nodes: [], edges: [], background: '#fff', text: '#000' });
		const v = { layout: createLayout(0, []), graph: { nodes: [], edges: [] }, config: { name: 'G' } } as unknown as GraphView;
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await expect(plugin.exportView(v, 'svg')).resolves.toBeNull();
		err.mockRestore();
	});
});

describe('large bases', () => {
	it('size and color scales take 200,000 rows without a stack overflow', () => {
		const values = Array.from({ length: 200_000 }, (_, i) => i);
		expect(sizeScale(values).length).toBe(200_000);
		expect(colorScale(values).kind).toBe('number');
	});
});

describe('number bins', () => {
	it('many spellings of one number do not give empty bins with no color slot', () => {
		const values = ['1', '1.0', '1.00', '01', '001', '$1', '1 %', '+1', '1.000'];
		const c = colorScale(values);
		expect(c.slots.every((s) => Number.isInteger(s) && s >= 0)).toBe(true);
		expect(c.legend.reduce((a, b) => a + b.count, 0)).toBe(values.length);
	});
});
