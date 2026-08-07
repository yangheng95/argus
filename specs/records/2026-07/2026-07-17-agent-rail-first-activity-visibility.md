# Agent Rail First-Activity Visibility Repair

## Recall

### User requirement

- The active Task conversation must show a Codex-like Agent Rail; the supplied screenshot and Task debug bundle show no rail while Requirements, Orchestrator, and Architect activity is already visible.
- The follow-up Codex crop clarifies the placement: the rail belongs directly against the right edge of the left Dock, outside the central message pane. It must not be positioned relative to the centered message cards.

### Acceptance criteria

- The existing `ConversationAgentRail` is the first child of `#workspaceMain` and an absolute transparent overlay at that workspace's left edge; the workspace itself remains immediately after the left Dock resizer and the rail remains outside `#conversationBody`.
- The rail becomes visible as soon as the selected Task or Chat has one real projected Agent activity record.
- Zero records keep the host empty; no placeholder, synthetic record, card-tree scan, fallback projection, or second rail is introduced.
- One, three, and four real projected records all render the same canonical rail; pointer/focus emphasis, tooltip context, and click-to-card locate behavior remain intact.
- The central conversation keeps its normal symmetric message grid; rail visibility does not insert columns beside or mirror space around message cards.
- The supplied Task `tsk_f6f54f51e001m1sMEVpRE70cFu` is explained by persisted session evidence rather than its title: at screenshot time its session tree contained the Orchestrator, Requirements, and first Architect sessions, while the renderer required more than three records.
- Focused unit, real Node-browser, typecheck, build, i18n, historical-document health, and screenshot review pass before delivery.

### Hard constraints

- Follow `AGENTS.md`: remove the visibility gate and fix the root renderer contract; do not add a bypass, compatibility route, hidden message, duplicate source, state machine, or hard-coded task-specific rule.
- Preserve `conversationAgentRecordsForSource(boardStore.selectedSource)` as the single rail data source and `App.tsx` as the single mount owner; move that mount rather than adding another.
- Reuse the existing Solid `Show`, Kobalte-backed Tooltip, shared Button, and current rail CSS; no new UI dependency or hand-built parallel primitive.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Visual verification uses the existing isolated Node browser fixture.
- Commit subjects start with `dsw-33987`; commit and push the current `v0.0.8beta` branch to the legacy remote.

### Sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`
- `specs/records/2026-07/2026-07-08-conversation-agent-history-left-rail.md`
- `specs/records/2026-06/2026-06-23-agent-rail-visibility-regression.md`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/src/store/conversation-agents.ts`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/styles/surfaces/activity.css`
- `packages/overlay/src/styles/surfaces/workspace.css`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/test/conversation-agent-rail.test.ts`
- `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- Git history and blame for `ConversationAgentRail.tsx`, including commit `6cdc40bda`
- Persisted `session`, `engine_artifact`, and `decision_log` rows for the supplied Task

### Whole-repository search evidence

- `ConversationAgentRail.tsx` is the only record-to-rail renderer. It reads `conversationAgentRecordsForSource(boardStore.selectedSource)` and currently hides the entire `<aside>` behind `records().length > AGENT_RAIL_VISIBILITY_RECORD_THRESHOLD`, where the threshold is `3`.
- `App.tsx` owns the only `<ConversationAgentRail />` mount at `#solidConversationAgentRailMount`. Before this repair it is nested inside `#conversationBody` immediately before `.conversation-scroll-shell`, so CSS necessarily positions it relative to the centered message lane instead of the left Dock.
- `#leftActivityShell`, `#leftPaneResizer`, and `#workspaceMain` are consecutive children of `.panel-body`; the reference requires preserving that sequence and placing the existing mount inside the positioned workspace as a transparent overlay without a new layout/source owner.
- `conversation-agents.ts` is the single hydrated/live projection source. The persisted Task session tree proves real records existed; no projection fallback is required.
- `conversation.css` already hides the host only when the Solid mount is truly empty and already gives rendered ticks full resting opacity.
- `conversation-agent-rail.test.ts` is the only static test that enforces the incorrect fourth-record threshold.
- `conversation-agent-rail-scroll-browser.test.ts` owns the real interaction/screenshot coverage but its fixture only exercises a large record set; it must also prove the rail is present for a single record.
- The July 15 record documents why the threshold was introduced: it combined persistent tick opacity with a new fourth-record visibility contract. That contract conflicts with the earlier zero-versus-nonzero single-source behavior and the current Codex-like expectation.
- No sub-agent was started because the user did not request delegation and current collaboration policy forbids unrequested sub-agents.

## Root cause

The Task had valid, rendered Agent activity. The rail disappeared because commit `6cdc40bda` replaced the truthful non-empty condition (`records().length > 0`) with a presentation gate (`records().length > 3`). At the screenshot timestamp, the persisted session tree had exactly three projected Agent sessions, so the renderer returned no `<aside>` and the existing `:empty` host CSS removed the rail column. The later fourth Architect session would make the rail appear, creating a time-dependent UI contradiction rather than a data failure.

