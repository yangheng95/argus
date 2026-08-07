# Delegated Context Prominence

## Recall

- User request: delegated context is operationally important, but the current rendering suppresses its visual priority too aggressively.
- Acceptance criteria:
  - keep delegated context collapsed by default so long scheduler briefs do not dominate the transcript;
  - make the collapsed control visibly distinct from low-priority Tools activity;
  - preserve exact message ownership, chronology, disclosure behavior, and keyboard accessibility;
  - inspect real rendered light-theme output at desktop width and correct visual defects before delivery.
- Hard constraints:
  - reuse the shared `Button` and `Icon` primitives and existing design tokens;
  - do not create a second context source, alter `tree-writer` classification, or persist component-local disclosure state;
  - do not restart or refresh the user's running OpenCorvus or Overlay process;
  - run Playwright with Node, not Bun.
- Read records and architecture:
  - `specs/current/architecture/07-panel-reactivity.md`;
  - `specs/current/architecture/12-overlay-card-system.md`;
  - `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`;
  - `specs/records/2026-07/2026-07-24-agent-card-palette-and-running-tool-wave.md`.
- Whole-repository grep:
  - `CardParts.tsx` is the only delegated-context component owner;
  - `messages.css` owns every `msg-delegated-context` rule;
  - `tree-writer.ts` and `message-origin.ts` own classification and remain unchanged;
  - `delegated-context-disclosure-alignment.test.ts` owns the static visual contract;
  - `message-card-chronological-turns-browser.test.ts` owns disclosure interaction, English/Chinese output, computed geometry, and screenshots;
  - the locale keys already exist and do not require a second label source.
- Independent agent feedback: none; the user did not request delegated or parallel agent work.
- Git evidence before implementation:
  - the branch was one commit ahead of `legacy-remote/v0.0.17beta`;
  - the required pre-push hook entered the real full-repository typecheck and failed on 13 pre-existing Fact Check refactor errors outside this change;
  - no hook bypass or additional worktree was used.

## Root cause

The context message is correctly classified and kept chronologically truthful, but
`DelegatedContextParts` deliberately reuses the exact ghost
`data-chrome="text-disclosure"` recipe used by ordinary Tools activity. That recipe
sets muted body-weight text, a transparent surface, and color-only hover feedback.
The result is not merely low contrast: it communicates the wrong semantic rank by
making the agent's execution brief look equivalent to optional activity telemetry.

## Call-point decisions

| Call point | Decision |
| --- | --- |
| `CardParts.tsx::DelegatedContextParts` | Replace the shared muted text-disclosure presentation with an outline accent `Button`, a canonical branch/context glyph, strong label, and trailing disclosure chevron. Keep `useDisclosure(false)` and the existing parts unchanged. |
| `messages.css::.msg-delegated-context*` | Give the primitive a full-row footprint and let its own outline/surface distinguish the brief; keep expanded content inset under the same accent hierarchy. |
| `tree-writer.ts` delegated-context classification | Preserve; it is the single data-source boundary and is not the cause. |
| `message-origin.ts` delegated-context classification | Preserve; origin semantics are correct. |
| `delegated-context-disclosure-alignment.test.ts` | Replace the obsolete shared-muted-chrome assertions with the important-context primitive contract. |
| `message-card-chronological-turns-browser.test.ts` | Preserve collapse/expand and locale assertions; replace equality-to-Tools geometry with computed prominence and full-row assertions. |

## Implementation

1. Render the collapsed context control with the shared outline/accent Button and
   registered `git-branch` plus chevron icons.
2. Make the label strong and the control span the available transcript width while
   retaining the existing compact density.
3. Keep the expanded body visually attached through an accent inset, without
   changing content ownership or introducing a new container component.
4. Update static and browser regressions.

## Verification

- `bun test packages/overlay/test/delegated-context-disclosure-alignment.test.ts`
- `bun test packages/overlay/test/tree-writer-hierarchy.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts`
- personally inspect the generated delegated-context screenshots
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- second review of the exact diff and rendered evidence

## Result

- Static delegated-context and tree-writer regressions passed: 60 tests.
- Overlay TypeScript passed.
- The production Vite build passed with 4,952 modules transformed.
- The Node Playwright chronology test passed after its test-owned fixture was
  brought up to the current Mission Skill catalog and reasoning-retirement
  contracts. No browser error check was weakened.
- Current desktop screenshots were generated and personally reviewed:
  - `.scratch/message-card-chronological-turns-browser/delegated-context-collapsed.png`;
  - `.scratch/message-card-chronological-turns-browser/delegated-context.png`;
  - `.scratch/message-card-chronological-turns-browser/delegated-context-zh.png`.
- Collapsed, expanded, and Chinese states preserve card chronology and provide a
  visibly stronger hierarchy than the remaining Tools disclosure without clipping
  or overlap.
