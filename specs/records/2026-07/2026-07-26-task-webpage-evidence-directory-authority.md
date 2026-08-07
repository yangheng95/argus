# Task webpage evidence directory authority

## Recall

### User requirement

- Continue the real Prism test on `127.0.0.1:6888` against the canonical database.
- Use a fresh, explicitly bound product repository and repair infrastructure or Expert Squad defects exposed by the run.
- Do not treat tolerated omissions as failures. Evidence written to the wrong path, missing evidence, persistence/tool failures, duplicate execution, pollution, and deadlock are defects.
- Preserve unrelated parallel work. Do not add fallback, gate, compatibility, retry, or product-specific behavior.

### Acceptance

- A task whose root Session directory differs from the durable project storage namespace writes `webpage_extract`, `webpage_compile`, and `webpage_runtime_state` evidence below the task root Session directory.
- The returned project-relative evidence path is relative to that task execution repository and remains the canonical `.opencorvus/.r/t/<task-key>/webpage-evidence` path.
- All three webpage evidence tools share the same resolver and therefore the same corrected directory authority.
- Existing explicit external-output calls retain their separate external contract.

### Evidence

- Mission `e864db1ba91df58d`, Task `tsk_f9b80ab8f001PCJg41foNYG65a`, Orchestrator Session `ses_0647f4becffePDES3ji20HLCIC`, and researcher Session `ses_0647e8242ffdJ5zMftJuDBPw1G` were bound to `/Users/yangheng/Documents/OpenCorvus-Demos/prism/runs/tradingview-spaces-20260726-fresh-16`.
- Tool part `prt_f9b81e6e9001ze1u21YldUKrj3` nevertheless returned `/Users/yangheng/Documents/OpenCorvus-Demos/prism/.opencorvus/.r/t/qi/2ZL6Mp/webpage-evidence`.
- Tool part `prt_f9b824b04001kk8PdxOKgaz0Kj` compiled the same parent-project directory and wrote 187 sidecar assets there.
- The Task was cancelled after evidence capture exposed the mismatch. Its terminal error is `task cancelled`; the running dispatch settled with `AbortError`.

### Read sources and repository-wide call-point scan

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/records/2026-07/2026-07-22-webpage-evidence-and-coordination-continuation-contract-repair.md`
- `packages/opencorvus/src/frontend-design/tools/output-dir.ts`
- `packages/opencorvus/src/project/runtime-paths.ts`
- `packages/opencorvus/src/project/task-runtime-materializer.ts`
- `packages/opencorvus/src/engine/task-directory.ts`
- `packages/opencorvus/src/engine/task-session-lineage.ts`
- `packages/opencorvus/test/frontend-design/tools/output-dir.test.ts`
- Repository scans covered `webpage_extract`, `webpage_compile`, `webpage_runtime_state`, `resolveWebpageEvidenceOutputDir`, `webpageEvidencePaths`, `TaskRuntimeMaterializer`, `managedRuntimeDirectory`, `Instance.project.worktree`, task directory helpers, and all runtime-path consumers.

### Call-point disposition

| Call point | Disposition |
| --- | --- |
| `frontend-design/tools/output-dir.ts` task-session branch | Replace durable project worktree authority with the owning Task root Session directory. |
| `frontend-design/tools/webpage-extract.ts` | Keep; it already uses the shared resolver. |
| `frontend-design/tools/webpage-compile.ts` | Keep; it already uses the shared resolver. |
| `frontend-design/tools/webpage-runtime-state.ts` | Keep; it already uses the shared resolver. |
| `project/runtime-paths.ts` and `task-runtime-materializer.ts` | Keep; they correctly materialize below the directory supplied by the caller. |
| Plugin task host `managedRuntimeDirectory` | Keep; it already receives the task runtime directory from its execution scope. |
| Expert Squad catalog/config consumers of `Instance.project.worktree` | Keep; the durable parent project is intentionally the package/configuration authority, not product evidence authority. |

## Root cause

`resolveWebpageEvidenceOutputDir()` correctly found the owning Task ID from the worker Session, but then discarded the Task execution lineage and passed `Instance.project.worktree` to `ProjectRuntimePaths`. In a child-repository Task, `Instance.project.worktree` is the durable configuration namespace while the Task root Session directory is the product/evidence repository. The resolver therefore combined a task identity with the wrong directory authority.

## Repair

Resolve the Task row after determining the owning Task ID and pass `taskRootDirectory(task)` to the existing runtime-path/materializer APIs. This reuses the already-established single durable Task execution-directory authority and changes all three webpage evidence tools through their one shared resolver.

## Verification

- Add a regression where `Instance.project.worktree` is a parent repository and the Task root Session is an independent child repository.
- Assert the evidence directory is created only below the child Task directory and never below the parent.
- Retain the same-directory, override-rejection, and explicit-external-output tests.
- Run the targeted tests, package typecheck, historical-document links, and a fresh real 6888 Mission after the backend is explicitly reloaded.

### Real canonical-database verification

- Commit `143fa1bf8a` was pushed to `myhexin/v0.0.18beta`; the push hook passed repository typechecks, route inventory, API documentation, Overlay internationalization, and secret scanning.
- The 6888 backend was reloaded from the Prism project directory against `/Users/yangheng/.local/share/opencorvus/opencorvus.db`; health remained true and `PRAGMA quick_check` remained `ok`.
- Fresh Mission `c3c74a65eaf04ed7`, Task `tsk_f9b8c62c50013fZLDnmBoHnE1n`, and researcher Session `ses_06472904effdMVI9GbaSzIL0sw` were bound to fresh-17.
- Tool part `prt_f9b8dcbf8001MJxxDeVdX09Euy` wrote `webpage_extract` evidence below fresh-17.
- Tool part `prt_f9b8e2e92001O6onNhOCUTQi0f` compiled the same fresh-17 evidence directory with 187 sidecar assets.
- Tool part `prt_f9b8e2eb5001Uc1y3CQqMzIt2X` wrote runtime-state snapshots below the same fresh-17 directory.
- No repaired tool result points to the parent Prism `.opencorvus/.r` tree.
