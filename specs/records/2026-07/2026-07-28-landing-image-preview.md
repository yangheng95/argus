# Promotional Landing Image Preview

## Recall

| Item | Recorded context |
| --- | --- |
| User request | “宣传页上的图片添加点击查看功能”。 |
| Acceptance target | The real OpenCorvus product screenshot in the hero and all three feature-story screenshots open at a readable viewport-bounded size when clicked. The same interaction must work with keyboard focus, expose a localized accessible name, close through an explicit control, the native Escape key, or the backdrop, and return focus through the native dialog lifecycle. |
| Scope | Desktop promotional pages at `/docs/` and `/docs/zh-cn/`. Brand marks remain navigation/decorative imagery, and the demo video retains its native playback controls instead of becoming an image-preview trigger. |
| Hard constraints | Keep `Lander.astro` as the only landing renderer and `landing.ts` as the bilingual content owner. Use the browser-native dialog primitive; do not add an iframe, second preview implementation, state machine, fallback route, synthetic product surface, or new dependency. Do not restart or interact with an existing OpenCorvus/Overlay process. Browser automation must use Node. |
| Existing records read | `specs/records/2026-07/2026-07-27-codebuddy-inspired-product-demo-landing.md`; `specs/records/2026-07/2026-07-28-real-client-promo-recording.md`; current `Lander.astro`, `landing.ts`, and `web-landing-page.test.ts`. |
| Whole-repository grep | `Hero.astro` selects `Lander.astro`, which is the sole renderer of all promotional product images. `client-agent-workspace.png` appears once in the hero and once in the first feature story; the two remaining `client-*.png` assets appear in the second and third stories. No Web landing preview implementation exists. Overlay owns a separate delegated image-preview runtime and is out of scope. `web-landing-page.test.ts` remains the focused landing regression owner. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration rule forbids spawning sub-agents without that request. |

## Call-site disposition

| Call site | Decision |
| --- | --- |
| Hero product screenshot in `Lander.astro` | Wrap the optimized image in the shared preview-trigger button and preserve its eager loading and product-window geometry. |
| Three feature-story screenshots in `Lander.astro` | Use the same trigger contract and preserve each optimized image's intrinsic aspect ratio and lazy loading. |
| Brand marks in the header, demo stage, call to action, and footer | Preserve their existing decorative or navigational semantics; they are not product screenshots. |
| Demo video poster | Preserve native video playback semantics; clicking the video must continue to control playback. |
| `landing.ts` | Add one bilingual image-viewer label contract consumed by every preview trigger and the shared dialog. |
| `web-landing-page.test.ts` | Assert one shared native dialog, four triggers, localized labels, optimized image sources, and absence of iframe or duplicate dialog ownership. |

## Implementation

1. Add localized open, close, and dialog labels to the single bilingual landing-content source.
2. Render the hero and feature screenshots as native buttons with the existing optimized Astro images and explicit preview source/alternative-text data.
3. Add one viewport-level native dialog containing the selected full image and a visible close button. Use native modal focus and Escape handling, plus backdrop click closing.
4. Preserve the current page layout while adding a restrained zoom cursor, hover affordance, focus outline, viewport-bounded image sizing, and reduced-motion compliance.

## Verification

- `bun test packages/opencorvus/test/script/web-landing-page.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/web check`
- `bun run --cwd packages/web build`
- Start one isolated Web Docs preview and inspect the English and Simplified Chinese desktop pages through the supported browser.
- Capture and inspect the closed and open preview states, exercise click, explicit close, backdrop close, Escape, and keyboard activation, and check focus, overflow, image dimensions, and console output.
- Run `git diff --check`, inspect the exact diff, perform a second review, commit with a `dsw-33987` subject, and push the current delivery branch to `myhexin`.

## Verification evidence

- The focused promotional regression passes 12 tests and 154 assertions after concurrent landing-video work is included.
- Astro check completes with zero errors and zero warnings plus the existing unused-variable hint in `qa/dedupe-lead.cjs`. The production build completes 105 pages and both language search indexes.
- The supported browser rendered four screenshot triggers on both localized pages at `1440 × 900`; every trigger references the one `landing-image-preview` dialog through `aria-controls` and `aria-haspopup`.
- The English hero screenshot opens at `1374 × 773` inside the viewport. The updated interactive-artifact screenshot opens at `1374 × 753` without cropping. Explicit close and backdrop close both return focus to the invoking screenshot button.
- The localized dialog names and close controls are exposed as `Product screenshot preview` / `Close image preview` and `产品截图预览` / `关闭图片预览`. Both pages have zero horizontal overflow and no browser console errors or warnings.
- Goal-bound visual evidence is saved in `.scratch/landing-image-preview/{english-closed,english-open,chinese-artifact-open}.png`.
- The native dialog remains the Escape-key owner. The browser-control surface did not deliver its injected Escape keystroke to the page, so the Escape path is covered by the platform primitive rather than claimed as an observed automation event.
