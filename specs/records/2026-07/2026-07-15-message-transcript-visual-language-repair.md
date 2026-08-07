# Message Transcript Visual Language Repair

## Recall

### User requirements

- Repair the current agent transcript because the outer border is visually heavy, typography changes size without a coherent hierarchy, and the surface has no clear visual focus.
- Make the transcript minimal without hiding or fabricating execution evidence.
- Start implementation and continue through real rendered screenshots and visual correction.

### Acceptance criteria

- Agent turns render as an editor-like transcript rather than bordered cards: no agent-sized hover outline, no outer card shadow, and no nested-card visual framing.
- The transcript has one stable visual anchor per agent turn: persistent identity, readable narrative, and a restrained execution summary.
- Narrative remains visible by default; reasoning, tool calls, and patches are collapsed by default and remain fully inspectable after expansion.
- The execution summary removes the redundant `Activity N` / `执行 N` wrapper and reports only meaningful typed counts.
- Transcript typography uses a coherent local hierarchy backed by existing shared tokens: strong agent identity, body-scale narrative, secondary metadata, and compact machine details.
- Expanded execution remains one chronological rail and preserves the existing one-line tool-header authority.
- Existing user, child-agent, delegated-context, interaction, artifact, action, keyboard-focus, and error behavior remains intact.
- Isolated desktop light and dark screenshots are captured and personally reviewed; any visible mismatch is corrected and recaptured.

### Hard constraints

- Follow `AGENTS.md`; no fallback, compatibility renderer, gate, synthetic message, hidden stream, duplicated state, or keyword-driven presentation rule.
- Keep `ChatBubble` as the single top-level turn owner and `CardParts` as the single message-part renderer.
- Reuse existing Solid and shared `Button` / token primitives; do not introduce a parallel design system or new UI dependency.
- Do not restart, refresh, kill, or otherwise interfere with the user's running OpenCorvus or Overlay. Browser validation uses an isolated server and Node-started browser tooling on Windows.
- Preserve all unrelated dirty worktree changes. In particular, do not overwrite the concurrent one-line tool-header work in `card.css`, its fixture, tests, or task record.
- Commit subjects must start with `dsw-33987`; delivery is pushed to the `myhexin` git-cc remote on `v0.0.3beta`.

### Hard-disk sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-08-overlay-codex-font-size-alignment.md`
- `specs/records/2026-07/2026-07-11-multi-agent-message-panel-redesign.md`
- `specs/records/2026-07/2026-07-15-tool-call-single-line-authority.md`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/styles/tokens/design-language.css`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/src/styles/surfaces/messages.css`
- `packages/overlay/src/styles/surfaces/conversation.css`
- focused static and browser tests for chat bubbles, message parts, disclosure, chronology, and agent summaries

### Whole-repository search evidence

- `Conversation.tsx` routes top-level `message` and `agent` nodes to `ChatBubble`; `ChatBubble.tsx` has three `CardParts collapseWorkDetails` call sites for the top-level agent, direct messages, and child agents.
- `Card.tsx` has the only other collapsed `CardParts` call site, so changing `ExecutionPartRun` updates every canonical collapsed execution surface without adding a renderer.
- `CardParts.tsx` exclusively owns execution grouping, typed count summaries, delegated-context disclosure, and the chronological execution rail.
- `chat-bubble.css` exclusively owns the agent turn surface, persistent identity, hover action chrome, narrative typography, and child-agent branch geometry.
- `messages.css` exclusively owns work-summary, delegated-context, reasoning, patch, execution-rail, and nested tool presentation inside transcripts.
- `card.css` owns flattened message boundaries and shared tool headers, but it already contains unrelated uncommitted one-line tool-header work; this task will not edit that file.
- English and Chinese execution-summary keys exist only in `en-US.json`, `zh-CN.json`, `CardParts.tsx`, and focused i18n tests.
- Existing browser coverage already asserts that work details are collapsed by default. The current production source uses `useDisclosure(true)`, and the Node browser baseline fails with actual `aria-expanded="true"` versus expected `false`; this is a proven source/acceptance regression.

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. The main agent will perform the required second diff, behavior, and screenshot review.

