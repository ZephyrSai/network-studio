# Port Network Studio

**A browser-based, offline-capable network diagram studio — Visio-style editing with the network data and analysis built in.**

Live app: **https://zephyrsai.github.io/network-studio/** · Offline single file: [`dist/port-network-studio.html`](dist/port-network-studio.html)

Port Network Studio grew out of *Port — Network Architecture Studio v2*, a single-file HTML tool for drawing layered network architectures with precise, manually controlled connector paths. v3 keeps that model (pages → devices, connection points, zones, manual right-angle paths, line jumps, print-ready sheets — and it opens v1/v2 drawings unchanged) and turns it into a full network-diagramming application.

No installation, no account, no server: everything runs in the browser, and drawings never leave the machine unless you export or share them.

---

## Highlights

| Area | What you get |
|---|---|
| **Shapes** | 350+ built-in: 106 original vendor-neutral network/IT/OT/CCTV icons, 217 extended icons (Carbon, Tabler, Material Design), 17 rack-mount faceplates, racks, 14 parametric basic shapes. Four display styles: symbol, card, tile, circle. |
| **More shapes** | **Icons** tab searches **200,000+ open-source icons** online (Iconify: Carbon, Material, Fluent, Phosphor, Tabler, SVG Logos, Simple Icons…). **Import shapes** takes SVG files/folders, vendor icon **ZIPs** (Cisco, AWS, Azure, GCP, Fortinet, Hikvision… — use the packs you are licensed for), **draw.io libraries**, PNG/JPG, and `.portpack.json`. Imported SVGs are sanitised; single-colour icons become recolourable. |
| **Connectors** | Visio-style **dynamic connectors** that auto-route around devices and labels and re-route as you move things; links fan out cleanly from switches; manual right-angle / free / straight / curved paths with draggable sections and bends; line jumps (arc/gap); start/end markers; **link types** (1G, 10G, 40/100G, stack/LAG, WAN/MPLS, Internet, VPN, wireless, HA, management, serial, fieldbus, power, logical) with interface names at each end. Drag from a point or the **quick-connect arrows**, click an arrow to add a connected copy, drop a device onto a link to insert it inline. |
| **Containers** | Network **zones** (plain / header / tab / outline) that carry their members, with subnet, VLAN, gateway and security level. **Racks** with U numbering; rack equipment snaps into U slots. |
| **Shape data** | Hostname, IP, management IP, VLAN, model, vendor, serial, OS, location, status, owner, power, PoE budget/draw, stream bitrate, retention, storage, unit price, notes + custom fields. **Data graphics**: colour devices by status / VLAN / category / any field, show fields under names, `{{field}}` text, status marks (planned = dashed, to remove = ✕). |
| **Network tools** | IP plan with subnet maths and next-free-IP, **auto-assign IPs** to a zone, **VLAN registry**, auto-numbering (`SW-{n:02}`), bulk data edit, generate interface points (`Gi1/0/1…48`). |
| **Analysis** | **Design-rule check** (duplicate IPs/hostnames, IP outside zone subnet, network/broadcast address, gateway errors, overlapping subnets, loose/broken links, isolated devices, overlaps, off-page items, PoE over budget, rack U clashes, link over-utilisation), **single points of failure** (articulation points & bridges), **path trace** with alternative-route count, **camera stream traffic** with per-link utilisation, **PoE budget**, **CCTV storage sizing**, highlight-by-data filter. |
| **Reports** | Device inventory, cable schedule, BOM (with prices), IP plan, rack elevations, PoE budget, CCTV storage, VLAN table — download CSV, copy for Excel, or drop as an editable table on a page. |
| **Import** | **CSV / NetBox exports** (devices + cables, auto-zones by site), **diagram-as-text**, **Cisco CDP / LLDP** `show … neighbors [detail]` output → auto-laid-out topology. |
| **Layout** | Auto-layout: top-down by tier, left-right, grid, hub-and-spoke, ring, organic — zone-aware (each zone laid out as a cluster). Fit page to drawing. |
| **Pages & print** | Multiple pages, **background pages** with border + title block (fields: doc, page, sheet n of m, date), layers (visible / locked / print), page hyperlinks for drill-down, print/PDF fit / actual size / **tiled** across sheets, presentation mode. |
| **Export** | **Visio `.vsdx`** (shapes, glued connectors, Shape Data, layers, hyperlinks), **draw.io**, SVG, PNG (2×/4×/transparent), copy page as image, PDF via print, native JSON, share link (drawing compressed into the URL hash). |
| **Persistence** | Drawings auto-save to **IndexedDB** in your browser — including on GitHub Pages — with a **My drawings** manager (open / duplicate / download / delete, backup & restore all), optional **persistent storage** request, plus a quick localStorage recovery copy. Shape packs and your symbol library persist too. |
| **Workspace layout** | View ▸ Layout or the buttons at the right of the tab row: hide the title bar, collapse the ribbon (tabs pop it open as an overlay; double-click a tab or Ctrl+F1 to pin it), hide the shapes panel / inspector (Ctrl+Alt+←/→), hide the status bar, or **Focus mode** (Ctrl+.) for canvas-only editing. Choices are remembered; View ▸ Layout ▸ Reset layout (or opening the app with `?reset`) restores the default, and the app resets itself if a layout ever leaves the canvas without room. |
| **Productivity** | Ribbon UI, command palette (Ctrl+K), find & replace across text and data, format painter, smart guides, snapping, rulers, overview map, explorer tree, dark mode, smooth trackpad pinch-zoom (Chrome, Edge, Firefox and Safari gestures), full keyboard shortcuts (press `?`). |

