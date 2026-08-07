# Chat Mission Recommendation Confirmation

## Recall

User request, 2026-07-27: when Chat recommends routing a request to Mission mode,
show a popup that explains why Mission is recommended; if the operator does not
respond within 10 seconds, choose Yes by default.

Acceptance criteria:

- Right-sidebar Chat remains the only Large Language Model (LLM) decision owner
  for whether a request benefits from Mission. There is no host keyword
  classifier or frontend routing rule.
- The existing `panel.wake_mission` handoff requires one concrete,
  user-visible recommendation reason before it can create a Mission.
- The recommendation is rendered through the existing Question interaction
  dialog and `InteractionCard`, not a second popup component or synthetic
  frontend message.
- The dialog offers Yes and No. Yes remains the visible default. A backend-owned
  10-second deadline resolves the real Question request to Yes and then
  continues the canonical Mission wake. No or explicit dismissal creates no
  Mission and publishes no Mission handoff.
- The popup visibly explains the automatic Yes deadline and updates its
  countdown. Manual reply and automatic reply compete through the existing
  exactly-once Question terminal boundary.
- Mission Session identity, caller provenance, attachment replay, model
  projection, `SessionWake`, handoff event, in-place Overlay navigation, and
  terminal receipt remain unchanged after confirmation.
- Focused backend, prompt, protocol, Overlay component, browser, typecheck,
  build, document-health, and second-review checks pass.

Hard constraints retained from project instructions:

- No fallback, compatibility alias, second routing source, hidden/synthetic
  message, workflow gate, keyword matcher, or frontend-emulated Mission.
- Prompt-over-host remains authoritative: Chat explains and recommends; the
  Host only executes the explicit typed Question/Mission protocol selected by
  Chat.
- Reuse mature Question/Dialog/Button/Radio primitives and the canonical
  Mission handoff.
- Do not restart, refresh, close, or otherwise interfere with a running
  OpenCorvus/Overlay process. Browser verification uses an isolated preview and
  Node-started Playwright/Browser tooling.
- Preserve unrelated dirty worktree changes. Do not reset, restore, or create a
  worktree. Stage only this task's exact files.
- New commits use the `dsw-33987` subject prefix and push to the actual legacy remote
  remote after hooks pass.

Sources read before implementation:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-chat-default-mission-forwarding-receipt.md`
- `specs/records/2026-07/2026-07-21-chat-mission-inline-conversation-handoff.md`
- `specs/records/2026-07/2026-07-23-overlay-interaction-settings-and-mailbox-refinement.md`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/tool/question.ts`
- `packages/opencorvus/src/question/{types,index}.ts`
- `packages/opencorvus/src/{engine/interaction,engine/model,protocol/session-mirror,server/routes/session}.ts`
- `packages/overlay/src/components/{InteractionCard,InteractionDialogHost}.tsx`
- `packages/overlay/src/services/{interaction-reply,tree-writer}.ts`
- Focused tests under `packages/opencorvus/test/{agent,question,tool,protocol,server}`
  and `packages/overlay/test`.

Whole-repository grep evidence:

- `rg "wake_mission"` found one production action schema in
  `panel/capability.ts`, one execution branch in `tool/panel.ts`, one Chat prompt
  contract in `primary-assistant-registry.ts`, and focused capability,
  execution, config-projection, control-surface, prompt, and schema-snapshot
  tests. `/mission/wake` is the independent explicit Mission composer route and
  is not a Chat recommendation path.
- `rg "Question\\.ask\\(|askAndFormat\\("` found the generic Question tool,
  intent analysis, Task proposal, Orchestrator interactions, Task queue choice,
  and Chat/Mission-capable Panel tool. Only the Chat Mission handoff needs an
  automatic default answer; generic question semantics remain unchanged.
- `rg "question\\.asked|question\\.replied|question\\.rejected"` found the
  Question Bus source, Engine interaction projection, session mirror,
  session-conversation hydration, Overlay `tree-writer`, event policy, and
  focused chronology/hydration tests. The Question request schema is the single
  place to carry an optional automatic-resolution contract through these
  existing projections.
- `rg "InteractionCard|InteractionDialogHost|replyInteraction"` found one
  shared renderer mounted inline and in the popup, plus one reply mutex/service.
  Countdown presentation belongs in `InteractionCard`; no second interaction
  renderer is needed.
- `rg "auto_question|OPENCORVUS_QUESTION_TIMEOUT_MS"` found generic unattended
  rejection configuration only. Mission confirmation requires explicit
  automatic Yes semantics and must not redefine generic question timeout
  behavior.
- At implementation start, the current branch was exactly aligned with
  `legacy-remote/v0.0.19beta`. Before delivery, the remote acquired a same-parent
  variant of the latest local commit, so delivery must preserve both histories
  with an explicit merge. The worktree already contains unrelated tracked and
  untracked changes, including
  `specs/README.md`, `specs/records/2026-07/README.md`, Composer, workspace,
  Markdown, i18n, tests, caches, and distribution output. This task preserves
  those hunks and adds only bounded changes.

