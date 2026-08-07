# TaskArtifact Bootstrap Corruption Isolation

## Recall

| Item | Details |
| --- | --- |
| User request | Diagnose and repair the API 500 raised when TaskArtifact recovery finds an invalid Engine Artifact resource reference. The user clarified that moving bytes to another directory does not solve deletion and that deleting one Artifact must not make the whole product fail. |
| Acceptance criteria | A missing or corrupt TaskArtifact remains an exact, visible failure when that Artifact/resource is read; project `InstanceBootstrap`, VCS, Task events, Session events, and unrelated Artifacts remain available; recovery never deletes or fabricates corrupt evidence; focused positive non-User Interface (UI) contracts, typecheck, document health, and diff review pass. |
| Hard constraints | Preserve strict manifest/path/media-type/byte-count/SHA-256 verification. Do not add a fallback reader, compatibility path, automatic repair, database mutation, runtime restart, UI automated test, new worktree, or unrelated cleanup. Preserve all concurrent work. Commit with the `dsw-33987` prefix and push `v0.0.26beta` to `legacy-remote`. |
| Sources read | `AGENTS.md`; `specs/current/architecture/02-data.md`; `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`; `specs/records/2026-07/2026-07-30-settings-control-plane-attachment-authority-isolation.md`; `packages/opencorvus/src/{project/bootstrap.ts,project/open-lifecycle.ts,task-artifact/recovery.ts,task-artifact/store.ts}`; focused recovery, project-open, frontend-research resource, and cross-Task import contracts. |
| Whole-repository search evidence | `rg -n "removeUnreferencedTaskArtifactRoots" packages/opencorvus/src packages/opencorvus/test specs`; `rg -n "listTaskArtifactSnapshots\\(|readTaskArtifactRef\\(|discardEngineArtifactResources\\(" packages/opencorvus/src packages/opencorvus/test`; `rg -n "task-artifact\\.recover-unreferenced|TaskArtifact recovery" packages/opencorvus/src packages/opencorvus/test specs`; `rg -n "TaskArtifact|task_artifact|EngineArtifactTable|engine_artifact" packages/opencorvus/src`; read-only SQLite enumeration of every resource-bearing current/history Engine Artifact and its registered Project. |
| Independent agent feedback | No independent Agent was requested or used. The user's direct review rejected storage relocation as the causal fix and established per-Artifact failure isolation as the required boundary. |

## Incident evidence

- Engine Artifact `art_idempotent_ddac2cf863b624726760de3506836b95aca7a8c953afaf3f7a99c9af001b4639@466`
  is valid persisted metadata for Task `tsk_fb3deccf2001cylH8ORWysW6bS` and
  references five exact resources.
- `/Users/yangheng/Documents/OpenCorvus-Demos/prism/.opencorvus/.r/t` is
  absent, so the first exact resource read fails with `ENOENT` before its
  manifest can be verified.
- The same failure shape exists in a second registered managed Project. Of the
  four current Projects with resource-bearing Engine Artifacts, two have a
  missing complete TaskArtifact root.
- `InstanceBootstrap` currently awaits the strict retention scan. Its first
  corrupt resource therefore rejects Instance initialization, and every route
  that enters that Instance receives the same API 500 even when it never reads
  an Artifact.

## Causal chain

1. SQLite owns the Engine Artifact envelope while TaskArtifact snapshot bytes
   are immutable filesystem publications.
2. Deleting one snapshot creates an explicit integrity failure; strict
   `readTaskArtifactRef` correctly refuses to substitute or recreate bytes.
3. The retention scan performs that exact resource read inside global project
   bootstrap rather than inside the Artifact/resource consumer boundary.
4. The correct local integrity error is therefore promoted into Project
   unavailability and repeated by VCS, Task-event, and Session-event requests.
5. Relocating the files changes only which directory can disappear. It does
   not repair the incorrect failure ownership.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `removeUnreferencedTaskArtifactRoots` direct callers and strict store tests | Preserve the strict maintenance primitive and its exact errors. Explicit maintenance callers can still require complete integrity. |
| `InstanceBootstrap` | Call a new recovery-isolation boundary that converts one strict maintenance failure into a structured corruption report, logs the complete outer and direct-cause messages, and completes initialization. |
| `readTaskArtifactRef`, exact catalog read, evidence locator, Browser Preview consumers, cross-Task import | Keep strict. Reading the corrupt Artifact/resource remains a local error; no fallback or synthetic bytes are introduced. |
| Catalog optional Goal projection | Guard the optional `goal_id` projection with SQLite `json_valid`; a corrupt payload contributes `null` for that optional index field instead of aborting indexed search. Exact read remains strict. |
| Unreferenced snapshot deletion | Keep unchanged inside the strict primitive. The isolation boundary never retries, repairs, or performs a second cleanup path after corruption. |
| Tests | Add a positive recovery-report contract for a missing Task runtime root and a real InstanceBootstrap contract proving a reopened project remains available while the exact resource read still returns its explicit integrity error. |

## Implementation

1. Add one typed `TaskArtifactBootstrapRecoveryReport` union in
   `task-artifact/recovery.ts`: `completed` contains the exact removed paths;
   `corrupt` contains the normalized outer error and direct cause.
2. Add `recoverTaskArtifactsDuringBootstrap`, which invokes the existing
   strict primitive once and returns the report without alternate reads or
   mutations.
3. Make `InstanceBootstrap` log a dedicated
   `task artifact corruption isolated during project open` event for a corrupt
   report and continue with the existing bootstrap sequence.
4. Preserve strict resource reads and all deletion semantics.
5. Keep catalog enumeration on bounded index columns when one payload is
   corrupt; project optional `goal_id` only for valid JSON and leave exact
   payload verification to `artifact_read`.

## Storage follow-up boundary

SQLite currently stores the Engine Artifact envelope and exact resource
identity, not the resource bytes. A later direct-cutover storage task may put
immutable manifests and BLOB bytes in SQLite so filesystem materializations
are disposable caches. That work must update the complete SQLite schema,
current/history transfer, publication transaction, large-object read limits,
deletion cascades, and reset policy together. It is not a substitute for the
failure-ownership repair in this task and no partial dual-source path is
allowed.

## Verification plan

- Focused TaskArtifact recovery and project-bootstrap contracts.
- Existing frontend-research resource retention and cross-Task orphan cleanup
  contracts.
- `bun run --cwd packages/opencorvus typecheck`.
- Historical links, document health, and product-document single-source
  checks required for an architecture change.
- `git diff --check`, task-owned diff review, current-HEAD/staged-path audit,
  commit, and hook-verified push to `legacy-remote/v0.0.26beta`.

## Verification results

- The focused real lifecycle contract publishes an Engine resource, removes
  the complete Task runtime root, disposes and reopens the Project through
  `InstanceBootstrap`, receives the canonical Project/Task identity, and then
  receives the original `ENOENT` only from the exact resource read.
- TaskArtifactStore: 32 passed.
- Immutable cross-Task Artifact import: 11 passed. This run exposed and then
  verified the optional catalog `goal_id` projection fix: indexed lineage
  search remains complete beside a corrupt payload, while exact read reports
  the payload corruption.
- Project-open lifecycle plus frontend-research resources: 5 passed.
- Historical links, document health, and product-doc single-source: 72 passed.
- `bun run typecheck` in `packages/opencorvus`: passed.
- API route inventory and generated API documentation checks: passed.
- `git diff --check`: passed.
