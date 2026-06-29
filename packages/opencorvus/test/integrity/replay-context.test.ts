import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { findLatestIntegrityAttemptArtifact, listIntegrityAttemptArtifacts } from "../../src/engine/store"
import type { BuildAttemptOutcomeRow, GoalRunRow } from "../../src/engine/store"
import {
  buildIntegrityReplayContext,
  buildSpecSnapshotLineage,
  renderIntegrityReplayContextPrompt,
} from "../../src/integrity/replay-context"
import type { GoalContractFields } from "../../src/pipeline/types"
import { resetDatabase } from "../fixture/db"

type BuildRecordRow = {
  id: string
  task_id: string
  run_id: string
  goal_run_id: string
  status: string
  summary: string
  result: Record<string, unknown>
  time_created: number
  time_updated: number
}

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

function lineage(taskID: string, activeSpecSnapshotID: string, inheritedSpecSnapshotIDs: string[] = []) {
  return {
    taskID,
    activeSpecSnapshotID,
    inheritedSpecSnapshotIDs,
    reason: inheritedSpecSnapshotIDs.length > 0 ? ("integrity_correction_lineage" as const) : ("active_only" as const),
  }
}

function goal(id: string, acceptanceSpecs = 1): GoalContractFields {
  return {
    id,
    title: `Goal ${id}`,
    objective: `Objective ${id}`,
    acceptance_specs: Array.from({ length: acceptanceSpecs }, (_value, index) => ({
      id: `${id}_spec_${index}`,
      description: `Spec ${index}`,
      severity: "must",
      checks: [],
    })),
    owned_paths: [`src/${id}.ts`],
    depends_on: [],
    priority: "blocking",
    kind: "feature",
    requirement_ids: ["REQ-1"],
  }
}

function buildRecord(input: {
  id: string
  taskID: string
  now: number
  result: Record<string, unknown>
  summary?: string
}): BuildRecordRow {
  return {
    id: input.id,
    task_id: input.taskID,
    run_id: `${input.id}_run`,
    goal_run_id: `${input.id}_goal_run`,
    status: "candidate",
    summary: input.summary ?? `Build record ${input.id}`,
    result: input.result,
    time_created: input.now,
    time_updated: input.now,
  }
}

function goalRun(input: { id: string; taskID: string; goalID: string; now: number; completed?: number }): GoalRunRow {
  return {
    id: input.id,
    task_id: input.taskID,
    goal_id: input.goalID,
    plan_node_id: null,
    coordinator_run_id: `${input.id}_coordinator`,
    session_id: `${input.id}_session`,
    status: "completed",
    retry_count: 0,
    blocking_reason: null,
    error: null,
    workspace_dir: null,
    workspace_branch: null,
    workspace_base_ref: null,
    base_ref: null,
    merge_ref: null,
    supersede_of: null,
    superseded_reason: null,
    superseded_at: null,
    metadata: null,
    time_started: input.now - 5,
    time_completed: input.completed ?? input.now,
    time_created: input.now,
    time_updated: input.completed ?? input.now,
  }
}

