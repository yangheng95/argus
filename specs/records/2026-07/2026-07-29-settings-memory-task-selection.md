# Settings Memory Task Selection

Date: 2026-07-29

Status: Complete

## Recall

- User request: the full-screen Settings page no longer allows selecting a Task, so Memory & Context search cannot be used; adjust the page so the feature works again.
- Acceptance:
  - Memory & Context exposes a visible Task picker inside Settings.
  - The picker searches the canonical Work Ledger and includes standalone Tasks plus Mission child Tasks.
  - Selecting a Task supplies its exact Task ID and owning project directory to the existing `MemoryPanel`; context search, detail expansion, and deletion remain scoped to that pair.
  - The current active Task may seed the picker, but inspecting another Task's memory must not navigate or mutate the active conversation.
  - The empty/error/loading copy describes the in-page action and never instructs the user to click a Work Ledger hidden behind the full-screen dialog.
  - Desktop light-theme interaction is exercised in the real running page and screenshots are reviewed manually.
- Hard constraints:
  - Reuse the existing `loadWorkLedger` contract and shared Kobalte-backed `SelectControl`; do not create another task-list endpoint or hand-built popup.
  - Keep `MemoryPanel` as the sole memory load/search/detail/delete owner.
  - Do not add, modify, update, or run UI automated tests. Run only typecheck/build/static documentation checks for this UI change.
  - Preserve the unrelated dirty change in `packages/overlay/src/styles/surfaces/messages.css`.
  - Do not introduce fallback task identity, synthetic messages, hidden selection state, a workflow gate, or a compatibility path.
- Sources read:
  - `AGENTS.md`
  - Browser control skill
  - supplied Settings screenshot
  - `specs/records/2026-07/2026-07-24-settings-capability-scope-navigation.md`
  - `specs/records/2026-06/2026-06-20-memory-panel-owner-browser-coverage.md`
  - `specs/current/architecture/07-panel.md`
  - `specs/current/architecture/07-panel-reactivity.md`
  - `packages/overlay/src/components/ConfigDialogHost.tsx`
  - `packages/overlay/src/components/MemoryPanel.tsx`
  - `packages/overlay/src/components/WorkLedger.tsx`
  - `packages/overlay/src/components/ui/ComboboxControl.tsx`
  - `packages/overlay/src/components/ui/SelectControl.tsx`
  - `packages/overlay/src/services/work-ledger.ts`
  - `packages/overlay/src/store/board.ts`
  - `packages/overlay/src/styles/surfaces/settings.css`
  - English and Chinese Overlay locale catalogs.
- Whole-repository search:
  - `MemoryPanel` has one production mount, in `ConfigDialogHost`, where it currently receives only `activeTaskID()`.
  - `memory.none_unselected`, `memory.scope_unavailable_title`, and `memory.search_placeholder` are owned by the two locale catalogs; existing source-string and browser UI tests reference the obsolete Work Ledger instruction but are historical UI-test debt and are not modified under the 2026-07-29 UI-test prohibition.
  - `loadWorkLedger` production consumers are `WorkLedger` and `CommandPalette`; it is the canonical typed query for Project, Mission, Task, and Chat ledger rows.
  - `ComboboxControl` production consumers are `CommandPalette` and `ScheduledAutomationsPanel`; `SelectControl` is the shared Kobalte Select shell already used by Settings forms. A bounded point-selection control is sufficient because context text search remains in `MemoryPanel`.
  - The memory HTTP routes remain `panel/knowledge/memory`, `panel/knowledge/memory/search`, and `panel/knowledge/memory/:fileID`; no backend route change is required.
- Independent agent feedback: no child agent was requested, and the repository's delegation boundary permits child agents only when the user explicitly asks for them. The primary agent owns the second review.

## Root Cause

Settings is full-screen, so its Memory page hides the Work Ledger while continuing to derive memory scope exclusively from the global active Task. When no Task was active before Settings opened, the page showed an instruction to use an unavailable control. The search box correctly refused an unowned query; the missing in-page Task inspection target was the upstream fault.

