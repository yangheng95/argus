import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { buildIntegrityRootHistory, renderIntegrityRootHistoryBlock } from "../../src/integrity/root-history"
import type { SpecSnapshotLineage } from "../../src/integrity/replay-context"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function toolText(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && typeof (result as { output?: unknown }).output === "string") {
    return (result as { output: string }).output
  }
  throw new Error(`Expected string tool result, got ${JSON.stringify(result)}`)
}

function seedTask(input: { projectID: string; taskID: string; specIDs: string[]; now: number }) {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: process.cwd(),
        name: "Integrity history read_context",
        sandboxes: [],
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        source: "test",
        title: "Integrity history task",
        request: "Surface integrity history",
        kind: "workflow",
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
    input.specIDs.forEach((specID, index) => {
      db.insert(EngineSpecSnapshotTable)
        .values({
          id: specID,
          task_id: input.taskID,
          version: index + 1,
          status: "ready",
          summary: `Spec ${index + 1}`,
          content: `Spec ${index + 1}`,
          scope: "test",
          time_created: input.now + index,
          time_updated: input.now + index,
        })
        .run()
    })
  })
}

function lineage(
  taskID: string,
  activeSpecSnapshotID: string,
  inheritedSpecSnapshotIDs: string[] = [],
): SpecSnapshotLineage {
  return {
    taskID,
    activeSpecSnapshotID,
    inheritedSpecSnapshotIDs,
    reason: inheritedSpecSnapshotIDs.length > 0 ? "integrity_correction_lineage" : "active_only",
  }
}

function finding(input: { id: string; title: string; description: string; filePath?: string }) {
  return {
    id: input.id,
    severity: "blocking",
    verdictImpact: "needs_correction",
    title: input.title,
    description: input.description,
    repair: "Repair the cited root at its owning surface.",
    filePaths: input.filePath ? [input.filePath] : [],
    requirementIDs: ["REQ-1"],
    specIDs: [],
    reviewers: ["rev_storage"],
  }
}

function attempt(input: {
  taskID: string
  specID: string
  sessionID: string
  now: number
  findingID: string
  title: string
  description: string
  filePath?: string
}) {
  recordIntegrityAttempt({
    taskID: input.taskID,
    sessionID: input.sessionID,
    lineage: lineage(input.taskID, input.specID),
    verdict: "needs_correction",
    phase: "post_build",
    reviewers: [{ reviewerID: "rev_storage", scope: "Storage validation" }],
    findings: [
      finding({
        id: input.findingID,
        title: input.title,
        description: input.description,
        filePath: input.filePath,
      }),
    ],
    requiredRepairs: [{ id: `repair_${input.findingID}`, description: "Repair storage validation.", filePaths: [] }],
    teamReportMarkdown: `Report for ${input.findingID}`,
    now: input.now,
  })
}

