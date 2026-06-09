# Coding Session Gitignore Seed Commit Message Fix

## Symptom

`GET /coding/sessions?limit=1` can fail with HTTP 500 while selecting the coding assistant. The observed error is:

`ensureGitignore: seed commit failed: ... Invalid commit message format ... Your title: chore(opencorvus): seed baseline .gitignore`

## Root Cause

`ensureGitignore()` creates an internal seed commit before coding sessions can be listed. That internal title used scoped conventional-commit syntax, while the project hook accepts maintenance commits as `chore <subject>` with no task identifier and no scope.

The fix is not an API fallback and not a hook bypass. The internal maintenance commits must use the repository's commit-message contract.

## Grep Evidence

| Symbol or route | Grep result | Decision |
| --- | --- | --- |
| `ensureGitignore` | `packages/opencorvus/src/engine/git.ts`, `packages/opencorvus/src/project/instance.ts`, `packages/opencorvus/src/task-api/index.ts`, acceptance/result commit paths, and focused tests | Keep behavior; change only the internal maintenance subject used by the seed commit. |
| `coding/sessions` | `packages/opencorvus/src/server/routes/coding.ts`, `packages/opencorvus/test/server/coding-routes.test.ts` | No route change. The route correctly exposes the bootstrap failure; the bootstrap commit title is invalid. |
| `chore(opencorvus)` | `packages/opencorvus/src/engine/git.ts`, `packages/opencorvus/src/worktree/index.ts`, `packages/opencorvus/test/project/worktree-merge-safely.test.ts` | Replace internal scoped maintenance titles with hook-compatible subjects. |
| `chore:` | `packages/opencorvus/src/engine/git.ts` | Replace the internal cleanup title and stop using `--no-verify` in that cleanup commit. |
| `--no-verify` | `packages/opencorvus/src/engine/git.ts` cleanup commit | Remove. The fix must satisfy hooks instead of bypassing them. |

## Implementation

Create one source for internal git maintenance commit subjects and consume it from the engine git bootstrap path, worktree primary recovery, and regression tests.

## Verification

Run focused tests:

- `bun test packages/opencorvus/test/engine/git-ignore.test.ts`
- `bun test packages/opencorvus/test/project/worktree-merge-safely.test.ts`

Then review the final diff for accidental edits outside the intended files.