## Root cause

The July message redesign established the correct ownership model but its visual hierarchy regressed in three connected places. First, `ExecutionPartRun` now initializes open, exposing every reasoning/tool event and turning secondary evidence into the dominant surface. Second, the agent hover/focus treatment paints a full-width background plus outline around an otherwise borderless turn, recreating the card frame the redesign intended to remove. Third, identity, status, time, summary, and narrative all select similar shared font tiers without local emphasis, while flattened boundary labels and expanded execution add competing small tiers. The result is not merely incorrect spacing: the transcript lacks one stable reading hierarchy.

## Implementation plan

1. Restore the canonical disclosure contract in `CardParts`: execution details start collapsed, typed counts remain the single summary, and the redundant total-activity wrapper is removed from both locales.
2. Redesign the existing `ChatBubble` surface in place: remove full-turn hover outline/background, introduce a quiet identity anchor and controlled readable measure, strengthen the agent title, subordinate status/time, and preserve hover/focus actions without layout movement.
3. Restyle the existing execution summary and rail in `messages.css` as one restrained inset work surface. Keep expanded nested reasoning and tools flat, preserve one-line tool headers, and use status color only for live/current evidence.
4. Add or update focused source and browser regressions for default collapse, absent agent frame, typography hierarchy, readable measure, summary wording, expanded rail, focus, and light/dark rendering.
5. Run focused tests, Overlay typecheck/build, i18n and spec health, inspect real isolated desktop screenshots, correct visual defects, then perform a second diff review.
6. Commit only this task's files with a `dsw-33987` subject, merge/fetch the current git-cc branch if required, and push `v0.0.3beta` to `myhexin` without including unrelated dirty worktree changes.

## Verification plan

```powershell
bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/message-embed.test.ts packages/overlay/test/message-part-render-order.test.ts packages/overlay/test/conversation-rendering-i18n.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-summary-card-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts
git diff --check
```

Browser review must cover desktop light default, expanded execution, dark default, keyboard focus, and the existing long one-line tool header. Screenshots must be produced from the isolated real Overlay bundle and inspected rather than inferred from Document Object Model geometry alone.

## Implementation summary

- `CardParts` now initializes the canonical execution disclosure closed and builds its visible label directly from typed tool/reasoning/patch counts. The redundant total `Activity N` / `执行 N` locale key was deleted rather than retained as an unused compatibility string.
- `chat-bubble.css` now renders agent turns as a bounded editor transcript: the shell stops at the shared `960px * --ui-scale` readable measure, the full-turn radius/outline/hover wash is gone, and a short token-driven role anchor supplies the visual focus.
- Agent title, status, duration, timestamp, narrative, and machine text now use an explicit three-tier local hierarchy backed by the existing shared font tokens. No literal font-size or parallel typography token was added.
- `messages.css` now renders the canonical execution disclosure as one quiet inset work surface. The collapsed summary and delegated context use the same visual language; expanded reasoning, tools, outputs, and patches remain a single chronological rail without nested card chrome.
- Flattened message boundaries remain visible and chronological but lose the dashed all-caps visual interruption inside chat bubbles.
- Focused static and browser regressions now prove default collapse, typed-only summary wording, absence of agent framing, readable measure, title-versus-metadata hierarchy, token-driven anchor geometry, light/dark screenshots, expanded work details, and long one-line tool headers.
- The message chronology fixture now first proves the canonical collapsed state, activates the real disclosure button, and only then performs expanded chronology/tool assertions.
- The fixture's visible-element wait helper was repaired to use the repository browser adapter's supported `$eval` API. A second custom navigation timer was removed because the shared browser sidecar already owns the true activity-refreshed timeout; retaining both produced contradictory timeout sources and false failures.

## Validation

- Focused Overlay unit tests: 13 pass, 0 fail.
- Overlay TypeScript typecheck: passed.
- Overlay i18n check: passed.
- Overlay Vite production build: passed.
- Combined Node browser run:
  - `agent-summary-card-browser`: passed.
  - `chat-bubble-disclosure-button-browser`: passed.
  - `message-part-chronology-browser`: passed.
