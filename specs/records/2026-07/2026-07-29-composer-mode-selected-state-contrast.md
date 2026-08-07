# Composer Code / Work selected-state contrast

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | “选中状态不明显，调整下”。The supplied light-theme crop shows the Composer `Code / Work` segmented control with `Code` selected, but the selected fill is almost indistinguishable from the group background.                                                                                                                                                                                                                                                              |
| Acceptance criteria        | Keep the existing Code / Work information architecture and Kobalte interaction semantics; make the active item immediately distinguishable through a coherent filled surface, accent text/icon, and visible boundary; preserve the compact pill geometry; manually inspect real rendered Code and Work states in the desktop light theme.                                                                                                                                  |
| Hard constraints           | Desktop-only; reuse the existing Kobalte `SegmentedControl`; no new UI test, UI-test edits, UI-test execution, handwritten interaction, fallback, second state source, temporary iframe, query override, or new worktree; use Node for browser control; preserve unrelated dirty `packages/opencorvus/src/skill/builtin-payload.ts`; commit subjects start with `dsw-33987`; push to `legacy-remote`.                                                                            |
| Read records               | `specs/records/2026-07/2026-07-29-code-work-composer-and-grouped-references.md` establishes the current two-option Composer surface and routing ownership. `specs/records/2026-07/2026-07-29-ui-automated-test-prohibition.md` requires real-page interaction and inspected screenshots instead of automated UI assertions.                                                                                                                                                |
| Baseline visual evidence   | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-1456c540-8168-488d-b570-a91c53f8c73f.png`: the outer group and selected `Code` item both read as pale neutral surfaces, so the active state depends on a very small luminance difference.                                                                                                                                                                                                                               |
| Whole-repository grep      | `rg` found the active control only in `ChatComposer.tsx` and its scoped rules only in `styles/surfaces/composer.css`. The shared Kobalte primitive is `components/ui/SegmentedControl.tsx` with the global visual contract in `styles/primitives/segmented-control.css`. Other consumers are `FileChangesView.tsx` and `settings/PermissionsPanel.tsx`; they must remain unchanged. Existing specialized selected-state rules also exist in `styles/surfaces/changes.css`. |
| Independent agent feedback | None. The user did not request independent or parallel agents, so this localized repair remains in the primary worktree and primary agent.                                                                                                                                                                                                                                                                                                                                 |

## Root cause

The global selected item uses `background: var(--surface-inset)`. The Composer wrapper independently paints its entire Kobalte group with a translucent `surface-inset`. In the supplied light theme, those two related fills visually collapse into one surface. The selected value and state are already correct; the defect is the Composer-local visual projection, not routing, state, or primitive semantics.

## Call-site disposition

| Surface                                                                      | Decision                                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatComposer.tsx`                                                           | Preserve the existing `composerSurfaceMode`, `onActivate`, icon, label, and Kobalte ownership.                                                           |
| `styles/surfaces/composer.css`                                               | Add the one Composer-scoped selected-state contract. Use existing accent/surface tokens for fill, boundary, foreground, and a restrained inset emphasis. |
| `SegmentedControl.tsx` and `styles/primitives/segmented-control.css`         | Preserve. Changing the shared selected state would alter unrelated Settings and file-change controls.                                                    |
| `FileChangesView.tsx`, `PermissionsPanel.tsx`, `styles/surfaces/changes.css` | Preserve. These are sibling consumers, not call sites for the Composer-specific defect.                                                                  |

## Implementation and verification

1. Add a `composer-mode-toggle`-scoped `[data-pressed]` rule that creates a clearly filled accent-tinted active item with accent-forward text/icon color, a visible tokenized border, and restrained inset emphasis.
2. Run formatting/diff checks, Overlay typecheck, Vite production build, and required documentation-health checks. Do not run UI tests.
3. Start an isolated real Vite page, interact with both Code and Work through browser control, capture task-scoped screenshots, and personally inspect them. If either state remains ambiguous, tune and repeat.
4. Re-read the diff and screenshots as the required second review, then commit and push only the task-owned files to `legacy-remote`.

## Progress

- [x] Recorded the user requirement, prior decisions, constraints, exhaustive call sites, and baseline screenshot.
- [x] Added the Composer-local selected-state contrast without changing shared component semantics.
- [x] Passed Overlay typecheck, Vite build, historical documentation health, formatting, and diff checks.
- [x] Interacted with and personally inspected the real light-theme Code and Work states, including a close crop of the Work selection.
- [x] Complete the final diff review, task-owned commit, push, and remote convergence check.

## Verification

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed; only the repository's existing large-chunk advisory was emitted.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 22 passed, 0 failed.
- Node-started isolated Vite at `http://127.0.0.1:5197/`: the initial real-page screenshot showed Code as a distinct accent-tinted selected pill; clicking the visible Work control transferred the same fill, foreground, and boundary without layout shift or double selection; a close crop confirmed the active boundary remains legible against the neutral outer track.
- No UI automated test was added, modified, updated, or run.
