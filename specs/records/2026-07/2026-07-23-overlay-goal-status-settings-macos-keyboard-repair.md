# Overlay Goal, Status, Settings, and macOS Keyboard Repair

## Recall

### User request

The user supplied four screenshots and asked for one repair round:

1. align every embedded Goals description to one left edge;
2. align Work Ledger status dots with the other trailing icons;
3. make the bottom-left OpenCorvus identity area open Settings when clicked;
4. stop macOS Delete and arrow keys from producing unreadable characters in the Composer.

### Acceptance criteria

- Goal descriptions share the same rendered `left` coordinate even when compact Goal identifiers have different widths or revisions.
- A visible Work Ledger status dot and the loading/action icon boxes share the same trailing-column center.
- The complete OpenCorvus identity surface is a keyboard-focusable canonical button; click/Enter opens the existing General Settings dialog without creating another settings route or state source.
- macOS key handling is corrected at the Wry/AppKit event-forwarding owner instead of filtering private-use characters from Composer text.
- Focused unit/browser tests pass, visual screenshots for the three rendered surfaces are personally reviewed, the Overlay typecheck passes, and spec health remains green.

### Hard constraints

- Preserve one Goal projection (`TaskProgressBar`) and one Settings dialog authority (`openConfigDialog`).
- Use existing `Button`, `Tooltip`, and Settings primitives; do not add handwritten parallel controls.
- Do not add a Composer character filter, platform gate, fallback input, or hidden synthetic message.
- Playwright/browser tests run through Node, never Bun.
- Do not restart or otherwise disturb the user's running OpenCorvus/overlay process.
- No mobile/tablet scope is authorized.
- Commit subjects start with `dsw-33987`; deliver through the `myhexin` git-cc remote.

### Disk sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-22-environment-goals-density-and-chat-scrollbar.md`
- `specs/records/2026-07/2026-07-22-left-rail-hover-and-action-column-convergence.md`
- `specs/records/2026-07/2026-07-14-overlay-composer-ime-interruption-root-repair.md`
- `specs/records/2026-07/2026-07-08-work-ledger-row-alignment.md`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/SidebarVersionLabel.tsx`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ui/AutoGrowTextarea.tsx`
- `packages/overlay/src/components/ui/TextField.tsx`
- `packages/overlay/src/services/config-dialog-control.ts`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/src/styles/surfaces/sidebar.css`
- `packages/overlay/src/styles/surfaces/work-ledger.css`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src-tauri/Cargo.toml`
- `packages/overlay/src-tauri/Cargo.lock`
- focused unit and Node browser tests named in the validation section below.

### Whole-repository grep evidence

- `TaskProgressBar` has one product render owner: `TaskDirBar.tsx`; `Conversation.tsx` is explicitly guarded from reintroducing a second copy. Its source tests are `task-progress-collapse.test.ts`, with rendered coverage in `goal-group-css-residue-browser.test.ts` and `task-dirbar-keyboard.test.ts`.
- `work-row-status-mark` has one product call site in `WorkLedger.tsx`. Styling lives in `work-ledger.css`, with shared row grid ownership in `sidebar.css`; browser geometry coverage lives in `hover-action-geometry.test.ts`.
- `SidebarVersionLabel` has one product call site in `App.tsx`. Its focused rendered coverage is `sidebar-version-tooltip.test.ts`.
- `openConfigDialog` is the existing single Settings authority. Call sites exist in `main.tsx`, `ChatComposer.tsx`, `ConnectionBanner.tsx`, `CommandPalette.tsx`, `ConnectionBadge.tsx`, `ComposerModelSelector.tsx`, `TitlebarMenubar.tsx`, `WorkLedger.tsx`, and helper calls within `config-dialog-control.ts`. The new footer action reuses this function with `general`; none of the existing callers are replaced.
- Composer key handling is local to `ChatComposer.handleKeyDown`; it prevents default only for mention navigation/editing and Enter submission. `AutoGrowTextarea` renders one native `textarea`; neither layer appends `KeyboardEvent.key` to draft text.
- The macOS application-menu owner is `build_macos_application_menu` in `src-tauri/src/main.rs`. The resolved native stack is Tauri `2.11.1`, `tauri-runtime-wry` `2.11.1`, and Wry `0.55.1`.
- The locked Wry `0.55.1` source overrides `WryWebViewParent::keyDown:` and unconditionally calls `menu.performKeyEquivalent(event)` without checking whether the menu handled the event or forwarding unhandled keys.
- No repository implementation already owns the upstream Wry `keyDown` correction, and no private-use function-key filter exists.

