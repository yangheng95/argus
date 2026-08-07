# Expert Squad Icon Semantics

## Recall

### User request

- Replace the two highlighted Expert Squads catalog icons because the current glyph is visually unattractive and communicates the wrong meaning.

### Acceptance criteria

- The catalog heading and an individual squad row no longer render the brain/circuit glyph.
- The catalog heading communicates a collection of expert squads, while the row communicates one collaborating team.
- Both glyphs come from the existing `lucide-solid` family and the shared `Icon` registry; no inline or custom SVG is added.
- Existing 44px circular containers, semantic size tiers, layout, selection behavior, and expert-squad data flow remain unchanged.
- Source regressions pin the two distinct semantic names and their Lucide components.
- The current Details page is rendered at desktop size, captured to a task-scoped screenshot, and visually reviewed for recognizability, optical balance, clipping, and alignment.

### Hard constraints

- Desktop-only scope; no tablet, mobile, or responsive expansion.
- Preserve `ExpertSquadPanel` as the single Details-page owner and `Icon.tsx` as the single icon rendering/registry owner.
- Reuse the mature Lucide icon system already installed by the Overlay package.
- Do not add a second icon source, inline SVG, raw character icon, feature-owned geometry, fallback, compatibility alias, or duplicate-glyph semantic.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process. Rendered validation uses an isolated local page/browser fixture.
- Preserve unrelated dirty documentation work and stage only this task's changes.
- Commit subjects use the required `dsw-33987` prefix and push to `legacy-remote`.

### Sources read

- User screenshot: `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f15a95f5-2aa6-4ac2-b916-ed55e20350ba.png`.
- `packages/overlay/src/components/Icon.tsx`.
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`.
- `packages/overlay/src/components/WorkLedger.tsx`.
- `packages/overlay/src/components/ComposerMentionMenu.tsx`.
- `packages/overlay/src/styles/surfaces/settings.css`.
- `packages/overlay/test/flat-redesign-icon-coverage.test.ts`.
- `packages/overlay/test/config-panel-sizing.test.ts`.
- `packages/overlay/test/browser/expert-squad-panel.test.ts`.
- `specs/records/2026-07/2026-07-15-codex-settings-multica-expert-squad-unification.md`.
- `specs/records/2026-07/2026-07-16-expert-squad-settings-capability-redesign.md`.
- The icon registry findings and canonical Icon implementation sections of `specs/records/2026-07/2026-07-17-overlay-primitive-system-convergence.md`.
- Official Lucide metadata: `https://lucide.dev/icons/boxes` describes `Boxes` as a collection/cluster, and `https://lucide.dev/icons/users-round` describes `UsersRound` as a group of people; both document `lucide-solid` exports.

### Whole-repository search evidence

| Owner / call site | Current evidence | Decision |
| --- | --- | --- |
| `Icon.tsx` | The canonical `expert-squad` semantic maps to `BrainCircuit`; no `Boxes` or `UsersRound` registration exists. | Replace `expert-squad` with `UsersRound` and add the distinct `expert-squad-catalog` semantic backed by `Boxes`; remove the now-unused `BrainCircuit` import. |
| `ExpertSquadPanel.tsx` catalog heading | The heading uses `expert-squad`, conflating a catalog/collection with a member row. | Use `expert-squad-catalog` only in the heading. |
| `ExpertSquadPanel.tsx` squad rows | Every concrete squad row uses `expert-squad`. | Retain the semantic name but change its canonical glyph to `UsersRound`, which represents one team. |
| `WorkLedger.tsx` Expert Squads navigation | Uses the shared `expert-squad` semantic. | Retain the call site; the new team glyph is also correct for navigation. |
| `ComposerMentionMenu.tsx` expert-squad mentions | Uses the shared `expert-squad` semantic dynamically. | Retain the call site; the new team glyph is also correct for squad mentions. |
| `settings.css` circular containers | The heading and row share one 44px geometry/color recipe and do not author SVG size or stroke. | Retain unchanged; only the registered glyphs change. |
| `config-panel-sizing.test.ts` | Explicitly requires both heading and row to use `expert-squad`. | Replace the heading expectation with `expert-squad-catalog`, retain the row expectation, and assert the two names remain distinct. |
| `flat-redesign-icon-coverage.test.ts` | Enforces one Lucide component per canonical semantic but does not pin this requested semantic correction. | Add a focused mapping regression for `Boxes`/`UsersRound` and the retirement of `BrainCircuit`. |
| `expert-squad-panel.test.ts` | Exercises and screenshots the real Details catalog layout and counts each row icon. | Reuse the Node-launched browser path for rendered acceptance; no duplicate browser fixture is needed. |

### Independent agent feedback

- None. The user did not request sub-agents or parallel audit; this is one tightly coupled icon-registry and visual-acceptance change.

## Root cause

The page uses one canonical semantic name for two levels of information hierarchy, and that semantic is mapped to `BrainCircuit`. A brain/circuit implies cognition or an AI model, not a catalog of teams or the people collaborating inside one team. Because both highlighted slots reuse the same registration, the visual repetition also erases the distinction between “the collection” and “one member of the collection.”

## Implementation plan

1. Add `expert-squad-catalog` → `Boxes` and replace `expert-squad` → `UsersRound` in the canonical registry, removing `BrainCircuit`.
2. Change only the catalog-heading call site to `expert-squad-catalog`; leave concrete squad/navigation/mention call sites on `expert-squad`.
3. Update the registry and Settings source regressions before implementation verification.
4. Run focused unit tests, Overlay type checking, the Node-launched Expert Squad browser suite, documentation-health checks, and `git diff --check`.
5. Inspect a current desktop screenshot at original resolution, correct any optical or alignment issue, then perform a second diff review before commit and push.

## Result

- Implemented `expert-squad-catalog` with Lucide `Boxes`, representing the collection of available squads.
- Replaced the canonical `expert-squad` glyph with Lucide `UsersRound`, representing one collaborating team across squad rows, Work Ledger navigation, and composer mentions.
- Removed `BrainCircuit`; the registry retains one component per canonical semantic and no feature-owned SVG or geometry was introduced.
- Updated focused source regressions to pin both mappings and the distinct heading/row call sites. The initial RED run failed exactly on the old shared semantic; the implementation run passed 40 tests with 373 expectations.
- The Node-launched Expert Squad browser suite rebuilt and rendered the current Overlay, then passed all four lifecycle/scope/recovery cases. The current desktop capture at `packages/overlay/.scratch/expert-squad-settings-details-current.png` was opened at original resolution and reviewed directly: the collection glyph and team glyph are immediately distinguishable, optically centered in their existing 44px circles, consistent in stroke weight, and free of clipping or alignment drift.

### Verification

- `bun test packages/overlay/test/flat-redesign-icon-coverage.test.ts packages/overlay/test/config-panel-sizing.test.ts`: 40 passed, 0 failed, 373 expectations.
- `bun run --cwd packages/overlay typecheck`: passed.
- `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts`: 4 passed, 0 failed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`: 81 passed, 0 failed, 1282 expectations. The unrelated pre-existing close-confirmation record was temporarily added to the Git index only because document health intentionally rejects README links to untracked records; it was restored to its original untracked state immediately after the check and is excluded from this task's delivery.
