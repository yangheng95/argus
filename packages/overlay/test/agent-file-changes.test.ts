import { expect, test } from "bun:test"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { collectAgentFileChanges } from "../src/utils/file-change-summary"
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

test("agent file changes render only through the ChatBubble owner surface", () => {
  const chatBubble = readText(join(ROOT, "src", "components", "ChatBubble.tsx"))
  const component = readText(join(ROOT, "src", "components", "AgentFileChanges.tsx"))
  const css = readText(join(ROOT, "src", "styles", "surfaces", "chat-bubble.css"))

  expect(chatBubble).toContain("<AgentFileChanges node={props.node} />")
  const bodyInnerStart = chatBubble.indexOf('<div class="chat-bubble__body-inner">')
  const fileChangesMount = chatBubble.indexOf("<AgentFileChanges node={props.node} />")
  const bubbleFoot = chatBubble.indexOf('<div class="chat-bubble__foot">')
  const bodyCloseBeforeFileChanges = chatBubble.indexOf(
    "</div>\n            </div>\n          </Show>\n          <AgentFileChanges",
    bodyInnerStart,
  )
  expect(bodyInnerStart).toBeGreaterThan(0)
  expect(bodyCloseBeforeFileChanges).toBeGreaterThan(bodyInnerStart)
  expect(fileChangesMount).toBeGreaterThan(bodyCloseBeforeFileChanges)
  expect(fileChangesMount).toBeLessThan(bubbleFoot)
  expect(component).toContain('props.node.kind === "agent"')
  expect(component).toContain("collectAgentFileChanges(props.node, selectedTaskDirectory())")
  expect(component).toContain("DiffView item={item}")
  expect(component).toContain("agent-file-change-diff")
  expect(css).toContain(".agent-file-changes")
  expect(css).toContain(".agent-file-change-diff__body")
  expect(css).toContain("max-height: calc(164px * var(--ui-scale));")
  expect(css).toContain("text-overflow: ellipsis")
})
