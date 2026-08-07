# Delegated Context Agent Ownership Repair

## Recall

### User requirement

- Fix the Overlay transcript shown after sending one message where two cards are visibly attributed to `User`.
- Preserve the real delegated prompt and its expandable audit trail; do not hide, filter, synthesize, or duplicate conversation messages.

### Acceptance criteria

1. One operator submission produces exactly one top-level card whose visible identity is `User`.
2. A real `role=user` prompt delivered into a non-main agent session is owned by that receiving agent's display segment, not by a second `User` card.
3. The delegated prompt remains collapsed by default under `Delegated context` / `调度上下文`, expands to the exact persisted body, and stays chronologically before the receiving agent answer.
4. Main-session user messages and explicit human direct replies remain user-owned and expanded.
5. Live message-first, part-first, and hydrated transcript paths converge on the same card identity and ownership.
6. No fallback, keyword classifier, hidden/filtered message stream, gate, or second projection source is introduced.
7. A Node-launched isolated real Overlay page is visually inspected at desktop width; the screenshot must show one `User` identity and the delegated disclosure inside the receiving agent card.

### Benchmark contract

- Input: a main user request followed by a persisted delegated `role=user` message and assistant response in an `architect` session.
- Output: one main `User` card and one `architect` card containing a collapsed delegated-context run followed by the architect answer.
- Environment: repository-local Bun dependencies for unit/type checks; the existing Overlay browser fixture launched with Node for visual verification. No running OpenCorvus/overlay process is restarted or reused.
- Timeout: unit and browser commands must report activity through their normal test output; any wrapper timeout is an inactivity timeout, not a fixed wall-clock deadline from process launch.

### Root cause and causal chain

- Observable symptom: the task request card and delegated prompt card both display `User`.
- Direct trigger: `deriveSessionStage()` returns `user` for every provider-facing `role=user` message before considering the non-main session channel.
- Deep cause: display ownership is derived from the model protocol role even though the message bridge already carries the receiving session channel and canonical agent identity. `regroupTimelineSegments()` therefore receives different segment keys for delegated input and the adjacent agent response and cannot merge them.
- Why the earlier repair did not cure it: the July 10 density repair preserved delegated prompts and collapsed their bodies, but its browser contract deliberately asserted a `user:session:<child>` card, encoding the mistaken ownership while improving only density.

### Landed sources read

- `AGENTS.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-07/2026-07-10-overlay-functionality-integrity-recovery.md`
- `specs/records/2026-07/2026-07-11-multi-agent-message-panel-redesign.md`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/overlay/src/utils/message-origin.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/components/ChatBubble.tsx`

### Full-repository grep and call-point disposition

| Call point / contract | Disposition |
| --- | --- |
| `isDelegatedContextMessage` in live `message.updated` | Retain as the single delegated-context classifier; use it to derive display ownership. |
| `isDelegatedContextMessage` in part-first projection | Retain; receiving-agent stage and canonical agent ID must be used before the full message arrives. |
| `isDelegatedContextMessage` in hydrate projection | Retain; hydrated ownership must match live ownership. |
| `deriveSessionStage` | Replace unconditional user-role ownership with origin-aware ownership: main/direct human input stays user; delegated context uses the receiving session channel. |
| `role === "user" ? undefined : agentID` in live, part-first, and hydrate card creation | Replace with display-stage ownership so delegated user-role prompts keep the receiving agent ID. |
| `regroupTimelineSegments` | Retain as the only segment merger; once stage and agent identity are correct it absorbs adjacent delegated context and answer into one card. |
| `CardParts` delegated disclosure | Retain unchanged; it already preserves exact parts and collapses by message ID. |
| `message-card-chronological-turns-browser.test.ts` | Replace the asserted child `User` card with a single architect-owned card and assert exactly one visible `User` identity. |
| `tree-writer-hierarchy.test.ts` and hydrate/origin suites | Update/add message-first, part-first, and hydration assertions for receiving-agent ownership; preserve direct-reply behavior. |
| Browser fixture `controls.test.ts` stage derivations | Review fixtures; change only cases that model delegated context and would otherwise encode the retired ownership. |

### Independent agent feedback

- No sub-agent was started because the current collaboration policy permits delegation only when the user explicitly requests it.

### Existing workspace and push constraint

- The worktree contained extensive pre-existing modifications before this task, including the target Overlay files. They must be preserved and only task-specific hunks may be staged.
- The required pre-change legacy remote push was attempted with an exact branch ref. The pre-push hook failed on pre-existing `taskRuntimePaths` type drift (`sourcePackage*` / `webpageEvidence*` consumers), not on this repair. Hooks will not be bypassed.

## Implementation design

`MessageOrigin` is the single input to a display-owner projection. Main user input and explicit human direct replies remain user-owned. A delegated context message is owned by its receiving non-main channel and canonical receiving `agentID`. The existing chronological segment key then places its collapsed context run and adjacent assistant response on the same agent card.

No persisted role, author, source, message ID, text part, or ordering evidence is rewritten. This is a display ownership correction only.

## Verification commands

- `bun test packages/overlay/test/message-origin.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/conversation-view-hydrate.test.ts`
- Node launch of `packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts` through the repository browser-test toolchain.
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Relevant document-health test selected by the July record index contract.
- `git diff --check` on task-owned files.

## Status

- Codex review feedback: the first Node browser run reached the real page but exposed one stale `delegatedAgentCardID` reference in the Chinese screenshot branch after the delegated card became agent-owned. The reference is revised to the canonical merged `delegatedCardID`; the complete Node browser scenario must be rerun before acceptance.
- Codex review feedback: the first implementation left `conversation/view.ts` reading both normalized `originSource` and provider `extra.source`. That violated the single-source contract. The view now requires normalized `originSource` explicitly, and a regression test proves missing normalization fails instead of guessing. The Explore projection fixture was updated to the complete persisted message contract exposed by this stricter check.
- Implemented. The shared transport-protocol projection assigns delegated user-role prompts to the receiving agent channel while retaining main/direct-human ownership.
- Focused benchmark: 124/124 tests passed with 1,539 assertions across transport protocol, server conversation view, Explore session projection, Overlay origin, live/part-first tree projection, and hydrate projection.
- Type/build checks: Overlay TypeScript and transport-protocol TypeScript passed; the browser error collector suite passed 17/17 with 601 assertions.
- Real Node browser scenario passed 1/1 after the stale-variable correction. It used the repository inactivity-aware runner and an isolated HTTP fixture.
- Visual review passed for `.scratch/message-card-chronological-turns-browser/delegated-context-collapsed.png`, `delegated-context.png`, `delegated-context-zh.png`, and `timeline-top.png`: the card header is `architect`, context remains collapsible/expandable, and the architect answer is in the same card. The prior `user:session:ses_child:message:msg_child_context` card is absent.
- Historical docs links passed 20/20. The broader document-health suite remains independently red because the pre-existing dirty workspace has model-catalog schema drift, one unrelated 5-second expert-squad timeout, and multiple pre-existing README links to untracked July records. This task does not stage or rewrite those unrelated records.
- The in-app Browser skill was initialized, but its security policy rejected direct navigation to the local `file://` screenshot. No workaround was attempted; the real Node/Playwright page run and direct screenshot inspection remain the visual evidence.
