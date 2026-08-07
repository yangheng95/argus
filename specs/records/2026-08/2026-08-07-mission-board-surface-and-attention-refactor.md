# Mission Board surface and attention refactor

Status: implementation and real-page visual verification complete.
Date: 2026-08-07

## Recall

### User request

- Explain why the Task Board background does not match the white conversation surface and whether the permanent Attention panel is necessary.
- Refactor the Task Board styling so it follows the established OpenCorvus design language.

### Acceptance criteria

1. The Task Board is visually part of the same central workspace as Conversation and therefore uses the canonical `--surface` canvas instead of the navigation-oriented `--rail-surface`.
2. Lane bodies use the canonical neutral surface. Semantic colors remain restrained signals on lane indicators and interactive emphasis rather than tinting the full height of the board.
3. Attention remains the single canonical projection for Missions requiring operator action, but an empty Attention lane does not permanently consume board width.
4. The remaining lanes redistribute the available desktop width without adding mobile or tablet behavior.
5. Existing Mission lane derivation, card identity, controls, navigation summary, and backend contracts remain unchanged.
6. The current-source Overlay is opened in a real browser, the exact board region is captured and personally reviewed, and observed visual defects are corrected before delivery.
7. No User Interface automation test is added, modified, updated, or run.

### Hard constraints

- Preserve Mission as the sole top-level board identity and Task as nested execution detail.
- Preserve `boardLane` as the one read-time projection source; do not add another state, fallback, compatibility path, or workflow gate.
- Reuse existing OpenCorvus surface, border, spacing, Badge, Button, and semantic-color primitives.
- Desktop-only delivery; no responsive or mobile scope.
- Playwright/browser interaction must run through Node.js, never Bun, and must remain manual visual acceptance rather than a test artifact.
- Preserve unrelated worktree changes. Commit subjects start with `dsw-33987`; push to git-cc.

### Sources read

- `AGENTS.md`
- `specs/records/2026-08/2026-08-06-mission-board-design.md`
- `specs/records/2026-08/2026-08-07-mission-board-ai-primary-stable-create-dialog.md`
- `specs/records/2026-08/2026-08-07-mission-board-panel-only-task-lifecycle-e2e.md`
- `packages/overlay/src/components/MissionBoard.tsx`
- `packages/overlay/src/styles/surfaces/mission-board.css`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/services/mission.ts`
- `packages/opencorvus/src/mission/board.ts`
- Browser control skill instructions.
- The user-provided Task Board screenshot.

### Whole-repository search result

- `.mission-board` and its header explicitly use `--rail-surface`, while the Conversation center surface uses `--surface`.
- Every lane mixes five percent of its semantic accent into the complete lane body; this creates the large blue, amber, violet, and green fields visible in the supplied screenshot.
- The existing Mission Board design record intentionally selected semantic lane tints, so the mismatch is an outdated design decision rather than a rendering defect.
- `attention` is an exclusive backend-derived lane for pending child-Task interactions or cancelled child Tasks requiring operator authority. Failed Tasks correctly remain eligible for Review and do not imply Attention.
- `MISSION_BOARD_LANES` is the shared ordered lane catalog used for grouping and navigation summary. The board component can derive its visible lane set from that catalog without introducing a second status source.
- No User Interface automated test was opened or run in the implementation paths touched by this task.

### Independent agent feedback

None requested. No sub-agent is used.

## Implementation plan

- [x] Change the board canvas and header to the canonical center-workspace surface.
- [x] Remove full-lane semantic fills; retain restrained state indicators and interaction emphasis.
- [x] Derive visible board lanes from the canonical ordered catalog, omitting Attention only while its filtered count is zero.
- [x] Let the desktop grid redistribute available width for four or five visible lanes.
- [x] Run formatting, focused static checks, Overlay typecheck/build, available documentation checks, and diff checks without running User Interface tests.
- [x] Operate and capture the real current-source board, perform a second visual review, and iterate if necessary.
- [x] Record the final commit and git-cc push outcome in the delivery response.

## Implementation and verification evidence

- `MissionBoard` now derives its visible ordered lanes from `MISSION_BOARD_LANES`; only an empty filtered Attention lane is omitted. The backend-derived `boardLane`, navigation summary, and five-lane catalog remain the single status authority.
- `.mission-board`, its header, and every lane body use `--surface`. Lane borders and header dividers use the canonical neutral border; semantic colors remain on indicators, card hover emphasis, progress, and Badge primitives.
- The lane grid uses the derived visible-lane count. The real desktop page measured five lanes at approximately 297 pixels each while Attention contained one pending-input Mission, then four lanes at approximately 374 pixels each after a real search excluded that Mission.
- The Node.js-driven headed Playwright sidecar opened `http://127.0.0.1:5176/`, clicked the real Task Board navigation action, exercised the real search field, and captured the exact board region. Both the board and every lane computed to `rgb(255, 255, 255)`; captured console errors and page errors were both empty.
- [Five-lane visual evidence](../../artifacts/mission-board-surface-attention-refactor.png) shows the real pending-input Attention lane without full-column semantic tinting.
- [Four-lane visual evidence](../../artifacts/mission-board-surface-no-attention.png) shows Attention absent and the remaining canonical lanes expanded evenly.
- The in-app Browser and Chrome extension channels both rejected local development navigation with their client-side local-address policy. Following the Browser skill fallback boundary, visual acceptance used the repository's installed Playwright package with the system Chrome executable, headed mode, and Node.js; no User Interface test file, fixture, assertion, or screenshot baseline was created or run.
- `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, the production Vite build, Prettier, and `git diff --check` passed. The build transformed 7,083 modules and completed with its existing chunk-size warnings.
- The historical-link and document-health commands named by the repository instructions could not run because commit `8ae01ff289` deliberately deleted the complete `packages/opencorvus/test/**` suite, including those files. They were not recreated as part of this User Interface task; the new record and both visual artifacts are linked from the root and monthly indexes instead.
