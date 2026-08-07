# Interactive Artifact Visual System

## Recall

| Item                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | 当前 Interactive Artifacts 渲染观感差；解释根因、调查业界做法后，用户要求开始实施。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Acceptance criteria        | 保留 Session/Message-owned artifact 单一来源和二十种 renderer 身份；建立一个共享作品外壳和一个共享视觉主题编译面；聊天内仍可直接使用，且同一个 renderer DOM 能进入沉浸式作品视图；优先根治 Dashboard、Presentation、Chart、Network、Timeline 的视觉层级；真实 Node/Playwright 隔离 Vite 页面覆盖交互、桌面 Light/Dark 目标区域截图并亲自复核；没有临时 iframe、客户端 payload、副本 renderer 或右侧 Browser Preview 冒充。                                                                                                                                                                                                         |
| Hard constraints           | 保留共享工作区全部并行改动；不 stash、reset、restore、广泛暂存或创建 worktree；不干预当前运行中的 OpenCorvus/Overlay；Playwright 只由 Node 启动；不新增 fallback、兼容、gate、状态机或 renderer 推断；使用成熟平台和现有 UI primitives；只做桌面端视觉交付；提交前缀为 `dsw-33987`，通过正常 hooks 推送 `legacy-remote/v0.0.21beta`。                                                                                                                                                                                                                                                                                                    |
| Existing records read      | `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-19-inline-interactive-artifact-protocol.md`; `specs/records/2026-07/2026-07-23-interactive-artifact-renderer-expansion.md`; `specs/records/2026-07/2026-07-25-interactive-artifact-comprehensive-catalog.md`; `specs/records/2026-07/2026-07-25-mcp-apps-production-host.md`.                                                                                                                                                                                                                                                                             |
| Industry evidence read     | Anthropic Artifacts product/help documentation; OpenAI Canvas help; Observable Framework themes and dashboard layout; Vega-Lite configuration and responsive sizing; Gradio theme architecture. The reusable mechanisms are dedicated work surfaces, versioned single-source artifacts, semantic composition, centralized themes, responsive containers, and direct visual iteration. Brand tokens and product-specific visuals are not parity targets.                                                                                                                                                                            |
| Whole-repository grep      | `rg` covered `ArtifactFrame`, `InteractiveArtifactPart`, all twenty renderer identities, `msg-artifact*`, schema/persistence/tool/prompt owners, generated SDK copies, browser/unit tests, current architecture and July records. Production payload schema remains unique in `packages/opencorvus/src/interactive-artifact/schema.ts`; the only writer remains `persist.ts`; the only display dispatch remains `InteractiveArtifactPart.tsx`; all native Overlay renderers use `ArtifactFrame`; renderer CSS remains centralized in `messages.css`; the real visual suite remains `inline-interactive-artifacts-browser.test.ts`. |
| Independent agent feedback | None. The user did not request delegated agents, and current collaboration rules prohibit unsolicited delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Shared worktree baseline   | Branch `v0.0.21beta`, baseline `4ca7e81b2f44b8455d6410b5daf2e8068ab2948b`. Existing unrelated Expert Squad, chat identity, storage and specification edits remain untouched; overlapping spec indexes will receive only exact additive lines.                                                                                                                                                                                                                                                                                                                                                                                      |

## Root Cause

The artifact protocol and mature renderer selection solve security, durability,
interaction and replay, but the presentation layer stops at a generic bordered
card. Every renderer inherits the same engineering-style title row, while
Vega-Lite, Reveal.js, Cytoscape.js, vis-timeline and Univer retain unrelated
default visual languages. The payload grammar describes data and behavior, not
arbitrary styling, which is correct; however, the Overlay has no canonical
design compiler that turns those semantics into one OpenCorvus visual system.

The existing visual acceptance produced real screenshots but primarily asserted
renderer readiness, dimensions and controls. It did not encode hierarchy,
default composition, density, legibility, palette or visual continuity. The
current screenshots therefore prove that the product works while also showing
that it looks like a catalog of embedded developer widgets.

## Single-Source Design

### Shared artifact work surface

`ArtifactFrame` remains the only native artifact shell. It owns a compact
conversation presentation and an immersive presentation of the exact same DOM.
Immersive mode uses the browser Fullscreen API on the existing section, so
renderer state and the canonical payload are not duplicated. The existing
shared Button primitive provides the action. MCP Apps retain their own
protocol-defined display modes and opt out of this native action.

