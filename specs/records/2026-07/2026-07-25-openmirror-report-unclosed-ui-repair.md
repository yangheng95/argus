# OpenMirror comparison report unclosed UI repair

## Recall

### User request

- Analyze `Download/OpenCorvus-OpenMirror-问题修复对比报告-HTML-20260725-014243`, identify resolved and unresolved items, and think carefully about a real solution.
- After confirming that the analysis was useful, start repairing the unclosed items without changing the task's meaning.

### Acceptance criteria

- The Environment information header `+` has a visible, keyboard-accessible action.
- The action uses the existing canonical tool catalog and Right Dock add menu; it does not invent a second environment store, editor, alias, or fallback.
- The error-reason affordance keeps exact clipboard copy behavior while replacing the viewport-clipped native title surface with one structured, viewport-constrained tooltip.
- `Commit or push` exposes its Dialog and loading copy before a deliberately delayed commit-message stream completes.
- Running Agent cards remain expanded, terminal cards collapse, and their loading/status presentation is verified through the real Overlay browser fixture.
- Browser Preview remains task-scoped. A task with persisted preview evidence is openable in the client; a historical task without a target must continue to report missing instead of borrowing another task's page.
- Real Vite/Overlay browser screenshots are inspected for the changed surfaces.

### Hard constraints

- Preserve all unrelated staged, unstaged, and untracked work in the shared worktree.
- Do not restart, close, refresh, or otherwise interfere with the user's running OpenCorvus or Overlay process.
- Use Node, not Bun, to launch Playwright browser acceptance.
- Do not add a compatibility path, fallback, host-side workflow gate, synthetic message, or second source.
- Keep the single desktop titlebar and the task-scoped Browser Preview ownership unchanged.

### Read material

- The comparison report and its screenshots.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-23-environment-summary-git-actions-and-resource-groups.md`.
- `specs/records/2026-07/2026-07-23-environment-heading-geometry-and-mission-presentation.md`.
- `specs/records/2026-07/2026-07-24-completed-message-card-auto-collapse.md`.
- `specs/records/2026-07/2026-07-24-conversation-error-status-icon.md`.
- The current App, Environment panel, Right Dock, Card header, Tooltip, Browser Preview, card-fold, and browser acceptance implementations.

### Full-repository search

| Contract / call surface                                           | Result and disposition                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectRuntimeStatusPanelProps` / `ProjectRuntimeToolbarActions` | One implementation in `TaskDirBar.tsx`, passed through `App.tsx`, with one root caller in `main.tsx`; extend this chain with the canonical add-menu callback.                                       |
| `rightDockAddMenuOpen` / `RightDock` add menu                     | One signal owner in `main.tsx` and one catalog renderer in `RightDock.tsx`; reuse it unchanged.                                                                                                     |
| `project-runtime-panel-trailing-control`                          | One decorative span in `TaskDirBar.tsx` and one geometry recipe in `conversation.css`; replace the span with the shared Button while retaining geometry.                                            |
| `card-error-reason` / `card.error_reason_title`                   | One production owner in `CardHeaderChrome.tsx`; replace only its native long title with the shared Tooltip trigger/content.                                                                         |
| `.oc-tooltip`                                                     | One shared wrapper in `components/ui/Tooltip.tsx` and one primitive recipe in `styles/primitives/tooltip.css`; add wrapping and border-box guarantees at the shared recipe.                         |
| `streamVcsCommitMessage` / `toggleGitAction`                      | One service owner and one Environment consumer. Dialog state is set before stream creation, so acceptance must prove first paint under delayed streaming rather than add speculative product state. |
| task Browser Preview                                              | One task route/service family, persisted target owner, and existing browser evidence suite. Preserve strict task ownership; rerun targeted route and real browser evidence tests.                   |
| card expansion defaults                                           | One `defaultExpandedForNode` projection consumed by `ChatBubble`; existing focused store/browser tests cover running-to-terminal behavior and will be rerun.                                        |

### Independent agent feedback

- None. The current execution policy does not authorize delegated agents for this request; the primary agent owns implementation and secondary review.

## Causal analysis

### Environment `+`

The visible `+` is a decorative `aria-hidden` span, so clicks cannot produce any result. The deeper issue is not a missing editor implementation: the product has no separate local-environment editor model. Environment Information aggregates task-scoped workspace/tool facts, while Right Dock already owns the strict add-tool catalog and menu. The correct repair is to make the header affordance invoke that canonical menu.

### Error tooltip

The error icon uses a native `title` containing an unbounded exception string. Native WebView tooltip geometry is outside the application layout contract and was observed clipping at the right edge. The shared Kobalte Tooltip already owns placement, flip, slide, portal, and visual surface behavior; the error action must use it, with explicit viewport fitting and long-token wrapping.

