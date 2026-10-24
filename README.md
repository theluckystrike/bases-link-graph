# Bases Link Graph

Bases Link Graph draws the notes that a base selects as a graph. Each note is a node, and each link between two of those notes is an edge.



<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/bases-link-graph.gif" alt="A base of 30 team notes drawn as a graph, then colored by type, joined by team and narrowed to the notes near one project" width="720">

Free: filtered notes, links, navigation, previews, embeds, live updates. Pro: property styling, link colors, nested headings with a level limit, shared-value edges, local depth, exports, saved layouts. $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?metadata_source=bases-link-graph) or [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-link-graph).

## Features

### The notes of a base as a graph

With "Show notes without links" on, each row becomes one node. Links to notes outside the base are left out. Notes with more links are larger.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/graph.png" alt="Thirty project, person and meeting notes drawn as a graph with their links" width="720">

### Choose the source of links

Set "Draw links from" to "All links" (the default), "Note body" (with embeds) or "Properties". Add names such as `parent` to "Link properties" to select relations. An empty list uses all properties. The filter is free and saved with each view.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/link-source.png" alt="The team base shows only links from the project property" width="720">

### Arrows and link types

Turn on "Show arrows" to point each link at its target. A link both ways gets two arrowheads. Hover over a note to see its relations, such as `parent → Rose`. Body links are `body`. Both are free.

Pro: "Color links by relation" gives each relation a color, with a "Links" legend.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/link-types.png" alt="A family base with parent and friend links: arrows, two link colors and the Links legend" width="720">

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/link-hover.png" alt="Without Pro: arrows and a hover card that lists the parent relations of Tom" width="720">

### Headings and blocks as nodes

Set "Headings and blocks" to "Linked headings and blocks". A link such as `[[Book#Repair]]` or `[[Book#^q1]]` then points to a small node on its note. Embeds, aliases and nested headings count. A link to a missing heading goes to the note. "Off" is the default.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/headings.png" alt="A book note with its linked headings and a block as small nodes, and the links from a reading log to them" width="720">

"All headings" shows every heading. A body link starts at the heading that holds it, so an image hangs from its chapter. Click a heading node to open the note there. Both modes are free.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/all-headings.png" alt="Every heading of the book notes as a node, with the image under the Damage heading" width="720">

Pro nests headings and sets the deepest level.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/nested-headings.png" alt="Pro: the chapters nest under the book title heading, with heading levels 1 and 2" width="720">

### Click to open, hover to preview

Click a node to open its note. Ctrl-click (Cmd-click on macOS) opens a new tab. Hover over a node to light up its links. Hold Ctrl or Cmd to preview the note. Scroll to zoom, drag to pan or move a node, and double-click the background to fit the graph.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/hover.png" alt="The Atlas note hovered: its six links are highlighted and a card shows its name" width="720">

### Trackpad navigation

With the free "Trackpad navigation" setting on, a two-finger scroll pans. Pinch, or hold Ctrl or Cmd while scrolling, to zoom.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/trackpad.png" alt="The free trackpad navigation switch in the plugin settings" width="720">

### Live update and embeds

After a link changes, the graph draws again and nodes keep their place. Embed a view with `![[Your base.base#View name]]`.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/embedded.png" alt="The graph embedded in a weekly review note" width="720">

### Size and color by a property (Pro)

Set "Size by" to a number property, such as hours, and the node area follows the value. Set "Color by" to any property, such as type, for a legend with counts. Many numbers become five ranges. Past eight values, the rest share one "Other" color.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/size-color.png" alt="Nodes colored by type with a legend, projects sized by hours" width="720">

### Edges from shared values (Pro)

In "Join notes that share", type property names such as `team` or `tags`. Notes with the same value get a dashed edge. Case, a leading `#` and wikilink brackets do not matter. A value that more than 12 notes share joins them in a chain.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/shared-values.png" alt="Dashed edges between notes of the same team, next to the solid link edges" width="720">

### Local depth (Pro)

Right-click a node and select "Show only notes near this one". The graph then shows the notes up to N edges away. Set N from 1 to 5 with the "Local depth" slider. The x on the chip above the graph shows all notes again.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/local-depth.png" alt="Only the Atlas note and its six direct neighbours" width="720">

### Export and saved layouts (Pro)

The buttons above the graph and the export commands create PNG or SVG files of the whole graph with labels. SVG also has the legend. "Save layout" keeps node positions in the base file. "Reset layout" removes them.

<img src="https://raw.githubusercontent.com/theluckystrike/bases-link-graph/HEAD/docs/export.png" alt="The exported SVG image of the graph with its legend, open in a new tab" width="720">

## Install

1. Open "Settings → Community plugins", select "Browse" and search for "Bases Link Graph".
2. Select "Install" and "Enable". The core plugin "Bases" must be on.

For manual installation, copy the release files into `<vault>/.obsidian/plugins/bases-link-graph/` and enable the plugin. You need Obsidian 1.13.4 or later.

## Usage

1. Create a base, or open one. Set its filters to select the notes you want to see.
2. Select the view menu in the base toolbar and add a view of the type "Link graph".
3. Open the view options to set labels, links and headings.

The base limit applies: when the base shows the first 100 results, the graph has 100 nodes.

## Pro

The free version has no note limit. Pro adds the features marked (Pro) above. To get it:

1. Sponsor through [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=bases-link-graph). A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of Bases Link Graph and select "Sign in with GitHub".
3. Paste the copied code at github.com/login/device and approve.

When Pro is off, the Pro options stay saved in the base file and the graph ignores them.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

View options (base toolbar, saved in the base file):

| Option | What it does |
| --- | --- |
| Labels | When zoomed in, always, or on hover only. |
| Show notes without links | Shows or hides notes with no edge. |
| Draw links from | All links, Note body, or Properties. |
| Link properties | Names of link properties. Empty uses all. Applies only to Properties. |
| Show arrows | Arrowheads at link targets. |
| Headings and blocks | Off, Linked headings and blocks, or All headings. |
| Link length | Distance between linked notes, 20 to 200. |
| Size by (Pro) | A number property for the node size. |
| Color by (Pro) | A property for the node color, with a legend. |
| Join notes that share (Pro) | Property names whose shared values add dashed edges. |
| Local depth (Pro) | How many edges away from the chosen note to show, 0 to 5. |
| Color links by relation (Pro) | A color for each relation, with a "Links" legend. |
| Nest headings under their parent heading (Pro) | A heading hangs from its parent heading. |
| Deepest heading level (Pro) | Hides headings below this level, 1 to 6. |

The settings tab has the Pro section, "Animate the layout" (on), "Trackpad navigation" (off) and "Live update delay" (100 to 2000 ms, 400 ms).

## FAQ

### How is this different from the core graph view?

The core graph shows the vault or one note. Bases Link Graph uses the filters of a base.

### How fast is it?

The end-to-end test draws a base of 500 notes and 1,490 links. It fails when the layout warm-up takes 400 ms or more, or a frame takes 50 ms on average. We have not measured phones or tablets.

### Does it change my notes?

No. Saved layouts and view options go in the base file. Export creates a new file.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Bases Link Graph makes no network requests. Sign in uses the GitHub device flow. Bases Link Graph sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Bases Link Graph sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [bases-link-graph](https://notemods.com/plugins/bases-link-graph/).

Report bugs in the issues, with your Obsidian version and a sample base if you can.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
