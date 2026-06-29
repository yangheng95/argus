import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Overlay image ingestion fidelity contract.
 *
 * Pre-fix `handleTaskMessage` decoded base64 image attachments, persisted
 * the bytes to AttachmentStore, attached them to the session message — and
 * STOPPED THERE. `task.attachments` was never updated. Every downstream
 * consumer (orchestrator wake → architect → build agent) reads from
 * `task.attachments`, not from session history; the orchestrator therefore
 * woke for the follow-up message with `task.attachments` still equal to
 * the create-time snapshot, and a user dropping a screenshot into a
 * follow-up got fidelity 0 even though the bytes were saved.
 *
 * The fix calls `appendTaskAttachment` for every materialized ref, so
 * follow-up images surface in `task.attachments` and reach build agents.
 */
describe("EngineService.handleTaskMessage — follow-up attachment persistence", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("calls appendTaskAttachment for each image in input.attachments", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        // Seed a minimal task row directly so requireTask(taskID) succeeds.
        // We deliberately bypass createTask + the full session/pipeline
        // setup — this test verifies ONE thing: that handleTaskMessage's
        // attachment loop calls appendTaskAttachment per ref.
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "follow-up attachment regression",
              request: "initial request had no images",
              priority: "normal",
              executor: "opencorvus",
              attachments: undefined,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        // Spy on appendTaskAttachment to capture the per-ref calls without
        // requiring a full session pipeline. Returning [] short-circuits
        // the merge but lets the spy record the invocation. continueTaskMessage
        // (the namespace-private continuation helper) may still throw because
        // the seeded task has no session_id — we wrap the call in try/catch;
        // the contract this test enforces is that appendTaskAttachment was
        // called BEFORE that downstream failure, which is the bug-B fix.
        const appendSpy = spyOn(EngineService, "appendTaskAttachment").mockResolvedValue([])

        const PNG_BASE64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

        try {
          await EngineService.handleTaskMessage(taskID, {
            text: "Here's the new screenshot.",
            source: "test",
            attachments: [{ mime: "image/png", data: PNG_BASE64, filename: "follow-up.png" }],
          })
        } catch {
          // continueTaskMessage may still run the un-stubbed path and fail
          // because the test task lacks a session — that's downstream of
          // our contract. The append must have happened by then.
        }

        expect(appendSpy).toHaveBeenCalled()
        const firstCall = appendSpy.mock.calls[0]
        expect(firstCall?.[0]).toBe(taskID)
        const ref = firstCall?.[1] as { mime: string; intent?: string; source?: string; filename?: string } | undefined
        expect(ref?.mime).toBe("image/png")
        expect(ref?.filename).toBe("follow-up.png")
        // Image MIMEs must carry visual_reference intent so acceptance
        // visual-diff check can pick them up.
        expect(ref?.intent).toBe("visual_reference")
        expect(ref?.source).toBe("user-upload")
      },
    })
  })

  test("non-image attachments still get appended with spec_artifact intent", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "follow-up spec attachment",
              request: "initial",
              priority: "normal",
              executor: "opencorvus",
              attachments: undefined,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const appendSpy = spyOn(EngineService, "appendTaskAttachment").mockResolvedValue([])

        try {
          await EngineService.handleTaskMessage(taskID, {
            text: "Adding a markdown spec.",
            source: "test",
            attachments: [
              {
                mime: "text/markdown",
                data: Buffer.from("## Spec\nAdditional acceptance criteria.", "utf8").toString("base64"),
                filename: "addendum.md",
              },
            ],
          })
        } catch {
          // Downstream session continuation may fail; we only assert append.
        }

        expect(appendSpy).toHaveBeenCalled()
        const ref = appendSpy.mock.calls[0]?.[1] as { mime: string; intent?: string } | undefined
        expect(ref?.mime).toBe("text/markdown")
        expect(ref?.intent).toBe("spec_artifact")
      },
    })
  })

  test("does not call appendTaskAttachment when no attachments are supplied", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "no-op follow-up",
              request: "initial",
              priority: "normal",
              executor: "opencorvus",
              attachments: undefined,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const appendSpy = spyOn(EngineService, "appendTaskAttachment").mockResolvedValue([])

        try {
          await EngineService.handleTaskMessage(taskID, {
            text: "Plain follow-up, no files.",
            source: "test",
          })
        } catch {
          /* downstream session continuation isn't this test's concern */
        }

        expect(appendSpy).not.toHaveBeenCalled()
      },
    })
  })
})
