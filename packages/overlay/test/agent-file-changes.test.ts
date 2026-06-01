import { expect, test } from "bun:test"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import {
  collectAgentFileChangeGroups,
  collectAgentFileChangeGroupsFromNodes,
  collectAgentFileChanges,
} from "../src/utils/file-change-summary"
import { setCardTreeStore, type CardNode } from "../src/store/card-tree"

const ROOT = join(import.meta.dir, "..")

function readText(path: string): string {
  return readFileSync(path, "utf8")
}

function card(input: Partial<CardNode> & Pick<CardNode, "id" | "kind" | "title">): CardNode {
  return {
    stage: "assistant",
    status: "completed",
    parts: [],
    childIDs: [],
    time: 1,
    ...input,
  } as CardNode
}

test("collectAgentFileChanges merges tool metadata, tool input paths, patch parts, and children", () => {
  const child = card({
    id: "child",
    kind: "agent",
    title: "Child",
    parts: [
      {
        type: "patch",
        files: ["C:/repo/src/patch.ts"],
      },
    ],
  })
  setCardTreeStore("cards", { child })

  const agent = card({
    id: "agent",
    kind: "agent",
    title: "Agent",
    childIDs: ["child"],
    parts: [
      {
        type: "tool",
        tool: "Edit",
        state: {
          status: "completed",
          metadata: {
            files: [{ file: "C:/repo/src/app.ts", additions: 2, deletions: 1, type: "modified" }],
          },
        },
      },
      {
        type: "tool",
        tool: "Write",
        state: {
          status: "completed",
          input: { path: "C:/repo/src/app.ts", content: "next" },
        },
      },
      {
        type: "tool",
        tool: "Read",
        state: {
          status: "completed",
          input: { path: "C:/repo/src/read-only.ts" },
        },
      },
    ],
  })

  const changes = collectAgentFileChanges(agent, "C:/repo")
  expect(changes.map((item) => item.displayPath)).toEqual(["src/app.ts", "src/patch.ts"])
  expect(changes[0]).toMatchObject({
    openPath: "C:/repo/src/app.ts",
    additions: 2,
    deletions: 1,
    sources: 2,
  })
})

test("collectAgentFileChanges follows renderer child precedence and completed tool semantics", () => {
  const storeChild = card({
    id: "store-child",
    kind: "agent",
    title: "Rendered child",
    parts: [{ type: "patch", files: ["C:\\repo\\src\\rendered.ts"] }],
  })
  setCardTreeStore("cards", { "store-child": storeChild })

  const agent = card({
    id: "agent-with-inline-child",
    kind: "agent",
    title: "Agent",
    childIDs: ["store-child"],
    children: [
      card({
        id: "inline-child",
        kind: "agent",
        title: "Stale inline child",
        parts: [{ type: "patch", files: ["C:\\repo\\src\\stale.ts"] }],
      }),
    ],
    parts: [
      {
        type: "tool",
        tool: "Write",
        state: {
          status: "error",
          input: { path: "C:\\repo\\src\\failed.ts", content: "not applied" },
        },
      },
      {
        type: "tool",
        tool: "Edit",
        state: {
          status: "completed",
          metadata: {
            files: [{ file: "C:\\repo\\src\\created.ts", before: "", after: "export {}", additions: 1 }],
          },
        },
      },
    ],
  })

  const changes = collectAgentFileChanges(agent, "C:\\repo")
  expect(changes.map((item) => item.displayPath)).toEqual(["src/created.ts", "src/rendered.ts"])
  expect(changes.find((item) => item.displayPath === "src/created.ts")?.status).toBe("added")
})

test("collectAgentFileChangeGroups scopes file rows by goal metadata", () => {
  const agent = card({
    id: "goal-agent",
    kind: "agent",
    title: "Goal agent",
    goalID: "goal-a",
    parts: [
      {
        type: "tool",
        goalID: "goal-a",
        tool: "Edit",
        state: {
          status: "completed",
          metadata: {
            files: [{ file: "C:/repo/src/a.ts", additions: 7, deletions: 2, type: "modified" }],
          },
        },
      },
    ],
  })

  const groups = collectAgentFileChangeGroups(agent, "C:/repo", [
    {
      goalID: "goal-a",
      goalRunID: "run-a",
      goalTitle: "Build goal panel",
      orderIndex: 0,
      retryCount: 0,
      steps: [{ payload: { commitRef: "abc123def456" } }],
    },
  ])

  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({
    id: "goal:goal-a:run-a",
    goalID: "goal-a",
    goalRunID: "run-a",
    goalLabel: "#G1V1",
    goalTitle: "Build goal panel",
    commitRef: "abc123def456",
    additions: 7,
    deletions: 2,
  })
  expect(groups[0]?.changes.map((item) => item.file)).toEqual(["src/a.ts"])
})