- Focused architecture guards for token-only `chat-bubble.css` and the new borderless anchor contract: passed.
- `git diff --check` on this task's delivery files: passed.
- Historical docs link scan: passed.
- Full `overlay-architecture-guards.test.ts` and full document health currently also report unrelated failures from concurrent dirty-worktree changes in the right Dock, Composer, Inspector, Work Ledger, generated workflow, and the separate untracked tool-call record. This task did not change, revert, stage, or conceal those surfaces.

## Visual review

- Light default: `.scratch/overlay-codex-message-expanded-default.png`.
  - Reviewed: the agent surface has no outer border or hover card wash; the 960px reading measure prevents full-window lines; identity is the strongest label; narrative stays open; execution is one quiet collapsed summary.
- Light expanded: `.scratch/overlay-codex-tool-reasoning-expanded.png`.
  - Reviewed: reasoning, tool, output, and patch remain on one restrained rail; there is one work-surface background and no card-inside-card framing.
- Dark default: `.scratch/overlay-transcript-dark-default.png`.
  - Reviewed: the role anchor and identity remain legible without neon emphasis; the collapsed work surface separates from the canvas through palette tokens rather than a border.
- Dark expanded: `.scratch/overlay-transcript-dark-expanded.png`.
  - Reviewed: hierarchy and rail contrast survive the dark palette. The white sandboxed embed is fixture-owned iframe content and is intentionally outside transcript visual ownership.
- Long tool header: `.scratch/tool-call-single-line.png`.
  - Reviewed: tool name, duration, and long summary remain on one line with ellipsis while the later Mission boundary and narrative remain chronological.

## Second review

- Diff review confirms no new renderer, state source, fallback, compatibility selector, hidden message, hard-coded color, literal font size, or route/store change.
- `ChatBubble` and `CardParts` remain the only canonical owners named by current architecture.
- The existing concurrent `card.css` one-line tool-header work was not edited by this task; browser evidence confirms the transcript redesign composes with it.
- Final screenshots were inspected after the combined browser run, not reused from an earlier build.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, killed, or otherwise manipulated. All browser work used isolated test processes that were allowed to terminate naturally; the single manually started fixture server was stopped after its diagnostic check.

## Follow-up Recall: turn-scoped execution aggregation

### User requirement

- Consecutive tool/reasoning activity belonging to the same visible agent turn must render as one aggregate disclosure. Repeating `Tools N` / `Thinking N` pills inside one turn is noise and is not acceptable.
- The agent rail must remain visibly present without hover whenever the selected source has more than three activity records. Hover/focus may emphasize one tick, but must not reveal the rail itself.

### Acceptance criteria

- A single `CardParts` turn/context region renders at most one execution disclosure, even when narrative text or a flattened message boundary occurs between execution parts.
- The one disclosure summary totals every reasoning, tool, and patch part in that region.
- Narrative and boundary parts remain visible in their original relative order; execution evidence remains fully inspectable after expanding the single disclosure.
- A delegated-context disclosure remains its own explicit context region and does not leak hidden context activity into the surrounding turn summary.
- Unit and real Node-browser tests prove that interleaved `reasoning → tool → boundary → text → tool → reasoning` produces exactly one toggle and one expanded execution rail.
- A real rendered screenshot is inspected before delivery. The user's running OpenCorvus/Overlay process is not restarted or refreshed.
- With four or more real rail records, every rail tick is visible at rest and remains visible after pointer/focus interaction; with three or fewer records, the rail mount remains empty.

### Hard constraints and sources recalled

