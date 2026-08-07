# Conversation Fade, Brand Guide Retirement, and Goal Density

## Recall

### User request

- Add a shadow/fade where the top of the conversation hides scrolled content, matching the lower composer treatment.
- Remove the Quick Guide surface shown in the supplied second screenshot.
- Reduce the excessive default line spacing in the floating Goals window shown in the supplied third screenshot.

### Acceptance criteria

1. A populated desktop conversation has a non-interactive top occlusion fade that mirrors the existing composer-side fade and remains inside the canonical conversation scroll shell.
2. The titlebar keeps the OpenCorvus Workspace identity but no longer exposes, mounts, styles, translates, or tests the Quick Guide popover.
3. Goal rows keep their existing vertical-first order and resize/capacity contract, but use a stable compact row height instead of stretching each row to fill the whole floating window.
4. Focused source tests, Overlay typecheck/build, Node-started browser behavior, task-scoped screenshots, manual visual review, documentation health, and a second diff review pass succeed.

### Hard constraints

- Preserve unrelated dirty worktree changes and stage only this task's files/hunks.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Browser validation uses an isolated local target and Node on Windows, never Bun.
- No duplicate renderer, compatibility alias, fallback, gate, hidden state, iframe, query override, or handwritten substitute interaction.
- Commit subjects start with `dsw-33987`; delivery pushes the current branch to the `myhexin` git-cc remote.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-07/2026-07-17-chat-composer-fixed-layer.md`
- `specs/records/2026-07/2026-07-15-composer-authority-and-goal-vertical-fill.md`
- `specs/records/2026-07/2026-07-15-task-progress-empty-goal-body-repair.md`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/titlebar/TitlebarBrandGuide.tsx`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/components/task-progress-floating-frame.ts`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/styles/surfaces/titlebar.css`
- `packages/overlay/src/styles/surfaces/card.css`
- Focused source and browser tests named in the call-site table below.
- User screenshots `codex-clipboard-09fbcc6e-e551-4390-87c3-0b7809fb6ef9.png`, `codex-clipboard-80f8c82d-fd03-4d7c-8cad-06de27338a8e.png`, and `codex-clipboard-36a83885-1b43-4916-afd3-16a08c8c1496.png`.

### Whole-repository search evidence

- `App.tsx` is the only production owner of `.conversation-scroll-shell`; `conversation.css` is the only production owner of that selector and of the existing `#solidChatComposer` bottom fade.
- `TitlebarBrandGuide.tsx` is the only production source for Quick Guide markup. `App.tsx` is its only caller; `titlebar.css` owns every `brand-guide-*` selector; English and Chinese locale files own all `brand.guide_*` strings.
- `TaskProgressBar.tsx` is the only production writer of `--task-progress-grid-rows`; `.task-progress__pills` in `card.css` is its only production consumer. `task-progress-floating-frame.ts` remains the single capacity and resize geometry owner.
- Focused regression owners are `conversation-empty-state-source.test.ts`, `workspace-composer-density.test.ts`, the titlebar brand source tests, `task-progress-collapse.test.ts`, and the existing Node browser fixtures for conversation and Goals geometry.
- No relevant production file was dirty before this task. Existing dirty work was confined to left-rail/workspace styles, tests, and records and is preserved.

### Independent agent feedback

- None. The user did not request sub-agents, so no delegation was started.

## Root cause

- The lower occlusion already has one canvas-backed gradient on `#solidChatComposer`, while the top edge has no corresponding layer; scrolled content therefore meets the top boundary abruptly.
- The unwanted panel is not generic popup chrome. It is the complete `TitlebarBrandGuide` Popover feature, including trigger semantics, localized copy, CSS, and browser coverage.
- Goals spacing is caused by `grid-template-rows: repeat(..., minmax(26px, 1fr))`. The `1fr` maximum distributes all spare body height across the visible rows, so a small goal count creates very tall line boxes.

## Call-site disposition

