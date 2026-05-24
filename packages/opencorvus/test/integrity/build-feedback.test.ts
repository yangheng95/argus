import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { composeIntegrityFeedbackForBuild } from "../../src/integrity/build-feedback"
import { buildIntegrityRootHistory } from "../../src/integrity/root-history"
import { getSharedIntegrityPromptBudget, type SharedPromptBudget } from "../../src/integrity/shared-prompt"
import type { SpecSnapshotLineage } from "../../src/integrity/replay-context"
import { resetDatabase } from "../fixture/db"

function seedTask(input: { projectID: string; taskID: string; specIDs: string[]; now: number }) {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: process.cwd(),
        name: "Build feedback test",
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
        title: "Build feedback task",
        request: "Repair integrity feedback",
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

function lineage(taskID: string, activeSpecSnapshotID: string, inheritedSpecSnapshotIDs: string[] = []): SpecSnapshotLineage {
  return {
    taskID,
    activeSpecSnapshotID,
    inheritedSpecSnapshotIDs,
    reason: inheritedSpecSnapshotIDs.length > 0 ? "integrity_correction_lineage" : "active_only",
  }
}

function budget(overrides: Partial<SharedPromptBudget> = {}): SharedPromptBudget {
  return { ...getSharedIntegrityPromptBudget(), ...overrides }
}

function feedback(input: {
  taskID: string
  lineage: SpecSnapshotLineage
  promptBudget?: SharedPromptBudget
  runtimeMarkdownDir?: string
}) {
  return composeIntegrityFeedbackForBuild({
    taskID: input.taskID,
    specSnapshotLineage: input.lineage,
    promptBudget: input.promptBudget ?? getSharedIntegrityPromptBudget(),
    runtimeMarkdownDir: input.runtimeMarkdownDir,
  })
}

describe("composeIntegrityFeedbackForBuild", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("returns undefined when no integrity attempts exist", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_build_feedback_empty_${stamp}`
    const taskID = `tsk_build_feedback_empty_${stamp}`
    const specID = `spec_build_feedback_empty_${stamp}`
    seedTask({ projectID, taskID, specIDs: [specID], now })

    expect(feedback({ taskID, lineage: lineage(taskID, specID) })).toBeUndefined()
  })

  test("renders latest blocking and advisory findings with persistent root facts from the owner history API", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_build_feedback_${stamp}`
    const taskID = `tsk_build_feedback_${stamp}`
    const specID = `spec_build_feedback_${stamp}`
    const rootLineage = lineage(taskID, specID)
    seedTask({ projectID, taskID, specIDs: [specID], now })

    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_build_feedback_1_${stamp}`,
      lineage: rootLineage,
      verdict: "needs_correction",
      phase: "post_build",
      reviewers: [{ reviewerID: "rev_storage", scope: "Storage validation", verdict: "needs_correction" }],
      findings: [
        {
          id: "BF-R1-storage",
          rootID: "storage-validation",
          canonicalLabel: "Validate persisted settings",
          severity: "blocking",
          title: "Persisted settings are trusted",
          description: "getSettings() trusts localStorage values.",
          evidence: ["src/services/storage.ts getSettings"],
          repair: "Validate persisted settings on load.",
          reviewers: ["rev_storage"],
          filePaths: ["src/services/storage.ts"],
          requirementIDs: ["REQ-settings"],
        },
      ],
      now: now + 10,
    })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_build_feedback_2_${stamp}`,
      lineage: rootLineage,
      verdict: "needs_correction",
      phase: "post_build",
      reviewers: [{ reviewerID: "rev_settings", scope: "Settings repair verification", verdict: "needs_correction" }],
      findings: [
        {
          id: "BF-R2-settings-validation",
          rootID: "storage-validation",
          canonicalLabel: "Validate persisted settings",
          severity: "blocking",
          title: "getSettings does not validate model, temperature, or maxTokens",
          description: "getSettings() lets invalid model/temperature/maxTokens values from localStorage reach the API settings.",
          evidence: ["src/services/storage.ts getSettings still returns unchecked values"],
          repair: "Validate model against ALLOWED_MODELS, clamp temperature to [0,2], clamp maxTokens to [1,8192].",
          reviewers: ["rev_settings", "rev_storage"],
          filePaths: ["src/services/storage.ts"],
          requirementIDs: ["REQ-settings"],
          specIDs: ["settings_validation"],
        },
      ],
      now: now + 20,
    })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_build_feedback_3_${stamp}`,
      lineage: rootLineage,
      verdict: "needs_correction",
      phase: "post_build",
      reviewers: [{ reviewerID: "rev_settings", scope: "Settings repair verification", verdict: "needs_correction" }],
      findings: [
        {
          id: "BF-R3-settings-validation",
          rootID: "storage-validation",
          canonicalLabel: "Validate persisted settings",
          severity: "blocking",
          title: "getSettings still does not validate model, temperature, or maxTokens",
          description: "getSettings() still lets invalid model/temperature/maxTokens values from localStorage reach the API settings.",
          evidence: ["src/services/storage.ts getSettings still returns unchecked values"],
          repair: "Validate model against ALLOWED_MODELS, clamp temperature to [0,2], clamp maxTokens to [1,8192].",
          reviewers: ["rev_settings", "rev_storage"],
          filePaths: ["src/services/storage.ts"],
          requirementIDs: ["REQ-settings"],
          specIDs: ["settings_validation"],
        },
        {
          id: "AF-copy",
          severity: "advisory",
          title: "Settings copy could be clearer",
          description: "The error copy can be clearer after blockers are fixed.",
          evidence: ["SettingsPanel helper text"],
          repair: "Polish helper text when it does not distract from blockers.",
          reviewers: ["rev_settings"],
          filePaths: ["src/components/SettingsPanel.tsx"],
        },
      ],
      now: now + 30,
    })

    const composed = feedback({ taskID, lineage: rootLineage })?.promptMarkdown ?? ""
    const rootHistory = buildIntegrityRootHistory({
      taskID,
      specSnapshotLineage: rootLineage,
      phase: "post_build",
    })

    const persistentRoot = rootHistory.persistentBlockingRoots[0]
    expect(persistentRoot?.rootID.startsWith("root_")).toBe(true)
    expect(persistentRoot?.consecutiveAttempts).toEqual([1, 2, 3])
    expect(composed).toContain("## Persistent Integrity Findings")
    expect(composed).toContain(persistentRoot!.rootID)
    expect(composed).toContain("R1, R2, R3")
    expect(composed).toContain("BF-R3-settings-validation")
    expect(composed).toContain("getSettings does not validate model, temperature, or maxTokens")
    expect(composed).toContain("src/services/storage.ts")
    expect(composed).toContain("Validate model against ALLOWED_MODELS")
    expect(composed).toContain("reviewer ids: rev_settings, rev_storage")
    expect(composed).toContain("### Advisory findings from the latest review")
    expect(composed).toContain("AF-copy")
  })

  test("uses supplied spec snapshot lineage instead of active snapshot only", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_build_feedback_lineage_${stamp}`
    const taskID = `tsk_build_feedback_lineage_${stamp}`
    const oldSpecID = `spec_build_feedback_old_${stamp}`
    const activeSpecID = `spec_build_feedback_active_${stamp}`
    seedTask({ projectID, taskID, specIDs: [oldSpecID, activeSpecID], now })

    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_lineage_1_${stamp}`,
      lineage: lineage(taskID, oldSpecID),
      verdict: "needs_correction",
      phase: "post_build",
      findings: [
        {
          id: "BF-old",
          rootID: "lineage-root",
          severity: "blocking",
          title: "Old snapshot root",
          description: "lineageRoot() old snapshot already found this root.",
          evidence: ["src/lineage.ts"],
          repair: "Repair the root across snapshots.",
          filePaths: ["src/lineage.ts"],
        },
      ],
      now: now + 10,
    })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_lineage_2_${stamp}`,
      lineage: lineage(taskID, activeSpecID, [oldSpecID]),
      verdict: "needs_correction",
      phase: "post_build",
      findings: [
        {
          id: "BF-active",
          rootID: "lineage-root",
          severity: "blocking",
          title: "Active snapshot root still exists",
          description: "lineageRoot() active corrective snapshot still reports the root.",
          evidence: ["src/lineage.ts"],
          repair: "Repair active snapshot implementation.",
          filePaths: ["src/lineage.ts"],
        },
      ],
      now: now + 20,
    })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_lineage_3_${stamp}`,
      lineage: lineage(taskID, activeSpecID, [oldSpecID]),
      verdict: "needs_correction",
      phase: "post_build",
      findings: [
        {
          id: "BF-active-latest",
          rootID: "lineage-root",
          severity: "blocking",
          title: "Active snapshot root remains",
          description: "lineageRoot() still reports the active corrective snapshot root.",
          evidence: ["src/lineage.ts"],
          repair: "Repair active snapshot implementation.",
          filePaths: ["src/lineage.ts"],
        },
      ],
      now: now + 30,
    })

    const composed = feedback({ taskID, lineage: lineage(taskID, activeSpecID, [oldSpecID]) })?.promptMarkdown ?? ""
    expect(composed).toContain("Integrity has reviewed this task 3 time(s)")
    expect(composed).toContain(`inherited=${oldSpecID}`)
    expect(composed).toContain("BF-active-latest")
    expect(composed).toContain("R1, R2, R3")
  })

  test("returns undefined when latest integrity attempt passed", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_build_feedback_pass_${stamp}`
    const taskID = `tsk_build_feedback_pass_${stamp}`
    const specID = `spec_build_feedback_pass_${stamp}`
    const rootLineage = lineage(taskID, specID)
    seedTask({ projectID, taskID, specIDs: [specID], now })

    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_pass_1_${stamp}`,
      lineage: rootLineage,
      verdict: "needs_correction",
      phase: "post_build",
      findings: [
        {
          id: "BF-old",
          rootID: "fixed-root",
          severity: "blocking",
          title: "Old blocker",
          description: "Old blocker description.",
          evidence: ["src/fixed.ts"],
          repair: "Fix it.",
        },
      ],
      now: now + 10,
    })
    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_pass_2_${stamp}`,
      lineage: rootLineage,
      verdict: "pass",
      phase: "post_build",
      findings: [],
      now: now + 20,
    })

    expect(feedback({ taskID, lineage: rootLineage })).toBeUndefined()
  })

  test("materializes complete blocking feedback to runtime markdown when shared cap is hit", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_build_feedback_cap_${stamp}`
    const taskID = `tsk_build_feedback_cap_${stamp}`
    const specID = `spec_build_feedback_cap_${stamp}`
    const rootLineage = lineage(taskID, specID)
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-build-feedback-"))
    seedTask({ projectID, taskID, specIDs: [specID], now })

    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_cap_${stamp}`,
      lineage: rootLineage,
      verdict: "needs_correction",
      phase: "post_build",
      findings: [
        {
          id: "BF-cap-1",
          rootID: "cap-root-1",
          severity: "blocking",
          title: "First blocker survives runtime materialization",
          description: "x".repeat(900),
          evidence: ["src/cap-a.ts"],
          repair: "Repair first blocker.",
        },
        {
          id: "BF-cap-2",
          rootID: "cap-root-2",
          severity: "blocking",
          title: "Second blocker survives runtime materialization",
          description: "y".repeat(900),
          evidence: ["src/cap-b.ts"],
          repair: "Repair second blocker.",
        },
      ],
      now: now + 10,
    })

    const composed = feedback({
      taskID,
      lineage: rootLineage,
      promptBudget: budget({ totalCharCap: 600, persistentRootsCharCap: 200 }),
      runtimeMarkdownDir: runtimeDir,
    })

    expect(composed?.runtimeMarkdownPath).toBeDefined()
    expect(composed?.promptMarkdown).toContain("runtime markdown:")
    expect(composed?.promptMarkdown).toContain("Build must read that file before editing")
    const runtimeMarkdown = await fs.readFile(composed!.runtimeMarkdownPath!, "utf8")
    expect(runtimeMarkdown).toContain("BF-cap-1")
    expect(runtimeMarkdown).toContain("First blocker survives runtime materialization")
    expect(runtimeMarkdown).toContain("BF-cap-2")
    expect(runtimeMarkdown).toContain("Second blocker survives runtime materialization")
  })

  test("sanitizes reviewer text before rendering prompt or runtime markdown", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_build_feedback_sanitize_${stamp}`
    const taskID = `tsk_build_feedback_sanitize_${stamp}`
    const specID = `spec_build_feedback_sanitize_${stamp}`
    const rootLineage = lineage(taskID, specID)
    seedTask({ projectID, taskID, specIDs: [specID], now })

    recordIntegrityAttempt({
      taskID,
      sessionID: `ses_sanitize_${stamp}`,
      lineage: rootLineage,
      verdict: "needs_correction",
      phase: "post_build",
      findings: [
        {
          id: "BF-sanitize",
          rootID: "sanitize-root",
          severity: "blocking",
          title: "# injected title",
          description: "\u001B[31m# injected description\u001B[0m\n\u202Ertl\x00",
          evidence: ["```evidence"],
          repair: "<script>repair()</script>",
        },
      ],
      now: now + 10,
    })

    const composed = feedback({ taskID, lineage: rootLineage })?.promptMarkdown ?? ""
    expect(composed).not.toContain("\u001B")
    expect(composed).toContain("\\# injected description")
    expect(composed).toContain("[BIDI U+202E REMOVED]")
    expect(composed).toContain("[NUL REMOVED]")
    expect(composed).toContain("\\```evidence")
    expect(composed).toContain("\\<script>repair()</script>")
  })
})
