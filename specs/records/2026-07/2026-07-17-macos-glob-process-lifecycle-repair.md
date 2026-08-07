# macOS Glob Process Lifecycle Repair

## Recall

- User request: thoroughly resolve the `glob` command hanging on macOS.
- Acceptance criteria:
  - stopping `Ripgrep.files()` iteration early must terminate the owned ripgrep process through the canonical cross-platform process lifecycle;
  - no orphaned or still-referenced six-second timeout may keep Bun alive after ripgrep has exited;
  - `GlobTool` must retain its 100-result truncation behavior and return the same result contract;
  - the real macOS repository scan that previously took about 6.05 seconds to let the Bun process exit must complete without the six-second tail;
  - regression tests, type checking, document-health checks, and a second review must pass.
- Hard constraints:
  - no timeout gate, fallback, compatibility path, state machine, or platform-specific bypass;
  - reuse `Process.Child.terminate()` and `ProcessSupervisor.awaitWithTimeout()` as the single process-lifecycle source;
  - do not restart or interfere with a running OpenCorvus/Overlay process;
  - preserve unrelated untracked files and native build artifacts;
  - commit subjects use the `dsw-33987` prefix and delivery pushes the current main delivery branch to `myhexin`.
- Sources read:
  - `AGENTS.md`;
  - `packages/opencorvus/src/tool/glob.ts`;
  - `packages/opencorvus/src/file/ripgrep.ts`;
  - `packages/opencorvus/src/util/process.ts`;
  - `packages/opencorvus/src/shell/process-supervisor.ts`;
  - `packages/opencorvus/test/tool/glob.test.ts`;
  - `packages/opencorvus/test/file/ripgrep.test.ts`;
  - `packages/opencorvus/test/file/isolated/ripgrep-early-stop.isolated.ts`;
  - `specs/README.md` and `specs/records/2026-07/README.md`.
- Whole-repository search evidence:
  - the user-facing tool is defined once in `packages/opencorvus/src/tool/glob.ts` and stops `Ripgrep.files()` after the 100-result limit;
  - `Ripgrep.files()` call sites are `file/index.ts`, `tool/skill.ts`, `tool/ls.ts`, `tool/glob.ts`, the debug command, and tests; all share the same generator cleanup;
  - the only private `terminateChild()` is in `file/ripgrep.ts`;
  - the canonical child termination contract is `Process.Child.terminate()` in `util/process.ts`, backed by `ProcessSupervisor.terminateProcessGroup()` on macOS/Linux and `terminateProcessTree()` on Windows;
  - `ProcessSupervisor.awaitWithTimeout()` clears its timer in `finally`; the private `terminateChild()` races against an anonymous 6,000 ms timer that is never cleared.
- Independent agent feedback: none; the user did not request sub-agents or parallel audit, so the current collaboration policy prohibits delegation.

## Evidence and causal chain

Observed on macOS ARM64 from the repository root:

```text
Ripgrep.files() produced 100 entries in approximately 15 ms.
The enclosing `bun -e` process exited after 6.05 seconds.
```

The observable scan is fast. `GlobTool` reaches its 100-result limit and closes the async generator. The generator enters its incomplete-cleanup branch. The private cleanup sends `SIGTERM`, then races `proc.exited` against an anonymous six-second timer. When ripgrep exits first, the promise resolves but the losing timer remains referenced by the Bun event loop. The shell therefore observes a six-second tail even though the tool result is ready. The prior regression test only asserted that `SIGTERM` was sent, so it did not verify canonical process ownership or absence of a retained timer.

## Call-site disposition

| Surface                            | Current role                      | Disposition                                                                                                                        |
| ---------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tool/glob.ts`                     | stops enumeration at 100 results  | preserve behavior; cover the real truncation path                                                                                  |
| `tool/ls.ts`                       | may stop enumeration at its limit | inherits repaired generator cleanup                                                                                                |
| `tool/skill.ts`                    | enumerates bounded Skill files    | replace arbitrary stream-prefix sampling with deterministic sorted sampling                                                        |
| `file/index.ts`                    | project file enumeration          | inherits repaired generator cleanup                                                                                                |
| `cli/cmd/debug/ripgrep.ts`         | debug enumeration                 | inherits repaired generator cleanup                                                                                                |
| `file/ripgrep.ts::terminateChild`  | duplicate direct-signal cleanup   | delete                                                                                                                             |
| `util/process.ts::Child.terminate` | canonical ownership-aware cleanup | keep process-group ownership as default; let leaf executables declare process ownership while retaining the same `terminate()` API |
| `shell/process-supervisor.ts`      | POSIX process-group ownership     | preserve strict process-group permission failures for real tree-owning callers                                                     |

## Implementation

1. Delete `file/ripgrep.ts::terminateChild()`.
2. In the generator `finally`, call `await proc.terminate()` when enumeration does not complete.
3. Add explicit `process` versus `process-group` ownership to `Process.spawn`, with process-group ownership as the unchanged default and one canonical `terminate()` method.
4. Declare ripgrep as a leaf `process` owner, so its termination uses cleared TERM/KILL settlement timers without negative-PGID signalling.
5. Make `Process.Child.terminate()` return immediately only after its owned child has emitted `close` evidence.
6. Update the isolated lifecycle fixture to expose and assert the canonical `terminate()` contract, and to reject any caller-side direct `kill()` use.
7. Add a real-process truncation regression that executes the production path with more than 100 files and asserts the child command exits within a bounded acceptance threshold well below the old six-second tail.
8. Re-run the original macOS reproduction and record measured exit time.
9. Make bounded Skill supporting-file sampling deterministic after the lifecycle repair exposes its pre-existing arbitrary ripgrep-order dependency.

## Result

- `Ripgrep.files()` early-stop cleanup now calls `Process.Child.terminate()` directly; the duplicate direct-signal cleanup and its unowned timer are deleted.
- `Process.spawn` now models `process` versus `process-group` ownership while preserving process-group cleanup as the default. Ripgrep declares leaf-process ownership, so the same `terminate()` API performs cleared TERM/KILL settlement without negative-PGID signalling. Tree-owning callers retain strict process-group cleanup and permission failures.
- The isolated lifecycle regression requires exactly one canonical `terminate()` call and throws if the implementation calls `kill()` directly.
- Skill supporting-file sampling now sorts the complete bounded Skill directory before taking ten entries, so required evidence no longer depends on ripgrep/filesystem enumeration order.
- A real macOS Bun subprocess regression enumerates 100 repository files through the production ripgrep runtime and requires the complete subprocess to exit in under two seconds.
- The original reproduction changed from `real 6.05s` to `real 0.05s`; the measured operation was 10 ms. There is no orphaned event-loop handle or process-group settlement tail.

## Verification

- `bun test packages/opencorvus/test/tool/glob.test.ts packages/opencorvus/test/file/ripgrep.test.ts`
- real macOS `bun -e` reproduction using `Ripgrep.files()` with early break at 100
- relevant package typecheck
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- second diff review plus working-tree ownership check
