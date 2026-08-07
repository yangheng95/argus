# Message Card Border Removal

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Make message-card borders much lighter or remove them when that produces the better result. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-d7708c77-831c-4814-91ec-4c8df11623b2.png` shows the stage-colored purple and orange outlines competing with message content. |
| Acceptance criteria | Top-level Agent messages have no visible outer border; the existing quiet role-tinted background, radius, spacing, identity, status, execution details, and actions remain unchanged; light and dark desktop screenshots remain legible and visually separated. |
| Hard constraints | Preserve `ChatBubble` and `--conversation-card-background` as the single renderer and color source. Do not add a second palette, shadow fallback, compatibility selector, mobile scope, or interaction change. Use an isolated Node-started Vite fixture and do not disturb the running OpenCorvus or Overlay process. Preserve all unrelated worktree changes. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot; `specs/records/2026-07/2026-07-15-agent-message-card-reference-surface.md`; `specs/records/2026-07/2026-07-24-agent-card-palette-and-running-tool-wave.md`; `ChatBubble.tsx`; `chat-bubble.css`; focused source and browser tests. |
| Whole-repository grep | `.chat-bubble-row[data-kind="agent"] .chat-bubble` in `chat-bubble.css` is the sole top-level Agent message surface owner. `chat-bubble.test.ts` and `overlay-architecture-guards.test.ts` directly assert its source contract; `agent-card-separation-browser.test.ts` is the real light/dark visual owner. `ChatBubble.tsx::articleStyle` remains the sole `--card-stage` projection and the 7% `--conversation-card-background` remains the only card fill. |
| Independent Agent feedback | None. The user did not request delegation and the active policy forbids unrequested sub-agents. |

## Root cause

The card already has a low-saturation 7% role-tinted background, but it also
mixes the same role color into a one-pixel border at 26%. On the white message
canvas that outline becomes the strongest boundary, especially for purple and
orange roles. The background alone already separates adjacent messages and
preserves role identity, so a weaker colored border would retain unnecessary
competing chrome.

## Implementation plan

1. Replace the Agent card's stage-colored border with a zero-width transparent
   border while preserving its background, radius, padding, and shadow-free
   surface.
2. Update the two direct source contracts and the real browser assertions to
   require borderless cards while continuing to prove distinct role-tinted
   backgrounds.
3. Run focused tests, Overlay typecheck/build, document health, and the isolated
   Node browser fixture. Inspect final light and dark screenshots and perform a
   second scoped diff review.

## Verification plan

```sh
bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/overlay-architecture-guards.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-card-separation-browser.test.ts
git diff --check
```

## Implementation and validation

- The canonical Agent surface now uses `border: 0 solid transparent`; its 7%
  stage-tinted background, large radius, padding, role projection, and
  shadow-free treatment are unchanged.
- Focused `ChatBubble` tests passed 6/6. The exact architecture guard passed
  1/1. Historical documentation health passed 22/22.
- Overlay TypeScript typecheck and production Vite build passed. The build's
  existing large-chunk advisory remains informational.
- The real Node-started Agent-card browser fixture passed and proved zero-width
  borders, distinct stage-tinted backgrounds, unchanged geometry, Tool
  disclosure behavior, and light/dark rendering.
- The full architecture-guard file still reports unrelated concurrent
  worktree failures involving Automations CSS registration, Settings/Memory
  ownership, Inspector/Goal work, Composer radius, and General Settings group
  counts. The task-owned borderless surface assertion passes.

## Visual review and second review

- `.scratch/agent-card-separation-light.png` was inspected at original
  resolution. Purple, cyan, and orange message cards remain clearly separated
  by their quiet fills and whitespace; the colored outline no longer competes
  with identity or narrative text.
- `.scratch/agent-card-separation-dark.png` was inspected at original
  resolution. Every card remains distinct from the dark canvas without an
  outline or added shadow, and adjacent role colors remain legible.
- The scoped diff changes only the sole Agent surface declaration and its direct
  source/browser contracts. No renderer, status source, interaction, palette,
  pseudo-element, compatibility path, or running application process changed.

## Correction: faint neutral outer edge

The user reviewed the borderless result and found that the card still needs a
light outer edge. The corrected direction keeps the role-tinted background but
adds one neutral token-backed hairline. The edge derives only from `--border`
at 64% of its already-subtle theme opacity; it does not consume `--card-stage`,
so purple, orange, and other role colors no longer produce colored outlines.

The shared worktree entered an unrelated merge while this correction was in
progress. Existing `chat-bubble.test.ts`,
`overlay-architecture-guards.test.ts`, and the Agent-card browser test contain
unresolved parallel conflict markers, so this correction does not select either
side of those conflicts. A focused non-conflicting source contract is added in
`message-card-edge.test.ts`, and visual acceptance uses the existing isolated
Agent-card Vite fixture directly.
