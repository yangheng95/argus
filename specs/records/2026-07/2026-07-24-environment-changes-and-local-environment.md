# Environment Changes and Local Environment

## Recall

### User requirement

- Restore the missing `变更` row in the Environment Information popover.
- Make the Environment heading `+` functional by following the installed Codex Desktop implementation.
- The user selected full implementation: persist project-local variables and setup script and apply them to Bash and session-shell commands.
- Create a local commit after validation, but do not push.

### Acceptance criteria

- `变更` remains visible whenever the Environment details render, including an empty `+0/-0` state, and opens the canonical Review/Changes target.
- The Environment heading `+` is an accessible button that opens one shared local-environment editor.
- The editor persists one project-owned local environment in `.opencorvus/opencorvus.jsonc` through the existing `PATCH /config` route.
- The local environment contains a required display name, string environment variables, and an optional setup script.
- The configured variables and setup script affect the next Bash tool and session-shell command without mutating `process.env` or requiring an application restart.
- Project safety variables remain authoritative; there is no `.env` fallback, process-global mutation, duplicate file, database field, or session shadow state.
- Backend schema/runtime tests, Overlay source/browser tests, type checks, internationalization checks, generated API checks, real rendering screenshots, and a second review pass complete successfully.

### Hard constraints

- Preserve all unrelated dirty work in the current worktree.
- Do not create a worktree or restart/refresh the user's running OpenCorvus or Overlay.
- Run Playwright through Node, not Bun.
- Use existing `Config.Info`, `PATCH /config`, Kobalte-backed `Dialog`, shared `Button`, and canonical `acceptance:focus-changes` ownership.
- Do not use terminal profiles as the Task/project environment source.
- Commit subject must begin with `dsw-33987`; do not push.

### Sources read

- `AGENTS.md` rules 7, 8, 16, 28, 32, 35, 36, 39, and 44.
- `specs/records/2026-07/2026-07-15-codex-sidebar-search-environment-parity.md`.
- `specs/records/2026-07/2026-07-17-environment-popover-codex-completion.md`.
- Installed Codex Desktop bundle `local-conversation-thread-Dp_Iw8nC.js`, where the header plus owns Create local environment and Changes remains independent from nonzero diff statistics.
- `packages/overlay/src/components/TaskDirBar.tsx`, `packages/overlay/src/services/config.ts`, and Environment tests.
- `packages/opencorvus/src/config/config.ts`, `tool/bash.ts`, `session/shell-exec.ts`, project config routes, and config/runtime tests.

### Whole-repository search results

| Owner / call site                                                                                  | Decision                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.visibleChangeGroups` / `project-runtime-changes`                                       | Keep `currentChangeGroups()` and resolved per-file totals as the only Changes source; remove only the nonempty render gate. |
| `acceptance:focus-changes` consumers in `main.tsx` and Review components                           | Reuse unchanged; no new Review route or callback.                                                                           |
| Environment heading decorative `project-runtime-panel-trailing-control`                            | Replace with one shared `Button` that opens the local-environment dialog.                                                   |
| `Config.Info`, non-project load boundary, global config writers                                    | Add one strict project-owned `local_environment`; reject it in all non-project/global sources.                              |
| `GET/PATCH /config`, project JSON Merge Patch writer, Overlay `patchConfig`                        | Reuse unchanged as the only persistence path.                                                                               |
| `BashTool` and `SessionShell`                                                                      | Use one shared local-environment projector for variable merge and same-shell setup-script composition.                      |
| terminal profiles, formatter, Language Server Protocol, Model Context Protocol, provider env names | Leave unchanged; they are subsystem-specific environment contracts.                                                         |
| OpenAPI and generated TypeScript SDK                                                               | Regenerate from the changed canonical schema.                                                                               |

### Independent agent feedback

- Repository exploration found no first-class Task/project execution-environment model and rejected terminal-profile reuse.
- Local Codex asset inspection proved the plus opens Create local environment, with manual variables/setup configuration, while Changes visibility is not tied to dirty/nonzero statistics.
- Config/runtime exploration recommended the existing project config plus one shared command projector as the smallest single-source implementation.

## Root cause

The Environment surface copied Codex's visual structure but retained two incomplete projections. First, the Changes row is wrapped in a nonempty `currentChangeGroups()` condition, although Codex renders the row independently from whether statistics are zero. Second, the heading plus was deliberately rendered as `aria-hidden` decoration because OpenCorvus had no project-local environment contract. Leaving it inert creates a visible false affordance. Wiring it only to a dialog would still be false because variables would not reach command execution.

## Implementation plan

1. Add a strict project-owned local-environment schema with `name`, `variables`, and optional `setup_script`, enforce project-only loading/writing, and regenerate API artifacts.
2. Add one shared runtime projector that reads `Config.get()`, merges variables without mutating the host process, and prepends setup source in the same shell command; integrate it into Bash and session shell.
3. Make Changes unconditional inside the Environment details and replace the decorative plus with an accessible dialog trigger.
4. Implement the Kobalte-backed editor with add/remove variable rows, duplicate/empty-key validation, project config persistence, busy/error states, and reopen/edit behavior.
5. Add backend, Overlay source, and Node-launched browser regressions; render and inspect the Environment panel and editor screenshots.
6. Run focused and generated-contract checks, perform a second diff review, update this record with evidence, and create a local `dsw-33987` commit without pushing.
