# Work Ledger Kind Hover Tooltips

## Recall

- User request on 2026-07-09: "给mission，task和chat分别添加UI风格一致的hover提示，chat等于交互式coding，mission是长程编排任务，其执行单元为 task". The provided screenshot points at the Projects / Work Ledger row kind labels in the left sidebar.
- Acceptance criteria:
  - Work Ledger Mission, Task, and Chat kind marks expose UI-styled hover tooltips with consistent visual treatment.
  - Tooltip copy defines Chat as interactive coding, Mission as a long-running orchestration task, and Task as the Mission execution unit.
  - Tooltip implementation uses the existing Kobalte Tooltip plus `card-meta-tooltip` visual primitive, not a native-title-only tooltip or a second custom hover system.
  - Row selection, project grouping, Mission child task placement, row action hover rails, and existing native row detail titles remain functionally unchanged.
  - The change includes focused tests and real browser screenshot review through the Node Playwright runner.
- Hard constraints:
  - No fallback, compatibility branch, duplicate row-kind source, hidden pseudo-state, or gate.
  - Preserve unrelated dirty worktree changes.
  - Do not restart, refresh, kill, or otherwise interfere with the user's running OpenCorvus / overlay process.
  - Browser verification must use an isolated fixture and Playwright through Node on Windows, not Bun.
  - Frontend work requires screenshot review of the rendered target.
- Sources read before implementation:
  - User screenshot `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-64daa51b-60a4-4637-b73c-6b2f44aefea1.png`
  - `specs/README.md`
  - `specs/artifacts/长程编排测试.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`
  - `specs/records/2026-07/2026-07-08-work-ledger-row-alignment.md`
  - `specs/records/2026-07/2026-07-08-project-directory-new-chat-icon.md`
  - `specs/records/2026-07/2026-07-09-agent-rail-hover-removal.md`
  - `packages/overlay/src/components/WorkLedger.tsx`
  - `packages/overlay/src/components/CardHeaderChrome.tsx`
  - `packages/overlay/src/styles/surfaces/work-ledger.css`
  - `packages/overlay/src/styles/surfaces/card.css`
  - `packages/overlay/src/i18n/en-US.json`
  - `packages/overlay/src/i18n/zh-CN.json`
  - `packages/overlay/test/work-ledger-consolidation.test.ts`
  - `packages/overlay/test/browser/project-ledger-group-browser.test.ts`
  - `packages/overlay/test/browser/project-directory-new-chat-browser.test.ts`
- Whole-repository grep evidence:
  - `rg -n "card-meta-tooltip|work-row-kind-mark|work_ledger\\.kind|WorkLedgerKindMark|work-ledger-row|data-kind=\\{row\\(\\)\\.kind\\}|Kobalte|Tooltip\\.Root|ProjectLedgerGroup|missionHasVisibleStoppableTask|task_owned_by_mission" packages/overlay/src packages/overlay/test specs/records/2026-07 -S` found `WorkLedgerKindMark` as the single Work Ledger row-kind mark, `card-meta-tooltip` as the existing tooltip visual, and `ProjectLedgerGroup` as the shared project group owner.
  - `rg -n "Tooltip|tooltip|popover|title=|work-row-kind-mark|mission|chat|task" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test -S` showed the existing Work Ledger row kind only has a native `title`; Kobalte Tooltip is already used by card metadata and sidebar version.
  - `rg -n "2026-07-08-work-ledger-row-alignment|mission-task-chat-toolbar|project-directory-new-chat|Projects panel|Work Ledger" specs/records/2026-07 -S` confirmed the current product direction: Mission / Task / Chat rows are unified under the Projects / Work Ledger path, and Mission-owned tasks render as Mission child rows.
- Independent agent feedback:
  - None. The change is localized to Work Ledger row-kind presentation and existing records/tests already establish the ownership boundary.

## Diagnosis

The screenshot is not asking for another row action or a new list surface. The current `WorkLedgerKindMark` renders the Mission, Task, and Chat icons and labels from one function, but the explanation is limited to the short native `title` text. That makes the row kinds visually discoverable only as names, not as product concepts.

The correct owner is `WorkLedgerKindMark`: it is already the single row-kind mark for top-level rows and Mission child task rows in the unified Work Ledger. Adding the hover explanation there keeps Mission / Task / Chat semantics in one place and avoids touching the retired separate `TaskList`, `MissionList`, or `CodingAssistantSessionList` paths.

## Plan

1. Import Kobalte Tooltip in `WorkLedger.tsx` and wrap `WorkLedgerKindMark` with the same tooltip primitive style used by card metadata.
2. Add three locale keys under `work_ledger.kind_description.*` for Mission, Task, and Chat.
3. Keep the kind mark icon, `aria-label`, row native detail title, row click handling, and action rail behavior unchanged.
4. Add focused source tests that lock the Kobalte Tooltip usage, locale keys, and absence of a parallel Work Ledger tooltip CSS class.
5. Extend the Node browser Work Ledger fixture to hover Mission, Task, and Chat kind marks, assert tooltip text/role/visibility, and save screenshots.
6. Run focused unit tests, i18n check, browser fixture, historical docs link test, `git diff --check`, then review generated screenshots.

## Validation Targets

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun run --cwd packages/overlay check:i18n`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Verification Results

- Passed: `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/left-activity-toolbar.test.ts`
- Passed: `bun run --cwd packages/overlay check:i18n`
- Passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts`
- Passed: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Passed: `bun run --cwd packages/overlay typecheck`
- Passed: `git diff --check`
- Visual review passed:
  - `.scratch/work-ledger-kind-tooltip-mission.png`
  - `.scratch/work-ledger-kind-tooltip-task.png`
  - `.scratch/work-ledger-kind-tooltip-chat.png`

The first browser run timed out before producing tooltip screenshots because an isolated browser runner was delayed by concurrent browser-test process state. After confirming no stale global browser lock remained, rerunning the same command passed. During visual review the initial fixture also surfaced a real `task ledger-task-2 missing orderKey` notification. The fixture task payload was corrected with the existing `testTaskOrderKey` helper so the final screenshots are not polluted by contract-invalid test data.