| Surface                           | Disposition                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.tsx` titlebar brand mount    | Replace the popover component with one static `TitlebarBrand` identity component; keep the existing mount position and brand text.                                                     |
| `TitlebarBrandGuide.tsx`          | Delete; no compatibility export or hidden guide remains.                                                                                                                               |
| `TitlebarBrand.tsx`               | Add the static, non-interactive brand identity as the sole markup owner.                                                                                                               |
| `titlebar.css`                    | Rename the retained identity selectors and delete every card/section/step rule owned only by Quick Guide.                                                                              |
| `en-US.json` / `zh-CN.json`       | Delete every `brand.guide_*` key and the now-unused logo alternative-text key; retain the workspace label used by the static identity and its outer accessible name.                   |
| Quick Guide source/browser tests  | Replace the production source contract with a static-brand/no-guide regression; delete the dedicated popover browser test and remove the retired sample from generic popup matrices.   |
| `.conversation-scroll-shell`      | Add one pointer-transparent top pseudo-element using the same canvas/fade distance as the canonical lower composer layer; suppress it for the empty home.                              |
| `.task-progress__pills`           | Replace the stretchable `1fr` maximum with the canonical compact row height and start alignment; retain the component-projected row count, column flow, capacity, and resize behavior. |
| `task-progress-floating-frame.ts` | Keep; it already defines the canonical 26px row height used by capacity calculations.                                                                                                  |

## Implementation plan

1. Replace the brand-guide Popover with static titlebar identity and remove all dead guide sources and tests.
2. Add the top conversation fade in the existing scroll-shell owner and pin its non-interactive, empty-home, and token-backed behavior in focused tests.
3. Make Goals rows consume the existing 26px geometry contract without `1fr` stretching and add computed-geometry coverage.
4. Run focused tests, typecheck, build, and isolated browser screenshots; inspect the three delivery regions and iterate from visual evidence.
5. Run documentation health and a separate diff review, then commit only owned hunks and push the current branch to `myhexin`.

## Implementation result

- `TitlebarBrandGuide` and its Kobalte Popover, popup CSS, guide locale copy, dedicated browser test, and guide-owned source test were deleted. `TitlebarBrand` is now the sole static identity owner mounted by `App.tsx`.
- `.conversation-scroll-shell::before` owns one pointer-transparent 16px canvas-to-transparent fade. `#solidChatComposer` consumes the same local fade-size token for the lower edge, and the empty home disables the top layer.
- `.task-progress__pills` now projects fixed 26px rows with `align-content: start`; its existing vertical-first flow, component-projected row count, and floating-frame capacity calculation remain unchanged.
- The long-transcript browser fixture now supplies the canonical empty Mailbox responses required by the current application bootstrap, and captures the top fade while scrolled into the middle of a 240-message transcript.

## Verification result

- Focused source tests: 181 task-relevant assertions passed. The only failure in the broad architecture-guard file is concurrent, unrelated `work-ledger.css` duplicate-selector work outside this task.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build`: passed; Vite transformed 2,492 modules.
- Node browser suite: 8/8 passed across long-transcript fade, floating Goals geometry, keyboard focus, titlebar widths/locales, keyboard access, global startup, project close, and column resizing.
- Visual evidence reviewed:
  - `.scratch/conversation-long-transcript-markdown-browser/conversation-top-edge-fade-1440x900.png`
  - `packages/overlay/.scratch/task-progress-floating-window/dark-window-compact-goal-rows.png`
  - `.scratch/task-progress-pill-focus-light.png`
  - `.scratch/overlay-minimum-1120-full.png`
- Historical/product documentation tests otherwise pass; the tracked-record check remains pending until selective staging, and currently also reports the unrelated concurrent Work Ledger record as untracked.

## Second review

- Re-grep found no production `TitlebarBrandGuide`, `solidTitlebarBrandGuide`, `brand.guide_*`, or `brand-guide` reference. Remaining test mentions are negative assertions that prevent restoration.
- The fade review confirmed one CSS owner, one shared edge-distance token for top and composer-side gradients, `pointer-events: none`, and explicit empty-home suppression.
- The Goals review confirmed only the row track maximum and alignment changed; vertical-first `grid-auto-flow: column`, component row projection, keyboard focus, drag/resize, and capacity ownership remain intact.
- Final screenshots show a mid-transcript card fading beneath the top boundary, compact Goals rows retaining clear focus/semantic states, and a static titlebar identity with no Quick Guide affordance.
- `git diff --check` passed. Concurrent Work Ledger and workspace-shadow changes remain outside this task and must not be staged or committed with it.
