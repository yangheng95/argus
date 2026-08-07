# Codex Visual Style Alignment

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Only adjust UI style, layout, colors, spacing, proportions, typography, radii, shadows, and visual weight against the supplied Codex screenshot. Do not change information architecture, features, copy, data semantics, or interaction flow. |
| Input | OpenCorvus screenshot `codex-clipboard-a03c8ebe-5a08-48d1-861f-3b6621ef1301.png` and Codex reference `codex-clipboard-610a6c1c-ff46-42d2-86df-3394931aa91a.png`. |
| Output | The existing desktop empty-chat surface retains identical content and controls but has calmer Codex-like material, rail proportion, spacing rhythm, and composer geometry. |
| Acceptance | Warm off-white material hierarchy; rail occupies about one fifth rather than nearly one quarter of the desktop frame; empty composer is visibly shorter and its controls remain contained; no overlap or clipping; focused tests, isolated real screenshot, and manual second review pass. |
| Hard constraints | No fallback, compatibility path, gate, new state, markup/feature/copy changes, worktree creation, or running Overlay restart/refresh. Playwright uses Node. Preserve unrelated dirty changes. |
| Sources read | `AGENTS.md`; `2026-07-08-projects-panel-and-codex-composer-polish.md`; `2026-07-08-overlay-codex-font-size-alignment.md`; `2026-07-08-overlay-codex-milk-tea-light-theme.md`; `2026-07-08-overlay-square-aspect-window.md`; `2026-07-13-sidebar-surface-continuity.md`; current `design-language.css`, `light.css`, `sidebar.css`, `conversation.css`, and `composer.css`. |
| Whole-repository grep | Audited all `--ui-rail-width`, `--rail-surface`, `--chat-canvas`, `.chat-composer-stack`, `.chat-input`, `.chat-home-composition`, `.sidebar-codex-*`, and corresponding Overlay test call sites. Geometry is owned by `design-language.css`; light materials by `light.css`; composer geometry by `composer.css`. |
| Independent agent feedback | Not requested; no sub-agent spawned. |

## Benchmark

- Environment: isolated Overlay browser fixture/Vite target; never the user's running Overlay window.
- Timeout: browser runner activity/output timeout, not elapsed time from process start.
- Required assertions: palette contains no pure-white primary material; rail width token remains a single clamp source; composer height/action tokens remain a single source; screenshot shows no collision, clipping, or control escape.
- Visual comparison is desktop-only and evaluates composition, proportions, spacing, typography, color, radius, and shadow.

## Call-site decisions

| Source | Decision |
| --- | --- |
| `styles/cascade/light.css` | Replace cold flat white/gray material ramp with one warm neutral ramp. |
| `styles/tokens/design-language.css` | Reduce the single rail-width clamp; preserve all pane behavior. |
| `styles/surfaces/composer.css` | Tighten empty composer height, textarea floor, action size, padding, radius, and shadow only. |
| Components / i18n / services | Preserve unchanged. |

## Verification

1. Focused palette, density, rail, composer, and source-owner tests.
2. Overlay typecheck and documentation health test.
3. Node-started isolated browser screenshot at desktop viewport.
4. Inspect screenshot, iterate if visual acceptance fails, then perform a second review.

## Result

- PASS: 34 focused palette, rail, composer, empty-home, and surface-continuity assertions.
- PASS: Overlay TypeScript typecheck.
- PASS: historical documentation health, 20 tests.
- PASS: Node Playwright `light-theme-reference-browser.test.ts`; visual evidence at `.scratch/light-theme-codex-reference.png`.
- PARTIAL: the broader `command-palette.test.ts` passed the empty-home geometry and screenshot assertions, then failed later on the unrelated existing `Run` menu presence assertion. Functional menu behavior is outside this visual-only task and was not changed.
- PASS: manual screenshot review confirms the rail is approximately one fifth of the frame, the home composition has the lower Codex-like center of gravity, warm materials remain distinct, and composer contents do not overlap or escape the 22px shell.

## Second Review

- No component structure, i18n copy, feature, service, store, or interaction behavior changed.
- No fallback, compatibility branch, state, or component-level palette override was introduced.
- Existing dirty changes in shared `composer.css`, `conversation.css`, and the July index remain preserved and must be staged by hunk only.
