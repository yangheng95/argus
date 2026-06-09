import { expect, test } from "bun:test"
import { buildAgentWorkflow, traceReport } from "../src/utils/agent-workflow"

test("traceReport reads only payload.report and does not invent fallback summaries", () => {
  const report = traceReport({
    ts: 100,
    kind: "agent_report",
    sessionID: "ses_requirements",
    agentName: "requirements",
    payload: {
      collector: {
        requirements: [{ id: "REQ-1" }, { id: "REQ-2" }, { id: "REQ-3" }],
      },
      report: {
        summary: "Parsed the user-facing requirements.",
        detail: "## Requirements\n- REQ-1",
      },
    },
  } as any)

  expect(report?.summary).toBe("Parsed the user-facing requirements.")
  expect(report?.detail).toBe("## Requirements\n- REQ-1")
  expect(report?.summary).not.toBe("(no summary)")
  expect(report?.summary).not.toContain("3 requirements")
})

test("traceReport returns undefined when report payload is absent", () => {
  const report = traceReport({
    ts: 100,
    kind: "agent_report",
    sessionID: "ses_requirements",
    agentName: "requirements",
    payload: {
      collector: {
        requirements: [{ id: "REQ-1" }, { id: "REQ-2" }, { id: "REQ-3" }],
      },
    },
  } as any)

  expect(report).toBeUndefined()
})

test("card text does not overwrite an existing trace report", () => {
  const projection = buildAgentWorkflow({
    traceEvents: [
      {
        ts: 100,
        kind: "agent_report",
        sessionID: "ses_build",
        agentName: "build",
        payload: {
          report: {
            summary: "Trace report summary",
            detail: "Trace report detail",
          },
        },
      } as any,
    ],
    order: ["step:goal_a:build:phase:build"],
    cards: {
      "step:goal_a:build:phase:build": {
        id: "step:goal_a:build:phase:build",
        kind: "phase",
        stage: "build",
        status: "completed",
        title: "Build",
        parts: [{ type: "text", text: "Card text should not replace trace report" }],
        childIDs: [],
        phaseSessionID: "ses_build",
        time: 90,
      } as any,
    },
  })

  expect(projection.records[0]?.traceReport?.summary).toBe("Trace report summary")
  expect(projection.records[0]?.displaySummary?.text).toBe("Trace report summary")
  expect(projection.records[0]?.traceReport?.summary).not.toBe("Card text should not replace trace report")
})

test("multiple message-turn cards for one session merge into a single workflow record", () => {
  const turn = (mid: string, time: number) => ({
    id: `assistant:session:ses_orch:message:${mid}`,
    kind: "agent" as const,
    stage: "assistant",
    status: "completed",
    title: "Orchestrator",
    sessionID: "ses_orch",
    messageID: mid,
    parts: [{ type: "text", text: `turn ${mid}` }],
    childIDs: [],
    time,
  })
  const cards = {
    [`assistant:session:ses_orch:message:msg_1`]: turn("msg_1", 100),
    [`assistant:session:ses_orch:message:msg_2`]: turn("msg_2", 300),
  }
  const projection = buildAgentWorkflow({
    traceEvents: [],
    order: ["assistant:session:ses_orch:message:msg_1", "assistant:session:ses_orch:message:msg_2"],
    cards: cards as any,
  })

  // One session → one record, not two agents on the workflow rail.
  const orchRecords = projection.records.filter((r) => r.sessionID === "ses_orch")
  expect(orchRecords.length).toBe(1)
  expect(orchRecords[0]?.startedAt).toBe(100)
  expect(orchRecords[0]?.lastObservedAt).toBe(300)
  // cardID tracks the latest observed turn card.
  expect(orchRecords[0]?.cardID).toBe("assistant:session:ses_orch:message:msg_2")
})
