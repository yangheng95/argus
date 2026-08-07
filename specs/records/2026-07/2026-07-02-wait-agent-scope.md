# Wait Agent Scope

Date: 2026-07-02

## Objective

Restrict the `wait` tool surface to Mission and the Orchestrator scheduler.
`wait` is a durable park primitive for user-goal coordination and scheduler
handoff, not a generic coding/build/research tool.

## Recall

- User requests:
  - "wait工具无法暂停agent，根本没有等待期，检查为什么"
  - "把这个工具的scope只给mission和调度器"
- Acceptance criteria:
  - `mission` and `orchestrator` keep `wait` in their visible tool surface.
  - All other built-in role assignments omit `wait`.
  - The custom-agent default global pool omits `wait`.
  - `ToolRegistry.tools(..., agent)` follows the same visible tool surface and
    does not expose `wait` to representative non-owner agents.
  - Existing nonblocking cron wait behavior and park-after-result behavior are
    unchanged.
- Hard constraints:
  - No fallback, compatibility branch, prompt gate, hidden message, polling
    loop, blocking sleep, or registry-side duplicate scope source.
  - Do not restart or refresh the running OpenCorvus/overlay process.
  - Do not revert user or pre-existing working tree changes.
  - Add regression tests for any code change.
- Landed sources read:
  - `specs/records/2026-07/2026-07-02-wait-park-turn-boundary.md`
  - `specs/records/2026-07/README.md`
  - `specs/README.md`
  - `packages/opencorvus/src/tool/registry.ts`
  - `packages/opencorvus/src/agent/agent.ts`
  - `packages/opencorvus/src/agent/tool-pool-contract.ts`
  - `packages/opencorvus/src/tool/global-tools.ts`
  - `packages/opencorvus/test/orchestrator/wait-tool.test.ts`
  - `packages/opencorvus/test/agent/agent.test.ts`
  - `packages/opencorvus/test/agent/role-contract.test.ts`
  - `packages/opencorvus/src/cli/cmd/agent.ts`
- Whole-repository search evidence:
  - `rg -n "wait|visibleToolIDs|ToolRegistry|tools:" packages/opencorvus/src/agent packages/opencorvus/src/tool packages/opencorvus/test/agent packages/opencorvus/test/orchestrator/wait-tool.test.ts -g '*.ts'`
  - `rg -n "customDefault|normalize\\(|config\\.agent.*tools|tools is not supported|custom agent|AgentToolPool\\.assignment|visibleToolIDs\\(|hasTool\\(" packages/opencorvus/src packages/opencorvus/test -g '*.ts'`
  - `rg -n "GLOBAL_TOOL_IDS|AGENT_CREATE_AVAILABLE_GLOBAL_TOOLS|wait" packages/opencorvus/src/cli packages/opencorvus/test/cli packages/opencorvus/src/config packages/opencorvus/test/config -g '*.ts'`
- Independent agent feedback:
  - No sub-agent was spawned. The current request is a scoped local contract
    change with enough repository evidence from the searches above; the main
    agent keeps ownership of the repair.

## Root Cause

`ToolRegistry` already filters initialized tools through
`AgentToolPool.visibleToolIDs(agent.tools)`. The over-broad exposure therefore
does not come from the registry or the `wait` implementation. It comes from the
canonical tool-pool contract:

- `wait` sits inside `codingGlobal`, so `coding`, `coding-assistant`, and
  `build` inherit it.
- `general` lists `wait` directly.
- `customDefaultGlobal` starts from all global registry tools and only excludes
  `request_orchestrator_decision`, so custom agents created without a narrower
  tool selection also receive `wait`.

## Callpoint Inventory

| Surface | Current evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | Single source for built-in role tool assignments and custom-agent default global tools. | Remove `wait` from shared/default pools and leave it only in `mission` and `orchestrator`. |
| `packages/opencorvus/src/tool/registry.ts` | Applies `AgentToolPool.visibleToolIDs` after collecting global/private tools. | No registry-side special case; keep the single source in `AgentToolPool`. |
| `packages/opencorvus/src/tool/global-tools.ts` | Registry still owns the `WaitTool` implementation so scoped agents can resolve it. | Keep `wait` as a global registry tool; scope is assignment-level, not registration-level. |
| `packages/opencorvus/src/agent/agent.ts` | Built-in agents are assigned from `AgentToolPool.assignment(role)`. | No agent-local override. |
| `packages/opencorvus/test/agent/agent.test.ts` | Existing tests assert orchestration-only lifecycle tools. | Add the equivalent scope assertion for `wait` and custom defaults. |
| `packages/opencorvus/test/orchestrator/wait-tool.test.ts` | Existing wait tests assert Mission/Orchestrator exposure and wait behavior. | Extend registry assertions so representative non-owner agents cannot resolve `wait`. |

## Design

1. Remove `wait` from the shared `codingGlobal` pool. This removes it from
   `coding`, `coding-assistant`, and `build` without a second policy source.
2. Remove `wait` from `general`'s explicit global tool list.
3. Exclude `wait` from `customDefaultGlobal` so newly defined custom agents do
   not receive it by default.
4. Keep `wait` explicitly listed for `mission` and `orchestrator`.
5. Test both directions:
   - static role assignments expose `wait` only to `mission` and `orchestrator`;
   - registry resolution includes `wait` for owners and excludes it from
     representative non-owner agents.

## Acceptance

- Focused tests pass:
  `bun test packages/opencorvus/test/orchestrator/wait-tool.test.ts packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/agent/role-contract.test.ts`
- Historical docs link test passes after adding this record:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Manual code review confirms no registry-side duplicate scope rule, blocking
  wait, polling loop, or OpenCorvus/overlay process restart was added.
