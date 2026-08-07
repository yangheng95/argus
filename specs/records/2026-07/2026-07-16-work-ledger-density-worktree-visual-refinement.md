# Work Ledger Density And Worktree Visual Refinement

## Recall

| Item | Detail |
| --- | --- |
| User request | Move the Mission task count behind the Mission icon; align non-essential icon and text sizes with the left-sidebar menu; prevent text descenders from being clipped at some display scales; redesign the Worktree list and actions using the supplied Codex branch-picker reference. |
| Acceptance criteria | Mission rows render icon, count/disclosure, then title; Work Ledger entity glyphs and primary row text share the sidebar control scale; row text retains visible descenders across desktop scale factors; the runtime Worktree section uses a quiet branch-list hierarchy with a branch/worktree glyph, full-row target, restrained header actions, and a separate destructive action; focused source tests, TypeScript, i18n, Node-launched browser interaction tests, and manually reviewed desktop screenshots pass. |
| Hard constraints | Reuse the existing Solid `WorkLedgerRowView`, `TaskDirBar`, shared `Icon`/`Button`, Kobalte Popover, and `/project/current/worktrees` services; no fallback, duplicate control surface, local fake data source, new worktree, mobile/tablet scope, or user-process restart/refresh; Playwright is launched with Node. |
| Supplied evidence | Images show the current count before the Mission icon, inconsistent glyph/text sizes in the Projects tree, descender clipping at a narrow/scaled layout, and the desired Codex branch-picker rhythm with branch glyphs, quiet rows, a selected mark, and a separated footer action. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/07-panel.md`; July records for Mission disclosure, left-Dock density, Work Ledger icon/popup unification, Codex sidebar parity, and Worktree layout; `WorkLedger.tsx`; `TaskDirBar.tsx`; `work-ledger.css`; `conversation.css`; shared `Icon`, `Button`, Work Ledger, and runtime browser/source tests. |
| Whole-repository search | `rg` covered every `mission-task-disclosure`, `work-row-kind-mark`, `work-row-head`, `project-worktree-*`, `loadProjectWorktrees`, `deleteProjectWorktree(s)`, and relevant screenshot/test call site. `WorkLedgerRowView` remains the only disclosure owner; `work-ledger.css` remains its only layout owner; `ProjectRuntimeStatusPanel` remains the only Worktree UI/data owner; `task-cwd-row-layout.test.ts`, `work-ledger-consolidation.test.ts`, `titlebar-toolbar-toggle-browser.test.ts`, and `task-dirbar-keyboard.test.ts` are the focused regression surfaces. |
| Independent agent feedback | None. The user did not request sub-agents and the affected code is one tightly coupled Overlay surface. |
| Git baseline | The current branch was clean and synchronized with git-cc before edits. The first pre-push exposed stale local SDK build output; rebuilding the existing SDK output restored the generated type exports, the full hook passed, and the generated tracked OpenAPI difference was inspected and precisely restored because the pre-task worktree was clean. |

## Root cause

The count/disclosure and Mission icon are separate grid cells whose DOM order currently places the count first. Work Ledger sizing is also fragmented across literal `13px`, `14px`, meta/small tokens, and a fixed `22px` line-height inside shorter scaled rows. That combination creates both visual hierarchy drift and glyph clipping when WebView scale rounds the fixed block geometry. The Worktree section uses the correct service lifecycle but visually treats refresh/delete-all as prominent labeled buttons and renders each row without an entity glyph, making the hierarchy look like generic form controls rather than a branch/worktree picker.

## Implementation plan

1. Reorder the existing Mission disclosure after `WorkLedgerKindMark` and update the conditional grid without changing its accessible button, count source, or expansion behavior.
2. Introduce sidebar-owned Work Ledger icon/text/line-box tokens in `work-ledger.css`, project them to row glyphs, primary labels, metadata, timestamps, and disclosures, and replace clipping-prone fixed text line-height with a centered minimum line box.
3. Recompose the existing Worktree section with shared primitives: compact icon-only header actions, a leading Git-worktree glyph per row, the name as the full remaining target, and the existing delete action on the trailing rail. Keep the same loader, confirmation, ownership, failure, and board-refresh path.
4. Update focused source and Node-launched browser regressions, build an isolated desktop fixture, inspect screenshots at normal and scaled/narrow desktop sizes, correct visual issues, and rerun.
5. Run documentation health, formatting, diff review, commit with the `dsw-33987` prefix, and push the current branch to git-cc.

## Verification

- Focused Work Ledger and runtime source tests.
- `bun run --cwd packages/overlay typecheck` and `bun run --cwd packages/overlay check:i18n`.
- Node-launched browser tests for Mission geometry/interaction and Worktree popover behavior, including fresh task-scoped screenshots.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` plus relevant document-health checks.
- `git diff --check`, final screenshot inspection, and a second code/diff review before commit and push.

## Result

- Mission rows now render the entity icon before the task-count disclosure, followed by the title. The disclosure icon, row entity icon, primary label, metadata, and timestamp use the same 14px icon / 13px text rhythm as the left navigation.
- Work Ledger labels use a shared tight line box whose computed height remains greater than the font size; fresh browser evidence shows descenders such as `g` unobscured at the desktop fixture scale.
- The Worktree section keeps its existing service and confirmation lifecycle but now uses compact icon-only header actions, a 14px worktree glyph, quiet full-row targets, and a separate trailing remove action. The fresh `task-dirbar-runtime-status-panel-merged.png` screenshot was manually reviewed after the final icon override repair.
- Focused source tests passed (21/21), the complete Worktree browser suite passed (15/15), and the titlebar/Work Ledger browser suite passed (2/2). Overlay TypeScript, historical-link tests (21/21), product documentation checks, and `git diff --check` passed. The repository-wide i18n check currently reports five unused `titlebar.*_hint` keys introduced by a separate concurrent titlebar change; this task neither introduced nor owns those locale entries.

