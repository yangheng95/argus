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
      _agentCard: true,
      _agentCardKey: "spec:session:s1",
      _agentStage: "spec",
      _agentStatus: "running",
      _agentRound: 0,
      _agentMessages: [
        assistantMsg({ id: "m1", agent: "spec", time: 1000, text: "drafting" }),
        assistantMsg({ id: "u1", role: "user", time: 1100, text: "ignored" }),
        assistantMsg({ id: "m2", agent: "spec", time: 1200, text: "done" }),
      ],
      info: { id: "spec:session:s1", time: { created: 900 } },
      parts: [],
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
    // toCardTree receives items that have already been filtered by
    // conversationMessages (which drops empty _agentMessages). But guard anyway:
    // pre-filter shouldn't crash if an empty card sneaks through.
    const empty = {
      _agentCard: true,
      _agentCardKey: "spec:empty",
      _agentStage: "spec",
      _agentMessages: [],
      info: { id: "spec:empty" },
      parts: [],
    };
    const tree = toCardTree([empty]);
    // falls through to messageToNode (which is safe for synthetic / empty items)
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe("message");
  });
});

// ── toCardTree: goal group ──

describe("toCardTree — goal group", () => {
  test("goal group with explicit workflow steps creates step children in order", () => {
    const goal = {
      _agentCard: true,
      _agentGoalGroup: true,
      _agentCardKey: "goal-group:goal-1",
      _agentStatus: "running",
      _agentGoalStatus: "running",
      _agentGoalTitle: "Implement auth",
      _agentRound: 1,
      _agentGoalSteps: [
        { stepID: "plan", label: "Plan", status: "completed" },
        { stepID: "execute", label: "Execute", status: "running" },
        { stepID: "eval", label: "Eval", status: "pending" },
      ],
      _agentInternalCards: [
        {
          _agentStage: "planner",
          _agentStatus: "completed",
          _agentCardKey: "plan-card",
          _agentMessages: [assistantMsg({ id: "p1", agent: "planner", text: "planned" })],
        },
        {
          _agentStage: "executor",
          _agentStatus: "running",
          _agentCardKey: "exec-card",
          _agentMessages: [assistantMsg({ id: "e1", agent: "executor", text: "running" })],
        },
      ],
      info: { id: "goal-group:goal-1", time: { created: 2000 } },
      parts: [],
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
      _agentCard: true,
      _agentGoalGroup: true,
      _agentCardKey: "goal-group:x",
      _agentStatus: "completed",
      _agentGoalStatus: "passed",
      _agentGoalTitle: "",
      _agentInternalCards: [
        {
          _agentStage: "executor",
          _agentStatus: "completed",
          _agentCardKey: "exec-only",
          _agentMessages: [assistantMsg({ id: "m1", agent: "executor", text: "ok" })],
        },
      ],
      info: { id: "goal-group:x" },
      parts: [],
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
        _agentCard: true,
        _agentCardKey: "spec:session:s1",
        _agentStage: "spec",
        _agentStatus: "completed",
        _agentMessages: [assistantMsg({ id: "m1", agent: "spec", text: "spec" })],
        info: { id: "spec:session:s1", time: { created: 200 } },
        parts: [],
      },
      {
        _agentCard: true,
        _agentGoalGroup: true,
        _agentCardKey: "goal-group:g1",
        _agentStatus: "running",
        _agentGoalStatus: "running",
        _agentGoalTitle: "G",
        _agentInternalCards: [],
        info: { id: "goal-group:g1", time: { created: 300 } },
        parts: [],
      },
    ]);
    expect(tree.map((n) => n.kind)).toEqual(["message", "agent", "goal"]);
    expect(tree.map((n) => n.time)).toEqual([100, 200, 300]);
  });
});
