import { afterEach, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineGit } from "../../src/engine/git"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { Orchestrator } from "../../src/orchestrator/agent"
import { runTaskLoop } from "../../src/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

/**
 * Regression for the publisher-rework loop observed in
 * `overlay-web-benchmark-report-1777828097445` and `b6d21ddh2`:
 *
 *   WARN service=engine-acceptance adapter=workspace_export
 *   error=Error: workspace_export requires task.metadata.git.baseline.commit
 *   ...
 *   artifact_export_rework_<ts>: This is a rework signal, not a terminal
 *   task failure. The orchestrator must fix the workspace/export
 *   mismatch, then run deliver again.
 *
 * Root cause: `EngineGit.prepare()` (engine/git.ts) is the ONLY writer
 * of `task.metadata.git.baseline.commit`, and a full-repo grep shows it
 * had ZERO callers. So baseline was unset for every task, the
 * `workspaceExportAdapter` (engine/publisher.ts) threw on every
 * acceptance, and the orchestrator's "deliver" tool fed the rework
 * signal back into the loop forever.
 *
 * Fix: call `EngineGit.prepare(task)` in `runTaskLoopInner`, after the
 * terminal-state guard but before `Orchestrator.processTask`. Prepare
 * is idempotent (early-returns when baseline already exists), so wakes
 * after the first one are no-ops.
 *
 * Source-level pin so a future "clean up unused engine helper" PR
 * doesn't silently delete the call again.
 */

const LOOP_SRC = path.join(import.meta.dir, "..", "..", "src", "orchestrator", "loop.ts")

const EXPORT_SRC = path.join(import.meta.dir, "..", "..", "src", "engine", "workspace-export.ts")

const loopSrc = await fs.readFile(LOOP_SRC, "utf8")
const exportSrc = await fs.readFile(EXPORT_SRC, "utf8")

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

test("runTaskLoopInner brings EngineGit into scope (static or dynamic import)", () => {
  // Either a top-level `import { EngineGit } from "@/engine/git"` or a
  // local `await import("@/engine/git")` (the existing file uses dynamic
  // imports for sibling engine modules to avoid load-order cycles).
  const staticForm = /import\s*\{[^}]*\bEngineGit\b[^}]*\}\s*from\s*["']@\/engine\/git["']/
  const dynamicForm = /await\s+import\(\s*["']@\/engine\/git["']\s*\)/
  expect(staticForm.test(loopSrc) || dynamicForm.test(loopSrc)).toBe(true)
})

test("runTaskLoopInner calls EngineGit.prepare on the task before processTask", () => {
  const prepareIdx = loopSrc.search(/\bEngineGit\.prepare\(/)
  const processIdx = loopSrc.search(/\bOrchestrator\.processTask\(/)
  expect(prepareIdx).toBeGreaterThan(-1)
  expect(processIdx).toBeGreaterThan(-1)
  expect(prepareIdx).toBeLessThan(processIdx)
})

test("workspace-export still requires baseline (no silent-fallback regression)", () => {
  // Pin the throw so a future "fix" cannot make workspace_export silently
  // accept missing baselines. The fix must wire prepare() at task entry,
  // not paper over the contract violation here.
  expect(exportSrc).toMatch(/throw new Error\("workspace_export requires task\.metadata\.git\.baseline\.commit"\)/)
})

test("runTaskLoop fails the task and skips orchestrator processing when EngineGit.prepare fails", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const taskID = `tsk_prepare_fail_${Date.now()}`
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            source: "test",
            title: "prepare failure task",
            request: "prepare must fail before orchestration",
            priority: "normal",
            time_created: now,
            time_updated: now,
          })
          .run(),
      )

      const prepare = spyOn(EngineGit, "prepare").mockImplementation(async (task) => ({
        task,
        error: "Cannot start the task because the repository has unresolved merge conflicts.",
      }))
      const processTask = spyOn(Orchestrator, "processTask").mockResolvedValue(undefined)

      await runTaskLoop({ taskID })

      expect(prepare).toHaveBeenCalledTimes(1)
      expect(processTask).not.toHaveBeenCalled()
      const task = findTask(taskID)
      expect(task?.error).toBe("Cannot start the task because the repository has unresolved merge conflicts.")
      expect(task ? deriveTaskStatus(task) : undefined).toBe("failed")
    },
  })
})
