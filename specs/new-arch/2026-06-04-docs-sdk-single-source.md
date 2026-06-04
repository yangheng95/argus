# Docs and SDK single source cleanup

Date: 2026-06-04

## Problem

OpenCorvus currently has two product documentation trees:

- `packages/web/src/content/docs/**` is the Astro/Starlight documentation site source.
- `docs/product/**` is a legacy Markdown tree that is not read by the web app.

This split already caused a false fix: updating `docs/product/*/reference/sdk.md` did not change the page served at `/docs/reference/sdk/`.

## Call-point inventory

Full-repo grep before this plan:

| Surface | Current evidence | Decision |
|---|---|---|
| Web docs source | `packages/web/src/content.config.ts` uses `docsLoader()`; `packages/web/astro.config.mjs` sidebar points at `packages/web/src/content/docs/**`. | Keep as canonical human-facing docs source. |
| API docs generator | `packages/opencorvus/script/docs/render-api-md.ts` writes only `docs/product/{en,zh-CN}/reference/api.md`. | Move generated output to `packages/web/src/content/docs/{reference,zh-cn/reference}/api.mdx`. |
| Root scripts | `package.json` `docs:api` / `docs:check` invoke `render-api-md.ts`. | Keep script names; change their target to canonical web docs. |
| Existing generated web API pages | `packages/web/src/content/docs/reference/api.mdx` and `zh-cn/reference/api.mdx` exist and are displayed by the site. | Regenerate/check these files directly. |
| Legacy product docs | `docs/product/**` is referenced by old specs and a small number of tests as path text, but not by the site. | Treat as legacy/non-authoritative; do not add new generated content there. |
| SDK generator | `packages/sdk/js/script/build.ts` generates `packages/sdk/openapi.json` and SDK source from server routes. | Keep as SDK/OpenAPI single source. |
| SDK docs pages | `packages/web/src/content/docs/sdk.mdx`, `reference/sdk.mdx`, and zh-cn counterparts contained stale `sdk/v2` references. | Keep docs in web tree, with `reference/sdk.mdx` as the complete SDK reference and `sdk.mdx` as overview. |

## Required end state

1. `docs:api` and `docs:check` operate on the actual web documentation pages.
2. The rendered docs site no longer contains stale SDK v2 examples or old REST paths.
3. SDK reference documentation describes the current root package entrypoint, generated client model, authentication, custom fetch, embedded server lifecycle, event subscription, generation command, and method discovery through API Reference.
4. `packages/web build`, `docs:check`, `api:routes-check`, and root `typecheck` pass.

## Non-goals for this pass

Deleting `docs/product/**` is a separate removal because the current worktree contains unrelated uncommitted changes in that tree. The cleanup here stops generating new authoritative content into it and makes the web docs the verified source.
