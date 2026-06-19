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

  test("keys rendered tree rows by task id instead of transient flattened entry objects", () => {
    expect(TASK_LIST).toContain("function taskTreeEntryKey")
    expect(TASK_LIST).toContain("entryKeys = createMemo")
    expect(TASK_LIST).toContain("entriesByKey = createMemo")
    expect(TASK_LIST).toContain("<For each={entryKeys()}>")
    expect(TASK_LIST).not.toContain("<For each={props.entries}>")
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
    expect(TASK_LIST).toContain("<Button")
    expect(TASK_LIST).toContain('data-ui="task-row-children-toggle"')
    expect(TASK_LIST).not.toContain('class="task-row-children-toggle"')
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
    expect(TASK_LIST).toMatch(/onClick=\{\(event\)\s*=>\s*\{\s*event\.stopPropagation\(\)\s*;?\s*props\.onToggleExpand/)
  })

  test("chevron opts out of HTML5 drag so clicking it never starts a row drag", () => {
    // Regression bug 2026-05-27: a button inside a draggable=true parent
    // div has the browser treat mousedown on the button as a potential
    // drag-start. The click event was being swallowed AND draggingID
    // was getting stuck because dragEnd didn't always fire — manifested
    // to the user as "after clicking a task with children, other tasks
    // become unclickable". Three guards: draggable={false} on the
    // button, stopPropagation on mousedown so the outer div never sees
    // the mousedown that would initiate drag, and a preventDefault
    // dragstart handler as belt-and-suspenders.
    expect(TASK_LIST).toMatch(/data-ui="task-row-children-toggle"[\s\S]+?draggable=\{false\}/)
    expect(TASK_LIST).toMatch(
      /data-ui="task-row-children-toggle"[\s\S]+?onMouseDown=\{\(event\)\s*=>\s*\{\s*event\.stopPropagation\(\)\s*;?\s*\}/,
    )
    expect(TASK_LIST).toMatch(
      /data-ui="task-row-children-toggle"[\s\S]+?onDragStart=\{\(event\)\s*=>\s*\{\s*event\.preventDefault\(\)\s*;?\s*event\.stopPropagation\(\)/,
    )
  })
})

describe("Chevron lives in .task-row-body, never inside .task-row-right (bug 2026-05-27)", () => {
  // Original placement put the chevron inside .task-row-right alongside
  // .task-row-actions. .task-row-actions is position:absolute; right:0;
  // width:64px; z-index:2 — on row hover, its buttons gain
  // pointer-events:auto and overlay the right column, including any
  // chevron rendered there. The buttons sit on top of the chevron in
  // hit-test order, so clicks intended for the chevron land on
  // cancel/rename/delete instead. User-reported as "chevron 点不了".
  //
  // The fix moves the chevron to .task-row-body (row-head, grid-column
  // 3, on the opposite side of the row from .task-row-right). The
  // action panel cannot cover it. This contract must not regress.

  test("chevron renders inside .task-row-body (row-head), not inside .task-row-right", () => {
    const rightStart = TASK_LIST.indexOf('<div class="task-row-right">')
    const bodyStart = TASK_LIST.indexOf('<div class="task-row-body">')
    const chevronStart = TASK_LIST.indexOf('data-ui="task-row-children-toggle"')
    expect(bodyStart).toBeGreaterThan(0)
    expect(rightStart).toBeGreaterThan(0)
    expect(chevronStart).toBeGreaterThan(0)
    // Chevron must appear BEFORE .task-row-right in source order so it
    // is not nested inside it.
    expect(chevronStart).toBeLessThan(rightStart)
    // And AFTER .task-row-body so it is nested inside the body wrapper.
    expect(chevronStart).toBeGreaterThan(bodyStart)
  })

  test(".task-row-body wraps chevron + main and is grid-column 3 in CSS", () => {
    expect(TASK_LIST).toContain('<div class="task-row-body">')
    expect(SIDEBAR_CSS).toMatch(/\.task-row-body\s*\{[^}]*grid-column:\s*3;/)
    // The wrapper has to be a flex container so chevron + main lay out
    // side-by-side, with the flex gap only applying when chevron is
    // rendered.
    expect(SIDEBAR_CSS).toMatch(/\.task-row-body\s*\{[^}]*display:\s*flex;/)
  })

  test(".task-row-main no longer claims grid-column 3 (now a flex item inside body)", () => {
    // If main re-grabs grid-column 3, it becomes a direct grid child
    // again and the body wrapper has nothing to do — that would re-
    // open the door to placing the chevron inside .task-row-right.
    expect(SIDEBAR_CSS).not.toMatch(/\.task-row-main\s*\{[^}]*grid-column:\s*3;/)
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
  test("children toggle rule routes through the Button primitive", () => {
    expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="task-row-children-toggle"]')
    expect(SIDEBAR_CSS).not.toContain(".task-row-children-toggle")
    expect(SIDEBAR_CSS).not.toMatch(/\.task-row-children-toggle:(?:hover|focus-visible)/)
  })

  test("data-has-active triggers a pulse animation", () => {
    expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="task-row-children-toggle"][data-has-active="true"]')
    expect(SIDEBAR_CSS).toContain("@keyframes task-row-children-pulse")
  })

  test("data-has-failed paints the badge in the danger tone (failed beats active)", () => {
    expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="task-row-children-toggle"][data-has-failed="true"]')
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