- Re-read this record's original Recall, root cause, ownership model, validation history, and second review before modifying code.
- Re-read `AGENTS.md` from the current user message and the browser-control skill for the required visual workflow.
- Preserve `CardParts` as the single message-part renderer and `message-part.ts` as the single part classification/partition source. Do not aggregate in CSS, `Conversation`, or a second renderer.
- Do not change tree-writer ownership: the screenshot's repeated pills are proven to originate from `partitionMessagePartRenderRuns`, whose current contract deliberately terminates an execution run at narrative/boundary parts.
- Full-repository grep found only two production call sites for the relevant API: its definition in `src/utils/message-part.ts` and its use in `CardParts.tsx`. The only direct unit caller is `message-part-render-order.test.ts`; browser coverage is owned by the message chronology fixture/test plus broader disclosure tests.
- Rail grep confirms `ConversationAgentRail.tsx` is the only record-to-rail renderer, `App.tsx` owns its single mount, and `conversation.css` alone owns tick opacity. The current regression is explicit: `.conversation-agent-rail` initializes `--conversation-agent-rail-tick-opacity: 0` and changes it to full only under `:hover/:focus-within`; `conversation-agent-rail.test.ts` currently enforces that incorrect hover-reveal contract.
- Preserve unrelated dirty files in expert-squad, session, orchestrator, protocol E2E, and dashboard work.
- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents.

### Follow-up implementation plan

1. Replace adjacency-based execution partitioning with turn-scoped collection: insert one execution run at the first execution position, collect all execution parts into it, and keep non-execution parts in source order.
2. Replace the old unit assertion that demanded a second in-place execution run with assertions for one aggregate run and complete typed counts.
3. Extend the real browser chronology fixture with later tool/reasoning activity and prove there is one toggle, one combined label, one expanded rail, and preserved narrative/boundary ordering.
4. Run focused unit tests, Overlay typecheck/build/i18n, the Node browser test, inspect the screenshot, perform a second diff review, then commit and push only this follow-up.
5. Replace the rail's hover-reveal contract with a truthful `records.length > 3` render threshold and full resting opacity. Update static and Node-browser coverage to prove four-plus records remain visible before hover and that hover changes emphasis only.

### Follow-up implementation and validation

- `partitionMessagePartRenderRuns` now emits one execution run at the first execution position and collects every reasoning/tool/patch part in that visible turn/context region into it. Non-execution parts retain their source-relative order and remain outside the disclosure.
- `ConversationAgentRail` now uses the explicit `AGENT_RAIL_VISIBILITY_RECORD_THRESHOLD = 3` contract. The mount is empty through three records and renders on the fourth; rendered ticks use full resting opacity.
- The retired `.conversation-agent-rail:hover/:focus-within` reveal selector was deleted. Pointer/focus still controls proximity width, text-strong active color, the canonical Kobalte detail tooltip, and locate behavior.
- Focused unit tests: 19 passed, 0 failed.
- Focused architecture guards: 2 passed, 0 failed.
- Overlay TypeScript, i18n, and production Vite build passed.
- Node browser chronology test passed with one `Tools 2 · Thinking 2` toggle and four expanded execution events across an intervening boundary/narrative.
- Node browser rail test passed with more than 40 real records, non-zero resting tick opacity, unchanged opacity after hover, one canonical detail tooltip, exact 2px tick thickness, scrolling, grouping, and locate behavior.
- Scoped `git diff --check` passed.

### Follow-up visual review

- `.scratch/message-part-chronology-component.png`: personally reviewed; one expanded work surface contains both tools and both reasoning entries, followed by the original Mission boundary and narrative. No second execution pill exists.
- `.scratch/conversation-agent-rail-scroll-browser/left-rail.png`: personally reviewed; the long rail remains fully legible at rest, with one restrained active tick and all remaining ticks visible.
- `.scratch/conversation-agent-rail-scroll-browser/chat-section-after-locate.png`: personally reviewed; the persistent rail sits immediately left of the centered transcript and does not shift the message/composer axis.
- `.scratch/conversation-agent-rail-scroll-browser/chat-section-ambient-dark.png`: personally reviewed; inactive ticks remain visible against the dark canvas without overpowering the transcript.

### Follow-up second review

