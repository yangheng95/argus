# Chat Default Mission Forwarding Receipt

## Recall

User request, 2026-07-08: the chat surface does not visibly show design routing into workflow. Default the composer to Chat mode to reduce user confusion and allow ordinary interactive coding-style work, while obvious workflow-shaped requests must be autonomously forwarded to Mission mode. When the Mission finishes, the caller Chat must receive a receipt.

Acceptance criteria:

- Overlay first opens the composer in Chat mode, not Mission mode.
- The composer mode selector lists Chat as the first/default option so its local fallback matches the startup mode.
- The right-sidebar Chat coding assistant has an explicit tool contract for starting a Mission when the request clearly needs durable workflow orchestration.
- That contract is not a host-side keyword classifier, frontend route rule, or gate. The Large Language Model (LLM) decides from the prompt/tool description and calls the typed tool action.
- Mission forwarding reuses the existing Mission session and `SessionWake` path. It does not create a parallel task or a second Mission source.
- The forwarded Mission records the caller Chat session from server-owned context, not user-supplied parameters.
- A terminal Mission `session.status` writes a normal visible assistant message into the caller Chat session as the receipt.
- Receipt delivery is idempotent for repeated terminal status notifications.
- Focused tests cover default Chat mode, the new panel capability, Mission forwarding provenance, receipt persistence, and prompt/tool contract exposure.

Hard constraints retained from project instructions:

- No fallback, compatibility shim, hidden message, synthetic message, host-side keyword routing, state-machine gate, or second active Mission source.
- Prompt-over-host invariant: teach the LLM through the coding-assistant prompt and a typed tool action; do not add host preflight routing that decides whether a user sentence is "workflow".
- Before editing code, read landed specs and record Recall with whole-repository grep evidence.
- Code changes require tests.
- Do not reset or revert unrelated worktree changes.
- Do not create a new worktree.
- Do not restart or refresh running OpenCorvus or overlay processes.
- Current worktree already has substantial unrelated dirty files; stage only files touched for this task if a commit is made.

Sources read before implementation:

