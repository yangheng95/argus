// Runtime behaviour tests for the extracted lineage helpers.
// Covers spec acceptance criteria #7 (tree assembly), #8 (orphan fallback
// based on filtered set), #9 (cycle guard), #10 (cross-directory nesting),
// and #11 (original-group dedup).
//
// Spec: docs/superpowers/specs/2026-05-27-task-tree-display.md.

import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test"
import { buildTaskTree, flattenGroup } from "../src/components/taskTree"

function item(id: string, parentTaskID: string | null = null, directory = "/repo", status = "queued") {
  return {
    task: {
      id,
      parentTaskID,
      directory,
      status,
      title: id,
      time: { created: 0, updated: 0 },
    },
  }
}

const projectDirectoryOf = (it: any) => it?.task?.directory ?? ""

let warnSpy: ReturnType<typeof spyOn> | undefined
beforeAll(() => {
  warnSpy = spyOn(console, "warn").mockImplementation(() => undefined)
})
afterAll(() => {
  warnSpy?.mockRestore()
  mock.restore()
})

describe("buildTaskTree — basic lineage assembly (#7)", () => {
  test("a chain A → B → C produces nested childMap and a single top-level entry", () => {
    const A = item("A")
    const B = item("B", "A")
    const C = item("C", "B")
    const D = item("D")
    const shape = buildTaskTree([A, B, C, D])

    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["A", "D"])
    expect(shape.childMap.get("A")?.map((i) => i.task.id)).toEqual(["B"])
    expect(shape.childMap.get("B")?.map((i) => i.task.id)).toEqual(["C"])
    expect(shape.cycleVictims.size).toBe(0)
  })

  test("multiple siblings under the same parent preserve input order", () => {
    const P = item("P")
    const C1 = item("C1", "P")
    const C2 = item("C2", "P")
    const C3 = item("C3", "P")
    const shape = buildTaskTree([P, C1, C2, C3])
    expect(shape.childMap.get("P")?.map((i) => i.task.id)).toEqual(["C1", "C2", "C3"])
  })
})

describe("buildTaskTree — orphan fallback on filtered set (#8)", () => {
  test("child whose parent is missing from input renders as top-level", () => {
    // Simulates the case where searchQuery filtered out the parent
    // but matched the child: child must still be visible.
    const child = item("orphan", "ghost_parent")
    const shape = buildTaskTree([child])
    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["orphan"])
    expect(shape.childMap.size).toBe(0)
  })

  test("child with parentTaskID=null renders as top-level", () => {
    const A = item("A", null)
    const shape = buildTaskTree([A])
    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["A"])
  })

  test("grandchild whose intermediate parent is filtered out still attaches to the visible grandparent if direct? — no, edge requires direct parent", () => {
    // The contract is direct-parent only — a grandchild whose parent
    // is filtered out becomes top-level (does NOT skip a level to
    // attach to the grandparent). Documents the chosen semantics.
    const A = item("A")
    const C = item("C", "B") // B not in input
    const shape = buildTaskTree([A, C])
    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["A", "C"])
    expect(shape.childMap.has("A")).toBe(false)
  })
})

describe("buildTaskTree — cycle guard (#9)", () => {
  test("two-node cycle A→B→A: both members render top-level with a console.warn", () => {
    const A = item("A", "B")
    const B = item("B", "A")
    const shape = buildTaskTree([A, B])
    expect(shape.topLevelItems.map((i) => i.task.id).sort()).toEqual(["A", "B"])
    expect(shape.cycleVictims.has("A")).toBe(true)
    expect(shape.cycleVictims.has("B")).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
  })

  test("self-loop (A.parent = A): A renders top-level, no infinite recursion", () => {
    const A = item("A", "A")
    const shape = buildTaskTree([A])
    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["A"])
    expect(shape.cycleVictims.has("A")).toBe(true)
  })

  test("long chain A→B→C→D→A: every node is a victim", () => {
    const A = item("A", "D")
    const B = item("B", "A")
    const C = item("C", "B")
    const D = item("D", "C")
    const shape = buildTaskTree([A, B, C, D])
    expect(shape.cycleVictims.has("A")).toBe(true)
    expect(shape.cycleVictims.has("B")).toBe(true)
    expect(shape.cycleVictims.has("C")).toBe(true)
    expect(shape.cycleVictims.has("D")).toBe(true)
    expect(shape.topLevelItems.map((i) => i.task.id).sort()).toEqual(["A", "B", "C", "D"])
  })

  test("very long acyclic chain still terminates", () => {
    // Stress the parent-walk loop: 200-deep chain.
    const items: any[] = []
    for (let i = 0; i < 200; i++) {
      items.push(item(`task_${i}`, i === 0 ? null : `task_${i - 1}`))
    }
    const shape = buildTaskTree(items)
    expect(shape.cycleVictims.size).toBe(0)
    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["task_0"])
  })
})

