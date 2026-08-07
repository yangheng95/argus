# 2026-07-08 Project Directory New Chat Icon

## Recall

| Item | Detail |
| --- | --- |
| User request | "在打开的项目目录上加一个新建chat的icon" |
| Acceptance criteria | Each opened project directory row in the Projects / Work Ledger panel exposes a compact new-chat icon; activating it creates a real Coding Assistant chat for that directory, selects it, and focuses the composer; the icon uses the shared `Icon` primitive with a semantic chat-plus glyph; no duplicate directory, session, or pseudo-chat state is introduced. |
| Hard constraints | Follow `AGENTS.md`; no fallback / compatibility branch; preserve unrelated dirty worktree changes; no new worktree; no running OpenCorvus / overlay restart or refresh; use existing Button/Icon primitives; all visible strings go through i18n; frontend change needs Node-run Playwright screenshot review; commit subject starts with `dsw-33987`; push to `legacy-remote`. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/99-principles.md`; `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`; `specs/records/2026-07/2026-07-08-work-ledger-row-alignment.md`; `specs/records/2026-07/2026-07-08-codex-message-panel-titlebar-toolbar.md`; `packages/overlay/src/components/WorkLedger.tsx`; `packages/overlay/src/components/ProjectLedgerGroup.tsx`; `packages/overlay/src/components/Icon.tsx`; `packages/overlay/src/main.tsx`; `packages/overlay/src/services/coding-assistant.ts`; `packages/overlay/src/services/work-ledger.ts`; `packages/overlay/src/styles/surfaces/sidebar.css`; focused tests. |
| Existing dirty worktree | Before this task, many unrelated `packages/opencorvus/**`, `packages/overlay/**`, SDK docs, and July spec files were already modified or untracked. This task only owns the files listed in the implementation section and must not reset or stage unrelated work. |
| Whole-repository grep evidence | `rg -n "Projects\|project folder\|open project\|openProject\|opened project\|WorkLedger\|new chat\|New chat\|chat" packages/overlay/src packages/overlay/test specs/records/2026-07 -S`; `rg -n "WorkLedgerProjectGroupView\|project-group\|work-ledger-project\|directory\|New chat\|new chat\|chat" packages/overlay/src/components/WorkLedger.tsx packages/overlay/src/styles/surfaces/work-ledger.css packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/browser -S`; `rg -n "createCodingAssistantSession\\(\|selectCodingAssistantSession\\(\|coding/session" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test -S`; `rg -n "ProjectLedgerGroup" packages/overlay/src/components -S`; `rg -n "project-group" packages/overlay/src/styles/surfaces/sidebar.css -C 4`; `rg -n "project-add\|CUSTOM_ICON_PATHS" packages/overlay/src/components/Icon.tsx packages/overlay/test -S`. |
| Independent agent feedback | Not spawned because this is a narrow single-surface UI action and the user did not request parallel agents. The main-agent verification includes source tests, browser geometry/action tests, screenshot review, and second review. |

## Diagnosis

The Projects header already has a panel-level `left-panel-open-project` action that opens a folder as a project. The user asks for a new-chat action on an opened project directory, so putting another global header button would target the wrong information structure.

The unique directory row owner is `ProjectLedgerGroup`, and `WorkLedger` is the call site for opened project directories. Existing TaskList, MissionList, and CodingAssistantSessionList also use `ProjectLedgerGroup`, so the new action must be optional and only passed by `WorkLedger`.

The real chat creation lifecycle already exists in `createCodingAssistantSession({ directory })`, which POSTs `coding/session`, stores the returned row, selects the created session through `selectCodingAssistantSession`, hydrates conversation, and starts the session SSE stream with the row directory. Clearing `selectedSource` would only display a draft launcher and would not satisfy "新建 chat".

## Design

1. Add an optional `onCreateChat(directory)` prop to `ProjectLedgerGroup`.
2. Render a compact `Button` inside `.project-group-actions` only when `onCreateChat` is provided and the directory is non-empty.
3. Add a semantic `message-add` icon to the shared `Icon` primitive instead of using a plain plus or inline SVG at the call site.
4. In `WorkLedger`, add `onCreateChat` to props and pass it to the opened-directory `ProjectLedgerGroup`.
5. In `main.tsx`, implement `createWorkLedgerProjectChat(directory)` with the existing `createCodingAssistantSession` lifecycle, then set chat mode, bump workspace epoch, reset the center panel to chat, refresh Work Ledger, and focus the composer.
6. Add i18n label `project.new_chat_button_title`.
7. Extend focused source tests and add browser coverage that verifies visibility, hover/focus behavior, click isolation from collapse, real create-session request path, and screenshot evidence.

## Verification Plan

```powershell
bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/task-list-buttons-primitive.test.ts packages/overlay/test/coding-assistant-service.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-directory-new-chat-browser.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check -- <changed files>
```

Visual review must inspect the browser screenshot and confirm the new chat icon sits on the opened project directory row action rail, stays compact and aligned with existing project actions, does not overlap count/chevron, and clicking it selects a new Coding Assistant chat without collapsing the directory group.

## Implementation

| File | Responsibility |
| --- | --- |
| `packages/overlay/src/components/Icon.tsx` | Adds the shared `message-add` icon backed by `currentColor`. |
| `packages/overlay/src/components/ProjectLedgerGroup.tsx` | Owns the optional opened-project directory action button with real button semantics and `project.new_chat_button_title`. |
| `packages/overlay/src/components/WorkLedger.tsx` | Passes `onCreateChat` only for Work Ledger project directory groups. |
| `packages/overlay/src/main.tsx` | Implements `createWorkLedgerProjectChat(directory)` through `createCodingAssistantSession({ directory })`, resets the center workbench to Chat, refreshes Work Ledger, and focuses the composer. |
| `packages/overlay/src/styles/surfaces/sidebar.css` | Reuses the existing project action rail sizing, icon sizing, and hover/focus treatment for `project-group-new-chat`. |
| `packages/overlay/src/i18n/en-US.json`; `packages/overlay/src/i18n/zh-CN.json` | Add the user-visible action label and missing-directory error. |
| `packages/overlay/test/browser/project-directory-new-chat-browser.test.ts` | Node-run browser coverage for hover visibility, screenshot capture, click isolation, real `POST /coding/session`, selected session, and Work Ledger reload. |
| Focused source tests | Lock ProjectLedgerGroup ownership, Work Ledger wiring, i18n keys, CSS selector coverage, and Icon registry coverage. |

## Verification Results

| Check | Result |
| --- | --- |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-directory-new-chat-browser.test.ts` | Pass. Generates `.scratch/project-directory-new-chat-hover.png` and `.scratch/project-directory-new-chat-selected.png`. |
| `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/task-list-buttons-primitive.test.ts packages/overlay/test/project-delete-button.test.ts packages/overlay/test/coding-assistant-service.test.ts` | Pass, 22 tests. |
| `bun test packages/overlay/test/flat-redesign-icon-coverage.test.ts` | Pass, 15 tests. |
| `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` | Pass, 20 tests. |
| `bun run --cwd packages/overlay typecheck` | Pass. |
| `bun run --cwd packages/overlay check:i18n` | Pass in the current worktree. |
| `git diff --check -- <changed files>` | Pass. |
| Raw color scan over changed files | Finds existing raw colors in `packages/overlay/src/components/Icon.tsx` for pre-existing colored editor/provider icons. The new `message-add` icon introduces no raw color and uses `currentColor`. |

## Visual Review

The hover screenshot shows the new compact chat-plus button on the opened `workspace` project directory row, aligned with the existing project action rail and not overlapping the count/chevron area. The selected screenshot shows a newly created `New project chat` row above the existing task, with the selected row highlight and Chat composer title active. The directory group remains expanded after the click.

## Second Review

The implementation uses the existing Coding Assistant session creation lifecycle and does not add pseudo-chat local state. `ProjectLedgerGroup` remains the single owner of project-directory action primitives; Mission and Coding Assistant project groups do not receive the optional new-chat prop. No fallback or compatibility path was added.
