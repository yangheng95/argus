import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "path"

import { BuildAgent } from "../../src/build/agent"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import type { CodingProvider, CodingRunInfo, CodingResumeInfo } from "../../src/executor/contract"
import { ExecutorRegistry } from "../../src/executor/registry"
import { findTask } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

function seedTask(input: {
  projectID: string
  taskID: string
  sessionID?: string
  executor?: "opencorvus" | "codex" | "claude-code"
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
        time_created: now,
        time_updated: now,
        time_started: now,
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

afterEach(() => {
  ExecutorRegistry.reset()
})

describe("BuildAgent managed worktree runtime", () => {
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
      },
    })
  }, 30_000)
})
