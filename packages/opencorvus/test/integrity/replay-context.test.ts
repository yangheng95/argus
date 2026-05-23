import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { findLatestIntegrityAttemptArtifact, listIntegrityAttemptArtifacts } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"

function seedTask(input: { projectID: string; taskID: string; specIDs: string[]; now: number }) {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: process.cwd(),
        name: "Replay context test",
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
        title: "Replay context task",
        request: "Review attempt replay context",
        kind: "workflow",
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
    for (const [index, specID] of input.specIDs.entries()) {
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
    }
  })
}

describe("integrity replay context artifact source", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("lists same-task same-spec integrity attempts newest-first and latest delegates to the list", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_replay_${stamp}`
    const taskID = `tsk_replay_${stamp}`
    const specID = `spec_replay_${stamp}`
    const otherSpecID = `spec_replay_other_${stamp}`
    seedTask({ projectID, taskID, specIDs: [specID, otherSpecID], now })

    const firstPost = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_1_${stamp}`,
      specSnapshotID: specID,
      verdict: "needs_correction",
      phase: "post_build",
      now: now + 10,
    })
    const latestPost = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_2_${stamp}`,
      specSnapshotID: specID,
      verdict: "concerns",
      phase: "post_build",
      now: now + 20,
    })
    const latestAnyPhase = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_3_${stamp}`,
      specSnapshotID: specID,
      verdict: "pass",
      phase: "pre_build",
      now: now + 30,
    })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_other_${stamp}`,
      specSnapshotID: otherSpecID,
      verdict: "pass",
      phase: "post_build",
      now: now + 40,
    })

    const allForSpec = listIntegrityAttemptArtifacts({ taskID, specSnapshotID: specID })
    expect(allForSpec.map((row) => row.id)).toEqual([latestAnyPhase, latestPost, firstPost])
    expect(findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })?.id).toBe(latestAnyPhase)

    const postBuildOnly = listIntegrityAttemptArtifacts({ taskID, specSnapshotID: specID, phase: "post_build" })
    expect(postBuildOnly.map((row) => row.id)).toEqual([latestPost, firstPost])
    expect(findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID, phase: "post_build" })?.id).toBe(
      latestPost,
    )
  })
})