describe("flattenGroup — depth-first emit + default collapsed (#10, #11)", () => {
  test("default-collapsed render contains only top-level rows, depth=0", () => {
    const A = item("A")
    const B = item("B", "A")
    const shape = buildTaskTree([A, B])
    const entries = flattenGroup(shape.topLevelItems, "/repo", shape.childMap, new Set(), projectDirectoryOf)
    expect(entries).toHaveLength(1)
    expect(entries[0].item.task.id).toBe("A")
    expect(entries[0].depth).toBe(0)
    expect(entries[0].directChildren.map((i: any) => i.task.id)).toEqual(["B"])
    expect(entries[0].expanded).toBe(false)
  })

  test("expanded parent emits its direct children with depth=1", () => {
    const A = item("A")
    const B = item("B", "A")
    const shape = buildTaskTree([A, B])
    const entries = flattenGroup(shape.topLevelItems, "/repo", shape.childMap, new Set(["A"]), projectDirectoryOf)
    expect(entries.map((e) => [e.item.task.id, e.depth])).toEqual([
      ["A", 0],
      ["B", 1],
    ])
    expect(entries[0].expanded).toBe(true)
  })

  test("grandchildren stay collapsed when only the root is expanded", () => {
    const A = item("A")
    const B = item("B", "A")
    const C = item("C", "B")
    const shape = buildTaskTree([A, B, C])
    const entries = flattenGroup(
      shape.topLevelItems,
      "/repo",
      shape.childMap,
      new Set(["A"]), // only A expanded; B not expanded
      projectDirectoryOf,
    )
    expect(entries.map((e) => e.item.task.id)).toEqual(["A", "B"])
    expect(entries.find((e) => e.item.task.id === "B")?.expanded).toBe(false)
  })

  test("expanding every ancestor yields the full chain at increasing depth", () => {
    const A = item("A")
    const B = item("B", "A")
    const C = item("C", "B")
    const shape = buildTaskTree([A, B, C])
    const entries = flattenGroup(shape.topLevelItems, "/repo", shape.childMap, new Set(["A", "B"]), projectDirectoryOf)
    expect(entries.map((e) => [e.item.task.id, e.depth])).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", 2],
    ])
  })

  test("cross-directory child is flagged when nested into a different group's directory", () => {
    const parent = item("P", null, "/repo-A")
    const child = item("CH", "P", "/repo-B")
    const shape = buildTaskTree([parent, child])
    const entries = flattenGroup(shape.topLevelItems, "/repo-A", shape.childMap, new Set(["P"]), projectDirectoryOf)
    const childEntry = entries.find((e) => e.item.task.id === "CH")!
    expect(childEntry.crossDirectory).toBe(true)
    expect(childEntry.depth).toBe(1)
  })

  test("same-directory child has crossDirectory=false", () => {
    const parent = item("P", null, "/repo")
    const child = item("CH", "P", "/repo")
    const shape = buildTaskTree([parent, child])
    const entries = flattenGroup(shape.topLevelItems, "/repo", shape.childMap, new Set(["P"]), projectDirectoryOf)
    const childEntry = entries.find((e) => e.item.task.id === "CH")!
    expect(childEntry.crossDirectory).toBe(false)
  })
})

describe("Original-group dedup (#11) — nested children appear once", () => {
  test("a same-directory nested child does NOT also appear in the directory's top-level entries", () => {
    // buildTaskTree returns top-level items minus nested children;
    // flattening produces nested children only via their parent's
    // subtree. End-to-end dedup invariant: each task id surfaces
    // exactly once in the union of every group's flatten output,
    // regardless of expansion state.
    const A = item("A", null, "/repo")
    const B = item("B", "A", "/repo")
    const shape = buildTaskTree([A, B])
    const collapsed = flattenGroup(shape.topLevelItems, "/repo", shape.childMap, new Set(), projectDirectoryOf)
    const expanded = flattenGroup(shape.topLevelItems, "/repo", shape.childMap, new Set(["A"]), projectDirectoryOf)

    expect(collapsed.map((e) => e.item.task.id)).toEqual(["A"])
    expect(expanded.map((e) => e.item.task.id)).toEqual(["A", "B"])
    // top-level set never contains B even when collapsed
    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["A"])
  })

  test("cross-directory nested child is hidden from its own directory's top-level", () => {
    // Both groups should only see the nested child via its parent's
    // subtree — the directory the child literally belongs to does
    // not re-render it as a top-level row.
    const parent = item("P", null, "/repo-A")
    const child = item("CH", "P", "/repo-B")
    const shape = buildTaskTree([parent, child])
    expect(shape.topLevelItems.map((i) => i.task.id)).toEqual(["P"])
  })
})
