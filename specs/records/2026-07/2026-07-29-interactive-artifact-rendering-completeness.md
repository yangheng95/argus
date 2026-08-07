# Interactive Artifact Rendering Completeness

## Recall

### User request

- Do not use the number of registered renderer names as evidence that generic Interactive Artifacts work.
- Audit every Interactive Artifact renderer against mature industry behavior.
- Repair the actual display and interaction gaps, then prove the result in the real product.
- Continue to completion without drip-feeding promises.

### Acceptance

- Every one of the twenty strict renderer identities has an explicit capability boundary, mature runtime owner, real interaction inventory, responsive/fullscreen behavior, theme behavior, and real-page acceptance result.
- The common Artifact workspace remains one mounted renderer tree, and fullscreen materially uses the available surface instead of displaying the same fixed compact rectangle.
- Canvas, WebGL, Scalable Vector Graphics (SVG), and library-owned renderers react to container size changes, not only browser-window resize.
- Attachment-backed renderers retain their canonical bytes as long as the durable Interactive Artifact exists.
- Shared loading, error, focus, keyboard, theme, and cleanup behavior is observable and no renderer silently falls back.
- Known authoring boundaries remain honest: Document and Notebook are review surfaces; Code and Spreadsheet edits are local artifact interaction; Presentation is a slide surface; MCP App is the only generic application/runtime surface.
- All UI acceptance uses a disposable real OpenCorvus service, real browser interaction, screenshots, and manual visual judgment. No UI automated test, snapshot, baseline, or DOM assertion file is added, modified, or run.
- Non-UI schema, resource-retention, typecheck, build, i18n, and docs contracts pass.

### Hard constraints

- One renderer identity has one implementation and one mature library owner.
- No HTML/file-extension inference, compatibility branch, fallback renderer, or second application surface.
- No hand-built replacement for established libraries such as TanStack Table, Vega-Lite, Mermaid, CodeMirror, PDF.js, MapLibre, Reveal.js, Univer, vis-timeline, Cytoscape, xterm, model-viewer, or the MCP Apps bridge.
- Product tokens own visual theme; durable payloads own data semantics.
- Preserve all parallel work. Commit with `dsw-33987` and push `myhexin`.

### Materials read

- `specs/current/architecture/07-panel.md`
- `packages/opencorvus/src/interactive-artifact/schema.ts`
- `packages/opencorvus/src/interactive-artifact/persist.ts`
- `packages/overlay/src/components/InteractiveArtifactPart.tsx`
- all files under `packages/overlay/src/components/interactive-artifact/`
- the complete Interactive Artifact section in `packages/overlay/src/styles/surfaces/messages.css`
- official documentation for Reveal.js, Vega/Vega-Lite, MapLibre GL JS, Cytoscape.js, vis-timeline, PDF.js, and model-viewer.

### Full-repository grep

The strict schema, publisher, Work harness guidance, tool pools, session route,
Overlay dispatcher, twenty renderer components, shared media/resource loader,
theme materializer, ArtifactFrame, CSS surface, Work Office producer, and
AttachmentStore sweep were enumerated with:

- `rg -n "presentation@1|InteractiveArtifact|interactive_artifact"`
- `rg -n "renderer: z.literal|z.literal\\(\"[a-z0-9-]+@1\""`
- `rg --files packages/overlay/src/components/interactive-artifact`
- `rg -n "msg-artifact-" packages/overlay/src/styles/surfaces/messages.css`
- `rg -n "AttachmentStore|collectReferencedShas|sweep"`

No parallel renderer dispatch or title/extension inference path exists. The
material gaps are renderer lifecycle and workspace quality, not a missing
twenty-first generic type.

### Independent agent feedback

No independent agent was requested. The primary agent owns the exhaustive audit.

## Renderer truth matrix