- No CSS-only fake grouping, duplicate renderer, derived message store, fallback, compatibility selector, hidden evidence, or hover-dependent rail visibility remains.
- Delegated context still owns a separate explicit disclosure and therefore remains an intentional aggregation boundary.
- The outdated browser assertion that expected zero tooltip nodes contradicted the production Kobalte tooltip and its static architecture test. It now verifies exactly one canonical tooltip rather than deleting useful detail behavior.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, killed, or otherwise manipulated. All visual evidence came from isolated Node-started fixtures.
- Unrelated dirty expert-squad, runtime, shell, Git, protocol, and benchmark files remain untouched and unstaged.

## Correction Recall: chronological aggregation and empty-message suppression

### User evidence and failed behavior

- The delivered aggregation is rejected. The screenshot shows `Tools 45 · Thinking 11` moved ahead of later narrative messages, followed by many `Architect + timestamp` boundary rows with no visible body.
- The user explicitly requires message-stream ordering and rejects rendering an empty text body/boundary as visible transcript content.

### Root cause

- The previous `partitionMessagePartRenderRuns` implementation removed every execution part from its source position and inserted the complete aggregate at the first execution position. That preserved only execution-to-execution order inside the aggregate; it did not preserve the total message stream order relative to narrative and boundaries.
- `tree-writer.ts` legitimately inserts a boundary before every later message in a flattened same-session segment. After tool/reasoning parts were extracted, tool-only messages retained their boundary but no visible body, producing the empty `Architect + timestamp` rows.
- `RenderableCardPart` already suppresses whitespace-only text, so the visible defect is not a CSS spacing issue. It is the combination of destructive partitioning and unconditional boundary rendering.

### Corrected acceptance criteria

- One visible turn/context region still owns exactly one execution disclosure control.
- Expanding that control restores reasoning/tool/patch events at their exact positions relative to boundaries and narrative; the rendered visible sequence must equal the authoritative `parts` sequence after non-display control/empty content is removed.
- Collapsing hides execution events in place without moving narrative. A boundary remains visible only when its following message segment contains visible narrative/body content; a tool-only or whitespace-only message contributes zero collapsed body DOM.
- Whitespace-only text never creates a message body, separator, boundary-only row, or layout gap.
- The execution summary count is derived from the same in-order source parts and is not treated as a timeline event.
- Delegated context remains a separate explicit aggregation region.
- Real Node-browser assertions cover collapsed and expanded order, exactly one toggle, tool-only boundary suppression, whitespace-only text suppression, and screenshot review.

### Recalled sources and whole-repository call sites

- Re-read the complete prior Recall and correction history in this file, `CardParts.tsx`, `message-part.ts`, the chronology fixture/browser test, and the browser-control skill before editing.
- Full grep confirms `tree-writer.ts` is the only production boundary creator; `CardParts.tsx::RenderableCardPart` is the only boundary DOM renderer; `partitionMessagePartRenderRuns` has one production caller in `CardParts.tsx` and one direct unit-test caller.
- `card-tree.ts` and `screenshot-browser.ts` consume boundaries for segmentation/evidence and must not be changed. The fix belongs solely to rendering/partition projection, not source persistence.
- `messagePartHasNarrativeContent` currently has no production caller and is the canonical existing classifier to reuse for boundary visibility instead of creating a parallel rule.
- Unrelated staged spec/index work and untracked dashboard artifacts must remain untouched.
- No sub-agent is used because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents.

### Corrected implementation plan

1. Restore adjacent source-order runs and give the turn one disclosure owner; do not relocate any execution event in the timeline.
2. Make the disclosure owner iterate every run in source order: execution entries render conditionally in place; narrative entries remain always visible; boundaries render collapsed only when their following segment has narrative content.
3. Add pure projection helpers/tests for boundary visibility and whitespace-only segments, then extend the real chronology fixture with tool-only and empty-text messages.
4. Validate collapsed and expanded DOM order, inspect new screenshots, rerun typecheck/build/i18n and focused architecture tests, then commit/push the correction.

### Corrected implementation and validation

