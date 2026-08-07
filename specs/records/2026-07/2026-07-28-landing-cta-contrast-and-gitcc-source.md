# Landing CTA Contrast and git-cc Source

## Recall

| Item | Recorded context |
| --- | --- |
| User requests | The outlined “查看当前架构” button text is too pale to read. No visible `GitHub` wording should remain on the promotional landing page; its repository entry may point to git-cc instead. |
| Acceptance target | The outlined architecture action has stable dark text on the light call-to-action surface in its normal state and a legible green hover state. English and Simplified Chinese promotional pages contain no visible or accessible `GitHub` label. Header and footer source links navigate to `https://git-cc.myhexin.com:6443/yangheng/opencorvus`. |
| Screenshot evidence | The supplied crop shows the outlined Chinese architecture action with a visible border but near-background text. The exact overriding runtime rule is not present in the screenshot. |
| Local computed evidence | The current isolated build computes the action at `rgb(32, 29, 29)` on a transparent light background, so the production-only pale result cannot be truthfully attributed to one proven external selector. The owning `.outline-button` rule currently lacks explicit cascade ownership while the landing page is embedded in Starlight. |
| Existing records read | `2026-07-27-codebuddy-inspired-product-demo-landing.md`, `2026-07-28-landing-image-preview.md`, current `Lander.astro`, `landing.ts`, `config.mjs`, and `web-landing-page.test.ts`. |
| Whole-repository grep | `Lander.astro` renders the promotional header and footer labels. `astro.config.mjs` separately consumes `config.github` for the documentation-wide social and edit-link contracts, so that field must remain unchanged. `landing.ts` owns `nav.github`, two visible `GitHub Action` cards, and two feature bullets mentioning GitHub. The canonical automation documentation routes contain `github-action` in their URL but do not require that platform name to be visible. The focused landing regression is the sole promotional-page test owner. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration rule forbids spawning sub-agents without that request. |

## Call-site disposition

| Call site | Decision |
| --- | --- |
| `packages/web/config.mjs` | Add an accurately named promotional `repository` property pointing to the user-approved git-cc project page. Preserve the separate documentation-wide `github` property consumed by Starlight social and edit links. |
| Header and footer links in `Lander.astro` | Consume `config.repository`, use localized `Source / 源码` labels, and replace GitHub-specific class, icon, and accessible name semantics. |
| Automation capability in `landing.ts` | Preserve the shipped repository automation feature and its current documentation route, but rename all visible English and Chinese copy without GitHub wording. |
| Architecture CTA in `Lander.astro` | Give the component-owned normal and hover rules explicit color ownership using existing landing tokens; do not change global Starlight link styles. |
| `web-landing-page.test.ts` | Assert the git-cc target, localized source labels, absence of visible/accessibility GitHub wording, renamed automation copy, and strong CTA color ownership. |

## Verification

- Focused landing regression, document health, Astro check, and production build.
- Render English and Chinese pages in an isolated desktop preview. Inspect the CTA at rest and hover, verify computed foreground/background contrast, click the source link contract without navigating externally, and check visible/accessibility text, overflow, and console output.
- Capture the corrected Chinese CTA and header/footer source surfaces, then perform a second diff review.
- Commit with a `dsw-33987` subject and push the current delivery branch to `myhexin`.

## Verification evidence

- The focused promotional regression passes 13 tests and 169 assertions after the concurrent demo-description refinement.
- Astro check reports zero errors and zero warnings plus the existing `qa/dedupe-lead.cjs` unused-variable hint. The production build completes 105 pages and both language search indexes.
- The Chinese architecture action computes to `rgb(5, 8, 6)` against the `#f2f2ed` landing background, a `17.91:1` contrast ratio. Visual inspection confirms the text and border are clearly readable at `1440 × 900`.
- English and Chinese promotional pages expose zero visible leaf-text occurrences of `GitHub`. Their header and footer source links use `Source / 源码`, resolve to `https://git-cc.myhexin.com:6443/yangheng/opencorvus`, and expose localized accessible names.
- The fourth shipped-surface card renders as `Repository automation / 仓库自动化` with non-platform-specific descriptions while preserving the current documentation route.
- Both localized pages have zero horizontal overflow and no browser console errors or warnings.
- Goal-bound screenshots are saved at `.scratch/landing-cta-gitcc/{chinese-cta-contrast,chinese-gitcc-source}.png`.
