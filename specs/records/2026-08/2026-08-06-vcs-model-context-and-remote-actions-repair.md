# VCS Model Context and Remote Actions Repair

## Recall

- User request: repair the Git commit-message model-context handoff for a temporary repository, and do not show Push actions when that repository has no remote.
- Acceptance criteria: a selected Task continues to resolve its Task-root model overlay; a selected ordinary Chat Session resolves its Session-root model overlay; a repository with no configured Git remote shows Commit only; a repository with a configured remote shows the existing Commit & Push and Push actions; direct VCS actions keep using the current project directory.
- Hard constraints: fix the identity and VCS fact boundaries without fallback, compatibility input, a second model source, a host workflow gate, or a hand-written Git heuristic; use Git itself as the remote source; add only positive non-User-Interface contracts; do not add, modify, or run User Interface automated tests; validate the real desktop page through interaction and screenshots; preserve unrelated worktree changes; commit subjects start with `dsw-33987`; push the current main delivery branch to `git-cc`.
- Read records and architecture: `specs/current/architecture/03-control.md`, `specs/current/architecture/06-provider.md`, `specs/records/2026-08/2026-08-03-temporary-project-provider-catalog-invalidation.md`, the effective-config resolver, VCS implementation and routes, Overlay selected-source projection, Composer model projection, and the Git action dialog.
- Repository search: the Overlay commit-message request currently sends only `activeTaskID`; `activeSessionID` is the canonical ordinary-Session identity; the backend model resolver already accepts and validates both `taskID` and `sessionID`; `Vcs.Info` currently projects no remote fact; both Push buttons render without a remote condition; `Vcs.push` uses native `git push` and does not create or alter remotes.
- Independent Agent feedback: none; the user did not request sub-agents, so no delegation was used.

## Causal chain

Observable symptom: opening the Git dialog for a dirty temporary repository can report `MissingModelConfigError` for the `summary` helper, while Push remains visible even when the repository has no remote.

Direct triggers: the stream request omits the selected ordinary Session identity, and the dialog has no canonical remote fact to condition its Push actions.

Root causes: the VCS helper request modeled Task identity as the only contextual model owner even though the selected source is a Task-or-Session union; separately, the frontend inferred action availability from commit and dirty counts while the backend VCS projection omitted repository remote configuration.

Why the previous behavior cannot cure itself: selecting a model on the Chat Session writes the correct Session overlay, but a request without `sessionID` cannot reach it and strict model resolution intentionally has no recent-model fallback. Likewise, `git push` can fail after the operator clicks it, but that late process error cannot inform the earlier action layout.

## Design

1. Extend the single commit-message request contract with optional `sessionID`, preserving `taskID` for Task-owned tracing and exact Task-root resolution. The Overlay sends the currently selected Task and Session identities; selected-source semantics ensure ordinary operation supplies the relevant identity, while the backend's existing resolver verifies any jointly supplied identities.
2. Extend `Vcs.Info` with required `hasRemote`. Resolve it from native `git remote` output in the current repository and publish it with every normal VCS refresh. No remote name is guessed and no remote is created.
3. Render Commit & Push and Push only when `hasRemote` is true. Commit remains available for dirty repositories without a remote; an otherwise clean repository without a remote has no Git action row.
4. Keep direct `Vcs.push` unchanged: it still pushes through Git's configured behavior and never mutates remote configuration.

## Verification plan

- Positive transport contract: a selected Session identity is serialized into the streaming commit-message request.
- Positive route contract: OpenAPI publishes `sessionID` on the streaming request body.
- Positive VCS contract: a repository with a configured remote projects `hasRemote: true` and retains successful push behavior.
- Run the focused non-User-Interface contracts, package and repository typechecks, API route validation, documentation health checks, and source diff review.
- Start the real application with Node-backed browser tooling, open a dirty temporary repository without a remote, inspect and screenshot the Git dialog with Commit only; then attach a real local bare remote, refresh the same repository, inspect and screenshot the dialog with Push actions restored.

## Progress

- [x] Root-cause investigation and Recall.
- [x] Pre-implementation plan committed and published to git-cc as `61a55dc1f6` after the concurrent TypeScript work converged.
- [x] Product and positive contract implementation.
- [x] Focused verification and real-page visual acceptance.
- [x] Second review completed; implementation commit `4f612cae8b` passed the full pre-push hook and was published to git-cc.

## Verification results

- `bun test test/project/vcs.test.ts test/project/vcs-commit-message.test.ts test/server/vcs-routes.test.ts --timeout 30000`: the 27 VCS implementation and commit-message contracts passed; three unrelated route cases passed their assertions and then failed during Windows fixture cleanup with `EBUSY` on temporary directory removal.
- `bun test test/server/vcs-routes.test.ts -t "OpenAPI documents VCS prerequisite and runtime failures" --timeout 30000`: 1 passed, 0 failed.
- `bun test test/meta-vcs-actions.test.ts --timeout 30000`: 4 passed, 0 failed.
- Overlay `bun run typecheck`: passed.
- Overlay `bun run build:vite`: passed with 7,073 modules transformed.
- Root `bun run typecheck`: passed across all eight active package checks.
- Root `bun run docs:check`: passed after regenerating the English and Chinese API references with the new `sessionID` body field.
- Root `bun run api:routes-check`: passed all six rules and the route inventory across 33 files after the concurrent shutdown route adopted the existing runtime environment boundary and the current SDK/OpenAPI was regenerated.
- Full git-cc pre-push hook: package typechecks, API route inventory, generated documentation, Overlay internationalization, and secret scan all passed.
- Documentation health: 69 passed and one task-external failure remained because the monthly index concurrently linked two untracked records (`work-research-report-quality-repair` and `managed-backend-early-exit-diagnostics`).
- Real isolated runtime at port 7879: `GET /vcs` returned the same repository with `hasRemote: false`, then `hasRemote: true` after a local bare remote was configured and pushed.
- Real ordinary Chat Session: the dirty repository's commit-message request resolved the Session/project QA model and advanced beyond `MissingModelConfigError`; the intentionally non-responsive QA Provider produced an empty-message error, confirming the selected Session identity reached strict model resolution.
- Real-page visual review: without a remote, the Environment action label was `Commit`, the dialog contained only `Nothing to commit.`, and no Push action was visible; after attaching the real local remote, the label became `Commit or push` and the dialog displayed Push. Evidence: `specs/artifacts/vcs-no-remote-actions.png` and `specs/artifacts/vcs-remote-actions.png`.
