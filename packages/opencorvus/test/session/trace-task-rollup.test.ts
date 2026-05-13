import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const previousTraceDir = process.env.OPENCORVUS_AGENT_TRACE_DIR
let tempDir = ""

afterEach(() => {
  if (previousTraceDir === undefined) delete process.env.OPENCORVUS_AGENT_TRACE_DIR
  else process.env.OPENCORVUS_AGENT_TRACE_DIR = previousTraceDir
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  tempDir = ""
})

test("task trace rollup includes llm_request task and parent metadata", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-rollup-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  const { AgentTrace } = await import("../../src/trace")
  const sessionID = `ses_trace_${Date.now()}`
  const taskID = `task_trace_${Date.now()}`
  const parentSessionID = `ses_parent_${Date.now()}`

  AgentTrace.recordLLMRequest({
    sessionID,
    parentSessionID,
    taskID,
    agentName: "build",
    agentMode: "subagent",
    model: { providerID: "test", modelID: "model" },
    system: ["system"],
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  })

  const events = AgentTrace.readTaskEvents(taskID)
  expect(events).toHaveLength(1)
  expect(events[0]?.kind).toBe("llm_request")
  expect(events[0]?.sessionID).toBe(sessionID)
  expect(events[0]?.taskID).toBe(taskID)
  expect(events[0]?.parentSessionID).toBe(parentSessionID)
})