### Everything stays linked
The drawing is kept consistent automatically after every edit:

* **Page auto-size** — the page grows to the next sheet (A3 → A2 → A1 …, or a custom size beyond A0) when shapes go past its edge, shrinks back to the size you chose when they return, and shifts the drawing if something is dragged past the top/left edge. Switch it off per page.
* **Pinned blocks** — title blocks, legends and borders pin to a page corner or the margin frame and follow the page when it resizes. Background pages re-anchor to every sheet they sit behind, so one title block works for A3 and A1 sheets alike.
* **Legend generator** (Insert ▸ Legend or Data ▸ Legend): this page or the whole drawing; device types, link types, zones, colour-by values, planned/remove marks, counts; rows per column; pinned to any corner or free; update the selected legend or add one to every page. A pinned legend wraps so it never runs under the title block.
* **Legend** — generated from the page: device types (drawn as they actually appear, including colour-by-data), link types, colour-by values and optionally zones, with counts. Updates as you add or remove things.
* **Containers** — zones carry their members and grow when a member is pushed past an edge; racks carry their equipment and keep U positions when the rack height changes.
* **Connectors** — glued ends follow devices, auto-routes re-route around whatever moved, interface names follow port renames and re-attachment, and deleting a device removes its links (optional, like Visio).
* **Text & fields** — `{{fields}}` in labels, title blocks and tables update live from shape data and document properties.
* **Live design check** — the status bar shows the current error/warning count and opens the full list.
* **Dragging** auto-scrolls the view at the window edge.
* **Fit page to drawing** (Design ▸ Page, the inspector or the status bar): free size that hugs the drawing, or the smallest standard sheet; padding, rounding, border inset, orientation, room for the title block and legend — and an option to keep hugging as you edit. The page border and title block follow.
* **Older drawings** are upgraded on open: existing borders, field-driven title blocks and legends are recognised and pinned.

### Templates — start from one, or add them to the drawing you have
Enterprise campus (with rack elevations) · Data-centre leaf-spine · SD-WAN branches · CCTV / video surveillance · OT / SCADA Purdue model · Hybrid cloud · Small office.

* **Drag a template onto the page** from the left panel's **Templates** tab. A dashed footprint shows where it lands and how big it is.
* Open a card's **Pages & blocks** to drag just one page, or just one zone with everything inside it (e.g. the DMZ from the campus). **All pages as new pages** adds every page after the current one.
* **＋ Add…**, *Insert ▸ Template* or *File ▸ Add template to this drawing* opens the options:
  * what to add, and where: beside or below the drawing, the centre of the view, or a new page;
  * the legend, and whether to keep its layers;
  * a name prefix ("B2 – "), wrapping it in a zone, and grouping it.

  A live preview shows what will be added and what will change.
* **Merging is network-aware.** Layers merge by name, custom fields by key, and embedded shapes come along. Only the VLANs the copied items use are added. Clashing subnets move to the next free one in the same private block; nested subnets move with their parent, and device IPs and gateways follow. Devices whose address is already taken get the next free host address. Clashing hostnames get `-2`, and a name prefix also prefixes hostnames. The page grows to fit, the legend updates, and links re-route around what was there. One Ctrl+Z undoes it.
* **My templates:** save this page, the selection or the whole drawing as a template, from *Insert ▸ Save as template*, *File ▸ Save as template…*, the right-click menu or the Templates tab. You can rename, describe or duplicate one (✎), and download or import it as `.json`. To update one, open it (*Open* on its card), edit, then *Save as template* — it offers to replace that template. Templates live in this browser and are included in *File ▸ My drawings ▸ Back up all* and its restore. **My drawings** lists the other drawings saved in this browser, ready to drop in. Dropping a drawing file on the canvas asks whether to add it or open it.

