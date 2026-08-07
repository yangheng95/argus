# Message and Tool Tone Unification

Status: complete

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Make message-card and Tool background colors follow one unified design-language tone. |
| Acceptance criteria | The Agent message card remains the single hue source; expanded Tool container, header, hover, and border preserve that stage hue and differ only by restrained lightness/contrast. Collapsed Tools remain transparent. Light and dark real-page screenshots, focused source/browser tests, typecheck, build, internationalization, document health, commit, and `myhexin/v0.0.9beta` push pass. |
| Hard constraints | Preserve `--conversation-card-background` and `--card-stage` as the existing single sources, and preserve Card/Tool render ownership and interaction. Use native theme tokens and `color-mix`/`light-dark`; no hardcoded colors, new palette, duplicate renderer, fallback, compatibility branch, mobile scope, worktree, or intervention in the running Overlay. Browser acceptance uses an isolated build and Node-launched fixture. Preserve unrelated `C:/`. |
| Evidence | The accepted Agent card is `color-mix(card-stage 7%, surface)`. The current expanded Tool is independently `surface-inset`; its header mixes neutral `surface` and its hover mixes `surface-hover/surface-inset`. This creates a stage-tinted message containing a neutral-gray Tool. |
| Sources read | `AGENTS.md`; Browser skill; current architecture/spec indexes; 2026-07-15 Agent message-card surface, 2026-07-16 Tool surface refinement, 2026-07-17 density/card-tone alignment, and 2026-07-19 Tool panel records; `chat-bubble.css`; `messages.css`; Card/Tool owners; focused source and browser tests. |
| Whole-repository search | `rg` enumerated every `--conversation-card-background`, `--card-stage`, expanded Tool selector, Tool background assertion, `surface-inset`, and light/dark computed-color wait. Production ownership is singular: Agent row owns the message hue and the scoped expanded Tool rules consume it. Direct test consumers are `message-embed.test.ts`, `message-part-chronology-browser.test.ts`, `chat-bubble-disclosure-button-browser.test.ts`, and architecture/chat-bubble guards. |
| Independent agent feedback | None; the user did not request delegation. |
| Git baseline | `ec86d8d2e`; local and `myhexin/v0.0.9beta` were converged after the previous delivery. Only unrelated untracked `C:/` exists. |

## Cause and repair

The mismatch is a color-provenance error, not an opacity problem. The message surface owns a stage-derived semantic hue, while the Tool panel introduced three neutral theme sources. Increasing transparency would only expose more of the parent and make contrast unstable. The repair is to define Tool surface/header/border variables at the existing execution owner from `--conversation-card-background` and `--card-stage`, then let expanded Tool states consume those variables. `light-dark()` reuses the previously verified light/dark mix ratios so the Tool surface is slightly lighter in both themes without hue drift.

## Call-site decisions

| Call site | Decision |
| --- | --- |
| Agent row / message card | Keep the existing stage-derived `--conversation-card-background` and stage-tinted border unchanged. |
| `.msg-work-details` | Define one Tool surface, header, and border semantic projection from the inherited message-card sources. |
| Collapsed Tool | Keep transparent background/border and existing line rhythm. |
| Expanded Tool container | Replace neutral `surface-inset` and neutral border with the semantic Tool surface/border. |
| Expanded Tool header/rest/hover | Replace neutral surface mixes with the message-card header variable and an in-family Tool/message mix on hover. |
| Source/browser tests | Assert color provenance, reject neutral Tool sources, compare rendered card/Tool color families and lightness in light/dark themes, and refresh screenshots. |
| Render/data owners | No changes to `CardParts`, `Card`, `CardHeader`, `InlineToolPart`, timing, command, output, disclosure, or chronology. |

## Verification plan

1. Add failing source and computed-color contracts for single-source color projection.
2. Implement only the scoped semantic variables and expanded Tool consumers.
3. Run Node browser fixtures, inspect light/dark screenshots at original resolution, and iterate on contrast.
4. Run focused tests, Overlay typecheck/i18n/build, docs health, second diff/call-site review, reconcile git-cc, commit with `dsw-33987`, and push.

## Progress

- [x] Root cause, historical decisions, owners, and direct tests audited.
- [x] Regression contracts and implementation complete.
- [x] Real-browser visual acceptance complete.
- [x] Final verification, commit, and push complete.

## Result and evidence

The execution-detail owner now projects `--transcript-tool-surface`, `--transcript-tool-header-surface`, and `--transcript-tool-border` from the inherited message-card hue. The expanded Tool container, header, divider, and hover/focus state consume only that semantic projection; collapsed Tool rows remain transparent.

The light chronology fixture measured the message at `rgb(228, 246, 250)`: the derived Tool surface was 7.51 RGB-distance units from the message, versus 16.88 for the retired neutral inset token. Light and dark browser fixtures both passed the same-family assertions and refreshed the scoped screenshots. Original-resolution inspection confirmed that the Tool reads as an inset layer of the Agent card rather than a separate gray card.

Focused verification passed: 2 Node/Playwright browser scenarios, 135 source and architecture tests, Overlay TypeScript typecheck, internationalization check, production build, 21 historical-document tests, docs check, and `git diff --check`. An isolated production preview loaded in the in-app browser and its CSS Object Model confirmed all four links: card-derived Tool surface, expanded container consumption, card-tone header consumption, and semantic hover mix. The isolated preview was stopped without touching the running Overlay.
