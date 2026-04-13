import { expect, test, describe } from "bun:test";
import { toCardTree, shouldPromoteTool, defaultExpandedForNode, type CardNode } from "../src/utils/card-tree";

// ── Fixtures ──

function assistantMsg(opts: {
  id: string;
  agent?: string;
  role?: string;
  sessionID?: string;
  time?: number;
  text?: string;
  parts?: any[];
}) {
  const parts = opts.parts ?? [{ id: `p-${opts.id}`, type: "text", text: opts.text ?? "" }];
  return {
    info: {
      id: opts.id,
      role: opts.role ?? "assistant",
      agent: opts.agent,
      sessionID: opts.sessionID ?? "s1",
      resolvedRole: opts.agent,
      time: opts.time ? { created: opts.time } : undefined,
    },
    parts,
  };
}

// ── shouldPromoteTool ──

describe("shouldPromoteTool", () => {
  test("non-tool parts never promote", () => {
    expect(shouldPromoteTool({ type: "text", text: "hi" })).toBe(false);
    expect(shouldPromoteTool(null as any)).toBe(false);
  });

  test("task / subagent tools always promote", () => {
    expect(shouldPromoteTool({ type: "tool", tool: "task", state: {} })).toBe(true);
    expect(shouldPromoteTool({ type: "tool", tool: "agent", state: {} })).toBe(true);
    expect(shouldPromoteTool({ type: "tool", tool: "spawn_agent", state: {} })).toBe(true);
  });

  test("write / edit with code content promotes", () => {
    expect(
      shouldPromoteTool({
        type: "tool",
        tool: "write",
        state: { input: { content: "x" } },
      }),
    ).toBe(true);
    expect(
      shouldPromoteTool({
        type: "tool",
        tool: "edit",
        state: { input: { new_string: "y" } },
      }),
    ).toBe(true);
  });

  test("long read output promotes", () => {
    const many = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    expect(
      shouldPromoteTool({ type: "tool", tool: "read", state: { output: many } }),
    ).toBe(true);
    const few = "line1\nline2";
    expect(
      shouldPromoteTool({ type: "tool", tool: "read", state: { output: few } }),
    ).toBe(false);
  });

  test("long bash output promotes", () => {
    const many = Array.from({ length: 15 }, () => "x").join("\n");
    expect(
      shouldPromoteTool({ type: "tool", tool: "bash", state: { output: many } }),
    ).toBe(true);
  });

  test("error status with output promotes any tool", () => {
    expect(
      shouldPromoteTool({
        type: "tool",
        tool: "grep",
        state: { status: "error", error: "boom" },
      }),
    ).toBe(true);
  });

  test("short output does not promote", () => {
    expect(
      shouldPromoteTool({
        type: "tool",
        tool: "grep",
        state: { status: "completed", output: "one match" },
      }),
    ).toBe(false);
  });
});

// ── toCardTree: plain message ──