Independent agent feedback:

- Not launched. The user did not request multiple agents, and the active
  collaboration policy prohibits unsolicited sub-agent delegation. The main
  agent performs the required second review against the exact diff and rendered
  screenshot.

## Diagnosis

The observable behavior is direct Chat-to-Mission handoff. The Chat prompt tells
the model to call `panel.wake_mission` as soon as it decides durable workflow
orchestration is appropriate. The Panel action validates the right-sidebar
caller and immediately creates/configures/wakes the Mission before publishing
the typed in-place handoff event. There is no operator confirmation fact between
the model recommendation and the Mission mutation.

This is not an Overlay navigation defect: the existing typed handoff correctly
switches the selected conversation only after Mission wake succeeds. Adding a
frontend modal around that event would be too late and would create a second
source that could disagree with the already-started Mission.

The existing Question subsystem already owns pending interaction identity,
popup projection, manual answers, dismissal, exactly-once terminal resolution,
session hydration, and transcript chronology. It currently supports either a
manual reply or a generic configured timeout rejection. It does not carry an
explicit default answer/deadline in the Question request, so neither the backend
nor the popup can represent “Yes after 10 seconds” honestly.

## Call-Site Treatment

| Call site / sibling | Treatment |
| --- | --- |
| Chat prompt in `primary-assistant-registry.ts` | Replace direct-routing wording with a recommendation contract: provide a concise evidence-based reason in the user's language, call the same `wake_mission` action, and wait for its confirmed/declined result. |
| `PanelCapabilityRegistry.wake_mission` | Require `reason`; document visible confirmation and automatic Yes behavior. Keep this action as the only Chat handoff mutation. |
| `PanelTool` `wake_mission` | Validate caller provenance first, ask one canonical Question bound to the tool call, and mutate Mission state only after Yes. Return a normal declined result for No/dismissal. Preserve all existing Mission creation/wake/handoff work after confirmation. |
| `Question.Request` / `Question.ask` | Add one optional structured automatic-resolution contract containing absolute expiry and default answers. Validate exact question/option coverage, publish it with the existing request, and resolve through the same `finalizePending` owner. Ordinary questions keep current semantics. |
| `Question.Event.Replied` / Engine projection | Mark automatic replies as such so durable evidence distinguishes timeout selection from a manual click. |
| Session mirror/hydration | Preserve the new request fields through the existing schema-driven payload; no new route or store. |
| Overlay `tree-writer` | Copy the optional automatic-resolution contract into the existing Question interaction payload. |
| Overlay `InteractionCard` | Render the deadline and live countdown with existing status styling; keep the first enabled single-choice option selected and disable stale actions after expiry. |
| Direct Mission composer `/mission/wake` | Preserve; it is an explicit operator-selected Mission mode, not a Chat recommendation. |
| Generic Question tool, intent analysis, Task proposal, Task queue question, Orchestrator interactions | Preserve; they opt into no automatic default and retain existing timeout/rejection behavior. |

## Design

1. Extend Question with an optional automatic resolution contract:
   `automatic: { timeExpires, answers }` on the published request and
   `automatic: { timeoutMs, answers }` on the internal ask input. The backend
   validates that every default answer names an enabled option for its
   corresponding question. At expiry it calls the same exactly-once finalizer,
   publishes `question.replied` with `automatic: true`, and resolves all waiters.

2. Keep the existing `wake_mission` action and require `reason`. Before any
   Mission write, ask:
   “Mission is recommended because: <reason>. Route this request to Mission?”
   with Yes first and No second, no custom input, a named 10-second protocol
   constant, and automatic answer `yes`.

3. A Yes result continues the existing Mission path without modification. A No
   result or dismissed Question returns `mission_declined`; it creates no
   Mission Session and publishes no handoff event.

4. Project the automatic contract into the shared `InteractionCard`. The popup
   shows a polite live line such as “Yes will be selected automatically in 10s.”
   It uses localized copy, an accessible live region, and disables answer/skip
   controls once the authoritative deadline has elapsed while awaiting the
   backend reply event.

## Implementation Plan

1. Add this record and update both spec indexes.
2. Add the Question automatic-resolution schema, validation, terminal event,
   and focused unit/protocol tests.
3. Add the reason-bearing Mission confirmation to the existing Panel action,
   update prompt/schema tests, and cover manual Yes, No, timeout Yes, failure,
   caller provenance, attachment, and no-handoff-before-confirmation behavior.
4. Project and render the countdown in Overlay using the shared interaction
   components; add unit/browser coverage and inspect a real screenshot.
5. Run focused tests, typecheck/build, docs health, `git diff --check`, and an
   exact-tree second review. Commit only task files with `dsw-33987` and push
   the main branch to legacy remote.

## Verification Commands