### Independent agent feedback

None. The user did not request sub-agents or parallel audits, and the active higher-level delegation policy forbids spawning them for this task.

## Diagnosis

### Goal descriptions

`TaskProgressBar` renders each row as an independent flex-like `Button` containing icon, compact identifier, and description. The identifier is content-sized per row (`#G1`, `#G1·2`, `#G10`, and so on), so each description starts after a different identifier width. Trimming `goalTitle` cannot solve geometry. The single-source fix is a shared parent grid with each row using CSS subgrid across icon, identifier, and description columns.

### Work Ledger status dots

The trailing loading and action controls use `--work-row-action-size` (`18px` at scale 1), but `.work-row-status-mark` itself is a `6px` flex item. Because `.work-row-right` right-justifies its content, the status-dot center sits six pixels farther right than an 18px icon center. The dot must keep a full action-size alignment box and paint its 6px glyph with a pseudo-element. Terminal statuses still collapse the entire box to zero.

### Footer Settings entry

`SidebarVersionLabel` is currently a focusable `span` used only as a tooltip trigger. The existing Settings lifecycle already has a canonical entry function and General tab. Converting the tooltip trigger to the shared `Button` primitive and calling `openConfigDialog("general")` adds the requested affordance without a second dialog path.

### macOS Delete/arrow corruption

The screenshot alone cannot prove the exact Unicode code points. Local code does prove that the Composer never inserts key names and that the macOS-only native parent-view event path is outside the textarea code.

The resolved Wry `0.55.1` source contains the same `WryWebViewParent::keyDown:` defect documented by upstream issue `tauri-apps/wry#1175`: bare arrow keys do not reach WKWebView content. Upstream commit `bcd149377f2a00ce5edb03729e1c585d79d2f0b0` changes that exact owner so only Command/Control candidates are offered to the menu, handled shortcuts return, and remaining events use AppKit interpretation. The repair therefore pins that upstream Wry correction through Cargo rather than introducing a Composer-side character scrubber.

Upstream evidence:

- https://github.com/tauri-apps/wry/issues/1175
- https://github.com/tauri-apps/wry/pull/1711
- https://github.com/tauri-apps/wry/commit/bcd149377f2a00ce5edb03729e1c585d79d2f0b0

The current Windows host can validate Cargo resolution/source ownership and all web input invariants, but it cannot truthfully replace a physical macOS WKWebView runtime test. That remaining native-runtime boundary must be reported if no macOS runner becomes available in this round.

## Call-point disposition

| Surface/API | Call point | Disposition |
| --- | --- | --- |
| Embedded Goals | `TaskDirBar.tsx` -> `TaskProgressBar` | Preserve the single render; change only shared grid geometry. |
| Goals state/labels | `goal-state.ts`, `goal-label.ts` | Preserve semantics and strings. |
| Work Ledger status | `WorkLedger.tsx` | Preserve one mark/loading branch and accessible labels. |
| Work Ledger layout | `sidebar.css`, `work-ledger.css` | Preserve shared row grid; make the status mark use the existing action-size axis. |
| Footer identity | `App.tsx` -> `SidebarVersionLabel` | Preserve the one mount; convert the trigger to the shared button. |
| Settings open | all existing `openConfigDialog` callers | Preserve; add one General-settings caller in `SidebarVersionLabel`. |
| Composer input | `ChatComposer.tsx`, `AutoGrowTextarea.tsx`, `TextField.tsx` | Preserve native textarea and mention semantics; add regression evidence that navigation/edit keys do not append text. |
| macOS menu | `build_macos_application_menu` | Preserve native menu and shortcuts. |
| Wry dependency | `Cargo.toml`, `Cargo.lock` | Replace crates.io Wry source with the exact upstream corrective revision; do not keep both sources. |

