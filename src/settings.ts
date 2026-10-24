import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type BasesLinkGraphPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface BasesLinkGraphSettings {
	/** Wait in ms after a note changes before open graphs redraw. */
	debounceMs: number;
	/** Animate the layout as it settles. Off = settle first, then draw once. */
	animate: boolean;
	/** Pan with two-finger scrolling; pinch or Ctrl/Cmd-scroll to zoom. */
	trackpad: boolean;
}

export const DEBOUNCE_MIN = 100;
export const DEBOUNCE_MAX = 2000;

export const DEFAULT_SETTINGS: BasesLinkGraphSettings = {
	debounceMs: 400,
	animate: true,
	trackpad: false,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<BasesLinkGraphSettings> | null | undefined): BasesLinkGraphSettings {
	const s = saved ?? {};
	const d = typeof s.debounceMs === 'number' && Number.isFinite(s.debounceMs) ? Math.round(s.debounceMs) : DEFAULT_SETTINGS.debounceMs;
	return {
		debounceMs: Math.min(DEBOUNCE_MAX, Math.max(DEBOUNCE_MIN, d)),
		animate: typeof s.animate === 'boolean' ? s.animate : DEFAULT_SETTINGS.animate,
		trackpad: typeof s.trackpad === 'boolean' ? s.trackpad : DEFAULT_SETTINGS.trackpad,
	};
}

export class BasesLinkGraphSettingTab extends PluginSettingTab {
	plugin: BasesLinkGraphPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BasesLinkGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Animate the layout',
				desc: 'Show the nodes as they move into place. Turn off to draw the finished layout at once.',
				control: { type: 'toggle', key: 'animate', defaultValue: DEFAULT_SETTINGS.animate },
			},
			{
				name: 'Trackpad navigation',
				desc: 'Pan with two-finger scrolling. Pinch, or hold Ctrl or Cmd while scrolling, to zoom. Off keeps scroll-to-zoom.',
				control: { type: 'toggle', key: 'trackpad', defaultValue: DEFAULT_SETTINGS.trackpad },
			},
			{
				name: 'Live update delay',
				desc: `Milliseconds to wait after you edit a note before open graphs draw again, from ${DEBOUNCE_MIN} to ${DEBOUNCE_MAX}.`,
				control: { type: 'slider', key: 'debounceMs', defaultValue: DEFAULT_SETTINGS.debounceMs, min: DEBOUNCE_MIN, max: DEBOUNCE_MAX, step: 100 },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: size and color by a property, link colors, nested headings with a level limit, edges from shared values, local depth, export to PNG or SVG, and saved layouts.'
					: 'Free version: the graph of the notes in a base with link edges, headings and blocks as nodes, labels, zoom, pan, drag, click to open and hover preview. Pro adds size and color by a property with a legend, link colors, nested headings with a level limit, edges from shared values, local depth, export to PNG or SVG, and saved layouts.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		for (const v of this.plugin.views) v.schedule(0);
	}
}
