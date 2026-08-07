# Review workspace scroll and layout repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Review the supplied desktop screenshot: the left diff has no scrollbar, the status buttons are clipped, and the split layout should follow the second reference image more closely. |
| Acceptance criteria | The Review workspace keeps a readable file-navigation pane, exposes a visible independent vertical scrollbar for the diff, keeps every status option and the non-text filter fully readable, and preserves file selection plus diff rendering at the supplied desktop scope. |
| Hard constraints | Desktop-only repair. Reuse the existing Solid, Kobalte, SegmentedControl, Listbox, Panel, and DiffView implementations. Do not add or run user interface (UI) automated tests. Do not introduce a fallback, gate, second renderer, fixture-only page, or query/data override. Use a complete real Overlay page, real data, real interaction, screenshots, and human visual review. Preserve unrelated working-tree changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; both supplied screenshots; `FileChangesView.tsx`; `DiffPreviewPanel.tsx`; `DiffView.tsx`; `changes.css`; `diff.css`; `workspace.css`; `activity.css`; `specs/current/architecture/07-panel.md`; August real-page Overlay verification records. |
| Whole-repository grep | Searched production Overlay, current architecture, August records, and focused test paths for Review, `FileChangesView`, split-pane, filter, list, and diff scroll owners. `changes-review-workspace` is the split owner; `changes-diff-pane` currently clips the diff without a vertical scroll owner; `changes-status-strip` keeps every control in one row and horizontally hides the segmented control; the 58/42 split leaves the file pane below its readable content width in the reported Dock. |
| Existing-test disposition | `packages/overlay/test/virtualizer-api-contract.test.ts` is a prohibited UI/source-string test directly encountered through `FileChangesView.tsx`; delete it without running it. No replacement UI test is allowed. Allowed verification is typecheck, build, localization, documentation health, and real-page manual visual acceptance. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | Branch `work-v0.0.29beta-yr-0803` is synchronized with `legacy-remote/work-v0.0.29beta-yr-0803`. Existing uncommitted Browser/native-menu/Review-tab work does not touch the Review workspace component or stylesheet and remains excluded from this delivery. |

## Causal chain

1. The Review surface already has one canonical diff renderer and one canonical
   file list; the defect is not missing data or an alternate presentation need.
2. The five-file state suppresses the file search entirely, while the right-side
   controls are compressed into one horizontal toolbar that does not match the
   reference's searchable inventory hierarchy.
3. The filter strip suppresses the segmented control's horizontal
   scrollbar while the non-text checkbox consumes the same line, making the
   final status option appear clipped rather than intentionally scrollable.
4. The diff pane uses `overflow: hidden` and the nested body expands to its
   content, so tall diffs are clipped by the workspace instead of receiving an
   independent vertical scroll owner.
5. The root repair is one desktop split contract: a bounded diff scroller, an
   always-searchable file inventory, and a wrapping toolbar whose complete
   controls remain visible.

## Implementation and verification plan

1. Preserve the canonical desktop split while the diff pane owns its own
   bounded vertical and horizontal overflow.
2. Let the status strip wrap the existing mature controls and keep the complete
   SegmentedControl visible; preserve its labels, counts, Checkbox, and events.
3. Keep the file list as the sole right-pane scroller and make the diff pane the
   sole left-pane scroller; verify both scroll independently with real content.
4. Record the layout ownership in current architecture and update the root and
   monthly spec indexes.
5. Delete the directly encountered prohibited source-string UI test without
   running it.
6. Run Overlay typecheck, localization check, production Vite build,
   documentation health, and `git diff --check`; do not run UI tests.
7. Start the complete Overlay page on a task-owned port, open Review with real
   repository changes, interact with the filters and both scroll regions,
   capture fresh screenshots, and personally review the result twice.
8. Commit only task-owned files with the `dsw-33987` prefix, fetch/reconcile the
   tracked legacy remote branch, and push through the normal hook.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Allowed verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and legacy remote push complete.

## Verification evidence

- The complete Overlay opened against the real local backend and repository on
  task-owned port `4187`; no mock, route interception, query override, or
  alternate renderer was used.
- Review task `tsk_fc7c84b38001bCJUynteHpGfOX` exposed the reported five-file
  `base-developer` group and commit `6ee982801f65`. Selecting the added August
  record rendered its real 2,334-pixel-tall, 2,915-pixel-wide diff.
- The repaired diff scrollport measured 330 by 1,210 client pixels. Computer
  interaction moved its vertical position from 0 to 760 while the file list
  remained fixed; horizontal scrolling also moved independently and both axes
  were restored to the origin afterward.
- At the widest locally available Review Dock, search, `All 5`, `Modified 4`,
  `Added 1`, `Deleted 0`, and `Hide non-text` were all visible. At the canonical
  narrow Dock width, the same controls wrapped into complete rows rather than
  clipping. Activating `Added 1` reduced the real inventory to the one added
  file, and `All 5` restored the complete list.
- Two fresh screenshots were inspected manually: once after scrolling into the
  long diff and once at the restored origin. The themed vertical scrollbar,
  complete controls, searchable right pane, selection state, and split boundary
  all matched the intended desktop hierarchy.
- `bun run --cwd packages/overlay typecheck`, `check:i18n`, and `build:vite`
  passed. Historical-link and product-document single-source checks passed, as
  did `git diff --check`. A broad document-health run reached 58 passing checks;
  its remaining timeout and untracked Browser-annotation record belong to the
  concurrent Browser task and do not originate in this Review change.
- Product commit `01d96becd0` reached
  `legacy-remote/work-v0.0.29beta-yr-0803`; the normal pre-push SDK import, AI runtime,
  monorepo typecheck, API route, documentation, Overlay localization, and secret
  checks all passed.
