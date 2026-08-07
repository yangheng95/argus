# 2026-07-25 Interactive Artifact Comprehensive Catalog

## Recall

### User requirement

- Do not stop at the existing twelve Interactive Artifact renderer identities.
- Define one detailed, complete Goal, fill the missing types and interactions,
  test the whole delivery, and continue until the capability is genuinely
  complete.
- Do not use the generic Model Context Protocol (MCP) App surface to claim that
  every missing first-class artifact type is already supported.

### Acceptance criteria

OpenCorvus exposes one strict catalog of twenty versioned renderer identities:
nineteen model-publishable native renderers plus the server-bound `mcp-app@1`
application surface. Completion requires:

1. The existing twelve identities continue to validate and render.
2. `presentation@1`, `spreadsheet@1`, `dashboard@1`, `timeline@1`,
   `network@1`, `tree@1`, `terminal@1`, and `model-3d@1` are first-class
   schema, publisher, generated Application Programming Interface (API),
   Overlay, test, prompt, documentation, and visual-acceptance identities.
3. Each native renderer remains declarative, message-owned, replayable and
   free of hidden network or process execution. Application state, arbitrary
   business mutations, approval, form submission, collaborative editing and
   whiteboard authoring remain `mcp-app@1` responsibilities.
4. Attachment-backed 3D models use the existing canonical attachment object
   and publisher-side ownership, MIME (Multipurpose Internet Mail Extensions)
   type, digest and byte-size verification.
5. The Overlay provides real renderer-local interactions:
   slide navigation and keyboard control; workbook sheet selection, cell
   selection and formula/value inspection; dashboard filtering and composed
   views; timeline pan/zoom and selection; network pan/zoom/search and
   selection; tree expand/collapse/search; terminal search/copy and ANSI
   (American National Standards Institute) replay; and 3D camera controls.
6. Unit and integration tests cover valid and invalid payloads, all twenty
   dispatch identities, attachment ownership, durable replay, publisher
   guidance and real message flow.
7. A Node-launched Playwright run against an isolated real Vite page exercises
   pointer, keyboard/focus, refresh and error paths and produces goal/region
   bound light and dark screenshots. The screenshots are inspected and visual
   defects are corrected before completion.
8. Focused tests, root and Overlay typecheck, Vite production build, generated
   API/Software Development Kit (SDK), route/docs/i18n/document-health checks,
   `git diff --check`, and a second code and visual review pass.
9. Only task-owned files are staged. The final commit uses the `dsw-33987`
   prefix and is pushed through normal hooks to `myhexin/v0.0.18beta`.

### Hard constraints

- Preserve all unrelated staged, unstaged and untracked work in the shared
  worktree. Do not stash, reset, restore, broadly stage or create another
  worktree.
- Do not restart, close, refresh or otherwise interfere with the user's
  running OpenCorvus or Overlay. Acceptance uses isolated processes.
- Playwright is launched by Node, never Bun.
- The Session/Message-owned `interactive_artifact` row and its artifact ID
  display part remain the only content and ownership source.
- No fallback parser, renderer inference, compatibility union, raw remote
  resource URL, hidden process, synthetic message, client-side shadow payload,
  keyword router, gate or state-machine workflow.
- A native renderer is added only for a safe declarative artifact family with
  distinct data and interaction semantics. Bar/line/pie charts remain
  `chart@1`; Gantt items are a `timeline@1` variant; folder and outline data
  remain `tree@1`; arbitrary forms, workflows, editors and domain applications
  remain `mcp-app@1`.

### Sources read before implementation

