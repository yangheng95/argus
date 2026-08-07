# Public Web Deployment Base Path Implementation Plan

> **For agentic workers:** Execute this plan inline. Do not create a worktree or delegate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the complete Astro/Starlight distribution at `/opencorvus-dist/dist/` so every generated asset, landing navigation target, documentation link, media file, and Windows download resolves under the one real public prefix.

**Architecture:** `packages/web/astro.config.mjs#base` is the only deployment-prefix declaration. Astro-generated code consumes that declaration through `import.meta.env.BASE_URL`; content-authored documentation links become route-relative and therefore remain independent of the deployment prefix. The existing static distribution builder and Nginx file layout remain unchanged.

**Tech Stack:** Astro 5, Starlight, TypeScript, Markdown JSX (MDX), Nginx static serving, visible Browser inspection.

## Global Constraints

- The exact public base path is `/opencorvus-dist/dist`.
- Do not add a fallback, alias, second deployment prefix, Nginx response rewrite, copied `docs/` asset tree, or compatibility path.
- Do not add, modify, or run User Interface (UI) automated tests. Delete the discovered headless screenshot automation and do not retain its screenshot output directory.
- Validate the User Interface through a real Node-launched preview, visible Browser interaction, screenshots bound to this task, and personal visual review.
- Automated validation is limited to Astro type checking/building, distribution assembly, and documentation-health contracts whose assertions do not target rendered User Interface behavior.
- Preserve unrelated staged and unstaged work. Stage only exact task paths.
- Every commit subject starts with `dsw-33987`; push normally to `legacy-remote/work-lcx-v0.0.30beta` without bypassing hooks.

## Recall

| Item | Evidence |
| --- | --- |
| User request | Diagnose the deployed promotional `dist` static-resource HTTP 404 responses, then apply the recommended repair. |
| Acceptance | `https://mirror-test.myhexin.com/opencorvus-dist/dist/` loads its Cascading Style Sheets (CSS), JavaScript (JS), images, media, documentation routes, locale switch, and download through `/opencorvus-dist/dist/**`; no request depends on `/docs/**`. |
| Live reproduction | The deployed `index.html` returned HTTP 200 and referenced `/docs/_astro/index.3OZ5k18w.css`; that URL returned HTTP 404 with `X-Powered-By: Next.js`, while `/opencorvus-dist/dist/_astro/index.3OZ5k18w.css` returned HTTP 200. |
| Root cause | `packages/web/astro.config.mjs` declares `const docsBase = "/docs"`; Astro therefore correctly emitted absolute asset URLs for the wrong deployment root. The outer Stargate route sends `/docs/**` to another application, so this distribution's Nginx server cannot repair that request. |
| Existing distribution | `script/build-landing-dist.ts` runs the canonical Astro build and copies the complete Windows x64 artifact directory into `packages/web/dist/downloads/windows-x64/`. No second builder is needed. |
| Existing design records read | `2026-08-04-static-landing-windows-download-implementation-plan.md`, `2026-08-04-landing-monochrome-navigation-cleanup-implementation-plan.md`, `packages/web/README.md`, `packages/web/astro.config.mjs`, `packages/web/config.mjs`, `script/build-landing-dist.ts`. |
| Whole-repository search | The deployment prefix is declared once in `astro.config.mjs`; remaining `/docs` URL literals occur in landing/architecture components and public MDX content. `packages/web/qa/screenshot-all.cjs` is a prohibited headless screenshot automation that writes reusable screenshots. |
| Git state | Work is on `work-lcx-v0.0.30beta`. Many unrelated files are already staged; `packages/web` deployment-path sources and this record were clean before this task. |
| Independent agent feedback | None. The user did not request multiple agents, and the active collaboration boundary prohibits unsolicited delegation. |

## Decision

Three paths were evaluated:

