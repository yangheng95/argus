import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "path"
import sharp from "sharp"

import { BuildAgent, repairManagedBuildSessionStagedFileParts } from "../../src/build/agent"
import { textContextPacket } from "../../src/agent/context-packet"
import { buildEvidenceContextPacket, type BuildEvidencePack } from "../../src/build/evidence-pack"
import { composeBuildInputEvidenceManifest, type BuildInputEvidenceManifest } from "../../src/build/evidence-manifest"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import type { CodingProvider, CodingRunInfo, CodingResumeInfo } from "../../src/executor/contract"
import { persistExecutorSessionRef } from "../../src/executor/session-ref"
import { ExecutorRegistry } from "../../src/executor/registry"
import { findTask } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Message } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import type { Provider } from "../../src/provider/provider"
import { Database, eq } from "../../src/storage/db"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"
import { Identifier } from "../../src/id/id"

const providerModel: Provider.Model = {
  id: "test-model",
  providerID: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

async function pngImage(width: number, height: number): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="white"/>` +
      `<rect x="0" y="0" width="1" height="1" fill="black"/>` +
      `</svg>`,
  )
  return await sharp(svg).png().toBuffer()
}

function seedTask(input: {
  projectID: string
  taskID: string
  sessionID?: string
  executor?: "opencorvus" | "codex" | "claude-code"
  attachments?: unknown[]
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        source: "test",
        title: "build managed worktree runtime",
        request: "verify managed worktree runtime materialization",
        priority: "normal",
        budget: { max_executor_groups: 1 },
        ...(input.executor ? { executor: input.executor } : {}),
        ...(input.sessionID ? { session_id: input.sessionID } : {}),
        ...(input.attachments ? { attachments: input.attachments } : {}),
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
}

function contextPacketsForEvidencePack(evidencePack: BuildEvidencePack) {
  const packet = buildEvidenceContextPacket(evidencePack)
  return packet ? [packet] : []
}

function seedProjectRow(input: { projectID: string; worktree: string }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: input.worktree,
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .run(),
  )
}

function insertBuildSessionContract(input: {
  taskID: string
  sessionID: string
  manifest: BuildInputEvidenceManifest
  goalID?: string
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: null,
        goal_run_id: input.manifest.goal_run_id ?? null,
        kind: "build_session_contract",
        label: "build-session-contract",
        payload: {
          session_id: input.sessionID,
          task_id: input.taskID,
          goal_id: input.goalID ?? null,
          goal_run_id: input.manifest.goal_run_id ?? null,
          input_evidence: input.manifest,
          digest: `test-${input.sessionID}`,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function captureCodingProvider(captured: { run?: CodingRunInfo; resume?: CodingResumeInfo }): CodingProvider {
  return {
    name: "codex",
    capabilities: () => ({
      builtinTools: true,
      customTools: true,
      stream: true,
      resume: true,
      interrupt: true,
      cwd: true,
      system: true,
    }),
    run: async function* (input) {
      captured.run = input
      yield { type: "done", output: "external provider completed" }
    },
    resume: async function* (input) {
      captured.resume = input
      yield { type: "done", output: "external provider resumed" }
    },
    interrupt: async () => true,
  }
}

async function createAssistantMessage(input: { sessionID: string; cwd: string; parentID?: string }) {
  return await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    time: { created: Date.now(), completed: Date.now() + 1 },
    parentID: input.parentID ?? Identifier.ascending("message"),
    providerID: "test",
    modelID: "test",
    agent: "build",
    path: {
      cwd: input.cwd,
      root: input.cwd,
    },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache: { read: 0, write: 0 } },
  } as any)
}

afterEach(() => {
  ExecutorRegistry.reset()
})

describe("BuildAgent managed worktree runtime", () => {
  test("in-process build sessions preserve the default MCP tool inclusion", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/build/agent.ts"), "utf8")

    expect(source).toContain("includeMcpTools: input.includeMcpTools,")
    expect(source).not.toContain("includeMcpTools: input.includeMcpTools === true")
  })

  test("in-process build prompts staged evidence paths instead of provider-bound image parts", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/build/agent.ts"), "utf8")

    expect(source).toContain('mode: "staged-only"')
    expect(source).toContain('return [{ type: "text" as const, text: enrichedText }]')
    expect(source).not.toContain("filePartsFromStagedReferences(stagedAttachments)")
    expect(source).not.toContain('return [{ type: "text" as const, text: enrichedText }, ...inline]')
  })

  test("managed worktrees do not receive copied runtime evidence views", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_build_runtime_${suffix}`
        const sessionID = `ses_build_runtime_${suffix}`
        seedTask({ projectID: Instance.project.id, taskID })

        const info = await Worktree.create({
          name: `build-runtime-${suffix}`,
          taskID,
          sessionID,
        })
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        expect(path.join(info.directory, paths.relativeDir)).toContain(`${path.sep}.opencorvus${path.sep}r${path.sep}`)
        expect(await Bun.file(path.join(info.directory, paths.relativeDir)).exists()).toBe(false)
      },
    })
  }, 30_000)

  test("external build ignores task attachments when no evidence pack is supplied", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_build_no_pack_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "No evidence pack root",
          directory: tmp.path,
        })
        const baitRef = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(12, 12),
          "image/png",
          "bait-task-attachment.png",
        )
        seedTask({
          projectID: Instance.project.id,
          taskID,
          sessionID: rootSession.id,
          executor: "codex",
          attachments: [{ ...baitRef, intent: "visual_reference", source: "user-upload" }],
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })
        const workDir = path.join(tmp.path, "external-no-pack")
        await fs.mkdir(workDir, { recursive: true })

        await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          target: {
            kind: "request",
            text: "verify task attachments are not auto-promoted",
          },
          workDir,
        })

        expect(captured.run?.prompt).not.toContain("## Visual Reference Contract")
        expect(captured.run?.prompt).not.toContain("## Build Evidence Pack")
        expect(captured.run?.prompt).not.toContain("bait-task-attachment.png")
      },
    })
  }, 30_000)

  test("managed external build prompt stages evidence pack roles", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_build_evidence_pack_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "Evidence pack root",
          directory: tmp.path,
        })
        const targetRef = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(16, 16),
          "image/png",
          "target-reference.png",
        )
        const previousRef = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(10, 10),
          "image/png",
          "previous-output.png",
        )
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })
        const evidencePack: BuildEvidencePack = {
          targetReferences: [{ ...targetRef, intent: "visual_reference", source: "test" }],
          previousOutputs: [
            {
              ...previousRef,
              filename: "previous-output.png",
              intent: "rendered_output",
              source: "rendered_output",
            },
          ],
        }

        const stageToWorktree = AttachmentStore.stageToWorktree
        const stageSpy = spyOn(AttachmentStore, "stageToWorktree").mockImplementation(stageToWorktree)
        try {
          await BuildAgent.run({
            task: task!,
            parentSessionID: rootSession.id,
            target: {
              kind: "request",
              text: "verify evidence pack prompt",
            },
            context: {
              contextPackets: contextPacketsForEvidencePack(evidencePack),
            },
          })

          expect(stageSpy).toHaveBeenCalledTimes(1)
          expect(stageSpy.mock.calls[0]?.[0]).toBe(task!.project_id)
          const prompt = captured.run?.prompt ?? ""
          expect(prompt).toContain("## Visual Reference Contract")
          expect(prompt).toContain("target-reference.png")
          const contractOnly = prompt.slice(0, prompt.indexOf("# Delegation"))
          expect(contractOnly).not.toContain("previous-output.png")
          expect(prompt).toContain("### Previous Build Output Evidence")
          expect(prompt).toContain("previous-output.png")
          expect(prompt).toContain("## Staged Reference Files")
          expect(prompt).toContain("references/target-reference.png")
          expect(prompt).toContain("references/previous-output.png")
        } finally {
          stageSpy.mockRestore()
        }
      },
    })
  }, 30_000)

  test("build stages an evidence pack without a prevalidated input manifest", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_external_evidence_no_stage_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "External evidence no stage root",
          directory: tmp.path,
        })
        const targetRef = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(16, 16),
          "image/png",
          "target-reference.png",
        )
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })
        const workDir = path.join(tmp.path, "external-evidence-no-stage")
        await fs.mkdir(workDir, { recursive: true })
        const evidencePack: BuildEvidencePack = {
          targetReferences: [{ ...targetRef, intent: "visual_reference", source: "test" }],
        }

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          target: {
            kind: "request",
            text: "verify evidence staging reaches Build",
          },
          context: {
            contextPackets: contextPacketsForEvidencePack(evidencePack),
          },
          workDir,
        })

        expect(output.result.status).toBe("passed")
        expect(captured.run?.worktreeDir).toBe(workDir)
        expect(captured.run?.prompt).toContain("## Visual Reference Contract")
        expect(captured.run?.prompt).toContain("## Staged Reference Files")
        expect(captured.run?.prompt).toContain("references/target-reference.png")
        await expect(fs.stat(path.join(workDir, "references", "target-reference.png"))).resolves.toBeTruthy()
      },
    })
  }, 30_000)

  test("caller-owned external build stages evidence into the supplied workDir", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_external_evidence_no_stage_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "External evidence no stage root",
          directory: tmp.path,
        })
        const targetRef = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(16, 16),
          "image/png",
          "target-reference.png",
        )
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })
        const workDir = path.join(tmp.path, "external-evidence-no-stage")
        await fs.mkdir(workDir, { recursive: true })
        const evidencePack: BuildEvidencePack = {
          targetReferences: [{ ...targetRef, intent: "visual_reference", source: "test" }],
        }

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          target: {
            kind: "request",
            text: "verify caller-owned evidence staging",
          },
          context: {
            contextPackets: contextPacketsForEvidencePack(evidencePack),
          },
          workDir,
        })

        expect(output.result.status).toBe("passed")
        expect(captured.run?.worktreeDir).toBe(workDir)
        expect(captured.run?.prompt).toContain("## Staged Reference Files")
        expect(captured.run?.prompt).toContain("references/target-reference.png")
        await expect(fs.stat(path.join(workDir, "references", "target-reference.png"))).resolves.toBeTruthy()
      },
    })
  }, 30_000)

  test("managed build retries repair persisted file parts from staged references", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "managed-retry-worktree-"))
        const buildSession = await Session.create({
          kind: "build",
          title: "Managed retry build",
          directory: worktreeDir,
        })
        const pngBytes = await pngImage(16, 16)
        const original = await AttachmentStore.write(Instance.project.id, pngBytes, "image/png", "source-reference.png")
        await AttachmentStore.stageToWorktree(Instance.project.id, [original], worktreeDir)

        const msg = await SessionPrompt.prompt({
          sessionID: buildSession.id,
          byteMaterializationProjectID: buildSession.projectID,
          agent: "coding",
          noReply: true,
          parts: [
            { type: "text", text: "use the persisted visual reference" },
            {
              type: "file",
              mime: "image/png",
              filename: "source-reference.png",
              url: `data:image/png;base64,${pngBytes.toString("base64")}`,
            },
          ],
        })
        const originalLocation = AttachmentStore.nameFromUrl(original.url)
        if (!originalLocation) throw new Error("expected original attachment location")
        const originalAbs = AttachmentStore.resolveAbsolute(originalLocation.projectID, originalLocation.name)
        if (!originalAbs) throw new Error("expected original attachment path")
        await fs.rm(originalAbs, { force: true })
        await fs.rm(`${originalAbs}.metadata.json`, { force: true })

        const storedBefore = await Message.get({ sessionID: buildSession.id, messageID: msg.info.id })
        const oldFilePart = storedBefore.parts.find((part) => part.type === "file")
        if (!oldFilePart || oldFilePart.type !== "file") throw new Error("expected stored old file part")
        expect(oldFilePart.url).toBe(original.url)
        await expect(Message.toModelMessages([storedBefore], providerModel)).rejects.toThrow("ENOENT")

        const repaired = await repairManagedBuildSessionStagedFileParts({
          sessionID: buildSession.id,
          projectID: Instance.project.id,
          worktreeDir,
        })

        expect(repaired).toEqual({ checked: 1, repaired: 1 })
        expect(await fs.readFile(originalAbs)).toEqual(pngBytes)
        const storedAfter = await Message.get({ sessionID: buildSession.id, messageID: msg.info.id })
        const filePart = storedAfter.parts.find((part) => part.type === "file")
        if (!filePart || filePart.type !== "file") throw new Error("expected stored file part")
        expect(filePart.url).toBe(original.url)

        const modelMessages = await Message.toModelMessages([storedAfter], providerModel)
        expect(JSON.stringify(modelMessages)).toContain(`data:image/png;base64,${pngBytes.toString("base64")}`)
      },
    })
  }, 20_000)

  test("managed build retries repair tool-result attachments from persisted artifact paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = `tsk_tool_attachment_repair_${Date.now().toString(36)}`
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "managed-retry-tool-worktree-"))
        const buildSession = await Session.create({
          kind: "build",
          title: "Managed retry tool attachment",
          directory: worktreeDir,
        })
        const pngBytes = await pngImage(18, 18)
        const artifactRel = `.opencorvus/r/t/${taskID}/bp/job/side-by-side.png`
        const artifactAbs = path.join(tmp.path, ...artifactRel.split("/"))
        await fs.mkdir(path.dirname(artifactAbs), { recursive: true })
        await fs.writeFile(artifactAbs, pngBytes)
        const original = await AttachmentStore.write(Instance.project.id, pngBytes, "image/png", "side-by-side.png")
        const message = await createAssistantMessage({
          sessionID: buildSession.id,
          cwd: worktreeDir,
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: message.id,
          sessionID: buildSession.id,
          type: "tool",
          tool: "browser_preview_compare_scroll_slices",
          callID: "call_tool_attachment_repair",
          state: {
            status: "completed",
            input: {},
            output: JSON.stringify({ artifacts: { side_by_side: artifactRel } }),
            title: "Browser preview comparison",
            metadata: { artifacts: { side_by_side: artifactRel } },
            time: { start: 1, end: 2 },
            attachments: [
              {
                id: Identifier.ascending("part"),
                messageID: message.id,
                sessionID: buildSession.id,
                type: "file",
                mime: "image/png",
                url: original.url,
                filename: "side-by-side.png",
              },
            ],
          },
        } as any)

        const originalLocation = AttachmentStore.nameFromUrl(original.url)
        if (!originalLocation) throw new Error("expected original attachment location")
        const originalAbs = AttachmentStore.resolveAbsolute(originalLocation.projectID, originalLocation.name)
        if (!originalAbs) throw new Error("expected original attachment path")
        await fs.rm(originalAbs, { force: true })
        await fs.rm(`${originalAbs}.metadata.json`, { force: true })

        const storedBefore = await Message.get({ sessionID: buildSession.id, messageID: message.id })
        await expect(Message.toModelMessages([storedBefore], providerModel)).rejects.toThrow(
          "Failed to read tool-result attachment",
        )

        const repaired = await repairManagedBuildSessionStagedFileParts({
          sessionID: buildSession.id,
          projectID: Instance.project.id,
          worktreeDir,
        })

        expect(repaired).toEqual({ checked: 1, repaired: 1 })
        expect(await fs.readFile(originalAbs)).toEqual(pngBytes)
        const storedAfter = await Message.get({ sessionID: buildSession.id, messageID: message.id })
        const modelMessages = await Message.toModelMessages([storedAfter], providerModel)
        const serializedModelMessages = JSON.stringify(modelMessages)
        expect(serializedModelMessages).toContain('"type":"image-data"')
        expect(serializedModelMessages).toContain('"mediaType":"image/png"')
        expect(serializedModelMessages).toContain(`"data":"${pngBytes.toString("base64")}"`)
      },
    })
  }, 20_000)

  test("managed build retry rejects artifact repair paths outside replay roots", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "managed-retry-escape-worktree-"))
        const buildSession = await Session.create({
          kind: "build",
          title: "Managed retry escaped artifact path",
          directory: worktreeDir,
        })
        const pngBytes = await pngImage(16, 16)
        const original = await AttachmentStore.write(Instance.project.id, pngBytes, "image/png", "escaped.png")
        const message = await createAssistantMessage({
          sessionID: buildSession.id,
          cwd: worktreeDir,
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: message.id,
          sessionID: buildSession.id,
          type: "tool",
          tool: "browser_preview_compare_scroll_slices",
          callID: "call_tool_attachment_escape",
          state: {
            status: "completed",
            input: {},
            output: "artifact path escaped",
            title: "Browser preview comparison",
            metadata: { artifacts: { side_by_side: "../outside.png" } },
            time: { start: 1, end: 2 },
            attachments: [
              {
                id: Identifier.ascending("part"),
                messageID: message.id,
                sessionID: buildSession.id,
                type: "file",
                mime: "image/png",
                url: original.url,
                filename: "escaped.png",
              },
            ],
          },
        } as any)

        const originalLocation = AttachmentStore.nameFromUrl(original.url)
        if (!originalLocation) throw new Error("expected original attachment location")
        const originalAbs = AttachmentStore.resolveAbsolute(originalLocation.projectID, originalLocation.name)
        if (!originalAbs) throw new Error("expected original attachment path")
        await fs.rm(originalAbs, { force: true })
        await fs.rm(`${originalAbs}.metadata.json`, { force: true })

        await expect(
          repairManagedBuildSessionStagedFileParts({
            sessionID: buildSession.id,
            projectID: Instance.project.id,
            worktreeDir,
          }),
        ).rejects.toThrow("escapes build worktree")
      },
    })
  }, 20_000)

  test("managed build retry fails unrecoverable browser screenshot metadata without artifact source", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "managed-retry-mcp-worktree-"))
        const buildSession = await Session.create({
          kind: "build",
          title: "Managed retry MCP screenshot",
          directory: worktreeDir,
        })
        const pngBytes = await pngImage(20, 20)
        const original = await AttachmentStore.write(Instance.project.id, pngBytes, "image/png", "browser-shot.png")
        const message = await createAssistantMessage({
          sessionID: buildSession.id,
          cwd: worktreeDir,
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: message.id,
          sessionID: buildSession.id,
          type: "tool",
          tool: "browser_observe",
          callID: "call_unrecoverable_browser_screenshot",
          state: {
            status: "completed",
            input: {},
            output: "observed browser screenshot",
            title: "Browser observe",
            metadata: {
              browser: {
                screenshot: {
                  mimeType: "image/png",
                  attachmentUrl: original.url,
                  sha: original.sha,
                },
              },
            },
            time: { start: 1, end: 2 },
          },
        } as any)

        const originalLocation = AttachmentStore.nameFromUrl(original.url)
        if (!originalLocation) throw new Error("expected original attachment location")
        const originalAbs = AttachmentStore.resolveAbsolute(originalLocation.projectID, originalLocation.name)
        if (!originalAbs) throw new Error("expected original attachment path")
        await fs.rm(originalAbs, { force: true })
        await fs.rm(`${originalAbs}.metadata.json`, { force: true })

        await expect(
          repairManagedBuildSessionStagedFileParts({
            sessionID: buildSession.id,
            projectID: Instance.project.id,
            worktreeDir,
          }),
        ).rejects.toThrow("no persisted artifact path matched")
      },
    })
  }, 20_000)

  test("managed build retry rejects existing build sessions from a foreign project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })

    let foreignBuildSessionID = ""
    await Instance.provide({
      directory: projectB.path,
      fn: async () => {
        const foreignBuildSession = await Session.create({
          kind: "build",
          title: "Foreign build session",
          directory: projectB.path,
        })
        foreignBuildSessionID = foreignBuildSession.id
      },
    })

    await Instance.provide({
      directory: projectA.path,
      fn: async () => {
        const taskID = `tsk_foreign_build_session_${Date.now().toString(36)}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "Foreign session root",
          directory: projectA.path,
        })
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const task = findTask(taskID)
        expect(task).toBeTruthy()

        await expect(
          BuildAgent.run({
            task: task!,
            parentSessionID: rootSession.id,
            existingSessionID: foreignBuildSessionID,
            target: {
              kind: "request",
              text: "retry with foreign build session",
            },
            managedWorktree: {
              directory: projectA.path,
              branch: undefined,
            },
          }),
        ).rejects.toThrow("expected task project")
      },
    })
  }, 30_000)

  test("fresh build dispatch rejects active project mismatch before evidence staging", async () => {
    await using activeProject = await tmpdir({ git: true })
    await using taskProject = await tmpdir({ git: true })

    await Instance.provide({
      directory: activeProject.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskProjectID = `project_fresh_dispatch_owner_${suffix}`
        seedProjectRow({ projectID: taskProjectID, worktree: taskProject.path })
        const taskID = `tsk_fresh_dispatch_owner_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "Fresh dispatch active project mismatch",
          directory: activeProject.path,
        })
        const targetRef = await AttachmentStore.write(
          taskProjectID,
          await pngImage(16, 16),
          "image/png",
          "task-project-reference.png",
        )
        seedTask({
          projectID: taskProjectID,
          taskID,
          sessionID: rootSession.id,
          executor: "codex",
          attachments: [{ ...targetRef, intent: "visual_reference", source: "user-upload" }],
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const evidencePack: BuildEvidencePack = {
          targetReferences: [{ ...targetRef, intent: "visual_reference", source: "user-upload" }],
        }
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })
        const stageToWorktree = AttachmentStore.stageToWorktree
        const stageSpy = spyOn(AttachmentStore, "stageToWorktree").mockImplementation(stageToWorktree)
        try {
          await expect(
            BuildAgent.run({
              task: task!,
              parentSessionID: rootSession.id,
              target: {
                kind: "request",
                text: "fresh dispatch must not use the active project for task evidence",
              },
              context: {
                contextPackets: contextPacketsForEvidencePack(evidencePack),
              },
            }),
          ).rejects.toThrow("fresh build dispatch must enter the task project before evidence materialization")
          expect(stageSpy).not.toHaveBeenCalled()
          expect(captured.run).toBeUndefined()
          expect(captured.resume).toBeUndefined()
          const childSessions = Database.use((db) =>
            db.select().from(SessionTable).where(eq(SessionTable.parent_id, rootSession.id)).all(),
          )
          expect(childSessions.filter((session) => session.kind === "build")).toHaveLength(0)
        } finally {
          stageSpy.mockRestore()
        }
      },
    })
  }, 30_000)

  test("managed build retry invokes persisted file part repair before provider resume", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_managed_retry_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "Managed retry root",
          directory: tmp.path,
        })
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const worktree = await Worktree.create({
          name: `managed-retry-${suffix}`,
          taskID,
          sessionID: rootSession.id,
        })
        const buildSession = await Session.createNext({
          kind: "build",
          parentID: rootSession.id,
          title: "Managed retry build",
          directory: worktree.directory,
        })
        const pngBytes = await pngImage(16, 16)
        const original = await AttachmentStore.write(Instance.project.id, pngBytes, "image/png", "source-reference.png")
        await AttachmentStore.stageToWorktree(Instance.project.id, [original], worktree.directory)
        const manifest = await composeBuildInputEvidenceManifest({
          projectID: Instance.project.id,
          taskID,
          sessionID: buildSession.id,
          evidencePack: {
            targetReferences: [{ ...original, intent: "visual_reference", source: "test" }],
          },
        })
        insertBuildSessionContract({ taskID, sessionID: buildSession.id, manifest })
        const msg = await SessionPrompt.prompt({
          sessionID: buildSession.id,
          byteMaterializationProjectID: buildSession.projectID,
          agent: "coding",
          noReply: true,
          parts: [
            { type: "text", text: "use the old persisted visual reference" },
            {
              type: "file",
              mime: "image/png",
              filename: "source-reference.png",
              url: `data:image/png;base64,${pngBytes.toString("base64")}`,
            },
          ],
        })
        const originalLocation = AttachmentStore.nameFromUrl(original.url)
        if (!originalLocation) throw new Error("expected original attachment location")
        const originalAbs = AttachmentStore.resolveAbsolute(originalLocation.projectID, originalLocation.name)
        if (!originalAbs) throw new Error("expected original attachment path")
        await fs.rm(originalAbs, { force: true })
        await fs.rm(`${originalAbs}.metadata.json`, { force: true })
        await persistExecutorSessionRef({
          sessionID: buildSession.id,
          provider: "codex",
          ref: { nativeSessionID: "provider-native-managed-retry-session" },
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          existingSessionID: buildSession.id,
          target: {
            kind: "request",
            text: "retry managed build",
          },
          managedWorktree: {
            directory: worktree.directory,
            branch: worktree.branch,
          },
        })

        expect(output.sessionID).toBe(buildSession.id)
        expect(captured.resume?.sessionID).toBe("provider-native-managed-retry-session")
        expect(await fs.readFile(originalAbs)).toEqual(pngBytes)
        const storedAfter = await Message.get({ sessionID: buildSession.id, messageID: msg.info.id })
        const modelMessages = await Message.toModelMessages([storedAfter], providerModel)
        expect(JSON.stringify(modelMessages)).toContain(`data:image/png;base64,${pngBytes.toString("base64")}`)
      },
    })
  }, 30_000)

  test("managed build retry continues an existing session without the original input evidence contract", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_missing_retry_contract_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "Missing retry contract root",
          directory: tmp.path,
        })
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const worktree = await Worktree.create({
          name: `missing-retry-contract-${suffix}`,
          taskID,
          sessionID: rootSession.id,
        })
        const buildSession = await Session.createNext({
          kind: "build",
          parentID: rootSession.id,
          title: "Missing retry contract build",
          directory: worktree.directory,
        })
        await persistExecutorSessionRef({
          sessionID: buildSession.id,
          provider: "codex",
          ref: { nativeSessionID: "provider-native-missing-contract-session" },
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          existingSessionID: buildSession.id,
          target: {
            kind: "request",
            text: "retry managed build without contract",
          },
          managedWorktree: {
            directory: worktree.directory,
            branch: worktree.branch,
          },
        })

        expect(output.sessionID).toBe(buildSession.id)
        expect(captured.run).toBeUndefined()
        expect(captured.resume?.sessionID).toBe("provider-native-missing-contract-session")
        expect(captured.resume?.logicalSessionID).toBe(buildSession.id)
      },
    })
  }, 30_000)

  test("managed build retry still requires consumed comparison artifact refs from the original input manifest", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_retry_comparison_contract_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "Retry comparison contract root",
          directory: tmp.path,
        })
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const worktree = await Worktree.create({
          name: `retry-comparison-contract-${suffix}`,
          taskID,
          sessionID: rootSession.id,
        })
        const buildSession = await Session.createNext({
          kind: "build",
          parentID: rootSession.id,
          title: "Retry comparison contract build",
          directory: worktree.directory,
        })
        const comparisonRef = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(16, 16),
          "image/png",
          "visual-feedback.side-by-side.png",
        )
        const manifest = await composeBuildInputEvidenceManifest({
          projectID: Instance.project.id,
          taskID,
          sessionID: buildSession.id,
          evidencePack: {
            comparisonArtifacts: [
              {
                ...comparisonRef,
                intent: "visual_feedback_comparison",
                source: "browser_preview_reference_comparison",
              },
            ],
          },
        })
        insertBuildSessionContract({ taskID, sessionID: buildSession.id, manifest })
        await persistExecutorSessionRef({
          sessionID: buildSession.id,
          provider: "codex",
          ref: { nativeSessionID: "provider-native-retry-comparison-contract" },
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        ExecutorRegistry.registerCoding(
          "codex",
          {
            name: "codex",
            capabilities: () => ({
              builtinTools: true,
              customTools: true,
              stream: true,
              resume: true,
              interrupt: true,
              cwd: true,
              system: true,
            }),
            run: async function* () {
              yield { type: "done", output: "unused" }
            },
            resume: async function* () {
              yield {
                type: "structured",
                output: {
                  status: "passed",
                  summary: "Retry claimed repair without consuming comparison image.",
                  files_changed: [],
                  tests: [],
                  fact_check_items: [],
                },
              }
            },
            interrupt: async () => true,
          },
          { model: "test-model" },
        )

        await expect(
          BuildAgent.run({
            task: task!,
            parentSessionID: rootSession.id,
            existingSessionID: buildSession.id,
            target: {
              kind: "request",
              text: "retry visual repair",
            },
            managedWorktree: {
              directory: worktree.directory,
              branch: worktree.branch,
            },
          }),
        ).rejects.toThrow("visual feedback comparison consumption contract failed")
      },
    })
  }, 30_000)

  test("managed build retry repairs persisted file parts through the original manifest project", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          coding: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskProjectID = `project_retry_manifest_owner_${suffix}`
        seedProjectRow({ projectID: taskProjectID, worktree: tmp.path })

        const taskID = `tsk_retry_manifest_owner_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "Retry manifest owner root",
          directory: tmp.path,
        })
        seedTask({ projectID: taskProjectID, taskID, sessionID: rootSession.id, executor: "codex" })
        const worktree = await Worktree.create({
          name: `retry-manifest-owner-${suffix}`,
          taskID,
          sessionID: rootSession.id,
        })
        const buildSession = await Session.createNext({
          kind: "build",
          parentID: rootSession.id,
          title: "Retry manifest owner build",
          directory: worktree.directory,
        })
        Database.use((db) =>
          db.update(SessionTable).set({ project_id: taskProjectID }).where(eq(SessionTable.id, buildSession.id)).run(),
        )

        const pngBytes = await pngImage(16, 16)
        const original = await AttachmentStore.write(taskProjectID, pngBytes, "image/png", "source-reference.png")
        await AttachmentStore.stageToWorktree(taskProjectID, [original], worktree.directory)
        const manifest = await composeBuildInputEvidenceManifest({
          projectID: taskProjectID,
          taskID,
          sessionID: buildSession.id,
          evidencePack: {
            targetReferences: [{ ...original, intent: "visual_reference", source: "test" }],
          },
        })
        insertBuildSessionContract({ taskID, sessionID: buildSession.id, manifest })

        const msg = await SessionPrompt.prompt({
          sessionID: buildSession.id,
          byteMaterializationProjectID: taskProjectID,
          agent: "coding",
          noReply: true,
          parts: [
            { type: "text", text: "use the manifest-owned visual reference" },
            {
              type: "file",
              mime: "image/png",
              filename: "source-reference.png",
              url: `data:image/png;base64,${pngBytes.toString("base64")}`,
            },
          ],
        })
        const originalLocation = AttachmentStore.nameFromUrl(original.url)
        if (!originalLocation) throw new Error("expected original attachment location")
        const originalAbs = AttachmentStore.resolveAbsolute(originalLocation.projectID, originalLocation.name)
        if (!originalAbs) throw new Error("expected original attachment path")
        await fs.rm(originalAbs, { force: true })
        await fs.rm(`${originalAbs}.metadata.json`, { force: true })
        await persistExecutorSessionRef({
          sessionID: buildSession.id,
          provider: "codex",
          ref: { nativeSessionID: "provider-native-manifest-owner-session" },
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          existingSessionID: buildSession.id,
          target: {
            kind: "request",
            text: "retry managed build with manifest owner",
          },
          managedWorktree: {
            directory: worktree.directory,
            branch: worktree.branch,
          },
        })

        expect(output.sessionID).toBe(buildSession.id)
        expect(captured.resume?.sessionID).toBe("provider-native-manifest-owner-session")
        expect(await fs.readFile(originalAbs)).toEqual(pngBytes)
        const storedAfter = await Message.get({ sessionID: buildSession.id, messageID: msg.info.id })
        const filePart = storedAfter.parts.find((part) => part.type === "file")
        if (!filePart || filePart.type !== "file") throw new Error("expected stored file part")
        expect(filePart.url).toStartWith(`/attachment/${taskProjectID}/`)
        const modelMessages = await Message.toModelMessages([storedAfter], providerModel)
        expect(JSON.stringify(modelMessages)).toContain(`data:image/png;base64,${pngBytes.toString("base64")}`)
      },
    })
  }, 30_000)

  test("external executors receive primary runtimeDir and distinct worktreeDir", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_external_runtime_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "External runtime root",
          directory: tmp.path,
        })
        seedTask({ projectID: Instance.project.id, taskID, sessionID: rootSession.id, executor: "codex" })
        const task = findTask(taskID)
        expect(task).toBeTruthy()

        const workDir = path.join(tmp.path, "external-worktree")
        await fs.mkdir(workDir, { recursive: true })
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          target: {
            kind: "request",
            text: "verify external runtime input",
          },
          workDir,
        })

        expect(captured.run?.runtimeDir).toBe(ProjectRuntimePaths.sessionRoot(tmp.path, taskID, output.sessionID))
        expect(captured.run?.worktreeDir).toBe(workDir)
        expect(captured.run?.cwd).toBe(workDir)
        expect(captured.run?.logicalSessionID).toBe(output.sessionID)
        expect(captured.run?.taskID).toBe(taskID)
        expect(output.worktreeDir).toBe(workDir)
        expect(output.worktreeBranch).toBeUndefined()
      },
    })
  }, 30_000)

  test("external build retry resumes with incremental text instead of replaying visual attachments", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_external_retry_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "External retry root",
          directory: tmp.path,
        })
        const workDir = path.join(tmp.path, "external-retry-worktree")
        await fs.mkdir(workDir, { recursive: true })
        const buildSession = await Session.createNext({
          kind: "build",
          parentID: rootSession.id,
          title: "External retry build",
          directory: workDir,
        })
        const visualRef = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "reference-target.png",
        )
        seedTask({
          projectID: Instance.project.id,
          taskID,
          sessionID: rootSession.id,
          executor: "codex",
          attachments: [{ ...visualRef, intent: "visual_reference", source: "user-upload" }],
        })
        const manifest = await composeBuildInputEvidenceManifest({
          projectID: Instance.project.id,
          taskID,
          sessionID: buildSession.id,
          evidencePack: {
            targetReferences: [{ ...visualRef, intent: "visual_reference", source: "user-upload" }],
          },
        })
        insertBuildSessionContract({ taskID, sessionID: buildSession.id, manifest })
        await persistExecutorSessionRef({
          sessionID: buildSession.id,
          provider: "codex",
          ref: { nativeSessionID: "provider-native-retry-session" },
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()

        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding("codex", captureCodingProvider(captured), {
          model: "test-model",
        })

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          existingSessionID: buildSession.id,
          target: {
            kind: "request",
            text: "repair the existing direct build",
          },
          context: {
            contextPackets: [
              textContextPacket({
                id: "retry-managed-worktree-runtime",
                title: "Prior Build Retry Evidence",
                source: "retry",
                body: "Prior attempt failed because merge_back was blocked by dirty files.",
              })!,
            ],
          },
          workDir,
        })

        expect(output.sessionID).toBe(buildSession.id)
        expect(captured.run).toBeUndefined()
        expect(captured.resume?.sessionID).toBe("provider-native-retry-session")
        expect(captured.resume?.logicalSessionID).toBe(buildSession.id)
        expect(captured.resume?.prompt).toBe("Prior attempt failed because merge_back was blocked by dirty files.")
        expect(captured.resume?.prompt).not.toContain("# Build Retry Feedback")
        expect(captured.resume?.prompt).not.toContain("## Visual Reference Contract")
        expect(captured.resume?.prompt).not.toContain("## Task Attachments")
        expect(captured.resume?.prompt).not.toContain("reference-target.png")
      },
    })
  }, 30_000)

  test("external build retry stages current visual feedback evidence before provider resume", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_external_retry_visual_feedback_${suffix}`
        const rootSession = await Session.create({
          kind: "orchestrator",
          title: "External retry visual feedback root",
          directory: tmp.path,
        })
        const workDir = path.join(tmp.path, "external-retry-visual-feedback-worktree")
        await fs.mkdir(workDir, { recursive: true })
        const buildSession = await Session.createNext({
          kind: "build",
          parentID: rootSession.id,
          title: "External retry visual feedback build",
          directory: workDir,
        })
        const originalTarget = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(16, 16),
          "image/png",
          "reference-target.png",
        )
        const comparison = await AttachmentStore.write(
          Instance.project.id,
          await pngImage(20, 12),
          "image/png",
          "visual-feedback.side-by-side.png",
        )
        const diagnostic = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(JSON.stringify({ problem: "hero spacing", severity: "blocking" })),
          "application/json",
          "visual-feedback.layout.json",
        )
        seedTask({
          projectID: Instance.project.id,
          taskID,
          sessionID: rootSession.id,
          executor: "codex",
          attachments: [{ ...originalTarget, intent: "visual_reference", source: "user-upload" }],
        })
        const originalManifest = await composeBuildInputEvidenceManifest({
          projectID: Instance.project.id,
          taskID,
          sessionID: buildSession.id,
          evidencePack: {
            targetReferences: [{ ...originalTarget, intent: "visual_reference", source: "user-upload" }],
          },
        })
        insertBuildSessionContract({ taskID, sessionID: buildSession.id, manifest: originalManifest })
        await persistExecutorSessionRef({
          sessionID: buildSession.id,
          provider: "codex",
          ref: { nativeSessionID: "provider-native-retry-visual-feedback-session" },
        })
        const task = findTask(taskID)
        expect(task).toBeTruthy()

        const currentEvidencePack: BuildEvidencePack = {
          comparisonArtifacts: [
            {
              ...comparison,
              intent: "visual_feedback_comparison",
              source: "browser_preview_reference_comparison",
            },
          ],
          visualQaDiagnostics: [
            {
              ...diagnostic,
              intent: "visual_qa_diagnostic",
              source: "visual_qa_layout_geometry",
            },
          ],
        }
        const captured: { run?: CodingRunInfo; resume?: CodingResumeInfo } = {}
        ExecutorRegistry.registerCoding(
          "codex",
          {
            name: "codex",
            capabilities: () => ({
              builtinTools: true,
              customTools: true,
              stream: true,
              resume: true,
              interrupt: true,
              cwd: true,
              system: true,
            }),
            run: async function* (input) {
              captured.run = input
              yield { type: "done", output: "unused" }
            },
            resume: async function* (input) {
              captured.resume = input
              const output = {
                status: "passed",
                summary: "Consumed current visual feedback evidence during retry.",
                files_changed: [],
                tests: [],
                consumed_visual_feedback_comparison_refs: [comparison.url],
                consumed_visual_qa_diagnostic_refs: [diagnostic.url],
                contract_restatement: "Retry repaired the existing direct build from current Visual QA feedback.",
                followup_workload_guidance:
                  "Future agents must keep consuming the task-scoped Visual QA comparison and diagnostic refs.",
                fact_check_items: [],
              }
              yield {
                type: "tool_call",
                id: "call_structured_build_result",
                name: "structured_output",
                input: output,
              }
              yield {
                type: "tool_result",
                id: "call_structured_build_result",
                name: "structured_output",
                input: output,
                output: JSON.stringify(output),
              }
              yield { type: "done", output: "structured build result submitted" }
            },
            interrupt: async () => true,
          },
          { model: "test-model" },
        )

        const output = await BuildAgent.run({
          task: task!,
          parentSessionID: rootSession.id,
          existingSessionID: buildSession.id,
          target: {
            kind: "request",
            text: "repair the existing direct build from visual feedback",
          },
          context: {
            contextPackets: [
              textContextPacket({
                id: "visual-qa-build-context",
                title: "Visual QA Repair Evidence",
                source: "visual_qa",
                scope: "task",
                body: "Visual QA found hero spacing mismatch; consume the comparison and layout evidence.",
              })!,
              ...contextPacketsForEvidencePack(currentEvidencePack),
            ],
          },
          workDir,
        })

        expect(output.sessionID).toBe(buildSession.id)
        expect(captured.run).toBeUndefined()
        expect(captured.resume?.sessionID).toBe("provider-native-retry-visual-feedback-session")
        expect(captured.resume?.tools?.some((tool) => tool.name === "structured_output")).toBe(true)
        const prompt = captured.resume?.prompt ?? ""
        expect(prompt).toContain("Visual QA found hero spacing mismatch")
        expect(prompt).toContain("### Comparison And Verification Artifacts")
        expect(prompt).toContain("visual-feedback.side-by-side.png")
        expect(prompt).toContain("### Visual QA Diagnostic Artifacts")
        expect(prompt).toContain("visual-feedback.layout.json")
        expect(prompt).toContain("## Staged Reference Files")
        expect(prompt).toContain("references/visual-feedback.side-by-side.png")
        expect(prompt).toContain("references/visual-feedback.layout.json")
        expect(prompt).not.toContain("references/reference-target.png")
        await expect(
          fs.stat(path.join(workDir, "references", "visual-feedback.side-by-side.png")),
        ).resolves.toBeTruthy()
        await expect(fs.stat(path.join(workDir, "references", "visual-feedback.layout.json"))).resolves.toBeTruthy()
      },
    })
  }, 30_000)
})
