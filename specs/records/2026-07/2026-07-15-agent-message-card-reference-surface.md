# Agent Message Card Reference Surface

## Recall

### User requirement

- Move the message-card rendering toward the supplied desktop reference image.
- The request is explicitly about visual style, not message logic.

### Acceptance criteria

- Top-level Agent turns use one low-saturation tinted surface with a visible one-pixel token-backed outline, a generous large radius, and reference-like internal spacing.
- The identity row is the stable header: avatar, title, and status stay on the leading side; persisted duration/timestamp metadata and existing actions remain readable without changing their sources or behavior.
- Narrative and execution details remain inside the same card surface. When execution details are expanded, their chronological rail reads as a clean list of compact rows similar to the reference instead of a nested card stack.
- Light and dark themes keep legible contrast and restrained tinting. Running, completed, and error semantics continue to come from existing status and stage tokens.
- User messages, child-agent ownership, tool rendering, disclosure state, part ordering, copy/rewind/trace/reply actions, timing, and all backend/store contracts remain unchanged.
- Real isolated desktop light and dark screenshots are captured, inspected, and corrected before delivery.

### Hard constraints

- Follow `AGENTS.md`: no fallback, compatibility path, second renderer, state machine, hidden message, synthetic evidence, duplicated source, or hard-coded color.
- Treat the supplied screenshot as visual direction, not authorization to reproduce its breadcrumb, task-history section, data model, or execution logic.
- Reuse the existing Solid components, shared `Button` primitive, design-language tokens, `ChatBubble` owner, and `CardParts` renderer.
- Desktop only. Do not add tablet/mobile scope.
- Do not restart, refresh, stop, or otherwise interfere with the user's running OpenCorvus/Overlay. Visual validation uses the existing isolated Node-started browser fixture.
- Preserve the large unrelated dirty worktree. This task may stage and commit only its scoped Overlay/spec files.
- Commit subjects start with `dsw-33987`; push the current `v0.0.5beta` branch to the `myhexin` git-cc remote.

### Hard-disk sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`
- `specs/records/2026-07/2026-07-14-overlay-tool-call-timing-tooltip.md`
- `specs/records/2026-07/2026-07-11-agent-message-card-action-icons.md`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/src/components/CardHeader.tsx`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/src/styles/surfaces/messages.css`
- focused unit/browser tests and the existing Agent-card separation fixture
- supplied reference image `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-c48b4bce-65c7-4407-9a8d-cc48100dde67.png`

### Whole-repository search evidence

- `Conversation.tsx` is the only top-level router into `ChatBubble`; `ChatBubble.tsx` has the three canonical collapsed `CardParts` call sites for top-level agents, direct child messages, and child agents.
- `Card.tsx` has the only other collapsed `CardParts` call site for non-chat card surfaces. No new renderer is needed.
- `chat-bubble.css` is the only owner of top-level Agent card surface, identity/header, hover actions, body rhythm, and child-agent branch geometry.
- `messages.css` is the only owner of `.msg-work-details`, its toggle, chronological rail, event dots, nested tool flattening, reasoning, and patch presentation.
- `chat-bubble.test.ts` currently enforces the old no-border left-accent surface; `message-embed.test.ts` enforces the execution-detail visual contract.
- `agent-card-separation-browser.test.ts` is the isolated Node-started light/dark screenshot owner for Agent surfaces. Its fixture currently contains three agent states but no execution rows; it can be extended with real `CardParts` fixture data and the real disclosure control without changing production logic.
- Broader browser tests address disclosure interaction, chronology, links, image previews, scrolling, timing, and tool rendering. They consume the same selectors and remain regression coverage rather than alternative presentation sources.
- Scoped `git diff` confirmed all intended production/test files were clean before this task. The unrelated dirty worktree is outside `packages/overlay/**` and this new record/index update.

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. The main agent owns the required second review.

## Root cause and visual direction

The existing July redesign is structurally correct but visually points in the opposite direction from the new reference. It minimizes the outer boundary and uses a role-colored left bar, while the reference derives hierarchy from a softly tinted contained surface, a thin outline, a generous radius, and a compact header over one chronological activity list. Recreating task-history or changing disclosure behavior would violate the user's explicit style-only boundary. The correct change is therefore a direct restyle of the existing canonical surfaces.

## Implementation plan