| Renderer | Mature owner | Real supported interaction | Confirmed gap / repair target |
| --- | --- | --- | --- |
| `document@1` | OpenCorvus safe Markdown | links, selection, scrolling, fullscreen reading | Remove compact max-height in fullscreen; keep it a review surface, not an editor. |
| `table@1` | TanStack Solid Table | global search, column sort, pagination, horizontal/vertical scroll | Make fullscreen a toolbar/table/pager workspace; preserve sticky headers. |
| `chart@1` | Vega-Lite + Vega Embed | tooltip, legend selection when declared, export menu | Observe container size and rerender default geometry for compact/fullscreen. |
| `diagram@1` | Mermaid | safe SVG navigation plus fullscreen inspection | Let fullscreen SVG use the viewport; keep strict Mermaid security. |
| `code@1` | CodeMirror | selection, search/editor commands, optional local editing, copy | Let fullscreen editor fill the body; do not claim durable collaborative editing. |
| `diff@1` | CodeMirror MergeView | side-by-side navigation, collapsed unchanged sections | Let fullscreen merge view fill the body. |
| `candlestick@1` | Lightweight Charts | crosshair, pan, zoom, time/price scales | Resize both dimensions and reapply product theme after live theme change. |
| `media@1` | native media + shared image preview | image zoom modal, audio/video transport, fullscreen Artifact | Verify attachment load, controls, theme, and retained bytes. |
| `file-preview@1` | PDF.js + CodeMirror | text search/editor commands; PDF paging | Replace fixed PDF scale with HiDPI fit-width, zoom controls, and resize rerender. |
| `map@1` | MapLibre GL JS | drag pan, wheel/pinch zoom, navigation controls | Observe arbitrary container resize/fullscreen and keep markers/layers theme-current. |
| `notebook@1` | Markdown + CodeMirror + shared media | code selection/search and mixed output review | Remove compact max-height in fullscreen; remain review-only, not a kernel. |
| `presentation@1` | Reveal.js | focused keyboard/touch/control navigation, overview, fullscreen | Official theme contract, exact ratios, container `layout()`, normal slide fit, retained Office renders. |
| `spreadsheet@1` | Univer Sheets | selection, formula bar, sheets, zoom, optional local editing | Fullscreen sheet must fill available workspace; verify locale/theme/resize. |
| `dashboard@1` | Vega-Lite + native filters | filters, tooltips, chart actions, responsive view grid | Verify filter-to-view rerender and fullscreen scroll; remove needless visual noise if real screenshots prove it. |
| `timeline@1` | vis-timeline | drag, wheel/pinch zoom, select detail, fit/zoom controls | Explicitly redraw after arbitrary container/fullscreen resize. |
| `network@1` | Cytoscape.js | pan, zoom, node drag/select, search focus, fit | Explicitly invalidate dimensions and fit after container/fullscreen resize. |
| `tree@1` | native Disclosure | keyboard disclosure, search, scrolling | Search must force matching ancestor paths open instead of hiding the match behind collapsed details. |
| `terminal@1` | xterm.js | scrollback, selection, search-next, copy | Fullscreen terminal must fill the workspace; existing FitAddon owns resize. |
| `model-3d@1` | model-viewer | orbit/pan/zoom, animation, reset camera | Fullscreen viewer must fill the workspace and component cleanup must remove its mounted custom element. |
| `mcp-app@1` | official MCP Apps bridge | app-defined controls, tool calls, links/download confirmations, inline/fullscreen/picture-in-picture | Keep its protocol-owned modes and strict capability bridge; verify real embedded app independently of native Artifact fullscreen. |

## Systemic root causes

1. `ArtifactFrame` enters the browser Fullscreen API correctly, but only Chart,
   Network, and Timeline receive fullscreen height. Most renderer-specific
   compact `height` or `max-height` rules remain active, so the workspace is
   often a large blank page around a compact artifact.
2. Several mature libraries respond to window resize but not arbitrary parent
   size changes caused by the Conversation/Right Dock split or Fullscreen API.
3. PDF.js renders at a fixed scale unrelated to available width, making compact
   and fullscreen quality accidental.
4. Candlestick theme colors are captured once, unlike the shared live theme
   contract used by Vega, Mermaid, MapLibre, Univer, Network, and Terminal.