1. **Selected — align the Astro build with the existing public route.** Change the canonical `base`, project it through `BASE_URL`, and make prose links route-relative. This fixes the source of every emitted URL and requires no gateway ownership change.
2. **Rejected — claim `/docs/**` in Stargate and Nginx.** The live response proves `/docs/**` belongs to another Next.js upstream. Reassigning it would expand the task into shared gateway ownership and could break that application.
3. **Rejected — rewrite or duplicate assets in Nginx.** `sub_filter`, copied `dist/docs`, or two path mounts would preserve two deployment truths and leave navigation/media/download paths inconsistent.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/web/astro.config.mjs` | One public deployment base consumed by Astro and Starlight. |
| `packages/web/src/components/{Lander,EnterpriseArchitectureExplorer,Header}.astro` | Resolve authored runtime links from `import.meta.env.BASE_URL` or Starlight locale routing. |
| `packages/web/src/content/landing.ts` | Project locale-switch URLs from Astro's build base. |
| `packages/web/src/content/docs/**/*.mdx` | Use document-relative links instead of embedding a server deployment prefix. |
| `packages/web/qa/screenshot-all.cjs` | Delete prohibited headless User Interface screenshot automation. |
| `specs/README.md`, `specs/records/2026-08/README.md` | Index this record in the canonical specification tree. |

## Implementation

### Task 1: Converge the deployment-path source

- [x] Change `docsBase` to `/opencorvus-dist/dist` in `packages/web/astro.config.mjs`.
- [x] Derive landing, locale, architecture-workbench, media, and header links from `import.meta.env.BASE_URL` or Starlight's locale URL helper.
- [x] Convert public MDX `/docs/**` links into route-relative links so content no longer owns deployment configuration.
- [x] Delete `packages/web/qa/screenshot-all.cjs` without running it and confirm no screenshot output directory is retained.

### Task 2: Build and inspect the real distribution

- [x] Run `bun run --cwd packages/web check`.
- [x] Run `bun run build:landing-dist` and record the generated page and Windows-artifact results.
- [x] Start the built distribution with a Node-launched static server at a local origin whose URL includes `/opencorvus-dist/dist/`.
- [x] Open English and Simplified Chinese pages in the visible Browser; inspect the header, hero, media, locale switch, documentation navigation, architecture workbench, and download link.
- [x] Capture fresh task evidence under `specs/artifacts/` and personally review it. Do not create a baseline or an automated assertion.

### Task 3: Verify, review, and deliver

- [x] Run the required historical-document, document-health, and product-document single-source contracts.
- [x] Review the exact diff and generated Uniform Resource Locator (URL) behavior a second time.
- [ ] Append exact evidence to this record, commit only task files with a `dsw-33987` subject, fetch `legacy-remote`, reconcile the branch, and push without bypassing hooks.

## Plan Self-Review

- No placeholder, fallback, second source, state machine, or deployment alias is introduced.
- The selected architecture directly addresses the observed route mismatch instead of masking HTTP 404 responses.
- The plan preserves the existing distribution builder and does not expand into gateway reconfiguration.
- User Interface validation remains manual and visible; allowed automated checks cover configuration/build/document integrity only.

## Implementation Evidence

- `bun run --cwd packages/web check` completed with 0 errors and 0 warnings. The command retained one pre-existing unused-variable hint in `qa/dedupe-lead.cjs`; the theme also reported its existing component-override guidance before Astro diagnostics.
- `bun run build:landing-dist` built 105 pages, indexed 102 documentation pages in English and Simplified Chinese, and copied the three validated Windows x64 artifacts. The setup executable is 209,913,873 bytes.
- Generated HTML, Cascading Style Sheets, JavaScript, sitemap, media, locale, and download URLs use `/opencorvus-dist/dist/**`. A search across built HTML/JS/CSS/XML found no `/docs/**` deployment URL.
- A Node-launched `http-server` served the distribution from the real nested path. Cascading Style Sheets, the WebM video, the Windows setup executable, and the Simplified Chinese architecture page each returned HTTP 200.
- Visible Browser review covered `http://127.0.0.1:9994/opencorvus-dist/dist/`, its Simplified Chinese locale, the Agentic loop documentation page, and the Permissions destination. The language switch navigated to the exact locale path; an authored relative link navigated from `concepts/agent-loop/` to `/opencorvus-dist/dist/permissions/`; browser logs contained zero warnings or errors.
- Personal screenshot review found complete typography, spacing, images, black/white styling, navigation, and documentation columns without missing styles, clipping, or stale route chrome. Evidence is `specs/artifacts/public-web-base-en.png`, `public-web-base-zh-cn.png`, and `public-web-base-docs.png`.
- Required documentation contracts completed with 70 passes, 0 failures, and 1,188 expectations.
- The Starlight build message `Entry docs → 404 was not found.` comes from its optional `getEntry('docs', '404')` lookup before the built-in fallback; `dist/404.html` is generated. It is not a missing deployed route.
- During implementation, a concurrent same-branch merge temporarily replaced uncommitted Web sources and later entered a resolved-but-uncommitted merge state. This task did not reset, abort, or resolve that unrelated merge; its Web changes were reapplied to the latest HEAD and kept out of the merge index.
- A dedicated Windows Nginx 1.31.3 instance now listens on `127.0.0.1:9995` with an independent PID, logs, and configuration under `C:/Users/lichenxing/Documents/Codex/2026-08-04/bang/work/nginx-opencorvus-9995/`. It serves an immutable copy of the final `dist` at `/opencorvus-dist/dist/`, matching the public route without adding a `/docs` alias.
- Fresh Nginx verification completed 29 HTTP checks with 29 successes: readiness, English and Simplified Chinese entry pages, a nested documentation route, and all 25 Cascading Style Sheet, JavaScript, image, and WebM assets discovered from the landing page. Nginx recorded no new error-log entry. Visible Browser review of `http://localhost:9995/opencorvus-dist/dist/` showed the final landing page with the animated Mission flow, exact base-prefixed locale/navigation links, and zero browser warnings or errors.
