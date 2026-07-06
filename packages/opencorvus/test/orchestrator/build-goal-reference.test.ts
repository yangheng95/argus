import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { buildEvidencePackFromContextPackets } from "../../src/build/evidence-pack"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { AttachmentStore } from "../../src/storage/attachment-store"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EnginePlanVersionTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Session } from "../../src/session"
import { goalStatusByID } from "../../src/engine/describe"
import { listGoalRunsByGoal } from "../../src/engine/store"
import { createDecisionLog } from "../../src/decision-log"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined

function buildToolOptions(label = "goal_reference") {
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
  if (
    result &&
    typeof result === "object" &&
    (result as { type?: unknown }).type === "final" &&
    typeof (result as { output?: unknown }).output === "string"
  ) {
    return (result as { output: string }).output
  }
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: Array<{ text?: string }> }).content
    const text = content
      ?.map((part) => part.text)
      .filter(Boolean)
      .join("\n")
    if (text) return text
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
  return String(result)
}

function expectGoalBuildStarted(result: unknown): string {
  const text = toolText(result)
  expect(text).toContain("Build agent started (status=running")
  return text
}

async function waitForGoalStatus(goalID: string, status: "passed" | "failed" | "running") {
  for (let i = 0; i < 200; i += 1) {
    if (goalStatusByID(goalID) === status) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for goal ${goalID} to reach ${status}`)
}

mock.module("@/build/agent", () => ({
  BuildAgent: {
    run: (input: any) => {
      if (!buildAgentRunImpl) throw new Error("BuildAgent.run mock not configured")
      return buildAgentRunImpl(input)
    },
  },
}))

describe("orchestrator build goal references", () => {
  afterEach(async () => {
    buildAgentRunImpl = undefined
    await resetDatabase()
  }, 30_000)

  test("resolves active-plan display labels like G12 before dispatching build", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 12,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal reference root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)

        let observedGoalID = ""
        buildAgentRunImpl = async (input: any) => {
          await input.onSessionCreated?.("ses_goal_ref_build", {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          observedGoalID = input.target.id
          return {
            result: {
              status: "passed",
              summary: "Resolved display goal reference.",
              files_changed: [
                {
                  path: "src/goal12.ts",
                  summary: "Implemented the twelfth goal.",
                  reason: "Regression coverage for display goal references.",
                },
              ],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_ref_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: "G12",
            request: "Implement goal twelve.",
            reason: "Per-goal pipeline execution using a displayed goal label.",
          },
          buildToolOptions("goal_ref_g12"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(ids.goalIDs[11]!, "passed")
        expect(observedGoalID).toBe(ids.goalIDs[11])
        expect(listGoalRunsByGoal(ids.goalIDs[11]!)).toHaveLength(1)
      },
    })
  }, 30_000)

  test("passes goal-scoped frontend-design context without full-page reference path", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 1,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal build context root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)
        const decisionLog = createDecisionLog(ids.taskID)
        decisionLog.append({
          phase: "frontend_design",
          key: "public_report",
          value: "Frontend design public report exists for goal build context path resolution.",
          reason: "goal build context path regression",
        })
        decisionLog.append({
          phase: "frontend_design",
          key: "frontend_project",
          value: JSON.stringify(
            {
              status: "created",
              role: "source_baseline_input",
              project_root: "frontend-design-skeleton",
              source_package: "web-clone-source",
              entrypoints: ["frontend-design-skeleton/index.html"],
              generation_tool: "source-skeleton",
              notes: [],
            },
            null,
            2,
          ),
          reason: "goal build context path regression",
        })
        decisionLog.append({
          phase: "frontend_design",
          key: "evidence_source_manifest",
          value: "web-clone-source/reference.png\nweb-clone-source/source-ir/component-tree.json",
          reason: "goal build context path regression",
        })

        let observedContext: any
        buildAgentRunImpl = async (input: any) => {
          observedContext = input.context
          await input.onSessionCreated?.("ses_goal_context_build", {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          return {
            result: {
              status: "passed",
              summary: "Observed goal-scoped build context.",
              files_changed: [],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_context_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: ids.goalIDs[0]!,
            request: "Implement the frontend-design surface.",
            reason: "Regression coverage for goal-scoped frontend-design build context.",
          },
          buildToolOptions("goal_context_paths"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(ids.goalIDs[0]!, "passed")
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, ids.taskID)
        const frontendDesignPacketText = (observedContext?.contextPackets ?? [])
          .flatMap((packet) => packet.parts ?? [])
          .filter((part) => part?.type === "text")
          .map((part) => part.text)
          .join("\n")
        expect(observedContext?.projectDir).toBe(tmp.path)
        expect(frontendDesignPacketText).toContain(paths.templateAbsolute)
        expect(frontendDesignPacketText).toContain(
          "Goal-scoped Build visual targets come only from Architect reference_coverage crop rows",
        )
        expect(frontendDesignPacketText).not.toContain(paths.manifestAbsolute)
        expect(frontendDesignPacketText).not.toContain("web-clone-source/reference.png")
        expect(frontendDesignPacketText).not.toContain(
          `Materialized frontend_design public report (read this): ${paths.templateRelative}`,
        )
      },
    })
  }, 30_000)

  test("injects Architect-bound reference crop as goal-scoped Build target evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 1,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal crop evidence root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)

        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, ids.taskID)
        const cropRelative = path
          .join(
            paths.relativeDir,
            "visual-region-bindings",
            "page",
            "01-hero__src1200x3000__x0-y0-w1200-h640.png",
          )
          .replaceAll("\\", "/")
        const cropAbsolute = path.join(tmp.path, cropRelative)
        await fs.mkdir(path.dirname(cropAbsolute), { recursive: true })
        await fs.writeFile(cropAbsolute, minimalPngBytes())
        const taskAttachment = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(minimalPngBytes()),
          "image/png",
          "full-page-reference.png",
        )

        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              attachments: [{ ...taskAttachment, intent: "visual_reference", source: "task-attachment" }],
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [],
                  referenceCoverage: [
                    {
                      id: "ref-hero",
                      surface: "hero",
                      goal_ids: [ids.goalIDs[0]!],
                      visual_spec_ids: ["vis-hero"],
                      reference_regions: [
                        {
                          reference_region_key: "hero@desktop",
                          source_reference_artifact: cropRelative,
                          binding_manifest_artifact: "docs/visual-region-binding.json",
                          source_bbox: { x: 0, y: 0, width: 1200, height: 640 },
                          crop_intent: "full-region",
                        },
                      ],
                      expectation: "Hero goal must restore this crop.",
                    },
                  ],
                  assemblyOwners: [],
                },
              },
            } as any)
            .where(eq(EngineTaskTable.id, ids.taskID))
            .run(),
        )

        let observedContext: any
        buildAgentRunImpl = async (input: any) => {
          observedContext = input.context
          await input.onSessionCreated?.("ses_goal_crop_build", {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          return {
            result: {
              status: "passed",
              summary: "Observed goal crop evidence.",
              files_changed: [],
              tests: [],
              commit_ref: "crop1234",
            },
            sessionID: "ses_goal_crop_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: ids.goalIDs[0]!,
            request: "Implement the crop-bound hero goal.",
            reason: "Regression coverage for goal-bound reference crop evidence.",
          },
          buildToolOptions("goal_crop_evidence"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(ids.goalIDs[0]!, "passed")
        const pack = buildEvidencePackFromContextPackets(observedContext?.contextPackets)
        expect(pack?.targetReferences).toHaveLength(1)
        expect(pack?.targetReferences?.[0]).toMatchObject({
          intent: "visual_reference",
          source: "frontend_design_visual_region_binding",
          label: "ref-hero:hero@desktop",
          filename: "01-hero__src1200x3000__x0-y0-w1200-h640.png",
          scope: { kind: "goal", taskID: ids.taskID, goalID: ids.goalIDs[0]! },
        })
        expect(JSON.stringify(pack?.targetReferences)).not.toContain("full-page-reference.png")
      },
    })
  }, 30_000)

  test("preserves distinct goal reference region keys even when crop bytes match", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 1,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal duplicate crop bytes root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)

        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, ids.taskID)
        const cropRelatives = [
          path
            .join(
              paths.relativeDir,
              "visual-region-bindings",
              "page",
              "01-card-a__src1200x3000__x0-y700-w400-h260.png",
            )
            .replaceAll("\\", "/"),
          path
            .join(
              paths.relativeDir,
              "visual-region-bindings",
              "page",
              "02-card-b__src1200x3000__x420-y700-w400-h260.png",
            )
            .replaceAll("\\", "/"),
        ]
        for (const cropRelative of cropRelatives) {
          const cropAbsolute = path.join(tmp.path, cropRelative)
          await fs.mkdir(path.dirname(cropAbsolute), { recursive: true })
          await fs.writeFile(cropAbsolute, minimalPngBytes())
        }

        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [],
                  referenceCoverage: [
                    {
                      id: "ref-cards",
                      surface: "cards",
                      goal_ids: [ids.goalIDs[0]!],
                      visual_spec_ids: ["vis-cards"],
                      reference_regions: [
                        {
                          reference_region_key: "card-a@desktop",
                          source_reference_artifact: cropRelatives[0],
                          source_bbox: { x: 0, y: 700, width: 400, height: 260 },
                          crop_intent: "full-region",
                        },
                        {
                          reference_region_key: "card-b@desktop",
                          source_reference_artifact: cropRelatives[1],
                          source_bbox: { x: 420, y: 700, width: 400, height: 260 },
                          crop_intent: "full-region",
                        },
                      ],
                      expectation: "Both card crops are distinct semantic targets for this goal.",
                    },
                  ],
                  assemblyOwners: [],
                },
              },
            } as any)
            .where(eq(EngineTaskTable.id, ids.taskID))
            .run(),
        )

        let observedContext: any
        buildAgentRunImpl = async (input: any) => {
          observedContext = input.context
          await input.onSessionCreated?.("ses_goal_duplicate_crop_bytes_build", {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          return {
            result: {
              status: "passed",
              summary: "Observed duplicate-byte goal crop evidence.",
              files_changed: [],
              tests: [],
              commit_ref: "dupecrop1234",
            },
            sessionID: "ses_goal_duplicate_crop_bytes_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: ids.goalIDs[0]!,
            request: "Implement the crop-bound cards goal.",
            reason: "Regression coverage that reference_region_key identity is not collapsed by identical crop bytes.",
          },
          buildToolOptions("goal_duplicate_crop_bytes"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(ids.goalIDs[0]!, "passed")
        const pack = buildEvidencePackFromContextPackets(observedContext?.contextPackets)
        expect(pack?.targetReferences?.map((ref) => ref.label)).toEqual([
          "ref-cards:card-a@desktop",
          "ref-cards:card-b@desktop",
        ])
        expect(pack?.targetReferences?.map((ref) => ref.filename)).toEqual([
          "01-card-a__src1200x3000__x0-y700-w400-h260.png",
          "02-card-b__src1200x3000__x420-y700-w400-h260.png",
        ])
      },
    })
  }, 30_000)

  test("does not substitute task-level visual references when goal reference coverage has no crop rows", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 1,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal missing crop evidence root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)

        const taskAttachment = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(minimalPngBytes()),
          "image/png",
          "full-page-reference.png",
        )

        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              attachments: [{ ...taskAttachment, intent: "visual_reference", source: "task-attachment" }],
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [],
                  referenceCoverage: [
                    {
                      id: "ref-hero",
                      surface: "hero",
                      goal_ids: [ids.goalIDs[0]!],
                      visual_spec_ids: ["vis-hero"],
                      reference_regions: [],
                      expectation: "Hero goal must restore the Frontend Design crop.",
                    },
                  ],
                  assemblyOwners: [],
                },
              },
            } as any)
            .where(eq(EngineTaskTable.id, ids.taskID))
            .run(),
        )

        let observedContext: any
        buildAgentRunImpl = async (input: any) => {
          observedContext = input.context
          await input.onSessionCreated?.("ses_goal_missing_crop_build", {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          return {
            result: {
              status: "passed",
              summary: "Observed missing goal crop evidence.",
              files_changed: [],
              tests: [],
              commit_ref: "missingcrop1234",
            },
            sessionID: "ses_goal_missing_crop_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: ids.goalIDs[0]!,
            request: "Implement the crop-bound hero goal.",
            reason: "Regression coverage that missing goal crops do not fall back to task references.",
          },
          buildToolOptions("goal_missing_crop_evidence"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(ids.goalIDs[0]!, "passed")
        const pack = buildEvidencePackFromContextPackets(observedContext?.contextPackets)
        expect(pack?.targetReferences ?? []).toEqual([])
        expect(JSON.stringify(observedContext?.contextPackets ?? [])).not.toContain("full-page-reference.png")
        expect(observedContext?.fidelity?.referenceCoverage?.[0]).toMatchObject({
          id: "ref-hero",
          reference_regions: [],
        })
      },
    })
  }, 30_000)

  test("does not substitute task-level visual references when goal has no reference coverage row", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 1,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal missing reference row root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)

        const taskAttachment = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(minimalPngBytes()),
          "image/png",
          "full-page-reference.png",
        )

        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              attachments: [{ ...taskAttachment, intent: "visual_reference", source: "task-attachment" }],
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [],
                  referenceCoverage: [],
                  assemblyOwners: [],
                },
              },
            } as any)
            .where(eq(EngineTaskTable.id, ids.taskID))
            .run(),
        )

        let observedContext: any
        buildAgentRunImpl = async (input: any) => {
          observedContext = input.context
          await input.onSessionCreated?.("ses_goal_missing_reference_row_build", {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          return {
            result: {
              status: "passed",
              summary: "Observed missing goal reference coverage row.",
              files_changed: [],
              tests: [],
              commit_ref: "missingrow1234",
            },
            sessionID: "ses_goal_missing_reference_row_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: ids.goalIDs[0]!,
            request: "Implement the crop-bound goal with missing Architect binding.",
            reason: "Regression coverage that absent goal reference rows do not fall back to task references.",
          },
          buildToolOptions("goal_missing_reference_row"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(ids.goalIDs[0]!, "passed")
        const pack = buildEvidencePackFromContextPackets(observedContext?.contextPackets)
        expect(pack?.targetReferences ?? []).toEqual([])
        expect(JSON.stringify(observedContext?.contextPackets ?? [])).not.toContain("full-page-reference.png")
        expect(observedContext?.fidelity?.referenceCoverage ?? []).toEqual([])
      },
    })
  }, 30_000)

  test("rejects out-of-range display labels without telling the model to re-run Architect", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 2,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal reference invalid root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)
        let buildCalls = 0
        buildAgentRunImpl = async () => {
          buildCalls++
          throw new Error("should not dispatch")
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: "G99",
            request: "Implement missing display goal.",
            reason: "Regression coverage for invalid displayed goal labels.",
          },
          buildToolOptions("goal_ref_g99"),
        )

        expect(buildCalls).toBe(0)
        const resultText = toolText(result)
        expect(resultText).toContain("outside the active plan range")
        expect(resultText).not.toContain("register")
        expect(resultText).not.toContain("architect")
      },
    })
  }, 30_000)

  test("resolves hash and bare numeric active-plan labels", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const ids = seedWorkflowTaskWithGoals({
      directory: tmp.path,
      now,
      goalCount: 2,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal reference numeric root" })
        attachTaskSession(ids.taskID, parent.id)
        bindTaskToCurrentProject(ids.taskID)

        const observedGoalIDs: string[] = []
        buildAgentRunImpl = async (input: any) => {
          await input.onSessionCreated?.(`ses_goal_ref_numeric_${observedGoalIDs.length + 1}`, {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          observedGoalIDs.push(input.target.id)
          return {
            result: {
              status: "passed",
              summary: "Resolved numeric goal reference.",
              files_changed: [
                {
                  path: "src/reference.ts",
                  summary: "Implemented referenced goal.",
                  reason: "Regression coverage for numeric display goal references.",
                },
              ],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: `ses_goal_ref_numeric_${observedGoalIDs.length}`,
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID: ids.taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const firstResult = await tools.build.execute(
          {
            goalID: "#1",
            request: "Implement first goal.",
            reason: "Per-goal pipeline execution using a hash display label.",
          },
          buildToolOptions("goal_ref_hash"),
        )
        const secondResult = await tools.build.execute(
          {
            goalID: "2",
            request: "Implement second goal.",
            reason: "Per-goal pipeline execution using a bare numeric display label.",
          },
          buildToolOptions("goal_ref_numeric"),
        )

        expectGoalBuildStarted(firstResult)
        expectGoalBuildStarted(secondResult)
        await waitForGoalStatus(ids.goalIDs[0]!, "passed")
        await waitForGoalStatus(ids.goalIDs[1]!, "passed")
        expect(observedGoalIDs).toEqual([ids.goalIDs[0], ids.goalIDs[1]])
      },
    })
  }, 30_000)
})

function seedWorkflowTaskWithGoals(input: { directory: string; now: number; goalCount: number }) {
  const suffix = `${input.now.toString(16)}_${Math.random().toString(16).slice(2)}`
  const projectID = `project_goal_ref_${suffix}`
  const taskID = `tsk_goal_ref_${suffix}`
  const specID = `spec_goal_ref_${suffix}`
  const planID = `pln_goal_ref_${suffix}`
  const goalIDs = Array.from({ length: input.goalCount }, (_, index) => `gol_goal_ref_${index + 1}_${suffix}`)

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: input.directory,
        name: "Goal reference test",
        sandboxes: [],
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        session_id: null,
        source: "test",
        title: "Goal reference task",
        request: "Build ordered goals",
        kind: "workflow",
        priority: "normal",
        metadata: {
          architect_fidelity: {
            sourceCoverage: [],
            referenceCoverage: [],
            assemblyOwners: [
              {
                surface: "final-deliverable",
                goal_id: goalIDs[input.goalCount - 1],
                rationale: "The final ordered goal owns assembly for this test task.",
              },
            ],
          },
        },
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "Goal reference spec",
        content: "Build ordered goals",
        scope: "Verify ordinal goal references resolve through the active plan.",
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EnginePlanVersionTable)
      .values({
        id: planID,
        task_id: taskID,
        spec_snapshot_id: specID,
        version: 1,
        status: "active",
        summary: `${input.goalCount} goals`,
        prompt: "Build ordered goals",
        metadata: {},
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    for (const [index, goalID] of goalIDs.entries()) {
      db.insert(EngineGoalTable)
        .values({
          id: goalID,
          task_id: taskID,
          plan_version_id: planID,
          spec_snapshot_id: specID,
          title: `Goal ${index + 1}`,
          slug: `goal-${index + 1}`,
          objective: `Implement goal ${index + 1}`,
          acceptance_specs: [],
          owned_paths: [`src/goal${index + 1}.ts`],
          depends_on: [],
          exports: [],
          imports: [],
          kind: "feature",
          requirement_ids: [],
          priority: "blocking",
          source: "test",
          order_index: index,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    db.insert(EngineArtifactTable)
      .values({
        id: `artifact_contract_graph_${taskID}_${input.now}`,
        task_id: taskID,
        run_id: null,
        goal_run_id: null,
        kind: "architect_contract_graph",
        label: "architect-contract-graph",
        payload: { version: 1, contracts: [], dependency_contracts: [] },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })

  return { projectID, taskID, specID, planID, goalIDs }
}

function attachTaskSession(taskID: string, sessionID: string) {
  Database.use((db) => {
    db.update(EngineTaskTable)
      .set({ session_id: sessionID, time_updated: Date.now() })
      .where(eq(EngineTaskTable.id, taskID))
      .run()
  })
}

function bindTaskToCurrentProject(taskID: string) {
  Database.use((db) => {
    db.update(EngineTaskTable)
      .set({ project_id: Instance.project.id, time_updated: Date.now() })
      .where(eq(EngineTaskTable.id, taskID))
      .run()
  })
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
    0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
    0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
    0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}
