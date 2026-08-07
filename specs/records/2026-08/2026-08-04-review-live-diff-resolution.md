# Review live diff resolution repair

## Recall

| Item                      | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request              | Fix Preview so selecting a changed file opens its diff; the supplied screenshot shows the `chat` group and `specs/README.md` selected while the preview says no preview is available.                                                                                                                                                                                                     |
| Acceptance criteria       | Selecting any live Tool/Patch or persisted Build-observation text change resolves the exact selected row and renders its canonical diff in Review. Existing standalone workspace diff loading continues to use the selected Task's persisted groups.                                                                                                                                      |
| Hard constraints          | Desktop-only repair. Keep one `DiffPreviewPanel`, one `DiffView`, and one change-group projection; do not add a fallback, duplicate renderer, hidden message, gate, or user interface (UI) automated test. Preserve unrelated working-tree changes. Verify the real complete Overlay page and inspect a fresh screenshot manually.                                                        |
| Sources read              | Root `AGENTS.md`; supplied screenshot; `FileChangesView.tsx`; `ChangesPanel.tsx`; `DiffPreviewPanel.tsx`; `DiffView.tsx`; `services/diff.ts`; `utils/file-change-summary.ts`; `FileChangesPanel.tsx`; `main.tsx`; `specs/current/architecture/07-panel.md`; the preceding Review workspace record and indexes.                                                                            |
| Whole-repository grep     | `DiffPreviewPanel` has two production callers: the split Review inventory and the standalone File Changes diff view. `resolveDiff` has the preview caller and one redundant `ChangesPanel` click-prefetch caller. `FileChangesView` receives the merged live plus persisted groups, while `resolveDiff` reconstructs only `currentChangeGroups()`. No other `DiffTarget` resolver exists. |
| Existing-test disposition | `primitives-panel-section.test.ts`, `dead-dialog-cleanup.test.ts`, and `diff-view-engine.test.ts` are prohibited source-string/UI implementation tests encountered while tracing the touched diff components. Delete them without running them. Add only a positive non-UI service contract for resolving an exact file from an explicit live change-group collection.                    |
| Independent review        | Claude Code 2.1.147 was invoked read-only with the required streaming flags but returned `is_error: true` because the local CLI is not logged in. A session-local independent read-only review was dispatched as the available secondary check; the primary agent retains implementation and final review ownership.                                                                      |

## Causal chain

1. `ChangesPanel` correctly merges `currentConversationAgentChangeGroups()` with
   persisted groups and passes that collection into `FileChangesView`.
2. The selected row is converted to a `DiffTarget`, but the collection that
   supplied the row is discarded at the `DiffPreviewPanel` boundary.
3. For ordinary Chats, `activeTaskID()` is empty, and `DiffPreviewPanel` also
   treats that empty Task scope as a reason not to resolve anything even though
   the caller supplied an exact live group collection.
4. `resolveDiff(target)` otherwise searches a newly reconstructed
   `currentChangeGroups()` collection, which intentionally contains persisted
   Build observations but not live Card Tree Tool/Patch changes.
5. A live `chat` row can therefore carry complete `before` and `after` bodies in
   the list and still resolve to `null`, producing the false no-preview state.
6. The root repair is to make the caller's visible change-group collection the
   explicit resolution authority and sufficient scope for that Review surface.
   Standalone persisted diff views continue to require Task scope and use the
   service's canonical current-group default.

## Implementation and verification plan

1. Extend `resolveDiff` with an optional explicit `ChangeGroup[]` resolution
   context and resolve the target only inside that collection.
2. Pass the exact visible `FileChangesView` groups through `DiffPreviewPanel`;
   allow that explicit collection to own ordinary Chat resolution, and keep
   `FileChangesPanel` on the persisted Task-scope default context.
3. Remove the duplicate `ChangesPanel` row-click prefetch and its diagnostics
   path because selection-driven `DiffPreviewPanel` is the sole diff loader.
4. Add a positive service test proving a live agent group with complete text
   bodies resolves to the exact selected file.
5. Update current architecture and both specification indexes; delete the
   directly encountered prohibited UI/source-string tests without running them.
6. Run the focused non-UI contract, Overlay typecheck, localization check,
   production Vite build, documentation health, and `git diff --check`.
7. Start an isolated complete Overlay page without restarting the operator's
   running client, select a real live changed file, capture a fresh screenshot,
   and manually review the rendered diff twice.
8. Review the final diff, commit only task-owned files with the `dsw-33987`
   prefix, fetch/reconcile the tracked legacy remote branch, and push normally.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Allowed verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and legacy remote push complete.

## Verification evidence

- The positive non-UI resolution contract passed with
  `bun test packages/overlay/test/diff-resolution.test.ts`; it resolves the
  selected `agent:chat` group when another group contains the same file path.
- Overlay typecheck, localization validation, and the production Vite build
  passed. The historical documentation-link check passed, as did
  the product-document single-source check, all 60 document-health checks, and
  `git diff --check`.
- The complete Overlay ran in an isolated Vite process against the existing
  healthy local backend and real repository data. No mock, route interception,
  query/data override, fixture page, or UI automated test was used.
- In the real source Chat, Review projected 12 live files. The initial selected
  file rendered 47 diff rows and no no-preview message. Selecting the reported
  `specs/README.md` row changed the preview header to that exact path, rendered
  11 diff rows, and still had no no-preview message.
- Two fresh desktop screenshots were inspected manually. They show the selected
  live `chat` row, canonical line diff, status/count chrome, independent diff
  scroller, and the reported README selection working in the complete product.
- The isolated listener was stopped by its exact port-owning process and port
  4188 was verified free. The operator's running OpenCorvus/Overlay process was
  not restarted, refreshed, or stopped.
