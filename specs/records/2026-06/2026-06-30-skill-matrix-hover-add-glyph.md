# Skill Matrix Hover Add Glyph

Date: 2026-06-30
Status: implemented, overlay package copy blocked by live process

## User Request

The Agent Skill Mount Matrix currently shows a persistent plus glyph in every
unmounted/available cell. The visible grid is too noisy. Available cells should
not display the plus by default; the add affordance should appear on hover or
keyboard focus.

Original wording: "没有启用的skill不要持久显示加号，hover再显示，这样太晃眼睛了"

## Acceptance

- Available matrix cells keep the existing mount click, keyboard, title, and
  aria-label behavior.
- The plus glyph for `data-state="available"` is visually hidden at rest.
- The same plus glyph becomes visible when the available cell is hovered,
  focused, or has the existing active combo marker.
- Mounted check and conflict glyphs remain persistently visible.
- `/skill/mounts` remains the only matrix projection. No route, store, mount,
  unmount, import, or refresh behavior changes.
- Browser coverage asserts the default hidden add glyph and the hover/focus
  visible add glyph, and screenshots are reviewed after the test run.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` user-provided project rules | No fallback, no double source, no gate, inspect landed plans before edits, test every code change, visually verify frontend work with screenshots. |
| `specs/README.md` | New dated records live in `specs/records/2026-06/` and must update indexes plus docs health tests. |
| `specs/records/2026-06/README.md` | Current-day records are indexed here. |
| `specs/records/2026-06/2026-06-23-agent-skill-mount-matrix.md` | The matrix is driven by `/skill/mounts`; unmounted pool rows must stay visible; keyboard-accessible mount/unmount buttons use the same mutation path as drag/drop. |
| `specs/records/2026-06/2026-06-26-skill-settings-matrix-density.md` | Settings and compact toolbar use the same component contract; hover/focus marks exactly one skill, one agent, and one cell as the active configuration pair. |
| `specs/records/2026-06/2026-06-28-overlay-global-gui-responsiveness-benchmark.md` | Hidden/visible projection and matrix fixture behavior must stay single-source; screenshots are part of acceptance. |
| `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Cells already use `role="button"`, `aria-label`, `title`, `tabIndex`, pointer/focus active pair tracking, and the shared mount/unmount handlers. |
| `packages/overlay/src/styles/surfaces/settings.css` | `.agent-skill-grid-cell__glyph` and its state selectors are the only visual owner of available/mounted/conflict/unavailable glyphs. |
| `packages/overlay/test/browser/skill-mount-matrix-browser.test.ts` | Existing browser test already exercises compact and settings matrices, hover active-combo behavior, click-to-mount, and screenshot capture. |

## Whole-Repository Search

| Search | Result |
| --- | --- |
| `rg -n 'Agent Skill Mount Matrix|Skill Mount|SKILL POOL|Mounted|Unmounted|unmounted|skill pool|mount matrix' -S .` | Located the production matrix docs, overlay component/style/test files, SDK schemas, and backend route/tests. |
| `rg -n 'skill.*mount|mount.*skill|AgentSkill|SkillMount|skill pool|skillPool|unmounted|Mounted' specs packages -S` | Confirmed `/skill/mounts`, `SkillMount`, prompt/tool, and overlay matrix are broader single-source surfaces; this visual change does not need backend changes. |
| `rg -n 'agent-skill-grid-cell|data-state="available"|agent-skill-grid-cell__glyph|Mount skill:|skill\.mount\.add|matrixPairActive|activateMatrixPair|cellState\(\)' packages/overlay/src packages/overlay/test specs/records/2026-06 -S` | Found the cell render path in `SkillMarketPanel.tsx`, glyph CSS in `settings.css`, and browser assertions in `skill-mount-matrix-browser.test.ts`. |
| `rg -n 'agent-skill-matrix|agent-skill-grid-cell|agent-skill-grid-skill|agent-skill-grid-agent|skill-mount-matrix' packages/overlay/src/styles packages/overlay/src/components packages/overlay/test/browser/skill-mount-matrix-browser.test.ts specs/records/2026-06 -S` | Confirmed there is no second renderer for these glyphs; activity CSS only scopes panel layout, not cell state glyphs. |
| `rg -n 'skill.mount.matrix|skill.mount.add|skill.mount.remove|skill.mount.unmounted|agent-skill-grid-cell__glyph|aria-label=\{cellLabel\(\)\}' packages/overlay/src packages/overlay/test -S` | Confirmed labels remain in i18n and cell aria/title generation; no copy change is needed. |
| `git diff -- packages/overlay/src/components/settings/SkillMarketPanel.tsx packages/overlay/src/styles/surfaces/settings.css packages/overlay/test/browser/skill-mount-matrix-browser.test.ts` | Empty before this task; these target files have no pre-existing user edits. |