---

### Ribbon, full screen, links and connection points
* **The ribbon always fits, with no scrolling.** When a tab's groups don't fit the window, they shrink from the right one step at a time: buttons stack three rows high, then big buttons turn small, then icons only (names in tooltips), and finally a group folds into one button that opens it as a popup.
* **Full screen** (button at the top right, *View ▸ Layout*, or Ctrl/⌘+Shift+F) makes the whole editor full screen: ribbon, panels and all. *Present* still shows just the drawing.
* **Move links.** Right-click a device ▸ *Move links to another device…* (or *Move the N selected links to…* after selecting some links). Tick the links, then choose an existing device, pick one on the page, or create a new device placed beside it. The other ends stay put, and interface names are kept if you want.
* **Arrange connection points.** Right-click ▸ *Connection points*, or the inspector's *Arrange points*: in a row along the top or bottom, in a column on the left or right, split between two opposite sides, evenly around the device, or evenly on the sides they're already on. Points keep their identity, so attached connectors follow.

### Selecting (Visio-style)
* **Click** picks the top-most shape. While you hover, an outline shows exactly what a click will select.
  * Unfilled shapes (revision clouds, frames) are picked on their outline, with a tolerance that stays the same at any zoom, so what's inside them stays clickable.
  * Connectors have the same fixed tolerance.
* **Shift- or Ctrl/⌘-click** adds and removes. Click a grouped shape once for the group, and again for just that member. **Alt-click** selects what's underneath (repeat to cycle). **Tab / Shift+Tab** step through shapes. On a Mac, ⌘ takes Ctrl's role, because Ctrl-click is the right-click there.
* **Window selection** (drag on empty space) takes only what is *fully* inside, whichever way you drag, and outlines it before you let go. Hold **Alt** for everything it touches. Groups count only when entirely inside.
* **Zones:**
  * Dragging inside a zone's empty area draws a window over its contents instead of moving the zone.
  * Clicking there selects the zone.
  * Drag the heading or border to move the zone.
* **More ways to select** (*Home ▸ Select*): Lasso, By type… (device types, link types, zones, markup, layers), Invert, None.
* A press that moves under 4 px is a click, so nothing gets nudged by accident. Ctrl/⌘- or Alt-drag duplicates. In a multi-selection, the first item is marked as the primary one, which alignment uses.

### Quick editing, legend, revisions, scaling and inventory
* **Right-click to configure a whole selection.** Change the link type (copper → fibre), line colour, width, style and arrows; device colour, fill, size, display and status; zone colour and style; and text size. *Select similar* picks every item with the same link type, device type or style.
* **Restyle from the legend.** Double-click a legend row, or use its button in the Legend panel. Change "10G fibre" to orange and every fibre link follows, and so do new ones. You can also rename the row, or change a device type's colour or display. If links of one type are styled differently, the legend shows a separate row for each look.
* **Revisions** (*Insert ▸ Revisions*, or the "Rev …" indicator in the status bar):
  * Changes are tracked against the last issued revision.
  * *New revision* bumps the number (1.0→1.1, A→B, P01→P02), logs the date, description and author, and can draw revision clouds with deltas around everything that changed. It can also clear clouds from earlier revisions.
  * Revision tables fill themselves from the history, and one can be added stacked above the title block.
  * When you save a changed drawing, the app asks whether to issue a new revision. It can instead issue the next one automatically, or not ask at all.
  * Clouds and deltas you add yourself are finalised with the revision you issue, and they live on a "Revisions" layer you can hide.
* **Scale** (*Arrange ▸ Scale…*, right-click, or drag a corner): scale the selection, or the whole page, by a percentage.
  * Devices keep their proportions and ports, and labels stay aligned.
  * Connector bends scale with the drawing, and racks move as whole units.
  * Zones are aware of their members: scaling a zone brings its contents, items never leave their zone, and nothing gets scaled into one.
  * Dragging a corner of a multi-selection keeps its aspect ratio (Shift frees it).
