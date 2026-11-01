// The Pro features of this plugin, one line each. The "What Pro adds" window, the README Pro section and notemods.com
// use these lines word for word. Each gate is a text of the Pro check in src; tests/what-pro.test.ts checks it.
// No imports with code: tools and tests read this file as plain data.
import type { WhatProFeature } from './license/github-obsidian';

export const PRO_FEATURES: WhatProFeature[] = [
	{
		id: 'size',
		line: 'Size by: the node size shows the value of a number property.',
		gate: { file: 'src/view.ts', text: 'sizeBy: pro ? sizeBy : null' },
	},
	{
		id: 'color',
		line: 'Color by: the node color shows the value of a property, with a legend.',
		gate: { file: 'src/view.ts', text: 'colorBy: pro ? colorBy : null' },
	},
	{
		id: 'link-colors',
		line: 'Color links by relation: each relation gets its own color, with a Links legend.',
		gate: { file: 'src/view.ts', text: 'linkColors: pro && linkColors' },
	},
	{
		id: 'headings',
		line: 'Headings hang from their parent heading, and you can hide the headings below a level.',
		gate: { file: 'src/view.ts', text: 'headingChain: pro && headingChain' },
	},
	{
		id: 'shared',
		line: 'Notes that share a property value get a dashed edge.',
		gate: { file: 'src/view.ts', text: 'shared: pro ? shared : []' },
	},
	{
		id: 'depth',
		line: 'Local depth shows only the notes up to 1 to 5 links away from one note.',
		gate: { file: 'src/view.ts', text: "GraphView.needsPro('Local depth')" },
	},
	{
		id: 'export',
		line: 'Export the graph to a PNG or an SVG file.',
		gate: { file: 'src/main.ts', text: "GraphView.needsPro('Export')" },
	},
	{
		id: 'layout',
		line: 'Save the positions of the nodes in the base file.',
		gate: { file: 'src/main.ts', text: "GraphView.needsPro('Saved layouts')" },
	},
];
