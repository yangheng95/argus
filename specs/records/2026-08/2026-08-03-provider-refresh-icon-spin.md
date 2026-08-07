# Provider Refresh Icon Spin

## Recall

### User requirement

- Make both refresh icons on the Provider settings page rotate while their corresponding refresh request is running.
- The two marked controls are the Provider catalog refresh button and the live-model refresh button.
- Follow-up screenshot feedback: both icons currently rotate around an offset center and visibly move up and down; keep each icon on one fixed geometric center throughout the animation.

### Acceptance criteria

- Each icon rotates continuously from request start until its own asynchronous refresh settles.
- The two independent refresh operations retain independent visual ownership.
- Idle icons remain still and the existing button geometry, labels, disabled state, and refresh behavior remain unchanged.
- The icon wrapper has an explicit square geometry matching the canonical icon token, so the animation rotates around the center of that square instead of an inline line box.
- The real desktop Provider settings page is rendered, each refresh is triggered, and screenshots are inspected; no User Interface automation test is added, modified, or run.

### Hard constraints

- Reuse the existing global `oc-spin` keyframes and Provider-specific duration token; do not add another animation definition or duration.
- Preserve the independent `refreshingProviders` and `refreshingModels` signals and their current `data-spinning` projection.
- Preserve unrelated workspace changes and do not restart or refresh the user's running OpenCorvus / Overlay process.
- Commit subjects use the `dsw-33987` prefix and delivery is pushed to `legacy-remote`.

### Sources read

- User-provided screenshot `image.png`.
- `AGENTS.md` and `CLAUDE.md`.
- `specs/current/architecture/06-provider.md`.
- `packages/overlay/src/components/settings/ProvidersPanel.tsx`.
- `packages/overlay/src/styles/cascade/base.css`.
- `packages/overlay/src/styles/primitives/button.css`.
- `packages/overlay/src/styles/surfaces/settings.css`.
- `packages/overlay/src/styles/tokens/design-language.css`.

### Whole-repository search

| Owner / call site                       | Finding                                                                                                             | Disposition                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ProvidersPanel.tsx` catalog button     | Projects `refreshingProviders()` to its own `disabled` and `data-spinning` attributes.                              | Preserve the current state and request ownership.                                               |
| `ProvidersPanel.tsx` model button       | Projects `refreshingModels()` to its own `disabled` and `data-spinning` attributes.                                 | Preserve the current state and request ownership.                                               |
| `settings.css` `.provider-refresh-icon` | Owns both icon wrappers and currently declares only a transform transition.                                         | Keep geometry; replace the one-shot spinning-state transform with the canonical loop animation. |
| `settings.css` spinning selectors       | Exhaustive repository search finds exactly the two Provider buttons. They currently rotate only to 90 degrees once. | Retain both selectors and apply the same continuous animation.                                  |
| `base.css` `oc-spin`                    | Defines the shared 360-degree rotation keyframes.                                                                   | Reuse as the single keyframe source.                                                            |
| `design-language.css` Provider duration | Defines `--ui-duration-loop-provider-refresh-spin: 1s`.                                                             | Reuse as the single Provider refresh timing source.                                             |

The follow-up inspection found that `.provider-refresh-icon` is an `inline-block` whose height comes from a font line box while the child Lucide SVG has its own square token size. The wrapper therefore rotates around the line box center rather than the SVG's geometric center. Both buttons share this one wrapper class, so the root repair is to make that existing owner an explicit centered square using the canonical standard icon-size token; no component or animation source needs to change.

### Independent review

- A session-local read-only reviewer was dispatched against the exact component and style files and completed without workspace mutation.
- Claude Code `2.1.147` was also invoked for the required read-only review, but local authentication is unavailable (`loggedIn: false`), so it produced no code-analysis evidence.

## Implementation plan

1. Give the shared icon wrapper an explicit centered square geometry using `--oc-icon-size-standard`, while retaining the existing `oc-spin` animation and Provider duration token.
2. Build and typecheck the Overlay, then render an isolated desktop page, trigger both real refresh actions, inspect screenshots, and correct any remaining visual issue.
3. Run documentation health checks, inspect the final diff, perform a second review, commit only task-owned files, push to `legacy-remote`, and verify remote alignment.

## Progress

- [x] Inspect the screenshot, current Provider architecture, component state, styles, tokens, and all affected call sites.
- [x] Implement the continuous icon animation.
- [ ] Replace the inline line-box rotation geometry with one explicit centered square shared by both icons.
- [ ] Complete build and visual acceptance.
- [ ] Complete second review, commit, push, and remote verification.
