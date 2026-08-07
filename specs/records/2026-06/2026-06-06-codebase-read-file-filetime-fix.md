# codebase read_file FileTime fix - 2026-06-06

## Symptom

`frontend-design` can read an existing target file with `read_file`, then fail `write` or `edit` with:

`You must read file ... before overwriting it. Use the Read tool first`

The concrete failure was observed in `frontend-design`, but the defect is not owned by that agent. It is in the shared codebase `read_file` implementation.

## Root Cause

There are two read tools:

| Tool        | Implementation                                     | FileTime effect                                  |
| ----------- | -------------------------------------------------- | ------------------------------------------------ |
| `read`      | `packages/opencorvus/src/tool/read.ts`             | Calls `FileTime.read(ctx.sessionID, filepath)`   |
| `read_file` | `packages/opencorvus/src/engine/codebase-tools.ts` | Returns text only; does not call `FileTime.read` |

`frontend-design` receives `read_file` from `createAgentContextTools()` and receives write tools from the registry/runtime surface. `write` and `edit` call `FileTime.assert(ctx.sessionID, filepath)` before overwriting existing files. Because `read_file` does not register the read, the host-side write protection cannot see that the same session already read the file.

## Affected Scope

Any session that reads a text file through `createCodebaseTools().read_file` and later overwrites that same existing file through a tool that calls `FileTime.assert` is affected.

Current first-party surfaces checked:

| Surface                                                  | `read_file` source                        | Project-write surface                     | Result                                            |
| -------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `frontend-design`                                        | `createAgentContextTools()`               | `write` / `edit` / `bash` / `apply_patch` | Affected for `write` and `edit`                   |
| `requirements`                                           | `createAgentContextTools()`               | No project write tools in its toolkit     | Not currently triggerable                         |
| `architect`                                              | `createAgentContextTools()`               | No project write tools in its toolkit     | Not currently triggerable                         |
| `intent-analysis`                                        | `createAgentContextTools()`               | No project write tools in its toolkit     | Not currently triggerable                         |
| `fact-check` / `deep-research` / `goal-workload-analyst` | readonly retrieval/context tools          | No project write tools in their toolkit   | Not currently triggerable                         |
| `integrity` acceptance tools                             | `createCodebaseTools()`                   | read-only `run_command` guard only        | Not currently triggerable                         |
| `build`                                                  | registry `read`, not codebase `read_file` | registry `write` / `edit`                 | Already uses `ReadTool`, which records `FileTime` |

This is why the fix belongs in `createCodebaseTools().read_file`: it covers the current `frontend-design` failure and any future or configured surface that combines shared `read_file` with overwrite tools, without weakening `FileTime.assert`.

## Grep Coverage

- `rg -n "FileTime\.read|FileTime\.assert|read_file|createCodebaseTools" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `createCodebaseTools` callers:
  - `packages/opencorvus/src/agent/context-tools.ts`
  - `packages/opencorvus/src/agent/retrieval-tools.ts`
  - `packages/opencorvus/src/integrity/acceptance-tools.ts`
  - tests under `packages/opencorvus/test/agent`, `packages/opencorvus/test/integrity`, `packages/opencorvus/test/tool`
- Write-side assertions:
  - `packages/opencorvus/src/tool/write.ts`
  - `packages/opencorvus/src/tool/edit.ts`

## Fix

Use the existing session metadata that `SessionLoop.wrapExtraTool` injects into extra-tool execute options:

`options.opencorvus.sessionID`

When `read_file` successfully reads a text file, call:

`FileTime.read(sessionID, abs)`

This keeps `FileTime` as the single source for read-before-write protection and avoids adding a second gate or weakening overwrite safety.

## Tests

Add a regression test showing that `createCodebaseTools(...).read_file` records `FileTime` for the supplied session, so the same session can overwrite the existing file through the real `write` tool.
