# Agent Models Loading Spinner Motion

## Context

Independent GUI style review found that the Agent Models panel still renders a
static `.agent-models-loading-spinner` ring during data load. This is separate
from the Agent Models i18n/select work: the visible loading indicator exists in
the same panel, but it is a motion-source issue.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-06-19-loading-spinner-motion-token-source.md` | Live loading spinners must use the shared `oc-spin` animation and named loop duration tokens. |
| `packages/overlay/test/flat-redesign-motion-coverage.test.ts` | Motion loops are statically guarded; literal timing belongs in `design-language.css`, not surface CSS. |
| `packages/overlay/src/styles/cascade/base.css` | Shared keyframes and reduced-motion overrides live in cascade base. |
| `packages/overlay/src/components/settings/AgentModelsPanel.tsx` | The loading DOM is a live user-visible state: `.agent-models-loading-spinner`. |

## Evidence

| Command / File | Finding | Decision |
| --- | --- | --- |
| `rg -n "agent-models-loading-spinner|oc-spin|spinner" packages/overlay/src packages/overlay/test specs/new-arch` | `.agent-models-loading-spinner` is live, but only `.card__spinner` and `.app-notification__spinner` animate. | Extend the existing spinner contract to this live selector. |
| `packages/overlay/src/styles/surfaces/settings.css` | The selector draws a ring with token colors but no `animation`. | Add `animation: oc-spin var(--ui-duration-loop-agent-spin) linear infinite`. |
| `packages/overlay/src/styles/cascade/base.css` | Reduced-motion currently changes only `animation-duration: 2s`, which does not disable motion and is a literal duration. | Move the selector into the shared `animation: none !important` reduced-motion block. |
| `packages/overlay/test/browser/agent-models-panel.test.ts` | The page already has a real browser flow for Agent Models. | Add a loading-state browser case that holds `/agent`, observes the live spinner, screenshots it, and verifies reduced motion. |

## Implementation

- Reuse the existing `oc-spin` keyframes.
- Reuse `--ui-duration-loop-agent-spin`; no new motion token is needed because
  this is an agent settings loading state.
- Remove the literal `2s` reduced-motion residue.
- Extend static and browser tests so the next static ring regression fails.

## Acceptance

- Static motion guard requires `.agent-models-loading-spinner` to animate with
  `oc-spin var(--ui-duration-loop-agent-spin) linear infinite`.
- Static motion guard rejects the old reduced-motion `animation-duration: 2s`.
- Browser validation opens the real Agent Models panel while data is loading,
  verifies `animationName === "oc-spin"`, captures a screenshot, then verifies
  reduced motion disables the animation.
