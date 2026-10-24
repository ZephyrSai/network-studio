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
| **Productivity** | Ribbon UI, command palette (Ctrl+K), find & replace across text and data, format painter, smart guides, snapping, rulers, overview map, explorer tree, dark mode, full keyboard shortcuts (press `?`). |

### Templates
Enterprise campus (with rack elevations) · Data-centre leaf-spine · SD-WAN branches · CCTV / video surveillance · OT / SCADA Purdue model · Hybrid cloud · Small office.

---

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
js/app.js, actions.js, inspector.js, panels.js, workspace.js, main.js   editor UI
tests/              node:test suites (router, layout, vsdx, core/importers)
tools/              build.mjs (cache-busting + single-file build), build-packs.mjs, stencil preview
```

```bash
npm test             # node --test tests/
npm run build        # stamp asset versions in index.html + build dist/port-network-studio.html
npm run packs        # refresh js/packs/extended.js from the Iconify API
```

Third-party icon licences: see [NOTICE.md](NOTICE.md).
