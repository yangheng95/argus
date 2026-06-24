import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { EngineGoalTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { findLatestIntegrityArtifactMissingStatus } from "../../src/engine/store"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { ProtocolStore } from "../../src/protocol/store"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function buildToolOptions(label = "artifact_missing") {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    toolCallId: `cal_${label}_${stamp}`,
    opencorvus: {
      sessionID: `ses_${label}_${stamp}`,
      messageID: `msg_${label}_${stamp}`,
      toolCallID: `cal_${label}_${stamp}`,
      toolPartID: `prt_${label}_${stamp}`,
    },
  } as any
}

function toolText(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && typeof (result as { output?: unknown }).output === "string") {
    return (result as { output: string }).output
  }
  throw new Error(`Expected string tool result, got ${JSON.stringify(result)}`)
}

function seedWorkflowTask(input: {
  taskID: string
  specID: string
  goalID: string
  rootSessionID: string
  now: number
}) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        session_id: input.rootSessionID,
        source: "test",
        title: "Artifact missing task",
        request: "Recover missing integrity artifact",
        kind: "workflow",
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: input.specID,
        task_id: input.taskID,
        version: 1,
        status: "ready",
        summary: "Artifact missing spec",
        content: "Artifact missing spec",
        scope: "test",
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: input.goalID,
        task_id: input.taskID,
        spec_snapshot_id: input.specID,
        title: "Recover artifact",
        slug: "recover-artifact",
        objective: "Recover missing artifact",
        acceptance_specs: [],
        owned_paths: ["src/index.ts"],
        depends_on: [],
        exports: [],
        imports: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        status: "pending",
        order_index: 0,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })
}

describe("orchestrator integrity artifact_missing recovery", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir({ git: true })
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("surfaces artifact_missing, blocks stale build dispatch, and clears after recovered artifact", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `tsk_artifact_missing_${now.toString(16)}`
        const specID = `spec_artifact_missing_${now.toString(16)}`
        const goalID = `goal_artifact_missing_${now.toString(16)}`
        const root = await Session.create({ kind: "root", title: "Artifact missing root" })
        const integritySession = await Session.createNext({
          kind: "integrity",
          parentID: root.id,
          title: "Integrity Supervisor",
          directory: tmp.path,
        })
        seedWorkflowTask({ taskID, specID, goalID, rootSessionID: root.id, now })

        await ProtocolStore.appendEvent({
          kind: "event",
          type: "session.status",
          aggregate: "task",
          aggregate_id: taskID,
          task_id: taskID,
          session_id: integritySession.id,
          source: "test",
          emitted_at: now + 10,
          payload: {
            sessionID: integritySession.id,
            status: {
              type: "terminal",
              reason: "artifact_missing",
              error: "insert failed",
            },
            channel: "integrity",
            resolvedRole: "integrity",
            parentSessionID: root.id,
          },
        })

        expect(findLatestIntegrityArtifactMissingStatus(taskID)?.sessionID).toBe(integritySession.id)

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: root.id,
          signal: new AbortController().signal,
        })
        const context = toolText(await tools.read_context.execute({ scope: "integrity_history" }, {} as any))
        expect(context).toContain("status: artifact_missing")
        expect(context).toContain("prior artifact is not the current result")

        const blocked = toolText(
          await tools.build.execute(
            {
              goalID,
              request: "Try to continue from stale review data",
              reason: "Should be blocked by artifact_missing.",
            },
            buildToolOptions(),
          ),
        )
        expect(blocked).toContain("blocked by integrity artifact_missing")

        recordIntegrityAttempt({
          taskID,
          sessionID: integritySession.id,
          lineage: {
            taskID,
            activeSpecSnapshotID: specID,
            inheritedSpecSnapshotIDs: [],
            reason: "active_only",
          },
          verdict: "needs_correction",
          phase: "post_build",
          findings: [
            {
              id: "BF-recovered",
              severity: "blocking",
              verdictImpact: "needs_correction",
              title: "Recovered finding",
              description: "Recovered artifact carries the missing result.",
              repair: "Use recovered artifact for history.",
              filePaths: ["src/index.ts"],
              requirementIDs: [],
              specIDs: [],
            },
          ],
          teamReportMarkdown: "Recovered integrity report",
          now: now + 20,
        })

        expect(findLatestIntegrityArtifactMissingStatus(taskID)).toBeUndefined()
        const recoveredContext = toolText(await tools.read_context.execute({ scope: "integrity_history" }, {} as any))
        expect(recoveredContext).not.toContain("status: artifact_missing")
        expect(recoveredContext).toContain("Recovered integrity report")

        const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(task?.id).toBe(taskID)
      },
    })
  })
})
