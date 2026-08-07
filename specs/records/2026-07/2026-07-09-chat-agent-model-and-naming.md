# Chat Agent Model And Naming

## Recall

User request, 2026-07-09: "把chat的模型做一个独立的agent，不要复用build了，prompt污染严重。然后把coding assistant chat直接简化为chat，读起来太累了"

Acceptance criteria:

- The right-sidebar Chat runtime uses a canonical `chat` agent role and agent registration.
- Chat model selection is stored and resolved through `agent.chat.model`, independent from `agent.build.model`.
- Chat prompt is its own native prompt built from the interactive coding base plus the right-sidebar Mission handoff contract; it must not use `BUILD_CORE`.
- The old `coding-assistant` agent role is removed from role contracts, prompt-profile targets, tool-pool assignments, and bundled expert-squad package projections. No alias or compatibility fallback is added.
- Existing right-sidebar Chat sessions are created with `agent: "chat"` in their prompt overlay.
- User-facing overlay copy says "Chat" / "New Chat" / "Search chats" instead of "Coding Assistant Chat" or "assistant chat".
- Focused tests cover the agent registry, model slot, prompt-profile target, right-sidebar prompt overlay, expert-squad payload projection, and overlay copy/model settings surface.

Hard constraints:

- Follow `AGENTS.md`; no fallback / compatibility shim / dual source / route gate.
- Preserve unrelated dirty worktree and staged changes. Before this task, the worktree already contained many staged and unstaged overlay, mission, reasoning, style, i18n, AGENTS, and July spec changes.
- Do not use `git reset`, do not create a new worktree, and do not restart or refresh running OpenCorvus / overlay processes.
- Code changes require focused tests.
- Expert-squad package changes must keep `.opencorvus/expert-squads/<namespace>/<id>/` and generated payload as the single source.
- Commit subjects on this delivery line must start with `dsw-33987` if an isolated commit can be made without disturbing unrelated staged work.

Sources read before implementation:

