# Task Tree Display — Design

Date: 2026-05-27
Status: Draft v3 — second codex pass folded in, user-locked decisions re-confirmed, ready for implementation

## Problem

The overlay task list (`packages/overlay/src/components/TaskList.tsx`) currently renders tasks as a flat list grouped by project directory. When a task is launched from another task (e.g. orchestrator `propose_task` writes `metadata.parent_task_id`), that lineage is invisible — the spawned task appears as a sibling in its own directory group, with no indication that it has a parent.

The user wants tasks-that-launched-other-tasks shown in a file-tree style: child tasks indented directly under their parent, regardless of which directory they belong to.

## Locked decisions (user)

Initial answers (v1):
1. **Lineage scope**: future-proof — any task with `metadata.parent_task_id` is treated as a child. UI does not bind to a specific spawning entrypoint.
2. **Nesting visual**: indented directly under parent (classic tree). Children are removed from their original directory group to avoid duplication.
3. **Default expand**: originally chosen as "expand all by default, arbitrary depth". **Revised by user after codex v2 review** (this session): **default collapsed**, one-level expand on chevron click. User explicitly accepted the scope change.
4. **Cross-directory**: child follows parent. If child's `directory` differs from parent's, it still nests under parent.
5. **Parent-row badge** (re-confirmed after codex v2): `▷ N` count + run-pulse for active descendants + fail-color for failed descendants. **Full scope kept** — codex v2 caught that v2 spec had silently deferred run-pulse and fail-color; user re-confirmed they must ship in this round.
6. **Lineage field placement** (decided after codex v2): nested as `task.parentTaskID` (camelCase), matching the existing convention of ID fields inside the `task` model (`projectID`, `sessionID`, `requestID`).

## Codex adjudication

### First pass (v1 → v2)

Codex flagged six issues; all folded in:

1. **"唯一写入点" was wrong** — `propose_task` is only the hardcoded write site (`packages/opencorvus/src/orchestrator/tools.ts:4931`). Any caller of `CreateTaskInput.metadata` (`engine/model.ts:260`) can write `parent_task_id`: `POST /tasks` (`server/routes/orchestrator.ts:145`), panel `create_task` (`tool/panel.ts:222`), persistence path `task-api/index.ts:747` → `pipeline.ts:99`. UI treats the field as generic lineage marker.
2. **Wrong type extended** — v1 changed internal `TaskListRow` (`engine/store.ts:172`) which is not the API contract. Contract surface is `ProjectTaskSummary` (`engine/model.ts:881-910`), mirrored to `packages/sdk/openapi.json` (`12689-12775`, `13347-13435`) and `packages/sdk/js/src/gen/types.gen.ts` (`8122-8233`, `8267-8378`).
3. **rule 35 grep incomplete** — v1 missed `ProjectTaskSummary`, missed `findChildrenOfTask()` (`engine/store.ts:223-235`) + panel `query_task includeChildren` (`tool/panel.ts:123-150`) using same source, missed `pipeline.ts:99-115` metadata persistence.
4. **Cross-directory + drag-reorder conflict** — drag handler closes over `group.directory`. If a directory-B child renders inside group A, drag would call `reorderTaskQueue` with the wrong directory.
5. **Default-expand + no-quota would blow compact limit** — `COMPACT_GROUP_VISIBLE_LIMIT = 5` (`TaskList.tsx:16`) bounds total rendered rows.
6. **Orphan fallback must run after frontend filtering** — search/filter is frontend-only (`TaskList.tsx:517-544`).

### Second pass (v2 → v3)

Codex returned **REJECT** on v2, flagging four new issues. All resolved here:

1. **v2 unilaterally inverted user's default-expand decision** — codex caught that v2 changed default to collapsed without user consent. User has now explicitly confirmed default-collapsed in this session.
2. **`parentTaskID` at `ProjectTaskSummary` top level violates naming convention** — top-level fields are snake_case (`pending_interactions`, `updated_at` at `engine/model.ts:887-888`); camelCase IDs live inside the nested `task` model (`projectID/sessionID/requestID` at `engine/model.ts:263-301`). v3 places the field at `task.parentTaskID`.
3. **Drag idiom was wrong** — v2 said "`draggable={false}` + no `onDragStart` handler"; actual idiom is row-level `TaskRow.canDrag` prop (defined `TaskList.tsx:264`, computed `:290`, applied as `draggable={canDrag()}` at `:327`, with handler at `:329-344` that early-returns when `!canDrag()`). v3 uses the existing idiom.
4. **v2 silently deferred run-pulse + fail-color** — user originally selected these. User re-confirmed full badge scope this session.
5. **Panel `children` shape was mis-described** — `findChildrenOfTask()` returns `string[]` (direct child IDs), not a nested tree. v3 corrects the description.
6. **SSE chain was wrong** — actual chain is `services/events.ts:817-838` → `scheduleTasksCompat()` (`events.ts:740-745`) → `loadTasks()`. v3 corrects rule 35 grep table.

