# Composer Control and Menu Alignment

Date: 2026-08-06

## Recall

| Item                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Make the Work and Chat dropdown triggers match the Expert Squad and model controls; prefer borderless resting controls with a hover background; hide the visible `Skill 与专家团` trigger text; simplify the Work/Chat menus to icon plus name and reveal descriptions on hover; align every icon and text baseline.                                                                                                                                                                                        |
| Acceptance criteria        | The four Composer controls share one borderless 32px interaction height, typography tier, spacing rhythm, and hover/focus wash. The editable Skill/Expert Squad trigger is icon-only while retaining an accessible name and selected-count signal. Work and Chat menus show one compact icon/name row per option; the existing descriptions appear in the mature Tooltip surface on hover/focus. Real desktop-page screenshots confirm resting controls, hover states, both menus, and icon/text alignment. |
| Hard constraints           | Desktop-only. Reuse the existing Kobalte-backed `SelectControl`, `Tooltip`, `Popover`, shared `Button`, and `Icon` primitives. Do not add a second menu implementation, fallback, UI automation test, fixture, screenshot baseline, temporary iframe, or synthetic interaction. Do not restart or refresh the user's running OpenCorvus/Overlay process. Preserve all concurrent database, generated SDK, Expert Squad, and architecture-document changes.                                                  |
| Supplied evidence          | The first screenshot marks the four Composer controls and shows the current mixed border treatment. The second screenshot marks the current two-line Chat/Mission menu row and requests icon/name-only rows with descriptions moved to hover.                                                                                                                                                                                                                                                               |
| Sources read               | `AGENTS.md`; `CLAUDE.md`; the two supplied screenshots; `specs/records/2026-07/2026-07-16-overlay-worktree-shortcuts-chat-files-and-button-system.md`; `specs/records/2026-07/2026-07-29-work-harness-chat-mission-infrastructure-convergence.md`; `ChatComposer.tsx`; `ComposerReferenceSelector.tsx`; `ComposerModelSelector.tsx`; `SelectControl.tsx`; `composer.css`; `select-control.css`; and `button.css`.                                                                                           |
| Whole-repository search    | The localized option descriptions are consumed only by `ChatComposer`. The editable reference-trigger text is rendered only by `ComposerReferenceSelector`. The Composer select variant is owned only by `SelectControl` plus `select-control.css`. Composer-local intent geometry is owned by `composer.css`; model and reference trigger geometry have one owner each in the same stylesheet. No sibling production renderer exists.                                                                      |
| Independent agent feedback | Two delegated read-only review sessions reached terminal success, but the parent tool result exposed only their Session and final-message identities rather than review text. Their unseen conclusions are not treated as evidence. The parent therefore completed a separate full diff review and found no blocking issue.                                                                                                                                                                                 |
| Git baseline               | The current branch is `work-v0.0.33beta-yr-0806`. `git push legacy-remote work-v0.0.33beta-yr-0806` completed its full pre-push checks and reported `Everything up-to-date`. Concurrent unrelated changes remain unstaged and must not enter this task's commits.                                                                                                                                                                                                                                                 |

## Root cause and call-site disposition

The four controls already use mature primitives, but the Composer-specific styling splits their visual contract. The Select trigger explicitly suppresses its hover background, while the reference and model wrappers paint a border around otherwise borderless child buttons. The menu renderer embeds descriptions as a permanent second line even though `SelectControl` already exposes a Tooltip slot. These three divergent presentation decisions also give the controls different width, vertical alignment, and perceived weight.

| Owner / call site                            | Decision                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatComposer.renderIntentValue`             | Keep icon plus selected name in the closed Work/Chat controls and give both glyph and label one aligned compact layout.                                                                                                                                                     |
| `ChatComposer.renderIntentOption`            | Render only icon plus name in the menu row. Do not retain description copy in the row.                                                                                                                                                                                      |
| Work and Chat `SelectControl` calls          | Feed each option description through the existing `renderOptionTooltip` contract.                                                                                                                                                                                           |
| `ComposerReferenceSelector` editable trigger | Keep the accessible title/label, icon, and selected count; remove the visible label and use icon sizing consistently. Read-only active Expert Squad identity remains visible because it communicates persisted conversation context rather than an editable catalog action. |
| `select-control.css` Composer variant        | Give the closed trigger the shared 32px height, borderless resting surface, pill radius, compact horizontal padding, and hover/focus wash. Make menu options a single aligned row.                                                                                          |
| `composer.css` local controls                | Remove wrapper borders, remove obsolete two-line menu-copy styles, eliminate fixed intent minimum widths, and converge reference/model trigger geometry with the Select trigger.                                                                                            |
| UI acceptance                                | Use an isolated real Overlay page, interact with the actual controls, capture screenshots for rest, hover, and open-menu states, and inspect them manually. No UI test is added or run.                                                                                     |

## Implementation and verification plan

1. Move option descriptions from permanent menu copy into `SelectControl` Tooltip content.
2. Hide the editable reference-trigger label while preserving accessible naming and selection count.
3. Converge Composer Select, reference, and model controls on one borderless pill geometry and hover wash.
4. Run Overlay TypeScript, internationalization, build, documentation health, and diff checks without running UI tests.
5. Start an isolated real page, inspect desktop screenshots for resting, hover, and open-menu states, correct visible alignment defects, then request an independent read-only diff review.
6. Commit only task-owned hunks with the `dsw-33987` prefix and push the delivery branch to `legacy-remote`.

## Scope refinement from visual review

The operator's follow-up screenshot confirms that icon/name-only content is necessary but not sufficient: the Work/Chat popup must also use the Composer model popup's list treatment. The implementation therefore promotes the model option's 20px icon tile and label into shared Composer picker classes, and gives the Composer Select listbox the same inset group border, elevated wash, 34px row rhythm, compact gap, and trailing selected indicator geometry. This is a style convergence inside the existing `SelectControl`, not a second popup implementation.

## Progress

- [x] Read supplied screenshots, relevant architecture/history, implementation, primitives, and complete call-site inventory.
- [x] Commit and push the implementation plan without absorbing concurrent work.
- [x] Implement control and menu convergence, including the follow-up model-list visual treatment.
- [x] Complete static verification and real-page visual review.
- [x] Complete second diff review and task-only commit/push preparation.

## Visual and verification evidence

- The isolated real Overlay loaded at `http://127.0.0.1:5173` without console errors and exposed all four real Composer controls. The service was stopped by its exact port after review, and the port was verified closed.
- `composer-controls-final-rest.png` and `composer-controls-final-reference-hover.png` show the four borderless controls and the Skill/Expert Squad icon-only hover wash.
- `composer-controls-reviewed-final.png` shows the final Work menu with the shared model-list icon tile, inset group surface, compact 34px rows, selected indicator, and the description Tooltip triggered from the hovered row.
- Measured real-page trigger heights are all 24px under the active density token. Work and Chat text boxes are both 14px high; their 12px glyphs share the same vertical coordinate, while the icon-only reference trigger differs by only the expected 0.5px SVG centering caused by odd/even box geometry.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `bun run --cwd packages/overlay check:i18n`.
- PASS: `bun run --cwd packages/overlay build`; only existing third-party module-directive and large-chunk warnings remain.
- PASS: `bun run docs:check` and `git diff --check`.
- The historical-document test command recorded in `AGENTS.md` no longer resolves because the named test file is absent from the current repository. A repository search found those retired test names only in a historical audit record; no missing test was represented as passing.
