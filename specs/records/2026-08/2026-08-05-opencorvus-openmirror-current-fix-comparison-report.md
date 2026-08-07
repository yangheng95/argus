# OpenCorvus × OpenMirror Current Fix Comparison Report

Date: 2026-08-05
Status: Complete
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- HTML: HyperText Markup Language, the report's standalone web document format.
- CSS: Cascading Style Sheets, the report and application presentation language.
- DOM: Document Object Model, the browser-rendered page structure.
- VCS: Version Control System, the Git-backed change, commit, and push surface.

## Recall

### User requirement

Regenerate the earlier report at
`D:\yerui\测试对比\对比报告\OpenCorvus-OpenMirror-问题修复对比报告-HTML-20260725-014243`
from the product's current condition.

### Acceptance criteria

- Preserve the earlier report's 11 OpenCorvus-source items and four
  OpenMirror-source items as the comparison baseline.
- Reassess every item against the current `v0.0.30-beta` work branch after it
  has incorporated the latest same-version legacy remote product branch.
- Separate code/history evidence from current real-page interaction evidence;
  a commit title or an implementation record alone is not a passing result.
- Identify requirements whose current product semantics replaced the earlier
  control, rather than misreporting the old UI's absence as a regression.
- Produce a new self-contained HTML report, Markdown source, current screenshots,
  and a ZIP package beside the earlier report without overwriting it.
- Open the generated HTML in a real browser, inspect the desktop layout and all
  screenshot links, correct visible presentation defects, and repeat review.
- Report unverified running/error states honestly when the available current
  page cannot reproduce them.

### Hard constraints

- Do not create or run UI automation tests. Browser interaction and screenshots
  are one-off manual acceptance evidence only.
- Use Node, never Bun, for Playwright-driven interaction on Windows.
- Preserve the native Browser tab and live application state as the only source
  for URL, title, history, and page state.
- Preserve all user work. Do not reset the database, create a worktree, or use a
  destructive Git operation.
- Report and spec files use the repository's canonical `specs` index rules.
- Commit subjects begin with `dsw-33987`, and repository changes are pushed to
  the legacy remote.

### Material read before implementation

- The earlier report's Markdown and HTML source and its 12 screenshots.
- `AGENTS.md` supplied for the current workspace.
- `packages/overlay/src/components/TaskDirBar.tsx`, `CardHeaderChrome.tsx`,
  `ImagePreview.tsx`, `RightDock.tsx`, and current composer/work-ledger sources.
- `2026-08-04-environment-popover-right-edge-alignment.md`.
- `2026-08-04-environment-popover-anchor-motion-and-conversation-presentation.md`.
- `2026-08-03-conversation-error-indicator.md` and
  `2026-08-04-conversation-error-indicator-title-adjacency.md`.
- `2026-08-04-conversation-card-status-dot-retirement.md`.
- `2026-08-02-image-menu-and-empty-error-card-repair.md`.
- `2026-08-03-work-ledger-task-running-spinner.md`.
- `2026-08-05-contract-graph-and-goal-fact-projection-system-repair-plan.md`.

### Repository and history evidence

- Initial branch state was clean and synchronized with
  `legacy-remote/work-v0.0.30beta-yr-0804` at `cb395e5a2d`.
- `legacy-remote/v0.0.30beta` had advanced through `fc4c4ec1f3`; it was merged into the
  work branch as `e5d5d03675` and pushed after typecheck, route, API document,
  localization, and secret-scan hooks passed.
- The merge exposed seven unreferenced pre-convergence Goal workflow locale keys.
  Their only references were the locale catalogs; they were removed so the
  merged fact-projection UI retains one current language source.
- History and source searches covered Environment, error detail, image preview,
  new Chat, composer width, Work Ledger running state, Changes/VCS operations,
  Mission/Chat presentation, Goal facts, hover actions, and Right Dock layout.
- The current Environment `+` control calls `openLocalEnvironmentEditor()` and
  owns a real local-environment configuration dialog.
- The current error control is title-adjacent and uses an inline popover owned by
  `CardHeaderChrome`; it is no longer the old right-edge tooltip.
- The current image preview remains a first-class host with fit, width, scale,
  copy, and close controls.