describe("orchestrator integrity root history read_context", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("groups renamed findings by file and symbol across a same-task spec lineage", async () => {
    const now = Date.now()
    const taskID = `tsk_integrity_history_${now.toString(16)}`
    const firstSpec = `spec_integrity_history_1_${now.toString(16)}`
    const activeSpec = `spec_integrity_history_2_${now.toString(16)}`
    seedTask({ projectID: `proj_integrity_history_${now.toString(16)}`, taskID, specIDs: [firstSpec, activeSpec], now })

    attempt({
      taskID,
      specID: firstSpec,
      sessionID: `ses_history_1_${now}`,
      now: now + 1,
      findingID: "BF-1",
      title: "Settings validation missing",
      description: "getSettings() returns invalid localStorage temperature without validation.",
      filePath: "src/services/storage.ts",
    })
    attempt({
      taskID,
      specID: activeSpec,
      sessionID: `ses_history_2_${now}`,
      now: now + 2,
      findingID: "BF-SV1",
      title: "Storage settings validator still absent",
      description: "The getSettings() load path still accepts bad model data.",
      filePath: "src/services/storage.ts",
    })
    attempt({
      taskID,
      specID: activeSpec,
      sessionID: `ses_history_3_${now}`,
      now: now + 3,
      findingID: "BF-settings-validation",
      title: "Persisted settings validation remains missing",
      description: "getSettings() still does not validate stored model and token settings.",
      filePath: "src/services/storage.ts",
    })

    const history = buildIntegrityRootHistory({
      taskID,
      specSnapshotLineage: lineage(taskID, activeSpec, [firstSpec]),
    })

    expect(history.totalAttempts).toBe(3)
    expect(history.persistentBlockingRoots).toHaveLength(1)
    expect(history.persistentBlockingRoots[0]!.firstSeenAttempt).toBe(1)
    expect(history.persistentBlockingRoots[0]!.consecutiveAttempts).toEqual([1, 2, 3])
    expect(history.persistentBlockingRoots[0]!.symptomVariations.map((item) => item.findingID)).toEqual([
      "BF-1",
      "BF-SV1",
      "BF-settings-validation",
    ])

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = createOrchestratorTools({
          taskID,
          agentSessionID: `ses_orchestrator_${now}`,
          signal: new AbortController().signal,
        }).tools
        const output = toolText(await tools.read_context.execute({ scope: "integrity_history" }, {} as any))
        expect(output).toContain("## Integrity (history)")
        expect(output).toContain("Persistent blocking roots")
        expect(output).not.toBe("No context available yet.")
      },
    })
  })

  test("does not mark two rounds, non-consecutive rounds, or different roots as persistent", () => {
    const now = Date.now()
    const taskID = `tsk_integrity_negative_${now.toString(16)}`
    const specID = `spec_integrity_negative_${now.toString(16)}`
    seedTask({ projectID: `proj_integrity_negative_${now.toString(16)}`, taskID, specIDs: [specID], now })

    attempt({
      taskID,
      specID,
      sessionID: `ses_negative_1_${now}`,
      now: now + 1,
      findingID: "BF-A1",
      title: "Alpha root",
      description: "alphaRoot() fails validation.",
      filePath: "src/alpha.ts",
    })
    attempt({
      taskID,
      specID,
      sessionID: `ses_negative_2_${now}`,
      now: now + 2,
      findingID: "BF-A2",
      title: "Alpha renamed",
      description: "alphaRoot() still fails validation.",
      filePath: "src/alpha.ts",
    })
    attempt({
      taskID,
      specID,
      sessionID: `ses_negative_3_${now}`,
      now: now + 3,
      findingID: "BF-B1",
      title: "Beta root",
      description: "betaRoot() fails persistence.",
      filePath: "src/beta.ts",
    })
    attempt({
      taskID,
      specID,
      sessionID: `ses_negative_4_${now}`,
      now: now + 4,
      findingID: "BF-A3",
      title: "Alpha returns",
      description: "alphaRoot() failed again after a gap.",
      filePath: "src/alpha.ts",
    })

    const history = buildIntegrityRootHistory({
      taskID,
      specSnapshotLineage: lineage(taskID, specID),
    })
    expect(history.persistentBlockingRoots).toHaveLength(0)
    expect(renderIntegrityRootHistoryBlock(history)).toContain("(none >= 3 consecutive)")
  })

  test("history rendering is fact-only and does not include lane recommendation strings", () => {
    const now = Date.now()
    const taskID = `tsk_integrity_no_lane_${now.toString(16)}`
    const specID = `spec_integrity_no_lane_${now.toString(16)}`
    seedTask({ projectID: `proj_integrity_no_lane_${now.toString(16)}`, taskID, specIDs: [specID], now })
    for (const round of [1, 2, 3]) {
      attempt({
        taskID,
        specID,
        sessionID: `ses_no_lane_${round}_${now}`,
        now: now + round,
        findingID: `BF-${round}`,
        title: "Settings validation",
        description: "getSettings() still accepts invalid settings.",
        filePath: "src/services/storage.ts",
      })
    }

    const rendered = renderIntegrityRootHistoryBlock(
      buildIntegrityRootHistory({
        taskID,
        specSnapshotLineage: lineage(taskID, specID),
      }),
    )
    for (const forbidden of ["fail_task", "modify_goal", "propose_task", "escalate", "not converging"]) {
      expect(rendered).not.toContain(forbidden)
    }
  })
})
