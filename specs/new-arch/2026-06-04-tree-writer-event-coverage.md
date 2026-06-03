# Tree-writer event coverage audit

## Problem

The `question.asked` Mission crash was one instance of a broader coverage
hole. `routeSSEEvent` forwards non-message SSE events into
`tree-writer.applyEvent` before route-specific refresh logic runs. Any valid
wire event that tree-writer has not classified can therefore stop conversation
rendering with `tree-writer: unhandled event type`.

## Repository-wide event audit

The OpenAPI event registry currently declares 84 `Event.*` schemas. Comparing
that list against `tree-writer.ts` and `event-policy.ts` found 27 valid event
types without tree-writer classification:

| Event group | Events | Rendering decision |
| --- | --- | --- |
| TUI commands | `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `tui.session.select` | TUI-only control events. No overlay card. |
| Installation/project/lifecycle | `installation.updated`, `installation.update-available`, `project.updated`, `global.disposed`, `server.instance.disposed` | App/control-plane notifications. No conversation card. |
| MCP/LSP diagnostics | `mcp.tools.changed`, `mcp.browser.open.failed`, `mcp.prompts.changed`, `mcp.resources.changed`, `lsp.client.diagnostics`, `lsp.updated` | Tooling/diagnostic state. No conversation card. |
| Workspace/worktree/VCS | `workspace.ready`, `workspace.failed`, `worktree.ready`, `worktree.failed`, `vcs.branch.updated` | Environment state notifications. No conversation card. |
| Session side data | `session.compacted`, `task_plan.updated`, `todo.updated` | Session metadata/sidebars; message stream remains the card source. |
| File/command/task queue | `command.executed`, `file.edited`, `file.watcher.updated`, `task-queue.completed` | Side effects or queue notifications. No conversation card. |

These are not fallback cases. They are declared producer events with known
non-card semantics, so they belong in tree-writer's explicit no-op policy.

## Implementation Plan

1. Add the 27 declared non-card events to `TREE_WRITER_NOOP_TYPES`.
2. Replace broad prefix pass-through (`interaction.`, `task.`, etc.) with an
   exact list of declared pass-through events so retired or misspelled events
   still loud-fail.
3. Export `isTreeWriterKnownEventType` from `event-policy.ts`, combining
   projected exact handlers, no-ops, and pass-through classes.
4. Add an OpenAPI coverage regression test: every declared `Event.*` type must
   be known to tree-writer, and retired bogus event names must stay unknown.
5. Add a no-op regression test that representative control events do not create
   cards and do not throw.
