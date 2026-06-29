# Reference Comparison Contract Preservation - 2026-06-19

## Acronyms

- DB: Database, the persisted OpenCorvus task store.
- GUI: Graphical User Interface, the visible application surface under review.
- ID: Identifier, a stable task, target, artifact, evidence, or goal key.
- QA: Quality Assurance, the post-build visual review stage.
- URL: Uniform Resource Locator, the persisted browser preview address.

## Problem

The World Economy task had `local source-binding helper` and
`region comparison tool` exposed to the visual QA session, but the DB
contains no calls to either tool and no `operation_kind="reference-comparison"`
evidence.

This is not a registration-only bug. The observed chain is:

1. The visual QA tool descriptor included `browser_preview`,
   `local source-binding helper`, and `region comparison tool`.
2. The task request/goals treated full per-region Reference vs Implementation
   evidence as a later phase instead of a goal-local acceptance requirement.
3. No separate phase task carrying that evidence requirement existed.
4. `browser_preview` could start a service without persisting a new target, then
   resolve and return an older task target. That makes the tool output imply a
   usable target even when the current startup failed to bind the task-scoped
   preview.
5. Visual QA then used standalone webpage evidence and submitted a failed report
   without ever entering the bind/compare path.

## Grep Inventory

Commands:

```powershell
rg -n "region comparison tool|local source-binding helper|Reference vs Implementation|visual QA|visual-qa|browser_preview" specs packages/opencorvus/src packages/opencorvus/test -g "*.md" -g "*.txt" -g "*.ts"
rg -n "missing_final_visual_acceptance|requireReferenceCoverage|visual-evidence-bundle|isEssentialVisualEvidenceAcceptanceSpec|reference-comparison" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
rg -n "createVisualQaOutputTools\\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

Relevant surfaces:

| Surface                                                           | Finding                                                                                                 | Decision                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/tool/browser-preview.ts`                                     | Resolves the latest task target after every startup, even when the current startup persisted no target. | Return a current-startup missing target instead of a stale task target when no startup target was persisted. |
| `test/tool/browser-preview.test.ts`                               | Covers missing command-derived target, but not stale target leakage.                                    | Add a regression where an old saved target exists and the new startup persists nothing.                      |
| `src/architect/output-tools.ts`                                   | Missing final visual evidence acceptance for reference-driven tasks is only a concern.                  | Make this a blocker because it is a contract integrity failure.                                              |
| `test/orchestrator/architect-fidelity-gate.test.ts`               | Locks the weaker concern behavior.                                                                      | Update tests so reference-driven graphs cannot finalize without essential visual evidence ownership.         |
| `src/prompt/core/visual-qa-core.txt` and `src/visual-qa/agent.ts` | Prompt text now asks for bind/compare but remains model-governed.                                       | Keep as supporting instruction; do not treat prompt text alone as the fix.                                   |

## Acceptance

- A `browser_preview` startup that persists no target reports `targetStatus:
"missing"` even if the task has an older saved target.
- Reference-driven architect output without essential final visual evidence is a
  blocker returned by `architectValidationIssues`.
- Reference coverage regions not owned by a final visual evidence acceptance are
  blockers, not ignorable concerns.
- Existing tool-level bind-to-compare tests still pass.