- Root `AGENTS.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-19-inline-interactive-artifact-protocol.md`.
- `specs/records/2026-07/2026-07-23-interactive-artifact-renderer-expansion.md`.
- `specs/records/2026-07/2026-07-25-mcp-apps-production-host.md`.
- `packages/opencorvus/src/interactive-artifact/{schema,persist}.ts`.
- `packages/opencorvus/src/tool/publish-interactive-artifact.ts`.
- `packages/opencorvus/src/prompt/fragments/interactive-artifact-guidance.ts`.
- `packages/opencorvus/src/session/{message,processor,session.sql}.ts`.
- `packages/opencorvus/src/server/routes/interactive-artifact.ts`.
- `packages/overlay/src/components/InteractiveArtifactPart.tsx`.
- `packages/overlay/src/components/interactive-artifact/**`.
- `packages/overlay/src/services/interactive-artifact.ts`.
- Interactive-artifact backend, Overlay unit, browser and real MCP App tests.
- Reveal.js API and fullscreen documentation.
- Univer Sheets workbook snapshot, core-feature and API documentation.
- Vega-Lite multi-view composition documentation.
- vis-timeline item/group, selection and viewport documentation.
- Cytoscape.js graph model, layout, gesture and selection documentation.
- TanStack Virtual Solid/list documentation.
- xterm.js terminal, accessibility and add-on documentation.
- Khronos glTF (Graphics Language Transmission Format) 2.0 and Google
  `<model-viewer>` documentation.
- Stable MCP Apps 2026-01-26 overview and protocol documentation.

### Whole-repository search evidence

Before this plan was written, the inventory used:

```text
rg -n "InteractiveArtifactPayload|PublishableInteractiveArtifactPayload|publishInteractiveArtifact|publish_interactive_artifact" packages specs
rg -n "document@1|table@1|chart@1|diagram@1|code@1|diff@1|candlestick@1|media@1|file-preview@1|map@1|notebook@1|mcp-app@1" packages specs
rg -n "renderer ===|data-artifact-renderer|interactive-artifact" packages/overlay/src packages/overlay/test
rg -n "AttachmentStore|InteractiveArtifactAttachment|resolveResourceUrl" packages/opencorvus packages/overlay
rg -n "presentation|spreadsheet|dashboard|timeline|network|tree|terminal|model-3d|gltf|glb" packages specs package.json bun.lock
```

Findings:

- `packages/opencorvus/src/interactive-artifact/schema.ts` is the only
  production payload union.
- `publishInteractiveArtifact` is the only native artifact-row writer and
  `publish_interactive_artifact` is the only model publisher.
- MCP Apps are produced separately from real bound MCP tool lifecycles and
  cannot be model-authored.
- `attachmentReferences` in `persist.ts` is the only publisher-side traversal
  of attachment-backed payloads.
- The session-scoped route and Overlay service are the only persisted payload
  read path.
- `InteractiveArtifactPart.tsx` is the only renderer dispatch.
- `ArtifactFrame`, existing shared Button/SearchField/CodeEditor primitives and
  renderer-local components are the only native presentation surface.
- The generated OpenAPI document and JavaScript SDK repeat the schema but are
  regenerated from the production schema; they are not edited as a second
  source.
- Backend validation coverage is centralized in
  `interactive-artifact.test.ts`; Overlay source-contract coverage is
  centralized in `message-interactive-artifact.test.ts`; real visual coverage
  is centralized in `inline-interactive-artifacts-browser.test.ts`.
- No production schema or Overlay component currently defines any of the eight
  new identities. Existing mentions of terminal, tree or spreadsheet are
  unrelated product surfaces.

### Independent agent feedback

None. The user did not request delegated agents, and the active collaboration
rules prohibit unsolicited delegation.

### Git and shared-worktree baseline

- Branch: `v0.0.18beta`.
- Baseline HEAD: `5d6891137`, equal to `myhexin/v0.0.18beta`.
- The worktree already contains unrelated Expert Squad, Goal versioning and
  spec-index changes. This task will edit and stage only exact task-owned paths
  and hunks.

## Capability matrix

The catalog boundary is user-visible artifact semantics, not every visual
subtype and not arbitrary application behavior.

