import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { EngineArtifactTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { findLatestIntegrityAttemptArtifact, listIntegrityAttemptArtifacts } from "../../src/engine/store"
import type { GoalRunRow } from "../../src/engine/store"
import type { TaskAgentOutcome } from "../../src/agent/outcomes"
import {
  buildIntegrityReplayContext,
  buildSpecSnapshotLineage,
  INTEGRITY_REPLAY_CONTEXT_PACKET_SCHEMA,
  INTEGRITY_REPLAY_CONTEXT_PACKET_SOURCE,
  integrityReplayContextFromContextPackets,
  integrityReplayContextPacket,
  renderIntegrityReplayContextPrompt,
} from "../../src/integrity/replay-context"
import { buildIntegrityRootHistory } from "../../src/integrity/root-history"
import { renderAgentContextPackets } from "../../src/agent/context-packet"
import type { GoalContractFields } from "../../src/pipeline/types"
import { canonicalIntegritySymptom, integrityFindingFingerprint } from "../../src/integrity/finding-manifest"
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

function withIntegrityFingerprint<T extends Record<string, unknown>>(input: T): T & {
  canonicalSymptom: string
  fingerprint: string
} {
  const canonicalSymptom = canonicalIntegritySymptom(input)
  return {
    ...input,
    canonicalSymptom,
    fingerprint: integrityFindingFingerprint({ ...input, canonicalSymptom }),
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

function agentOutcome(input: {
  id: string
  provider?: string
  artifactKind?: string
  scope?: "task" | "goal"
  runID?: string
  sessionID?: string
  goalID?: string | null
  goalRunID?: string | null
  now: number
  outcomeKind: string
  terminalStatus?: string
  summary?: string
  error?: string
  noDiffReason?: string
  changedFiles?: string[]
  reportedChangedFiles?: string[]
  commitRef?: string
}): TaskAgentOutcome {
  return {
    id: input.id,
    provider: input.provider ?? "build",
    artifactKind: input.artifactKind ?? "build_attempt_outcome",
    scope: input.scope ?? (input.goalRunID ? "goal" : "task"),
    capabilities: ["implementation"],
    runID: input.runID ?? `${input.id}_run`,
    goalID: input.goalID,
    goalRunID: input.goalRunID,
    sessionID: input.sessionID ?? (input.goalRunID ? `${input.goalRunID}_session` : `${input.id}_session`),
    status: input.terminalStatus ?? "completed",
    result: input.outcomeKind,
    summary: input.summary ?? `Outcome ${input.id}`,
    error: input.error,
    noDiffReason: input.noDiffReason,
    changedFiles: input.changedFiles ?? [],
    reportedChangedFiles: input.reportedChangedFiles ?? input.changedFiles ?? [],
    commitRef: input.commitRef,
    time: { created: input.now, updated: input.now },
  }
}

function replayPacketFromStructuredData(data: unknown) {
  return {
    id: "integrity-replay-context-test",
    title: "Integrity Replay Context Test",
    source: INTEGRITY_REPLAY_CONTEXT_PACKET_SOURCE,
    scope: "task" as const,
    parts: [
      {
        type: "structured" as const,
        schema: INTEGRITY_REPLAY_CONTEXT_PACKET_SCHEMA,
        data,
      },
    ],
  }
}

describe("integrity replay context artifact source", () => {
beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

test("integrity replay context travels through structured context packets without dumping JSON into prompt text", () => {
  const now = Date.UTC(2026, 6, 4, 8)
  const taskID = "tsk_replay_packet"
  seedTask({ projectID: "prj_replay_packet", taskID, specIDs: ["spec_replay_packet"], now })
  const context = buildIntegrityReplayContext({
    taskID,
    lineage: lineage(taskID, "spec_replay_packet"),
    phase: "post_build",
    goals: [goal("packet", 1)],
    buildRecords: [
      buildRecord({
        id: "build_packet",
        taskID,
        now,
        summary: "Packet implementation changed the dashboard route.",
        result: { changed_files: ["src/routes/dashboard.tsx"] },
      }),
    ],
    goalRuns: [goalRun({ id: "run_packet", taskID, goalID: "packet", now })],
  })

  const packet = integrityReplayContextPacket(context)
  const rendered = renderAgentContextPackets([packet])

  expect(integrityReplayContextFromContextPackets([packet])).toEqual(context)
  expect(rendered).toContain("structured_ref: schema=opencorvus.integrity.replay_context.v1")
  expect(rendered).toContain("changed_files_since_last_review: 1")
  expect(rendered).not.toContain("Packet implementation changed the dashboard route.")
  expect(rendered).not.toContain("\"implementationEvidenceSinceLastReview\"")
})

test("rejects malformed nested structured replay context before prompt rendering", () => {
  const context = buildIntegrityReplayContext({
    taskID: "tsk_replay_malformed_packet",
    lineage: lineage("tsk_replay_malformed_packet", "spec_replay_malformed_packet"),
    phase: "post_build",
    goals: [goal("malformed", 1)],
    buildRecords: [],
    goalRuns: [],
  })

  expect(() =>
    integrityReplayContextFromContextPackets([
      replayPacketFromStructuredData({
        ...context,
        lineage: {
          ...context.lineage,
          activeSpecSnapshotID: undefined,
        },
      }),
    ]),
  ).toThrow(/lineage\.activeSpecSnapshotID/)

  expect(() =>
    integrityReplayContextFromContextPackets([
      replayPacketFromStructuredData({
        ...context,
        implementationEvidenceSinceLastReview: {
          ...context.implementationEvidenceSinceLastReview,
          diffs: [{}],
        },
      }),
    ]),
  ).toThrow(/implementationEvidenceSinceLastReview\.diffs\.0\.file/)

  expect(() =>
    integrityReplayContextFromContextPackets([
      replayPacketFromStructuredData({
        ...context,
        priorAttempts: [{ attemptNumber: 1 }],
      }),
    ]),
  ).toThrow(/priorAttempts\.0\.artifactID/)

  expect(() =>
    integrityReplayContextFromContextPackets([
      replayPacketFromStructuredData({
        ...context,
        priorAttempts: [
          {
            attemptNumber: 1,
            artifactID: "artifact_integrity_attempt",
            timeCreated: Date.UTC(2026, 6, 4, 8),
            reviewers: [],
            blockingFindings: [],
            requiredRepairs: [
              {
                id: "repair-bad-fingerprint",
                fingerprint: "legacy-fingerprint",
                canonicalSymptom: "Legacy fingerprint must fail.",
                description: "Legacy fingerprint must fail.",
                repair: "Use protocol fingerprint.",
                verify: [],
                filePaths: [],
                requirementIDs: [],
                specIDs: [],
                sourceFindingIDs: [],
                priorAttemptRefs: [],
              },
            ],
            unresolvedDisagreements: [],
          },
        ],
      }),
    ]),
  ).toThrow(/fingerprint/)

  expect(() =>
    integrityReplayContextFromContextPackets([
      replayPacketFromStructuredData({
        ...context,
        priorFactCheckAttempts: [
          {
            artifactID: "artifact_fact_check",
            factCheckSessionID: "session_fact_check",
            timeCreated: Date.UTC(2026, 6, 4, 8),
            targetSessionID: 123,
            targetAgent: "build",
            targetMessageID: "message_fact_check",
            verdict: "clean",
            outcome: "completed",
            itemsTotal: 1,
            itemsInspected: 1,
            verifiedCount: 1,
            correctedCount: 0,
            unresolvedCount: 0,
          },
        ],
      }),
    ]),
  ).toThrow(/priorFactCheckAttempts\.0\.targetSessionID/)
})

test("rejects malformed persisted integrity attempt payloads instead of filtering them", () => {
  const now = Date.now()
  const stamp = `${now.toString(16)}_${Math.random().toString(16).slice(2)}`
  const projectID = `proj_replay_malformed_attempt_${stamp}`
  const taskID = `tsk_replay_malformed_attempt_${stamp}`
  const specID = `spec_replay_malformed_attempt_${stamp}`
  seedTask({ projectID, taskID, specIDs: [specID], now })

  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: `art_bad_integrity_${stamp}`,
        task_id: taskID,
        run_id: null,
        goal_run_id: null,
        kind: "integrity_attempt",
        label: "verdict-needs_correction",
        payload: {
          spec_snapshot_id: specID,
          session_id: `ses_replay_malformed_attempt_${stamp}`,
          verdict: "needs_correction",
          phase: "post_build",
          attempts: 1,
          reviewers: [],
          findings_count: 1,
          required_repairs_count: 0,
          unresolved_disagreements_count: 0,
          reason: "Malformed payload should fail at read time.",
          team_report_markdown: "Malformed payload should fail at read time.",
          findings: [
            {
              id: "BF-malformed",
              severity: "blocking",
              verdictImpact: "needs_correction",
              fingerprint: "if_deadbeefdeadbeef",
              canonicalSymptom: "Malformed finding payload.",
              title: "Malformed finding payload",
              description: "A malformed finding payload must not be filtered.",
              evidence: ["malformed evidence"],
              targetIDs: [],
              requirementIDs: [],
              specIDs: [],
              filePaths: ["src/App.tsx", 7],
              affectedSymbols: [],
              repair: "Reject malformed payloads.",
              verify: ["Payload read rejects malformed fields."],
              sourceFindingIDs: [],
              priorAttemptRefs: [],
              reviewers: ["rev_malformed"],
              extra: true,
            },
          ],
          rounds: [],
          required_repairs: [],
          unresolved_disagreements: [],
          time_completed: now + 10,
        },
        time_created: now + 10,
        time_updated: now + 10,
      })
      .run(),
  )

  expect(() =>
    buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, specID),
      phase: "post_build",
      goals: [],
      requirements: [],
      buildRecords: [],
      goalRuns: [],
    }),
  ).toThrow(/integrity attempt artifact/)

  expect(() =>
    buildIntegrityRootHistory({
      taskID,
      specSnapshotLineage: lineage(taskID, specID),
    }),
  ).toThrow(/integrity attempt artifact/)
})