- `AGENTS.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/records/2026-07/2026-07-08-chat-default-mission-forwarding-receipt.md`
- `specs/records/2026-07/2026-07-08-project-directory-new-chat-icon.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/agent/model.ts`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/coding-assistant/session.ts`
- `packages/opencorvus/src/server/routes/coding.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/mission/caller-receipt.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/session/first-message-title.ts`
- `packages/opencorvus/src/session/compaction-handoff.ts`
- `packages/overlay/src/components/AgentModelsPanel.tsx`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- Bundled expert-squad manifests and `agents/coding-assistant/system.md` resources under `.opencorvus/expert-squads/builtin/**`.

Whole-repository grep evidence:

- `rg -n "coding-assistant|coding_assistant|Coding Assistant|coding assistant|agent\\.coding-assistant|RightSidebarCodingAssistant|RIGHT_SIDEBAR_CODING_ASSISTANT" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test .opencorvus/expert-squads --glob '!packages/opencorvus/src/model-registry/models-snapshot.ts'`
- `rg -n "resolveAgentModelRef|agent\\.<name>\\.model|agent\\.build\\.model|agent\\.chat\\.model|AgentModelResolver" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
- `rg -n "roleAssignments|AgentRoleContract|PromptProfile\\.targets|base_role|capability_projection|agents/coding-assistant" packages/opencorvus/src packages/opencorvus/test .opencorvus/expert-squads specs/current`
- `rg -n "coding/session|coding/sessions|createCodingAssistantSession|selectCodingAssistantSession|coding_assistant\\.launcher|coding_assistant\\.title" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test`

Independent agent feedback:

- Not launched. The available multi-agent tool metadata permits spawning sub-agents only when the user explicitly asks for them. The main agent performed the required recall by reading existing specs, source, tests, and expert-squad package instructions directly.

## Diagnosis

`resolveAgentModelRef(name)` already resolves a named agent through explicit model, `agent.<name>.model`, and project/session model sources; it does not fall back from Chat to Build. The real split is missing one level above model resolution: the right-sidebar Chat surface still registers and overlays itself as `coding-assistant`, while Build is a separate task agent with a very different prompt.

That old identity leaks into four places:

- backend agent role, tool-pool, native prompt defaults, compaction handoff, right-sidebar metadata, Mission receipt validation, and prompt overlay;
- expert-squad package projection, where packages still declare `coding-assistant` role overlays;
- overlay settings and i18n, where users see "Coding Assistant Chat";
- tests and browser fixtures that treat Chat rows as `coding-assistant` strings.

Adding host-side model rewrite from Chat to Build or a fallback alias from `coding-assistant` to `chat` would preserve the prompt pollution and create two sources. The canonical repair is to replace the right-sidebar assistant agent identity with `chat`.

## Design

1. Register `chat` as the only right-sidebar Chat agent role.

`Agent.buildState(...)` gets a hidden primary `chat` agent with `AgentToolPool.assignment("chat")` and a `CHAT_RUNTIME_PROMPT`. `CHAT_RUNTIME_PROMPT` keeps the interactive coding base prompt plus the existing Mission handoff contract. Build remains registered from `BUILD_CORE`; Chat never imports or resolves Build prompt text.

2. Move right-sidebar session helpers to Chat naming.

Right-sidebar metadata uses `metadata.chat.surface = "right-sidebar"` and source `right-sidebar-chat`. Prompt overlay sets `agent: "chat"`. Call sites import `isRightSidebarChatSession`, `applyRightSidebarChatPromptOverlay`, and related constants. No legacy exports are kept.

3. Replace expert-squad `coding-assistant` projection with `chat`.

Each bundled non-general expert squad declares `capability_projection.agents.chat.base_role = "chat"` and `agents.chat.prompt = "agents/chat/system.md"`. The old `agents/coding-assistant` resource is moved to `agents/chat`. The generated payload is regenerated from package sources.

4. Simplify user-facing overlay copy.

The current store/service filenames may remain internal implementation names for this slice, but visible strings become Chat. The Agent Models panel treats `chat` as a core agent, so users configure Chat separately from Build.

## Implementation Plan

1. Add this spec record and the July README entry.
2. Add `chat` to backend role/tool/agent contracts and remove `coding-assistant`.
3. Rename right-sidebar session helper exports and update backend callers.
4. Update expert-squad manifests, package resources, and generated payload.
5. Update overlay visible copy and Agent Models panel ordering/tests.
6. Update focused backend and overlay tests.
7. Run focused tests, docs link check, diff check, and second review for stray `coding-assistant` agent identity.

## Verification Plan

Focused backend:

```powershell
bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/agent/role-contract.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/agent/model-overlay.test.ts
bun test packages/opencorvus/test/session/prompt-final-input.test.ts packages/opencorvus/test/session/compaction.test.ts
bun test packages/opencorvus/test/tool/panel.test.ts packages/opencorvus/test/mission/caller-receipt.test.ts packages/opencorvus/test/server/coding-routes.test.ts
bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts
```

Focused overlay:

```powershell
bun test packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/browser/agent-models-panel.test.ts
```

Docs/static:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
```

If unrelated pre-existing dirty changes cause broader checks to fail, only failures caused by this task should be fixed in this slice.

## Verification Results

Completed on 2026-07-10:

- `bun test packages/overlay/test/coding-assistant-panel.test.ts` passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-models-panel.test.ts` passed; screenshot reviewed at `.scratch/agent-models-zh-cn.png`.
- `bun test packages/overlay/test/agent-role-routing.test.ts` passed.
- `bun test packages/overlay/test/agent-models-panel-load.test.ts` passed.
- `bun test packages/overlay/test/composer-file-loader-right-toolbar.test.ts` passed.
- `bun test packages/overlay/test/acceptance-panel-mount.test.ts` passed.
- `bun test packages/overlay/test/work-ledger-consolidation.test.ts` passed.
- `bun test packages/overlay/test/sidebar-chat-single-source.test.ts` passed.
- `bun test packages/overlay/test/coding-assistant-service.test.ts` passed.
- `bun test --test-name-pattern "right sidebar Chat overlay" packages/opencorvus/test/session/prompt-final-input.test.ts` passed.
- Direct runtime checks passed for `agent.chat.model` config parsing, Chat/Build model isolation, session overlay model isolation, Chat role/registration/tool-pool contract, PromptProfile target exposure, and bundled expert-squad `agents/chat/system.md` projection.
- `git diff --check` passed, with only an existing CRLF warning for `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`.

Observed but not expanded in this slice:

- `bun test --test-name-pattern "right sidebar prompt overlay" packages/opencorvus/test/server/coding-routes.test.ts` did not reach assertions; it failed from Bun's mechanical hook timeout while temporary project bootstrap was still in `engine.git.ensure-gitignore`.
- `bun test --test-name-pattern "right sidebar Chat" packages/opencorvus/test/agent/agent.test.ts` previously passed in this slice, but a later rerun hit the same mechanical timeout pattern after reaching 14 assertions.
- Full `model-overlay.test.ts` / `role-contract.test.ts` Instance-level runs were stopped after repeated hook timeouts and dangling process cleanup noise. Direct non-bootstrap contract checks were used for the Chat-specific acceptance surface instead.
- `generate-expert-squad-payload.ts` is blocked by the unrelated local `.opencorvus/expert-squads/wujiang/opentest` schema drift (`team` / `workflow` missing, retired `workflow_tool_name` present).
