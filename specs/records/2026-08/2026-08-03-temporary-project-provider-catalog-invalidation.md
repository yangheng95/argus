# Temporary Project Provider Catalog Invalidation

## Recall

- User request: fix the bug where a temporary project cannot refresh the model list.
- Acceptance: a successful model refresh initiated by a temporary project must immediately publish the refreshed canonical model identities to that project, sibling projects, and the global model selector.
- Hard constraints: keep one canonical Provider catalog, fix the root writer/invalidation boundary without fallback or UI workarounds, add positive non-UI contract coverage, do not add or run UI automation tests, preserve unrelated workspace changes, and push the completed change to the `git-cc` remote.
- Read records and architecture: `specs/current/architecture/06-provider.md`, `specs/records/2026-08/2026-08-03-provider-runtime-transport-and-global-oauth-projection.md`, Provider routes, Provider scoped-state ownership, native-agent registry lifecycle, Overlay Provider loading, and Composer model projection.
- Repository search: the project-scoped catalog and model refresh routes call `Provider.reset` plus `NativeAgentRegistryLifecycle.reset`, while the global routes call all-scope Provider invalidation. The canonical catalog itself is shared across both route families.
- Runtime evidence: `POST /provider/models/refresh` from an implicit temporary project completed successfully and persisted 36 Hexin models; the same backend then projected 36 models for that temporary project but only 14 through `/global/providers`. A repeated project refresh remained successful, proving discovery and persistence were not the failing layer.
- Independent Agent feedback: none; no sub-agent was requested or used.

## Causal chain

Observable symptom: refreshing inside a temporary project can complete successfully while the model selector continues to show an older model set.

Direct trigger: the project route resets only the initiating project's memoized Provider and native-agent registries after writing the shared catalog.

Root cause: the durable Provider catalog is global, but its write-side invalidation contract was incorrectly scoped to the caller. Global and sibling-project projections therefore retained state built from the previous catalog revision.

Why the previous path did not cure it: discovery, authentication, persistence, and current-project reload all succeeded. Repeating those operations could not invalidate the other projections that own the visible selector at different moments.

## Design

The canonical catalog writer owns one shared invalidation operation. After either provider-declaration refresh or configured-model refresh succeeds, that operation clears every Provider projection and every native-agent registry projection, regardless of whether the writer was reached through a project or global route. Route response settlement remains explicit so a completed catalog write can report invalidation issues without concealing them.

## Verification

- Add a positive route contract that preloads global and sibling-project projections, refreshes from a temporary project, then asserts the exact refreshed provider declaration and live model identities in every projection.
- Run the focused Provider discovery/refresh contracts and refresh-settlement contracts.
- Run TypeScript type checking, API route validation, documentation health checks, and repository diff checks.

Verification results:

- The new contract failed on the previous implementation because `globalDatabase.remote` remained the pre-refresh projection; it passed after canonical all-scope invalidation was installed.
- `bun test test/provider/hexin-discovery.test.ts --timeout 30000`: 22 passed, 0 failed.
- `bun test test/server/provider-refresh.test.ts test/server/project-route-context.test.ts --timeout 30000`: 5 passed, 0 failed.
- `bun test test/provider/global-openai-oauth-projection.test.ts --timeout 30000`: 1 passed, 0 failed.
- `bun run typecheck` in `packages/opencorvus`: passed.
- Root `bun run typecheck`: 8 package tasks passed.
- `bun test test/script/historical-docs-links.test.ts test/script/document-health.test.ts test/script/product-docs-single-source.test.ts --timeout 30000`: 70 passed, 0 failed.
- `bun run api:routes-check`: passed with 6 rules and 33 route files clean.
- `bun run docs:check`: passed with 311 operations in 24 groups.
