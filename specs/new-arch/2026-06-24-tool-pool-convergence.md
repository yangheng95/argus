# Tool Pool Convergence

Date: 2026-06-24
Status: Implemented on `codex/agent-abstraction-convergence`

### Goal Update: Agent / Skill / Tool Linkage

The active implementation goal includes the latest clarification: agent
definitions, skill definitions, and the tool pool are one linked contract. This
is not a UI-only or registry-only refactor.

- Agent definitions expose tool visibility only through `ToolPoolAssignment`.
- Skill definitions validate `required_tools` against canonical tool IDs at
  parse time.
- Skill mount availability, matrix warnings, runtime skill search, and runtime
  tool filtering all read the same canonical agent tool pool.
- Private tools that cannot or should not be global stay in the owning
  agent/runtime definition domain; they are not duplicated as near-synonym
  global tools.
- Legacy duplicate skill requirements such as `read_file`, `find_files`, and
  `list_directory`, `memory_search`, and `memory_get` fail loudly instead of
  being mapped, ignored, or treated as compatibility aliases.

### Goal

Replace the per-agent `tools.include` / `tools.exclude` adapter with two
auditable tool pools:

- `global`: registry tools that are globally defined by OpenCorvus and may be
  selected by many agents.
- `private`: tools owned by one agent role or one runtime contract, including
  orchestrator workflow tools, stage-agent context/output tools, frontend
  evidence tools, visual QA repair tools, and integrity review extras.

The runtime must not infer tool ownership from scattered filters in
`ToolRegistry`, `Agent.Info`, skill mounting, overlay code, or ad hoc
permission rules.

This plan must move together with agent and skill definitions:

- Agent role metadata projects the pool assignment into `Agent.Info`; built-in
  agents do not hand-maintain their own tool arrays.
- Skill `required_tools`, skill availability, and mount matrix warnings resolve
  through the same canonical tool names and agent pool assignment.
- Global tool definitions live together in one global tool definition entry.
  Private tools that cannot or should not become global stay in the owning
  agent/runtime module and are referenced by the pool contract as private.

### Recall

| Source                                                       | Constraint                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                  | No fallback, no double source, inspect plans before edits, tests for behavior changes.                                                              |
| `specs/new-arch/08-agent-tool-adapter.md`                    | Current truth is `Agent.Info.tools` plus `ToolRegistry.tools(model, agent)` filtering; the doc admits include/exclude drift and old rows.           |
| `specs/new-arch/2026-06-24-agent-abstraction-convergence.md` | Agent abstractions are only `host` and `worker`; role-specific metadata belongs in a backend contract.                                              |
| `packages/opencorvus/src/session/loop.ts`                    | Runtime contract extra tools are merged after registry tools and may shadow registry names.                                                         |
| `packages/opencorvus/src/agent/context-tools.ts`             | Before this change, `read_file`, `find_files`, `list_directory`, `memory_search`, and `memory_get` were stage-runtime private tools.                |
| `packages/opencorvus/src/skill/mounts.ts`                    | Before this change, skill required-tool checks inspected `agent.tools.include/exclude`; this moved to the same pool contract as registry filtering. |

### Current Problem

Tool ownership currently has several sources:

- `agent.ts` stores each built-in role's `tools.include` or `tools.exclude`.
- `tool/registry.ts` adds extra hard-coded frontend-design and visual-QA
  filters before applying the agent include/exclude adapter.
- `skill/mounts.ts` repeats include/exclude checks for `skill` and
  `required_tools`.
- `config.ts` lets some configured agents override `tools`, while other
  built-ins reject overrides in `Agent.buildState()`.
- Runtime contract tools are represented with the same string lists as
  registry tools even when they are not registry tools.

This makes it unclear whether a tool is globally available, owned by a
particular agent, injected by a runtime contract, or merely surviving because it
was not listed in an exclude array.

### Decision

1. Introduce a single backend `AgentToolPool` contract linked to
   `AgentRoleContract`.
2. Replace `Agent.Info.tools` with:

```ts
type ToolPoolAssignment = {
  global: string[]
  private: string[]
}
```

