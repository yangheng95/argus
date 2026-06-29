# Historical docs consolidation

Date: 2026-06-15

## Problem

At the time of this cleanup, the repository carried three documentation layers:

- `packages/web/src/content/docs/**`: the Starlight documentation site source.
- `docs/product/**`: a legacy Markdown product-doc tree that is not loaded by the web app.
- `specs/**`: historical design notes and implementation records. Package-local spec trees were later retired by
  the 2026-06-29 spec consolidation.

The duplicate product tree violates the docs single-source decision from
`specs/records/2026-06/2026-06-04-docs-sdk-single-source.md`: updating `docs/product/**` does not update the
published documentation, while keeping it around invites future stale edits.

## Inventory

Full-repo checks before this plan:

| Surface                           | Evidence                                                                                                                                                                                                                                                      | Decision                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Web docs source                   | `packages/web/src/content.config.ts` uses `docsLoader()` and `packages/web/astro.config.mjs` defines the sidebar from `packages/web/src/content/docs/**`.                                                                                                     | Keep as canonical human-facing docs.                                                                         |
| API docs generator                | `packages/opencorvus/script/docs/render-api-md.ts` writes `packages/web/src/content/docs/reference/api.mdx` and `packages/web/src/content/docs/zh-cn/reference/api.mdx`.                                                                                      | Keep generated docs in the web tree only.                                                                    |
| Generated docs check              | `bun run docs:check` passed before edits with 224 operations and 24 groups.                                                                                                                                                                                   | Preserve this check as the docs generation guard.                                                            |
| Legacy product docs               | `docs/product/**` contains 74 Markdown files; 56 share the same slug as web docs, and the remaining 18 map to existing web pages such as `mcp-servers`, `permissions`, `providers`, `plugins`, `skills`, `reference/evaluator`, `acp`, and `troubleshooting`. | Delete the legacy tree and update references to the web-doc source.                                          |
| Historical specs                  | Link scan across 572 relevant docs found 4 missing historical references after resolving repo-root paths.                                                                                                                                                     | Keep historical specs, but fix missing references and document removed external notes as retired references. |
| Existing non-doc worktree changes | `git status --short` shows unrelated tracked changes under `packages/opencorvus/**` tests and package metadata plus generated/cache directories.                                                                                                              | Do not stage or rewrite unrelated changes.                                                                   |

## Edits

1. Remove `docs/product/**` entirely.
2. Replace references to deleted product docs with the canonical `packages/web/src/content/docs/**` paths.
3. Fix four broken historical references found by the link scan:
   - docs/superpowers/plans/2026-05-05-inspector-panel-redesign.md
   - specs/deliver-accepted-completes-task-2026-05-16.md
   - specs/records/2026-06/2026-06-04-remove-iwc-aime-provider.md
   - specs/notification-reliability-2026-05-18.md
4. Update `specs/current/architecture/README.md` with the current cleanup status so new design notes do not restart the old dual-source pattern.

## Verification

- `bun run docs:check`
- Markdown/reference link scan for `specs/**`, `docs/**`, root docs, and `packages/web/src/content/docs/**`
- `rg -n "docs/product" specs packages docs README.md CONTRIBUTING.md RELEASE.md AGENTS.md CLAUDE.md`
- `git diff --check`