### Commit dialog delay

Current code sets `gitActionOpen` before starting the streaming request, and the stream service is fire-and-forget. The report's four-to-five-second blank interval is therefore not proven to originate in current source. A real browser fixture will hold the stream response while measuring the click-to-visible Dialog interval and checking the generating placeholder. A passing result closes this as stale/runtime-build evidence; a failing result requires product repair before acceptance.

### Agent and Dashboard verification gaps

These are evidence gaps, not established generic product defects. Running-card expansion has one existing lifecycle projection and Browser Preview has one task-scoped persisted target path. Verification must exercise those real contracts. It must not attach another task's preview to the historical Dashboard task or fake a running state in the UI.

## Implementation

1. Thread `onOpenRightDockAddMenu` from `main.tsx` through `App.tsx` into `ProjectRuntimeStatusPanel`.
2. Replace the decorative Environment `+` span with a shared icon Button that closes Environment and opens the canonical Right Dock add menu.
3. Replace the error action's long native title with a shared Kobalte Tooltip using `top-end`, `fitViewport`, and wrapped content.
4. Extend source-contract tests and real browser acceptance for the add menu, clipped-error geometry/copy, and delayed commit-message first paint.
5. Rerun existing task-scoped Browser Preview and running-to-terminal Agent lifecycle acceptance.
6. Inspect screenshots, run focused and document-health tests, perform a secondary diff review, then commit only task-owned changes and push `v0.0.18beta` to `legacy-remote`.

## Validation

### Focused source and state contracts

- `bun test packages/overlay/test/card-header-chrome.test.ts packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/card-fold-store.test.ts`
  - `27 pass / 0 fail`.
  - Covers the single add-menu callback chain, shared Button ownership,
    viewport-constrained error Tooltip, and untouched
    `running → idle → completed` expansion policy.
- `bun run --cwd packages/overlay check:i18n`
  - Pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `21 pass / 0 fail`.

### Node-launched real Overlay browser acceptance

- `card-header-metadata-tooltip-browser.test.ts`
  - Pass. The full long error reason has no native `title`, fits within the
    viewport, wraps without horizontal overflow, and retains exact clipboard
    copy.
- `task-dirbar-keyboard.test.ts`, focused Environment scenario
  - Pass. The `+` is a real Button that closes Environment and opens the
    existing seven-item Right Dock tool menu.
  - A deliberately unresolved commit-message stream cannot block Dialog first
    paint: the Dialog appears within the 1.5-second acceptance bound with an
    empty read-only field and `Generating commit message…`, then fills when the
    stream is released.
- `chat-bubble-disclosure-button-browser.test.ts`
  - Pass. The selected-task event stream begins with a `running` Agent card:
    blue running status, expanded body, and visible cancel action. A real
    `session.status` terminal event then changes it to the green compact card.
- `chat-browser-preview-task-binding-browser.test.ts`
  - Pass. The selected Chat persists `selectedTaskID`, reads only
    `/task/<taskID>/browser-preview`, and renders the backend evidence after
    `task.updated`. It never invents a session-scoped or cross-task preview.

The complete legacy `task-dirbar-keyboard.test.ts` file reached two unrelated
concurrent layout assertions after the focused Environment scenario passed:
the current Right Dock reserves 360px where the old fixture expects 280px, and
the worktree failure text uses a newer inset. Those assertions are outside this
repair and remain visible instead of being silently rewritten.

### Visual review

- `.scratch/task-dirbar-runtime-add-tool-menu.png`: the canonical tool catalog
  is visible immediately after the Environment `+` click.
- `.scratch/card-header-error-tooltip-focus.png`: the full error text wraps
  inside the right viewport edge.
- `.scratch/task-dirbar-runtime-git-action-loading.png`: the Dialog, generating
  copy, spinner, and all three actions are visible before stream completion.
- `.scratch/overlay-agent-message-running-expanded.png` and
  `.scratch/overlay-agent-message-collapsed-default.png`: running and terminal
  card states preserve the intended expansion and status-color transition.
- `.scratch/chat-browser-preview-binding/chat-bound-task-preview.png`: the
  Right Dock Browser renders task-scoped backend evidence.

## Outcome

- Environment `+`, error Tooltip overflow, Changes loading feedback, and Agent
  runtime verification are closed.
- Browser Preview's product path is also verified. The historical Dashboard
  task from the comparison report still has no persisted preview target, so the
  client must honestly show `missing`; retroactively attaching another task's
  page would violate task ownership and is not part of this repair.