describe("toCardTree — plain message", () => {
  test("user message becomes kind=message", () => {
    const tree = toCardTree([
      {
        info: { id: "ctx:user-request", role: "user", resolvedRole: "user", time: { created: 100 } },
        parts: [{ type: "text", text: "build me an app" }],
      },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe("message");
    expect(tree[0].role).toBe("user");
    expect(tree[0].parts).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[0].time).toBe(100);
  });
});

// ── toCardTree: agent card ──

describe("toCardTree — agent card", () => {
  test("stage card flattens messages with boundaries, drops user role", () => {
    const card = {
      kind: "agent" as const,
      id: "spec:session:s1",
      stage: "spec",
      status: "running",
      round: 0,
      sessionID: "s1",
      time: 900,
      messages: [
        assistantMsg({ id: "m1", agent: "spec", time: 1000, text: "drafting" }),
        assistantMsg({ id: "u1", role: "user", time: 1100, text: "ignored" }),
        assistantMsg({ id: "m2", agent: "spec", time: 1200, text: "done" }),
      ],
    };
    const tree = toCardTree([card]);
    expect(tree).toHaveLength(1);
    const n = tree[0];
    expect(n.kind).toBe("agent");
    expect(n.stage).toBe("spec");
    expect(n.status).toBe("running");
    expect(n.id).toBe("spec:session:s1");
    // 2 boundaries + 2 text parts (user dropped)
    expect(n.parts.filter((p: any) => p.type === "boundary")).toHaveLength(2);
    expect(n.parts.filter((p: any) => p.type === "text")).toHaveLength(2);
  });

  test("agent card with zero messages is represented as a plain message node", () => {
    // toCardTree receives items already filtered by conversationMessages
    // (which drops empty messages). Guard anyway: an empty card sneaks
    // through harmlessly via messageToNode.
    const empty = {
      kind: "agent" as const,
      id: "spec:empty",
      stage: "spec",
      status: "pending",
      round: 0,
      sessionID: "",
      time: 0,
      messages: [],
    };
    const tree = toCardTree([empty]);
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe("message");
  });
});

// ── toCardTree: goal group ──

describe("toCardTree — goal group", () => {
  test("goal group with explicit workflow steps creates step children in order", () => {
    const goal = {
      kind: "goal" as const,
      id: "goal-group:goal-1",
      stage: "executor" as const,
      status: "running",
      round: 1,
      sessionID: "exec-1",
      time: 2000,
      goalID: "goal-1",
      goalTitle: "Implement auth",
      goalStatus: "running",
      goalDescription: "",
      goalSteps: [
        { stepID: "plan", label: "Plan", status: "completed" },
        { stepID: "execute", label: "Execute", status: "running" },
        { stepID: "eval", label: "Eval", status: "pending" },
      ],
      internalCards: [
        {
          kind: "agent" as const,
          id: "plan-card",
          stage: "planner",
          status: "completed",
          round: 0,
          sessionID: "plan-1",
          time: 1000,
          messages: [assistantMsg({ id: "p1", agent: "planner", text: "planned" })],
        },
        {
          kind: "agent" as const,
          id: "exec-card",
          stage: "executor",
          status: "running",
          round: 0,
          sessionID: "exec-1",
          time: 1500,
          messages: [assistantMsg({ id: "e1", agent: "executor", text: "running" })],
        },
      ],
    };
    const tree = toCardTree([goal]);
    expect(tree).toHaveLength(1);
    const n = tree[0];
    expect(n.kind).toBe("goal");
    expect(n.status).toBe("running");
    expect(n.title).toBe("Implement auth");
    expect(n.round).toBe(1);
    expect(n.children).toHaveLength(3); // 3 steps, eval has no internal card
    expect(n.children[0].stage).toBe("planner");
    expect(n.children[0].status).toBe("completed");
    expect(n.children[1].stage).toBe("executor");
    expect(n.children[1].status).toBe("running");
    expect(n.children[2].stage).toBe("evaluator");
    expect(n.children[2].status).toBe("pending");
    // executor step carries its flattened parts (1 boundary + 1 text)
    expect(n.children[1].parts.length).toBeGreaterThan(0);
  });

  test("goal group without workflow steps falls back to internal card order", () => {
    const goal = {
      kind: "goal" as const,
      id: "goal-group:x",
      stage: "executor" as const,
      status: "completed",
      round: 0,
      sessionID: "",
      time: 0,
      goalID: "x",
      goalTitle: "",
      goalStatus: "passed",
      goalDescription: "",
      internalCards: [
        {
          kind: "agent" as const,
          id: "exec-only",
          stage: "executor",
          status: "completed",
          round: 0,
          sessionID: "",
          time: 0,
          messages: [assistantMsg({ id: "m1", agent: "executor", text: "ok" })],
        },
      ],
    };
    const tree = toCardTree([goal]);
    expect(tree[0].status).toBe("completed"); // passed → completed
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].stage).toBe("executor");
  });
});

// ── defaultExpandedForNode ──

describe("defaultExpandedForNode", () => {
  function node(over: Partial<CardNode>): CardNode {
    return {
      id: "x",
      kind: "agent",
      title: "t",
      parts: [],
      children: [],
      ...over,
    } as CardNode;
  }

  test("running always open", () => {
    expect(defaultExpandedForNode(node({ kind: "step", status: "running" }))).toBe(true);
  });

  test("agent / goal default open when completed", () => {
    expect(defaultExpandedForNode(node({ kind: "agent", status: "completed" }))).toBe(true);
    expect(defaultExpandedForNode(node({ kind: "goal", status: "completed" }))).toBe(true);
  });

  test("step / tool default closed when completed", () => {
    expect(defaultExpandedForNode(node({ kind: "step", status: "completed" }))).toBe(false);
    expect(defaultExpandedForNode(node({ kind: "tool", status: "completed" }))).toBe(false);
  });

  test("message bubbles always open", () => {
    expect(defaultExpandedForNode(node({ kind: "message", status: undefined, defaultExpanded: true }))).toBe(true);
  });

  test("explicit defaultExpanded wins", () => {
    expect(defaultExpandedForNode(node({ kind: "step", status: "running", defaultExpanded: false }))).toBe(false);
  });
});

// ── Integration: mix ──

describe("toCardTree — mixed conversation", () => {
  test("preserves item order", () => {
    const tree = toCardTree([
      {
        info: { id: "user-1", role: "user", resolvedRole: "user", time: { created: 100 } },
        parts: [{ type: "text", text: "go" }],
      },
      {
        kind: "agent" as const,
        id: "spec:session:s1",
        stage: "spec",
        status: "completed",
        round: 0,
        sessionID: "s1",
        time: 200,
        messages: [assistantMsg({ id: "m1", agent: "spec", text: "spec" })],
      },
      {
        kind: "goal" as const,
        id: "goal-group:g1",
        stage: "executor" as const,
        status: "running",
        round: 0,
        sessionID: "",
        time: 300,
        goalID: "g1",
        goalTitle: "G",
        goalStatus: "running",
        goalDescription: "",
        internalCards: [],
      },
    ]);
    expect(tree.map((n) => n.kind)).toEqual(["message", "agent", "goal"]);
    expect(tree.map((n) => n.time)).toEqual([100, 200, 300]);
  });
});
