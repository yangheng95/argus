# Tool Tooltip Removal

## Recall

| Item | Detail |
| --- | --- |
| User request | Hide the tooltip on tools. |
| Acceptance criteria | Tool rows no longer mount the structured timing tooltip and no Tool-owned native browser tooltip remains on the subtitle, inline start time, or duration. Tool header click and keyboard disclosure behavior, the hover/focus-revealed inline start time, the visible elapsed duration, and non-Tool metadata tooltips remain unchanged. Focused source/unit coverage, a Node-launched real-page browser scenario, a task-scoped screenshot, visual review, Overlay checks, and documentation health pass. |
| Hard constraints | Keep `CardHeader` as the only Tool header/disclosure owner, `CardDurationChip` as the only inline timing renderer, `part.state.time.start/end` as the timing source, and the shared Kobalte Tooltip primitive for surfaces that still need it. Remove the retired Tool tooltip path instead of hiding it with CSS or retaining fallback/dead code. Desktop-only; do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Start Playwright with Node. Preserve and do not stage concurrent web/landing-page and Settings-plan changes in the dirty worktree. |
| Sources read | `AGENTS.md`; Browser skill; `specs/README.md`; `specs/current/architecture/99-principles.md`; `2026-07-16-tools-surface-time-pin-visual-refinement.md`; `2026-07-17-tools-reasoning-inline-text-flow.md`; `CardHeader.tsx`; `CardHeaderChrome.tsx`; `card-timing.ts`; `card.css`; timing/header source tests; `message-part-chronology-browser.test.ts`; relevant locale files. |
| Whole-repository search evidence | `rg` enumerated every `tool-timing-tooltip`, `card-tool-timing-tooltip`, `data-tool-timing-trigger`, `toolTimingRows`, Tool timing locale key, `card__tool-start-time`, `card__duration`, and Tool subtitle `title` call site across production, tests, and specs. Production ownership is singular: `CardHeader` mounts the structured Tool tooltip, `CardDurationChip` owns both Tool-native timing titles and inline timing, `card-timing.ts` formats tooltip-only rows, and `card.css` owns the tooltip-only presentation. The exact disposition follows below. |
| Independent agent feedback | None. The user did not request sub-agents, and current collaboration policy does not authorize unrequested delegation. |
| Git baseline | The current branch is `work-v0.0.13beta-yr-0721`. During investigation a concurrent workflow moved both local and git-cc branch refs from `4a853f623` back to `d657bf323`; the working tree also gained unrelated web/landing-page and Settings-plan changes. This task preserves them and will re-fetch/reconcile before delivery. |

## Evidence and root cause

The Tool row has three distinct tooltip paths. `CardHeader` conditionally replaces
its normal shared Button with a Kobalte Tooltip trigger whenever Tool timing rows
exist. `CardDurationChip` separately assigns native `title` values to the Tool
start-time and elapsed-duration elements. The Tool subtitle title was already
removed, but the other two native titles and the structured floating layer mean
that hiding one popup cannot satisfy the request.

The correct boundary is feature retirement at the Tool presentation owner. The
Tool header remains the same shared disclosure Button, while tooltip-only row
formatting, locale strings, CSS, and assertions are deleted so there is no hidden
or second timing-detail path. Persisted timing still drives the visible duration
and the existing hover/focus-revealed inline start time.

## Whole-repository call-site decisions

| Surface / call site | Decision |
| --- | --- |
| `CardHeader.tsx` | Replace the Tool-only Tooltip branch with the existing shared header Button for every card kind. Preserve Tool icon, title, subtitle, disclosure semantics, click behavior, and `card__head-main` styling. |
| `CardHeaderChrome.tsx` / `CardDurationChip` | Keep the Tool-only semantic inline start `<time>` and duration text, but omit native `title` attributes for Tool nodes. Preserve the localized visible start value, persisted ISO `dateTime`, live running duration, and non-Tool duration tooltip. |
| `utils/card-timing.ts` | Keep `cardDurationMs` as the shared duration calculation. Delete `ToolTimingRow` and `toolTimingRows`, which have no remaining production consumer after the tooltip is removed. |
| `styles/surfaces/card.css` | Keep inline start/duration rules. Delete only `.card-tool-timing-tooltip*` presentation; shared and card-metadata tooltip styles remain owned by their existing primitives/surfaces. |
| `i18n/en-US.json`, `i18n/zh-CN.json` | Delete the five Tool-timing-tooltip-only keys in both locales; retain all visible and non-Tool tooltip strings. |
| `card-duration-single-source.test.ts`, `card-timing.test.ts` | Assert one shared Tool header Button, absence of Tool Tooltip ownership/titles/dead row formatting, and continued duration calculation/inline semantic timing. |
| `message-part-chronology-browser.test.ts` | Replace structured-tooltip assertions with real hover/focus checks that no tooltip or `aria-describedby` appears, no Tool-native timing title exists, inline timing remains visible in the accepted location, and screenshot evidence captures the Tool hover state. |
| Existing metadata tooltip surfaces/tests | Preserve unchanged; the request is scoped to Tool rows, not Agent metadata, Work Ledger, composer budget, or shared Tooltip primitives. |

## Implementation and verification plan

1. Retire the Tool-only Tooltip branch and its native Tool timing titles without changing the shared disclosure or timing source.
2. Delete tooltip-only formatting, locale, and CSS support so no hidden/dead implementation remains.
3. Update source/unit and Node-launched real-browser assertions for absence of tooltip ownership plus continued inline timing, disclosure, focus, and geometry behavior.
4. Run focused tests, Overlay typecheck/internationalization/build, and the real message chronology browser scenario; inspect the current-task desktop screenshot and correct any visual regression.
5. Run required documentation-health tests, re-fetch/reconcile the active git-cc branch, perform a second scoped diff review, commit only task-owned changes with the `dsw-33987` prefix, and push to `myhexin`.

## Progress

- [x] Recalled constraints, inspected the historical timing decisions, and enumerated every production/test/document call site.
- [x] Removed Tool tooltip ownership and tooltip-only dead support.
- [x] Updated focused and real-browser regression coverage.
- [x] Completed build, screenshot inspection, and visual correction.
- [ ] Completed documentation checks, second review, commit, and git-cc push.

## Verification evidence

- Focused duration/header coverage passed: 25 tests and 237 assertions across
  `card-duration-single-source`, `card-timing`, and `card-header-chrome`.
- Overlay TypeScript, internationalization, and production Vite build passed;
  the build transformed 2,647 modules.
- The Node-launched `message-part-chronology-browser` real-page scenario passed.
  It proves that Tool hover mounts no structured tooltip, assigns no native
  title or `aria-describedby`, keeps the semantic inline start time and visible
  duration, preserves keyboard focus and disclosure, and retains the accepted
  timing geometry.
- `.scratch/tool-hover-without-tooltip.png` was inspected at original
  resolution. The hovered Tool row shows `07:59:58 AM` and `1s` inline with no
  floating layer, obstruction, wrap, or spacing regression.
- The in-app browser independently opened the same isolated Vite fixture,
  expanded the Tool row, and verified focus state: zero Tool tooltip nodes,
  null trigger/start/duration titles, null `aria-describedby`, visible persisted
  start time, and unchanged duration. Its screenshot was personally inspected
  and shows the focused Tool header and detail surface unobstructed.