- The rejected first-position aggregate projection has been removed. `partitionMessagePartRenderRuns` again produces adjacent chronological body/execution runs and records each run's authoritative source index.
- `ChronologicalCollapsedParts` owns exactly one disclosure state for the turn. It renders expanded execution runs in their original locations, keeps narrative runs in place in both states, and places the count-only disclosure control after the chronological content as a turn appendix rather than a timeline event.
- `boundaryMessageHasNarrativeContent` reuses the canonical narrative classifier and scans only the message segment immediately following a boundary. In collapsed mode, tool-only and whitespace-only segments therefore contribute no boundary row, text body, separator, or gap.
- The browser fixture now includes execution before and after narrative plus a later tool-only message containing whitespace text. Collapsed assertions require one boundary, one text body, and one `Tools 3 · Thinking 2` control; expanded assertions require the exact authoritative sequence through all five execution events and both message boundaries.
- Focused unit tests passed: 30 passed, 0 failed. Focused architecture guards passed: 2 passed, 0 failed.
- Overlay TypeScript, i18n, production Vite build, and the isolated Node-browser chronology test passed.
- Scoped `git diff --check` passed.

### Corrected visual review

- `.scratch/message-part-chronology-collapsed.png`: personally reviewed; the narrative-bearing Mission row remains in message order, the tool-only/whitespace-only message leaves no empty `Architect + timestamp` row, and the single execution summary sits at the end of the turn.
- `.scratch/message-part-chronology-component.png`: personally reviewed; expanding restores `reasoning → tool → boundary → narrative → tool → reasoning → boundary → tool` in source order, with the same single summary control at the end and no floating tooltip obscuring evidence.

### Corrected second review

- The earlier “collect at first execution position” implementation and its visual evidence are explicitly superseded by this correction; they are retained above only as failure history, not as an accepted contract or compatibility path.
- Source persistence, `tree-writer.ts`, card segmentation, delegated-context ownership, and the agent rail were not changed. There is no second message store, fallback renderer, CSS filtering trick, or hidden synthetic message.
- Empty content suppression is semantic: whitespace text is already zero-DOM, while a collapsed boundary is emitted only when its own following message contains visible narrative. Expanded mode still exposes real tool-only message boundaries and execution evidence in exact order.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, killed, or otherwise manipulated; screenshots came from the isolated Node browser fixture.

## Agent-card separation Recall

### User requirement and visual diagnosis

- The user clarified that “message-card separation” means the boundaries between cards owned by different agents, not message boundaries inside one agent turn.
- The current top-level agent surface is transparent and owns only a short 34px accent mark. On the shared transcript canvas, adjacent agents therefore read as one continuous document; repeated identity headers and wide content do not create a perceptible start/end boundary.
- The requested trial must separate different agents without returning to the rejected heavy four-sided frame. The intended language is a quiet independent surface, a full-height identity accent, stable card spacing, and one consistent typography scale.

### Acceptance criteria

- Every top-level agent turn has a visible resting surface and full-height stage/role accent; the boundary cannot depend on hover or focus.
- Adjacent agents have measurable vertical separation and do not share a separator line.
- The surface uses existing theme and stage tokens, remains readable in light and dark themes, and adds no hard-coded per-agent palette or duplicated identity source.
- User messages retain their current right-aligned treatment. Tool cards, message chronology, execution aggregation, delegated context, and the persistent agent rail remain unchanged.
- Nested agent children receive the same identity grammar at reduced emphasis, rather than looking like unowned text inside the parent.
- A real component fixture renders at least three different agents together. Node-browser assertions and personally inspected light/dark screenshots verify card separation, identity accents, spacing, and the absence of a four-sided border.
- The user's running OpenCorvus/Overlay process is not restarted or refreshed. This trial is not pushed.

### Recalled sources and whole-repository call points

