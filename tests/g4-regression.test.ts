import { afterEach, describe, expect, it, vi } from 'vitest';
import { BooleanValue, ListValue, NumberValue, QueryController, StringValue } from 'obsidian';
import { GraphView, toPlain } from '../src/view';
import { parseNumber } from '../src/graph';
import { DEFAULT_SETTINGS } from '../src/settings';
import { resetPro } from '../src/pro';

afterEach(() => resetPro());

describe('mixed Bases values', () => {
	it('keeps a checkbox as a boolean so the size scale gets 1 or 0', () => {
		expect(toPlain(new BooleanValue(true))).toBe(true);
		expect(toPlain(new BooleanValue(false))).toBe(false);
		expect(parseNumber(toPlain(new BooleanValue(true)))).toBe(1);
	});
	it('keeps primitive types in a list and keeps text that resembles a boolean as text', () => {
		expect(toPlain(new ListValue([new NumberValue(42), new BooleanValue(false), new StringValue('true')]))).toEqual([42, false, 'true']);
		expect(toPlain(new StringValue('false'))).toBe('false');
	});
});

describe('trackpad navigation', () => {
	function canvas(trackpad: boolean) {
		const plugin = { settings: { ...DEFAULT_SETTINGS, trackpad }, views: new Set<GraphView>() };
		const v = new GraphView(new QueryController() as never, createDiv(), plugin as never);
		v.load();
		vi.spyOn(v, 'draw').mockImplementation(() => undefined);
		v.zoom = 2;
		v.tx = 20;
		v.ty = 30;
		return { v, el: v.containerEl.querySelector('canvas')! };
	}
	it('pans in two directions without zooming and stops the note scroll', () => {
		const { v, el } = canvas(true);
		const event = new WheelEvent('wheel', { deltaX: 15, deltaY: -10, cancelable: true });
		el.dispatchEvent(event);
		expect([v.tx, v.ty, v.zoom]).toEqual([5, 40, 2]);
		expect(event.defaultPrevented).toBe(true);
		v.unload();
	});
	it('pinch zoom keeps the layout point under the cursor in the same place', () => {
		const { v, el } = canvas(true);
		const before = [(100 - v.tx) / v.zoom, (120 - v.ty) / v.zoom];
		// happy-dom WheelEvent extends UIEvent and does not copy MouseEvent fields.
		const pinch = new WheelEvent('wheel', { deltaY: -20 });
		Object.defineProperties(pinch, { ctrlKey: { value: true }, clientX: { value: 100 }, clientY: { value: 120 } });
		el.dispatchEvent(pinch);
		expect(v.zoom).toBeGreaterThan(2);
		expect((100 - v.tx) / v.zoom).toBeCloseTo(before[0]!);
		expect((120 - v.ty) / v.zoom).toBeCloseTo(before[1]!);
		v.unload();
	});
	it('keeps mouse-wheel zoom when the setting is off', () => {
		const { v, el } = canvas(false);
		el.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }));
		expect(v.zoom).toBeLessThan(2);
		v.unload();
	});
	it('converts line scroll units to pixels', () => {
		const { v, el } = canvas(true);
		el.dispatchEvent(new WheelEvent('wheel', { deltaX: 1, deltaY: 2, deltaMode: 1 }));
		expect([v.tx, v.ty]).toEqual([4, -2]);
		v.unload();
	});
	it('updates a stale bitmap before applying the first pan', () => {
		const { v, el } = canvas(true);
		Object.defineProperties(el, { clientWidth: { value: 200 }, clientHeight: { value: 100 } });
		el.width = 1;
		el.height = 1;
		vi.spyOn(v, 'fit').mockImplementation(() => {
			v.zoom = 2;
			v.tx = 20;
			v.ty = 30;
		});
		el.dispatchEvent(new WheelEvent('wheel', { deltaX: 15, deltaY: -10 }));
		expect([el.width, el.height]).toEqual([200 * window.devicePixelRatio, 100 * window.devicePixelRatio]);
		expect([v.tx, v.ty, v.zoom]).toEqual([5, 40, 2]);
		v.unload();
	});
});