### Shared visual theme compiler

One Overlay module reads the applied OpenCorvus CSS custom properties and
materializes semantic artifact colors, typography and Vega-Lite configuration.
Chart and Dashboard consume the same Vega configuration. Network and Timeline
consume the same semantic palette and surface values through their mature
library styling APIs. Renderer payloads cannot inject a second product theme;
data-encoded colors remain permitted only where already part of the declared
artifact semantics.

### Renderer composition

- `Chart`: one quiet plot surface, shared number/axis/legend/title treatment,
  restrained grid and canonical categorical palette.
- `Dashboard`: clear metric hierarchy, one filter rail, visually grouped views
  and no nested generic-card repetition.
- `Presentation`: an authored slide canvas with a legible measure, strong type
  scale and calm background composition instead of the Reveal.js default look.
- `Network`: group-aware semantic colors, differentiated node hierarchy,
  restrained edges and readable labels instead of identical blue circles.
- `Timeline`: shared palette, rounded items, quieter grid and deliberate
  selected/detail treatment.

All other renderers immediately inherit the improved shared work surface and
remain on their mature libraries. They are not given parallel local shells.

## Exhaustive Call-Site Disposition

| Call site                                                                                                                                                                                                                                                                                               | Disposition                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/interactive-artifact/{schema,persist}.ts`                                                                                                                                                                                                                                      | Preserve. Content identity, validation, attachment ownership and writer remain unchanged.                                                                                                                                                   |
| `packages/opencorvus/src/tool/publish-interactive-artifact.ts` and `packages/opencorvus/src/prompt/fragments/interactive-artifact-guidance.ts`                                                                                                                                                          | Preserve renderer selection and safety contract. Visual quality is deterministic Overlay presentation, not model-authored arbitrary CSS.                                                                                                    |
| `packages/opencorvus/src/session/{message,processor}.ts`, `packages/opencorvus/src/tool/tool.ts`                                                                                                                                                                                                        | Preserve the single message-part lifecycle.                                                                                                                                                                                                 |
| `packages/overlay/src/components/InteractiveArtifactPart.tsx`                                                                                                                                                                                                                                           | Preserve the only twenty-renderer dispatch and lazy-loading boundary.                                                                                                                                                                       |
| `packages/overlay/src/components/interactive-artifact/ArtifactFrame.tsx`                                                                                                                                                                                                                                | Replace the generic engineering card with the shared compact/immersive work surface and one native fullscreen action.                                                                                                                       |
| `DocumentArtifact.tsx`, `TableArtifact.tsx`, `CandlestickArtifact.tsx`, `CodeArtifact.tsx`, `DiffArtifact.tsx`, `MediaArtifact.tsx`, `FilePreviewArtifact.tsx`, `MapArtifact.tsx`, `NotebookArtifact.tsx`, `SpreadsheetArtifact.tsx`, `TreeArtifact.tsx`, `TerminalArtifact.tsx`, `Model3dArtifact.tsx` | Keep their single renderer implementations; inherit the new shared shell without parallel wrappers.                                                                                                                                         |
| `McpAppArtifact.tsx`                                                                                                                                                                                                                                                                                    | Keep official MCP App display-mode ownership; opt out of the native fullscreen action to avoid duplicate controls.                                                                                                                          |
| `ChartArtifact.tsx`, `DashboardArtifact.tsx`                                                                                                                                                                                                                                                            | Replace duplicated ad hoc Vega config with the shared visual theme compiler.                                                                                                                                                                |
| `PresentationArtifact.tsx`                                                                                                                                                                                                                                                                              | Remove its duplicate fullscreen control and consume the shared work surface; keep Reveal.js navigation and lifecycle.                                                                                                                       |
| `NetworkArtifact.tsx`, `TimelineArtifact.tsx`                                                                                                                                                                                                                                                           | Apply shared semantic theme through Cytoscape.js and vis-timeline APIs; preserve existing interactions.                                                                                                                                     |
| `packages/overlay/src/components/interactive-artifact/theme-color.ts`                                                                                                                                                                                                                                   | Replace the single-token helper with the one artifact visual theme materializer; no second token source.                                                                                                                                    |
| `packages/overlay/src/styles/surfaces/messages.css`                                                                                                                                                                                                                                                     | Define the shared artifact shell and the five priority renderer compositions in the existing single surface stylesheet.                                                                                                                     |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json`                                                                                                                                                                                                                                                          | Add localized immersive work-surface action labels.                                                                                                                                                                                         |
| `packages/overlay/test/message-interactive-artifact.test.ts` and focused UI source tests                                                                                                                                                                                                                | Cover the single theme owner, shared action, MCP App opt-out and absence of duplicated renderer dispatch.                                                                                                                                   |
| `packages/overlay/test/browser/inline-interactive-artifacts-browser.test.ts`                                                                                                                                                                                                                            | Exercise the native work surface, keep all renderer interactions, capture current-goal region screenshots for the five priority renderers in Light/Dark, and assert meaningful composition geometry rather than screenshot existence alone. |
| `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/**`                                                                                                                                                                                                                                               | Preserve. No backend schema or API change.                                                                                                                                                                                                  |
| `specs/current/architecture/07-panel.md`                                                                                                                                                                                                                                                                | Record the shared visual compiler and exact-DOM immersive work surface.                                                                                                                                                                     |
| `specs/README.md`, `specs/records/2026-07/README.md`                                                                                                                                                                                                                                                    | Add this record to the existing single indexes without overwriting concurrent additions.                                                                                                                                                    |

