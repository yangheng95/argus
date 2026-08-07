# OpenCorvus Product Demo Landing Page

## Recall

| Item | Recorded context |
| --- | --- |
| User request | “当前项目中已经有宣传页了，参考 https://www.codebuddy.cn/work/ 这个宣传页帮我调整下当前项目的宣传页，要求展示 opencorvus 的操作页面，功能，以及实际 demo（可以用本地的客户端实现录频操作）。” |
| Acceptance target | Replace the current abstract promotional composition with a desktop-first product page that immediately shows the real OpenCorvus desktop interface, explains shipped capabilities through concrete product surfaces, and includes a playable local-client demo. Preserve English and Simplified Chinese homes through one content and render owner. |
| Reference parity scope | Preserve the reference page’s information architecture and interaction semantics that matter to the request: product claim plus client evidence in the first viewport, an obvious playable demo, feature narrative backed by real interface media, dark high-contrast desktop rhythm, and a closing action. Do not copy CodeBuddy branding, mascot assets, download claims, platform logos, unsupported expert counts, or product-specific content. |
| Visual acceptance | Render `/docs/` and `/docs/zh-cn/` in an independent Web Docs preview, capture goal-bound desktop screenshots, inspect them personally, correct layout/content/media problems, and repeat. Desktop is the only requested delivery surface; no tablet/mobile scope is introduced. |
| Demo acceptance | Produce a tracked WebM from current local OpenCorvus client render evidence. The landing page must use the native semantic `video` element with controls, poster, muted inline playback, and fallback copy. The media must not be an iframe, query override, fabricated browser target, external embed, or unrelated stock animation. |
| Product evidence | Current Overlay browser renders in `.scratch/conversation-agent-rail-hover-context/right-side-bounded-preview.png`, `.scratch/task-dirbar-runtime-status-expanded-state.png`, and `.scratch/environment-popover-right-dock-wide-clearance.png`; `README.md`; `packages/web/src/content/docs/{overlay/overview,server,channels/overview,operations/github-action}.mdx`; `specs/current/architecture/01-agents.md`; existing landing content and tests. |
| Reference evidence | Browser DOM and full-page visual inspection of `https://www.codebuddy.cn/work/` on 2026-07-27. The page places a product claim, action, platform reach, client/product illustration, and playable 1:28 demo in the hero; it then uses a large rounded product-video section, scenario sections, download section, and final call to action. Only the product-evidence hierarchy and desktop rhythm are applicable to OpenCorvus. |
| Hard constraints | Reuse Astro, Starlight, `astro:assets`, the tracked Overlay mark, native video controls, the current landing route, and existing client-render evidence. Do not add a second site, fallback, compatibility alias, state machine, gate, temporary iframe, synthetic backend preview, fabricated capability, fake download, or unsupported marketing count. Do not restart, stop, refresh, or interact with an existing OpenCorvus/Overlay process. Start only isolated Web Docs preview processes. Playwright/browser automation must run with Node, never Bun. |
| Existing design decisions read | `specs/records/2026-07/2026-07-21-opencorvus-promotional-landing-page.md`; `packages/web/src/components/{Hero,Lander}.astro`; `packages/web/src/content/landing.ts`; `packages/opencorvus/test/script/web-landing-page.test.ts`; `packages/web/astro.config.mjs`; `packages/web/package.json`; `specs/README.md`; `specs/records/2026-07/README.md`. |
| Whole-repository grep | `Lander.astro` remains the sole promotional renderer selected by `Hero.astro`; `landing.ts` remains the sole bilingual marketing content source; the English and Chinese home MDX files remain metadata owners only; `web-landing-page.test.ts` is the focused regression owner. Existing `screenshot*.png` assets are stale OpenCode imagery and stay unused pending explicit deletion authorization. No current video asset, video element, alternate landing route, `.openai/hosting.json`, or Sites project exists. |
| Independent agent feedback | None. The user did not request delegation; the active collaboration rule forbids spawning sub-agents without that request. Browser evidence, focused tests, full Web Docs validation, and a separate final diff review are the review sources. |

## Call-site disposition