## Independent Review

A read-only explorer sub-agent was started with instructions to inspect the same
files and specs, not edit files, and not delegate. It returned the following
feedback:

- The minimum production change is CSS-only near
  `.agent-skill-grid-cell__glyph` and `[data-state="available"]`.
- Do not change `SkillMarketPanel.tsx` cell state, aria labels, roving tab
  index, mutation handlers, `/skill/mounts`, backend resolver, OpenAPI, SDK, or
  skill prompt/tool binding.
- Keep mounted, conflict, and unavailable glyphs persistently visible.
- Add browser assertions for default hidden available glyphs, hover visibility,
  keyboard focus visibility, preserved aria labels/click target size, and
  mounted/conflict glyph visibility.
- If the target were strictly the Settings dialog, the selector could be limited
  to `data-compact="false"`. The current user screenshot and wording target the
  visible matrix noise generally, so this implementation intentionally applies
  the same hover-only available glyph rule to compact and settings matrices
  while preserving their shared component contract.

## Root Cause

The matrix uses one generic glyph span for all cell states. `available` currently
draws the plus through `::before` and `::after` at full opacity in every unset
cell. Dense matrices therefore display hundreds of identical add markers even
though the user's immediate target is normally the hovered or focused cell.

## Design

Keep the current DOM and event model. Do not add local state or a second button.

Change only the CSS visibility of the available glyph:

- Set `opacity: 0` for `.agent-skill-grid-cell[data-state="available"] .agent-skill-grid-cell__glyph`.
- Restore `opacity: 1` when the available cell is hovered, focus-visible/focused,
  or `data-active-combo="true"`.
- Leave `mounted`, `conflict`, and `unavailable` glyph visibility unchanged.

Extend the existing browser test to read computed opacity for available,
mounted, and conflict glyphs before hover and after hover/focus. The same test
already saves compact, settings, and hover screenshots.

## Verification Plan

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`
- `bun run build:overlay`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Review generated screenshots:
  - `.scratch/skill-mount-matrix-panel.png`
  - `.scratch/skill-mount-matrix-settings-panel.png`
  - `.scratch/skill-settings-dialog-hover.png`

## Verification Result

Passed:

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/overlay/test/settings-primitives.test.ts packages/overlay/test/settings-status-labels.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`

Visual review:

- `.scratch/skill-mount-matrix-panel.png` shows the compact matrix without
  persistent available plus glyphs while mounted/conflict states remain visible.
- `.scratch/skill-mount-matrix-settings-panel.png` shows the settings matrix
  with empty available cells at rest.
- `.scratch/skill-settings-dialog-hover.png` shows the focused available cell
  rendering the plus glyph and the hovered conflict cell retaining its warning
  glyph.

Blocked:

- `bun run build:overlay` completed i18n, Vite, SDK generation, overlay server
  build, Tauri beforeBuildCommand, and release compile, then failed at the final
  binary copy because Windows returned `EACCES` while removing
  `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe`.
- Read-only evidence showed the target exe is not read-only (`Attributes:
  Archive`) and PID 46904 `opencorvus-overlay` is running from the same dist
  path. Rule 39 forbids closing or restarting that live overlay without explicit
  user confirmation, so the final copy step remains blocked until the user allows
  stopping that process or closes it manually.