| Renderer         | Current state | Final native contract                                                         | Mature renderer/primitive                       | Required interaction                                                             |
| ---------------- | ------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `document@1`     | Existing      | Safe Markdown                                                                 | Existing Markdown pipeline                      | link and text selection                                                          |
| `table@1`        | Existing      | Typed rows/columns                                                            | TanStack Table                                  | search, sort, pagination                                                         |
| `chart@1`        | Existing      | Inline-data Vega-Lite                                                         | Vega-Lite/Vega Embed                            | tooltip, selection, pan/zoom where declared                                      |
| `diagram@1`      | Existing      | Mermaid source                                                                | Mermaid                                         | zoom and copy                                                                    |
| `code@1`         | Existing      | Typed source                                                                  | CodeMirror 6                                    | edit when declared and copy                                                      |
| `diff@1`         | Existing      | Original/modified source                                                      | CodeMirror Merge                                | synchronized inspection                                                          |
| `candlestick@1`  | Existing      | Open, High, Low, Close and Volume series                                      | Lightweight Charts                              | crosshair and zoom                                                               |
| `media@1`        | Existing      | One canonical image/audio/video attachment                                    | native media elements                           | native playback/view                                                             |
| `file-preview@1` | Existing      | Canonical PDF/text attachment                                                 | PDF.js/text viewer                              | pagination and selection                                                         |
| `map@1`          | Existing      | Inline GeoJSON                                                                | MapLibre GL                                     | pan, zoom and feature inspection                                                 |
| `notebook@1`     | Existing      | Display-only cells/outputs                                                    | Markdown/CodeMirror/media reuse                 | cell inspection                                                                  |
| `presentation@1` | Missing       | Ordered slides with Markdown body, optional canonical media and speaker notes | Reveal.js                                       | previous/next, overview, keyboard and fullscreen                                 |
| `spreadsheet@1`  | Missing       | Workbook, worksheets, typed/formula cells, frozen rows/columns                | Univer Sheets                                   | sheets, cell selection, formula/value inspection and local editing when declared |
| `dashboard@1`    | Missing       | KPI metrics plus shared inline data and composed Vega-Lite views              | Vega-Lite composition and existing primitives   | shared filters, tooltips and responsive composed views                           |
| `timeline@1`     | Missing       | Point/range/background items and optional groups                              | vis-timeline                                    | pan, zoom, select and focus                                                      |
| `network@1`      | Missing       | Typed nodes/edges and declared layout                                         | Cytoscape.js                                    | pan, zoom, search, select and neighborhood focus                                 |
| `tree@1`         | Missing       | Flat parent-linked typed nodes                                                | shared Kobalte disclosure and search primitives | search and expand/collapse                                                       |
| `terminal@1`     | Missing       | Immutable ANSI transcript, command metadata and exit status                   | xterm.js                                        | search, copy, keyboard scrolling and accessible replay                           |
| `model-3d@1`     | Missing       | Canonical glTF/GLB attachment plus alt/poster metadata                        | Google `<model-viewer>`                         | orbit, zoom, animation and reset                                                 |
| `mcp-app@1`      | Existing      | Real server/tool/ui-resource-bound application                                | official MCP Apps bridge                        | full negotiated application protocol                                             |

The new types close real semantic gaps:

- A presentation is not one long Markdown document because sequence, current
  slide, speaker notes and presentation controls are part of its contract.
- A spreadsheet is not a table because worksheets, addressed cells, formulas,
  styles and cell selection are part of its contract.
- A dashboard is not one chart because shared filters, key metrics and
  coordinated views form one replayable analytical artifact.
- A timeline is not just a temporal chart because ranges, groups, viewport and
  item focus are its primary interaction model.
- A network is not a Mermaid diagram because typed nodes/edges, layout,
  selection and graph navigation are first-class.
- A tree is not a table because hierarchy and disclosure are its data and focus
  model.
- A terminal transcript is not plain code because ANSI rendering, terminal
  dimensions, exit status and terminal navigation are semantic.
