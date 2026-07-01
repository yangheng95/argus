# Current Architecture Specs

This directory contains the living OpenCorvus architecture source of truth. Dated investigation notes, migration logs, benchmark records, and task-specific plans live under their matching month in `specs/records/YYYY-MM/`.

## Overview Diagrams

| File                             | Scope                                              |
| -------------------------------- | -------------------------------------------------- |
| [01-agents.svg](01-agents.svg)   | Agent family and execution chain.                  |
| [02-data.svg](02-data.svg)       | Data plane, storage, trace, and bus relationships. |
| [03-control.svg](03-control.svg) | Control plane and extension entry points.          |
| [17-agent-team-infrastructure.html](17-agent-team-infrastructure.html) | Agent Team infrastructure, skill/MCP/memory/workflow/expert-squad map. |

## Chapters

| File                                                                 | Scope                                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [01-agents.md](01-agents.md)                                         | Agent family, Task Control Loop, mini-workflows, and task kind ownership.         |
| [02-data.md](02-data.md)                                             | `engine_*` tables, session domain, trace, bus, and decision log.                  |
| [03-control.md](03-control.md)                                       | Channel ingress, control messages, and panel capability routing.                  |
| [04-extensions.md](04-extensions.md)                                 | Executor, plugin, MCP, and ACP extension entries.                                 |
| [05-config.md](05-config.md)                                         | Unified config ownership and PATCH flow.                                          |
| [06-provider.md](06-provider.md)                                     | LLM provider adaptation layers.                                                   |
| [07-panel.md](07-panel.md)                                           | Workbench, panel surfaces, and SSE event contracts.                               |
| [07-panel-reactivity.md](07-panel-reactivity.md)                     | Overlay reactivity and projection constraints.                                    |
| [08-agent-tool-adapter.md](08-agent-tool-adapter.md)                 | AgentToolPool ownership, registry filtering, private tools, and runtime switches. |
| [09-verification-evidence.md](09-verification-evidence.md)           | Verification evidence storage and consumption.                                    |
| [10-worktree-lifecycle.md](10-worktree-lifecycle.md)                 | Goal worktree lifecycle and merge-back ownership.                                 |
| [11-agent-oop-protocol.md](11-agent-oop-protocol.md)                 | Agent object model, capability contract, mailbox, registry, and whitelist notes.  |
| [12-overlay-card-system.md](12-overlay-card-system.md)               | Overlay card shell, payload, policy, and writer model.                            |
| [13-agent-communication-matrix.md](13-agent-communication-matrix.md) | Agent communication routes and allowed ownership boundaries.                      |
| [14-agent-runtime-mode.md](14-agent-runtime-mode.md)                 | Agent spec, runtime mode, context strategy, and budget policy.                    |
| [16-unified-teardown.md](16-unified-teardown.md)                     | Minimal session runtime, orchestrator ownership, and cleanup boundaries.          |
| [18-webpage-replica-agent-workflow.md](18-webpage-replica-agent-workflow.md) | Webpage replica workflow agent topology, evidence handoff, and review feedback loops. |
| [99-principles.md](99-principles.md)                                 | Core principles, anti-patterns, and non-negotiable constraints.                   |

## Maintenance Rules

1. Code changes that alter architecture contracts must update the relevant chapter in this directory.
2. New current architecture concepts are documented here first; SVG diagrams are summaries only.
3. Dated implementation records and audit notes are stored in `specs/records/YYYY-MM/`, not in this directory.
4. Product documentation belongs in `packages/web/src/content/docs/**`.
5. Every landed architecture-change plan must include a `Recall` section before implementation changes continue.
6. Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` after any spec move, deletion, or new spec path.