test("recordIntegrityAttempt writes host-computed protocol fingerprints", () => {
  const now = Date.now()
  const stamp = `${now.toString(16)}_${Math.random().toString(16).slice(2)}`
  const projectID = `proj_replay_computed_fingerprint_${stamp}`
  const taskID = `tsk_replay_computed_fingerprint_${stamp}`
  const specID = `spec_replay_computed_fingerprint_${stamp}`
  seedTask({ projectID, taskID, specIDs: [specID], now })

  const attemptID = recordIntegrityAttempt({
    taskID,
    sessionID: `ses_replay_computed_fingerprint_${stamp}`,
    lineage: lineage(taskID, specID),
    verdict: "needs_correction",
    phase: "post_build",
    findings: [
      {
        id: "BF-computed-fingerprint",
        severity: "blocking",
        title: "Computed fingerprint",
        description: "The host computes this fingerprint before persistence.",
        evidence: ["computed fingerprint evidence"],
        repair: "Persist a protocol fingerprint.",
      },
    ],
    now: now + 10,
  })

  const ctx = buildIntegrityReplayContext({
    taskID,
    lineage: lineage(taskID, specID),
    phase: "post_build",
    goals: [],
    requirements: [],
    buildRecords: [],
    goalRuns: [],
  })

  expect(ctx.priorAttempts[0]?.artifactID).toBe(attemptID)
  expect(ctx.priorAttempts[0]?.findings?.[0]?.fingerprint).toMatch(/^if_[a-f0-9]{16}$/)
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

  test("builds first-attempt replay context with scale counts and all implementation evidence", () => {
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
    expect(ctx.implementationEvidenceSinceLastReview.changedFiles).toEqual([
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
        withIntegrityFingerprint({
          id: "BF-1",
          severity: "blocking",
          title: "Settings validation blind spot",
          description: "Invalid settings are accepted.",
          repair: "Reject invalid settings before persisting.",
          filePaths: ["src/settings.ts"],
          requirementIDs: ["REQ-2"],
          specIDs: ["settings_validation"],
        }),
        withIntegrityFingerprint({
          id: "ADV-1",
          severity: "advisory",
          title: "Copy can improve",
          description: "Advisory only.",
          repair: "Polish copy later.",
        }),
      ],
      requiredRepairs: [
        withIntegrityFingerprint({
          id: "repair-settings",
          description: "Add settings validation",
          filePaths: ["src/settings.ts"],
        }),
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
    expect(ctx.implementationEvidenceSinceLastReview).toMatchObject({
      sinceAttemptNumber: 2,
      sinceTimeCreated: now + 20,
      changedFiles: ["src/settings.ts", "src/storage.ts"],
      diffs: [{ file: "src/settings.ts", status: "modified", additions: 4, deletions: 2 }],
      implementationSummaries: ["New build record after latest review"],
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
      agentOutcomes: [
        agentOutcome({
          id: "outcome_no_diff",
          goalID: "dashboard",
          goalRunID,
          now: now + 5,
          outcomeKind: "no_project_diff",
          summary: "Build completed but produced no project diff.",
          noDiffReason: "actual_changed_files_empty",
        }),
      ],
    })

    expect(ctx.implementationEvidenceSinceLastReview.goalRuns[0]).toMatchObject({
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

  test("renders task-level direct build outcomes after latest review", () => {
    const now = Date.now()
    const taskID = `tsk_replay_task_build_${now.toString(16)}`
    const outcome = agentOutcome({
      id: "outcome_task_direct_route",
      runID: "run_task_direct_route",
      sessionID: "ses_task_direct_route",
      now: now + 20,
      outcomeKind: "delivered",
      summary: "Direct build repaired the world economy route.",
      changedFiles: ["src/routes/world-economy.tsx"],
      reportedChangedFiles: ["src/routes/world-economy.tsx"],
      commitRef: "44489b5",
    })
    const ctx = buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, "spec_replay_task_build"),
      phase: "post_build",
      goals: [],
      requirements: [],
      buildRecords: [],
      goalRuns: [],
      agentOutcomes: [
        outcome,
        agentOutcome({
          id: "outcome_custom_implementation",
          provider: "custom-implementation-agent",
          artifactKind: "custom_implementation_outcome",
          runID: "run_custom_implementation",
          sessionID: "ses_custom_implementation",
          now: now + 30,
          outcomeKind: "delivered",
          summary: "A non-Build implementation provider repaired a shared helper.",
          changedFiles: ["src/lib/shared-helper.ts"],
          reportedChangedFiles: ["src/lib/shared-helper.ts"],
          commitRef: "abc1234",
        }),
      ],
    })

    expect(ctx.implementationEvidenceSinceLastReview.changedFiles).toEqual([
      "src/lib/shared-helper.ts",
      "src/routes/world-economy.tsx",
    ])
    expect(ctx.implementationEvidenceSinceLastReview.taskAgentOutcomes[0]).toMatchObject({
      provider: "build",
      artifactKind: "build_attempt_outcome",
      artifactID: "outcome_task_direct_route",
      terminalStatus: "completed",
      outcomeKind: "delivered",
      actualChangedFiles: ["src/routes/world-economy.tsx"],
      reportedChangedFiles: ["src/routes/world-economy.tsx"],
      commitRef: "44489b5",
    })
    expect(ctx.implementationEvidenceSinceLastReview.taskAgentOutcomes[1]).toMatchObject({
      provider: "custom-implementation-agent",
      artifactKind: "custom_implementation_outcome",
      artifactID: "outcome_custom_implementation",
      actualChangedFiles: ["src/lib/shared-helper.ts"],
    })
    const prompt = renderIntegrityReplayContextPrompt(ctx)
    expect(prompt).toContain("Task-level agent outcomes after latest review")
    expect(prompt).toContain("provider=build, kind=build_attempt_outcome")
    expect(prompt).toContain("provider=custom-implementation-agent, kind=custom_implementation_outcome")
    expect(prompt).toContain("outcome_task_direct_route")
    expect(prompt).toContain("actual_changed_files=1")
    expect(prompt).toContain("reported_changed_files=1")
    expect(prompt).toContain("commit=44489b5")
  })

  test("keeps reported-only task build files out of integrity changed file rollup", () => {
    const now = Date.now()
    const taskID = `tsk_replay_task_build_reported_only_${now.toString(16)}`
    const outcome = agentOutcome({
      id: "outcome_task_direct_reported_only",
      runID: "run_task_direct_reported_only",
      sessionID: "ses_task_direct_reported_only",
      now: now + 20,
      outcomeKind: "no_project_diff",
      summary: "Direct build self-reported a route edit without host diff evidence.",
      noDiffReason: "missing_commit_ref",
      changedFiles: [],
      reportedChangedFiles: ["src/routes/world-economy.tsx"],
    })
    const ctx = buildIntegrityReplayContext({
      taskID,
      lineage: lineage(taskID, "spec_replay_task_build_reported_only"),
      phase: "post_build",
      goals: [],
      requirements: [],
      buildRecords: [],
      goalRuns: [],
      agentOutcomes: [outcome],
    })

    expect(ctx.implementationEvidenceSinceLastReview.changedFiles).toEqual([])
    expect(ctx.implementationEvidenceSinceLastReview.taskAgentOutcomes[0]).toMatchObject({
      provider: "build",
      artifactKind: "build_attempt_outcome",
      outcomeKind: "no_project_diff",
      noDiffReason: "missing_commit_ref",
      actualChangedFiles: [],
      reportedChangedFiles: ["src/routes/world-economy.tsx"],
      commitRef: undefined,
    })
    const prompt = renderIntegrityReplayContextPrompt(ctx)
    expect(prompt).toContain("actual_changed_files=0")
    expect(prompt).toContain("reported_changed_files=1")
    expect(prompt).not.toContain("changedFiles: src/routes/world-economy.tsx")
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
        withIntegrityFingerprint({
          id: "BF-1",
          severity: "blocking",
          title: "Settings validation blind spot",
          description: "Invalid settings are accepted.",
          repair: "Reject invalid settings before persisting.",
          filePaths: ["src/settings.ts"],
          requirementIDs: ["REQ-2"],
          specIDs: ["settings_validation"],
        }),
      ],
      requiredRepairs: [
        withIntegrityFingerprint({
          id: "repair-settings",
          description: "Add settings validation",
          filePaths: ["src/settings.ts"],
        }),
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