- A 3D model is not an image/video because camera and animation controls operate
  on a canonical glTF scene.

## Strict payload contracts

### `presentation@1`

- `slides`: 1–200 strict slide objects with stable unique IDs, required title,
  Markdown body, optional speaker notes and optional canonical image.
- `aspectRatio`: `16:9`, `4:3` or `1:1`.
- No arbitrary HTML, script, remote theme, transition plugin or URL.

### `spreadsheet@1`

- `sheets`: 1–32 uniquely identified worksheets.
- Each sheet owns bounded row/column counts and a sparse list of uniquely
  addressed cells.
- Cells carry one literal value or one formula, optional computed display
  value, semantic number format and bounded declarative style.
- Formula evaluation is delegated to Univer's formula engine; the durable
  formula and supplied cached display value remain visible and auditable.
- The payload declares `editable`; edits are renderer-local and do not mutate
  the persisted artifact.

### `dashboard@1`

- `metrics`: bounded KPI label/value/delta records.
- `data`: one bounded inline row array.
- `views`: 1–24 strict objects with unique IDs, title, Vega-Lite spec and
  responsive span. Specs cannot contain external data URLs.
- `filters`: bounded enumerated field/value controls derived entirely from the
  inline rows.

### `timeline@1`

- Unique point/range/background items with ISO-8601 timestamps, plain content,
  optional group and bounded semantic color.
- Optional uniquely identified groups and initial start/end viewport.
- Display is read-only; create/edit/delete behaviors are not enabled.

### `network@1`

- Unique nodes with label, optional group and bounded scalar metadata.
- Unique edges reference existing source and target node IDs.
- Layout is one of Cytoscape's bundled deterministic layouts. No extension or
  remote style URL.

### `tree@1`

- 1–10,000 flat canonical nodes with globally unique IDs, optional `parentID`,
  label, optional description and scalar metadata. Parent references must
  exist and form an acyclic hierarchy; the Overlay derives nesting without a
  second durable tree shape.
- `defaultExpandedDepth` is bounded. Search reveals matching ancestors without
  rewriting the durable tree.

### `terminal@1`

- Bounded ANSI output, positive columns/rows, optional command, working
  directory and exit code.
- Renderer creates no pseudoterminal, shell, socket or process and accepts no
  keystrokes as command input.

### `model-3d@1`

- One canonical attachment whose MIME is `model/gltf-binary` or
  `model/gltf+json`, required alt text and optional canonical image poster.
- JSON glTF resources must be embedded `data:` URIs; external and relative
  buffer, image or extension resource references are rejected before
  persistence.
- Optional animation name, camera orbit and exposure are bounded declarative
  presentation inputs.
- No external texture, environment or model URL. The renderer resolves only
  publisher-validated project attachments.

## Exhaustive call-site disposition

