# Environment Goals Density And Chat Scrollbar

## Recall

### User requirement

The supplied desktop screenshot identifies five presentation defects in the
Environment Information Goals section and the conversation surface:

1. remove every per-state count rendered after the Goals title;
2. make the remaining `passed/total` summary use the same font size and color
   as the Goals title;
3. remove the segmented Goals progress bar;
4. align the Goal list with the Goals header row; and
5. hide the conversation scrollbar until the conversation is hovered.

### Acceptance criteria

- The embedded Goals header contains the semantic Goals button, one
  `passed/total` summary, and the fold button; it contains no passed, running,
  failed, blocked, or pending count cluster.
- The summary and title resolve to the same computed font size and text color.
- No segmented progress-bar DOM or CSS remains.
- Goal-row content starts on the same inline axis as the Goals header content.
- `#chatScroll` keeps stable scrollbar geometry but paints a transparent track
  and thumb at rest; pointer hover or keyboard focus within the conversation
  reveals the canonical track and thumb colors.
- Focused source tests, Overlay typecheck/build, Node-launched browser
  interaction, and task-scoped screenshot inspection pass without restarting
  or refreshing a running OpenCorvus/Overlay process.

### Hard constraints

- `TaskProgressBar` remains the only Environment Goals renderer and continues
  to read `boardStore.board.goals` as its single source.
- Preserve locate, fold, Goal status, accessible labels, and Right Dock
  navigation behavior.
- Reuse the existing Button/Icon primitives and theme scrollbar/text tokens;
  do not add a second renderer, fallback, hard-coded palette, local status
  shadow, iframe, mobile scope, or process restart.
- Preserve unrelated dirty work, use the current worktree, prefix the delivery
  commit with `dsw-33987`, and push to `legacy-remote`.

### Sources read before implementation

- `AGENTS.md`
- Browser control skill
- Supplied screenshot at original resolution
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-18-environment-popover-goal-and-dock-convergence.md`
- `specs/records/2026-07/2026-07-20-goal-status-color-semantics.md`
- `specs/records/2026-07/2026-07-21-chat-message-scroll-repair.md`
- `TaskProgressBar.tsx`, `TaskDirBar.tsx`, `card.css`, `base.css`, and their
  focused source/browser regressions.

### Whole-repository search evidence

Commands:

- `rg -n "TaskProgressBar|task-progress__|project-runtime-tool-goals" packages/overlay`
- `rg -n "#chatScroll|conversation-body|scrollbar" packages/overlay/src packages/overlay/test`
- `rg -n "GoalsBoardPanel|goalsBadge|gwg-list" packages/overlay/src packages/overlay/test`

Call-site disposition:

| Owner / consumer | Decision |
| --- | --- |
| `TaskProgressBar.tsx` | Delete the per-state count cluster and segmented bar render paths; retain the one board-backed Goal list, `passed/total` summary, fold control, and locate behavior. |
| `card.css` | Delete retired count/bar/segment rules, unify title/summary typography, and remove the pill inset that causes the list/header axis mismatch. |
| `base.css` | Keep `#chatScroll` as the one scrollbar-geometry opt-in but make resting paint transparent and reveal canonical paint from `:hover`/`:focus-within`. |
| `visible-scrollbar-whitelist.test.ts` | Replace the always-visible transcript assertion with the hover/focus paint contract. |
| `task-progress-collapse.test.ts` and TaskDirBar browser fixture | Cover removed count/bar DOM, retained fold/list semantics, matching computed typography, axis alignment, and screenshots. |
| Right Dock `GoalsBoardPanel` / `GoalGroup` | Keep unchanged; the screenshot targets the Environment projection, and the Right Dock remains the detailed Goal surface. |

### Independent-agent feedback

No sub-agents were requested by the user, so none were started.

## Root-cause chain

The Goal data and status projection are correct. The visible clutter comes from
three independent presentations of the same array in one compact section: a
per-state count cluster, a passed/total summary, and one segment per Goal. The
list then adds its own eight-pixel button inset while the header title has none,
so the two rows cannot share a leading axis. The transcript scrollbar has the
opposite implementation/comment mismatch: its documentation says it is quiet
until hover or keyboard focus, but its base rule paints the canonical track and
thumb unconditionally.

The root repair removes the redundant Goal presentations, keeps one summary
plus the actionable Goal list, assigns title and summary one typography
contract, removes the list-only inset, and makes scrollbar paint state depend
on the actual conversation hover/focus surface while retaining scrollability
and stable geometry.

## Implementation plan

1. Add focused regressions for the requested DOM removals, typography, list
   alignment, and scrollbar paint states.
2. Refine the existing component and its sole CSS owners.
3. Run focused tests, Overlay typecheck/build, and the isolated Node browser
   fixture; inspect task-scoped screenshots and iterate.
4. Run documentation health, diff review, second visual review, commit only
   task-owned files, fetch/converge, and push the current branch to `legacy-remote`.

## Status

- [x] Recall, root-cause analysis, and whole-repository call-site audit recorded.
- [x] Production implementation complete.
- [x] Focused source tests, Overlay typecheck, localization validation, and
  production build pass.
- [x] Node-launched browser interaction and task-scoped screenshot review pass.
- [x] Second review, delivery commit, and `legacy-remote` push complete.

## Validation evidence

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/visible-scrollbar-whitelist.test.ts packages/overlay/test/task-cwd-row-layout.test.ts`
  passed with 14 tests and 264 assertions.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed with catalog digest
  `0762a4bc7c9590d2`.
- `bun run --cwd packages/overlay build` passed after transforming 2,649
  modules.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts`
  passed all 16 browser cases. The Environment screenshot at
  `.scratch/task-dirbar-runtime-status-expanded-state.png` shows no per-state
  count cluster or segmented bar, matching Goals/summary typography, and the
  header/row icon leading axes aligned within 0.5 pixels.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts`
  passed its hover/focus scrollbar case. Chromium's computed
  `scrollbar-color` changes from transparent at rest to the canonical theme
  tokens on hover/focus; native scrollbar chrome is not painted into headless
  Chromium screenshots, so the computed browser state is the visual-state
  evidence for this platform behavior.
- `bun test --timeout 30000 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/document-health.test.ts`
  passed all 87 document-health and single-source checks.