## Verification

1. Focused Overlay artifact and theme tests.
2. Overlay TypeScript typecheck and production Vite build.
3. Node-launched real browser suite against an isolated fixture; verify all
   existing interactions plus Fullscreen API entry/exit.
4. Inspect desktop Light/Dark screenshots for Dashboard, Presentation, Chart,
   Network and Timeline; correct hierarchy, density, collisions and default
   viewport defects, then rerun.
5. Run historical-document links and applicable document-health tests,
   `git diff --check`, and a second code/visual review.
6. Recheck `HEAD`, worktree and exact staged paths; commit only task-owned
   files with `dsw-33987`, then push through normal hooks to
   `legacy-remote/v0.0.21beta`.

## Progress

- [x] Existing architecture, historical records, screenshots and all call-site
      categories inspected.
- [x] Industry mechanisms mapped without copying brand visuals.
- [x] Shared work surface and visual theme compiler.
- [x] Priority renderer visual composition.
- [x] Focused and real browser tests.
- [x] Second visual/code review.
- [x] Exact task-owned files isolated, validated and committed for normal
      legacy remote delivery.

## Validation Evidence

- `bun test packages/transport-protocol/test/contract.test.ts packages/opencorvus/test/tool/panel.test.ts packages/opencorvus/test/server/work-ledger-routes.test.ts packages/opencorvus/test/agent/primary-assistant-registry.test.ts packages/overlay/test/mission-service-actions.test.ts packages/overlay/test/conversation-handoff.test.ts packages/overlay/test/message-interactive-artifact.test.ts packages/overlay/test/theme-host-scope.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`
  passes with 111 tests and zero failures.
- `bun run --cwd packages/opencorvus typecheck`,
  `bun run --cwd packages/overlay typecheck`, `bun run api:routes-check`,
  `bun run docs:check`, and `bun run version:check` pass.
- The Node-launched headed browser catalog test passes for Presentation,
  Spreadsheet, Dashboard, Timeline, Network, Tree, Terminal, and Model 3D,
  including Fullscreen API entry and exit on the same mounted Dashboard.
- The inspected desktop region screenshots are:
  `packages/overlay/.scratch/overlay-inline-dashboard-light.png`,
  `packages/overlay/.scratch/overlay-inline-dashboard-dark.png`,
  `packages/overlay/.scratch/overlay-inline-presentation-light.png`,
  `packages/overlay/.scratch/overlay-inline-presentation-dark.png`,
  `packages/overlay/.scratch/overlay-inline-network-light.png`,
  `packages/overlay/.scratch/overlay-inline-network-dark.png`,
  `packages/overlay/.scratch/overlay-inline-timeline-light.png`,
  `packages/overlay/.scratch/overlay-inline-timeline-dark.png`, and
  `packages/overlay/.scratch/overlay-inline-dashboard-workspace-light.png`.
  The review confirmed readable hierarchy, restrained density, stable library
  controls, semantic contrast in both themes, and no duplicate titlebar or
  renderer.
- `node test/browser-runner.mjs test/browser/chat-work-inline-handoff-browser.test.ts`
  passes and records `.scratch/chat-work-inline-handoff/work-active-in-place.png`,
  proving exact Work hydration precedes Chat archival in the visible UI.
