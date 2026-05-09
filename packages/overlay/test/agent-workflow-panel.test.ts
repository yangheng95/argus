import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAgentWorkflow } from "../src/utils/agent-workflow";

test("agent workflow projection stacks repeated retry sessions by parent and agent", () => {
  const projection = buildAgentWorkflow({
    cards: {},
    order: [],
    traceEvents: [
      {
        ts: 1000,
        kind: "llm_request",
        sessionID: "ses_root",
        agentName: "orchestrator",
        payload: { model: { providerID: "hexin", modelID: "qwen" } },
      },
      {
        ts: 1100,
        kind: "agent_report",
        sessionID: "ses_root",
        agentName: "orchestrator",
        payload: { collector: { summary: "Root planned the run" } },
      },
      {
        ts: 1200,
        kind: "llm_request",
        sessionID: "ses_delivery_a",
        parentSessionID: "ses_root",
        agentName: "delivery",
        payload: { model: { providerID: "hexin", modelID: "sonnet" } },
      },
      {
        ts: 1300,
        kind: "agent_report_failure",
        sessionID: "ses_delivery_a",
        parentSessionID: "ses_root",
        agentName: "delivery",
        payload: { error: "missing runtime evidence" },
      },
      {
        ts: 1400,
        kind: "llm_request",
        sessionID: "ses_delivery_b",
        parentSessionID: "ses_root",
        agentName: "delivery",
        payload: { model: { providerID: "hexin", modelID: "sonnet" } },
      },
      {
        ts: 1500,
        kind: "agent_report_retry_final",
        sessionID: "ses_delivery_b",
        parentSessionID: "ses_root",
        agentName: "delivery",
        payload: {
          attempts: 2,
          collector: { summary: "Accepted after runtime evidence was attached" },
        },
      },
    ],
  });

  expect(projection.records).toHaveLength(3);
  const deliveryStack = projection.stacks.find((stack) => stack.agentName === "delivery");
  expect(deliveryStack?.records.map((record) => record.sessionID)).toEqual([
    "ses_delivery_a",
    "ses_delivery_b",
  ]);
  expect(deliveryStack?.records[0]?.status).toBe("error");
  expect(deliveryStack?.records[1]?.attempts).toBe(2);
  expect(deliveryStack?.records[1]?.report?.summary).toBe("Accepted after runtime evidence was attached");
});

test("agent workflow projection uses live phase cards when trace is not available yet", () => {
  const projection = buildAgentWorkflow({
    traceEvents: [],
    order: ["step:goal:build:phase:build"],
    cards: {
      "step:goal:build:phase:build": {
        id: "step:goal:build:phase:build",
        kind: "phase",
        stage: "build",
        status: "running",
        title: "Build",
        parts: [{ type: "text", text: "Editing the component" }],
        childIDs: [],
        phaseSessionID: "ses_build_live",
        time: 2000,
      } as any,
    },
  });

  expect(projection.records).toHaveLength(1);
  expect(projection.records[0]?.sessionID).toBe("ses_build_live");
  expect(projection.records[0]?.status).toBe("running");
  expect(projection.records[0]?.report?.summary).toBe("Editing the component");
});

test("agent workflow panel renders one current card per retry stack", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/AgentWorkflowPanel.tsx"), "utf8");

  expect(source).toContain("currentStackRecord");
  expect(source).toContain("stackAttemptTotal");
  expect(source).not.toContain("<For each={stack.records}>");
  expect(source).toContain('current: String(attemptTotal())');
  expect(source).toContain('trace.loading && records().length === 0 ? t("common.loading") : t("common.refresh")');
});