## Follow-up correction: Mission row composition and entity glyphs

### Recall

| Item | Detail |
| --- | --- |
| User request | Correct the crowded Work Ledger layout highlighted in `C:/Users/10132/AppData/Local/Temp/codex-clipboard-90943b8f-cb9f-4449-af78-efb261990606.png` and improve the Task, Mission, and Chat icons because the current set is visually unsatisfactory. |
| Acceptance criteria | A Mission row shows its task total only once; the existing disclosure remains immediately after the Mission icon but reads as quiet inline tree chrome without a filled rounded box; title, status, and time retain their canonical owners and no longer compete with duplicate `2 tasks` copy. Task, Mission, and Chat keep distinct semantic aliases but use simpler sidebar-consistent Lucide glyphs. Child Mission tasks, selection, disclosure, actions, tooltips, and data behavior remain unchanged. |
| Hard constraints | Reuse `WorkLedgerRowView`, `WorkLedgerKindMark`, shared `Icon`/`Button`, the current row grid, and existing Work Ledger browser fixture; no duplicate row renderer, local view state, alternate count source, handwritten SVG, fallback icon, mobile/tablet scope, or running-process restart; preserve unrelated dirty-worktree changes. |
| Sources read | `AGENTS.md`; Browser control skill; this record; `2026-07-16-overlay-worktree-shortcuts-chat-files-and-button-system.md`; `WorkLedger.tsx`; `Icon.tsx`; `work-ledger.css`; `focused-popup-surface.test.ts`; `work-ledger-consolidation.test.ts`; `titlebar-toolbar-toggle-browser.test.ts`; current icon/layout commit history. |
| Whole-repository search | `rg` enumerated every `WorkLedgerKindMark`, `kindIcon`, `work-mission`, `work-task`, `work-chat`, `mission-task-disclosure`, `work-row-inline-meta`, and Work Ledger geometry assertion. `Icon.tsx` is the single glyph mapping owner; `WorkLedger.tsx` and `ArchivePanel.tsx` consume the three semantic aliases; `WorkLedgerRowView` is the only live Mission count/disclosure renderer; `work-ledger.css` is the only layout/chrome owner. Focused regressions live in `focused-popup-surface.test.ts`, `work-ledger-consolidation.test.ts`, and `titlebar-toolbar-toggle-browser.test.ts`. |
| Independent agent feedback | None. The user did not request sub-agents and active collaboration policy forbids unrequested delegation. |
| Git baseline | The current branch remains at pushed git-cc commit `9f670edb9`; task-local composer/ChatBubble/spec edits and unrelated pre-existing dirty files are preserved separately. |

### Root cause

The Mission task total is rendered from the same `taskStats.total` twice: once
inside the disclosure button and again through `inlineMeta()` as localized
`2 tasks`. At the narrow sidebar width, those two copies consume the title lane
before the status and timestamp rail, producing the crowded sequence visible in
the supplied screenshot. The disclosure also paints a rounded hover/expanded
fill even though it is part of a tree row, which makes the count/chevron pair
look like a separate control block.

The three `work-*` aliases were recently remapped to visually heavy glyphs:
`FlagTriangleRight`, `CircleCheckBig`, and `MessageCircleMore`. The Task glyph in
particular reads as lifecycle completion rather than entity type. The shared
registry already contains quieter, sidebar-consistent `Workflow`, `ListTodo`,
and `MessageSquare` glyphs, so no new icon system is needed.

### Call-site disposition and plan

| Surface | Decision |
| --- | --- |
| `Icon.tsx` semantic aliases | Remap `work-mission` to `Workflow`, `work-task` to `ListTodo`, and `work-chat` to `MessageSquare`; remove only the superseded unused Lucide imports. |
| `WorkLedger.tsx` `inlineMeta` | Stop projecting a second Mission task-count label; keep child Task ownership text unchanged. |
| Mission disclosure | Keep the canonical task total, click handler, expanded state, tooltip, and icon-after-Mission order; remove filled/rounded container chrome and use color-only hover/focus feedback. |
| Archive panel | Keep consuming the same `work-*` aliases so archived and live entity identity remains consistent. |
| Tests | Replace heavy-glyph assertions, require one Mission total source, require borderless disclosure chrome, and update the existing real browser geometry/style assertions plus screenshot. |

1. Add failing focused assertions for the simplified glyph mapping, single visible Mission total, and unboxed disclosure.
2. Modify the three existing canonical owners only.
3. Run focused Work Ledger tests, Overlay typecheck/build, and documentation checks.
4. Run the Node-launched Work Ledger browser fixture, inspect the refreshed desktop screenshot, and correct any remaining hierarchy or alignment defect.

### Follow-up result

- Mission task totals now have one visible owner: the disclosure immediately
  after the Mission glyph. The duplicate localized inline count and its two
  now-unused locale keys were removed; child Task ownership copy remains.
- `work-mission`, `work-task`, and `work-chat` retain stable semantic aliases
  while projecting the quieter `Workflow`, `ListTodo`, and `MessageSquare`
  glyphs. The disclosure uses color-only interaction feedback without a filled
  rounded control box.
- Focused Work Ledger tests passed and the real Node-launched fixture passed all
  target Mission geometry/style assertions before reaching an unrelated
  pre-existing pin-icon-size assertion. The refreshed Work Ledger region
  screenshot was manually inspected: hierarchy, one-count layout, title lane,
  Task/Mission/Chat distinction, and timestamps remain readable at the target
  desktop width.
