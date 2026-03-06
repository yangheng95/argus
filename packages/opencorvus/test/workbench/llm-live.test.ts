import { afterEach, expect, test } from "bun:test"
import { WorkbenchPreferenceTable } from "../../src/workbench/workbench.sql"
import { WorkbenchService } from "../../src/workbench/service"
import { OrchestratorService } from "../../src/orchestrator/service"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const enabled =
  process.env.OPENCORVUS_RUN_LIVE_WORKBENCH_TEST === "1" &&
  (process.env.MOONSHOT_API_KEY?.length ?? 0) > 20

const live = enabled ? test : test.skip

afterEach(async () => {
  await resetDatabase().catch(() => undefined)
})

live("classifies free-form preference with real kimi", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = OpencodeExecutor.submit
  OpencodeExecutor.submit = async ({ sessionID }) => ({
    sessionID,
    queueTaskID: Identifier.ascending("task"),
  })

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement feature",
          metadata: {
            slack: {
              user: "U-KIMI",
            },
          },
        })

        const result = await WorkbenchService.ingestTaskMessage({
          taskID,
          text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
          source: "live_test",
          userID: "U-KIMI",
        })

        expect(result.kind).toBe("preference")
        const prefs = Database.use((db) =>
          db.select().from(WorkbenchPreferenceTable).where(eq(WorkbenchPreferenceTable.user_id, "U-KIMI")).all(),
        )
        expect(prefs.length).toBeGreaterThan(0)
      },
    })
  } finally {
    OpencodeExecutor.submit = original
  }
})
