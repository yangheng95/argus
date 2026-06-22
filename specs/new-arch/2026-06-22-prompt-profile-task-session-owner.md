# Prompt Profile Task Session Owner

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the rendered overlay surface.
- UI: User Interface, visible controls and panels.
- SSE: Server-Sent Events, the live update stream used by the overlay.

## Task Definition

Reduce task-switch request fan-out by preventing the chat composer prompt
profile selector from loading the project prompt-profile catalog while a
selected task's root session is still unresolved.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no gate, no double source, recall plans before edits, test every change, visually verify UI work, commit and push each round. |
| `2026-06-22-task-switch-directory-source.md` | During task switch, task-owned UI must use the selected task's ownership data and must not reuse previous project scope. |
| `2026-06-22-task-switch-stable-request-keys.md` | `config/prompt-profile` still fires repeatedly because the composer requests project-level profiles before `rootTaskSessionID()` resolves. |
| `board.ts::rootTaskSessionID()` | When a task is selected and the root session is unresolved, callers must treat the empty string as "do not write /config"; never silently fall back to project config. |
| `2026-06-18-prompt-profile-extension-import-consensus.md` | Prompt Profiles are the single expert-squad source; the selector must not create new routing, workflow, tools, gates, or prompt systems. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `main.tsx::refreshPromptProfiles()` | Uses `rootTaskSessionID() || activeSessionID() || undefined`, so selected-task pending root falls through to project catalog. | Pass an explicitly resolved session id into the loader; do not compute fallback at fetch time. |
| `main.tsx` prompt-profile effect | Reads broad task/session/config sources directly and calls the loader on every invalidation. | Introduce a stable request key memo so unchanged semantic target/config does not refetch. |
| `loadPromptProfileCatalog(sessionID?)` | Backend route intentionally distinguishes project catalog from session-effective catalog by optional `sessionID`. | Keep route contract unchanged; the fix is client request ownership. |
| `rootTaskSessionID()` | Already resolves board task session first, then selected task row session; returns `""` while unresolved. | Reuse this single source and treat `""` under selected task as "no request yet". |
| `ChatComposer` selector | Disables the selector when `promptProfiles.length === 0`. | Clear profiles while selected task root is unresolved so stale project options are not shown as task options. |

## Root Cause

The composer prompt-profile effect is always mounted and watches selected task,
selected standalone session, project directory epoch, and prompt-profile config.
During task selection, `activeTaskID()` becomes truthy before the root session
arrives in the task row or board snapshot. The current fetch helper then
silently converts that unresolved task scope into `undefined`, which the backend
correctly interprets as a project catalog request. When the root session later
resolves, the same UI surface requests the session catalog. This is a client
ownership bug, not a backend catalog problem.

During visual verification, the request trace exposed a second ownership edge:
task selection can briefly move through `session -> pending -> unavailable ->
pending -> session` while `selectTask()` is hydrating the task. Loading during
the in-progress `taskSwitching` window starts a valid-looking session request
before the selection owner has settled, then the later settled session triggers
the same catalog again. `rootTaskSessionID()` also accepted `boardStore.board`
without checking that the board task matched the selected task, which left a
stale-board route for the same class of bug.

## Fix Plan

1. Build a stable prompt-profile catalog request key in `main.tsx`.
2. When a task is selected, only load after `rootTaskSessionID()` returns a
   non-empty session id.
3. Clear composer prompt-profile options during the selected-task unresolved
   window so the selector cannot display project-scope options as task options.
4. Preserve project catalog loading only for non-task, non-session workspace
   scope.
5. Add tests that pin the no-project-fallback contract and stable key behavior.
6. Rerun focused tests, overlay typecheck/build, and the task-switch visual
   request probe.

## Implementation

| Change | Reason |
| --- | --- |
| Added `services/prompt-profile-scope.ts` as the single catalog scope/key owner. | Keeps directory, selected task, selected session, and catalog revision in one source. |
| Changed `loadPromptProfileCatalog()` to require explicit project/session scope with directory. | Prevents implicit global directory injection and project fallback. |
| Added in-flight coalescing for identical catalog loads. | Removes parallel duplicate fetches without retaining stale catalog results. |
| Moved composer prompt-profile loading to stable semantic request keys. | Prevents broad config/task invalidations from refetching unchanged scope. |
| Updated `PromptCatalog` to use the same scope owner. | Removes a second interpretation of session/project scope in settings. |
| Treat selected task scope as pending while `boardStore.taskSwitching` is true. | Defers loading until task ownership has settled instead of requesting during switch hydration. |
| Updated `rootTaskSessionID()` to read board session only when `board.task.id` matches the selected task. | Blocks stale board snapshots from supplying the current task session. |

## Verification

| Check | Result |
| --- | --- |
| `bun test packages/overlay/test/prompt-profile-task-session-owner.test.ts --timeout 30000` | Passed: 9 tests, 32 assertions. |
| `bun test packages/overlay/test/prompt-profile-config.test.ts packages/overlay/test/general-panel-db-reset.test.ts packages/overlay/test/prompt-catalog-save.test.ts --timeout 30000` | Passed: 15 tests, 90 assertions. |
| `bun run --cwd packages/overlay typecheck` | Passed. |
| `bun run --cwd packages/overlay build:vite` | Passed; only existing Vite warnings for JSX import source, mixed dynamic/static imports, and large chunk. |
| `node packages/overlay/.scratch/task-select-directory-window.mjs` | Passed: `staleRequestCount=0`, `/config/prompt-profile=1`, total request count dropped from 31 to 30 for the measured switch. |
| Visual screenshot | Passed: task list, workflow surface, composer, and prompt-profile selector are visible and not blank or visibly overlapped. |

## Self Review

- No fallback project catalog is used while a selected task root session is
  unresolved.
- No stale catalog result is retained by the service-level in-flight coalescer;
  it only joins the same pending request and clears on settlement.
- Catalog writes explicitly mark the prompt-profile catalog stale, so completed
  request keys advance only after real profile mutations.
- `PromptCatalog` and composer now share the same scope owner instead of
  computing project/session ownership independently.
- The remaining repeated requests are separate surfaces: `/panel/knowledge/memory`
  still appears 5 times and `operator-model-context` still appears twice in the
  same probe. `ScreenshotBrowserPanel` fixed row-height scaling was also found
  by the read-only agent and should be the next UI performance round.

## Acceptance

- Selecting a task with no resolved root session does not request
  `/config/prompt-profile` without `sessionID`.
- Once the task root session resolves, the selector requests the session catalog
  exactly for that session scope.
- Repeated task/task-list invalidations with the same root session and
  prompt-profile config do not refetch.
- No cache, fallback project catalog, gate, route bypass, or second
  prompt-profile source is introduced.
- Focused tests, overlay typecheck/build, real visual QA, self-review, commit,
  and push pass.