5. Tree filtering computes the correct visible ancestors but does not open
   their native disclosures, so a valid match can remain invisible.
6. Attachment garbage collection omits `interactive_artifact.payload`, placing
   Media, File Preview, Notebook media, Presentation renders, and 3D sources at
   risk when no other durable owner references the same bytes.
7. The schema contains duplicate discriminated-union/source-diagnostic lines;
   these are removed rather than retained as misleading dead duplication.

## Implementation

1. Repair the shared native fullscreen layout contract using the existing
   `data-artifact-renderer` identity; give each complex renderer body the
   correct header/content/footer grid without creating a second renderer.
2. Use each library's public resize API from one `ResizeObserver` where its
   container can change independently of the window.
3. Add responsive PDF fit-width and bounded zoom on the existing PDF.js display
   layer, including device-pixel-ratio rendering and cancellation.
4. Drive candlestick palette updates from the existing product-theme observer.
5. Control native Tree disclosures only while a filter is active; ordinary
   user-controlled expand/collapse remains browser-owned.
6. Harvest Interactive Artifact payload attachments in the single
   AttachmentStore live-set union and prove the positive data contract.
7. Keep renderer-local limits honest. Do not add editing persistence, a
   notebook kernel, remote data fetch, arbitrary HTML, or a second app bridge.

## Real-page acceptance matrix

The isolated acceptance transcript will publish one representative artifact
for each of the twenty identities, with additional variants for Presentation
ratios and File Preview media. Manual acceptance records:

- initial visible content and absence of render errors,
- primary control interaction for every interactive renderer,
- compact geometry and internal scrolling ownership,
- fullscreen geometry for every native renderer,
- light/dark theme for every library/theme family,
- resize-sensitive behavior after fullscreen entry/exit,
- attachment-backed media before and after startup sweep,
- MCP App inline/fullscreen/picture-in-picture modes and bridge status.

Each row receives one of `accepted`, `blocked`, or `not applicable`, with exact
evidence and no claim of completeness when a row remains blocked.

## Validation

### Non-UI

