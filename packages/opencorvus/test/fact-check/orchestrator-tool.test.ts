/**
 * End-to-end coverage for the orchestrator `fact_check` tool —
 * specs/fact-check-agent-2026-05-25.md §7.2 e2e cases A–G.
 *
 * The FactCheckAgent.run runtime is mocked at the module level so the
 * tests stay deterministic and don't need an LLM provider.  What's NOT
 * mocked: snapshot precondition, idempotency cache, persist write,
 * decision-log entry, orchestrator-yield rendering — those are the
 * surfaces step 6 / 7 own.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Database, and, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Identifier } from "../../src/id/id"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { listFactCheckAttempts, recordFactCheckAttempt } from "../../src/fact-check/persist"
import type { FactCheckReport } from "../../src/fact-check/schema"
import { createDecisionLog } from "../../src/decision-log"
import { AgentRunError } from "../../src/agent/runner"
import { Message } from "../../src/session/message"
import { findStageContinuationRequest } from "../../src/engine/stage-continuation"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import type { MiniWorkflow } from "../../src/engine/workflow"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Mock FactCheckAgent.run so the test doesn't need an LLM provider.
// Each test case sets factCheckAgentImpl before invoking the tool.
// ---------------------------------------------------------------------------

let factCheckAgentImpl:
  | ((
      input: any,
    ) => Promise<{ sessionID: string; report: FactCheckReport; outcome: "completed" | "aborted" | "tool_error" }>)
  | undefined

mock.module("@/fact-check", () => ({
  FactCheckAgent: {
    run: async (input: any) => {
      if (!factCheckAgentImpl) throw new Error("test did not install factCheckAgentImpl")
      return factCheckAgentImpl(input)
    },
  },
}))

const baseReport: FactCheckReport = {
  scope: {
    target_session_id: "ses_target_xyz",
    target_agent: "build",
    target_message_id: "msg_unset",
    target_message_content_hash: "hash_unset",
    items_total: 1,
    items_inspected: 1,
  },
  verified: [],
  corrected: [],
  unresolved: [],
  overall_verdict: "clean",
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seedTask(projectID: string, taskID: string, now: number) {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: "D:/tmp/fc-e2e",
        name: "FC e2e",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        session_id: null,
        source: "test",
        title: "FC e2e task",
        request: "Build a thing",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
  })
}

async function createTerminalSessionWithAssistant(text: string): Promise<{ sessionID: string; messageID: string }> {
  const session = await Session.create({ kind: "build" })
  const userID = Identifier.ascending("message")
  await Session.updateMessage({
    id: userID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
  } as any)
  const assistantID = Identifier.ascending("message")
  await Session.updateMessage({
    id: assistantID,
    sessionID: session.id,
    role: "assistant",
    parentID: userID,
    modelID: "test",
    providerID: "test",
    agent: "build",
    path: { cwd: "/tmp/fc-e2e", root: "/tmp/fc-e2e" },
    time: { created: Date.now() },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache: { read: 0, write: 0 } },
  } as any)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistantID,
    sessionID: session.id,
    type: "text",
    text,
  } as any)
  SessionStatus.set(session.id, { type: "idle" })
  return { sessionID: session.id, messageID: assistantID }
}

const SAMPLE_ITEM = {
  claim: "React 19 introduced the use() hook for resource reading APIs",
  confidence: "medium" as const,
  category: "library" as const,
  source: "model prior",
}

function toolText(result: unknown): string {
  if (typeof result === "string") return result
  if (
    result &&
    typeof result === "object" &&
    (result as { type?: unknown }).type === "final" &&
    typeof (result as { output?: unknown }).output === "string"
  ) {
    return (result as { output: string }).output
  }
  if (
    result &&
    typeof result === "object" &&
    typeof (result as { output?: unknown }).output === "string" &&
    typeof (result as { title?: unknown }).title === "string" &&
    typeof (result as { metadata?: unknown }).metadata === "object"
  ) {
    return (result as { output: string }).output
  }
  throw new Error(`Expected string tool result or known wrapped string output, got ${JSON.stringify(result)}`)
}

const factCheckWorkflow: MiniWorkflow = {
  id: "custom_fact_check_only",
  name: "Custom fact-check only",
  description: "Test workflow that exposes fact_check as a task-level step.",
  goalLoopStepIDs: [],
  steps: [
    {
      id: "fact_check",
      tool: "fact_check",
      label: "Fact check",
      hint: "Verify factual claims.",
      scope: "task",
      skippable: false,
      after: [],
    },
  ],
}

function factCheckWorkflowStatuses(taskID: string): string[] {
  return Database.use((db) =>
    db
      .select({ payload: ProtocolEventTable.payload })
      .from(ProtocolEventTable)
      .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.step.updated")))
      .all()
      .filter((event) => event.payload?.stepID === "fact_check")
      .map((event) => String(event.payload?.status ?? "")),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fact_check orchestrator tool (e2e A–G)", () => {
  beforeEach(() => {
    resetDatabase()
    factCheckAgentImpl = undefined
  })
  afterEach(async () => {
    await Instance.disposeAll()
  })

  // e2e A: happy completed path
  test("[A] happy path: dispatches FactCheckAgent + records artifact + writes decision_log + renders verdict", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_A", "tsk_fc_A", Date.now())
        const { sessionID: targetSession, messageID: targetMsg } = await createTerminalSessionWithAssistant(
          "Built a component using react 19.",
        )

        factCheckAgentImpl = async (i) => ({
          sessionID: "ses_fc_run_A",
          report: {
            ...baseReport,
            scope: {
              target_session_id: i.targetSessionID,
              target_agent: i.targetAgent,
              target_message_id: i.targetMessageID,
              target_message_content_hash: i.targetMessageContentHash,
              items_total: 1,
              items_inspected: 1,
            },
            verified: [
              {
                claim: SAMPLE_ITEM.claim,
                evidence: [{ kind: "web", pointer: "https://react.dev/blog", excerpt: "use() reads resources" }],
              },
            ],
            overall_verdict: "clean",
          },
          outcome: "completed",
        })

        const { tools } = createOrchestratorTools({
          taskID: "tsk_fc_A",
          agentSessionID: "ses_orch_A",
          workflow: factCheckWorkflow,
        })
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "Worker registered a React-19 claim worth verifying.",
          },
          {} as any,
        )

        // Yield is markdown — must contain verdict + verified section
        expect(toolText(result)).toContain("verdict=`clean`")
        expect(toolText(result)).toContain("Verified (1)")

        // Artifact persisted
        const rows = listFactCheckAttempts("tsk_fc_A")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.report.overall_verdict).toBe("clean")
        expect(rows[0].payload.target_message_id).toBe(targetMsg)
        expect(rows[0].payload.outcome).toBe("completed")

        // Decision-log entry recorded under phase="fact_check"
        const entries = createDecisionLog("tsk_fc_A").readByPhase("fact_check")
        expect(entries.length).toBe(1)
        expect(entries[0].value).toContain("verdict=clean")
        expect(factCheckWorkflowStatuses("tsk_fc_A")).toEqual(["running", "completed"])
      },
    })
  })

  // e2e D: target session not terminal → reject
  test("[D] rejects when target session is still streaming", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_D", "tsk_fc_D", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant("Streaming claim.")
        SessionStatus.set(targetSession, { type: "streaming" })

        factCheckAgentImpl = async () => {
          throw new Error("agent should NOT run — tool must reject before dispatch")
        }

        const { tools } = createOrchestratorTools({
          taskID: "tsk_fc_D",
          agentSessionID: "ses_orch_D",
          workflow: factCheckWorkflow,
        })
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "should not fire — target session is streaming",
          },
          {} as any,
        )
        expect(toolText(result)).toContain("rejected")
        expect(toolText(result)).toContain("not in a terminal state")

        // No artifact, no decision-log entry
        expect(listFactCheckAttempts("tsk_fc_D").length).toBe(0)
        expect(createDecisionLog("tsk_fc_D").readByPhase("fact_check").length).toBe(0)
        expect(factCheckWorkflowStatuses("tsk_fc_D")).toEqual(["running", "failed"])
      },
    })
  })

  // e2e C: idempotency — second call returns cached without re-dispatch
  test("[C] idempotent: second call with same target hits cache, no re-dispatch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_C", "tsk_fc_C", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant("Cacheable claim text.")

        let runCallCount = 0
        factCheckAgentImpl = async (i) => {
          runCallCount += 1
          return {
            sessionID: `ses_fc_run_C_${runCallCount}`,
            report: {
              ...baseReport,
              scope: {
                target_session_id: i.targetSessionID,
                target_agent: i.targetAgent,
                target_message_id: i.targetMessageID,
                target_message_content_hash: i.targetMessageContentHash,
                items_total: 1,
                items_inspected: 1,
              },
              verified: [
                {
                  claim: SAMPLE_ITEM.claim,
                  evidence: [{ kind: "web", pointer: "https://example.com", excerpt: "doc" }],
                },
              ],
              overall_verdict: "clean",
            },
            outcome: "completed",
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: "tsk_fc_C",
          agentSessionID: "ses_orch_C",
          workflow: factCheckWorkflow,
        })
        const args = {
          target_session_id: targetSession,
          target_agent: "build",
          fact_check_items: [SAMPLE_ITEM],
          reason: "First call should dispatch.",
        }
        const first = await tools.fact_check.execute(args, {} as any)
        expect(runCallCount).toBe(1)
        expect(toolText(first)).toContain("verdict=`clean`")
        expect(toolText(first)).not.toContain("cached")

        const secondTools = createOrchestratorTools({
          taskID: "tsk_fc_C",
          agentSessionID: "ses_orch_C",
          workflow: factCheckWorkflow,
        }).tools
        const second = await secondTools.fact_check.execute(
          { ...args, reason: "Second call — should hit cache." },
          {} as any,
        )
        expect(runCallCount).toBe(1) // NOT incremented — agent did NOT re-run
        expect(toolText(second)).toContain("cached")
        expect(toolText(second)).toContain("verdict=`clean`")
        expect(factCheckWorkflowStatuses("tsk_fc_C")).toEqual(["running", "completed", "running", "completed"])
      },
    })
  })

  // e2e F: tool failed → inconclusive verdict
  test("[F] tool-failed paths produce inconclusive verdict (no fabricated evidence)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_F", "tsk_fc_F", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant("Network-dependent claim.")

        factCheckAgentImpl = async (i) => ({
          sessionID: "ses_fc_run_F",
          report: {
            ...baseReport,
            scope: {
              target_session_id: i.targetSessionID,
              target_agent: i.targetAgent,
              target_message_id: i.targetMessageID,
              target_message_content_hash: i.targetMessageContentHash,
              items_total: 1,
              items_inspected: 0,
            },
            verified: [],
            corrected: [],
            unresolved: [{ claim: SAMPLE_ITEM.claim, why_unresolved: "tool_failed", severity: "minor" }],
            overall_verdict: "inconclusive",
          },
          outcome: "completed",
        })

        const { tools } = createOrchestratorTools({ taskID: "tsk_fc_F", agentSessionID: "ses_orch_F" })
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "Verify behaviour when all retrieval tools fail.",
          },
          {} as any,
        )
        expect(toolText(result)).toContain("verdict=`inconclusive`")
        expect(toolText(result)).toContain("tool_failed")

        const row = listFactCheckAttempts("tsk_fc_F")[0]
        expect(row.payload.report.overall_verdict).toBe("inconclusive")
        expect(row.payload.report.verified.length).toBe(0)
      },
    })
  })

  // e2e E: cancel — agent throws AbortError, tool persists outcome=aborted artifact
  test("[E] cancel-mid-run persists fact_check_attempt with outcome=aborted (codex review §1)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_E", "tsk_fc_E", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant("Cancelled mid-run.")

        const ac = new AbortController()
        factCheckAgentImpl = async () => {
          ac.abort() // simulate caller cancelling during agent execution
          throw new Error("AbortError: signal aborted before terminal tool")
        }

        const tools = createOrchestratorTools({
          taskID: "tsk_fc_E",
          agentSessionID: "ses_orch_E",
          signal: ac.signal,
        }).tools

        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "Simulating cancel mid-run for outcome-aborted artifact path.",
          },
          {} as any,
        )
        expect(toolText(result)).toContain("aborted")

        const rows = listFactCheckAttempts("tsk_fc_E")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.outcome).toBe("aborted")
        expect(rows[0].payload.report.overall_verdict).toBe("inconclusive")
        expect(rows[0].payload.report.unresolved[0].why_unresolved).toBe("tool_failed")
      },
    })
  })

  test("[I] terminal finalizer miss persists tool_error before same-session continuation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_I", "tsk_fc_I", Date.now())
        const { sessionID: targetSession, messageID: targetMsg } = await createTerminalSessionWithAssistant(
          "Terminal finalizer miss claim about React 19.",
        )
        const failedSessionID = "ses_fc_terminal_miss_I"
        const calls: any[] = []
        factCheckAgentImpl = async (i) => {
          calls.push(i)
          if (calls.length === 1) {
            i.onSessionCreated?.(failedSessionID)
            const terminalError = new Message.TerminalToolMissingError({
              message: "Fact-check ended without report_fact_check_result.",
              toolName: "report_fact_check_result",
              retries: 0,
            })
            throw new AgentRunError("fact-check", "missing terminal fact-check report", {
              nonRetryable: true,
              cause: terminalError,
            })
          }
          expect(i.continuation).toMatchObject({
            sessionID: failedSessionID,
            finalizerName: "report_fact_check_result",
          })
          return {
            sessionID: failedSessionID,
            report: {
              ...baseReport,
              scope: {
                target_session_id: i.targetSessionID,
                target_agent: i.targetAgent,
                target_message_id: i.targetMessageID,
                target_message_content_hash: i.targetMessageContentHash,
                items_total: 1,
                items_inspected: 1,
              },
              verified: [
                {
                  claim: SAMPLE_ITEM.claim,
                  evidence: [{ kind: "web", pointer: "https://react.dev", excerpt: "React docs" }],
                },
              ],
              overall_verdict: "clean",
            },
            outcome: "completed",
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: "tsk_fc_I",
          agentSessionID: "ses_orch_I",
          workflow: factCheckWorkflow,
        })
        const first = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "Worker registered a claim and the first fact-check misses its terminal report.",
          },
          {} as any,
        )
        const firstText = toolText(first)
        expect(firstText).toContain("same-session continuation is ready")
        expect(firstText).toContain("fact_check({")
        const match = firstText.match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match).not.toBeNull()
        const continuationArtifactID = match![1]
        const request = findStageContinuationRequest({ taskID: "tsk_fc_I", artifactID: continuationArtifactID })
        expect(request?.payload.stage).toBe("fact-check")
        expect(request?.payload.finalizer_name).toBe("report_fact_check_result")
        expect(request?.payload.session_id).toBe(failedSessionID)
        expect(request?.payload.normalized_stage_input).toMatchObject({
          target_session_id: targetSession,
          target_agent: "build",
          target_message_id: targetMsg,
          fact_check_items: [SAMPLE_ITEM],
        })

        const afterMiss = listFactCheckAttempts("tsk_fc_I")
        expect(afterMiss.length).toBe(1)
        expect(afterMiss[0].payload.outcome).toBe("tool_error")
        expect(afterMiss[0].payload.fact_check_session_id).toBe(failedSessionID)
        expect(afterMiss[0].payload.target_message_id).toBe(targetMsg)
        expect(factCheckWorkflowStatuses("tsk_fc_I")).toEqual(["running", "failed"])

        const second = await tools.fact_check.execute(
          {
            reason: "Continue the previous fact-check terminal report miss in the same session.",
            continuation_artifact_id: continuationArtifactID,
          },
          {} as any,
        )
        expect(toolText(second)).toContain("verdict=`clean`")
        expect(calls.length).toBe(2)
        expect(calls[1].targetSessionID).toBe(targetSession)
        expect(calls[1].targetMessageID).toBe(targetMsg)
        expect(calls[1].continuation.artifactID).toBe(continuationArtifactID)

        const afterContinuation = listFactCheckAttempts("tsk_fc_I")
        expect(afterContinuation.map((row) => row.payload.outcome).sort()).toEqual(["completed", "tool_error"])
        expect(factCheckWorkflowStatuses("tsk_fc_I")).toEqual(["running", "failed", "running", "completed"])

        const third = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "Fresh repeat should return the completed cached fact-check attempt.",
          },
          {} as any,
        )
        expect(toolText(third)).toContain("cached")
        expect(calls.length).toBe(2)
        expect(factCheckWorkflowStatuses("tsk_fc_I")).toEqual([
          "running",
          "failed",
          "running",
          "completed",
          "running",
          "completed",
        ])
      },
    })
  })

  // e2e H (extra codex impl review §3): scope mismatch — LLM-returned scope doesn't match snapshot
  test("[H] scope-mismatch returns tool_error + persists synthetic inconclusive artifact (codex review §3)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_H", "tsk_fc_H", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant("Truthful claim.")

        factCheckAgentImpl = async (i) => ({
          sessionID: "ses_fc_run_H",
          report: {
            ...baseReport,
            scope: {
              // Deliberately wrong target_message_id — host should reject.
              target_session_id: i.targetSessionID,
              target_agent: i.targetAgent,
              target_message_id: "msg_wrong_value_inserted_by_llm",
              target_message_content_hash: i.targetMessageContentHash,
              items_total: 1,
              items_inspected: 1,
            },
            overall_verdict: "clean",
          },
          outcome: "completed",
        })

        const tools = createOrchestratorTools({ taskID: "tsk_fc_H", agentSessionID: "ses_orch_H" }).tools
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "Verify host catches a scope mismatch from the agent.",
          },
          {} as any,
        )
        expect(toolText(result)).toContain("tool_error")
        expect(toolText(result)).toContain("inconsistent with the host snapshot")

        const rows = listFactCheckAttempts("tsk_fc_H")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.outcome).toBe("tool_error")
        expect(rows[0].payload.report.overall_verdict).toBe("inconclusive")
      },
    })
  })

  // Regression: empty fact_check_items + tool error → verdict MUST be
  // inconclusive (codex impl review round 3 §B-1). Without the explicit
  // verdict override in synthesizeToolErrorReport, items_total=0 would
  // hit deriveFactCheckVerdict's "clean" short-circuit even though the
  // agent never operated.
  test("[regression] empty items + agent throw → outcome=tool_error AND verdict=inconclusive (NOT clean)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_empty_err", "tsk_fc_empty_err", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant(
          "Worker output. No structured items registered, but agent errored mid-run.",
        )

        factCheckAgentImpl = async () => {
          throw new Error("simulated mid-run failure (no provider available)")
        }

        const tools = createOrchestratorTools({
          taskID: "tsk_fc_empty_err",
          agentSessionID: "ses_orch_empty_err",
        }).tools
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [], // empty — exercises items_total=0 boundary
            reason: "Orchestrator asked for prose verification; no structured items.",
          },
          {} as any,
        )
        expect(toolText(result)).toContain("tool_error")

        const rows = listFactCheckAttempts("tsk_fc_empty_err")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.outcome).toBe("tool_error")
        // The blocker: verdict must NOT be clean for tool_error path even
        // when items_total = 0. Tool failure is categorically inconclusive.
        expect(rows[0].payload.report.overall_verdict).toBe("inconclusive")
        expect(rows[0].payload.report.overall_verdict).not.toBe("clean")
      },
    })
  })

  // Regression: stale targetMessageID → loadTargetMessageText throws,
  // orchestrator persists tool_error (codex impl review round 2 §B-2).
  test("[regression] stale target message id throws + persists tool_error (not silent fallback)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_stale", "tsk_fc_stale", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant("Real message.")

        // Bypass the FactCheckAgent mock — force the real run() to fire
        // so loadTargetMessageText() is actually exercised.  We point the
        // agent runner at a wrong messageID via the snapshot path: but
        // Session.snapshotLatestAssistant returns the REAL latest, so
        // to trigger the stale path we mock FactCheckAgent.run to call
        // loadTargetMessageText with a bogus id.  Simpler: stage the
        // synthetic error path directly by having the mock throw with
        // the loadTargetMessageText error message; we're regression-
        // testing the persist-error-as-tool_error contract.
        factCheckAgentImpl = async () => {
          throw new Error(
            "fact-check: target message msg_stale_id_xyz not found in session ses_stale (snapshot stale or wrong target id)",
          )
        }

        const tools = createOrchestratorTools({ taskID: "tsk_fc_stale", agentSessionID: "ses_orch_stale" }).tools
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "Exercise the stale-id catch + persist path.",
          },
          {} as any,
        )
        expect(toolText(result)).toContain("tool_error")
        expect(toolText(result)).toContain("snapshot stale")

        const rows = listFactCheckAttempts("tsk_fc_stale")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.outcome).toBe("tool_error")
        expect(rows[0].payload.report.overall_verdict).toBe("inconclusive")
        // The error reason must be captured in the unresolved claim so the
        // orchestrator can read it back via read_context.
        expect(rows[0].payload.report.unresolved[0].claim).toContain("snapshot stale")
      },
    })
  })

  // e2e G: external-executor path — fact_check_items: [] always passes schema
  test("[G] external-executor surrogate: empty fact_check_items array still produces a valid report scope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_G", "tsk_fc_G", Date.now())
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant(
          "External-executor passed result.",
        )

        factCheckAgentImpl = async (i) => {
          expect(i.factCheckItems).toEqual([])
          return {
            sessionID: "ses_fc_run_G",
            report: {
              ...baseReport,
              scope: {
                target_session_id: i.targetSessionID,
                target_agent: i.targetAgent,
                target_message_id: i.targetMessageID,
                target_message_content_hash: i.targetMessageContentHash,
                items_total: 0,
                items_inspected: 0,
              },
              overall_verdict: "clean",
            },
            outcome: "completed",
          }
        }

        const { tools } = createOrchestratorTools({ taskID: "tsk_fc_G", agentSessionID: "ses_orch_G" })
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [],
            reason: "External-executor produced empty items — orchestrator still asked for prose verification.",
          },
          {} as any,
        )
        expect(toolText(result)).toContain("verdict=`clean`")
        expect(listFactCheckAttempts("tsk_fc_G").length).toBe(1)
      },
    })
  })
})