test("collectAgentFileChangeGroupsFromNodes aggregates all agent roots once", () => {
  const child = card({
    id: "shared-child",
    kind: "agent",
    title: "Shared child",
    goalID: "goal-a",
    parts: [
      {
        type: "tool",
        goalID: "goal-a",
        tool: "Edit",
        state: {
          status: "completed",
          metadata: {
            files: [{ file: "C:/repo/src/shared.ts", additions: 3, deletions: 0, type: "modified" }],
          },
        },
      },
    ],
  })
  const rootA = card({
    id: "root-a",
    kind: "agent",
    title: "Root A",
    goalID: "goal-a",
    childIDs: ["shared-child"],
    parts: [
      {
        type: "patch",
        goalID: "goal-a",
        files: ["C:/repo/src/a.ts"],
      },
    ],
  })
  const rootB = card({
    id: "root-b",
    kind: "agent",
    title: "Root B",
    goalID: "goal-b",
    parts: [
      {
        type: "patch",
        goalID: "goal-b",
        files: ["C:/repo/src/b.ts"],
      },
    ],
  })
  setCardTreeStore("cards", { "shared-child": child, "root-a": rootA, "root-b": rootB })

  const groups = collectAgentFileChangeGroupsFromNodes([rootA, rootB, child], "C:/repo", [
    { goalID: "goal-a", goalRunID: "run-a", goalTitle: "Goal A", orderIndex: 0, retryCount: 0 },
    { goalID: "goal-b", goalRunID: "run-b", goalTitle: "Goal B", orderIndex: 1, retryCount: 0 },
  ])

  expect(groups.map((group) => group.goalID)).toEqual(["goal-a", "goal-b"])
  expect(groups[0]?.changes.map((item) => item.file)).toEqual(["src/a.ts", "src/shared.ts"])
  expect(groups[1]?.changes.map((item) => item.file)).toEqual(["src/b.ts"])
})

test("agent file changes render only through the message-side workbench", () => {
  const chatBubble = readText(join(ROOT, "src", "components", "ChatBubble.tsx"))
  const css = readText(join(ROOT, "src", "styles", "surfaces", "chat-bubble.css"))
  const changesCss = readText(join(ROOT, "src", "styles", "surfaces", "changes.css"))
  const sharedView = readText(join(ROOT, "src", "components", "FileChangesView.tsx"))
  const changesPanel = readText(join(ROOT, "src", "components", "ChangesPanel.tsx"))

  expect(chatBubble).not.toContain("AgentFileChanges")
  expect(chatBubble).not.toContain("<FileChangesView")
  expect(changesPanel).toContain("collectAgentFileChangeGroupsFromNodes(")
  expect(changesPanel).toContain("cardTreeStore.order")
  expect(changesPanel).toContain("<FileChangesView")
  expect(changesPanel).toContain('focusEvent="delivery:focus-changes"')
  expect(sharedView).toContain("changes-summary")
  expect(sharedView).toContain("changes-commit")
  expect(sharedView).not.toContain("changes-goal-picker")
  expect(sharedView).not.toContain("changes-tab")
  expect(sharedView).toContain("changes-list-group")
  expect(sharedView).toContain("changes-group-header")
  expect(sharedView).toContain("change-scope")
  expect(sharedView).toContain("changes-filter-field")
  expect(sharedView).toContain("files.filter_placeholder")
  expect(sharedView).toContain("files.no_matches")
  expect(sharedView).toContain("changes-status-strip")
  expect(sharedView).toContain("CHANGE_STATUS_FILTERS")
  expect(sharedView).toContain("files.status_filter_label")
  expect(sharedView).toContain("statusFilter()")
  expect(sharedView).toContain("selectedRowPosition")
  expect(sharedView).toContain("onListKeyDown")
  expect(sharedView).toContain("focusFilterInput")
  expect(sharedView).toContain("onFilterKeyDown")
  expect(sharedView).toContain('event.key === "/"')
  expect(sharedView).toContain("event.ctrlKey || event.metaKey")
  expect(sharedView).toContain("listEl?.focus()")
  expect(sharedView).toContain("scrollToIndex")
  expect(sharedView).toContain('role="listbox"')
  expect(sharedView).toContain('role="option"')
  expect(sharedView).toContain("change-file-name")
  expect(sharedView).toContain("change-directory")
  expect(sharedView).toContain("change-row")
  expect(sharedView).toContain('from "virtua/solid"')
  expect(sharedView).toContain("VIRTUAL_CHANGE_ROW_THRESHOLD")
  expect(sharedView).toContain("changes-list-virtual-window")
  expect(sharedView).toContain("changes-list-virtual-item")
  expect(sharedView).toContain("filteredRows()")
  expect(sharedView).toContain("data-virtualized={shouldVirtualizeRows()")
  expect(sharedView).not.toContain("<For each={group.changes}>")
  expect(sharedView).toContain('Icon name="file-document"')
  expect(css).not.toContain(".agent-file-changes")
  expect(css).not.toContain(".agent-file-change-diff")
  expect(css).not.toContain(".agent-file-change-path")
  expect(changesCss).toContain(".file-changes-view__heading")
  expect(changesCss).toContain(".changes-summary")
  expect(changesCss).toContain(".changes-toolbar")
  expect(changesCss).toContain(".changes-filter-input.field-input")
  expect(changesCss).toContain(".changes-status-strip")
  expect(changesCss).toContain(".changes-status-chip")
  expect(changesCss).toContain(".changes-list:focus-visible")
  expect(changesCss).toContain(".change-row")
  expect(changesCss).toContain(".change-file-name")
  expect(changesCss).toContain(".change-directory")
  expect(changesCss).toContain(".changes-list[data-virtualized=\"true\"]")
  expect(changesCss).toContain(".changes-list-virtual-window")
  expect(changesCss).toContain(".changes-list-virtual-item")
  expect(changesCss).toContain(".changes-list-group")
  expect(changesCss).toContain(".changes-group-header")
  expect(changesCss).toContain(".change-scope")
  expect(changesCss).not.toContain(".changes-goal-picker")
  expect(changesCss).not.toContain(".changes-tab")
  expect(changesCss).toContain("text-overflow: ellipsis")
})
