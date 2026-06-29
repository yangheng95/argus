# 2026-06-26 Visual QA Screen-by-Screen Blockers

## Goal

Change Visual QA so frontend visual review prioritizes reference screenshot comparison
and screen-by-screen screenshot inspection. Visual QA must not judge a page from one
full-page screenshot or a one-shot whole-page visual judge. Its terminal conclusion
must be represented as blocker evidence through the structured report, not as
advisory-only prose.

## Recalled Constraints

- `2026-06-25-visual-evidence-no-hard-gate-root-repair.md`: host must record
  schema-valid Visual QA reports and must not reject delivery solely because
  reference-comparison artifacts are missing, unreadable, incomplete, or not
  perfectly covered.
- `2026-06-25-visual-qa-self-report-consistency-repair.md`: Visual QA
  self-report contradictions compute `effectiveAccepted=false` from the report's
  own fields. Context-derived artifact diagnostics remain non-blocking unless
  the report itself declares the missing evidence.
- `2026-06-20-visual-qa-scroll-slice-comparison.md`: scroll-slice evidence is
  supporting `visual_diff` evidence only and cannot satisfy formal
  `reference_comparison` proof.

## Callpoint Inventory

| Surface                                                     | Current behavior                                                                                                                      | Required change                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/prompt/core/visual-qa-core.txt`    | Allows screenshot evidence and scroll-slice sweeps but does not explicitly ban one-shot full-page judging.                            | Require screenshot comparison first for reference work, then viewport/screen-by-screen screenshot analysis; explicitly ban one-shot full-page screenshot or webpage judge conclusions. |
| `packages/opencorvus/src/visual-qa/agent.ts`                | Runtime delegation repeats the same weaker scroll-slice language.                                                                     | Mirror the core prompt so continuation/fresh sessions receive the same screen-by-screen blocker contract.                                                                              |
| `packages/opencorvus/src/orchestrator/tools.ts`             | `visual_qa` description says it lists blockers but does not name screen-by-screen analysis.                                           | Tell orchestrator to dispatch Visual QA for screenshot comparison and screen-by-screen inspection, not one-shot whole-page judging.                                                    |
| `packages/opencorvus/src/visual-qa/acceptance-semantics.ts` | Accepted reports fail when they have no evidence at all, but command/console-only evidence can still be effectively accepted.         | Accepted reports must contain screenshot-bearing visual evidence (`screenshot`, `reference_comparison`, or `visual_diff`).                                                             |
| `packages/opencorvus/src/visual-qa/output-tools.ts`         | Self-report contradictions are returned under `ADVISORIES`, mixing blocking report conclusions with non-blocking context diagnostics. | Split terminal feedback into `BLOCKERS` for report-internal acceptance blockers and `ADVISORIES` for non-blocking context diagnostics.                                                 |
| Tests                                                       | Existing Visual QA tests assert advisory text for self-report failures and do not pin the whole-page judge prohibition.               | Update output-tool/negative-fixture expectations and add prompt/semantics assertions for screen-by-screen evidence.                                                                    |

## Non-Goals

- Do not reintroduce a host-side evidence artifact hard gate.
- Do not remove `browser_preview_compare_scroll_slices`; it remains useful when
  called repeatedly as viewport-sized supporting evidence.
- Do not make tablet/mobile validation mandatory for desktop-only clone tasks.