## Design

### 1. Backend — surface `parentTaskID` on the nested task model

- **`TaskModel` schema** (`packages/opencorvus/src/engine/model.ts`, in the section defining `projectID/sessionID/requestID` etc, around `:263-301`): add `parentTaskID: z.string().nullable().optional()`. This is the contract surface; ID fields conventionally live on the nested `task` model.
- **`viewTask()` projection** (`packages/opencorvus/src/engine/store.ts:1490-1529`): hoist `metadata.parent_task_id` to `task.parentTaskID`. **Read-only projection** — `metadata.parent_task_id` remains the single source of truth (rule 8 — no dual-source). No new column, no migration.
- **Internal `TaskListRow`** (`engine/store.ts:172-176`): **unchanged**. Not the API surface. `taskItems()` already returns `{ task, project, … }` where `task` is the projected `TaskModel`; the new field rides on `task` automatically.
- **OpenAPI / SDK regen** (rule 36, contract sync): after schema change, regenerate `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/types.gen.ts`. Both `ProjectBoard` and `GlobalTaskBoard` task shapes (currently at `openapi.json:12689-12775` and `:13347-13435`) must show `parentTaskID` nested under `task`.
- **Do not** modify `findChildrenOfTask()` (`engine/store.ts:223-235`) or `propose_task` (`orchestrator/tools.ts:4931`) — they stay unchanged. Lineage source is `metadata.parent_task_id`.
- **Panel `query_task includeChildren` stays orthogonal** — that path returns `children: string[]` (direct child IDs) for agent reconciliation. Overlay does not consume this; overlay assembles its own tree from flat `task.parentTaskID`. Both surfaces read from the same `metadata.parent_task_id` source, so there is no dual-source — only two different read projections for two different consumers.

### 2. Frontend — tree assembly from filtered flat list

