# Multica Question Human-Readable Option Title Repair

## Recall

| Item                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | In the Multica Squad selection dialog, use each Squad name as the option title. Do not expose the internal Squad ID as the title because users do not know what the ID means.                                                                                                                                                                                                                                                                                               |
| Acceptance criteria        | Every Multica catalog row remains present; the visible option `label` is the exact Squad `name`; the submitted option `value` remains the exact Squad UUID (Universally Unique Identifier, a stable machine identity); installed rows remain visible and disabled; uninstalled rows remain selectable; the browser fixture proves names on screen and exact UUIDs in the reply payload.                                                                                     |
| Hard constraints           | Preserve `Question.Option` and `InteractionCard` as the canonical `{ value, label, description, disabled }` contract and renderer; do not add UUID detection, display fallback, compatibility logic, a second dialog, a second selection store, a gate, a hidden message, or a mobile/tablet scope. Do not restart or refresh the user's running OpenCorvus/Overlay process. Browser verification must use Node, not Bun. Preserve all pre-existing dirty worktree changes. |
| Supplied evidence          | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-bed1e818-73e9-4622-864b-4f8f316882e7.png`, inspected at original resolution, shows two selected options whose large titles are UUIDs while `名称` is buried in their descriptions.                                                                                                                                                                                                                                       |
| Sources read               | `AGENTS.md`; browser-control Skill; `specs/current/architecture/04-extensions.md`; the 2026-07-15 Mission multi-Squad record; the 2026-07-16 five-surface repair record; the 2026-07-19 installed-catalog visibility and complete-roster records; `question/index.ts`; `InteractionCard.tsx`; the Multica import Skill/tool/adapter; Work Ledger launcher locale requests; focused source and browser tests.                                                                |
| Git baseline               | Work began on branch `work-v0.0.11beta-yr-0720` at `3bfa7aba1`. Concurrent work advanced the shared branch to `13ffc20c7` during verification; those commits and all unrelated dirty Mailbox, Goal, Overlay, and documentation changes are preserved and excluded from this change's commit.                                                                                                                                                                                        |
| Independent agent feedback | None. The user did not request delegation, so the primary agent owns implementation, visual review, and second diff review.                                                                                                                                                                                                                                                                                                                                                 |

## Whole-repository search evidence

- `rg` covered `Question.Option`, every production `Question.ask` / `askAndFormat` call, `InteractionCard`, standalone question projection, Mission `panel.multica_catalog`, General `multica_catalog`, the Multica Skill, both locale launcher requests, generated Skill payload, source tests, browser fixtures, current architecture, and July records.
- `Question.Option` already separates `value` (stable returned identity) from `label` (display text). `InteractionCard` renders `opt.label`, stores `opt.value`, and submits exact values. `Question.askAndFormat` maps the returned value back to the human label. Those owners are correct and remain unchanged.
- The built-in `multica-import` Skill already requires `label` to equal the exact Squad name and `value` to equal the exact Squad ID. The General `multica_catalog` output exposes both fields without conflating them.
- The only live Work Ledger launcher source is `packages/overlay/src/main.tsx`, which forwards `multica_import.mission_request`; the English and Chinese locale entries are therefore the direct Mission instruction source.
- Both locale entries explicitly require the exact Squad UUID as both option `label` and `value`. `packages/overlay/test/multica-import-surface.test.ts`, `packages/overlay/test/browser/multica-import-browser.test.ts`, and `specs/current/architecture/04-extensions.md` preserve the same stale UUID-title expectation.
- `git history` shows that the 2026-07-16 canonical Question repair changed the shared value/label contract, the Multica Skill, and its browser fixture, but did not change the launcher locale instruction. Commit `1c21f8def` (`dsw-33987 show every Multica squad during import`) later preserved the stale UUID-label launcher wording and changed the browser fixture back to UUID titles while adding installed-row visibility, despite retaining the correct name/value rule in the Multica Skill.

## Causal chain

Observable symptom: the dialog shows opaque UUIDs as the large titles and human-readable Squad names inside the smaller descriptions.

Direct trigger: the Mission launcher request tells the model to use the exact Squad UUID as both `option.label` and `option.value`, so the model submits exactly that payload to the canonical `question` tool.

Deeper cause: the 2026-07-16 repair updated the canonical Question contract but omitted its most immediate producer, the launcher locale instruction. The 2026-07-19 installed-row visibility change then reinforced that stale pre-`value` assumption in the launcher prompt, browser fixture, and current architecture without reconciling the already-correct Question contract or Multica Skill. The runtime therefore has two contradictory natural-language instructions, and the task-root launcher instruction wins.

Why the previous path did not remain fixed: the earlier repair correctly separated display label and stable value in shared code, but it left the launcher prompt unchanged. The later acceptance test explicitly asserted only the generic phrase “exact Squad UUID” and the browser fixture asserted UUID titles; neither rejected “UUID as label and value,” so the contradictory producer survived and became expected behavior again.

## Call-point disposition

| Call point                                                                                                  | Disposition                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/i18n/en-US.json`                                                                      | Replace the exact Mission instruction with `label = exact Squad name`, `value = exact Squad UUID`; keep installed status, disabled rows, parallel task creation, and complete roster evidence. |
| `packages/overlay/src/i18n/zh-CN.json`                                                                      | Apply the identical contract in Chinese.                                                                                                                                                       |
| `packages/overlay/test/multica-import-surface.test.ts`                                                      | Assert both human-readable label and exact-ID value semantics, and explicitly reject UUID-as-label wording.                                                                                    |
| `packages/overlay/test/browser/multica-import-browser.test.ts`                                              | Render Squad names as visible option titles, preserve UUID values, select available rows, capture the dialog, and assert the reply payload contains exact UUIDs rather than names.             |
| `specs/current/architecture/04-extensions.md`                                                               | State the current single contract: name labels, UUID values, disabled installed rows.                                                                                                          |
| `packages/opencorvus/src/question/index.ts`, `packages/overlay/src/components/InteractionCard.tsx`          | Retain unchanged; they already implement the single correct label/value separation.                                                                                                            |
| `packages/opencorvus/src/skill/builtin/multica-import.md`, generated payload, and `multica-import-tools.ts` | Retain unchanged; the Skill and catalog output already provide the correct instruction/data.                                                                                                   |

