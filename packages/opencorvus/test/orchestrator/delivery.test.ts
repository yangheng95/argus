import { afterEach, describe, expect, test } from "bun:test"
import { DeliveryService } from "../../src/orchestrator/delivery"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("orchestrator.delivery", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("exports patch and git preview for candidate delivery", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await DeliveryService.deliver({
          task: {
            id: "task_1",
            project_id: "project_1",
            session_id: null,
            active_plan_version_id: null,
            active_run_id: null,
            request_id: null,
            source: "api",
            title: "Demo",
            request: "Demo",
            status: "delivering",
            priority: "normal",
            blocking_reason: null,
            error: null,
            budget: null,
            metadata: null,
            time_started: null,
            time_completed: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          run: {
            id: "run_1",
            task_id: "task_1",
            plan_version_id: null,
            session_id: null,
            executor: "opencode",
            status: "completed",
            phase: "deliver",
            blocking_reason: null,
            error: null,
            retry_count: 0,
            executor_ref: null,
            metadata: null,
            time_started: null,
            time_completed: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          delivery: {
            id: "delivery_1",
            task_id: "task_1",
            run_id: "run_1",
            status: "candidate",
            summary: "Candidate delivery",
            result: {
              summary: "Candidate delivery",
              changed_files: ["src/app.ts"],
              diffs: [
                {
                  file: "src/app.ts",
                  before: "const a = 1\n",
                  after: "const a = 2\n",
                  additions: 1,
                  deletions: 1,
                  status: "modified",
                },
              ],
            },
            time_created: Date.now(),
            time_updated: Date.now(),
          },
        })

        expect(result.status).toBe("delivered")
        expect(result.artifacts.some((item) => item.kind === "patch")).toBe(true)
        expect(result.artifacts.some((item) => item.kind === "git_ref")).toBe(true)
      },
    })
  })
})
