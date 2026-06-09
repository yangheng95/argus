import { beforeEach, describe, expect, test } from "bun:test"
import {
  collapsedActivityPreviewText,
  collectLatestActivityText,
  collectTodoSummary,
  collectActivityCounts,
} from "../src/utils/card-tree"
import { cardTreeStore } from "../src/store/card-tree"

function resetStore() {
  for (const id of Object.keys(cardTreeStore.cards)) {
    delete (cardTreeStore.cards as any)[id]
  }
  ;(cardTreeStore as any).order = []
}

beforeEach(() => {
  resetStore()
})

describe("collectLatestActivityText", () => {
  test("returns empty string for empty card", () => {
    const node: any = { id: "a", kind: "agent", title: "x", parts: [], time: 1 }
    expect(collectLatestActivityText(node)).toBe("")
  })

  test("returns last text part by index when times equal", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 100,
      parts: [
        { type: "text", text: "first" },
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "newest" },
      ],
    }
    expect(collectLatestActivityText(node)).toBe("newest")
  })

  test("prefers later child over earlier parent text", () => {
    ;(cardTreeStore.cards as any)["child"] = {
      id: "child",
      kind: "phase",
      title: "c",
      time: 200,
      parts: [{ type: "text", text: "child-newest" }],
    }
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 100,
      parts: [{ type: "text", text: "parent-old" }],
      childIDs: ["child"],
    }
    expect(collectLatestActivityText(node)).toBe("child-newest")
  })

  test("falls back to goalDescription on empty step card", () => {
    const node: any = {
      id: "s",
      kind: "step",
      title: "Goal",
      time: 0,
      parts: [],
      goalDescription: "Build the thing",
    }
    expect(collectLatestActivityText(node)).toBe("Build the thing")
  })

  test("preserves newlines in multi-line text", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [{ type: "text", text: "line one\nline two\nline three" }],
    }
    const out = collectLatestActivityText(node)
    expect(out.split("\n")).toEqual(["line one", "line two", "line three"])
  })

  test("formats trailing tool call when tool is most recent activity", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [
        { type: "text", text: "hello" },
        { type: "tool", tool: "bash", state: { input: { command: "ls -la" }, output: "" } },
      ],
    }
    const out = collectLatestActivityText(node)
    expect(out).toContain("bash")
    expect(out).toContain("ls -la")
  })

  test("uses promoted tool child's toolPart when subtree has no later text", () => {
    ;(cardTreeStore.cards as any)["child"] = {
      id: "child",
      kind: "tool",
      title: "Read",
      time: 200,
      parts: [],
      toolPart: {
        type: "tool",
        tool: "read",
        state: { input: { file_path: "/a/b/c.ts" } },
      },
    }
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 100,
      parts: [{ type: "text", text: "old" }],
      childIDs: ["child"],
    }
    const out = collectLatestActivityText(node)
    expect(out).toContain("read")
    expect(out).toContain("c.ts")
  })

  test("ignores Todo tools (they have a dedicated UI row)", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [
        { type: "text", text: "hello" },
        { type: "tool", tool: "TodoWrite", state: { input: { todos: [{ content: "x", status: "pending" }] } } },
      ],
    }
    expect(collectLatestActivityText(node)).toBe("hello")
  })

  test("ignores StructuredOutput wrapper tool (internal Zod-call, no signal)", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [
        { type: "text", text: "actual prose" },
        {
          type: "tool",
          tool: "StructuredOutput",
          state: { title: "Structured Output", input: {} },
        },
      ],
    }
    // Without suppression operators see "⚡ StructuredOutput: Structured Output"
    // — the tool name echoed as its own detail. Suppressed alongside Todo tools.
    expect(collectLatestActivityText(node)).toBe("actual prose")
  })

  test("step cards prefer text over tool calls (operator wants goal context, not bash)", () => {
    const node: any = {
      id: "g2",
      kind: "step",
      title: "Goal 2",
      time: 1,
      goalDescription: "Implement /api/data",
      parts: [
        { type: "reasoning", text: "planning the api shape" },
        { type: "tool", tool: "bash", state: { input: { command: "rg --files" } } },
      ],
    }
    // Tool calls inside step subtrees are visible in the expanded body.
    // The collapsed preview should answer "what is this goal trying to do",
    // never "Bash: rg --files".
    const out = collectLatestActivityText(node)
    expect(out).toBe("planning the api shape")
    expect(out).not.toContain("rg --files")
  })

  test("step cards with no text fall back to goalDescription (not tool command)", () => {
    const node: any = {
      id: "g2",
      kind: "step",
      title: "Goal 2",
      time: 1,
      goalDescription: "Implement /api/data",
      parts: [{ type: "tool", tool: "bash", state: { input: { command: "rg --files" } } }],
    }
    expect(collectLatestActivityText(node)).toBe("Implement /api/data")
  })
})

