# Project `.gitignore` Single OpenCorvus Rule

## Recall

- User request: stop OpenCorvus from injecting a large rule set into project `.gitignore` files.
- User correction on 2026-07-21: the only allowed rule is `.opencorvus/.r/`, not the whole `.opencorvus/` directory.
- Acceptance criteria:
  - a missing project `.gitignore` is created with exactly `.opencorvus/.r/`;
  - an existing project `.gitignore` preserves user content and appends only `.opencorvus/.r/` when missing;
  - repeated calls are byte-idempotent;
  - OpenCorvus no longer injects generic language/build/system rules, sibling runtime paths, root `artifacts/`, or Expert Squad exception rules;
  - tracked runtime content under `.opencorvus/.r/` is untracked without deleting its working-tree copy;
  - static project content elsewhere under `.opencorvus/`, including Expert Squad packages, remains trackable;
  - the existing first-commit and isolated-index contracts remain covered.
- Hard constraints read from `AGENTS.md`: one source, no fallback/compatibility path, root-cause repair, tests for every code change, specs only under `specs/`, update indexes and document-health checks, preserve unrelated worktree state, commit/push before and after changes, and do not disturb running OpenCorvus/overlay processes.
- Files read before implementation:
  - `AGENTS.md`
  - `packages/opencorvus/src/engine/git.ts`
  - `packages/opencorvus/src/project/instance.ts`
  - `packages/opencorvus/src/task-api/index.ts`
  - `packages/opencorvus/src/config/config.ts`
  - `packages/opencorvus/src/snapshot/index.ts`
  - `packages/opencorvus/test/engine/git-ignore.test.ts`
  - `packages/opencorvus/test/engine/instance-bootstrap-greenfield.test.ts`
  - `packages/opencorvus/test/engine/git-checkpoint-scenarios.test.ts`
  - `specs/records/2026-07/2026-07-05-build-prompt-worktree-gitignore-single-source-repair.md`
- Full-repository search:
  - `rg -n --hidden --glob '!node_modules' --glob '!.git' "gitignore|\\.opencorvus|exclude" .`
  - `rg -n "gitignoreEssentials|ensureGitignore|\\.gitignore" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test script specs/current specs/records/2026-07`
  - `rg -n "OPENCORVUS_GIT_EXCLUDED_PATHS|gitignoreEssentials\\(|ensureGitignore\\(" packages/opencorvus/src packages/opencorvus/test --glob '*.ts'`
- Independent agent feedback: none; the user did not request sub-agents or parallel audit, so no delegation was authorized.
- Git baseline: `v0.0.11beta` was equal to `myhexin/v0.0.11beta`; pre-change commit `4e7b3c1b5` was pushed successfully. The unrelated untracked `C:/` tree is preserved and excluded.

## Evidence and cause

`ensureGitignore()` is the shared project-bootstrap entry called by project open, task start, and engine preparation. Its private `gitignoreEssentials()` returns dozens of unrelated ecosystem and operating-system patterns, then appends every missing line to the user's project file. The same implementation separately maintains `OPENCORVUS_GIT_EXCLUDED_PATHS`, so the generated ignore surface and automatic index-cleanup surface can drift.

The directly observed behavior is therefore not caused by multiple callers: all callers converge on one implementation whose owned rule set is too broad. The root repair is to make that implementation own exactly one project rule and derive index cleanup from that same `.opencorvus` root.

## Call-site inventory and disposition

| Location | Role | Disposition |
| --- | --- | --- |
| `packages/opencorvus/src/engine/git.ts` internal prepare path | Calls `ensureGitignore()` before checkpoint work | Keep; consumes the converged contract. |
| `packages/opencorvus/src/project/instance.ts` | Project-open lifecycle calls `ensureGitignore()` | Keep; consumes the converged contract. |
| `packages/opencorvus/src/task-api/index.ts` | Task startup calls `ensureGitignore()` | Keep; consumes the converged contract. |
| `packages/opencorvus/src/engine/git.ts::gitignoreEssentials` | Defines injected project rules | Replace with one rule derived from the canonical `.opencorvus/.r` runtime root. |
| `packages/opencorvus/src/engine/git.ts::OPENCORVUS_GIT_EXCLUDED_PATHS` | Defines automatic tracked-path cleanup | Delete the parallel list; clean only the same canonical runtime root. |
| `packages/opencorvus/src/config/config.ts::installDependencies` | Creates an ignore file inside the OpenCorvus plugin dependency directory | Keep; not a user-project bootstrap writer. |
| `packages/opencorvus/src/snapshot/index.ts` | Builds temporary Git `info/exclude` input for snapshot enumeration | Keep; does not mutate the project `.gitignore`. |
| benchmark fixtures and `sdd-workspace` | Create fixture/private-workspace ignore files | Keep; not project injection behavior. |

## Implementation plan

1. Replace the broad essential-rule generator with one `.opencorvus/.r/` rule derived from `ProjectRuntimePaths.relativeRuntimeRoot()`.
2. Preserve user-authored `.gitignore` content and append only that rule when absent; keep byte-idempotency.
3. Make tracked-path cleanup consume the same canonical root and remove the old sibling/artifact cleanup list.
4. Rewrite focused tests to assert exact new-file and append behavior, absence of every former injection category, idempotency, `.opencorvus/.r/`-only untracking, and continued static package visibility.
5. Run focused engine tests, typecheck, diff checks, required historical/document-health checks, then perform an independent diff review.
6. Update this record with verification evidence, commit with the required `dsw-33987` prefix, and push `v0.0.11beta` to `myhexin`.

## Implemented outcome

- Replaced the broad `gitignoreEssentials()` generator and the parallel excluded-path list with one rule derived from `ProjectRuntimePaths.relativeRuntimeRoot()`.
- Missing files now contain exactly `.opencorvus/.r/\n`; existing files retain their bytes and receive only that line when absent. The prior generated comment and blank separator are absent.
- Index maintenance consumes the same derived rule, untracks tracked runtime files below `.opencorvus/.r/`, preserves working-tree copies, and does not touch static `.opencorvus/` content, `.opencorvus-meta.json`, `.opencorvus-worktrees/`, or root `artifacts/`.
- Regression coverage asserts exact output, idempotency, runtime-only untracking, and continued tracking of Expert Squad package sources.
- Updated source and scenario comments that previously claimed OpenCorvus owned project `node_modules`/`dist` policy.

Existing project rules are not heuristically deleted. Identical lines may have been user-authored, and there is no durable provenance that could distinguish them from historical OpenCorvus output. The root repair removes the broad writer immediately; guessing ownership and deleting user policy would be destructive.

## Verification

- `bun test packages/opencorvus/test/engine/git-ignore.test.ts packages/opencorvus/test/engine/git-checkpoint-scenarios.test.ts packages/opencorvus/test/engine/instance-bootstrap-greenfield.test.ts packages/opencorvus/test/engine/git-ensure-gitignore-force.test.ts` — 28 passed, 0 failed, 205 assertions after the corrected runtime-only boundary assertions.
- `bun run --cwd packages/opencorvus typecheck` — passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` under a temporary verification index containing both concurrently linked untracked July records — 82 passed, 0 failed, 1,355 assertions. The real index was not changed.
- `git diff --check` — passed.

## Second review

The final task-scoped diff was reread against the corrected Recall and full call-site inventory. The required boundary is `.opencorvus/.r/` only: the whole `.opencorvus/` directory is neither ignored nor removed from the index. The rule is derived from `ProjectRuntimePaths`, so ignore generation and runtime-path ownership cannot drift.
