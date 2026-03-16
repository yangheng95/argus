import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { BunProc } from "../../src/bun"
import { Env } from "../../src/env"
import { commandResult } from "../../src/evaluator/checks"
import { createGoalWorkspace } from "../../src/orchestrator/goal-runner"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator.goal workspace env", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("inherits env overrides from the parent instance", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("__OPENLENS_GOAL_WORKSPACE_ENV__", "present")
        const snapshot = await Snapshot.track()
        const directory = await createGoalWorkspace({
          task: { id: "task_goal_env" } as any,
          goal: { id: "goal_goal_env" } as any,
          snapshot,
        })

        expect(directory).toBe(tmp.path)
        await Instance.provide({
          directory,
          fn: async () => {
            expect(Env.get("__OPENLENS_GOAL_WORKSPACE_ENV__")).toBe("present")
          },
        })
      },
    })
  })

  test("passes env overrides to evaluator child processes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "print-env.js"),
      `process.stdout.write(process.env.__OPENLENS_GOAL_WORKSPACE_ENV__ || "")`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("__OPENLENS_GOAL_WORKSPACE_ENV__", "present")
        const result = await commandResult(
          {
            command: `& "${BunProc.which()}" print-env.js`,
            cwd: tmp.path,
          },
          5_000,
        )

        expect(result.output).toBe("present")
      },
    })
  })
})
