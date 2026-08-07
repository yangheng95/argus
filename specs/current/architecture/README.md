# Current Architecture Specs

This directory contains the living OpenCorvus architecture source of truth. Dated investigation notes, migration logs, benchmark records, and task-specific plans live under their matching month in `specs/records/YYYY-MM/`.

## Overview Diagrams

| File                             | Scope                                     |
| -------------------------------- | ----------------------------------------- |
| [03-control.svg](03-control.svg) | Control plane and extension entry points. |

## Chapters

| File                                                                 | Scope                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [01-agents.md](01-agents.md)                                         | Agent identity families, runtime templates, exact projected dispatch, and scheduler ownership.       |
| [02-data.md](02-data.md)                                             | Canonical runtime root, `engine_*` tables, session domain, trace, bus, and decision log.             |
| [03-control.md](03-control.md)                                       | Channel ingress, control messages, and panel capability routing.                                     |
| [04-extensions.md](04-extensions.md)                                 | Expert Squad, Mission Skill, plugin, MCP, and ACP extension entries.                                 |
| [05-config.md](05-config.md)                                         | Unified config ownership and PATCH flow.                                                             |
| [06-provider.md](06-provider.md)                                     | LLM provider adaptation layers.                                                                      |
| [07-panel.md](07-panel.md)                                           | Workbench, panel surfaces, and SSE event contracts.                                                  |
| [07-panel-reactivity.md](07-panel-reactivity.md)                     | Overlay reactivity and projection constraints.                                                       |
| [08-agent-tool-adapter.md](08-agent-tool-adapter.md)                 | AgentToolPool ownership, registry filtering, private tools, and runtime switches.                    |
| [09-verification-evidence.md](09-verification-evidence.md)           | Host verification and domain-specific evidence ownership.                                            |
| [10-worktree-lifecycle.md](10-worktree-lifecycle.md)                 | Task dispatch worktree lifecycle and merge-back ownership.                                           |
| [11-agent-oop-protocol.md](11-agent-oop-protocol.md)                 | Agent object model, capability contract, mailbox, registry, and whitelist notes.                     |
| [12-overlay-card-system.md](12-overlay-card-system.md)               | Overlay card shell, payload, policy, and writer model.                                               |
| [13-agent-communication-matrix.md](13-agent-communication-matrix.md) | Agent communication routes and allowed ownership boundaries.                                         |
| [14-agent-runtime-mode.md](14-agent-runtime-mode.md)                 | Agent spec, runtime mode, context strategy, and budget policy.                                       |
| [15-agent-facts-and-turns.md](15-agent-facts-and-turns.md)           | Durable facts, prompt projection, domain artifacts, Agent turns, and handoff.                        |
| [16-unified-teardown.md](16-unified-teardown.md)                     | Minimal session runtime, orchestrator ownership, and cleanup boundaries.                             |
| [17-code-work-agent-platform.md](17-code-work-agent-platform.md)     | Peer Code/Work product pillars, Work Missions, capability search, permissions, and daemon ownership. |
| [18-scheduled-automations.md](18-scheduled-automations.md)           | Explicit Session, Project, and global automation targets, polling, run history, and deletion.        |
| [99-principles.md](99-principles.md)                                 | Core principles, anti-patterns, and non-negotiable constraints.                                      |

## Maintenance Rules

1. Code changes that alter architecture contracts must update the relevant chapter in this directory.
2. New current architecture concepts are documented here first; SVG diagrams are summaries only.
3. Dated implementation records and audit notes are stored in `specs/records/YYYY-MM/`, not in this directory.
4. Product documentation belongs in `packages/web/src/content/docs/**`.
5. Every landed architecture-change plan must include a `Recall` section before implementation changes continue.
6. Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` after any spec move, deletion, or new spec path.
