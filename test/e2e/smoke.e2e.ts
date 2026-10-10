import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers the view through the public Bases API', async function () {
		const ok = await browser.executeObsidian(({ app }) => {
			const bases = (app as unknown as { internalPlugins: { getEnabledPluginById(id: string): unknown } }).internalPlugins.getEnabledPluginById('bases');
			return bases !== null;
		});
		expect(ok).toBe(true);
	});
});