## Design

1. Add a Settings-only `MemoryContextPanel` composition that owns an inspection target `{taskID, directory}`.
2. Populate its shared Select control from `loadWorkLedger`, flattening both standalone Tasks and Mission child Tasks without duplicating a child already present as a top-level row.
3. Seed the target from the active Task when the exact row is available. A later in-page selection changes only the inspection target.
4. Pass the exact target into the existing `MemoryPanel`; keep all memory operations there.
5. Add localized picker/loading/error/empty guidance and Settings-owned CSS for the Select control.
6. Verify typecheck/build and documentation health, then use the real app to select a Task, search its context, and manually review screenshots.

## Call-Point Disposition

| Surface                       | Current use                                 | Disposition                                                                                    |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ConfigDialogHost` memory tab | `MemoryPanel(activeTaskID)`                 | Replace with `MemoryContextPanel`; no other tab changes.                                       |
| `MemoryPanel`                 | Memory HTTP owner                           | Retain; receive exact local Task ID and directory and expose disabled search until both exist. |
| `WorkLedger`                  | Primary full ledger UI                      | Retain unchanged.                                                                              |
| `CommandPalette`              | Bounded ledger search                       | Retain unchanged.                                                                              |
| `loadWorkLedger`              | Typed Work Ledger query                     | Reuse from `MemoryContextPanel`; no new API.                                                   |
| `SelectControl`               | Shared bounded-selection primitive          | Reuse; no second primitive.                                                                    |
| Locale catalogs               | Obsolete hidden-ledger instruction          | Replace with in-page Task-picker guidance and add picker states.                               |
| Existing UI tests             | Source-string/browser assertions for old UI | Do not modify or run under the explicit UI automation prohibition.                             |

## Verification Log

- Baseline `git push legacy-remote HEAD:work-v0.0.24beta-yr-0729`: passed; pre-push SDK import, AI runtime, and workspace typechecks passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bunx turbo run typecheck --filter=@opencorvus-ai/overlay`: passed after concurrent unrelated worktree changes settled.
- `bun run build:vite`: passed; Vite transformed 7,057 modules and emitted only existing bundle-size warnings.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed, 22 tests.
- `bun test --timeout 60000 packages/opencorvus/test/script/document-health.test.ts`: reached the real checker with 62 passing checks; the only failure names the concurrently authored, unrelated, and still-untracked `2026-07-29-codex-task-header-and-ledger-actions.md` record linked by its own worktree change.
- `bun test --timeout 60000 ./packages/opencorvus/test/script/product-docs-single-source.test.ts`: passed, 8 tests.
- Real app verification used the current source on an isolated OpenCorvus home at `http://127.0.0.1:7879/ui/`:
  - Opened full-screen Settings and Memory & Context.
  - Expanded the in-page Task selector and observed two real Tasks from the Work Ledger.
  - Changed from the active Task to `Settings memory context verification`; the conversation behind Settings remained on the original Task.
  - Confirmed the context search box was enabled, searched `context selector verification`, and received `No matching context found` from the real empty Task scope.
  - Manually reviewed the closed selector, open selector, and post-search desktop screenshots. The selector, option metadata, search field, and empty-result state were aligned, readable, and free of the original unavailable-scope warning.
- UI automated tests were intentionally neither modified nor run.
- Second source review confirmed that `MemoryPanel` remains the only memory HTTP owner, the Settings composition owns only the inspection target, and no new backend API, fallback identity, active-conversation mutation, or duplicate picker primitive was introduced.
- Implementation commit `8a7cc8f715` passed the legacy remote pre-push SDK import, AI runtime, full-workspace typecheck, API route inventory, generated API documentation, Overlay i18n, and secret-scan checks, then pushed to `legacy-remote/work-v0.0.24beta-yr-0729`.