- After existing `sortedItems()` and `searchQuery` filtering (`TaskList.tsx:517-544`), build a `parentID → children[]` map.
- Tree assembly happens in a derived `createMemo` inside `TaskList.tsx`, not in a separate store.
- **Orphan fallback** (per codex finding v1#6): a task with `task.parentTaskID` set but whose parent is **not in the currently visible/filtered set** falls back to top-level in its own directory group. Logic runs on `sortedItems()` (the filtered set), not on raw `visibleTasks()`.
- **Cycle guard**: while assembling, track visited IDs. On detected cycle, break the back-edge, log a `console.warn`, render all cycle nodes top-level.

### 3. UI behavior

#### 3.1 Rendering rules

- **Indented under parent**: each nesting level adds 16px left padding to the task row.
- **Cross-directory follows parent**: a child whose `task.directory ≠ parent.task.directory` still renders under parent.
- **Original-group dedup**: a nested child does **not** also appear in its own directory group.
- **Cross-directory drag is disabled via `canDrag`**: For nested children rendered in a parent group whose `task.directory` differs from `group.directory`, `canDrag` (computed at `TaskList.tsx:290`) must return `false`. The `onDragStart` handler at `:329-344` already early-returns when `!canDrag()` — no separate guard needed. Drag handle is hidden by the existing `canDrag()`-gated CSS / render path.

#### 3.2 Depth and expand state — default collapsed (user-confirmed)

- **Default state**: children are **collapsed**. Parent row shows a chevron + badge.
- **One-level expand on click**: clicking the chevron expands direct children. Grandchildren remain collapsed under their own row until clicked individually.
- **Expand state**: per-session only — a `createSignal<Set<string>>` keyed by task id inside `TaskList.tsx`. Local-storage persistence is out of scope.
- **Compact quota** (`COMPACT_GROUP_VISIBLE_LIMIT = 5` at `TaskList.tsx:16`): top-level row count bounded as before. Expanded subtrees add rows beyond the quota only on explicit user action — acceptable because the default render is collapsed.

#### 3.3 Parent-row badge — full scope (user re-confirmed)

- **`▷ N`**: N = direct-child count (not recursive).
- **Run-pulse**: if any direct child has `status === "active"`, the badge gets a subtle pulsing dot (reuse the existing active-state pulse animation if present; otherwise add a 1.5s opacity-pulse keyframe scoped to this badge).
- **Fail-color**: if any direct child has `status === "failed"`, the badge tone is danger (reuse `.s-tone-danger` from `feedback_overlay_no_kill`-era settings primitives if available, otherwise the project's existing failure color token).
- Run-pulse and fail-color combine: if a direct child is failed AND another is active, both signals show.
- Aggregation is over **direct children only**, not recursive descendants (avoid ambiguity; user previously confirmed this scope).

### 4. Out of scope (deferred to follow-up)

- Cross-directory inline "belongs to X/" text label on the child row (drag is disabled; an icon can hint, but no text tag).
- Local-storage persistence of expand state.
- Lazy loading of deep subtrees.
- Manual "spawn child task" UI entrypoint.
- ASCII tree connector lines.
- Recursive-descendant aggregation in the parent badge (only direct children aggregated).

## rule 35 — call-site grep table (v3, corrected)

| Symbol | Sites verified |
|---|---|
| `metadata.parent_task_id` write | `orchestrator/tools.ts:4931` (only hardcoded site); generic metadata pass-through via `engine/model.ts:260` → `task-api/index.ts:747` → `pipeline.ts:99-115` |
| `metadata.parent_task_id` read | `engine/store.ts:223-235` (`findChildrenOfTask()`, returns `string[]` of direct child IDs); `tool/panel.ts:123-150` (`query_task includeChildren`, uses same helper) — both unchanged |
| `TaskModel` schema | `engine/model.ts:263-301` (nested camelCase ID fields) — **edit here** to add `parentTaskID` |
| `viewTask()` projection | `engine/store.ts:1490-1529` — **edit here** to hoist `metadata.parent_task_id` → `task.parentTaskID` |
| `taskItems()` (carrier of `task` field) | `task-api/index.ts:626-644` — **no edit needed**; `task.parentTaskID` rides on the existing `task` object |
| `ProjectTaskSummary` (envelope) | `engine/model.ts:881-910` — **no edit needed**; new field lives on the inner `task` model |
| OpenAPI / SDK mirrors | `packages/sdk/openapi.json:12689-12775`, `:13347-13435`; `packages/sdk/js/src/gen/types.gen.ts:8122-8233`, `:8267-8378` — regen via codegen |
| Internal `TaskListRow` | `engine/store.ts:172-176` — **unchanged**, intentionally |
| `COMPACT_GROUP_VISIBLE_LIMIT` | `TaskList.tsx:16` defined; used `:774-776`, `:831` — semantics unchanged |
| `TaskRow.canDrag` prop | `TaskList.tsx:264` (prop declaration), `:290` (computed), `:327` (`draggable={canDrag()}`), `:329-344` (early-return in `onDragStart`) — **edit `canDrag` computation** to also gate on cross-directory mismatch |
| `handleDrop()` (closes over `group.directory`) | `TaskList.tsx:624-646`; `:825` is the call-site that supplies `group.directory` |
| `TaskSection` `canReorder` (section-level) | `TaskList.tsx:488` — unchanged |
| Search/filter site | `TaskList.tsx:517-544` (in `sortedItems`) — orphan fallback must run after this |
| Task-list SSE | overlay event chain: `services/events.ts:817-838` → `scheduleTasksCompat()` at `events.ts:740-745` → `void loadTasks()` at `events.ts:744`. `loadTasks()` defined at `store/board.ts:447-453` (does not pass query) |
| Queue badges (creation-time order) | `TaskList.tsx:548-558` — read-only, no change |
| Grouping by directory | `TaskList.tsx:561-585` — dedup happens here when child is in tree |

## Acceptance criteria (rule 36)

### Backend

1. **`TaskModel` schema parse test**: zod parse accepts `parentTaskID: null | string | undefined`; missing field defaults to undefined.
2. **`viewTask()` projection test**: given a task with `metadata.parent_task_id = "tsk_abc"`, `viewTask()` returns `{..., parentTaskID: "tsk_abc"}`; given metadata without the key, `parentTaskID` is undefined.
3. **OpenAPI/SDK sync test** (rule 36): `api:routes-check` and `docs:check` pre-push hooks pass after schema edit. SDK regen produces `parentTaskID` inside `task` in both `ProjectBoard` and `GlobalTaskBoard` shapes. Explicit `rg parentTaskID packages/sdk` after regen must return non-zero hits.
4. **`/tasks` and `/global/tasks` HTTP tests**: response payload contains `task.parentTaskID` field.
5. **Generic metadata write integration test**: `POST /tasks` with `metadata: { parent_task_id: "tsk_xyz" }` produces a task whose list-API response has `task.parentTaskID === "tsk_xyz"`. **This is the generic-input proof, separate from the `propose_task`-specific test.**
6. **Panel `query_task includeChildren` contract test** (unchanged-behavior assertion): given a parent and one `metadata.parent_task_id` child, `query_task({ id, includeChildren: true })` still returns `children: ["<child_id>"]` as `string[]`. **Prevents overlay-side changes from breaking the agent contract.**

### Frontend

7. **Tree assembly unit test**: given a flat list `[A, B(parent=A), C(parent=B), D]`, assembly produces `[A → [B → [C]], D]`.
8. **Orphan fallback test**: given `[A, B(parent=A)]` with `searchQuery` matching only B, B renders at top level in its own group (parent not in filtered set).
9. **Cycle guard test**: given `[A(parent=B), B(parent=A)]`, both render top-level with a `console.warn` logged; no infinite recursion.
10. **Cross-directory nesting test**: child with `directory: "/foo"` parent with `directory: "/bar"` — child renders nested under parent in group `/bar`, not in group `/foo`.
11. **Original-group dedup test** (explicit assertion): for both same-directory and cross-directory nested children, assert the child task id appears exactly once in the rendered DOM (no duplication between nested position and its original directory group).

### Interaction

12. **Default-collapsed test**: on initial render, all subtrees are collapsed; parent rows show `▷ N` badge with correct N.
13. **One-level expand test**: clicking a parent's chevron shows direct children; grandchildren remain collapsed until their own chevron is clicked.
14. **Run-pulse badge test**: when a direct child has `status === "active"`, the parent's badge shows the pulse animation; when all children are non-active, no pulse.
15. **Fail-color badge test**: when a direct child has `status === "failed"`, the parent's badge has the danger tone class.
16. **Cross-directory drag disabled test** (idiom-correct): mount a child row with `task.directory ≠ group.directory`, assert the row's `canDrag` evaluates to `false`, the rendered element has `draggable === false`, and triggering a `dragstart` does not set `draggingID`. **Do not** assert handler absence — the handler is mounted but early-returns.
17. **Same-directory reorder regression test**: a normal (non-nested) queued task in its own directory group still drags/reorders correctly — `reorderTaskQueue` is called with the right `directory`. Prevents regression from #16.
18. **Compact quota interaction**: a directory with 6 top-level tasks still hides one behind "Show more"; expanding any subtree does not affect the top-level cap.

### Real-time path

19. **SSE reload integration**: dispatch a `task.created` (or whatever event reaches `scheduleTasksCompat()` at `events.ts:817-838`) for a child task; assert `loadTasks()` is called and on next render the new tree appears with correct nesting.

## Risks acknowledged

- **Contract regen forgotten**: if developer edits `TaskModel` but skips OpenAPI/SDK regen, frontend reads `undefined`. Mitigation: pre-push hook (`docs:check`, `api:routes-check`) is the existing guard; acceptance #3 explicitly asserts post-regen SDK contents.
- **Metadata write drift** (key casing): future code may write `parent_task_id` with a different casing (e.g. `parentTaskId`). `viewTask()` reads exact `metadata.parent_task_id` — a casing variant would silently lose lineage. Mitigation: extract a constant `PARENT_TASK_ID_METADATA_KEY = "parent_task_id"` in the engine package, used by both the writer (`propose_task`) and the reader (`viewTask()`). Out of v3 first-pass scope but **recommended follow-up**; if user wants it in v3 first pass, say so.
- **Quota interaction surprise**: many top-level + many expanded children may push the list very long once user expands. Acceptable given default-collapsed; could add per-subtree cap later if pain emerges.