## Implementation and verification plan

1. Update the two launcher locale requests and focused source assertions atomically.
2. Update the existing Node/Playwright Multica fixture to show name titles while retaining exact UUID values and reply-payload evidence; do not create another fixture or dialog.
3. Update current architecture and documentation indexes without overwriting the existing folder-picker entries.
4. Run the focused Overlay source test, i18n check, Overlay typecheck/build, and Node-launched Multica browser fixture.
5. Inspect the fresh task-scoped question screenshot at original resolution. If titles are not names or any option state is visually wrong, correct and rerun.
6. Run historical-link/document-health tests and `git diff --check`, perform a second complete diff review, commit only this task's files with the `dsw-33987` prefix, and push `myhexin`.

## Verification result

- Focused Multica launcher, canonical Question, and built-in Multica Skill tests: passed, 21/21.
- Overlay i18n check and package TypeScript check: passed.
- Overlay production Vite build: passed.
- Node-launched `multica-import-browser.test.ts`: passed, 1/1. The fixture rendered exact Squad names, kept installed rows disabled, selected the two available rows, and asserted that the reply body contained their two exact UUID values rather than display names.
- Fresh `.scratch/multica-squad-multi-select.png` was inspected at original resolution. The visible titles are `Research Squad`, `Delivery Squad`, `Verification Squad`, `Frontend Squad`, and `Agent Squad`; no UUID appears as a title; disabled and selected states are visually distinct and correctly aligned.
- Repository-wide typecheck: passed across 9 packages. `api:routes-check` and `docs:check`: passed.
- Historical links and product-doc single-source checks passed. After this Multica record was precisely staged, document health passed 86/87; its only failure names two unrelated concurrently authored, still-untracked records (`left-sidebar-mailbox-mark-all-read` and `goal-status-color-semantics`) already linked by their owners in the shared monthly index. No Multica file or link appears in the offender list.
- `git diff --check`: passed.
