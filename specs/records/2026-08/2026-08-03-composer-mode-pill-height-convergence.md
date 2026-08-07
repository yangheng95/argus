# Composer Mode Pill Height Convergence

## Recall

### User requirement

- Make the `Code` and `Work` buttons the same height as the adjacent `Skill 与专家团` button.
- Preserve the existing width, spacing, icons, pressed state, and interaction behavior.

### Acceptance criteria

- The complete `Code | Work` segmented-control shell and the `Skill 与专家团` selector share `--oc-density-chip-height`.
- Both mode items remain vertically centered and fully contained inside the segmented shell.
- The real desktop Composer is rendered and inspected in an isolated page; no User Interface automation test is added, modified, or run.

### Hard constraints

- Reuse the existing density token and shared `SegmentedControl`; do not introduce a second height value or modify the global primitive.
- Preserve unrelated work and do not restart or refresh the user's running OpenCorvus / Overlay process.
- Commit subjects use the `dsw-33987` prefix and delivery is pushed to `myhexin`.

### Sources read

- User-provided screenshot `image.png`.
- `AGENTS.md` and `CLAUDE.md`.
- `specs/current/architecture/17-code-work-agent-platform.md`.
- `specs/records/2026-07/2026-07-29-code-work-composer-and-grouped-references.md`.
- `packages/overlay/src/components/ChatComposer.tsx`.
- `packages/overlay/src/components/ComposerReferenceSelector.tsx`.
- `packages/overlay/src/styles/primitives/{button,segmented-control}.css`.
- `packages/overlay/src/styles/surfaces/composer.css`.

### Whole-repository search

| Owner / call site                | Finding                                                                                                                                         | Disposition                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ChatComposer.tsx`               | The mode control uses the shared `SegmentedControl` with `size="sm"`; the reference selector is its adjacent peer.                              | Preserve component structure and behavior.                                                     |
| `ComposerReferenceSelector.tsx`  | The editable trigger uses the shared small `Button`.                                                                                            | Use its existing chip-height geometry as the target.                                           |
| `segmented-control.css`          | Small controls set the item minimum height to `--oc-density-chip-height`.                                                                       | Preserve the global primitive.                                                                 |
| `composer.css`                   | Composer adds `2px` vertical shell padding while each item retains the complete chip height, making the shell four pixels taller than its peer. | Bound the local shell to chip height and subtract its vertical padding from local item height. |
| Other `.oc-segmented` call sites | Automations, changes, and unrelated surfaces consume the shared primitive.                                                                      | Leave untouched.                                                                               |

### Independent review

- A session-local read-only reviewer was dispatched against the exact component and style files. It made no workspace changes and completed successfully.

## Implementation plan

1. Constrain the Composer-local mode shell to the canonical chip-height token with border-box sizing.
2. Set the two local mode items to the shell's content height after vertical padding.
3. Build and typecheck the Overlay, then render an isolated desktop page, inspect a screenshot, and correct any remaining mismatch.
4. Run documentation health, review the final diff, commit task-owned files, push to `myhexin`, and verify remote alignment.

## Progress

- [x] Inspect the screenshot, current design records, component structure, shared primitives, and all affected style call sites.
- [x] Implement the local height convergence.
- [x] Complete build and visual acceptance.
- [x] Complete second review, commit, push, and remote verification.

## Verification

- `bun run typecheck` passed in `packages/overlay`.
- `bun run build:vite` passed in `packages/overlay`; existing bundle-size and third-party `use client` warnings remain informational.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 2 tests, 0 failures.
- `git diff --check` passed.
- A Node.js-started headed Playwright browser rendered the isolated Vite page at a 1405 × 900 desktop viewport. The inspected screenshot is `.scratch/composer-mode-pill-height-convergence.png`.
- Rendered geometry showed the `Code | Work` shell and the adjacent Skill / Expert Squad selector at the same y-coordinate and the same 24px height. Each mode item was 20px high inside the shell's 2px vertical padding, with centered, unclipped icon and label content.
- The isolated Vite listener was stopped and port 4178 was verified free. The preview-only Task was cancelled after acceptance and retained as historical evidence.
- A final session-local read-only review completed successfully after the rendered geometry evidence was available and made no workspace changes.
