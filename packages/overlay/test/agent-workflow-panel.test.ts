import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildAgentWorkflow } from "../src/utils/agent-workflow"

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
        payload: { report: { summary: "Root planned the run", detail: "Root planned the run" } },
      },
      {
        ts: 1200,
        kind: "llm_request",
        sessionID: "ses_acceptance_a",
        parentSessionID: "ses_root",
        agentName: "acceptance",
        payload: { model: { providerID: "hexin", modelID: "sonnet" } },
      },
      {
        ts: 1300,
        kind: "agent_report_failure",
        sessionID: "ses_acceptance_a",
        parentSessionID: "ses_root",
        agentName: "acceptance",
        payload: {
          error: "missing runtime evidence",
          report: { summary: "missing runtime evidence", detail: "missing runtime evidence" },
        },
      },
      {
        ts: 1400,
        kind: "llm_request",
        sessionID: "ses_acceptance_b",
        parentSessionID: "ses_root",
        agentName: "acceptance",
        payload: { model: { providerID: "hexin", modelID: "sonnet" } },
      },
      {
        ts: 1500,
        kind: "agent_report_retry_final",
        sessionID: "ses_acceptance_b",
        parentSessionID: "ses_root",
        agentName: "acceptance",
        payload: {
          attempts: 2,
          report: {
            summary: "Accepted after runtime evidence was attached",
            detail: "Accepted after runtime evidence was attached",
          },
        },
      },
    ],
  })

  expect(projection.records).toHaveLength(3)
  const acceptanceStack = projection.stacks.find((stack) => stack.agentName === "acceptance")
  expect(acceptanceStack?.records.map((record) => record.sessionID)).toEqual(["ses_acceptance_a", "ses_acceptance_b"])
  expect(acceptanceStack?.records[0]?.status).toBe("error")
  expect(acceptanceStack?.records[1]?.attempts).toBe(2)
  expect(acceptanceStack?.records[1]?.traceReport?.summary).toBe("Accepted after runtime evidence was attached")
})

test("agent workflow projection uses live phase cards without subscribing to streamed text", () => {
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
  })

  expect(projection.records).toHaveLength(1)
  expect(projection.records[0]?.sessionID).toBe("ses_build_live")
  expect(projection.records[0]?.status).toBe("running")
  expect(projection.records[0]?.displaySummary).toBeUndefined()
  expect(projection.records[0]?.traceReport).toBeUndefined()
})

test("right-panel AgentWorkflowPanel is retired in favor of ConversationAgentRail", () => {
  expect(existsSync(join(import.meta.dir, "../src/components/AgentWorkflowPanel.tsx"))).toBe(false)
  expect(existsSync(join(import.meta.dir, "../src/styles/surfaces/agent-workflow.css"))).toBe(false)

  const html = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
  const main = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
  const app = readFileSync(join(import.meta.dir, "../src/components/App.tsx"), "utf8")
  expect(html).not.toContain("solidAgentWorkflowMount")
  expect(html).not.toContain("rightPanelWorkflow")
  expect(html).not.toContain("styles/surfaces/agent-workflow.css")
  expect(main).not.toContain("AgentWorkflowPanel")
  expect(main).not.toContain("ConversationAgentRail")
  expect(app).toContain("ConversationAgentRail")
})

test("agent workflow projection maps hidden build phase to the rendered owner step", () => {
  const projection = buildAgentWorkflow({
    traceEvents: [],
    order: ["step:goal:build"],
    cards: {
      "step:goal:build": {
        id: "step:goal:build",
        kind: "step",
        stage: "executor",
        status: "running",
        title: "Executor",
        parts: [],
        childIDs: ["step:goal:build:phase:build"],
        time: 1900,
      } as any,
      "step:goal:build:phase:build": {
        id: "step:goal:build:phase:build",
        kind: "phase",
        stage: "build",
        status: "running",
        title: "Build",
        parts: [{ type: "text", text: "Editing the component" }],
        childIDs: [],
        phaseID: "build",
        phaseSessionID: "ses_build_live",
        time: 2000,
      } as any,
    },
  })

  expect(projection.records[0]?.cardID).toBe("step:goal:build:phase:build")
  expect(projection.records[0]?.renderedCardID).toBe("step:goal:build")
})

test("agent workflow projection carries goal identity for same-stage cards", () => {
  const projection = buildAgentWorkflow({
    traceEvents: [],
    order: ["step:goal_a:build:phase:build", "step:goal_b:build:phase:build"],
    cards: {
      "step:goal_a:build:phase:build": {
        id: "step:goal_a:build:phase:build",
        kind: "phase",
        stage: "build",
        status: "running",
        title: "Build",
        parts: [{ type: "text", text: "Build A" }],
        childIDs: [],
        phaseSessionID: "ses_build_a",
        time: 2000,
        goalID: "goal_a",
        goalDescription: "Implement account dashboard cards",
        round: 1,
        attempt: 1,
      } as any,
      "step:goal_b:build:phase:build": {
        id: "step:goal_b:build:phase:build",
        kind: "phase",
        stage: "build",
        status: "running",
        title: "Build",
        parts: [{ type: "text", text: "Build B" }],
        childIDs: [],
        phaseSessionID: "ses_build_b",
        time: 3000,
        goalID: "goal_b",
        goalDescription: "Implement billing history cards",
        round: 2,
        attempt: 2,
      } as any,
    },
  })

  expect(projection.records.map((record) => record.round)).toEqual([1, 2])
  expect(projection.records.map((record) => record.goalDescription)).toEqual([
    "Implement account dashboard cards",
    "Implement billing history cards",
  ])
  expect(projection.records[0]?.phaseID).toBe("build")
  expect(projection.records[1]?.attempt).toBe(2)
})
