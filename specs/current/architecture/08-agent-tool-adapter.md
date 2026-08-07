# 08 - Agent Tool Projection

> Current sources: `packages/opencorvus/src/agent/role-contract.ts`,
> `packages/opencorvus/src/agent/tool-pool-contract.ts`,
> `packages/opencorvus/src/agent/runtime-template-registry.ts`,
> `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`, and
> `packages/opencorvus/src/tool/registry.ts`. Work-specific harness ownership
> is defined by `packages/opencorvus/src/work/harness.ts`.

Tool visibility is derived from the runtime identity class. There is no free
native-agent registry and no custom-agent default tool pool.

## Fixed Identities

- `PrimaryAssistantRegistry` owns `coding`, `chat`, `work`, `control`, and
  `mission`.
- `HelperAgentRegistry` owns `title`, `summary`, and `compaction`.
- `HostAgentRegistry` owns the fixed scheduler identity `orchestrator`.
- `AgentRoleContract` maps each fixed identity to its code-owned tool-pool
  assignment and runtime behavior.
- `AgentToolPool.assignment` materializes that exact assignment. An unknown
  identity fails instead of receiving a default pool.
- `mission_skill` is visible only in the fixed `mission` assignment. It is a
  deferred core tool whose turn-resolved surface is bound only when both the
  selected agent and session kind are `mission`; all other fixed identities
  receive neither this tool nor its catalog.

Chat and Work reuse one conversation runtime, Session/Message persistence,
provider and permission resolution, Skill and MCP loaders, delegation,
attachments, Interactive Artifacts, and right-sidebar lifecycle. They remain
different fixed harnesses: `work/harness.ts` owns the Work runtime prompt,
default capability assignment, typed office tool inventory, and parent-only
delivery policy. `ConversationCapability` parameterizes the shared project
configuration implementation by the exact `chat | work` identity; neither
harness reads or writes through the other's assignment.

## Projected Workers

`capability_projection.agents.<agent-id>` is the only package-worker identity
source. Resolver-owned `universal-build` is the sole platform worker identity;
it is projected only into scheduler dispatch and never into package membership
or virtual workflows.
`PromptProfileResolver` resolves the active package once and returns the exact
projected tool, skill, and Model Context Protocol (MCP) capability for that ID.

`RuntimeTemplateRegistry.get(base_role).baseToolPool` is only a seed. The
worker's final visible tool set is materialized by
`ToolRegistry.projectedWorkerTools` from the resolved projection and remains
bound to the dynamic agent ID. A base role is not a dispatch alias and must not
be reverse-mapped to a worker.

Package-local tools, inherited template tools, and explicit projection refs are
validated as one immutable resource closure. Missing refs, unknown owners, and
unprojected resources fail during package preparation.

Runtime templates and projected workers never contain `mission_skill`.
Production package Skills continue to use the independent deferred `skill`
tool and `PromptProfileResolver` projection. SessionLoop owns one shared
Skill-family resolver: it chooses exactly one of native Mission Skill,
projected production Skill, or no Skill surface, then uses the same resolved
surface for tool binding and system-prompt policy.

## Dispatch Lineage

Every projected worker runs through the same public `dispatch_agent` boundary.
That boundary records one immutable lineage edge keyed by the exact dynamic
agent identity, visible tool call, work scope, and concrete child Session. The
selected typed adapter receives the lineage handle and may bind a terminal
outcome plus optional exact Delivery Slice revision subjects to it,
but it must not open adapter-specific ownership.
The edge has no mutable lifecycle state and is never queue admission.

Agent-to-Agent redispatch is a two-step visible protocol: coordination records
a pending action, then a later explicit `dispatch_agent` call atomically binds
that action to one lineage edge after validating the frozen worker identity,
expert-squad identity, worker-turn descriptor, and scope. No adapter-specific
redispatch path exists.

## Verification

- `test/agent/role-contract.test.ts`
- `test/agent/runtime-template-registry.test.ts`
- `test/tool/registry.test.ts`
- `test/mission-skill/runtime.test.ts`
- `test/tool/skill.test.ts`
- `test/expert-squad/dynamic-agent-resolver.test.ts`
- `test/expert-squad/package-tool-bundle.test.ts`
- `test/engine/execution-liveness-retired.test.ts`
- `test/orchestrator/dispatch-agent-tool.test.ts`