1. Replace the top-level Agent turn's left-accent/shadow treatment in `chat-bubble.css` with a token-backed tinted card, one-pixel border, large radius, and reference-like header/body spacing. Preserve user-message and child-agent contracts.
2. Restyle the existing `.msg-work-details` toggle and expanded chronological rail in `messages.css` so it sits naturally inside the same card and reads as compact rows without nested card chrome.
3. Update focused source guards to assert the new visible border/tint/radius contract while retaining all no-logic-change assertions.
4. Extend the isolated Agent-card fixture with real reasoning/tool/patch parts, expand it through the real disclosure button, and verify light/dark geometry, status contrast, header alignment, and chronological row rendering.
5. Run focused unit tests, Overlay typecheck/build/i18n, spec health, and the Node browser fixture. Inspect both screenshots, correct any visual mismatch, then rerun and perform a second diff review.
6. Commit only task files with a `dsw-33987` subject and push `v0.0.5beta` to `myhexin`.

## Verification plan

```powershell
bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/message-embed.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-card-separation-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation and validation

- `chat-bubble.css` now gives top-level Agent turns one low-saturation stage-tinted surface, one token-backed outline, the existing large radius, reference-like padding, and no shadow or parallel full-height identity rail.
- The canonical identity row remains unchanged in `ChatBubble.tsx`. CSS gives its persisted duration natural trailing alignment while avatar/title/status remain leading and the existing hover/focus action toolbar retains its behavior.
- `messages.css` now lets the existing work disclosure fill the Agent surface, uses a quiet token-backed summary tint, and strengthens the existing chronological rail/event spacing without adding a renderer or changing disclosure/order semantics.
- The isolated Agent fixture now carries production-shaped text, reasoning, tool, and patch parts with canonical part order keys. Its browser test activates the real disclosure button and verifies three typed execution events, the visible rail, card border/background/radius/padding, and light/dark screenshots.
- Focused unit plus architecture guards passed: 135 tests, 0 failures, 8,349 expectations.
- Overlay TypeScript typecheck passed.
- Overlay i18n check passed.
- Overlay Vite production build passed as part of the full disclosure browser run.
- Node browser Agent-card separation test passed.
- Node browser disclosure/hover/keyboard/tool-expansion test passed.
- Node browser message chronology test passed.
- Product documentation single-source tests passed: 4 tests, 0 failures.
- `git diff --check` passed.
- The combined historical/document-health run has two unrelated dirty-worktree failures: `specs/records/2026-07/README.md` already references missing `2026-07-15-current-wip-batched-push.md`, and concurrent `packages/opencorvus/src/expert-squad/payload.ts` edits reference missing `docs/merge/**` / `docs/todos/**` paths. This task did not remove those references or manufacture records for another in-progress change.

## Visual review

- `.scratch/agent-card-separation-light.png`: reviewed after activating the running card's real disclosure. Three Agent identities remain distinct; each card has the reference-directed tinted fill, thin outline, generous radius/padding, right-aligned time metadata, and clear inter-card rhythm. The running card shows one compact Reasoning / Read / Patch rail inside the same surface.
- `.scratch/agent-card-separation-dark.png`: reviewed after the same real interaction. Stage tints remain restrained against the dark canvas, outlines stay visible without glow/shadow, and the execution rail remains legible.
- `.scratch/overlay-codex-message-expanded-default.png`: reviewed from the production Overlay bundle. The complete narrative/embed/disclosure composition stays inside one pale blue outlined surface with a clear header and no left identity strip.
- `.scratch/overlay-transcript-dark-expanded.png`: reviewed from the production Overlay bundle after expanding execution. Reasoning, tool, output, patch, and the disclosure summary remain chronological and readable inside one surface.
- `.scratch/message-part-chronology-component.png`: reviewed after the dedicated chronology browser test. The stronger rail does not reorder narrative boundaries or split the single execution disclosure.

## Second review

- Scoped source diff contains only `chat-bubble.css` and `messages.css`; no component, store, service, route, schema, message part, timer, disclosure, or ordering implementation changed.
- The old left-accent/shadow contract was replaced directly in source and tests; no compatibility selector, alternate card family, or fallback renderer remains.
- Every new color is derived through existing stage/palette tokens and `color-mix`; there are no new raw colors, literal font sizes, dependencies, or UI primitives.
- Existing user-message styles and child-agent ownership/branch rendering remain untouched.
- The full interaction browser test confirms hover actions, keyboard focus, default collapse, real expansion, tool output, reply disclosure, and click-to-collapse behavior still work.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or used as a test target. All rendered evidence came from isolated Node-started test processes that terminated through their existing harness.

## Follow-up Recall: in-place execution disclosure bars

### Latest user requirement

- Clicking a collapsed execution control must never reveal its tool records above the control.
- Every collapsed execution run needs its own disclosure control at the run's authoritative timeline position.
- The control must read visually as a thin disclosure bar, not as a filled, rounded, or elevated button.
- The expanded execution rail must not render blue event dots or substitute dot-shaped status markers.
- This supersedes the earlier single turn-wide `Tools N · Thinking N` appendix control. It does not authorize any change to tool execution, persisted message data, or source ordering.

### Acceptance criteria

- Each adjacent execution run emitted by `partitionMessagePartRenderRuns` owns one independent disclosure state and one `work-details-toggle` control.
- Expanding a run inserts only that run's reasoning/tool/patch records immediately below its own bar; other runs remain collapsed.
- Narrative text and meaningful boundaries retain their authoritative relative order. Tool-only or whitespace-only message boundaries remain suppressed instead of creating empty transcript rows.
- Each bar summarizes only its own run. No turn-wide summary is appended after the final narrative/body run.
- The bar retains native button semantics and keyboard accessibility through the shared `Button` primitive, while CSS removes button chrome and presents a thin, full-width rule/row.
- The rail retains its quiet vertical guide but removes event-dot markup and the indentation reserved for those dots.
- A real isolated Node-started browser test proves multiple bars, independent expansion, downward geometry, exact expanded chronology, and keyboard operation; the resulting desktop screenshot is personally reviewed.

### Recalled constraints and search evidence

- Re-read `AGENTS.md`, the browser-control skill, this record, the correction history in `2026-07-15-message-transcript-visual-language-repair.md`, `CardParts.tsx`, `message-part.ts`, `CardHeader.tsx`, the message/card CSS owners, and the focused chronology fixture/test.
- Whole-repository grep confirms `CardParts.tsx::ChronologicalCollapsedParts` is the sole owner of the turn-wide disclosure state and trailing control. `partitionMessagePartRenderRuns` is the single chronological run projector and must remain unchanged.
- `.msg-work-details` and `work-details-toggle` presentation is owned only by `messages.css`. Other browser tests consume the selector, but do not own a second renderer or state source.
- The current defect is structural: `ChronologicalCollapsedParts` conditionally emits every `ExecutionEventRun` during the run loop, then appends the sole toggle after that loop. CSS cannot make this DOM ownership expand downward without reordering the timeline.
- The unrelated dirty Orchestrator/prompt files remain untouched. No sub-agent is used because the user did not request delegation.
- The required pre-change git-cc push was attempted after a successful fetch and full pre-push checks, but the remote rejected an unrelated ahead commit whose subject is `Checkpoint before Mirror Watch...` rather than the required `dsw-*` format. This follow-up will not rewrite or amend that unrelated commit.

### Implementation plan

1. Extract one `ExecutionDisclosureRun` component with its own `useDisclosure`, run-local summary, canonical `Button`, and execution body immediately after the control.
2. Replace the turn-wide disclosure state and trailing appendix with one disclosure component at each execution run position. Keep the existing narrative/boundary projection and boundary suppression source.
3. Restyle the canonical control in `messages.css` as a thin full-width bar with no fill, pill radius, or hover block; use existing design tokens only.
4. Update chronology browser coverage for three independent bars, first-run-only expansion, all-run expansion, downward geometry, source chronology, and screenshot evidence. Update static presentation guards to assert the bar contract.
5. Run focused unit/browser tests, Overlay typecheck/i18n/build, inspect the rendered screenshot, perform a second diff review, then commit only scoped files with a `dsw-33987` subject. Retry git-cc push without rewriting unrelated history.

### Follow-up implementation and validation

- `ChronologicalCollapsedParts` no longer owns one turn-wide disclosure or appends a control after the timeline. Each execution run now renders through `ExecutionDisclosureRun` at the run's source position and owns an independent closed-by-default disclosure.
- The run-local body is the immediate sibling after its bar. Expanding the first run therefore reveals only that run below the bar; later narrative and later execution bars retain their positions.
- The disclosure uses the existing shared `Button` primitive for semantics, focus, and Enter activation. Its presentation is a 22px full-width transparent row with zero radius, a chevron, the run-local count, and a one-pixel token-backed rule.
- The blue running marker identified by the user was removed at its exact source: `data-running` and `.msg-work-details__marker[data-running="true"]::after` no longer exist. Execution event-dot markup and its CSS were also deleted, while the quiet one-pixel vertical guide remains.
- Focused unit tests passed: 8 tests, 0 failures, 51 expectations.
- Overlay TypeScript typecheck, i18n check, and production Vite build passed.
- The Node browser chronology test passed with three independent bars, click plus Enter activation, only-first-run expansion evidence, downward geometry, and exact all-run chronology.
- The broader disclosure browser test and Agent-card light/dark browser test passed. The Agent fixture now also asserts zero event-dot nodes and `::after` content `none` on the running disclosure marker.
- Scoped `git diff --check` passed.
- Historical-link and product-documentation single-source checks passed. The combined 78-test document suite has one unrelated dirty-worktree failure because `specs/records/2026-07/README.md` references the concurrent, currently untracked `2026-07-15-task-progress-empty-goal-body-repair.md`; this follow-up neither added that link nor manufactured the missing record.

### Follow-up visual review

- `.scratch/message-part-chronology-collapsed.png`: reviewed; three thin disclosure bars occupy their source positions around the narrative instead of one button-like appendix at the bottom.
- `.scratch/message-part-chronology-component.png`: reviewed; every expanded run starts below its own bar, narrative stays in place, and the rail has no event dots.
- `.scratch/agent-card-separation-light.png`: reviewed after the exact running-state regression rerun; the left side of `Tools 1 · Thinking 1 · Changes 1` contains only the chevron. The blue running dot shown in the user's crop is absent.
- `.scratch/agent-card-separation-dark.png`: reviewed from the final rerun; the same no-dot bar remains legible without a filled button surface.

### Follow-up second review

- Part persistence, tool execution, stores, routes, ordering keys, `partitionMessagePartRenderRuns`, nested-card rendering, and tool-card behavior are unchanged.
- There is one disclosure implementation and one chronological run projector; no fallback, compatibility selector, CSS reordering, duplicate tool renderer, synthetic message, or hidden evidence path was added.
- The control remains an actual accessible button but no longer looks like one. All new colors derive from existing stage/divider tokens.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or used as the test target. Every screenshot came from isolated Node-started fixtures.

## Follow-up Recall: user avatar and shared message-lane alignment

### Latest user requirement

- The outgoing user message card needs a visible user avatar.
- User and Agent message-card alignment must read as one coherent conversation grid.
- The Agent surface must not stop a few pixels or one arbitrary width step before the conversation lane's right edge.

### Acceptance criteria

- Every top-level user row mounts exactly one canonical `Avatar` with normalized `user` role, positioned at the trailing side of the outgoing bubble.
- The user avatar does not restore the rejected user identity/status/duration header. The existing hover-only timestamp and actions remain owned by the user bubble footer.
- The user shell spans the canonical conversation lane, while the outgoing bubble keeps the existing user-card maximum width from `--conversation-user-card-inline-size` and remains right aligned immediately before the avatar.
- Top-level Agent shells consume `--conversation-card-inline-size` directly. No component-local `960px` maximum or avatar-ring row padding may shorten or offset the surface.
- In a fixture wider than 960px, every Agent card's left and right edges match the fixture lane within one rendered pixel. The user avatar's trailing edge matches the same lane edge, and the user bubble sits to its left with a stable token-scaled gap.
- Real isolated light/dark desktop screenshots are captured and personally inspected. The user's running OpenCorvus/Overlay process is not restarted or refreshed.

### Recalled sources and whole-repository evidence

- Re-read `AGENTS.md`, the browser-control skill already active for this task chain, this record, `2026-07-15-user-message-hover-metadata.md`, current card architecture, `ChatBubble.tsx`, `chat-bubble.css`, `conversation.css`, `Avatar.tsx`, focused static tests, and the Agent-card browser fixture/test.
- `ChatBubble.tsx` is the sole top-level bubble owner. Its `Show when={!isUser()}>` deliberately suppresses `ChatBubbleIdentity` for user turns, and no other user-avatar mount exists. The correct addition is one standalone canonical `Avatar`, not restoration of the rejected identity row.
- `conversation.css` defines `--conversation-card-inline-size: 100%` and `--conversation-user-card-inline-size`. `chat-bubble.css` currently duplicates both contracts: Agent shells override the shared width with `min(100%, 960px)`, while user shells hard-code `min(70%, 720px)`.
- `.chat-bubble-row[data-kind="agent"]` alone adds `padding-inline-start: --chat-avatar-ring-outset`; the historical test that enforces it predates the contained Agent surface and now creates asymmetric row geometry. The avatar ring is already inside the card's 18px padding and does not require row-level reservation.
- `Avatar.tsx` is the canonical role-to-icon/accent renderer and already supports `user`. No new avatar mapping, asset, or color source is required.
- `agent-card-separation-browser.test.ts` is the canonical light/dark Agent-surface screenshot owner. Extending its real `ChatBubble` fixture with a user message and a lane wider than 960px proves all three reported defects without a parallel renderer.
- Scoped production/test files were clean before this follow-up. The large unrelated dirty worktree remains out of scope. No sub-agent is used because the user did not request delegation.
- The pre-change git-cc push ran all hooks successfully but lost a concurrent remote ref race after fetch; no unrelated history was rewritten.

### Implementation plan

1. Mount one trailing standalone user `Avatar` as a sibling of the existing user bubble while retaining the body-first, hover-footer topology.
2. Make the base shell the only Agent-width owner by deleting the `960px` override and obsolete Agent row padding. Make the user shell span the lane and constrain only the bubble with the existing conversation user-width variable.
3. Replace the historical row-padding assertion with shared-lane and user-avatar source guards; retain ring styling on the avatar itself.
4. Extend the Agent-card fixture to include a real user message at a width above 960px. Assert Agent edge parity, user avatar presence/role, trailing alignment, bubble/avatar order and gap, then inspect light/dark screenshots.
5. Run focused unit tests, Overlay typecheck/i18n/build, Node browser regression tests, docs health, scoped diff review, commit only task files with `dsw-33987`, fetch current git-cc state, and push without overwriting concurrent work.

### Follow-up implementation and validation

- `ChatBubble` now mounts exactly one canonical trailing `Avatar` for top-level user messages. The user identity/status/duration row remains absent, and the existing timestamp/actions footer remains inside the outgoing bubble.
- The user shell now spans `--conversation-card-inline-size`; only the outgoing bubble is constrained by `--conversation-user-card-inline-size`, leaving an 8px token-scaled gap before the 20px user avatar.
- The Agent-specific `min(100%, 960px)` shell width and row-level avatar-ring padding were deleted. The base shell is the sole width owner, so every contained Agent surface consumes the full canonical conversation lane.
- The browser fixture imports the real conversation width source and renders a real user message plus Agent cards in a 1100px lane. It proves both Agent edges, the user avatar's role/count/trailing edge, and the bubble/avatar order and gap.
- Focused static tests passed: 17 tests, 0 failures, 198 expectations. Overlay TypeScript typecheck and i18n checks passed.
- The production Vite build passed with its existing chunk-size advisory. Historical document health passed: 21 tests, 0 failures, 70 expectations.
- The focused Agent-card browser test and the broader message disclosure/hover browser test both passed. The latter's obsolete 960px ceiling was replaced by a rendered shell-to-row width equality assertion.
- Scoped `git diff --check` passed.

### Follow-up visual review

- `.scratch/agent-card-separation-light.png`: reviewed at 1280px. The user avatar is visible at the outgoing message's trailing edge, and every Agent card shares the same left and right lane edges.
- `.scratch/agent-card-separation-dark.png`: reviewed at 1280px. The same alignment remains legible with dark tokens and no width drift.
- `.scratch/overlay-user-message-rest-page.png`: reviewed on the full isolated Overlay page. The outgoing bubble and avatar read as one right-aligned message unit while the Agent surface spans the content lane below.
- `.scratch/overlay-user-message-hover.png`: reviewed. Timestamp and copy action appear below the bubble without displacing or duplicating the user avatar.

### Follow-up second review

- Message persistence, role normalization, status projection, hover behavior, tool rendering, chronological ordering, and the running OpenCorvus process are unchanged.
- There is one canonical Avatar renderer and one conversation-width source. No fallback width, compatibility selector, duplicate user header, CSS reordering, or parallel message renderer was added.
- The removed 960px assertion was not loosened: it was replaced with direct geometry proving that the Agent shell and authoritative row are equal width.

## Follow-up Recall: remove message-boundary hairlines

### Latest user requirement

- Remove the thin separator line between messages inside every message card.
- This is presentation-only: message boundaries, labels, timestamps, grouping, and chronology must remain unchanged.

### Acceptance criteria

- A non-first `.card-boundary` retains its existing spacing, role label, and timestamp but renders no top border in both generic cards and chat bubbles.
- The `CardParts` boundary node and `isBoundaryMessagePart` projection remain unchanged.
- Real light/dark Agent-card screenshots show multiple message boundaries without horizontal separator lines, while the individual messages remain visually readable through spacing and metadata.

### Recalled sources and whole-repository evidence

- Re-read `AGENTS.md`, the browser-control skill, this record, `CardParts.tsx`, `card.css`, `chat-bubble.css`, and the chronology and Agent-card browser owners.
- Whole-repository grep finds one boundary renderer: `CardParts.tsx` emits `.card-boundary` for `isBoundaryMessagePart`. Its role and timestamp are semantic content and must not be removed.
- The complete line ownership is two CSS declarations: the generic `.card-boundary:not(:first-child)` dashed border in `card.css`, and the more-specific `.chat-bubble .card-boundary:not(:first-child)` solid override in `chat-bubble.css`. Removing only one would expose the other, so both must be changed together.
- `CardParts` is consumed by both `Card.tsx` and `ChatBubble.tsx`; the generic and chat-specific surfaces therefore need one consistent no-line contract rather than a chat-only override or fallback.
- The existing large unrelated dirty worktree remains out of scope. The pre-change git-cc fetch confirms the current branch and remote are synchronized. No sub-agent is used because the user did not request delegation.

### Implementation plan

1. Remove the two boundary `border-top` declarations while preserving their existing margin and padding.
2. Add static guards for the generic and chat-specific no-line contract, and extend the real Agent-card browser test to measure every rendered boundary's top-border width.
3. Run focused tests, Overlay typecheck/i18n/build, Node browser visual regression, inspect light/dark screenshots, review the scoped diff, commit with a `dsw-33987` subject, and push to git-cc.

### Follow-up implementation and validation

- Removed the generic dashed `border-top` and the chat-specific solid `border-top` from non-first message boundaries. Their margin and padding are unchanged.
- `CardParts.tsx`, `isBoundaryMessagePart`, role labels, timestamps, ordering, and message grouping are unchanged.
- Extended the real Agent-card fixture with two multi-message cards. Browser assertions prove both rendered boundaries have a zero-pixel top border while retaining the expected labels and non-empty timestamps.
- Focused static tests passed: 10 tests, 0 failures, 91 expectations. Overlay TypeScript typecheck and i18n checks passed.
- The focused light/dark Agent-card browser test and the broader disclosure browser test passed. The production Vite build passed with its existing chunk-size advisory.
- Historical document health passed: 21 tests, 0 failures, 70 expectations.

### Follow-up visual review

- `.scratch/agent-card-separation-light.png`: reviewed. The Architect and Frontend Research cards each show two messages separated only by metadata and whitespace; no horizontal boundary line remains.
- `.scratch/agent-card-separation-dark.png`: reviewed. The same no-line hierarchy remains readable without low-contrast divider artifacts.
- `.scratch/overlay-user-message-rest-page.png`: reviewed after the broader regression rerun; surrounding card, disclosure, user-avatar, and lane alignment work remains intact.

### Follow-up second review

- The outer Agent-card border and the execution disclosure bar remain intentionally unchanged; the request targeted only the redundant separator between messages inside a card.
- Both declarations that could paint a message-boundary line were removed together, so there is no inherited dashed-line fallback under the chat-specific surface.
- No DOM node, data projection, message source, ordering rule, compatibility selector, or running process was changed.

## Follow-up Recall: contain the user avatar inside the message surface

### Latest user correction

- The user avatar must render inside the visible user message card, not as a sibling outside its trailing edge.
- Preserve the right-aligned user-message layout, the absence of a user identity header, and the existing hover-only footer.

### Acceptance criteria

- `.chat-bubble__user-avatar` is a descendant of `.chat-bubble__body`, which owns the visible user border and background.
- The user body lays out message content and avatar in one row with token-scaled spacing; the avatar remains at the trailing edge but inside the body's padding and border.
- The user shell no longer reserves an external avatar gap, and the bubble uses the full canonical `--conversation-user-card-inline-size` limit.
- Browser geometry proves the avatar rectangle is fully contained by the visible body rectangle on all four sides, while the body and bubble remain right aligned.
- Light/dark and full-page screenshots are personally reviewed; no identity/status/duration header is restored.

### Recalled sources and whole-repository evidence

- Re-read `AGENTS.md`, the browser-control skill, this record, `ChatBubble.tsx`, `chat-bubble.css`, and both browser tests that own user-avatar geometry.
- Whole-repository grep finds one user-avatar mount in `ChatBubble.tsx`; it is currently a sibling after `.chat-bubble`, so the screenshot accurately exposes a DOM ownership defect rather than a color or offset defect.
- The visible user card is `.chat-bubble__body`, which owns padding, border, radius, and background. Mounting the avatar anywhere outside that element cannot satisfy visual containment.
- The external topology also forces duplicated width arithmetic in `chat-bubble.css`: the shell gap and the bubble's subtraction of avatar width plus gap. Moving the avatar into the body allows both to be deleted rather than hidden with positioning.
- `--chat-avatar-inline-size`, the canonical `Avatar`, `--chat-avatar-gap`, and `--conversation-user-card-inline-size` remain the sole size and spacing sources. No new token or renderer is required.
- The pre-change git-cc fetch confirms the current branch and remote are synchronized. The unrelated dirty worktree remains out of scope. No sub-agent is used because the user did not request delegation.

### Implementation plan

1. Move the canonical user `Avatar` into `.chat-bubble__body` after `.chat-bubble__body-inner` and remove the external sibling mount.
2. Make the user body the content/avatar flex owner; delete the shell's external gap and the bubble's external-avatar width subtraction.
3. Replace browser assertions for lane-edge adjacency with strict body containment and internal gap assertions, retaining count/role/no-identity coverage.
4. Run focused static and browser regressions, typecheck/i18n/build, inspect light/dark and full-page screenshots, review the scoped diff, commit with `dsw-33987`, and push to git-cc.

### Follow-up implementation and validation

- Moved the sole canonical user `Avatar` from a shell-level sibling into `.chat-bubble__body`, immediately after `.chat-bubble__body-inner`.
- The visible user body now owns the content/avatar flex row and 8px token-scaled gap. The shell-level gap and the bubble's subtraction of external avatar width were deleted; the bubble now uses `--conversation-user-card-inline-size` directly.
- Browser geometry proves exactly one `user` avatar is fully contained within the visible body's left, right, top, and bottom edges, with a rendered 7–9px internal content gap. The bubble remains aligned to the conversation lane.
- Focused static tests passed: 8 tests, 0 failures, 99 expectations. Overlay TypeScript typecheck and i18n checks passed.
- The focused light/dark Agent-card browser test and the broader user hover/copy/disclosure browser test passed. The production Vite build passed with its existing chunk-size advisory.
- Historical document health passed: 21 tests, 0 failures, 70 expectations.

### Follow-up visual review

- `.scratch/agent-card-separation-light.png`: reviewed. The user icon is visibly enclosed by the outgoing card's gray border and padding, at the trailing end of the message text.
- `.scratch/agent-card-separation-dark.png`: reviewed. The icon remains inside the dark message surface with sufficient internal contrast and spacing.
- `.scratch/overlay-user-message-rest-page.png`: reviewed on the complete isolated Overlay page. The user card stays right aligned and the avatar is inside its visible border.
- `.scratch/overlay-user-message-hover.png`: reviewed. The timestamp and copy action still appear below the card and do not displace the internal avatar.

### Follow-up second review

- There is one user-avatar mount, one canonical Avatar renderer, and one user message-width source. The obsolete external-avatar width arithmetic is gone rather than retained as compatibility CSS.
- The user identity/status/duration header remains absent. Message data, roles, hover state, copying, chronology, Agent cards, execution bars, and boundary presentation are unchanged.
- No absolute positioning, CSS overlap, fallback selector, duplicate surface, or running-process intervention was introduced.

## 2026-07-27 Follow-up Recall: center the user avatar with the message surface

### User correction and acceptance

- The supplied screenshot shows the user avatar sitting on the outgoing card's bottom axis instead of sharing the message surface's horizontal centerline.
- Preserve the avatar inside the visible user card, at the trailing edge, with the existing canonical size, gap, border, background, right alignment, hover footer, and single `Avatar` renderer.
- Browser geometry must prove that the user message surface and avatar vertical centers differ by no more than one rendered pixel while the avatar remains fully contained by `.chat-bubble__body`.

### Recalled evidence and call-site disposition

- Re-read this record, `specs/current/architecture/12-overlay-card-system.md`, `ChatBubble.tsx`, `chat-bubble.css`, `chat-bubble.test.ts`, and the Node-launched `agent-card-separation-browser.test.ts` fixture.
- Whole-repository search finds one `.chat-bubble__user-avatar` mount and one user message flex-row owner. `.chat-bubble__body` currently uses `align-items: flex-end`, while the avatar adds a top margin; together they encode bottom alignment at the single canonical layout source.
- Keep the DOM, role projection, avatar renderer, width source, internal gap, and containment assertions unchanged. Replace bottom alignment with center alignment, remove the avatar offset, and add a rendered centerline assertion to the existing browser test.
- No mobile/tablet scope, compatibility selector, absolute positioning, fallback, duplicate renderer, or intervention in the running OpenCorvus/Overlay process is authorized.

### Implementation and verification

- `.chat-bubble__body` now centers its user-message children and `.chat-bubble__user-avatar` no longer contributes a directional margin. Width, containment, trailing order, and token-scaled gap remain unchanged.
- The focused static alignment test passes independently: 1 test, 2 expectations. The broader static file still has one unrelated pre-existing failure because concurrent `ChatBubble.tsx` work removed `chat-bubble-head-static` while its old assertion remains.
- The Node-launched real-browser fixture passes. Its new geometry assertion proves the avatar and body centers differ by no more than one rendered pixel while all existing containment and gap assertions still pass.
- `.scratch/agent-card-separation-light.png` and `.scratch/agent-card-separation-dark.png` were reviewed at original resolution. In both themes the avatar is centered with the outgoing message surface instead of sitting on its bottom axis.
- Overlay TypeScript and the production Vite build pass. Document-health execution remains blocked by two unrelated untracked records already referenced from the concurrent monthly index, plus two existing five-second audit timeouts.

## 2026-07-16 Follow-up Recall: restore Agent stage-colored message surfaces

### Latest user requirement

- Restore the colored Agent message cards shown in the supplied reference screenshot.
- Preserve all later accepted changes: full conversation-lane width, internal user avatar, no message-boundary hairlines, in-place thin execution bars, current metadata sizing, and current action layout.

### Acceptance criteria

- Every top-level Agent message surface consumes its projected `--card-stage` for both a subtle tinted background and a visible stage-tinted one-pixel border.
- Architect, Frontend Research, and Build cards render measurably different border and background colors in the same light-theme fixture; the same hierarchy remains legible in dark theme.
- The neutral `--surface-inset` background, transparent border, and generic drop shadow introduced by the flattening change no longer own Agent message surfaces.
- The existing role-to-stage projection, current padding, radius, width, user-avatar containment, boundary spacing, disclosure behavior, metadata, and actions remain unchanged.

### Recalled sources and whole-repository evidence

- Re-read `AGENTS.md`, the browser-control skill, this record, the supplied reference screenshot, `ChatBubble.tsx`, `chat-bubble.css`, `card.css`, the focused static guards, and the Agent-card browser fixture/test.
- Whole-repository grep finds one top-level Agent message-surface selector: `.chat-bubble-row[data-kind="agent"] .chat-bubble` in `chat-bubble.css`. There is no later same-specificity surface override.
- `ChatBubble.tsx::articleStyle` remains the sole top-level role-color projection and still assigns `--card-stage` from `stageAccent(normalizedRole())`; nested Agent children use the same source independently. The color data was not deleted.
- `git blame` and history isolate the regression: `1ce5df7260` changed the stage-tinted border to transparent, and `b719a5a30a4` changed the stage-tinted background/no-shadow surface to a neutral inset background plus generic shadow.
- The last accepted colored surface in `8f08096a22` used `color-mix(in srgb, var(--card-stage, var(--accent)) 26%, var(--border))` for the border, `color-mix(in srgb, var(--card-stage, var(--accent)) 7%, var(--surface))` for the background, and no shadow. These are existing canonical expressions, not newly invented tokens.
- Current scoped production/test/spec files are clean. Other dirty files and generated `packages/overlay/dist-artifacts/` are unrelated and remain untouched. No sub-agent is used because the user did not request delegation.

### Implementation plan

1. Restore only the Agent surface border, background, and shadow declarations from the last accepted colored-card design; retain all newer density and metadata declarations in the same selector.
2. Update static guards to reject the neutral flattening declarations and extend browser assertions from distinct borders to distinct backgrounds derived from each rendered stage.
3. Run focused static tests, Overlay typecheck/i18n/build, the real light/dark Agent-card browser test, and the broader conversation browser regression; personally inspect screenshots.
4. Review the scoped diff, record validation here, commit with a `dsw-33987` subject, reconcile the current release branch without overwriting concurrent work, and push to git-cc.

### Implementation and validation

- Restored the last accepted stage-colored Agent surface expressions while retaining the current 14px/16px padding and all later metadata/action changes: 26% stage-tinted border, 7% stage-tinted background, and no generic shadow.
- `ChatBubble.tsx::articleStyle`, `stageAccent`, card-stage tokens, role projection, and DOM topology were not changed; the fix reconnects the existing color source to its sole surface consumer.
- The focused static card tests passed. The relevant architecture guard `chat bubbles use one token-driven contained Agent surface without a second identity rail` also passed.
- The complete architecture-guard file has five unrelated concurrent-worktree failures involving the new terminal stylesheet/service, MemoryPanel SearchField source, brand-guide ownership, and popup token indirection. None touches the Agent surface selector or this scoped diff.
- Overlay TypeScript typecheck and i18n checks passed. The production Vite build passed with its existing chunk-size advisory.
- The Agent-card browser test passed and now proves three distinct rendered backgrounds, three distinct rendered border colors, one-pixel borders, no shadow, full-lane geometry, internal user-avatar containment, and zero message-boundary hairlines.
- The broader user-message/disclosure browser test passed after replacing two stale borderless-surface assertions and its pre-existing 14px message-font literal with rendered ownership checks against the current title typography.
- Historical document health passed: 21 tests, 0 failures, 70 expectations.

### Visual review

- `.scratch/agent-card-separation-light.png`: reviewed. Architect, Frontend Research, and Build cards visibly restore blue, purple, and orange tinted surfaces and matching borders without reintroducing message separators.
- `.scratch/agent-card-separation-dark.png`: reviewed. The same three stage identities remain distinct and readable on the dark canvas; nested execution content stays subordinate.
- `.scratch/overlay-user-message-rest-page.png`: reviewed on the complete isolated Overlay page. The Architect card matches the supplied light-blue reference direction, the user avatar remains inside its card, and the thin disclosure bar remains in place.

### Second review

- Only the Agent surface's border/background/shadow declarations and their direct regression assertions changed. Current width, radius, padding, typography, metadata, actions, avatar, execution, and message-boundary implementations were preserved.
- There is still one stage-color projection and one Agent surface selector. No hardcoded role selectors, duplicate palettes, fallback surface, compatibility rule, pseudo-element rail, hover recolor, or hidden message branch was added.
- The user-running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or used as the test target.