The follow-up screenshot exposed a second independent mismatch: the sole mount lives inside `#conversationBody`, and five-column `:has(...)` CSS inserts the rail next to the centered message lane plus a mirrored spacer. That makes the rail visually belong to message cards. The requested Codex placement instead belongs to the application shell boundary: after the resizable left Dock and before the workspace. This is a mount/layout ownership defect, not a need for a second rail.

## Correction Recall: exact Codex overlay geometry

### User correction and visual evidence

- The supplied full Codex screenshot proves the left Dock divider does not move when the Agent Rail is present. The ticks begin just inside the workspace, approximately 30 pixels to the right of that divider, and float over a transparent left-edge gutter.
- The first placement repair was therefore still wrong: making the rail a 46-pixel `.panel-body` flex sibling inserted a new opaque column between the Dock and workspace, shifted the complete workspace to the right, and changed the rounded workspace boundary. That is visibly different from the reference even though the rail was no longer attached to message cards.
- Exact acceptance now requires `#workspaceMain.left == #leftPaneResizer.right`, `.conversation-agent-rail-host.left == #workspaceMain.left`, and the host to be an absolute transparent overlay inside `#workspaceMain`. The rail must consume no flex/grid width and must not alter the message/composer center axis.

### Corrected implementation plan

1. Move the existing sole rail mount inside `#workspaceMain` as its first child, retaining `App.tsx` and `conversationAgentRecordsForSource` as the single mount and data owners.
2. Replace the host's flex-column styling with an absolute, full-height, fixed-width, transparent overlay anchored at the workspace's inline start. Keep the existing rail interactions and tick geometry unchanged.
3. Rewrite static and browser geometry assertions to reject a flex sibling, prove the Dock divider and workspace edge coincide, prove the host overlays that workspace edge, and prove the message grid remains unchanged.
4. Rebuild the isolated application, capture both first-activity and long-history screenshots, inspect them against the user's exact reference geometry, and only then commit and push the correction.

## Follow-up Recall: restore cursor-following line expansion

### User requirement

- Preserve the corrected transparent workspace-edge overlay, but restore the earlier interaction in which the line under the pointer expands strongly and its two neighboring lines expand in progressively smaller steps.
- This supersedes the July 16 decision to compress the complete width ladder to `8/8/9/10px`; that change left the proximity model in the component but made its visible response effectively disappear.

### Repository evidence and acceptance

- `ConversationAgentRail.tsx` still owns the complete single-source interaction: pointer/focus activation sets `activeSessionID`, `proximityForRecord` maps the active record and its two neighbors to distances `0/1/2`, and each row publishes `data-proximity`. No event model or component logic needs to be reintroduced.
- Commit `6dcf017da` is the exact deletion point. It reduced the established `16/22/27/32px` rest/near/nearer/active ladder to `8/8/9/10px`, while leaving the proximity selectors and width transition intact.
- Restore that established width ladder in the canonical host tokens only. Keep centered ticks, the 46-pixel transparent overlay, Kobalte tooltip, Button hit target, pointer/focus accessibility, and two-pixel line thickness unchanged.
- Browser acceptance must prove `16px` at rest, `32px` under the pointer, `27px` and `22px` on the first and second neighbors, then prove every line returns to `16px` when the pointer leaves the rail. A fresh hovered screenshot must be visually reviewed.

### Implementation plan

1. Restore the four historical width tokens in `conversation.css`; do not add pointer listeners, timers, drag behavior, or a second interaction source.
2. Update static contracts and extend the existing real browser fixture to assert the full proximity ladder and reset behavior.
3. Rebuild, run focused tests, capture and inspect the hovered rail, run document health and second diff review, then commit and push the current branch to `legacy-remote`.

### Validation result

- Restored only the canonical width tokens to `16/22/27/32px`; the existing pointer/focus proximity projection and fast width transition remain the sole interaction owner.
- The real Node browser fixture proved the centered five-line hover profile is exactly `22/27/32/27/22px`, line thickness remains 2 pixels, and twelve sampled ticks all return to 16 pixels after the pointer moves back into the transcript.
- `.scratch/conversation-agent-rail-scroll-browser/cursor-following-expanded-lines.png` was personally reviewed at 1600×760. The active line visibly leads the two progressively shorter neighbors while the fixed workspace boundary, transparent overlay, centered message surface, and tooltip remain intact.
- Focused source/architecture tests passed: 137 tests, 0 failures. Overlay typecheck, i18n, production build, and the real browser fixture passed.

## Implementation plan