### Independent-agent feedback

No sub-agent was requested by the user, so this investigation remains a single
agent audit. No conclusion is attributed to an unperformed independent review.

## Work plan

1. Build the baseline-to-current evidence matrix for all 15 earlier items.
2. Launch the current Overlay with a real backend and inspect the visible client
   at desktop geometry, including Environment, local-environment editing,
   composer references, Changes/VCS, current card presentation, and image/error
   states available in retained conversations.
3. Capture current screenshots scoped to the report's verification regions.
4. Generate the new Markdown, standalone HTML, and ZIP package beside the old
   report; retain current limitations and exact commit/runtime facts.
5. Open the report in the in-app Browser, inspect full-page and section-level
   presentation, repair layout or broken assets, and perform a second review.
6. Update this record and both spec indexes, run document health and focused
   non-UI validation, commit, push, and deliver direct file links.

## Status

- [x] Earlier report and evidence inventory read.
- [x] Latest same-version remote merged, validated, and pushed.
- [x] Initial source/history evidence matrix established.
- [x] Current real-page interaction and screenshot evidence.
- [x] New Markdown, HTML, screenshots, and ZIP package.
- [x] Browser visual review and second review.
- [x] Document health validation.
- [x] Final commit and legacy remote push.

## Result

### Reassessed totals

- OpenCorvus-source items moved from seven pass, three partial, and one
  unverified to **nine pass, one partial, and one unverified**.
- OpenMirror-source items moved from three pass and one partial to **four pass
  and zero partial**.
- The current report classifies the retired generic Conversation status dot as
  a current-semantics replacement: Work Ledger row spinners and active Tool
  waves now own running state. It does not count a removed historical control as
  a regression.
- Agent run-to-terminal collapse remains partial because this audit did not
  launch and observe a complete Agent lifecycle.
- The earlier React dashboard remains unverified because its exact preview
  target is not retained as a directly openable current artifact.

### Current real-page evidence

The current Overlay source was served at `http://127.0.0.1:5173` and exercised
against both an isolated current backend and the existing retained backend. The
saved screenshots demonstrate:

- a right-mounted Environment panel that does not cover the central column;
- a working Environment `+` action that opens a complete local-environment
  editor;
- an immediately populated VCS dialog, including explicit error feedback when
  commit-message generation returns empty;
- a new Chat whose right dock remains closed;
- the current `@` reference menu with Skill, Mission Skill, and Agent Squad
  entries;
- retained current Conversation cards and composer geometry.

No failed card was manufactured during this audit. Error-indicator acceptance
uses the current `CardHeaderChrome` implementation together with the retained
2026-08-03/04 real-page records. This evidence boundary is disclosed in both
report formats.

### Delivered package

The report was written beside, not over, the earlier package:

`D:\yerui\测试对比\对比报告\OpenCorvus-OpenMirror-问题修复对比报告-HTML-20260805-144453`

It contains the Markdown source, a standalone HTML report, baseline and current
evidence screenshots, and four report-review screenshots. The sibling archive
is:

`D:\yerui\测试对比\对比报告\OpenCorvus-OpenMirror-问题修复对比报告-HTML-20260805-144453.zip`

### Visual review

The standalone report was served from `http://127.0.0.1:5199` and opened in the
native in-app Browser at desktop geometry. Manual review covered the hero and
score cards, the OpenCorvus matrix, all three before/current comparisons, the
current-evidence gallery, the limitation list, and the final verdict. The
review confirmed readable hierarchy, stable two-column comparison geometry,
no visible horizontal overflow, and successful rendering for all referenced
images. Review screenshots are stored in the delivered package as
`11-report-visual-qa-top.png` through `15-report-visual-qa-verdict.png`.

### Repository validation

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  two pass, zero fail.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: sixty
  pass, zero fail.
- `git diff --check`: pass.

The first parallel document-health run exposed the expected monthly-index
contract while the new record was still untracked and also exhausted two
five-second scans under contention. After the exact three report-record files
were staged, the original commands were rerun serially without changing tests
or timeouts and passed completely.

Immediately before the final report commit, the branch was fetched from
`legacy-remote`; it was zero commits behind its work-branch upstream and contained
the latest `v0.0.30beta` product history.
