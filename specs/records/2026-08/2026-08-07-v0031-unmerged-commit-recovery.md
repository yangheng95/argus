# v0.0.31 Unmerged Commit Recovery

## Recall

| Item | Evidence and constraint |
| --- | --- |
| User request | Identify the missing commits, explain the cause, and start restoring the code that did not reach `v0.0.33beta`. |
| Acceptance criteria | Recover every still-current product contract from the unmerged `v0.0.31beta` chain; do not replay commits already reimplemented or superseded; preserve current architecture and unrelated work; verify non-User Interface (UI) contracts with focused tests and UI changes through a real page and manually reviewed screenshots; commit and push isolated recovery changes to legacy remote. |
| Hard constraints | No whole-branch merge, compatibility fallback, history reset, or blind cherry-pick; generated artifacts must be regenerated from current sources; UI automated tests must not be added, modified, or run and discovered obsolete UI tests must be removed; all commits use the `dsw-33987` prefix. |
| Sources read | Repository `AGENTS.md`; `git cherry`, `git range-diff`, merge-parent and merge-base evidence for `v0.0.31beta...v0.0.33beta`; commits `0bc4d2cd75`, `0d3c5186d9`, `0bafc424198`, `0e3c335109`, `1cbe4cdba8`, `90d41932ce`, `95d641b93c`; current brand-restoration plan. |
| Whole-repository search | Fifteen commits are outside the current ancestry: one empty checkpoint, four modified replays, ten without a range-diff match. Current generated Multica SDK already includes the old generated fields and the README slogan has been superseded; the remaining report, occurrence/status, visible-brand, and settings-hierarchy contracts require semantic comparison. |
| Independent agent feedback | None. The user did not request sub-agent delegation. |

## Cause

Merge commit `a55cd224d2` merged work-branch tip `72934b6ea1`, while the target changes continued on the separate `v0.0.31beta` line after merge base `72044d9232` through tip `c3d6eccf1d`. Git retained every object and the legacy remote still references the source line; this is an integration omission, not object loss or metadata-rewrite damage.

## Recovery groups

1. Compare and selectively replay the research-report and office-artifact chain (`0bc4d2cd75`, `0d3c5186d9`, `0bafc424198`) against current capability, session, tool, and harness contracts.
2. Compare and selectively replay the occurrence/status chain (`0e3c335109`, `1cbe4cdba8`) against current runtime and message authority.
3. Finish the already-started selective OpenCorvus visible-brand restoration from `90d41932ce`; retain the current README narrative and regenerate derived payloads.
4. Compare the Expert Squad settings hierarchy from `95d641b93c` with the current panel and migrate only still-current information architecture using existing primitives.
5. Keep the current reimplementations of Squad SDK, optional names, and direct-Conversation Computer Use; regenerate SDK/payload outputs instead of replaying obsolete generated commits.

## Verification

- Run focused positive non-UI contract tests for each restored runtime group, then typecheck, route checks, documentation checks, and historical-document link checks.
- Build the real Overlay, open the affected surfaces, capture screenshots tied to the brand and Expert Squad settings regions, and manually review them without creating or running UI automated tests.
- Review the final diff against each source commit, stage only recovery-owned paths, commit independently, and push `v0.0.33beta` to legacy remote.

## Recovery progress

- OpenCorvus visible-brand recovery was completed and pushed as `5fe76808b8` after production build and real-page review.
- The Expert Squad Settings hierarchy from `95d641b93c` applied cleanly to the current panel, locale, and style sources. The obsolete source-reading UI tests touched by that commit remain deleted under the current UI test prohibition. The rebuilt real Settings page shows a quiet master-detail Installed Agent Squads surface and includes `Generate Agent Squads` in the package list; [current visual evidence](../../artifacts/2026-08-07-expert-squad-settings-recovered.png) was manually reviewed.
- The execution-occurrence/status chain (`0e3c335109`, `1cbe4cdba8`) was semantically replayed over the current cancellation-origin and Expert Squad work. The recovery restores durable input-message occurrence authority, physical Worker Turn settlement, exact process-recovery facts, occurrence-aware lifecycle/status projection, session invocation topology, and regenerated Software Development Kit (SDK) event contracts. The deleted direct-continuation adapter is not retained. Current SDK generation and repository typecheck pass after importing the settlement-evidence schema dependency from `0bafc424198`.
- The report and Office harness chain (`0bc4d2cd75`, `0d3c5186d9`, `0bafc424198`) was semantically recovered without restoring its obsolete global Skill/Work dual source. Research Studio now owns the complete report-quality Skill, template, Schema, computation → fact-check → rendering contract, and real image-review surfaces. Still-current command-line directory/MIME, exact tool-input persistence, empty data-URL parsing, and capability alias/fuzzy-discovery fixes were restored separately; current Session occurrence/cancellation architecture supersedes the old `0d3c5186d9` loop snapshot, and `403c17250a` already contains the required `0bafc424198` Worker Turn settlement schema.
