// Frontend acceptance tests for the task tree display feature.
// Spec: docs/superpowers/specs/2026-05-27-task-tree-display.md §Acceptance criteria.
//
// The tree-assembly logic lives as a Solid `createMemo` inside TaskList,
// which is the right scope (per-component lifecycle, no extra abstraction
// — rule 5/6). These tests lock the contract via source-string assertions
// on TaskList.tsx + the related CSS / i18n files, the same idiom used by
// task-list-creation-time.test.ts and task-row-mini-*.test.ts.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const TASK_LIST = readFileSync(join(import.meta.dir, "../src/components/TaskList.tsx"), "utf8")
const SIDEBAR_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/sidebar.css"), "utf8")
const EN_JSON = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")
const ZH_JSON = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")

describe("TaskList reads task.parentTaskID as the lineage source", () => {
  test("reads task.parentTaskID, not metadata.parent_task_id directly", () => {
    // The frontend consumes the hoisted camelCase field on the task
    // object — it MUST NOT poke into raw metadata to reconstruct
    // lineage (rule 8 — single read source per consumer).
    expect(TASK_LIST).toContain("task?.parentTaskID")
    expect(TASK_LIST).not.toMatch(/metadata\??\.parent_task_id/)
  })
})

describe("Tree memo + flattenGroup are present and used", () => {
  test("declares a `tree` memo with childMap + topLevelItems shape", () => {
    expect(TASK_LIST).toMatch(/tree\s*=\s*createMemo<\{\s*childMap:\s*Map<string,\s*any\[\]>;\s*topLevelItems:\s*any\[\]/)
  })

  test("derives directory groups from tree().topLevelItems, not raw sortedItems()", () => {
    // Orphan fallback works because top-level items are computed
    // post-filter, so anything whose parent is filtered out (or
    // missing) is treated as a top-level row.
    expect(TASK_LIST).toContain("for (const item of tree().topLevelItems)")
  })

  test("flattens each group via flattenGroup(visibleGroupItems, group.directory)", () => {
    expect(TASK_LIST).toContain("flattenGroup(visibleGroupItems(), group.directory)")
  })
})

describe("Cycle guard logs a warning and treats victims as top-level", () => {
  test("walks parent chains and accumulates cycleVictims", () => {
    expect(TASK_LIST).toContain("cycleVictims")
    expect(TASK_LIST).toMatch(/console\.warn\(\s*[\s\S]{0,40}cycle detected/)
  })
})

describe("Per-task expand state is per-session (Set<string>, no localStorage)", () => {
  test("declares expandedTasks signal as Set<string>", () => {
    expect(TASK_LIST).toContain("createSignal<Set<string>>(new Set())")
    expect(TASK_LIST).toContain("toggleTaskExpand")
  })

  test("does NOT persist expand state to localStorage", () => {
    // Spec §3.2: local persistence is intentionally out of scope.
    expect(TASK_LIST).not.toContain("localStorage")
  })
})

describe("Cross-directory drag is disabled via canDrag (not draggable=false)", () => {
  test("canDrag returns false when crossDirectory is true", () => {
    // Idiom: TaskRow.canDrag already gates draggable + onDragStart
    // early-return at TaskList.tsx:329; we extend its predicate.
    expect(TASK_LIST).toMatch(/canDrag\s*=\s*\(\)\s*=>[\s\S]+?!props\.crossDirectory/)
  })

  test("TreeEntry carries crossDirectory and depth>0 cross-dir flag", () => {
    expect(TASK_LIST).toContain("crossDirectory: depth > 0 && itemDir !== groupDirectory")
  })

  test("renders data-cross-directory attribute when set", () => {
    expect(TASK_LIST).toContain(`data-cross-directory={props.crossDirectory ? "true" : undefined}`)
  })
})

describe("Parent-row badge: count + run-pulse + fail-color", () => {
  test("renders chevron+count toggle only when directChildren has items", () => {
    expect(TASK_LIST).toContain("directChildCount() > 0")
    expect(TASK_LIST).toContain('class="task-row-children-toggle"')
    expect(TASK_LIST).toContain('class="task-row-children-count"')
  })

  test("badge has data-has-active for run-pulse and data-has-failed for danger tone", () => {
    expect(TASK_LIST).toContain(`data-has-active={hasActiveChild() ? "true" : undefined}`)
    expect(TASK_LIST).toContain(`data-has-failed={hasFailedChild() ? "true" : undefined}`)
  })

  test("hasActiveChild / hasFailedChild aggregate over DIRECT children only", () => {
    expect(TASK_LIST).toMatch(/hasActiveChild\s*=\s*\(\)\s*=>[\s\S]+?props\.directChildren\?\.some/)
    expect(TASK_LIST).toMatch(/hasFailedChild\s*=\s*\(\)\s*=>[\s\S]+?props\.directChildren\?\.some/)
  })

  test("default render is collapsed (expanded passed in only when expandedTasks has the id)", () => {
    expect(TASK_LIST).toContain("expanded: isExpanded")
    expect(TASK_LIST).toMatch(/const\s+isExpanded\s*=\s*id\s*\?\s*expanded\.has\(id\)\s*:\s*false/)
  })
})

describe("Depth-based indent via padding-inline-start", () => {
  test("inline style applies (depth * 16px) padding scaled by --ui-scale", () => {
    expect(TASK_LIST).toMatch(/padding-inline-start:\s*calc\(\$\{[\s\S]*?\*\s*16\}px\s*\*\s*var\(--ui-scale\)\)/)
  })
})

describe("Compact quota counts top-level only", () => {
  test("visibleGroupItems still slices group.items (top-level) at COMPACT_GROUP_VISIBLE_LIMIT", () => {
    expect(TASK_LIST).toContain("group.items.slice(0, COMPACT_GROUP_VISIBLE_LIMIT)")
  })

  test("flattenGroup is called with visibleGroupItems(), so expanded children do not consume the quota", () => {
    expect(TASK_LIST).toContain("flattenGroup(visibleGroupItems(), group.directory)")
  })
})

describe("CSS: children toggle has pulse + danger variants", () => {
  test(".task-row-children-toggle rule exists", () => {
    expect(SIDEBAR_CSS).toContain(".task-row-children-toggle")
  })

  test("data-has-active triggers a pulse animation", () => {
    expect(SIDEBAR_CSS).toContain('.task-row-children-toggle[data-has-active="true"]')
    expect(SIDEBAR_CSS).toContain("@keyframes task-row-children-pulse")
  })

  test("data-has-failed paints the badge in the danger tone (failed beats active)", () => {
    expect(SIDEBAR_CSS).toContain('.task-row-children-toggle[data-has-failed="true"]')
    expect(SIDEBAR_CSS).toContain("var(--bad)")
  })

  test("cross-directory rows are visually dimmed", () => {
    expect(SIDEBAR_CSS).toContain('.task-row-mini[data-cross-directory="true"]')
  })
})

describe("i18n keys for the new toggle exist in both locales", () => {
  test("task.tree.children_count, expand_children, collapse_children in en-US", () => {
    expect(EN_JSON).toContain('"task.tree.children_count"')
    expect(EN_JSON).toContain('"task.tree.expand_children"')
    expect(EN_JSON).toContain('"task.tree.collapse_children"')
  })

  test("task.tree.children_count, expand_children, collapse_children in zh-CN", () => {
    expect(ZH_JSON).toContain('"task.tree.children_count"')
    expect(ZH_JSON).toContain('"task.tree.expand_children"')
    expect(ZH_JSON).toContain('"task.tree.collapse_children"')
  })
})