1. Delete `AGENT_RAIL_VISIBILITY_RECORD_THRESHOLD` and restore the renderer's direct non-empty condition without changing the store ownership.
2. Move the sole rail mount from `#conversationBody` into `#workspaceMain`. Retire the conversation `:has(...)`/mirrored-column layout and make the host one fixed-width absolute transparent overlay using the existing rail/tick tokens.
3. Replace the static fourth-record and message-card-placement assertions with zero-hidden/nonzero-visible and Dock-edge ownership coverage. Extend the existing Node-browser fixture to prove one real record renders, exact Dock/workspace adjacency, message-card independence, and the established large-history interactions.
4. Run focused unit/browser tests, Overlay typecheck/build/i18n, and document-health checks; inspect fresh isolated desktop screenshots showing the one-record and long-history Dock rail.
5. Perform a second diff and ownership review, record validation evidence here, commit only the repair files, and push `v0.0.8beta` to `legacy-remote`.

## Verification plan

```sh
bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/acceptance-panel-mount.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation summary

- `ConversationAgentRail` no longer declares or evaluates a fourth-record threshold. Its existing Solid `Show` now follows only `records().length > 0`, so the first canonical hydrated/live activity mounts the existing `<aside>` and zero records still leave the host empty.
- `App.tsx` moves the one existing mount out of `#conversationBody` and makes it the first child of `#workspaceMain`. The host is now a fixed-width absolute transparent overlay at the workspace's left edge rather than a `.panel-body` flex sibling or message-grid column.
- The retired conversation `:has(...)` rules and mirrored spacer are deleted. `.conversation-body` returns to its ordinary symmetric three-column message layout regardless of rail visibility.
- The activity store, card-tree projection, Tooltip, Button, status styling, grouping, and locate path are unchanged; no new source, renderer, or task-specific behavior was introduced.
- Focused static regressions reject both the deleted threshold and the former message-pane/flex-sibling mounts, and assert the exact left-Dock-resizer → workspace → overlaid-rail ownership order.
- The existing Node browser fixture first serves one real Build session with two absorbed messages, proves exactly one rail stack/tick bound to that session, and captures a full desktop screenshot. It then reloads with the existing 57-session history and proves unchanged Dock/workspace adjacency, absolute transparent rail overlay geometry, scrolling, tooltip, grouping, and locate behavior.
- The fixture accepts `net::ERR_ABORTED` only during its deliberate reload window because browser navigation cancels the four prior event-stream requests. Strict browser error collection is restored immediately after reload; production event handling is unchanged.

## Validation

- Focused Overlay unit and architecture tests: 187 passed, 0 failed across rail rendering, record projection, mount ownership, and surface architecture.
- Overlay TypeScript typecheck: passed.
- Overlay i18n check: passed.
- Overlay Vite production build: passed.
- Node browser rail test: passed after proving the one-record state, `workspace.left == leftResizer.right`, `host.left == workspace.left`, absolute transparent overlay styling, the unaffected three-column message grid, and the 57-record large-history state in the same isolated real application bundle.
- Historical docs links, document health, and product-doc single-source checks passed: 81 tests, 0 failures.
- Scoped and whole-worktree `git diff --check`: passed.

## Visual review

- `.scratch/conversation-agent-rail-scroll-browser/single-activity-left-rail.png`: personally reviewed at 1600×760. The workspace's rounded left edge remains immediately after the Dock's one-pixel resizer, while one short persistent tick floats about 23 pixels inside the workspace on a transparent overlay. The message card and composer remain independently centered.
- `.scratch/conversation-agent-rail-scroll-browser/left-rail.png`: personally reviewed. The large history remains a restrained vertical stack of short ticks on the same transparent workspace-edge overlay; the active tick is stronger without hiding inactive ticks.
- The user's running OpenCorvus/Overlay was not refreshed, restarted, closed, or otherwise manipulated. All rendering used the isolated Node browser fixture.

## Second review

- The causal chain is now explicit and evidence-backed: three persisted Agent sessions existed → `records().length > 3` evaluated false → Solid emitted no rail `<aside>` → the existing `:empty` rule removed the host column. Task/session titles were used only for display and never as causal evidence.
- The repair removes the presentation gate instead of teaching the store to fabricate a fourth record, lowering an arbitrary threshold, or scanning cards as a fallback.
- `conversationAgentRecordsForSource` remains the single activity source, `ConversationAgentRail` remains the single renderer, and `App.tsx` remains the single mount owner. Moving that mount retires the entire message-grid coupling rather than maintaining two placement modes.
- Browser geometry proves `workspace.left == leftResizer.right`, `host.left == workspace.left`, the host is absolute and transparent, and `conversationBody.left == workspace.left`; the message grid remains three columns. The requested Codex ownership is therefore a non-layout workspace-edge overlay, not an inserted Dock column or optical message-card offset.
- Concurrent changes appeared after the clean starting snapshot in `conversation.css`, `conversation-scroll-bottom-button.test.ts`, and later hunks of the shared browser fixture. They are preserved but excluded from this task's staged patch and commit.