| Owner                              | Disposition                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interactive-artifact/schema.ts`   | Add the eight strict schemas and include all native identities in the one publishable and durable discriminated unions.                                 |
| `interactive-artifact/persist.ts`  | Extend the one attachment traversal to presentation images and 3D model/poster attachments; keep exact canonical validation.                            |
| `interactive-artifact-guidance.ts` | Replace the twelve-type selection text with the complete nineteen-native-type selection and safety boundaries.                                          |
| `interactive-artifact.test.ts`     | Add one valid sample per new type and malformed identity/reference/formula/graph/timestamp/MIME cases; prove publisher replay and attachment ownership. |
| `InteractiveArtifactPart.tsx`      | Add exhaustive lazy dispatch for the eight new renderer identities and an explicit corrupt/unsupported fallback instead of silent empty output.         |
| New Overlay renderer components    | Use mature libraries and existing primitives; all local instances dispose on unmount and do not fetch hidden network content.                           |
| `messages.css`                     | Add renderer-region layout and focus styling only; keep existing design tokens and desktop message-card geometry.                                       |
| Overlay i18n                       | Add English and Chinese control, status and error labels for every new interaction.                                                                     |
| `package.json` / `bun.lock`        | Add only the selected mature renderer packages and their required styles.                                                                               |
| Overlay unit tests                 | Assert all twenty dispatch identities, mature-library ownership, cleanup, source restrictions and keyboard/accessibility contracts.                     |
| Browser fixture/test               | Serve all twenty message-owned payloads, exercise every new control and refresh replay, and capture current-goal light/dark regions.                    |
| OpenAPI/JavaScript SDK             | Regenerate from the strict backend schema using the existing generator.                                                                                 |
| `07-panel.md`                      | Replace the twelve-type architecture statement with the twenty-type catalog and native/application boundary.                                            |
| Spec indexes                       | Index this record as the current comprehensive catalog and run the historical-doc link test.                                                            |

## Implementation and verification sequence

1. Land this Recall, catalog and call-site inventory.
2. Add schemas, publisher guidance, attachment traversal and backend tests.
3. Regenerate OpenAPI and JavaScript SDK and prove the generated union contains
   exactly twenty identities.
4. Add dependencies and implement all eight Overlay renderers with exhaustive
   dispatch, i18n and styles.
5. Extend unit/source-contract and real message-flow browser fixtures.
6. Run isolated Vite plus Node Playwright in light and dark themes, inspect
   current-goal renderer regions, repair visual or interaction defects, and
   repeat until clean.
7. Run all focused and repository checks, inspect the complete diff and
   screenshots again, then stage exact files, commit and push through hooks.

## Progress

- [x] Current catalog, single-source owners and all call sites inventoried.
- [x] Mature protocol/library choices researched.
- [x] Detailed Recall, twenty-type matrix and implementation sequence recorded.
- [x] Eight strict payload schemas and backend persistence/tests.
- [x] Generated API/SDK.
- [x] Eight production Overlay renderers, i18n and styling.
- [x] Unit, integration and real message-flow coverage.
- [x] Isolated Vite Node/Playwright light/dark visual acceptance.
- [x] Full checks and second review.
- [x] Exact commit and git-cc push.

## Verification evidence

- The production schema, generated OpenAPI document, generated JavaScript SDK
  type union and Overlay dispatch each contain the same exact twenty renderer
  discriminants.
- `bun test packages/opencorvus/test/interactive-artifact/interactive-artifact.test.ts`
  passes six tests with 63 assertions, including all valid identities, strict
  malformed cases, tree cycles, canonical attachment ownership, 3D MIME,
  embedded-only glTF resources, persistence, route scope and corrupt rows.
- `bun test packages/overlay/test/message-interactive-artifact.test.ts` passes
  seven tests with 148 assertions across dispatch, lazy loading, mature
  renderer ownership, cleanup, theme integration, local-only execution and
  MCP App isolation.
- `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/inline-interactive-artifacts-browser.test.ts`
  passes against an isolated production Vite build in a visible browser. The
  run publishes and replays all twenty types, exercises slide pointer and
  keyboard navigation, spreadsheet cell/formula selection, dashboard filters,
  timeline selection and zoom, network search/fit, native tree disclosure,
  terminal search/copy, 3D load/reset, MCP App lifecycle and refresh replay.
- The same browser run captures light and dark region screenshots for all
  eight new native renderers. Direct inspection found and repaired an
  offscreen Dashboard sizing cycle, clipped Timeline fit, Network animation
  reset race, hidden spreadsheet formula bar, spreadsheet/terminal theme
  mismatch, Presentation dark background/control contrast, 3D mount timing,
  and fixture replay provenance.
- Root typecheck, Overlay typecheck, Vite production build, Overlay i18n,
  generated SDK build, API route inventory, rendered API documentation,
  focused publisher guidance, `git diff --check`, and the historical/product
  document suites pass. The monthly tracked-record assertion is rerun after
  the new record enters the exact Git index.
