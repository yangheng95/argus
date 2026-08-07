# UI Automated Test Prohibition

## Recall

### User requirements

- Prohibit UI tests.
- Preserve real-page visual acceptance rather than replacing it with source,
  DOM, screenshot-string, or browser-test assertions.

### Acceptance criteria

- `AGENTS.md` contains one explicit definition of prohibited UI automated tests.
- Adding, modifying, updating, or running UI automated tests is prohibited.
- Existing UI tests are classified as legacy debt and are not extended during
  ordinary UI work; deleting them is a separate cleanup scope.
- Real-page interaction and screenshot inspection remain mandatory for UI work,
  but must not be committed or represented as an automated UI test.
- Pure non-UI logic, service, protocol, API, persistence, runtime, typecheck,
  build, and static integrity verification remain allowed.
- Rules 15.1, 23.1, 28, 28c, 28d, 36, and 44.2 no longer contradict the UI-test
  prohibition.

### Hard constraints

- Change governance and documentation only; do not delete the existing UI test
  suite in this task.
- Do not modify product, frontend, backend, SDK, or expert-squad runtime code.
- Preserve all concurrent Prism / Mirror Watch changes and their untracked
  artifacts.
- Commit subjects start with `dsw-33987`; push only the task-owned governance
  and spec paths to `myhexin/v0.0.24beta`.

### Hard-disk sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `packages/opencorvus/test/script/historical-docs-links.test.ts`
- `packages/opencorvus/test/script/document-health.test.ts`
- Current repository searches listed below.

### Whole-repository search result

Repository-wide searches covered `前端视觉验收`, `UI`, `test`, `测试`,
`browser`, `Playwright`, `截图`, `28d`, `rule 28`, `rule 36`, and
`browser regression`.

| Rule / owner | Conflict | Disposition |
| --- | --- | --- |
| Frontend visual acceptance principle | Correctly requires a real page and inspected screenshots, but does not distinguish interactive inspection from automated UI tests. | Keep real-page acceptance and explicitly prohibit turning it into a committed test or assertion harness. |
| Rule 15.1 Overlay package isolation | Requires an Overlay path test and can be read as requiring UI automation. | Keep non-UI Registry/Manager/Resolver/route contract tests; verify the Overlay presentation through interactive runtime inspection and screenshots. |
| Rule 23.1 build toolchain | Names `browser runner` as a required test toolchain. | Replace it with the real-page browser inspection tool; UI test runners are no longer an acceptance dependency. |
| Rule 28 | Requires every bug fix to receive a test. | Restrict the requirement to non-UI behavior and make UI changes follow the explicit prohibition. |
| Rule 28c | Correctly requires observable message-flow evidence but can route visual evidence into a browser test. | Preserve real observable evidence and prohibit a UI test as its substitute. |
| Rule 28d | Correctly rejects mocked E2E evidence but still describes browser interactions as an E2E test contract. | Reframe it as interactive webpage acceptance, separate from automated tests. |
| Rule 36 | Requires every code change to receive unit or E2E tests. | Restrict it to non-UI code; mixed changes test only the non-UI contract and inspect UI manually. |
| Rule 44.2 | Explicitly requires a real browser regression test for a hover/focus visual combination. | Require interactive reproduction, screenshots, and visual review instead. |
| Existing UI test files | Large legacy suite exists under Overlay source/browser test folders. | Do not expand or update it. Removal is a dedicated cleanup task, not incidental deletion. |

### Independent-agent feedback

- No sub-agent was requested or used.

### Git baseline

- Branch: `v0.0.24beta`.
- Starting `HEAD`: `02a66fd3e7`, aligned with `myhexin/v0.0.24beta`.
- Concurrent Prism / Mirror Watch source and untracked spec changes remain
  outside this task.

## Policy

An automated test is a UI test when its asserted subject is rendered or
interactive presentation: frontend source strings, HTML/TSX structure, CSS,
copy, icons, DOM snapshots, component rendering, visibility, geometry,
responsive layout, hover, focus, keyboard presentation, browser fixtures,
screenshots, or pixel output. Such tests are prohibited regardless of whether
they use unit-test, component-test, browser, Playwright, or screenshot tooling.

Interactive inspection is not a repository test. An agent may use the real
application, an isolated real page, Playwright, or Browser Preview to operate
the UI and capture evidence, but must personally inspect the result and must not
commit a reusable test, pass/fail assertion harness, fixture, or screenshot
baseline for that UI behavior.

Pure non-UI logic and system contracts remain testable even when implemented in
a frontend package. The deciding boundary is the asserted subject, not the file
location.

## Implementation plan

1. Add the canonical UI automated-test prohibition beside the existing frontend
   visual-acceptance principle.
2. Rewrite every conflicting rule found by the full-repository search.
3. Index this record and run documentation-health verification only.
4. Review the final diff, commit task-owned governance paths, and push through
   normal git-cc hooks.

## Progress

- [x] Inventory every conflicting UI-test and visual-acceptance rule.
- [x] Update the policy and documentation indexes.
- [x] Run documentation verification and second review.
- [x] Commit, push, and verify remote convergence.

## Verification

- Full searches of `AGENTS.md` found and corrected the conflicting requirements
  in rules 15.1, 23.1, 28, 28c, 28d, 36, and 44.2.
- The canonical prohibition explicitly covers source-string, DOM, component,
  browser, Playwright-test, screenshot-baseline, pixel, layout, hover, focus,
  keyboard-presentation, and other rendered-output assertions.
- The same rule preserves interactive real-page operation and personally
  inspected screenshots without allowing reusable test scripts or fixtures.
- Documentation health passed: 93 tests, 0 failures across historical links,
  document health, and product-documentation single-source checks.
- `git diff --check` passed.
- No UI automated test was added, modified, updated, or run. No product,
  frontend, backend, SDK, or expert-squad runtime source belongs to this change.
- Governance commit `3c9b7cd071` passed the normal pre-push typecheck,
  API-route, documentation, internationalization, and secret-scan hooks and was
  pushed to `myhexin/v0.0.24beta`.