function buildOutcome(input: {
  id: string
  taskID: string
  goalID: string
  goalRunID: string
  now: number
  outcomeKind: BuildAttemptOutcomeRow["outcome_kind"]
  terminalStatus?: BuildAttemptOutcomeRow["terminal_status"]
  summary?: string
  error?: string | null
  noDiffReason?: string | null
  changedFiles?: string[]
}): BuildAttemptOutcomeRow {
  return {
    id: input.id,
    task_id: input.taskID,
    run_id: `${input.id}_run`,
    goal_id: input.goalID,
    goal_run_id: input.goalRunID,
    session_id: `${input.goalRunID}_session`,
    terminal_status: input.terminalStatus ?? "completed",
    outcome_kind: input.outcomeKind,
    summary: input.summary ?? `Outcome ${input.id}`,
    error: input.error ?? null,
    no_diff_reason: input.noDiffReason ?? null,
    commit_ref: null,
    published_commit_ref: null,
    diff_base_ref: null,
    diff_head_ref: null,
    changed_files: input.changedFiles ?? [],
    host_facts: {},
    workspace: { dir: null, branch: null, base_ref: null },
    time_created: input.now,
    time_updated: input.now,
  }
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
      lineage: lineage(taskID, specID),
      verdict: "needs_correction",
      phase: "post_build",
      now: now + 10,
    })
    const latestPost = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_2_${stamp}`,
      lineage: lineage(taskID, specID),
      verdict: "concerns",
      phase: "post_build",
      now: now + 20,
    })
    const latestAnyPhase = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_3_${stamp}`,
      lineage: lineage(taskID, specID),
      verdict: "pass",
      phase: "pre_build",
      now: now + 30,
    })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_other_${stamp}`,
      lineage: lineage(taskID, otherSpecID),
      verdict: "pass",
      phase: "post_build",
      now: now + 40,
    })

    const allForSpec = listIntegrityAttemptArtifacts({ taskID, lineage: lineage(taskID, specID) })
    expect(allForSpec.map((row) => row.id)).toEqual([latestAnyPhase, latestPost, firstPost])
    expect(findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })?.id).toBe(latestAnyPhase)

    const postBuildOnly = listIntegrityAttemptArtifacts({
      taskID,
      lineage: lineage(taskID, specID),
      phase: "post_build",
    })
    expect(postBuildOnly.map((row) => row.id)).toEqual([latestPost, firstPost])
    expect(findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID, phase: "post_build" })?.id).toBe(
      latestPost,
    )
  })

  test("builds first-attempt replay context with scale counts and all build evidence", () => {
    const now = Date.now()
    const taskID = `tsk_replay_first_${now.toString(16)}`
    const ctx = buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, `spec_replay_first_${now.toString(16)}`),
      phase: "post_build",
      goals: [goal("settings", 2)],
      requirements: [
        { id: "REQ-1", type: "explicit", description: "Settings persist" },
        { id: "REQ-2", type: "implicit", description: "Validation handles bad input" },
      ],
      buildRecords: [
        buildRecord({
          id: "build_record_first",
          taskID,
          now,
          result: {
            changed_files: ["src/settings.ts"],
            changedFiles: ["src/storage.ts"],
            diffs: [{ file: "src/settings.ts" }, { file: "src/validation.ts", additions: 3, deletions: 1 }],
          },
        }),
      ],
      goalRuns: [goalRun({ id: "goal_run_first", taskID, goalID: "settings", now })],
    })

    expect(ctx.attemptNumber).toBe(1)
    expect(ctx.priorAttempts).toEqual([])
    expect(ctx.buildEvidenceSinceLastReview.changedFiles).toEqual([
      "src/settings.ts",
      "src/storage.ts",
      "src/validation.ts",
    ])
    expect(ctx.scaleSignals).toMatchObject({
      goals: 1,
      requirements: 2,
      acceptanceSpecs: 2,
      changedFilesTotal: 3,
      changedFilesSinceLastReview: 3,
      priorAttempts: 0,
      priorBlockingFindings: 0,
      phase: "post_build",
    })
  })

  test("pulls prior attempts across one and two inherited spec snapshots", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_replay_lineage_${stamp}`
    const taskID = `tsk_replay_lineage_${stamp}`
    const firstSpecID = `spec_replay_lineage_1_${stamp}`
    const secondSpecID = `spec_replay_lineage_2_${stamp}`
    const activeSpecID = `spec_replay_lineage_3_${stamp}`
    seedTask({ projectID, taskID, specIDs: [firstSpecID, secondSpecID, activeSpecID], now })

    const firstAttemptID = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_lineage_1_${stamp}`,
      lineage: lineage(taskID, firstSpecID),
      verdict: "needs_correction",
      phase: "post_build",
      reason: "Initial snapshot missed persistence.",
      now: now + 10,
    })
    const secondAttemptID = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_lineage_2_${stamp}`,
      lineage: lineage(taskID, secondSpecID, [firstSpecID]),
      verdict: "concerns",
      phase: "post_build",
      reason: "Corrective snapshot still had concerns.",
      now: now + 20,
    })

    const oneAncestorContext = buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, secondSpecID, [firstSpecID]),
      phase: "post_build",
      goals: [goal("lineage", 1)],
      requirements: [],
      buildRecords: [],
      goalRuns: [],
    })
    const twoAncestorLineage = buildSpecSnapshotLineage({
      taskID,
      activeSpecSnapshotID: activeSpecID,
    })
    const twoAncestorContext = buildIntegrityReplayContext({
      taskID,
      lineage: twoAncestorLineage,
      phase: "post_build",
      goals: [goal("lineage", 1)],
      requirements: [],
      buildRecords: [],
      goalRuns: [],
    })

    expect(oneAncestorContext.priorAttempts.map((attempt) => attempt.artifactID)).toEqual([
      firstAttemptID,
      secondAttemptID,
    ])
    expect(oneAncestorContext.attemptNumber).toBe(3)
    expect(twoAncestorLineage).toMatchObject({
      activeSpecSnapshotID: activeSpecID,
      inheritedSpecSnapshotIDs: [secondSpecID, firstSpecID],
      reason: "integrity_correction_lineage",
    })
    expect(twoAncestorContext.priorAttempts.map((attempt) => attempt.artifactID)).toEqual([
      firstAttemptID,
      secondAttemptID,
    ])
    expect(twoAncestorContext.attemptNumber).toBe(3)
  })

  test("summarizes prior attempts chronologically and includes only evidence newer than latest review", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_replay_context_${stamp}`
    const taskID = `tsk_replay_context_${stamp}`
    const specID = `spec_replay_context_${stamp}`
    seedTask({ projectID, taskID, specIDs: [specID], now })

    const firstAttemptID = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_context_1_${stamp}`,
      lineage: lineage(taskID, specID),
      verdict: "needs_correction",
      phase: "post_build",
      reviewers: [{ reviewerID: "rev_settings", scope: "Settings validation", verdict: "needs_correction" }],
      findings: [
        {
          id: "BF-1",
          severity: "blocking",
          title: "Settings validation blind spot",
          description: "Invalid settings are accepted.",
          repair: "Reject invalid settings before persisting.",
          filePaths: ["src/settings.ts"],
          requirementIDs: ["REQ-2"],
          specIDs: ["settings_validation"],
        },
        {
          id: "ADV-1",
          severity: "advisory",
          title: "Copy can improve",
          description: "Advisory only.",
        },
      ],
      requiredRepairs: [
        { id: "repair-settings", description: "Add settings validation", filePaths: ["src/settings.ts"] },
      ],
      unresolvedDisagreements: [{ id: "dispute-1", description: "Reviewer disagreement" }],
      reason: "Settings validation needs correction.",
      now: now + 10,
    })
    const secondAttemptID = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_context_2_${stamp}`,
      lineage: lineage(taskID, specID),
      verdict: "concerns",
      phase: "post_build",
      reviewers: [{ reviewerID: "rev_storage", scope: "Storage repair verification", verdict: "concerns" }],
      findings: [],
      requiredRepairs: [],
      unresolvedDisagreements: [],
      fact_check_items: [],
      reason: "Only concerns remain.",
      now: now + 20,
    })

    const ctx = buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, specID),
      phase: "post_build",
      goals: [goal("settings", 1), goal("storage", 1)],
      requirements: [{ id: "REQ-2", type: "explicit", description: "Reject invalid settings" }],
      buildRecords: [
        buildRecord({
          id: "build_record_old",
          taskID,
          now: now + 15,
          summary: "Old build record before latest review",
          result: { changed_files: ["src/old.ts"] },
        }),
        buildRecord({
          id: "build_record_new",
          taskID,
          now: now + 25,
          summary: "New build record after latest review",
          result: {
            changed_files: ["src/settings.ts"],
            changedFiles: ["src/storage.ts"],
            diffs: [{ file: "src/settings.ts", status: "modified", additions: 4, deletions: 2 }],
          },
        }),
      ],
      goalRuns: [
        goalRun({ id: "goal_run_old", taskID, goalID: "settings", now: now + 12 }),
        goalRun({ id: "goal_run_new", taskID, goalID: "storage", now: now + 22, completed: now + 26 }),
      ],
    })

    expect(ctx.attemptNumber).toBe(3)
    expect(ctx.priorAttempts.map((attempt) => attempt.artifactID)).toEqual([firstAttemptID, secondAttemptID])
    expect(ctx.priorAttempts[0]).toMatchObject({
      attemptNumber: 1,
      phase: "post_build",
      verdict: "needs_correction",
      summary: "Settings validation needs correction.",
      reviewers: [{ reviewerID: "rev_settings", scope: "Settings validation", verdict: "needs_correction" }],
      blockingFindings: [
        {
          id: "BF-1",
          title: "Settings validation blind spot",
          filePaths: ["src/settings.ts"],
          requirementIDs: ["REQ-2"],
          specIDs: ["settings_validation"],
        },
      ],
      requiredRepairs: [
        { id: "repair-settings", description: "Add settings validation", filePaths: ["src/settings.ts"] },
      ],
      unresolvedDisagreements: [{ id: "dispute-1", description: "Reviewer disagreement" }],
    })
    expect(ctx.priorAttempts[1]).toMatchObject({ attemptNumber: 2, artifactID: secondAttemptID })
    expect(ctx.buildEvidenceSinceLastReview).toMatchObject({
      sinceAttemptNumber: 2,
      sinceTimeCreated: now + 20,
      changedFiles: ["src/settings.ts", "src/storage.ts"],
      diffs: [{ file: "src/settings.ts", status: "modified", additions: 4, deletions: 2 }],
      buildSummaries: ["New build record after latest review"],
      goalRuns: [
        {
          goalID: "storage",
          goalRunID: "goal_run_new",
          status: "completed",
          timeCreated: now + 22,
          timeCompleted: now + 26,
        },
      ],
    })
    expect(ctx.scaleSignals).toMatchObject({
      goals: 2,
      requirements: 1,
      acceptanceSpecs: 2,
      changedFilesTotal: 3,
      changedFilesSinceLastReview: 2,
      priorAttempts: 2,
      priorBlockingFindings: 1,
    })
  })

  test("renders first review replay prompt without fixed-dimension language", () => {
    const ctx = buildIntegrityReplayContext({
      taskID: "tsk_render_first",
      lineage: lineage("tsk_render_first", "spec_render_first"),
      phase: "pre_build",
      goals: [goal("first", 1)],
      requirements: [],
      buildRecords: [],
      goalRuns: [],
    })

    const prompt = renderIntegrityReplayContextPrompt(ctx)
    expect(prompt).toContain("Current integrity attempt: #1")
    expect(prompt).toContain("No prior integrity attempts exist for this task/spec snapshot")
    expect(prompt).toContain("Scale signals:")
    expect(prompt).toContain("- goals=1")
    expect(prompt.toLowerCase()).not.toContain("fixed dimension")
    expect(prompt.toLowerCase()).not.toContain("checklist")
  })

  test("renders terminal build outcomes even when no acceptance records exist", () => {
    const now = Date.now()
    const taskID = `tsk_replay_outcome_${now.toString(16)}`
    const goalRunID = "goal_run_no_diff"
    const ctx = buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, "spec_replay_outcome"),
      phase: "post_build",
      goals: [goal("dashboard", 1)],
      requirements: [],
      buildRecords: [],
      goalRuns: [goalRun({ id: goalRunID, taskID, goalID: "dashboard", now, completed: now + 5 })],
      buildOutcomes: [
        buildOutcome({
          id: "outcome_no_diff",
          taskID,
          goalID: "dashboard",
          goalRunID,
          now: now + 5,
          outcomeKind: "no_project_diff",
          summary: "Build completed but produced no project diff.",
          noDiffReason: "actual_changed_files_empty",
        }),
      ],
    })

    expect(ctx.buildEvidenceSinceLastReview.goalRuns[0]).toMatchObject({
      goalID: "dashboard",
      goalRunID,
      status: "completed",
      outcomeKind: "no_project_diff",
      noDiffReason: "actual_changed_files_empty",
      changedFiles: [],
    })
    const prompt = renderIntegrityReplayContextPrompt(ctx)
    expect(prompt).toContain("outcome=no_project_diff")
    expect(prompt).toContain("no_diff=actual_changed_files_empty")
    expect(prompt).toContain("changed_files=0")
  })

  test("renders re-review prompt with prior blockers, repairs, reviewer focuses, changed files, and scale signals", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_replay_render_${stamp}`
    const taskID = `tsk_replay_render_${stamp}`
    const specID = `spec_replay_render_${stamp}`
    seedTask({ projectID, taskID, specIDs: [specID], now })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_replay_render_${stamp}`,
      lineage: lineage(taskID, specID),
      verdict: "needs_correction",
      phase: "post_build",
      reviewers: [{ reviewerID: "rev_settings", scope: "Settings validation", verdict: "needs_correction" }],
      findings: [
        {
          id: "BF-1",
          severity: "blocking",
          title: "Settings validation blind spot",
          description: "Invalid settings are accepted.",
          repair: "Reject invalid settings before persisting.",
          filePaths: ["src/settings.ts"],
          requirementIDs: ["REQ-2"],
          specIDs: ["settings_validation"],
        },
      ],
      requiredRepairs: [
        { id: "repair-settings", description: "Add settings validation", filePaths: ["src/settings.ts"] },
      ],
      now: now + 10,
    })
    const ctx = buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, specID),
      phase: "post_build",
      goals: [goal("settings", 1)],
      requirements: [{ id: "REQ-2", type: "explicit", description: "Reject invalid settings" }],
      buildRecords: [
        buildRecord({
          id: "build_record_render_new",
          taskID,
          now: now + 20,
          summary: "Settings validation repair build record",
          result: { changed_files: ["src/settings.ts"], diffs: [{ file: "src/storage.ts", status: "modified" }] },
        }),
      ],
      goalRuns: [],
    })

    const prompt = renderIntegrityReplayContextPrompt(ctx)
    expect(prompt).toContain("Current integrity attempt: #2")
    expect(prompt).toContain("verdict=needs_correction")
    expect(prompt).toContain("rev_settings: Settings validation")
    expect(prompt).toContain("BF-1: Settings validation blind spot")
    expect(prompt).toContain("repair: Reject invalid settings before persisting.")
    expect(prompt).toContain("repair-settings: Add settings validation")
    expect(prompt).toContain("directories: src")
    expect(prompt).not.toContain("src/settings.ts")
    expect(prompt).not.toContain("src/storage.ts")
    expect(prompt).toContain("- prior_attempts=1")
    expect(prompt).toContain("- prior_blocking_findings=1")
  })

  test("recordIntegrityAttempt materializes attempts from the artifact list counter", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_attempts_${stamp}`
    const taskID = `tsk_attempts_${stamp}`
    const specID = `spec_attempts_${stamp}`
    seedTask({ projectID, taskID, specIDs: [specID], now })

    const first = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_attempts_1_${stamp}`,
      lineage: lineage(taskID, specID),
      verdict: "needs_correction",
      phase: "post_build",
      now: now + 10,
    })
    const second = recordIntegrityAttempt({
      taskID,
      sessionID: `ses_attempts_2_${stamp}`,
      lineage: lineage(taskID, specID),
      verdict: "pass",
      phase: "post_build",
      now: now + 20,
    })

    const attempts = listIntegrityAttemptArtifacts({ taskID, lineage: lineage(taskID, specID) })
    const firstPayload = attempts.find((row) => row.id === first)?.payload as Record<string, unknown> | undefined
    const secondPayload = attempts.find((row) => row.id === second)?.payload as Record<string, unknown> | undefined
    expect(firstPayload?.attempts).toBe(1)
    expect(secondPayload?.attempts).toBe(2)
  })
})