- targeted Interactive Artifact schema and persistence contracts,
- `bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts`,
- `bun run --cwd packages/overlay typecheck`,
- `bun run --cwd packages/overlay build:vite`,
- `bun run --cwd packages/overlay check:i18n`,
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`.

### UI

Real OpenCorvus browser interaction and manually inspected screenshots only.
No UI automation file, baseline, fixture assertion, or UI test command.

## Delivered acceptance

The disposable service published twenty strict renderer identities as twenty-four
real Artifact records: one of each renderer plus Presentation ratio/render
variants and both PDF/text File Preview variants. Attachment-backed PDF, image,
PowerPoint render, and glTF bytes were aged beyond the sweep threshold before
service startup and remained readable after sweep.

| Renderer | Manual result | Interaction and visual evidence |
| --- | --- | --- |
| Document | accepted | Rich Markdown, link, list, table, selection/scroll, and the shared fullscreen surface render correctly. |
| Table | accepted | A 55-row table searched to row 55, sorted by a column header, and entered native fullscreen without losing the toolbar or pager. |
| Chart | accepted | Vega-Lite bars resized with the container; hover exposed the declared month/delivered/stream tooltip. |
| Diagram | accepted | A six-step Mermaid flow begins at the first node in compact mode and shows the complete graph in Artifact workspace rather than centering the start off-screen. |
| Code | accepted | CodeMirror content was selected and locally edited. The boundary remains intentionally local, not durable collaborative editing. |
| Diff | accepted | CodeMirror MergeView rendered before/after content side by side with navigable changed regions. |
| Candlestick | accepted | Lightweight Charts rendered real OHLC data with crosshair/scales and retained geometry through resize/theme application. |
| Media | accepted | The retained image loaded through the authenticated attachment route and opened the shared zoom modal. |
| File Preview | accepted | PDF.js rendered the retained PDF at device-pixel ratio; 125% zoom and fit-width worked. Text preview remained selectable in CodeMirror. |
| Map | accepted within contract | MapLibre pan/zoom controls, markers, lines, and resize work on the declared neutral GeoJSON surface. The V1 payload has no basemap/style/tile contract and is not claimed as a street-navigation map. |
| Notebook | accepted | Markdown, code, text result, and retained image output render as a durable review record; no live kernel is claimed. |
| Presentation | accepted | Semantic 16:9, 4:3, and 1:1 stages, focused keyboard navigation, native fullscreen, theme, and an actual retained PowerPoint-render image were inspected. |
| Spreadsheet | accepted | Univer rendered two sheets; selection, Plan/Notes switching, formula/name surfaces, zoom, and fullscreen resizing remained interactive. |
| Dashboard | accepted | KPI cards, two Vega views, tooltips/actions, and the APAC filter rendered as one responsive dashboard. |
| Timeline | accepted | vis-timeline rendered groups/items; fit and zoom controls worked without the former undefined-window runtime errors. |
| Network | accepted | Cytoscape node/edge labels no longer overlap after label-aware layout; search focuses matching context, fit restores the full graph, and the Artifact workspace uses the viewport. |
| Tree | accepted | Searching for `Presentation` forced the matching ancestor path open and exposed all three matching nodes. |
| Terminal | accepted | xterm output, search-next highlight, copy surface, resize, and scrollback work; the proposed decoration API required by SearchAddon is explicitly enabled. |
| 3D model | accepted | A retained valid glTF cube loaded in model-viewer; orbit drag changed camera position and Reset camera remained available. |
| MCP App | accepted | The real protocol-owned iframe reached `Connected`; inline, native fullscreen, and top-layer picture-in-picture used the same iframe and received live display-mode/theme notifications. |

## Additional root causes found in real-page review

1. PDF.js workers were emitted as `.mjs`, but the production static server sent
   them as `application/octet-stream`, so module-worker import failed. The
   canonical JavaScript module MIME mapping now owns `.mjs`.
2. A sandboxed MCP App iframe pointed at a parent-created Blob URL and rendered
   blank in the real WebView. The same strict HTML now enters the iframe through
   `srcdoc`, while the official bridge and sandbox remain the sole app protocol.
3. CSS `position: fixed` cannot create reliable fullscreen/picture-in-picture
   surfaces inside the transformed Conversation tree. MCP App now uses the
   browser Fullscreen API and native popover top layer instead of an imitation.
4. vis-timeline received `start` and `end` keys with undefined values, causing
   library errors. Those options are present only when the payload declares a
   viewport.
5. Cytoscape ran layout before theme labels were installed, so
   `nodeDimensionsIncludeLabels` had no label dimensions to measure. It now
   mounts with preset positions, applies the complete style, and then runs the
   declared layout.
6. xterm SearchAddon decorations use a proposed xterm API. The old configuration
   exposed the button but threw on click; the Terminal instance now explicitly
   enables the API required by that installed mature addon.

## Remaining honest industry gaps

- The strict twenty-type catalog is usable, but type count is not feature
  parity with desktop Office, Jupyter, GIS, or a general browser runtime.
  Presentation supports semantic Reveal decks and pre-rendered Office slides;
  it does not parse arbitrary `.pptx` inside the Overlay.
- Map V1 has no authenticated basemap/style/tile/attribution resource contract.
  Adding a street map requires one strict offline/cache-aware MapLibre style and
  tile ownership contract, not a hard-coded public tile fallback.
- First-open lazy chunks remain large: Spreadsheet is about 6.14 MB
  (1.70 MB gzip), 3D about 1.07 MB, Map about 0.95 MB, Vega Embed about
  0.79 MB, and Timeline about 0.61 MB in the production build. They do not
  inflate initial load because renderer branches are lazy, but industry-grade
  cold-open work still requires narrower library imports/workers and measured
  per-renderer budgets.
- Document and Notebook remain durable review surfaces; Code and Spreadsheet
  edits remain local Artifact interaction. Persisted multi-user authoring and a
  live notebook kernel are separate product contracts, not silently promised
  generic behavior.
