# Overlay CSS Single-Source Refactor Follow-up

Date: 2026-05-11

## Background

`bun run --cwd packages/overlay test` reports ~30 failures whose tests
pin "single source" CSS contracts authored during an incremental design-
language refactor (commit log: `refactor(overlay): fold extension row
chrome`, `refactor(overlay): retire workbench shell theme overrides via
palette`, `refactor(overlay): collapse 11-value radius scale to 4
tokens`, …). The tests describe the **target state**: each canonical
selector should appear once as a solo top-level rule whose body carries
the actually-rendered values (`--surface-inset`, `border: 0`, etc.).

The implementation drifted: subsequent commits altered some surfaces
without removing the legacy rules these tests guard against. The tests
are correct contracts; the CSS is incomplete.

Codex review (2026-05-11) flagged this as P2: "leaves the package's
test command unusable until the assertions or implementation are
brought back into sync."

## Why this is not a one-shot fix

Each failing test pins a separate consolidation. To make them pass we
need to:

1. For each canonical selector (`.extension-row`, `.config-section`,
   `.config-subsection`, `.channel-doc-card`, `.section`, …), grep
   every CSS file for sibling rules and `!important` overrides, then
   collapse the rendering surface into one solo rule that mirrors the
   actually-rendered values.
2. For component-level tests (`DeliveryPanel renders inside a
   collapsible section frame`, `SectionFrame is the single source for
   section auto-open`, `Tabs primitive is the only right-panel tab
   chrome owner`), wire the component through the canonical primitive
   (Section / SectionFrame / Tabs) and delete the bespoke chrome.
3. For coverage guards (`flat-redesign breakpoint coverage`,
   `letter-spacing`, `inline style coverage`, `i18n fallback policy`,
   `useDisclosure adoption`), audit the targeted surfaces and migrate
   each remaining caller to the canonical token / hook.

None of these is mechanical. They each require visual verification
against design tokens, theme cascades (light, dark, vscode-dark), and
the existing surface taxonomy. Patch-by-patch fixes from a single
agent without the design-language owner's input would regress the
surfaces the consolidation was trying to clean up (rule 7 forbids
fallback / patch fixes).

## Recommended path

- Spin a dedicated `feat: complete flat-redesign single-source CSS`
  sprint. Each failing test is a discrete, well-described unit of work
  with the rationale in its header comment.
- Until then, the package test runner remains noisy. **Do not** mark
  the failures `test.skip` — that erases the contract and would hide
  regressions. The failing tests are the spec.

## Remaining failure inventory (2026-05-11)

| Surface / theme guard | Failing tests | Rationale |
|---|---|---|
| `.channel-doc-card` + `.detail-card` canonicals | 2 | shared chrome with .extension-row siblings; needs the same fold |
| `.chat-textarea` flat source | 1 | wrap min-height vs textarea floor still doubled |
| `.config-section` / `.config-subsection` canonical | 5 | solo rule + `--surface-inset` body unfinished |
| `.extension-row` canonical | 3 | original guard from `20d077068`; siblings now drift |
| `.section` canonical | 3 | `--surface-inset`, radius, drop-shadow chrome unmoved |
| DeliveryPanel section frame migration | 4 | DeliveryPanel still bespoke; should mount through Section primitive |
| `SectionFrame` single auto-open | 1 | callsites still wire `defaultOpen={false}` |
| Tabs primitive ownership | 0 (now passing) | restored via `tabs-primitive.test.ts` walk fix |
| useDisclosure adoption | 1 | watermark requires ≥5 surfaces; only 4 today |
| flat-redesign coverage (breakpoint / letter-spacing / inline style / i18n fallback) | 5 | audit targets list still has stragglers |
| `composer shell` density | 1 | textarea floor cap still > 56px |
| `right-rail empty cards` density | 1 | inspector section head/body 5/8 rhythm broken |
| `dialog top-layer color-scheme inheritance` | 1 | `.dialog` rule missing `color-scheme: inherit` |
| `executor selector separates long plan and edit models` | 1 | test calls `/global/tasks` without `?directory=`; unrelated to design; needs a small mock |
| `high-frequency icon actions opt into shared chrome` | 1 | last few callsites unmigrated |
| `round 2 i18n discipline` | 1 | stragglers still pass string fallback to `t()` |

`executor selector separates long plan and edit models` is the one
non-CSS failure here; it expects the test environment to register a
project directory before `loadTasks` hits the global-tasks endpoint.
Fixable in isolation but unrelated to this refactor — track separately.

## Out of scope for the current codex follow-up PR

The four fixes already landed in `00ab6e2a1` / `36fd2e035` (card
duration single source, alibaba key removal) plus this PR's commits
(release archive, musl build flag, duplicate writeToTree, mock leak,
tabs-primitive walk) handled every codex P1/P2 except the CSS
single-source backlog described above. That backlog deserves a
dedicated PR per surface, with the design-language owner driving.