describe("collapsedActivityPreviewText", () => {
  test("strips leading duplicated title while preserving message line breaks", () => {
    const preview = collapsedActivityPreviewText("需求：第一行\n第二行\n\n\n第三行", "需求")
    expect(preview).toBe("第一行\n第二行\n\n第三行")
  })

  test("removes markdown chrome without truncating the latest message", () => {
    const preview = collapsedActivityPreviewText("```ts\nconst x = 1\n```\n[doc](./a.md)", "x")
    expect(preview).toBe("const x = 1\ndoc")
  })
})

describe("collectTodoSummary", () => {
  test("returns null when no todo tool exists", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [{ type: "text", text: "no todos" }],
    }
    expect(collectTodoSummary(node)).toBeNull()
  })

  test("counts and surfaces in_progress title", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [
        {
          type: "tool",
          tool: "TodoWrite",
          state: {
            input: {
              todos: [
                { content: "step a", status: "completed" },
                { content: "step b", activeForm: "Doing B", status: "in_progress" },
                { content: "step c", status: "pending" },
                { content: "step d", status: "pending" },
              ],
            },
          },
        },
      ],
    }
    const s = collectTodoSummary(node)!
    expect(s.total).toBe(4)
    expect(s.completed).toBe(1)
    expect(s.inProgress).toBe(1)
    expect(s.pending).toBe(2)
    expect(s.current).toBe("Doing B")
  })

  test("picks newest todo across multiple writes", () => {
    const node: any = {
      id: "a",
      kind: "step",
      title: "x",
      time: 100,
      parts: [
        {
          type: "tool",
          tool: "todowrite",
          state: { input: { todos: [{ content: "old1", status: "pending" }] } },
        },
      ],
      childIDs: ["c1"],
    }
    ;(cardTreeStore.cards as any)["c1"] = {
      id: "c1",
      kind: "tool",
      title: "Todos",
      time: 200,
      parts: [],
      toolPart: {
        type: "tool",
        tool: "todowrite",
        state: {
          input: {
            todos: [
              { content: "new1", status: "completed" },
              { content: "new2", status: "completed" },
              { content: "new3", status: "in_progress" },
            ],
          },
        },
      },
    }
    const s = collectTodoSummary(node)!
    expect(s.total).toBe(3)
    expect(s.completed).toBe(2)
    expect(s.inProgress).toBe(1)
    expect(s.current).toBe("new3")
  })

  test("falls back to last completed when no in_progress / pending", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [
        {
          type: "tool",
          tool: "TodoWrite",
          state: {
            input: {
              todos: [
                { content: "alpha", status: "completed" },
                { content: "beta", status: "completed" },
              ],
            },
          },
        },
      ],
    }
    const s = collectTodoSummary(node)!
    expect(s.completed).toBe(2)
    expect(s.inProgress).toBe(0)
    expect(s.current).toBe("beta")
  })

  test("activity counts split tools / agents / skills / messages", () => {
    ;(cardTreeStore.cards as any)["c1"] = {
      id: "c1",
      kind: "tool",
      title: "Bash",
      time: 200,
      parts: [],
      toolPart: { type: "tool", tool: "bash", state: { input: { command: "ls" } } },
    }
    const node: any = {
      id: "root",
      kind: "agent",
      title: "x",
      time: 100,
      parts: [
        { type: "text", text: "hi" },
        { type: "reasoning", text: "thinking" },
        { type: "tool", tool: "Read", state: { input: { file_path: "a" } } },
        { type: "tool", tool: "Task", state: { input: {} } },
        { type: "tool", tool: "Skill", state: { input: { skill: "x" } } },
        { type: "tool", tool: "Bash", state: { input: { command: "echo hi" } } },
      ],
      childIDs: ["c1"],
    }
    const counts = collectActivityCounts(node)
    expect(counts.messages).toBe(2)
    expect(counts.agents).toBe(1) // Task
    expect(counts.skills).toBe(1) // Skill
    expect(counts.tools).toBe(3) // Read + Bash (root) + Bash (child)
  })

  test("parses todos from output JSON when input/metadata absent", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "x",
      time: 1,
      parts: [
        {
          type: "tool",
          tool: "todoread",
          state: {
            output: JSON.stringify([
              { content: "read1", status: "completed" },
              { content: "read2", status: "in_progress" },
            ]),
          },
        },
      ],
    }
    const s = collectTodoSummary(node)!
    expect(s.total).toBe(2)
    expect(s.completed).toBe(1)
    expect(s.current).toBe("read2")
  })

  test("uses committed todo metadata instead of stale input snapshot", () => {
    const node: any = {
      id: "a",
      kind: "agent",
      title: "Requirements",
      time: 1,
      parts: [
        {
          type: "tool",
          tool: "TodoWrite",
          state: {
            input: {
              todos: [
                { content: "req 1", status: "pending" },
                { content: "req 2", status: "pending" },
              ],
            },
            metadata: {
              todos: [
                { content: "req 1", status: "completed" },
                { content: "req 2", status: "in_progress", activeForm: "Checking req 2" },
              ],
            },
          },
        },
      ],
    }
    const s = collectTodoSummary(node)!
    expect(s.total).toBe(2)
    expect(s.completed).toBe(1)
    expect(s.inProgress).toBe(1)
    expect(s.current).toBe("Checking req 2")
  })
})
