# Instruction @ Reference NPM Scope Root Repair

Date: 2026-06-27

## Failure

Re-posting the TradingView world-economy task after the stale session-status task-delete repair created task `tsk_f08127fb4001LECmi6HPWehLXr`, but the orchestrator failed before the first model turn:

```text
ENOENT: no such file or directory, scandir 'C:\Users\chuan\myhexin-local\demos\economy\world-economy\ainvest'
```

The stack reproduced locally:

```text
findNamedFiles -> resolveReference -> renderInstructionFile -> InstructionPrompt.system
```

The project `AGENTS.md` contains a fenced TypeScript snippet with `from '@ainvest/vibe-bridge'`. `ConfigMarkdown.files()` treated that npm scoped package as an `@file` include, then `resolveReference()` tried to case-insensitively search a non-existent `world-economy\ainvest` parent directory.

## Call Points Checked

| Surface | Calls |
| --- | --- |
| `ConfigMarkdown.files()` | `packages/opencorvus/src/session/instruction.ts`, `packages/opencorvus/src/session/prompt/parts.ts` |
| Instruction rendering | `InstructionPrompt.systemPaths()`, `InstructionPrompt.system()`, `InstructionPrompt.resolve()` |
| Existing plan constraint | `specs/records/2026-06/2026-06-27-bug-hunt-residual-convergence.md` keeps discovered instruction-file read failures fail-fast, while missing optional matches may remain empty. |

## Fix Shape

- Keep `@file` references as the only include syntax.
- Do not parse `@...` references inside Markdown fenced code blocks or inline code spans.
- When resolving an optional include, a missing parent directory means the include is unresolved. Other directory read failures remain real errors.
- Do not create placeholder `ainvest` directories and do not edit the project instruction content to hide the parser bug.

## Acceptance

- `ConfigMarkdown.files()` ignores scoped npm imports and doc tags inside Markdown code.
- `InstructionPrompt.system()` does not throw for a missing optional include parent.
- A discovered instruction file that cannot be read still throws.
- Re-running the failed task no longer dies on `world-economy\ainvest` before the first model turn.
