# Landing Demo Description Restraint

## Recall

| Item | Recorded context |
| --- | --- |
| User request | The promotional page description beneath the client demo should not disclose the demonstration scenario in such detail. |
| Acceptance target | Preserve the core claim that the video is a real OpenCorvus desktop-client recording and shows multi-agent collaboration from a complex request to traceable delivery. Remove the internal project identifier, six-month research scope, named intermediate artifact, confidence-ranking detail, and quarterly-roadmap wording in both English and Simplified Chinese. Keep the current section hierarchy and desktop layout. |
| Hard constraints | Use one localized content source; do not add fallback copy or a parallel rendering path. Update the focused landing-page contract. Render the real desktop page, inspect a task-scoped screenshot, perform a second diff review, commit with a `dsw-33987` subject, and push to `legacy-remote`. Do not restart or interfere with a running OpenCorvus or Overlay process. |
| Existing records read | `2026-07-27-codebuddy-inspired-product-demo-landing.md`, `2026-07-28-real-client-promo-recording.md`, `2026-07-28-landing-cta-contrast-and-legacy-remote-source.md`, `packages/web/src/content/landing.ts`, `packages/web/src/components/Lander.astro`, and `packages/opencorvus/test/script/web-landing-page.test.ts`. |
| Whole-repository grep | `landing.ts` owns the only English and Chinese demo descriptions. `Lander.astro` has one presentation call site, `{content.demo.description}`. The focused landing test is the only executable consumer asserting the internal project identifier, time span, and roadmap details. Recording specs retain those facts as implementation evidence and are not promotional copy. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration rule forbids spawning sub-agents without that request. |

## Call-site disposition

| Call site | Decision |
| --- | --- |
| English `demo.description` in `landing.ts` | Replace scenario narration with one concise product-level sentence about real-client multi-agent work and traceable delivery. |
| Simplified Chinese `demo.description` in `landing.ts` | Apply the same information boundary and meaning in natural Chinese. |
| `{content.demo.description}` in `Lander.astro` | Preserve as the single renderer; no layout or component change is required. |
| `web-landing-page.test.ts` | Assert the retained product claims and explicitly reject all removed internal/scenario details in both locales. |
| Recording specifications | Preserve as auditable implementation evidence; they are not rendered on the promotional page. |

## Verification

- Run the focused landing regression and documentation-health checks.
- Run the web production build.
- Launch the isolated documentation site with its normal Node-based browser sidecar flow, render the Simplified Chinese desktop landing page, and inspect a screenshot of the demo-description region for concise copy and stable layout.
- Review the final diff and grep the rendered content sources for the removed promotional details.
- Commit and push the current delivery branch to `legacy-remote`.
