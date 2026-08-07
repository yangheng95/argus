# Overlay Conversation and Goal Density Repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Explain and remove the redundant `Mission task` label if unnecessary; reduce the excessive blank space between the left Dock and the message surface; make message cards and the composer share one centered axis; reduce the excessive vertical spacing between Goals entries. |
| Acceptance criteria | Mission-owned Task rows retain their real Mission/Task hierarchy and actions without rendering the duplicate ownership words; the transcript uses more of a wide desktop workspace; rendered message-card and composer content edges share one center axis with a real scrollbar; collapsed Goal rows use a compact continuous rhythm; focused source tests, TypeScript, i18n, real Node-launched browser geometry, and manually reviewed screenshots pass. |
| Hard constraints | Preserve `WorkLedger` as the sole Mission/Task hierarchy renderer, the existing Kobalte-backed Button and Tooltip primitives, `--ui-chat-message-content-width` as the single message-width token, and `GoalGroup` as the sole Goal-row renderer. Do not add a second layout source, compatibility branch, viewport query override, state machine, or presentation gate. Do not refresh, restart, close, or otherwise interfere with the user's running OpenCorvus/Overlay; visual acceptance uses isolated browser fixtures. Commit subjects begin with `dsw-33987` and the final branch is pushed to `legacy-remote`. |
| Sources read | `AGENTS.md`; `specs/README.md`; the July 8/9 message-pane and scrollbar repair records; the July 16 conversation-width and Work Ledger density records; the July 17 Agent Rail placement record; `WorkLedger.tsx`; `work-ledger.css`; `conversation.css`; `composer.css`; `base.css`; `GoalGroup.tsx`; `Board.tsx`; `inspector.css`; the focused Work Ledger, conversation geometry, and GoalGroup browser/source tests; the supplied screenshot at its original resolution. |
| Whole-repository search | `inlineMeta` has one production caller and exists only to translate `work_ledger.task_owned_by_mission`; the task already remains nested under the Mission disclosure and carries a Task kind icon. Conversation width is owned by `base.css`, projected through `.chat`, and consumed by both `.chat-scroll` and `.chat-composer-stack`; `scrollbar-gutter: stable both-edges` is the only renderer-dependent centering assumption. Goal rows have one renderer (`GoalGroup`) and one production density owner (`inspector.css`); `.gwg-list` already has `gap: 0`, so the visible spacing is row-box density rather than a list-gap source. The existing GoalGroup browser fixture failed before this task because its class assertion did not include the already-landed shared `oc-navigation-row` class; this directly relevant stale assertion must be corrected while adding geometry coverage. |
| Independent agent feedback | No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. |

## Causal analysis

1. `Mission task` is not backend lifecycle evidence. `inlineMeta()` derives it solely from the already-present `missionID` and renders it beside every nested Task title. The Mission disclosure hierarchy and kind glyph already communicate the same fact, so the words consume scarce row width without adding a distinct action or state.
2. The wide-workspace void is produced by the global 1040px message-content cap, not by left-Dock padding. On a roughly 1490px conversation workspace it necessarily leaves more than 200px on each side of the centered transcript lane; the workspace-edge Agent Rail therefore appears detached from the actual message surface.
3. The packaged WebKit rendering in the supplied screenshot reserves the transcript scrollbar on the trailing edge despite the CSS request for `stable both-edges`. The card lane is consequently shifted left while the absolutely positioned composer remains symmetrically inset. Depending on renderer-specific mirrored gutter behavior is the direct cause; a single explicit leading compensation plus the real trailing gutter is deterministic in both WebKit and Chromium.
4. The Goal list itself has zero gap. The oversized rhythm comes from the narrow `side-activity` container rule changing every long `.gwg-title` from the canonical single-line ellipsis to a two-line clamp while top-aligning the header. In the screenshot most Goal names are long, so most collapsed entries silently become double-height rows. The 26px minimum and four-pixel vertical padding add secondary excess around that unintended second line.

## Implementation plan

1. Delete the Work Ledger ownership meta function, render branch, translation keys, CSS, and tests while preserving Mission child nesting, disclosure, icons, status, actions, and tooltips.
2. Increase the canonical wide-desktop message-content cap at its token owner, replace renderer-dependent mirrored scrollbar gutters with one real trailing gutter plus an explicit leading compensation, and keep the composer consuming the same compensated inset.
3. Remove the narrow-container two-line title branch so collapsed Goal headers retain the canonical single-line ellipsis, then reduce only their vertical padding and minimum height while retaining the existing Button primitive, status icon, revision, advisory, branch, keyboard focus, expand/collapse, and expanded-body behavior.
4. Extend focused unit/browser contracts to reject the deleted label, measure wide-workspace utilization and exact card/composer center parity, and measure collapsed Goal-row height and inter-row gap. Repair the stale GoalGroup primitive class expectation found by the baseline run.
5. Run focused tests, Overlay TypeScript/i18n/build, Node-launched browser fixtures, inspect fresh screenshots, run spec/document health, perform a second diff/ownership review, commit only this task's files, and push `v0.0.8beta` to `legacy-remote`.

## Validation targets

```sh
bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/overlay-architecture-guards.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-group-css-residue-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/hover-action-geometry.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation and verification

- Deleted the frontend-only `inlineMeta()` projection, its two translation keys, and its CSS. Mission-owned Tasks remain real child rows under the Mission disclosure with their Task glyph, status, actions, and tooltip evidence intact.
- Increased the single message-content width token from 1040px to 1280px. Replaced the renderer-dependent `stable both-edges` assumption with one trailing stable gutter and the full measured gutter as explicit leading compensation; cards and the composer continue to consume the same canonical width/inset sources.
- Removed the narrow Goals two-line clamp and compacted the existing header from 26px/4px vertical rhythm to 24px/2px. No alternate Goal renderer, responsive deliverable, or new state source was added.
- During the relevant Work Ledger browser replay, current three-action rows exposed a real missing `display: flex` declaration: the third action wrapped below the first. The canonical action container now explicitly owns flex layout, and the fixture was aligned with the production archive action and shared compact Icon primitive.
- Focused Overlay source tests passed: 162 tests, 0 failures. Overlay TypeScript, i18n, and production Vite build passed. The four Node-launched browser fixtures for header chrome, conversation/Agent Rail geometry, Goal density, and Work Ledger action geometry all passed.
- Fresh screenshots were manually reviewed. The 1902px conversation fixture shows identical message-card and composer left/right edges and materially reduced Dock-to-message whitespace; the Goal fixture shows two adjacent single-line rows with zero measured inter-row gap; the Work Ledger hover fixture shows all three actions on one centered line without title overlap.

## Second review

The final diff retains one source for Mission/Task hierarchy (`WorkLedger`), one source for transcript width (`--ui-chat-message-content-width`), one measured scrollbar-gutter projection, and one Goal renderer (`GoalGroup`). Repository searches find no remaining `task_owned_by_mission`, `work-row-inline-meta`, or Goal two-line clamp. No running OpenCorvus/Overlay process was restarted, refreshed, or closed; all visual evidence came from isolated Node-launched browser fixtures.