## Implementation plan

1. Change embedded Goals rows to a three-column parent grid/subgrid and add rendered title-left geometry assertions using labels of unequal width.
2. Give visible Work Ledger status marks an action-size alignment box with a centered pseudo-element; extend Node browser geometry and screenshot coverage for status dot versus loading icon.
3. Convert the footer identity trigger to `Button`, open General Settings through `openConfigDialog`, preserve author tooltip copy, and extend the real Settings-dialog browser test plus screenshot.
4. Pin the upstream Wry key-forwarding repair, update Cargo lock data through Cargo tooling, and add a repository test that proves the resolved source/revision and rejects reintroduction of a Composer private-use filter.
5. Run focused unit tests, Node browser tests, Overlay typecheck/i18n/build, Cargo checks available on the Windows host, documentation health, and `git diff --check`.
6. Inspect all new screenshots, correct visual defects, rerun tests, then conduct a second diff review before commit and git-cc push.

## Validation targets

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/overlay-architecture-guards.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-group-css-residue-browser.test.ts packages/overlay/test/browser/hover-action-geometry.test.ts packages/overlay/test/browser/sidebar-version-tooltip.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml --locked`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Review checkpoint

Implementation now uses one shared three-column Goal grid/subgrid, an action-size Work Ledger status alignment box with a centered six-pixel glyph, the shared `Button` plus `openConfigDialog("general")` for the footer entry, and Cargo's one resolved Wry source pinned to upstream revision `bcd149377f2a00ce5edb03729e1c585d79d2f0b0`. No parallel Settings lifecycle, status renderer, Composer character filter, or native event owner was added.

Validation evidence:

- The focused Overlay source suite passed 165 tests / 8,822 assertions across progress, Work Ledger, ownership, right-column, Composer mention, and macOS forwarding coverage.
- `goal-group-css-residue-browser.test.ts` passed in the Node browser runner and measured every rendered Goal description at the same left coordinate within 0.5 pixels. `goal-status-environment-progress.png` was reviewed at original resolution and shows unequal identifiers (`#G1·2`, `#G2`, and so on) with one description edge.
- `hover-action-geometry.test.ts` passed and measured the failure-status box and loading-icon box at the same width and horizontal center. `work-ledger-status-column-alignment.png` was reviewed at original resolution. Its rerun also exposed a stale pre-existing assertion that expected rail padding even though current source and `task-row-right-alignment.test.ts` deliberately require zero inset; the browser assertion now follows that canonical contract.
- `sidebar-version-tooltip.test.ts` passed, proves the footer is an accessible shared button, preserves the author tooltip, opens the existing dialog on General, and produced the reviewed `sidebar-version-settings-open.png`.
- `composer-mention-browser.test.ts` passed after real ArrowRight, Backspace, ArrowLeft, and Delete input. It asserted value `AD`, one caret position, and no macOS private-use characters, and produced the reviewed `native-navigation-delete-clean.png`. The same run exposed a stale conversation fixture missing the now-required `pendingQuestions` array; only the test payload was corrected.
- `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, the production Vite build, and `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml --locked` passed. Cargo compiled the pinned Wry revision and both Tauri runtime layers.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed 21 tests, and `git diff --check` passed.

The screenshots were generated by isolated Node-launched browser fixtures; no running OpenCorvus or Overlay process was restarted or reused. The current host is Windows, so an actual macOS WKWebView runtime smoke test is unavailable in this round and is not represented as passed. The repository does resolve and compile the exact upstream macOS owner correction, while a physical macOS release check remains required before release judgment.

Second review re-read every task-owned diff, the Cargo lock resolution, focused tests, screenshots, and this Recall. It confirmed the four repairs remain at their existing single owners. Concurrent Environment/Right Dock work appeared in the shared worktree during validation; those unrelated files and index lines are preserved but excluded from this task's staging set.