- `bun test packages/opencorvus/test/question/question.test.ts`
- `bun test packages/opencorvus/test/tool/panel.test.ts packages/opencorvus/test/tool/panel-capability.test.ts packages/opencorvus/test/agent/primary-assistant-registry.test.ts`
- `bun test packages/opencorvus/test/tool/panel-session-config-projection.test.ts packages/opencorvus/test/task-api/mission-control-surface-continuity.test.ts`
- `bun test packages/opencorvus/test/protocol/session-mirror.test.ts packages/opencorvus/test/server/session-conversation-routes.test.ts`
- Focused Overlay interaction projection/component/browser tests selected after
  fixture inspection.
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `git diff --check`

## Verification Results

- Question automatic-answer contract: 23 passed.
- Focused Panel Mission confirmation paths: manual Yes, manual No, Mission wake
  failure, caller attachment validation, and surface authorization passed. The
  larger Panel file also reported two unrelated Windows Git process-supervisor
  failures in `fork_session` and scheduler-lineage tests; all `wake_mission`
  cases passed.
- Delivery recheck: the combined focused run reported 91 passed and 4 failed.
  Independent reruns passed all 6 Mission-filtered Panel cases and both
  automatic-answer cases. The two `panel-session-config-projection` cases
  remain pre-existing fixture/expectation failures: `create_task` supplies a
  caller message that was never persisted, while the Mission case expects
  `prompt_profile.active=general` even though the production path has
  intentionally written `prompt_profile: null` since commit `5402cd65c79`.
  The remaining isolated failures are the previously recorded provider-reset
  and Windows child-process timeout cases.
- Primary Chat prompt contract: 1 focused test passed.
- Session mirror and conversation routes: 32 passed.
- Mission control-surface continuity: 2 passed.
- Overlay interaction projection: 54 passed.
- Node/Playwright visual test: 1 passed against the production Overlay bundle.
  The inspected screenshot is
  `packages/overlay/.scratch/mission-recommendation-confirmation/mission-recommendation-popup.png`;
  it shows the complete Chinese recommendation reason, selected Yes option,
  declining No option, and a live decreasing countdown without hover-overlay
  obstruction.
- Overlay production build passed.
- `git diff --check` passed.
- The historical-doc link assertions passed, but its repository-wide scratch
  cleanup assertion remains blocked by 488 pre-existing retired-spec snapshots
  under `.scratch/benchmark-runs/**`; this task did not create or modify them.
- Delivery document-health recheck reported 81 passed and 4 failed. Besides
  the same 488 scratch snapshots, the remaining failures come from the
  unrelated untracked `message-url-preview-browser.test.ts` fixture and two
  existing Git quoted-path decoding errors for tracked Unicode spec files.
  This task did not modify or delete those user-owned files.
- Package typechecks remain blocked by unrelated dirty-tree errors:
  OpenCorvus reports `src/acp/agent.ts:814` and `src/config/config.ts:267`;
  Overlay reports existing Virtualizer `bufferSize`, Mailbox locator, work
  ledger import, and untracked browser-preview-link diagnostics. No reported
  diagnostic points to a file changed by this implementation.

## Pre-push Toolchain Blocker Remediation

### Recall

- The required normal push was rejected by the repository's pre-push
  typecheck; bypassing the hook is forbidden.
- Full-repository grep found every retired Virtua prop call:
  `Conversation`, `FileChangesView`, `FileExplorerPanel`, `LogViewer`, and
  `ScreenshotBrowserPanel`. Virtua 0.42.3 declares `overscan` as an item count
  and has no `bufferSize`; each existing value is visibly encoded as
  `item-count * item-height`, so the single correct replacement is the original
  item count.
- `conversation-virtualization-motion.test.ts` is the only source test that
  explicitly preserves the retired prop and must be inverted to the current
  library contract.
- The Mailbox API source and generated SDK source already include
  `evidenceLocators`; only the SDK `dist` declaration consumed by Overlay is
  stale. Rebuild the existing SDK package rather than adding a second frontend
  type.
- `services/work-ledger.ts` imports the `WorkLedgerList` runtime schema and
  redeclares the same identifier as a type. Alias the runtime schema and
  re-export the canonical protocol type; do not create another schema.
- The untracked `browser-preview-link.ts` has no caller and imports a removed
  `selectTaskBrowserPreviewTarget` symbol. Preserve that work, remove the false
  default implementation assumption, and make its injected selection
  dependency explicit. Do not stage or claim the unrelated feature.
- The remaining OpenCorvus type error is a TypeScript Promise overload drift:
  `operation.then<DependencyOutcome>` fixes only the fulfilled branch generic
  and leaves the rejected branch as `never`. Both branches intentionally return
  the same discriminated union, so declare both result generics and retain the
  existing `waitForDependencies` error aggregation.
- Acceptance: full Overlay typecheck passes, focused virtualization and work
  ledger tests pass, task files remain the only committed product scope, and
  the normal pre-push hook succeeds.
