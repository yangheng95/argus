# Docs and SDK single source cleanup

Date: 2026-06-04

## Problem

OpenCorvus previously had two product documentation trees:

- `packages/web/src/content/docs/**` is the Astro/Starlight documentation site source.
- `docs/product/**` was a legacy Markdown tree that was not read by the web app.

This split already caused a false fix: updating the former `docs/product/*/reference/sdk.md` files did not change the page served at `/docs/reference/sdk/`.

## Call-point inventory

Full-repo grep before this plan:

| Surface                          | Current evidence                                                                                                                                | Decision                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Web docs source                  | `packages/web/src/content.config.ts` uses `docsLoader()`; `packages/web/astro.config.mjs` sidebar points at `packages/web/src/content/docs/**`. | Keep as canonical human-facing docs source.                                                              |
| API docs generator               | `packages/opencorvus/script/docs/render-api-md.ts` writes `packages/web/src/content/docs/{reference,zh-cn/reference}/api.mdx`.                  | Keep generated output in the canonical web docs tree.                                                    |
| Root scripts                     | `package.json` `docs:api` / `docs:check` invoke `render-api-md.ts`.                                                                             | Keep script names; change their target to canonical web docs.                                            |
| Existing generated web API pages | `packages/web/src/content/docs/reference/api.mdx` and `zh-cn/reference/api.mdx` exist and are displayed by the site.                            | Regenerate/check these files directly.                                                                   |
| Legacy product docs              | `docs/product/**` has been removed by `specs/new-arch/2026-06-15-historical-docs-consolidation.md`.                                             | Keep all human-facing docs in `packages/web/src/content/docs/**`.                                        |
| SDK generator                    | `packages/sdk/js/script/build.ts` generates `packages/sdk/openapi.json` and SDK source from server routes.                                      | Keep as SDK/OpenAPI single source.                                                                       |
| SDK docs pages                   | `packages/web/src/content/docs/sdk.mdx`, `reference/sdk.mdx`, and zh-cn counterparts contained stale `sdk/v2` references.                       | Keep docs in web tree, with `reference/sdk.mdx` as the complete SDK reference and `sdk.mdx` as overview. |

## Required end state

1. `docs:api` and `docs:check` operate on the actual web documentation pages.
2. The rendered docs site no longer contains stale SDK v2 examples or old REST paths.
3. SDK reference documentation describes the current root package entrypoint, generated client model, authentication, custom fetch, embedded server lifecycle, event subscription, generation command, and method discovery through API Reference.
4. `packages/web build`, `docs:check`, `api:routes-check`, and root `typecheck` pass.

## Non-goals for this pass

The follow-up cleanup in `specs/new-arch/2026-06-15-historical-docs-consolidation.md` removes `docs/product/**` after updating remaining references. The web docs tree is now the only product documentation source.