| Call site / asset | Decision |
| --- | --- |
| `packages/web/src/components/Hero.astro` | Keep the existing localized home selector. No second promotional route. |
| `packages/web/src/components/Lander.astro` | Replace the current abstract trace-first composition with the single product-demo composition. Import current client posters through `astro:assets`; use the canonical `/docs/media/opencorvus-client-demo.webm` static URL. |
| `packages/web/src/content/landing.ts` | Replace trace/principles/surfaces copy with one bilingual hero/demo/features/scenarios contract. All claims remain tied to shipped product surfaces. |
| `packages/web/src/content/docs/{index,zh-cn/index}.mdx` | Preserve metadata-only localized home entries. |
| `packages/web/src/assets/lander/client-*.png` | Add current local-client render evidence copied from the exact `.scratch` screenshots named in Recall. These images are product evidence, not fabricated mockups. |
| `packages/web/public/media/opencorvus-client-demo.webm` | Add a short, silent, tracked client walkthrough assembled from the same current local-client render evidence with the installed Playwright FFmpeg toolchain. |
| `packages/web/src/assets/lander/screenshot*.png` | Leave tracked and unused; deletion requires explicit user authorization under repository rule 17. |
| `packages/opencorvus/test/script/web-landing-page.test.ts` | Update the structural, evidence, asset, native-video, route, localization, and removed-claim assertions. |
| `specs/README.md` and `specs/records/2026-07/README.md` | Add this record to both canonical indexes. |

## Implementation

1. Keep one semantic page with a high-contrast hero. Put the product claim and actions on the left and a real OpenCorvus client poster plus native playable demo on the right, so product evidence is visible before scrolling.
2. Follow with a large “one task, one visible operating surface” demo stage using the recorded client tour and four factual runtime signals: project task, Orchestrator dispatch, streamed participant/tool activity, and durable project evidence.
3. Explain capabilities with three alternating product-story rows driven by real client screenshots: multi-agent task work, environment/tools/evidence, and desktop plus headless/channel surfaces. Do not represent the screenshots as live controls.
4. Keep all controls real: Quickstart, documentation, GitHub, architecture, feature documentation, and the native video controls. Preserve visible `:focus-visible` treatment and reduced-motion behavior.
5. Keep media performance bounded with optimized Astro images, explicit dimensions, lazy loading below the fold, one compressed WebM, and a poster.

## Verification

- `bun test packages/opencorvus/test/script/web-landing-page.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/web check`
- `bun run --cwd packages/web build`
- Start an independent Web Docs preview only, then inspect `/docs/` and `/docs/zh-cn/` with the supported browser at the desktop surface.
- Capture and inspect hero, demo stage, feature stories, final call to action, focus state, native video metadata/playback state, horizontal overflow, localized title, and console errors.
- Run `git diff --check`, inspect the exact diff and tracked media inventory, review once for product truth and once for code/design single-source ownership.
- Commit with a `dsw-33987` subject and push the current branch to `legacy-remote`. If legacy remote remains unreachable, report that external blocker explicitly instead of claiming delivery.

## Verification evidence

- Focused landing regression: 10 tests passed, 76 assertions.
- Historical documentation health: 22 tests passed, 71 assertions.
- Astro validation: 0 errors and 0 warnings; one existing unused-variable hint remains in `packages/web/qa/dedupe-lead.cjs`.
- Production Web Docs build: 105 pages built and both English and Simplified Chinese search indexes generated.
- Browser review at 1280-pixel desktop width: English and Simplified Chinese hero layouts have no horizontal overflow; both load the real client poster and eight-second WebM; the native video reached ready state 4 and played; the demo anchor, feature stories, shipped-surface cards, and closing action were visually inspected; the local preview console contained no errors or warnings.
- Goal-bound screenshots: `.scratch/landing-product-demo-english-hero.png`, `.scratch/landing-product-demo-english-demo.png`, and `.scratch/landing-product-demo-chinese-hero.png`.
- The first document-health rerun correctly rejected the newly indexed record because it was not yet tracked. After staging the record with the implementation, the same suite passed all 63 tests and 1,312 assertions, confirming repository-index integrity.

## Codex final review

- Product truth: every capability statement maps to a current repository surface or public documentation route; unsupported CodeBuddy-specific counts, download claims, brands, and mascot content are absent.
- Single source: `Hero.astro` still owns localized landing selection, `Lander.astro` owns rendering, `landing.ts` owns bilingual content, and one native video asset owns the walkthrough.
- Interaction and evidence: all buttons are links to real routes or anchors, the walkthrough uses native video controls, screenshots are labeled product evidence rather than interactive controls, and no iframe or synthetic preview path was introduced.
