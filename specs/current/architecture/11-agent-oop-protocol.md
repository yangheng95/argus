# 11 — Agent Role Contracts

> 对应代码（真源）：`packages/opencorvus/src/agent/agent.ts` ·
> `packages/opencorvus/src/agent/role-contract.ts` · `packages/opencorvus/src/agent/runner.ts` ·
> `packages/opencorvus/src/session/loop.ts` · `packages/opencorvus/src/session/llm.ts` ·
> `packages/opencorvus/src/orchestrator/tools.ts` · `packages/opencorvus/src/prompt/core/`

This chapter records the current agent contract boundary. It does not claim a
runtime `BaseAgent`, mailbox database, point-to-point whitelist protocol, or
class hierarchy exists.

## Current Agent Model

| Surface                              | Current responsibility                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `agent/agent.ts`                     | Registers native agent identities, display metadata, prompt ownership, and declared tool include/exclude adapters. |
| `agent/role-contract.ts`             | Defines `AgentRoleContract` and the role IDs used by UI/config surfaces.                                           |
| `agent/runner.ts`                    | Runs agent sessions through the shared session/LLM runtime.                                                        |
| `agent/context-packet.ts`            | Defines the shared, workflow-neutral context packet protocol for text, structured data, and multimodal refs.      |
| `prompt/core/*.txt`                  | Source-controlled prompts for orchestrator and specialist workflow roles.                                          |
| `orchestrator/tools.ts`              | Owns workflow dispatch tools and specialist-session creation.                                                      |
| `session/loop.ts` / `session/llm.ts` | Own streaming model calls, tool execution, message parts, and session lifecycle.                                   |

The current runtime is prompt-and-session based. Agent identity is a data
contract, not an object inheritance tree.

## Tool Visibility

Agent tool visibility has one active source:

1. `Agent.Info.tools` declares include/exclude adapters for native roles.
2. `ToolRegistry.tools(model, agent)` applies those adapters for ordinary agent
   sessions.
3. Orchestrator workflow/control tools are created by `createOrchestratorTools`
   and are not inferred from a class registry.
4. Session permission rules may deny tools at session creation time.

Docs must not describe a hidden compatibility tool path or an unimplemented
registry query as current behavior.

## Prompt Ownership

- Core workflow prompts live in `packages/opencorvus/src/prompt/core/*.txt`.
- Session-style prompts live under `packages/opencorvus/src/agent/prompt/*.txt`.
- Project config can override configured prompt keys through the config layer.
- Skills are appended by the skill-loading path, not by a separate agent class.

## Context Handoff

Agent-to-agent and scheduler-to-worker evidence handoff uses
[`15-agent-context-packet.md`](15-agent-context-packet.md) as the current
architecture contract. New agent roles must consume upstream context through
`AgentContextPacket[]` and must publish reusable handoff data as text,
structured schema-bearing parts, or link/index-based media refs. They must not
create role-specific context aliases, route by producer `source` labels, or
inline media bytes in prompt context.

## Retired Roles

The standalone planner package, acceptance review agent, deliver/prosecutor
paths, and planning-tool role are not current runtime agents. Their history
belongs in the matching month under `specs/records/YYYY-MM/**`; current docs may mention them only as
deleted roles when needed to prevent confusion.

## Current Constraint

New agent roles must extend the data contract first:

- add or update `Agent.Info`;
- add a matching `AgentRoleContract` entry when the role is user/config visible;
- provide a single prompt source;
- define tool visibility through the existing adapter path;
- add tests for tool exposure, prompt ownership, and dispatch behavior.

Do not document a class-based mailbox/registry protocol as current until it is
implemented in code and backed by tests.