- `ChatBubble.tsx` is the single top-level renderer for both `message` and `agent` conversation nodes. It already injects the canonical `stageAccent` value through `--card-stage`; no second agent-color map is needed.
- `ChatBubbleChild` is the only nested agent/message wrapper. It currently exposes `data-kind`, `data-stage`, and `data-status`, but nested agents inherit the parent accent; the implementation must project the child's existing normalized role through the same `stageAccent` source.
- `chat-bubble.css` is the only owner of `.chat-bubble-row`, `.chat-bubble`, identity chrome, child hierarchy, and current short accent mark.
- Static contracts live in `chat-bubble.test.ts`, `chat-bubble-role-distinction.test.ts`, `conversation-agent-message-grouping.test.ts`, and `overlay-architecture-guards.test.ts`. Real rendered behavior is covered by the browser fixtures around `ChatBubble`; a focused multi-agent fixture is required because existing disclosure fixtures contain only one agent.
- `Conversation.tsx` consumes the row/body geometry for virtual scrolling and must not be changed. `CardParts`, tree writer, agent rail, and card stores are outside this visual-only ownership change.
- Re-read the browser-control skill before browser work. No sub-agent is used because the user did not request delegation.

### Implementation plan

1. Replace the short top-level accent fragment with one full-height accent on a quiet token-based agent surface; use spacing and elevation rather than a hard outer border.
2. Give nested agent children a lower-emphasis version of the same surface and inject their own canonical stage accent from `ChatBubble.tsx`.
3. Update static ownership tests and add a real multi-agent component fixture/test with light and dark screenshots.
4. Run focused tests, typecheck/i18n/build, inspect both screenshots, and iterate until the cards are immediately distinguishable without visual heaviness.

### Agent-card separation implementation and validation

- The transparent top-level agent surface was replaced by a quiet theme-derived surface with an 8px token radius, restrained elevation, 16px real inter-card separation, and no four-sided border.
- The former 34px accent fragment now spans the full agent card height at 3px. It uses the existing `--card-stage` projection and becomes fully saturated only for a running agent.
- Nested agent children use a lower-emphasis version of the same surface and a 2px full-height identity accent. `ChatBubbleChild` now projects the child's normalized role through the same canonical `stageAccent` helper instead of inheriting the parent identity.
- User message styling, message boundaries, execution chronology, delegated context, tool cards, virtual-scroll ownership, and agent rail rendering were not changed.
- A real Solid component fixture renders Architect, Frontend Research, and Build cards together. Its Node-browser test proves three distinct accent colors, non-transparent resting surfaces, zero outer border widths, at least 8px radius, full-height accents, elevation, and at least 16px measured separation.
- Focused ChatBubble tests passed: 13 passed, 0 failed. Focused architecture guards passed: 3 passed, 0 failed. The new Node-browser visual test passed: 1 passed, 0 failed.
- Overlay TypeScript, i18n, and production Vite build passed. The existing large-chunk advisory remains a non-failing build warning and is outside this surface-only change.

### Agent-card separation visual review

- `.scratch/agent-card-separation-light.png`: personally reviewed; the three agents read as separate owned regions without hard frames, while identity color remains limited to the avatar and left accent.
- `.scratch/agent-card-separation-dark.png`: personally reviewed after fixing the fixture's theme-transition capture; card-to-canvas contrast remains quiet and all identity/text contrast stays legible.
- The first rendered attempt exposed only 9px effective separation because adjacent block margins collapse. The assertion was kept strict and the production margin was corrected to a measured 16px before the accepted screenshots were captured.

### Agent-card separation second review

- The change adds no new color registry, fallback selector, hover-gated boundary, duplicated Agent renderer, or hard-coded palette value. The surface and accent are always present at rest.
- Second-pass diff review caught and removed `overflow: hidden` from nested Agent surfaces because it would have clipped the existing parent-child connector pseudo-element; the top-level rounded surface retains clipping, while nested hierarchy evidence remains intact.
- The general `.chat-bubble` primitive remains borderless and transparent for non-agent roles; only the existing `[data-kind="agent"]` specialization owns the new surface, so user/system semantics are not conflated.
- The real browser fixture mounts the production `ChatBubble` component rather than reproducing its DOM by hand. The user's running OpenCorvus/Overlay process was not restarted or refreshed.
- Per the user's instruction, this trial is left in the current worktree and is not pushed.
