import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesLinkGraphPlugin, { fileStamp } from '../src/main';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { KEY, viewOptions } from '../src/view';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
		listeners: () => fns.size,
	};
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new BasesLinkGraphPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings and clamps the delay', () => {
		expect(normalizeSettings({ debounceMs: 'x' as never, animate: 'yes' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ debounceMs: 5 }).debounceMs).toBe(100);
		expect(normalizeSettings({ debounceMs: 99999 }).debounceMs).toBe(2000);
		expect(normalizeSettings({ debounceMs: 450.4, animate: false })).toEqual({ debounceMs: 450, animate: false, trackpad: false });
	});
});

describe('export file name', () => {
	it('stamps local date and time without moment', () => {
		expect(fileStamp(new Date(2026, 9, 5, 7, 3))).toBe('2026-10-05 0703');
		expect(fileStamp(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31 2359');
	});
});

describe('view options', () => {
	it('free options first, Pro options in one group, no reserved Bases keys', () => {
		const opts = viewOptions({} as never);
		const keys = opts.flatMap((o) => ('items' in o ? o.items.map((i) => i.key) : [o.key]));
		expect(keys).toEqual([KEY.labels, KEY.orphans, KEY.spacing, KEY.linkSource, KEY.linkProperties, KEY.sizeBy, KEY.colorBy, KEY.shared, KEY.depth]);
		expect(opts[5]).toMatchObject({ type: 'group', displayName: 'Pro' });
		for (const k of keys) expect(['groupBy', 'order', 'sort', 'filters', 'summaries', 'name', 'type']).not.toContain(k);
	});
});

describe('pro facade', () => {
	it('is off with no manager', () => {
		expect(isPro()).toBe(false);
	});

	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		m.set(false);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(isPro()).toBe(false);
	});

	it('reset unbinds the manager', () => {
		const m = fakeManager(true);
		bindPro(m as never);
		expect(m.listeners()).toBe(1);
		resetPro();
		expect(m.listeners()).toBe(0);
		expect(isPro()).toBe(false);
	});

	it('the sponsor terms match product.yaml', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});