* **Inventory** (*Data ▸ Inventory*): choose and order columns from any field, custom fields, zone, subnet, rack/U, links or connected devices. Show one row per device or count identical rows like a BOM. Filter, sort, edit values in place (for example, fill in OS for many devices at once), then download a CSV for Excel, copy it, or place it on a page.
* **Show fields on the drawing.** Select devices, right-click ▸ *Show on drawing* ▸ *OS / firmware*, and only those devices show their OS under the label. Field names can be shown too. The same toggle is in *Data ▸ Show on drawing* and on each inventory column (👁).
* **Connectors meet the drawing.** Connection points sit on each icon's drawn outline, not its padded box. When links leave a device downwards, its name label moves beside the icon, but only if it fits there and you haven't placed it yourself.

## Using it

* **Drag** shapes from the left panel (or click to drop at the centre). Search understands synonyms: `fw`, `nvr`, `ap`, `plc`…
* **Connect**: hover a device and drag from a blue point or a quick-connect arrow to another device. Choose link type and routing in *Home ▸ Connector*.
* **Edit text**: double-click, `Enter` or `F2`. **Data**: right panel ▸ *Data* tab.
* **Zones**: *Insert ▸ Zone* or select devices ▸ *Wrap in zone*. Set the zone's subnet/VLAN in its *Data* tab.
* **Analyse**: *Analyze* ribbon tab. `Esc` clears highlights.
* **Your drawings**: *File ▸ My drawings* (stored in this browser) or *File ▸ Save* for a portable `.json`.
* **Bring your own icons**: *Shapes ▸ ＋ Import shapes* (files / ZIP / draw.io library) or *Packs… ▸ Import folder*.

### Storage notes
Browser storage is per site and per browser profile. On GitHub Pages every project under `zephyrsai.github.io` shares one origin, so data is kept under its own database name (`port-network-studio`). Clearing site data removes stored drawings — use *Back up all* in *My drawings* or save files for anything important. *Make storage persistent* asks the browser not to evict the data under storage pressure.

### Privacy
Nothing is uploaded. The only network calls are the optional online icon search/picks (to `api.iconify.design`) and, on GitHub Pages, loading the app files. Share links carry the drawing in the URL **hash**, which browsers never send to servers.

---

## Development

Plain HTML + vanilla JavaScript, no framework, no build required to run — open `index.html` from any static server.

```
index.html          app shell
css/app.css         UI (light + dark)
js/core.js          document model, geometry, v1/v2 migration, IPv4 helpers
js/stencils.js      built-in icon library
js/packs/extended.js  curated open-licensed icons (generated by tools/build-packs.mjs)
js/shapes.js        basic shapes, racks, link types, themes, catalogue
js/router.js        orthogonal obstacle-avoiding connector router
js/layout.js        hierarchical / grid / radial / ring / force layouts
js/connectors.js    connector geometry, dynamic glue, side spreading, fan nesting, jumps
js/render.js        scene / overlay / rulers / overview rendering
js/analysis.js      SPOF, paths, traffic, PoE, racks, IP plan, design checks, reports
js/io.js            files, SVG/PNG, draw.io, Visio export, share links, print
js/vsdx.js          dependency-free .vsdx writer (+ ZIP writer)
js/packs.js         shape packs, SVG sanitiser, importers, Iconify search, IndexedDB store
js/builder.js       auto-layout glue, CSV / NetBox / text / CDP / LLDP importers
js/templates.js     starter drawings
js/merge.js         add a template / drawing / page / zone block to a drawing (ids, layers, VLANs, subnets, hostnames)
js/tplpanel.js      Templates tab: drag and drop, add options, My templates, My drawings
js/scale.js         zone-aware scaling engine
js/revisions.js     revision log, change tracking, clouds / deltas, revision tables
js/quick.js         right-click quick configure, legend restyle, Scale dialog, revisions UI
js/inventory.js     inventory builder and per-device fields on the drawing
js/select.js        window / lasso / Alt-click / Tab selection, select by type
js/ports.js         arrange connection points (pure)
js/app.js, actions.js, inspector.js, panels.js, workspace.js, main.js   editor UI
tests/              node:test suites (router, layout, vsdx, core/importers, merge, scale, revisions, ports)
tools/              build.mjs (cache-busting + single-file build), build-packs.mjs, stencil preview
```

```bash
npm test             # node --test tests/*.test.js
npm run build        # stamp asset versions in index.html + build dist/port-network-studio.html
npm run packs        # refresh js/packs/extended.js from the Iconify API
```

Third-party icon licences: see [NOTICE.md](NOTICE.md).
