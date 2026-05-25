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
import { Database } from "../../src/storage/db"
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
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Mock FactCheckAgent.run so the test doesn't need an LLM provider.
// Each test case sets factCheckAgentImpl before invoking the tool.
// ---------------------------------------------------------------------------

let factCheckAgentImpl:
  | ((input: any) => Promise<{ sessionID: string; report: FactCheckReport; outcome: "completed" | "aborted" | "tool_error" }>)
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
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: "D:/tmp/fc-e2e",
      name: "FC e2e",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineTaskTable).values({
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
    }).run()
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
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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
        const { sessionID: targetSession, messageID: targetMsg } =
          await createTerminalSessionWithAssistant("Built a component using react 19.")

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

        const { tools } = createOrchestratorTools({ taskID: "tsk_fc_A", agentSessionID: "ses_orch_A" })
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
        expect(typeof result).toBe("string")
        expect(String(result)).toContain("verdict=`clean`")
        expect(String(result)).toContain("Verified (1)")

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

        const { tools } = createOrchestratorTools({ taskID: "tsk_fc_D", agentSessionID: "ses_orch_D" })
        const result = await tools.fact_check.execute(
          {
            target_session_id: targetSession,
            target_agent: "build",
            fact_check_items: [SAMPLE_ITEM],
            reason: "should not fire — target session is streaming",
          },
          {} as any,
        )
        expect(String(result)).toContain("rejected")
        expect(String(result)).toContain("not in a terminal state")

        // No artifact, no decision-log entry
        expect(listFactCheckAttempts("tsk_fc_D").length).toBe(0)
        expect(createDecisionLog("tsk_fc_D").readByPhase("fact_check").length).toBe(0)
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

        const { tools } = createOrchestratorTools({ taskID: "tsk_fc_C", agentSessionID: "ses_orch_C" })
        const args = {
          target_session_id: targetSession,
          target_agent: "build",
          fact_check_items: [SAMPLE_ITEM],
          reason: "First call should dispatch.",
        }
        const first = await tools.fact_check.execute(args, {} as any)
        expect(runCallCount).toBe(1)
        expect(String(first)).toContain("verdict=`clean`")
        expect(String(first)).not.toContain("cached")

        const secondTools = createOrchestratorTools({ taskID: "tsk_fc_C", agentSessionID: "ses_orch_C" }).tools
        const second = await secondTools.fact_check.execute({ ...args, reason: "Second call — should hit cache." }, {} as any)
        expect(runCallCount).toBe(1) // NOT incremented — agent did NOT re-run
        expect(String(second)).toContain("cached")
        expect(String(second)).toContain("verdict=`clean`")
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
        expect(String(result)).toContain("verdict=`inconclusive`")
        expect(String(result)).toContain("tool_failed")

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
        expect(String(result)).toContain("aborted")

        const rows = listFactCheckAttempts("tsk_fc_E")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.outcome).toBe("aborted")
        expect(rows[0].payload.report.overall_verdict).toBe("inconclusive")
        expect(rows[0].payload.report.unresolved[0].why_unresolved).toBe("tool_failed")
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
        expect(String(result)).toContain("tool_error")
        expect(String(result)).toContain("inconsistent with the host snapshot")

        const rows = listFactCheckAttempts("tsk_fc_H")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.outcome).toBe("tool_error")
        expect(rows[0].payload.report.overall_verdict).toBe("inconclusive")
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
        const { sessionID: targetSession } = await createTerminalSessionWithAssistant("External-executor passed result.")

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
        expect(String(result)).toContain("verdict=`clean`")
        expect(listFactCheckAttempts("tsk_fc_G").length).toBe(1)
      },
    })
  })
})
