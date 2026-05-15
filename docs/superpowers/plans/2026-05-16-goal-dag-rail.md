# Goal DAG Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlay's sticky "floating" goal progress strip with a non-sticky, low-resource git-graph DAG rail that renders real `depends_on` edges.

**Architecture:** Backend surfaces `dependsOn` (plus the already-projected-but-unschemaed `goalRunID`/`acceptanceSpecs`) on `TaskBoardGoalWorkflow`. A pure `layoutDag()` util turns goals + edges into deterministic SVG geometry via greedy interval-column routing (no state machine, no rAF, no canvas). The `TaskProgressBar` component is renamed `GoalDagRail` and re-rendered as an inline SVG rail; old bar/pill markup + CSS are deleted outright (no dual source).

**Tech Stack:** TypeScript, SolidJS, Bun test, Zod, drizzle (SQLite), `@hey-api/openapi-ts` SDK generation.

**Spec:** `docs/superpowers/specs/2026-05-16-goal-dag-rail-design.md` (codex-APPROVED).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/opencorvus/src/engine/model.ts` | `TaskBoardGoalWorkflow` schema — add `dependsOn`, `goalRunID`, `acceptanceSpecs` | Modify L804-832 |
| `packages/opencorvus/src/workbench/board.ts` | `goalWorkflows` projection — emit `dependsOn` | Modify ~L926 |
| `packages/opencorvus/test/workbench/board.test.ts` | projection test | Modify (append test) |
| `packages/opencorvus/test/workbench/board-goal-worktree-schema.test.ts` | schema round-trip test | Modify (append test) |
| `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/*` | regenerated contract | Regenerate |
| `packages/opencorvus/test/workbench/sdk-goal-dag-contract.test.ts` | SDK/OpenAPI contract test | Create |
| `packages/overlay/src/utils/goal-dag-layout.ts` | pure DAG geometry (`layoutDag`) | Create |
| `packages/overlay/test/goal-dag-layout.test.ts` | layout unit tests | Create |
| `packages/overlay/src/components/GoalDagRail.tsx` | rail component (renamed from `TaskProgressBar.tsx`) | Rename + rewrite |
| `packages/overlay/src/components/Conversation.tsx` | import/usage | Modify L4,L164 |
| `packages/overlay/src/utils/goal-state.ts` | doc comment | Modify L4 |
| `packages/overlay/src/i18n/en-US.json`, `zh-CN.json` | `progress.*` → `goal_dag.*` | Modify L783-789 |
| `packages/overlay/src/styles/surfaces/card.css` | `.task-progress*` → `.goal-dag*`, non-sticky, animations | Modify L1397-1531 |
| `packages/overlay/test/goal-dag-rail.test.ts` | render + i18n + css/source guards | Create |
| `packages/overlay/test/redesign-visual.html` | fixture rename | Modify L42-74 |
| `docs/product/{en,zh-CN}/overlay/overview.md` | component-map row | Modify L52 |
| `packages/web/src/content/docs/{,zh-cn/}overlay/overview.mdx` | component-map row | Modify L55 |
| `packages/opencorvus/test/server/overlay-contract.test.ts` | stale comment | Modify L126 |

---

## Task 1: Backend schema + projection for `dependsOn`

**Files:**
- Modify: `packages/opencorvus/src/engine/model.ts:804-832`
- Modify: `packages/opencorvus/src/workbench/board.ts` (~L926, return object)
- Test: `packages/opencorvus/test/workbench/board-goal-worktree-schema.test.ts`
- Test: `packages/opencorvus/test/workbench/board.test.ts`

- [ ] **Step 1: Write the failing schema test**

Append to `packages/opencorvus/test/workbench/board-goal-worktree-schema.test.ts`:

```ts
describe("TaskBoardGoalWorkflow — DAG edges + projected contract fields", () => {
  test("dependsOn defaults to [] when omitted and round-trips", () => {
    const shape = TaskBoardGoalWorkflow.shape
    expect(shape.dependsOn).toBeDefined()
    const parsed = TaskBoardGoalWorkflow.parse({
      goalID: "g1",
      goalTitle: "t",
      goalStatus: "running",
      orderIndex: 0,
      retryCount: 0,
      priority: "blocking",
      steps: [],
    })
    expect(parsed.dependsOn).toEqual([])
    const withDeps = TaskBoardGoalWorkflow.parse({
      goalID: "g2",
      goalTitle: "t2",
      goalStatus: "pending",
      orderIndex: 1,
      retryCount: 0,
      priority: "blocking",
      steps: [],
      dependsOn: ["g1"],
    })
    expect(withDeps.dependsOn).toEqual(["g1"])
  })

  test("goalRunID and acceptanceSpecs are schema-declared (no dual-source drift)", () => {
    const shape = TaskBoardGoalWorkflow.shape
    expect(shape.goalRunID).toBeDefined()
    expect(shape.acceptanceSpecs).toBeDefined()
    const parsed = TaskBoardGoalWorkflow.parse({
      goalID: "g3",
      goalTitle: "t3",
      goalStatus: "passed",
      orderIndex: 2,
      retryCount: 1,
      priority: "blocking",
      steps: [],
      goalRunID: "run_abc",
      acceptanceSpecs: [],
    })
    expect(parsed.goalRunID).toBe("run_abc")
    expect(parsed.acceptanceSpecs).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencorvus && bun test test/workbench/board-goal-worktree-schema.test.ts`
Expected: FAIL — `shape.dependsOn` / `shape.goalRunID` / `shape.acceptanceSpecs` undefined.

- [ ] **Step 3: Add the schema fields**

In `packages/opencorvus/src/engine/model.ts`, inside `export const TaskBoardGoalWorkflow = z.object({ ... })` (L804). `AcceptanceSpecSchema` is already imported at L32. Add after the `goalID`/`goalTitle` block and alongside the existing fields (place `dependsOn` near `orderIndex`, `goalRunID` near `goalID`, `acceptanceSpecs` near `priority`):

```ts
  /** Goal IDs this goal depends on (DAG edges). Mirrors
   *  EngineGoalTable.depends_on. [] = no prerequisites (parallelisable). */
  dependsOn: z.array(z.string()).default([]),
  /** Tip/delivered goal_run id the overlay's per-row diff fetch anchors to.
   *  Already emitted by board.ts:928 — schema-declared here to kill the
   *  pre-existing dual-source drift (rule 8/16). */
  goalRunID: z.string().optional(),
  /** Typed acceptance specs surfaced for the goal card drawer. Already
   *  emitted by board.ts:949 — schema-declared here (rule 8/16). */
  acceptanceSpecs: z.array(AcceptanceSpecSchema).optional(),
