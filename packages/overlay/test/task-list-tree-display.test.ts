// Source-contract tests for the task tree UI wiring inside TaskList.tsx.
// Behavioural correctness of tree assembly, cycle, orphan fallback, dedup
// is exercised by the runtime suite at task-tree-helpers.test.ts; this
// file locks the *integration* — that TaskList still imports the helpers,
// renders the chevron + count badge, uses canDrag for the drag guard,
// and ships the matching CSS + i18n keys.
//
// Spec: docs/superpowers/specs/2026-05-27-task-tree-display.md.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const TASK_LIST = readFileSync(join(import.meta.dir, "../src/components/TaskList.tsx"), "utf8")
const TASK_TREE = readFileSync(join(import.meta.dir, "../src/components/taskTree.ts"), "utf8")
const SIDEBAR_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/sidebar.css"), "utf8")
const EN_JSON = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")
const ZH_JSON = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")

describe("Lineage source: task.parentTaskID (read-only, no metadata digging)", () => {
  test("the pure helper reads task.parentTaskID", () => {
    expect(TASK_TREE).toContain("task?.parentTaskID")
  })

  test("nobody in the overlay frontend reaches into raw metadata.parent_task_id", () => {
    // Rule 8 — single read source. The overlay reads the hoisted
    // camelCase projection, not the snake_case metadata key.
    expect(TASK_LIST).not.toMatch(/metadata\??\.parent_task_id/)
    expect(TASK_TREE).not.toMatch(/metadata\??\.parent_task_id/)
  })
})

describe("TaskList integrates the extracted helpers", () => {
  test("imports buildTaskTree + flattenGroup from ./taskTree", () => {
    expect(TASK_LIST).toContain('from "./taskTree"')
    expect(TASK_LIST).toContain("buildTaskTree")
    expect(TASK_LIST).toContain("flattenGroupPure")
  })

  test("derives directory groups from tree().topLevelItems, not raw sortedItems()", () => {
    expect(TASK_LIST).toContain("for (const item of tree().topLevelItems)")
  })

  test("flattens each group via flattenGroup(visibleGroupItems, group.directory)", () => {
    expect(TASK_LIST).toContain("flattenGroup(visibleGroupItems(), group.directory)")
  })

  test("flattenGroup binding feeds the live expandedTasks() signal in", () => {
    expect(TASK_LIST).toContain("expandedTasks(),")
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

describe("Drag is disabled on any nested row (depth > 0)", () => {
  // codex code review 2026-05-27 caught that v3's original cross-
  // directory-only guard left same-directory nested queued rows
  // appearing draggable while the drop handler silently no-opped
  // (queue is computed from group.items = top-level only). Extending
  // the rule to all nested rows removes the inconsistency.
  test("canDrag requires depth === 0", () => {
    expect(TASK_LIST).toMatch(/canDrag\s*=\s*\(\)\s*=>[\s\S]+?\(props\.depth\s*\?\?\s*0\)\s*===\s*0/)
  })

  test("TreeEntry still carries crossDirectory for the visual hint", () => {
    // The cross-directory flag drives the dim-the-row visual but
    // no longer drives drag — drag is gated by depth alone.
    expect(TASK_TREE).toContain("crossDirectory: depth > 0 && itemDir !== groupDirectory")
  })

  test("renders data-cross-directory attribute for the cross-dir visual dim", () => {
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

  test("chevron click stops propagation so the row is not selected on toggle", () => {
    // Without stopPropagation the chevron click would bubble into
    // the outer .task-row-main button and trigger task selection.
    expect(TASK_LIST).toMatch(/onClick=\{\(event\)\s*=>\s*\{\s*event\.stopPropagation\(\);\s*props\.onToggleExpand/)
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