- `AGENTS.md`
- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-07/2026-07-07-frontend-tool-portability-boundary.md`
- `specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-08-dispatch-agent-null-schema-pollution.md`
- `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/test/work-ledger-consolidation.test.ts`
- `packages/opencorvus/src/coding-assistant/session.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/mission/session.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/session/status.ts`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/project/bootstrap.ts`
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/agent/prompt/coding.txt`
- Relevant tests under `packages/opencorvus/test/{tool,mission,server,session,agent}`.

Whole-repository grep evidence:

- Composer default and selector: `rg 'createSignal<PrimaryCenterPanel>|createSignal<ComposerMode>|composerModeOptions|id: "mission"|id: "chat"' packages/overlay/src/main.tsx packages/overlay/src/components/ChatComposer.tsx packages/overlay/test -g '*.ts*'` found Mission defaults in `main.tsx`, Mission-first options in `ChatComposer.tsx`, and overlay tests expecting Mission default.
- Coding-assistant prompt/default: `rg 'nativeDefaultPrompt\("coding-assistant"\)|agent\?\.prompt\)\.toBe\(PROMPT_CODING\)|"coding-assistant": PROMPT_CODING|Agent\.nativeDefaultPrompt\(' packages/opencorvus/test packages/opencorvus/src -g '*.ts'` found `agent.ts` native defaults and agent tests that need updating if coding-assistant gets a distinct native prompt.
- Panel capability/action surface: `rg 'PanelCapabilityRegistry|panelActionSetForActor|panelCapabilities\(|PanelTool|SessionWake\.wake|ensureMissionSession|SessionStatus\.Event\.Status|RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA' packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -g '*.ts' -g '*.tsx'` found the single panel action registry, right-sidebar actor derivation, Mission session helpers, terminal status subscribers, and existing panel tests.
- Mission wake source: `rg 'mission\.operator|mission\.child_task_result|wakeMission|/mission/wake|MissionWakeInput|ensureMissionSession' packages/opencorvus/src packages/opencorvus/test -g '*.ts'` found `/mission/wake`, `SessionWake.WakeReason`, child task result wake, and existing Mission route tests.
- Message persistence: `rg 'persistMessage\(|updateMessage\(|mergeMetadata|setTitleFromFirstUserMessage|export namespace Session' packages/opencorvus/src/session packages/opencorvus/src -g '*.ts'` found `Session.persistMessage` for atomic message plus parts and `Session.mergeMetadata` for row-level metadata updates.
- Event subscription: `rg 'Bus\.subscribe|SessionStatus\.Event\.Status|session\.status' packages/opencorvus/src packages/opencorvus/test -g '*.ts'` found `SessionStatus.set()` as terminal status source and bootstrap subscribers such as the protocol message bridge.

Independent agent feedback:

- Not launched. The available multi-agent tool metadata says spawning sub-agents is only allowed when the user explicitly asks for sub-agents. This request did not ask for sub-agents, so the main agent performed the required independent review by reading code and specs directly.

## Diagnosis

The current overlay defaults to Mission:

- `primaryCenterPanel` starts as `"mission"`.
- `composerMode` starts as `"mission"`.
- `ChatComposer` lists Mission before Chat and falls back to the first option.

Chat mode already creates a right-sidebar `coding-assistant` session and sends prompts through canonical `/session/:sessionID/prompt_async`. That is the correct surface for ordinary interactive coding behavior.

Mission wake currently has one backend source: `/mission/wake` creates or resumes a Mission session through `ensureMissionSession`, then injects a normal user wake message through `SessionWake.wake({ agent: "mission" })`. Panel `create_task` can create tasks for the right-sidebar assistant, but no panel action starts Mission. Adding host-side frontend routing would duplicate the decision source and violate the prompt-over-host invariant.

`/mission/wake` does not use `TaskQueueService`; the durable completion signal for a Mission is the normal `session.status` terminal event emitted by `SessionStatus.set()`. Therefore caller receipt delivery should subscribe to terminal Mission `session.status`, not task queue completion.

## Design

1. Default Chat in the overlay.

Change the startup signals in `main.tsx` to `"chat"` and reorder `ChatComposer` options so Chat is first. Existing mode switch behavior remains unchanged: selecting Mission still opens Mission mode, selecting Chat opens Chat mode.

2. Add a typed right-sidebar panel action: `wake_mission`.

Add `wake_mission` to `PanelCapabilityRegistry` with `surfaces: ["right-sidebar"]` and parameters:

- `title`: optional short title for the Mission.
- `request`: full user request to hand to Mission.

The action is available to right-sidebar Chat because `panelActionSetForActor("right_sidebar_assistant", "right-sidebar")` derives its actions from the right-sidebar surface. It is not exposed to Slack, gateway, panel UI, Mission, or Explore.

The action implementation will:

- Assert the caller session is a right-sidebar coding assistant session from server-owned session metadata.
- Create a fresh Mission identifier for the forwarded request.
- Call `ensureMissionSession`.
- Store caller metadata on the Mission session under `metadata.mission.caller`, including caller session ID and the user message ID linked to the assistant tool call.
- Copy the caller session's active prompt profile into the Mission session config overlay when present, using `EffectiveConfig.effective({ sessionID: callerSession.id })` as the only source.
- Call `SessionWake.wake` with `agent: "mission"` and reason `mission.operator`.
- Return JSON with the Mission identifier and session ID.

Fresh Mission creation is intentional for the first implementation. Allowing the Chat assistant to attach new callers to an arbitrary existing Mission would introduce ambiguous receipt ownership and should be a separate explicit design if needed.

3. Give the coding-assistant native prompt the Mission-forwarding contract.

Keep `coding` unchanged. Define a distinct native prompt for `coding-assistant` by appending a short right-sidebar contract to `PROMPT_CODING`. The contract says:

- Work interactively for ordinary coding/chat requests.
- When the request clearly needs durable multi-step workflow orchestration, call `panel` with `action: "wake_mission"` and pass the full request.
- Do not create a normal task for the same request after forwarding to Mission.
- Tell the user that Mission accepted the request after the tool call returns.

This is agent instruction, not host routing.

4. Add a Mission caller receipt bridge.

Create a Mission receipt module initialized from `InstanceBootstrap`.

On terminal `SessionStatus.Event.Status`:

- Load the terminal session.
- Ignore non-Mission sessions and Mission sessions without `metadata.mission.caller`.
- Parse caller metadata strictly.
- Load the caller session in the same project and assert it is a right-sidebar coding assistant session.
- If `metadata.mission.receipt.message_id` already exists, do nothing.
- Persist one normal assistant message into the caller session via `Session.persistMessage` with a text part summarizing Mission completion, using Mission status reason/summary/error.
- Record `metadata.mission.receipt` on the Mission session with the receipt message ID and terminal reason.

This stores a visible message in the same conversation stream as ordinary Chat output. It is not hidden or synthetic.

## Implementation Plan

1. Add the spec record and monthly README index entry.
2. Change overlay default mode and update overlay source tests.
3. Add `wake_mission` capability and PanelTool execution.
4. Add Mission receipt metadata parsing/persistence and bootstrap initialization.
5. Add coding-assistant native prompt contract and update prompt tests.
6. Add focused tests for panel capability, forwarding, receipt idempotency, and docs health.
7. Run focused validation and review diff for unintended double sources or route gates.

## Test Plan

Focused tests:

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/mission-launcher-component.test.ts`
- `bun test packages/opencorvus/test/tool/panel-capability.test.ts packages/opencorvus/test/tool/panel.test.ts`
- `bun test packages/opencorvus/test/mission/caller-receipt.test.ts`
- `bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/session/prompt-final-input.test.ts packages/opencorvus/test/server/coding-routes.test.ts`

Docs tests after spec changes:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`

Static checks:

- `git diff --check`

If a broader suite fails from pre-existing unrelated dirty worktree changes, record the exact failure and continue fixing only failures caused by this task.