3. Built-in agents never define their tool pool inside `agent.ts`; they receive
   `AgentToolPool.assignment(roleID)` during registry projection.
4. Custom agents may declare only `tools.global` in config. Custom agents
   default to the explicit custom global pool and no private tools. Private
   tools are code-owned by the native agent/runtime domain that implements
   them.
5. `ToolRegistry.tools()` filters registry tools by
   `AgentToolPool.visibleToolIDs(agent.tools)` and removes the old webpage
   evidence / scroll-slice hard-coded filters.
6. `SkillMount` uses the same `AgentToolPool` helper for `skill` and
   `required_tools` checks.
7. Runtime contract extras remain attempt-scoped private tools. They are merged
   by `SessionLoop.resolveTools()` after registry tools and are not registered
   as global tools.
8. Duplicate semantic tool names are not allowed. Stage-runtime scoped
   implementations must use the same canonical tool IDs as registry tools:
   `read`, `glob`, `search_code`, `list`, and `memory`. They may bind a
   narrower workdir/evidence root or a scoped implementation behind that ID,
   but they must not expose `read_file`, `find_files`, `list_directory`,
   `memory_search`, or `memory_get`.

### Pool Semantics

`global` does not mean "visible to every agent". It means the tool is part of
the global registry pool and may be selected by an agent assignment. The agent's
visible registry surface is:

```ts
visible = assignment.global + assignment.private
```

`private` means the tool is role-owned or runtime-owned. Private IDs must be
defined in the owning agent/runtime domain. Private IDs may refer to scoped
agent-owned tools such as orchestrator workflow tools or frontend output tools;
they must not be near-synonyms for global tools.

Private scoped implementations still use canonical names when the capability is
semantically the same as a registry tool. Examples:

| Old stage-runtime name | Canonical name | Required behavior                                                                                             |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `read_file`            | `read`         | Same read capability; scoped implementation binds the stage workdir and uses `filePath` / `offset` / `limit`. |
| `find_files`           | `glob`         | Same file discovery capability; scoped implementation binds the stage workdir and uses `pattern` / `path`.    |
| `list_directory`       | `list`         | Same directory listing capability; scoped implementation binds the stage workdir and uses `path` / `ignore`.  |
| `search_code`          | `search_code`  | Already canonical; scoped implementation may bind the stage workdir.                                          |
| `memory_search`        | `memory`       | Same memory search capability; scoped implementation exposes read-only `search` action.                       |
| `memory_get`           | `memory`       | Same memory read capability; scoped implementation exposes read-only `get` action.                            |

If a future private tool is not semantically the same as a global registry tool,
its name must show the boundary, for example `evidence_read` or
`task_artifact_find`, not a near-synonym of a global tool.

### Acceptance

- No built-in agent in `agent.ts` contains `tools.include` or `tools.exclude`.
- Global registry tool definitions live in one global tool definition module;
  private tools stay in their owning agent/runtime modules.
- `ToolRegistry.tools()` no longer contains agent-name-specific evidence
  filters; the pool contract owns that visibility.
- `Config.Agent.tools` uses `global/private`, not `include/exclude`.
- Built-in `config.agent.<role>.tools` is rejected so role surfaces cannot drift
  from the canonical pool contract.
- `Agent.Info.tools` is a projection from `AgentToolPool`, not an independent
  editable source for built-in agents.
- Stage-runtime context tools no longer expose `read_file`, `find_files`,
  `list_directory`, `memory_search`, or `memory_get`; they expose scoped
  `read`, `glob`, `search_code`, `list`, and read-only `memory`.
- `SkillMount.agentCanUseSkillTool()` and required-tool checks use
  `AgentToolPool`, not include/exclude.
- Skill definitions and compatibility checks use canonical tool IDs. If an
  existing skill declares a legacy duplicate tool ID, loading must fail loudly
  with a schema/compatibility error rather than silently mapping it.
- Tests cover:
  - the two-pool schema;
  - built-in override rejection;
  - visual/frontend/integrity private tool ownership;
  - registry filtering through the pool contract;
  - mounted skill required-tool checks through the pool contract.