```

- [ ] **Step 4: Run schema test to verify it passes**

Run: `cd packages/opencorvus && bun test test/workbench/board-goal-worktree-schema.test.ts`
Expected: PASS (all tests including the pre-existing workspaceDir ones).

- [ ] **Step 5: Write the failing projection test**

Append to `packages/opencorvus/test/workbench/board.test.ts`:

```ts
test("compileBoard surfaces depends_on as goalWorkflows[].dependsOn", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_dag_${now}`
  const taskID = `tsk_${now.toString(16)}DagEdges`

  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID, worktree: tmp.path, name: "DAG edges",
      sandboxes: "[]", time_created: now, time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID, project_id: projectID, source: "test",
      title: "DAG edges", request: "edges", priority: "normal",
      time_created: now, time_updated: now,
    }).run(),
  )
  const { EngineGoalTable } = await import("../../src/engine/engine.sql")
  Database.use((db) =>
    db.insert(EngineGoalTable).values([
      { id: "gol_a", task_id: taskID, title: "A", slug: "a", objective: "A",
        order_index: 0, depends_on: [], time_created: now, time_updated: now },
      { id: "gol_b", task_id: taskID, title: "B", slug: "b", objective: "B",
        order_index: 1, depends_on: ["gol_a"], time_created: now, time_updated: now },
    ]).run(),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID })
      const gws = board.goalWorkflows ?? []
      const a = gws.find((g) => g.goalID === "gol_a")
      const b = gws.find((g) => g.goalID === "gol_b")
      expect(a?.dependsOn).toEqual([])
      expect(b?.dependsOn).toEqual(["gol_a"])
    },
  })
})
```

- [ ] **Step 6: Run projection test to verify it fails**

Run: `cd packages/opencorvus && bun test test/workbench/board.test.ts -t "surfaces depends_on"`
Expected: FAIL — `b.dependsOn` is `undefined` (projection does not emit it yet).

- [ ] **Step 7: Emit `dependsOn` in the projection**

In `packages/opencorvus/src/workbench/board.ts`, in the `goals.map(goal => { ... return { ... } })` object (the `return {` at ~L926), add this line next to `acceptanceSpecs: goal.acceptance_specs,`:

```ts
      dependsOn: goal.depends_on,
```

(`goal.depends_on` is already a parsed `string[]` — drizzle `text({mode:"json"})`.)

- [ ] **Step 8: Run both backend tests to verify they pass**

Run: `cd packages/opencorvus && bun test test/workbench/board.test.ts test/workbench/board-goal-worktree-schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/opencorvus/src/engine/model.ts packages/opencorvus/src/workbench/board.ts packages/opencorvus/test/workbench/board.test.ts packages/opencorvus/test/workbench/board-goal-worktree-schema.test.ts
git commit -m "feat(board): surface goal dependsOn + schema-declare goalRunID/acceptanceSpecs"
```

---

## Task 2: Regenerate SDK/OpenAPI + contract test

**Files:**
- Regenerate: `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/*`
- Test: `packages/opencorvus/test/workbench/sdk-goal-dag-contract.test.ts` (create)

- [ ] **Step 1: Write the failing contract test**

Create `packages/opencorvus/test/workbench/sdk-goal-dag-contract.test.ts`:

```ts
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../..")
const openapi = JSON.parse(
  readFileSync(join(ROOT, "packages/sdk/openapi.json"), "utf8"),
)

function goalWorkflowProps(schemaName: string): Record<string, unknown> {
  const schema = openapi.components?.schemas?.[schemaName]
  if (!schema) throw new Error(`missing schema ${schemaName}`)
  const gw = schema.properties?.goalWorkflows
  const item = gw?.items ?? gw?.anyOf?.flatMap((a: any) => a.items ?? []).find(Boolean)
  if (!item?.properties) throw new Error(`${schemaName}.goalWorkflows has no item properties`)
  return item.properties
}

test("TaskBoardGoalWorkflow contract exposes dependsOn/goalRunID/acceptanceSpecs", () => {
  const props = goalWorkflowProps("TaskBoardGoalWorkflow")
  expect(props.dependsOn).toBeDefined()
  expect(props.goalRunID).toBeDefined()
  expect(props.acceptanceSpecs).toBeDefined()
})

test("generated SDK types declare dependsOn on goalWorkflows", () => {
  const types = readFileSync(
    join(ROOT, "packages/sdk/js/src/gen/types.gen.ts"), "utf8",
  )
  expect(types).toContain("dependsOn")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencorvus && bun test test/workbench/sdk-goal-dag-contract.test.ts`
Expected: FAIL — `props.dependsOn` undefined (stale generated `openapi.json`).

- [ ] **Step 3: Regenerate the SDK/OpenAPI via the project generator**

Run (NOT by hand — this runs `bun dev generate > openapi.json` in opencorvus then `@hey-api/openapi-ts`):

```bash
cd packages/sdk/js && bun run build
```

- [ ] **Step 4: Run the contract test + routes check to verify they pass**

Run: `cd packages/opencorvus && bun test test/workbench/sdk-goal-dag-contract.test.ts`
Expected: PASS.
Run: `bun run api:routes-check` (from repo root)
Expected: exit 0 (tracked openapi matches generated).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/openapi.json packages/sdk/js/src/gen packages/opencorvus/test/workbench/sdk-goal-dag-contract.test.ts
git commit -m "chore(sdk): regenerate contract with goal dependsOn fields + contract test"
```

---

## Task 3: Pure DAG layout util (`layoutDag`)

**Files:**
- Create: `packages/overlay/src/utils/goal-dag-layout.ts`
- Test: `packages/overlay/test/goal-dag-layout.test.ts`

- [ ] **Step 1: Write the failing layout tests**

Create `packages/overlay/test/goal-dag-layout.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { layoutDag, type DagNode } from "../src/utils/goal-dag-layout";

function n(goalID: string, index: number, dependsOn: string[] = [], state: DagNode["state"] = "pending"): DagNode {
  return { goalID, index, attempt: 0, title: goalID, state, dependsOn };
}

describe("layoutDag", () => {
  test("linear chain → every edge is adjacent (column 0)", () => {
    const { rows, edges } = layoutDag([
      n("a", 0), n("b", 1, ["a"]), n("c", 2, ["b"]),
    ]);
    expect(rows.map((r) => r.goalID)).toEqual(["a", "b", "c"]);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.column === 0)).toBe(true);
  });

  test("diamond → the two overlapping spanning edges get distinct columns", () => {
    // a→b, a→c, b→d, c→d ; rows: a=0,b=1,c=2,d=3
    const { edges } = layoutDag([
      n("a", 0), n("b", 1, ["a"]), n("c", 2, ["a"]), n("d", 3, ["b", "c"]),
    ]);
    const spanning = edges.filter((e) => Math.abs(e.to - e.from) > 1);
    // a→c (rows 0..2) and b→d (rows 1..3) overlap → must not share a column
    const ac = spanning.find((e) => e.from === 0 && e.to === 2)!;
    const bd = spanning.find((e) => e.from === 1 && e.to === 3)!;
    expect(ac.column).toBeGreaterThan(0);
    expect(bd.column).toBeGreaterThan(0);
    expect(ac.column).not.toBe(bd.column);
  });

  test("isolated nodes → zero edges", () => {
    const { edges } = layoutDag([n("a", 0), n("b", 1), n("c", 2)]);
    expect(edges).toHaveLength(0);
  });

  test("unknown dependsOn id → that edge is skipped", () => {
    const { edges } = layoutDag([n("a", 0), n("b", 1, ["ghost"])]);
    expect(edges).toHaveLength(0);
  });

  test("edge into a running node is marked hot", () => {
    const { edges } = layoutDag([n("a", 0, [], "passed"), n("b", 1, ["a"], "running")]);
    expect(edges[0].hot).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/overlay && bun test test/goal-dag-layout.test.ts`
Expected: FAIL — module `../src/utils/goal-dag-layout` not found.

- [ ] **Step 3: Implement `layoutDag`**

Create `packages/overlay/src/utils/goal-dag-layout.ts`:

```ts
// ── goal-dag-layout ──
// Pure geometry for the Goal DAG (directed acyclic graph) rail. Input is the
// goal node list; output is deterministic rows + routed edges. No DOM, no
// getBoundingClientRect, no canvas, no timers, no retained state — it is a
// referentially-transparent function (CLAUDE.md rules 5/6/13). Complexity is
// O(E·C) with C ≤ E (edge-column interval colouring), fine for goal counts.

import type { GoalState } from "./goal-state";

export interface DagNode {
  goalID: string;
  index: number; // orderIndex — stable decomposition position
  attempt: number; // retryCount
  title: string;
  state: GoalState;
  dependsOn: string[];
}

export interface DagEdge {
  from: number; // row index of the dependency
  to: number; // row index of the dependent
  /** 0 = adjacent, drawn on the primary rail. ≥1 = routed edge column. */
  column: number;
  /** target node is running — drives the animated "flow" stroke. */
  hot: boolean;
}

export interface DagLayout {
  rows: DagNode[];
  edges: DagEdge[];
  /** number of horizontal columns to reserve (1 = rail only). */
  columns: number;
}

export function layoutDag(nodes: DagNode[]): DagLayout {
  const rows = [...nodes].sort((a, b) => a.index - b.index);
  const rowByGoal = new Map<string, number>();
  rows.forEach((node, row) => rowByGoal.set(node.goalID, row));

  interface Raw { from: number; to: number; lo: number; hi: number; hot: boolean }
  const raw: Raw[] = [];
  rows.forEach((node, to) => {
    for (const dep of node.dependsOn) {
      const from = rowByGoal.get(dep);
      if (from === undefined) continue; // unknown dependency id → skip (defensive)
      raw.push({
        from,
        to,
        lo: Math.min(from, to),
        hi: Math.max(from, to),
        hot: node.state === "running",
      });
    }
  });

  // Greedy interval-graph colouring for non-adjacent (spanning) edges so two
  // edges that vertically overlap never share a column.
  const spanning = raw
    .filter((e) => e.hi - e.lo > 1)
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const columnLastHi: number[] = [];
  const columnOf = new Map<Raw, number>();
  for (const e of spanning) {
    let placed = -1;
    for (let c = 0; c < columnLastHi.length; c++) {
      if (columnLastHi[c] < e.lo) { placed = c; break; }
    }
    if (placed === -1) { placed = columnLastHi.length; columnLastHi.push(e.hi); }
    else { columnLastHi[placed] = e.hi; }
    columnOf.set(e, placed + 1); // +1: column 0 is reserved for the primary rail
  }

  const edges: DagEdge[] = raw.map((e) => ({
    from: e.from,
    to: e.to,
    column: e.hi - e.lo > 1 ? (columnOf.get(e) ?? 1) : 0,
    hot: e.hot,
  }));

  const columns = edges.reduce((max, e) => Math.max(max, e.column), 0) + 1;
  return { rows, edges, columns };
}

// ── SVG path helper (deterministic from from/to/column) ──
export function dagEdgePath(
  e: DagEdge,
  opts: { x0: number; rowH: number; branchGap: number; colGap: number },
): string {
  const { x0, rowH, branchGap, colGap } = opts;
  const y1 = e.from * rowH + rowH / 2;
  const y2 = e.to * rowH + rowH / 2;
  if (e.column === 0) {
    const my = (y1 + y2) / 2;
    return `M ${x0} ${y1} C ${x0} ${my}, ${x0} ${my}, ${x0} ${y2}`;
  }
  const ex = x0 + branchGap + (e.column - 1) * colGap;
  return `M ${x0} ${y1} C ${ex} ${y1}, ${ex} ${y2}, ${x0} ${y2}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/overlay && bun test test/goal-dag-layout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/src/utils/goal-dag-layout.ts packages/overlay/test/goal-dag-layout.test.ts
git commit -m "feat(overlay): pure layoutDag geometry with edge-column routing"
```

---

## Task 4: Rename `TaskProgressBar` → `GoalDagRail` (skeleton) + all surfaces

This task does the rename + i18n move with the OLD bar/pill markup still intact, so the app keeps compiling. The DAG render replaces the body in Task 5.

**Files:**
- Rename: `packages/overlay/src/components/TaskProgressBar.tsx` → `GoalDagRail.tsx`
- Modify: `packages/overlay/src/components/Conversation.tsx:4,164`
- Modify: `packages/overlay/src/utils/goal-state.ts:4`
- Modify: `packages/overlay/src/i18n/en-US.json:783-789`, `zh-CN.json:783-789`
- Modify: `packages/overlay/src/styles/surfaces/card.css:1397-1531` (selector prefix only this task)
- Modify: `packages/overlay/test/redesign-visual.html:42-74`
- Modify: `docs/product/en/overlay/overview.md:52`, `docs/product/zh-CN/overlay/overview.md:52`
- Modify: `packages/web/src/content/docs/overlay/overview.mdx:55`, `packages/web/src/content/docs/zh-cn/overlay/overview.mdx:55`
- Modify: `packages/opencorvus/test/server/overlay-contract.test.ts:126`

- [ ] **Step 1: Move the file and rename the export**

```bash
git mv packages/overlay/src/components/TaskProgressBar.tsx packages/overlay/src/components/GoalDagRail.tsx
```

In `GoalDagRail.tsx`: change `export function TaskProgressBar()` → `export function GoalDagRail()`. Update the top `// ── TaskProgressBar ──` comment block header to `// ── GoalDagRail ──` and add a one-line glossary: `// DAG = directed acyclic graph (goals + depends_on edges).` Replace every `t("progress.heading")` → `t("goal_dag.heading")`, `t("progress.summary", …)` → `t("goal_dag.summary", …)`, and the `t(\`progress.goal.${state}\`)` template → `t(\`goal_dag.node.${state}\`)`. Replace every CSS class string `task-progress` → `goal-dag` (e.g. `class="task-progress"` → `class="goal-dag"`, `task-progress__pill` → `goal-dag__pill`, etc.).

- [ ] **Step 2: Update the Conversation import + usage**

In `packages/overlay/src/components/Conversation.tsx`:
- L4: `import { TaskProgressBar } from "./TaskProgressBar";` → `import { GoalDagRail } from "./GoalDagRail";`
- L164: `<TaskProgressBar />` → `<GoalDagRail />`

- [ ] **Step 3: Rename i18n keys in both locales**

In `packages/overlay/src/i18n/en-US.json` replace L783-789 with:

```json
  "goal_dag.heading": "Goals",
  "goal_dag.node.pending": "{{title}} — pending",
  "goal_dag.node.running": "{{title}} — running",
  "goal_dag.node.passed": "{{title}} — passed",
  "goal_dag.node.failed": "{{title}} — failed",
  "goal_dag.node.blocked": "{{title}} — blocked",
  "goal_dag.summary": "{{passed}}/{{total}} passed · {{failed}} failed · {{running}} running",
```

In `packages/overlay/src/i18n/zh-CN.json` replace L783-789 with:

```json
  "goal_dag.heading": "目标",
  "goal_dag.node.pending": "{{title}} — 待开始",
  "goal_dag.node.running": "{{title}} — 进行中",
  "goal_dag.node.passed": "{{title}} — 已通过",
  "goal_dag.node.failed": "{{title}} — 已失败",
  "goal_dag.node.blocked": "{{title}} — 阻塞",
  "goal_dag.summary": "{{passed}}/{{total}} 通过 · {{failed}} 失败 · {{running}} 进行中",
```

(Keys must keep the file's existing alphabetical/grouping order if the i18n linter enforces it — place the `goal_dag.*` block where `progress.*` was; if a sort check fails, move the block to satisfy it.)

- [ ] **Step 4: Prefix the CSS selectors (rename only — body rewrite is Task 6)**

In `packages/overlay/src/styles/surfaces/card.css` L1397-1531, replace every `.task-progress` occurrence with `.goal-dag` (e.g. `.task-progress` → `.goal-dag`, `.task-progress__pill[data-state="running"]` → `.goal-dag__pill[data-state="running"]`, `@keyframes task-progress-pulse` → `@keyframes goal-dag-pulse` and its one reference). Use a scoped find/replace within those lines only.

- [ ] **Step 5: Update doc/fixture/comment surfaces**

- `docs/product/en/overlay/overview.md:52` and `docs/product/zh-CN/overlay/overview.md:52`: replace the `TaskProgressBar` cell text and `src/components/TaskProgressBar.tsx` path with `GoalDagRail` / `src/components/GoalDagRail.tsx`.
- `packages/web/src/content/docs/overlay/overview.mdx:55` and `packages/web/src/content/docs/zh-cn/overlay/overview.mdx:55`: replace the stale `WorkflowProgressBar` row with `GoalDagRail` / `src/components/GoalDagRail.tsx`.
- `packages/overlay/test/redesign-visual.html:42-74`: replace `task-progress` class strings with `goal-dag` and any `TaskProgressBar` label with `GoalDagRail`.
- `packages/opencorvus/test/server/overlay-contract.test.ts:126`: comment `WorkflowProgressBar` → `GoalDagRail`.
- `packages/overlay/src/utils/goal-state.ts:4`: comment `TaskProgressBar pills` → `GoalDagRail nodes`.

- [ ] **Step 6: Typecheck + run the affected suites**

Run: `cd packages/overlay && bun run typecheck`
Expected: exit 0.
Run: `cd packages/opencorvus && bun test test/server/overlay-contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/overlay/src/components/GoalDagRail.tsx packages/overlay/src/components/Conversation.tsx packages/overlay/src/utils/goal-state.ts packages/overlay/src/i18n packages/overlay/src/styles/surfaces/card.css packages/overlay/test/redesign-visual.html docs/product packages/web/src/content/docs packages/opencorvus/test/server/overlay-contract.test.ts
git commit -m "refactor(overlay): rename TaskProgressBar → GoalDagRail across all surfaces"
```

---

## Task 5: Render the DAG rail (replace bar/pill body)

**Files:**
- Modify: `packages/overlay/src/components/GoalDagRail.tsx`
- Test: `packages/overlay/test/goal-dag-rail.test.ts` (create — render assertions)

- [ ] **Step 1: Write the failing render test**

Create `packages/overlay/test/goal-dag-rail.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "../src/components/GoalDagRail.tsx"), "utf8",
);

describe("GoalDagRail component", () => {
  test("renders an SVG rail driven by layoutDag, not a linear bar or pill row", () => {
    expect(SRC).toContain("layoutDag");
    expect(SRC).toContain("dagEdgePath");
    expect(SRC).toContain("<svg");
    expect(SRC).not.toContain("goal-dag__bar");
    expect(SRC).not.toContain("goal-dag__pill");
  });

  test("marks the running node and hot edges for the animation hooks", () => {
    expect(SRC).toMatch(/data-state=/);
    expect(SRC).toContain("goal-dag__edge--hot");
  });

  test("preserves click-to-scroll behaviour", () => {
    expect(SRC).toContain("findGoalCardID");
    expect(SRC).toContain("scrollIntoView");
  });

  test("no rAF / timers / canvas / DOM measurement in the rail", () => {
    for (const banned of [
      "requestAnimationFrame", "setInterval", "setTimeout",
      "<canvas", "getBoundingClientRect",
    ]) {
      expect(SRC).not.toContain(banned);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/overlay && bun test test/goal-dag-rail.test.ts`
Expected: FAIL — `layoutDag` / `<svg` absent (still bar/pill markup).

- [ ] **Step 3: Rewrite the component body to render the DAG**

Replace the full contents of `packages/overlay/src/components/GoalDagRail.tsx` with:

```tsx
// ── GoalDagRail ──
//
// DAG = directed acyclic graph (goals + depends_on edges). Inline (NON-sticky)
// rail rendered as the first child of the conversation timeline; it scrolls
// with the conversation. Reads boardStore.board.goalWorkflows and renders a
// git-graph-style vertical rail: one node per goal, SVG connectors for every
// depends_on edge, routed into non-overlapping columns by the pure
// layoutDag() util. No rAF, no canvas, no timers — geometry is recomputed
// only on board delta via a Solid memo (CLAUDE.md rules 5/6/13).
//
// We do NOT mutate cardTreeStore here — spec 07 requires tree-writer to be
// the single writer. This is a derived view of boardStore + cardTreeStore
// (scroll-target lookup only).

import { For, Show, createMemo } from "solid-js";
import { boardStore } from "../store/board";
import { cardTreeStore } from "../store/card-tree";
import { t } from "../utils/i18n";
import { goalRevisionLabelFromIndexes } from "../utils/goal-label";
import { goalState } from "../utils/goal-state";
import { layoutDag, dagEdgePath, type DagNode } from "../utils/goal-dag-layout";

const ROW_H = 30;
const X0 = 14;
const BRANCH_GAP = 16;
const COL_GAP = 14;
const DOT_R = 5;

function nodeLabel(state: DagNode["state"], title: string): string {
  // Static template so the i18n linter sees "goal_dag.node" referenced.
  return t(`goal_dag.node.${state}`, { title });
}

function findGoalCardID(goalID: string): string | undefined {
  const ids = cardTreeStore.order;
  for (let i = ids.length - 1; i >= 0; i--) {
    const card = cardTreeStore.cards[ids[i]];
    if (!card) continue;
    if (card.goalID === goalID) return card.id;
  }
  return undefined;
}

export function GoalDagRail() {
  const nodes = createMemo<DagNode[]>(() => {
    const list = (boardStore.board as any)?.goalWorkflows;
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.map((g: any, i: number): DagNode => ({
      goalID: String(g?.goalID || `goal-${i}`),
      index: typeof g?.orderIndex === "number" ? g.orderIndex : i,
      attempt: typeof g?.retryCount === "number" ? g.retryCount : 0,
      title: String(g?.goalTitle || "").trim() || `Goal ${i + 1}`,
      state: goalState(g),
      dependsOn: Array.isArray(g?.dependsOn) ? g.dependsOn.map(String) : [],
    }));
  });

  const layout = createMemo(() => layoutDag(nodes()));

  const counts = createMemo(() => {
    let passed = 0, failed = 0, running = 0;
    for (const n of nodes()) {
      if (n.state === "passed") passed++;
      else if (n.state === "failed") failed++;
      else if (n.state === "running") running++;
    }
    return { passed, failed, running, total: nodes().length };
  });

  const hasGoals = () => nodes().length > 0;

  const width = () => X0 + BRANCH_GAP + Math.max(0, layout().columns - 1) * COL_GAP + DOT_R + 2;
  const height = () => layout().rows.length * ROW_H;

  const onNodeClick = (goalID: string) => {
    const cardID = findGoalCardID(goalID);
    if (!cardID) return;
    const escaped = (window as any).CSS?.escape
      ? (window as any).CSS.escape(cardID) : cardID;
    const node = document.querySelector(`[data-card-id="${escaped}"]`) as HTMLElement | null;
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Show when={hasGoals()} fallback={null}>
      <div
        class="goal-dag"
        role="region"
        aria-label={t("goal_dag.heading")}
        data-running={counts().running > 0 ? "true" : undefined}
      >
        <div class="goal-dag__header">
          <span class="goal-dag__heading">{t("goal_dag.heading")}</span>
          <span
            class="goal-dag__summary"
            title={t("goal_dag.summary", {
              passed: String(counts().passed),
              failed: String(counts().failed),
              running: String(counts().running),
              total: String(counts().total),
            })}
          >
            {counts().passed}/{counts().total}
          </span>
        </div>
        <div class="goal-dag__rail" style={{ height: `${height()}px` }}>
          <svg
            class="goal-dag__svg"
            width={width()}
            height={height()}
            viewBox={`0 0 ${width()} ${height()}`}
            aria-hidden="true"
          >
            <For each={layout().edges}>
              {(e) => (
                <path
                  class={`goal-dag__edge${e.hot ? " goal-dag__edge--hot" : ""}`}
                  d={dagEdgePath(e, { x0: X0, rowH: ROW_H, branchGap: BRANCH_GAP, colGap: COL_GAP })}
                />
              )}
            </For>
          </svg>
          <For each={layout().rows}>
            {(node, i) => (
              <button
                type="button"
                class="goal-dag__node"
                data-state={node.state}
                style={{ height: `${ROW_H}px`, "padding-left": `${X0 + DOT_R + 8}px` }}
                title={nodeLabel(node.state, node.title)}
                aria-label={nodeLabel(node.state, node.title)}
                onClick={() => onNodeClick(node.goalID)}
              >
                <span
                  class="goal-dag__dot"
                  data-state={node.state}
                  aria-hidden="true"
                  style={{ left: `${X0 - DOT_R}px`, top: `${i() * 0 + (ROW_H - DOT_R * 2) / 2}px` }}
                />
                <span class="goal-dag__id">
                  {goalRevisionLabelFromIndexes(node.index, node.attempt)}
                </span>
                <span class="goal-dag__title">{node.title}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
```

- [ ] **Step 4: Run render test to verify it passes**

Run: `cd packages/overlay && bun test test/goal-dag-rail.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd packages/overlay && bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/overlay/src/components/GoalDagRail.tsx packages/overlay/test/goal-dag-rail.test.ts
git commit -m "feat(overlay): render goal DAG rail (SVG nodes + routed edges)"
```

---

## Task 6: CSS — non-sticky surface, animations, delete old bar/pill

**Files:**
- Modify: `packages/overlay/src/styles/surfaces/card.css` (the `.goal-dag*` block, ex-L1397-1531)
- Test: `packages/overlay/test/goal-dag-rail.test.ts` (append css/i18n guards)

- [ ] **Step 1: Append the failing css/i18n guard tests**

Append to `packages/overlay/test/goal-dag-rail.test.ts`:

```ts
describe("GoalDagRail CSS + i18n guards", () => {
  const css = readFileSync(
    join(import.meta.dir, "../src/styles/surfaces/card.css"), "utf8",
  );
  function ruleBody(selector: string): string {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`${esc}\\s*\\{([\\s\\S]*?)\\}`));
    if (!m) throw new Error(`missing selector ${selector}`);
    return m[1] || "";
  }

  test(".goal-dag is NOT sticky/floating", () => {
    const body = ruleBody(".goal-dag");
    expect(body).not.toContain("position: sticky");
    expect(body).not.toContain("top:");
    expect(body).not.toContain("backdrop-filter");
    expect(body).not.toMatch(/z-index:\s*var\(--ui-z-sticky\)/);
  });

  test("old bar/pill markup + keyframe are gone", () => {
    for (const dead of [
      ".task-progress", ".goal-dag__bar", ".goal-dag__bar-fill",
      ".goal-dag__bar-fail", ".goal-dag__pill", "task-progress-pulse",
    ]) {
      expect(css).not.toContain(dead);
    }
  });

  test("animations exist and are gated behind prefers-reduced-motion", () => {
    expect(css).toContain("@keyframes goal-dag-flow");
    expect(css).toContain("@keyframes goal-dag-pulse");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("no stale TaskProgressBar/WorkflowProgressBar references in rename surfaces", () => {
    const surfaces = [
      "../src/components/GoalDagRail.tsx",
      "../src/components/Conversation.tsx",
      "../src/utils/goal-state.ts",
      "../test/redesign-visual.html",
    ];
    for (const rel of surfaces) {
      const txt = readFileSync(join(import.meta.dir, rel), "utf8");
      expect(txt).not.toContain("TaskProgressBar");
      expect(txt).not.toContain("WorkflowProgressBar");
    }
  });

  test("i18n: progress.* gone, goal_dag.* present in BOTH locales", () => {
    for (const loc of ["en-US", "zh-CN"]) {
      const j = readFileSync(join(import.meta.dir, `../src/i18n/${loc}.json`), "utf8");
      expect(j).not.toContain('"progress.heading"');
      expect(j).not.toContain('"progress.goal.');
      expect(j).not.toContain('"progress.summary"');
      expect(j).toContain('"goal_dag.heading"');
      expect(j).toContain('"goal_dag.node.running"');
      expect(j).toContain('"goal_dag.summary"');
    }
  });
});
```

- [ ] **Step 2: Run guards to verify they fail**

Run: `cd packages/overlay && bun test test/goal-dag-rail.test.ts`
Expected: FAIL — `.goal-dag` still has `position: sticky`; no `goal-dag-flow`; old `.goal-dag__bar*`/`.goal-dag__pill*` still present.

- [ ] **Step 3: Replace the CSS block**

In `packages/overlay/src/styles/surfaces/card.css`, replace the entire `.goal-dag*` block (the ex-`.task-progress` region, ~L1397-1531 — from `.goal-dag {` through the closing of `@keyframes goal-dag-pulse`) with:

```css
.goal-dag {
  margin: 0 0 var(--card-gap) 0;
  padding: calc(8px * var(--ui-scale, 1)) calc(10px * var(--ui-scale, 1));
  background: color-mix(in srgb, var(--card-bg-1) 92%, var(--bg));
  border: var(--oc-border-width) solid var(--card-border);
  border-radius: var(--oc-radius-soft);
  display: flex;
  flex-direction: column;
  gap: calc(6px * var(--ui-scale));
  font-size: var(--card-meta-size);
  color: var(--text-soft);
}

.goal-dag__header {
  display: flex;
  align-items: baseline;
  gap: calc(8px * var(--ui-scale));
}
.goal-dag__heading {
  font-weight: var(--ui-font-weight-strong);
  letter-spacing: var(--ui-letter-spacing-loose);
  text-transform: uppercase;
  color: var(--text-muted);
  font-size: calc(var(--card-meta-size) - calc(1px * var(--ui-scale)));
}
.goal-dag__summary {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-strong);
  font-weight: var(--ui-font-weight-strong);
}

.goal-dag__rail {
  position: relative;
  width: 100%;
}
.goal-dag__svg {
  position: absolute;
  inset: 0 auto 0 0;
  pointer-events: none;
  overflow: visible;
}
.goal-dag__edge {
  fill: none;
  stroke: var(--card-border-strong, var(--card-border));
  stroke-width: 1.5;
  transition: stroke var(--ui-duration-base) var(--ui-timing-standard);
}
.goal-dag__edge--hot {
  stroke: color-mix(in srgb, var(--good) 80%, transparent);
  stroke-dasharray: 4 4;
  animation: goal-dag-flow 1.1s linear infinite;
}

.goal-dag__node {
  position: relative;
  display: flex;
  align-items: center;
  gap: calc(6px * var(--ui-scale));
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--text-soft);
  font-size: calc(var(--card-meta-size) - calc(0.5px * var(--ui-scale)));
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: color var(--ui-duration-base) var(--ui-timing-standard);
}
.goal-dag__node:hover { color: var(--text-strong); }
.goal-dag__dot {
  position: absolute;
  width: calc(10px * var(--ui-scale));
  height: calc(10px * var(--ui-scale));
  border-radius: 50%;
  background: var(--card-bg-0);
  border: var(--oc-border-width) solid var(--card-border-strong, var(--card-border));
  transition: background-color var(--ui-duration-base) var(--ui-timing-standard),
    border-color var(--ui-duration-base) var(--ui-timing-standard);
}
.goal-dag__id {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: var(--ui-font-weight-strong);
  letter-spacing: var(--ui-letter-spacing-loose);
  font-size: calc(var(--card-meta-size) - calc(1px * var(--ui-scale)));
  color: color-mix(in srgb, var(--text-muted) 92%, var(--text-soft));
}
.goal-dag__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-dag__dot[data-state="passed"] {
  background: color-mix(in srgb, var(--good) 60%, var(--card-bg-0));
  border-color: color-mix(in srgb, var(--good) 70%, var(--card-border));
}
.goal-dag__dot[data-state="failed"] {
  background: color-mix(in srgb, var(--bad) 55%, var(--card-bg-0));
  border-color: color-mix(in srgb, var(--bad) 65%, var(--card-border));
}
.goal-dag__dot[data-state="running"] {
  background: color-mix(in srgb, var(--warn) 55%, var(--card-bg-0));
  border-color: color-mix(in srgb, var(--warn) 70%, var(--card-border));
  animation: goal-dag-pulse 2s ease-in-out infinite;
}
.goal-dag__dot[data-state="blocked"] {
  background: color-mix(in srgb, var(--warn) 35%, var(--card-bg-0));
  border-color: color-mix(in srgb, var(--warn) 55%, var(--card-border));
}
.goal-dag__node[data-state="pending"] { opacity: var(--ui-opacity-dim); }

@keyframes goal-dag-flow {
  to { stroke-dashoffset: -16; }
}
@keyframes goal-dag-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn) 30%, transparent); }
  50% { box-shadow: 0 0 0 calc(4px * var(--ui-scale)) color-mix(in srgb, var(--warn) 5%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .goal-dag__edge--hot,
  .goal-dag__dot[data-state="running"] {
    animation: none;
  }
}
```

- [ ] **Step 4: Run the full GoalDagRail suite to verify it passes**

Run: `cd packages/overlay && bun test test/goal-dag-rail.test.ts test/goal-dag-layout.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `cd packages/overlay && bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/overlay/src/styles/surfaces/card.css packages/overlay/test/goal-dag-rail.test.ts
git commit -m "feat(overlay): non-sticky goal DAG rail CSS + reduced-motion, delete old bar/pill"
```

---

## Task 7: Full verification + push

**Files:** none (verification only).

- [ ] **Step 1: Typecheck both packages**

Run: `cd packages/overlay && bun run typecheck && cd ../opencorvus && bun run typecheck`
Expected: exit 0 for both.

- [ ] **Step 2: Run every test touched by this plan**

Run:
```bash
cd packages/overlay && bun test test/goal-dag-layout.test.ts test/goal-dag-rail.test.ts
cd ../opencorvus && bun test test/workbench/board.test.ts test/workbench/board-goal-worktree-schema.test.ts test/workbench/sdk-goal-dag-contract.test.ts test/server/overlay-contract.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Run the contract/doc gates the pre-push hook enforces**

Run (from repo root): `bun run api:routes-check && bun run docs:check`
Expected: exit 0 for both. If `docs:check` reports the API md is stale, run `bun run docs:api` and commit the regenerated `docs/product/{en,zh-CN}/reference/api.md`.

- [ ] **Step 4: Visual confirmation (rule 25 — visual change must be shown visually)**

Start the overlay dev server and a benchmark/eval task that produces ≥3 goals with at least one `depends_on` edge (see `MEMORY.md` → Benchmark Workflow). Confirm in the browser: the rail is at the top of the conversation, scrolls away with the timeline (not sticky), shows nodes + connectors, the running node pulses, the hot edge animates, and clicking a node scrolls to its card. Capture a screenshot for the delivery report.

- [ ] **Step 5: Push**

```bash
git push
```
Expected: pre-push hook (bun version + `bun typecheck` + `api:routes-check` + `docs:check`) passes. If it fails, fix the root cause — do NOT pass `--no-verify` (CLAUDE.md rule 33).

---

## Self-Review

- **Spec coverage:** §1 backend → Task 1 + 2; §2 component/rename → Task 4 + 5; §3 geometry → Task 3; §4 animation + reduced-motion → Task 6; §5 non-sticky → Task 6 (CSS) + Task 5 (no sticky markup); §6 no-dual-source (delete old) → Task 6; all spec test items → Tasks 1,2,3,5,6; visual (rule 25) → Task 7 Step 4. No gaps.
- **Placeholder scan:** every code/CSS/test step contains full content; no TBD/TODO.
- **Type consistency:** `DagNode`/`DagEdge`/`DagLayout`, `layoutDag`, `dagEdgePath` are defined in Task 3 and consumed with the same signatures in Task 5; i18n keys `goal_dag.heading|node.<state>|summary` consistent across Tasks 3-implementation, 4 (json), 5 (component), 6 (guard); CSS classes `.goal-dag__{header,heading,summary,rail,svg,edge,edge--hot,node,dot,id,title}` consistent between Task 5 markup and Task 6 CSS.
