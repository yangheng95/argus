import { expect, test } from "bun:test"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { collectAgentFileChangeGroups, collectAgentFileChanges } from "../src/utils/file-change-summary"
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

test("agent file changes render only through the ChatBubble owner surface", () => {
  const chatBubble = readText(join(ROOT, "src", "components", "ChatBubble.tsx"))
  const component = readText(join(ROOT, "src", "components", "AgentFileChanges.tsx"))
  const css = readText(join(ROOT, "src", "styles", "surfaces", "chat-bubble.css"))
  const changesCss = readText(join(ROOT, "src", "styles", "surfaces", "changes.css"))
  const sharedView = readText(join(ROOT, "src", "components", "FileChangesView.tsx"))
  const changesPanel = readText(join(ROOT, "src", "components", "ChangesPanel.tsx"))

  expect(chatBubble).toContain("<AgentFileChanges node={props.node} />")
  const bodyInnerStart = chatBubble.indexOf('<div class="chat-bubble__body-inner">')
  const fileChangesMount = chatBubble.indexOf("<AgentFileChanges node={props.node} />")
  const bubbleFoot = chatBubble.indexOf('class="chat-bubble__foot"')
  const bodyCloseBeforeFileChanges = chatBubble.indexOf(
    "</div>\n            </div>\n          </Show>\n          <AgentFileChanges",
    bodyInnerStart,
  )
  expect(bodyInnerStart).toBeGreaterThan(0)
  expect(bodyCloseBeforeFileChanges).toBeGreaterThan(bodyInnerStart)
  expect(fileChangesMount).toBeGreaterThan(bodyCloseBeforeFileChanges)
  expect(fileChangesMount).toBeLessThan(bubbleFoot)
  expect(component).not.toContain('props.node.kind === "agent"')
  expect(component).toContain("collectAgentFileChangeGroups(")
  expect(component).toContain("<FileChangesView groups={groups()} showHeading />")
  expect(changesPanel).toContain("<FileChangesView")
  expect(changesPanel).toContain('focusEvent="delivery:focus-changes"')
  expect(sharedView).toContain("changes-summary")
  expect(sharedView).toContain("changes-commit")
  expect(sharedView).toContain("changes-goal-picker")
  expect(sharedView).toContain("changes-goal-picker-row-commit")
  expect(sharedView).toContain("change-row")
  expect(sharedView).toContain('Icon name="file-document"')
  expect(css).toContain(".agent-file-changes")
  expect(css).not.toContain(".agent-file-change-diff")
  expect(css).not.toContain(".agent-file-change-path")
  expect(changesCss).toContain(".file-changes-view__heading")
  expect(changesCss).toContain(".changes-summary")
  expect(changesCss).toContain(".change-row")
  expect(changesCss).toContain("text-overflow: ellipsis")
})
