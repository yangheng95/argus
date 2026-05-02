# Overlay Message Card Redesign

Status: proposal awaiting user direction selection.
Trigger: user feedback (2026-05-03) "我觉得现在的消息卡片不好看，样式也不现代化".

## Why

After 30 iters of calm/flat trajectory shipped to shell containers
(titlebar / sidebar / chat / sections / chat-input / chat-textarea /
chat-icon-col / right-panel-tabs / button family / typography
hierarchy / empty states), the message-card surface still carries the
pre-flat skeumorphic chrome it shipped with. Three concrete defects
identified by direct read of `card.css` (1994 lines) +
`Card.tsx` (348 lines) + `CardHeader.tsx` (544 lines) +
`CardParts.tsx` (116 lines):

1. **Heavy multi-layer shadow on depth-0 cards**:
   `box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 22px rgba(0,0,0,0.12)`
   — paired highlight + drop shadow is classic skeumorphic, the same
   pattern iter15 / iter16 / iter17 collapsed away from the shell
   containers.

2. **Radius 8px**: `--card-radius: calc(8px * --ui-scale)`. Modern
   chat surfaces (ChatGPT, Claude.ai, Linear, Notion) use 12-16px so
   the corners read friendly instead of edged. The shell containers
   went to radius 0 in iter15 / iter17 because they're full-bleed
   panels, but cards are floating elements where rounded corners
   communicate "discrete content unit".

3. **`--card-stage-*` palette (14 named colors)**: `--card-stage-user`,
   `--card-stage-assistant`, `--card-stage-orchestrator`,
   `--card-stage-spec`, `--card-stage-requirements`, `--card-stage-design-analyst`,
   `--card-stage-architect`, `--card-stage-planner`, `--card-stage-goal`,
   `--card-stage-executor`, `--card-stage-build`, `--card-stage-evaluator`,
   `--card-stage-delivery`, `--card-stage-tool`. 14 hue-distinct accent
   colors are over-specified — every agent gets its own brand color.
   Modern systems collapse this to 3-4 semantic tones (info / success /
   warn / danger) and use **typography + position + iconography** to
   express role identity.

## Three directions

The user has not yet picked. The `Card.tsx` + `CardHeader.tsx` markup
already supports `[data-kind] [data-role] [data-stage] [data-depth]` —
the data attributes don't change between options. Only `card.css`
(plus a few CardHeader.tsx tweaks for option C) changes.

### Direction A — ChatGPT-style flat

The natural extension of the calm/flat trajectory.

- Message bubble (`[data-kind="message"][data-role="user"]`): no
  border / no shadow, `var(--accent-dim)` tinted bg, right-aligned,
  `radius: 16px`.
- Message bubble assistant: no border / no shadow,
  `var(--surface-inset)` bg, left-aligned, `radius: 16px`.
- Agent stage / tool / goal step card (`[data-kind="agent"|"phase"|"step"|"tool"]`):
  no border + 2px left rail in `var(--accent)` (replaces every
  per-stage accent color), `radius: 12px`.
- Drop the entire `--card-stage-*` palette. Map each former stage
  color to one of: `var(--accent)` (default), `var(--good)`
  (delivery / accepted), `var(--warn)` (requirements / pending),
  `var(--bad)` (rejected / error). 14 → 4.
- Drop the `[data-depth="0"] box-shadow` (highlight + drop shadow).
- Drop the `transition` chrome — there's no chrome to transition.

Pros: fewest moving parts; consistent with iter15/16/17/18/19/20/22.
Cons: less visual identity per agent (recovered via icon + label).

### Direction B — Linear-style chrome-light

Keep the card chrome but flatten it.

- All cards: 1px `var(--card-border)` border + no shadow + radius 12px.
- Hover: 1px left rail in `var(--accent)` slides in (translateX
  animation). Cleaner than always-on rail.
- `--card-stage-*` palette folded to `var(--text-muted)` — agents
  identified by typography (header label) + icon, not color.
- Background stays `var(--card-bg-0)`.

Pros: keeps "discrete content unit" feel via 1px border. Cons: 1px
border + radius 12px is a more conservative move than the calm/flat
trajectory the rest of the overlay took; some inconsistency.

### Direction C — Notion-style document flow

Largest change. Message bubble loses card chrome entirely.

- Message bubble: no chrome at all. `max-width: 720px`, centered,
  `padding: 16px 0`. Avatar (24px) + agent name + timestamp at top
  of each bubble (CardHeader rewrite).
- Agent stage / tool / goal step card: stays as 1px-border card
  (radius 12px, no shadow) — these are NOT messages, they're
  structured artefacts and benefit from card chrome.
- `--card-stage-*` palette folded to 4 semantic tones (same as A).

Pros: most "documentary", reads like long-form thread. Cons: rewrites
CardHeader layout (Avatar slot is new); doubles the surface
identities (cards vs bubbles), which complicates the iter21 single-
source design language doc.

## Recommended

**Direction A**.

- Single source for all cards (one chrome treatment for the whole
  Card primitive).
- Continues the calm/flat trajectory iter15-30 already shipped — no
  back-step.
- Removes the over-specified 14-color stage palette (which is one of
  the visible "noise" sources the user flagged).
- Smallest blast radius — only `card.css` changes; no JSX rewrites
  in CardHeader / CardParts / Card.

## Acceptance criteria (any direction)

1. **Single-source `.card` primitive**: one solo top-level `.card { … }`
   rule, no `!important` resets fighting it. Same iter21 5-prefix
   grep applied (solo / pseudo / theme / multi-selector partner /
   @media).
2. **`--card-stage-*` palette purge**: per-stage color tokens removed
   from `:root` and any `[data-stage]` selector resolved to one of
   `var(--accent) / var(--good) / var(--warn) / var(--bad)`.
3. **Regression test** in `packages/overlay/test/`: parses
   `card.css`, asserts (a) no `box-shadow` declarations on
   `.card[data-depth="0"]`, (b) `--card-radius` ≥ 12px on whichever
   tier the picked direction sets, (c) the 14-color stage palette
   is gone.
4. **Visual e2e**: agent-models-panel puppeteer e2e green
   (mounts the real overlay UI; build-time CSS errors fail; existing
   test does not exercise card rendering directly but the CSS parse
   is exercised on every overlay render).
5. **No `!important` in the canonical card body** (rule 8 enforcement).

## Out of scope

- Avatar / agent-name header layout changes (only direction C).
- Markdown body typography (`.md-content`).
- Tool call inline rendering (`.msg-tool` / `.msg-tool-output`) —
  those are content surfaces, not card chrome.

## Implementation order (any direction)

1. Branch off `codex/opencode-upstream-infra-adapt` (current).
2. Rewrite `packages/overlay/src/styles/card.css` per the picked
   direction.
3. Update `:root` palette in `card.css` (drop `--card-stage-*`
   entries that go away; keep semantic ones).
4. Add regression test.
5. Run `agent-models-panel.test.ts` puppeteer e2e + i18n check
   pre-push.
6. Commit + push.

## Reference

- iter15-30 calm/flat trajectory: see
  `docs/overlay-design-language-tier-hierarchy-2026-05-02.md` plus
  the 5-prefix folding checklist for single-source discipline.
- Card primitive structure: `Card.tsx` (recursive, depth-aware,
  driven by `[data-kind][data-role][data-stage][data-depth]`).
- The data-attribute contract is preserved across all three
  directions — no JSX changes to `Card.tsx`.
