# OpenCorvus Promotional Landing Page

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Initial request: reference `https://mirror.myhexin.com/kingfisher/collector/html/kingfisher-amis-component-form/index.aicreate.html?pageId=24962` and combine it with the current repository to generate an OpenCorvus promotional page. User correction: the page does not need to follow the reference implementation, layout and typography may be freely composed, and content that OpenCorvus does not have must not be added. |
| Acceptance target | Replace the documentation home with an original desktop-first OpenCorvus promotional landing page in English and Simplified Chinese. The reference may inform atmosphere only; it does not constrain section order, card structure, density, or composition. Every product statement must resolve to current repository code, current architecture documentation, or a shipped repository surface. |
| Interaction acceptance | Primary actions must be real links to Quick Start, the architecture explorer, and the repository. Links must retain visible keyboard focus. The page must not expose a fake download, fake product preview, hidden message path, or inert control. |
| Visual acceptance | Verify real rendered `/docs/` and `/docs/zh-cn/` pages in a desktop viewport through the browser, inspect screenshots personally, correct visual issues, and repeat until the asymmetric hero, factual execution trace, editorial section rhythm, typography, contrast, focus state, and final call to action are coherent. Desktop is the only delivery scope; tablet/mobile screenshots and responsive delivery are not added. |
| Hard constraints | Reuse Astro, Starlight, `astro:assets`, and the tracked Overlay icon; do not create a parallel site, new hosting surface, fallback, compatibility path, state machine, gate, temporary iframe, query override, or fabricated preview. Do not restart, stop, refresh, or otherwise interfere with the running OpenCorvus/Overlay. Use an independent docs preview only. Launch browser validation through the supported Node-backed browser path, never Bun Playwright. Add regression coverage and review twice. Per the user's later instruction, keep every promotional-page change local and uncommitted; the only subsequent remote write was the explicit lease-checked rollback of the previously pushed branch to `d657bf323`. |
| Reference evidence | The target TLS endpoint closed the in-app browser connection, so the published Kingfisher configuration and its exact JavaScript/CSS assets were fetched read-only. A local artifact render produced screenshot and DOM evidence. After the user correction, this evidence is retained only as an atmospheric reference for clarity, luminosity, and generous spacing; its information architecture, module inventory, card rhythm, and section order are explicitly not parity requirements. |
| Current product evidence read | `README.md`; `packages/opencorvus/package.json`; `packages/web/README.md`; `packages/web/src/content/docs/{index,zh-cn/index}.mdx`; `packages/web/src/content/docs/{agents,overlay/overview,channels/overview}.mdx`; `packages/web/astro.config.mjs`; `packages/web/config.mjs`; `packages/web/src/components/{Hero,Lander,Head,Header,Footer,SiteTitle}.astro`; `packages/web/src/styles/custom.css`; `packages/web/qa/screenshot-all.cjs`; `packages/overlay/src-tauri/icons/icon.png`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/{README,09-verification-evidence}.md`; `specs/records/2026-07/2026-07-21-frontend-design-canonical-render-evidence.md`. |
| Product claims allowed by current sources | OpenCorvus is an open-source harness for coding agents (`README.md`). The Orchestrator dispatches projected workers through observable tool calls from current task evidence (`specs/current/architecture/01-agents.md`). Tasks, goals, runs, interactions, artifacts, acceptance evidence, session state, and project knowledge persist locally in SQLite (`README.md`). Model interaction is streaming (`specs/current/architecture/01-agents.md`). The repository ships a headless HTTP API, Overlay UI, GitHub Action, and multi-channel runtime adapters (`README.md`, `packages/web/src/content/docs/overlay/overview.mdx`, `packages/web/src/content/docs/channels/overview.mdx`). The project is MIT licensed (`LICENSE`). |
| Claims removed by user correction | Remove headline counts such as twelve agents and fourteen channels, active-package internals, the long six-step marketing workflow, broad trust promises, and generic statements that imply product capabilities beyond the cited surfaces. Do not depict a fabricated application screenshot, fake download, inert control, mandatory fixed pipeline, or unsupported automatic outcome. |
| Whole-repository grep | `Lander.astro` is imported only by `Hero.astro`; `Hero.astro` is registered only through `packages/web/astro.config.mjs`; Starlight renders the Hero only when the locale home frontmatter declares `hero`; both current home MDX files omit that field. `custom.css` is the only global custom stylesheet. `Head.astro` owns the home title. `Footer.astro` renders only for the `doc` template. The two tracked `packages/web/src/assets/lander/*.png` files are referenced only by the old Lander and show stale OpenCode terminal visuals. No `.openai/hosting.json` exists, so Sites hosting is not in scope. No other live landing-page owner or parallel marketing route exists. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration rule forbids creating sub-agents without that explicit request. Main-agent browser evidence and the final diff review remain the review sources. |

## Call-site disposition

| Call site / asset | Decision |
| --- | --- |
| `packages/web/src/components/Hero.astro` | Keep as the only route-aware home Hero selector. No second home route or render path is added. |
| `packages/web/src/components/Lander.astro` | Replace the legacy bordered terminal landing implementation with the promotional page. Keep it static, semantic, and fully driven by one bilingual content module. |
| `packages/web/src/content/docs/index.mdx` | Replace the duplicated long-form home body with `hero` frontmatter so the canonical Lander owns the English home. Keep metadata only. |
| `packages/web/src/content/docs/zh-cn/index.mdx` | Apply the same single-owner home contract for Simplified Chinese. |
| `packages/web/src/styles/custom.css` | Preserve documentation styling; isolate landing styles inside `Lander.astro` and override only the existing home shell geometry required by the landing page. |
| `packages/web/src/components/Head.astro` | Preserve the existing localized title/metadata owner. |
| `packages/web/src/components/Footer.astro` | Preserve the documentation-only footer; the landing page owns its own visible final brand/footer row. |
| `packages/overlay/src-tauri/icons/icon.png` | Reuse directly through `astro:assets` as the single current raven mark; do not duplicate or redraw it. |
| `packages/web/src/assets/lander/screenshot*.png` | Do not use because they depict stale OpenCode UI. Leave tracked until the user explicitly authorizes deletion under the repository dead-code rule. |

## Design and implementation

1. Keep one typed bilingual content source, but reduce it to a compact factual contract: hero, four evidence-backed principles, shipped surfaces, execution-trace labels, and final actions. Do not retain metric or workflow arrays merely to preserve the reference layout.
2. Recompose `Lander.astro` as an original editorial page: an asymmetric hero with one real Quick Start action and one GitHub action; a compact conceptual trace made only from real OpenCorvus nouns; a staggered factual principle field; a concise shipped-surface rail; and one final documentation call to action.
3. Let Starlight keep the sole document `main`. Reuse the current Overlay raven through Astro's image pipeline and Starlight `Icon` primitives. All control-looking elements must be links with real destinations; decorative trace nodes must not resemble clickable UI.
4. Use OpenCorvus's cobalt/cyan identity on a dark ink field with strong whitespace and editorial type scale. The new composition must not reuse the reference's centered hero, paired action cards, metric strip, four-card value grid, numbered workflow, proof grid, or long-form section order.
5. Update regression tests to lock the smaller fact set, real route inventory, removed counts/workflow claims, single landing owner, localized titles, current brand source, and absence of fabricated screenshots/download language.

## Verification plan

- `bun test packages/opencorvus/test/script/web-landing-page.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/web check`
- `bun run --cwd packages/web build`
- Start only the independent Web Docs preview process, open `/docs/` and `/docs/zh-cn/` in the supported browser, capture and inspect real desktop screenshots, verify console errors, and exercise primary link focus/targets without submitting external writes.
- Review `git diff --check`, the exact modified-file diff, stale landing call sites, and `git status --short` before the local handoff. Do not stage, commit, or push the promotional-page changes.

## Superseded first delivery record

> The implementation and evidence below describe the first reference-structured version. The user rejected that direction and asked for an original composition with a narrower fact set. It remains here only as historical evidence and is not the current acceptance result.

### Final implementation

- The English and Simplified Chinese documentation homes now share one typed content source and one `Lander.astro` render owner. The former duplicated MDX bodies are metadata-only home entries, and `Hero.astro` selects the localized landing page for both home slugs.
- The page preserves the reference's desktop information architecture and density rhythm while projecting current OpenCorvus product evidence: a luminous brand hero, two real action cards, product metrics and definition, four values, six collaboration steps, product surfaces, architecture proof, and a final call to action.
- `Head.astro` emits exactly one localized title on each home. The existing Overlay raven icon remains the only brand-image source, and Starlight's `Icon` component owns the supporting iconography.
- Final review corrected three underlying Web Docs integration defects exposed by the real build: the Web package now owns the Astro-compatible Zod 3 dependency, the Rehype plugin crosses its duplicated Unified type identity at one static typed boundary, and custom favicon paths respect the `/docs` base. No runtime fallback or parallel render path was added.
- The old OpenCode terminal screenshots remain tracked but unused, because their deletion requires explicit user authorization.

### Verification evidence

| Surface | Result |
| --- | --- |
| Focused landing regression | `bun test packages/opencorvus/test/script/web-landing-page.test.ts`: 7 passed, 0 failed, 41 expectations. |
| Documentation health | `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 82 passed, 0 failed, 1,356 expectations. |
| Astro validation | `bun run --cwd packages/web check`: 0 errors and 0 warnings; one pre-existing unused-variable hint remains in `qa/dedupe-lead.cjs`. |
| Production build | `bun run --cwd packages/web build`: 105 static pages built; Pagefind indexed 102 pages and 7,119 words; sitemap generated. |
| Real desktop render | An independent Node-launched Astro preview rendered `/docs/` and `/docs/zh-cn/` at 1,265 CSS pixels wide. Both pages had one title, one `main`, one `h1`, no horizontal overflow, and localized titles. English height was 5,362 pixels; Simplified Chinese height was 4,938 pixels. |
| Visual review | Screenshots were personally inspected for the hero, paired actions, value-section rhythm, dark workflow band, surface cards, architecture proof, final call to action, and footer. The Simplified Chinese hero was separately inspected. No corrective visual discrepancy remained. |
| Interaction and diagnostics | The Quick Start card navigated to `/docs/start/quickstart/`; keyboard focus produced a visible cyan outline on the brand link; English and Simplified Chinese browser console logs were empty. The isolated preview was stopped without touching OpenCorvus or Overlay processes. |

### Codex final review revision

The implementation review found that the original plan incorrectly assigned a second `main` to `Lander.astro` even though Starlight already owns the document `main`, and proposed inline SVG icons despite an existing component primitive. The design record above is revised to reflect the delivered single-main ownership and Starlight `Icon` source. This removes two potential duplicate-ownership paths rather than accepting them as variances.

## User-corrected local revision

### Implementation

- The reference page now influences atmosphere only. The centered hero, paired reference actions, metric strip, card grids, numbered workflow, proof matrix, and long section sequence were removed.
- The replacement is an original editorial composition: an asymmetric dark hero, a factual runtime-owner trace, a vertically ruled principle field, a blue shipped-surface rail, and one compact closing action.
- The bilingual content contract now contains only facts supported by current sources: observable Orchestrator dispatch, streaming sessions and tool activity, local SQLite project records, operator permissions/follow-ups, Overlay, the headless server, channel-runtime adapters, GitHub Action, and MIT licensing.
- Headline agent/channel counts, active-package internals, broad trust promises, fabricated previews, download language, and fixed-workflow implications are absent. The two old OpenCode screenshots remain tracked but unused pending explicit deletion authorization.
- The previously pushed implementation and merge commits were removed from the remote work branch with a lease-checked rollback to `d657bf323`. Unrelated concurrent tasks later advanced the local and remote branch refs again; containment checks confirm that promotional implementation commit `8e425c7ff` and merge commit `4a853f623` are not ancestors of the current local branch. Every promotional-page file remains unstaged and uncommitted.

### Verification

| Surface | Result |
| --- | --- |
| Focused regression | `bun test packages/opencorvus/test/script/web-landing-page.test.ts`: 8 passed, 0 failed, 55 expectations after the final focus-style assertions. |
| Astro validation | `bun run --cwd packages/web check`: 0 errors and 0 warnings; one pre-existing unused-variable hint remains in `qa/dedupe-lead.cjs`. |
| Production build | `bun run --cwd packages/web build`: 105 pages built; Pagefind indexed 102 pages and 7,057 words; sitemap generated. |
| Desktop English render | Real browser inspection at 1,265 CSS pixels wide: one title, one `main`, one `h1`, 3,458-pixel page height, no horizontal overflow, and localized title `OpenCorvus | Engineering infrastructure for coding agents`. |
| Desktop Simplified Chinese render | Real browser inspection at 1,265 CSS pixels wide: one title, one `main`, one `h1`, 3,219-pixel page height, no horizontal overflow, and localized title `OpenCorvus | 面向编码智能体的工程基础设施`. |
| Visual and interaction review | Personally inspected the English hero, factual principles, shipped-surface rail, closing action/footer, and the Simplified Chinese hero. Corrected inherited deep-background link contrast and brought the primary action into the first viewport. The Chinese header documentation link navigated to `/docs/zh-cn/start/quickstart/` and browser warning/error logs were empty. All page links retain the shared three-pixel `:focus-visible` outline. |
| Documentation health | Historical-link checks passed. The combined documentation suite reported 81 passed and 1 unrelated failure because concurrent local work added `2026-07-21-tool-message-mailbox-dialog-refinement.md` to the July index without making the referenced file tracked. That unrelated Settings/Mailbox work was preserved and not staged or modified. |
