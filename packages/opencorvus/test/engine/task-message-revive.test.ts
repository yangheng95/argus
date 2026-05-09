import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { openTaskForOperatorMessage } from "../../src/engine/task-message-open"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { afterEach } from "bun:test"

afterEach(async () => {
  await resetDatabase()
})

/**
 * Backend invariant: lifecycle status is display/audit context, not a gate.
 * Any task can receive a new operator message, but accepting that message must
 * not erase the prior completed / failed / cancelled facts.
 */
/**
 * Status is a derivation, not a column (see engine/task-status.ts).
 * To pin each terminal variant we seed the underlying facts the
 * derivation reads:
 *   - completed: time_completed != null, error null, no metadata.cancelled
 *   - failed:    time_completed != null, error set,  no metadata.cancelled
 *   - cancelled: time_completed != null, metadata.cancelled === true
 */
const TERMINAL_FIXTURES = [
  {
    label: "completed",
    fields: { error: null, metadata: null },
  },
  {
    label: "failed",
    fields: { error: "executor blew up", metadata: null },
  },
  {
    label: "cancelled",
    fields: { error: null, metadata: { cancelled: true } as Record<string, unknown> },
  },
] as const

describe("openTaskForOperatorMessage — terminal-state facts are preserved", () => {
  for (const fixture of TERMINAL_FIXTURES) {
    test(`keeps ${fixture.label} markers when opening for an operator message`, async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const taskID = Identifier.ascending("task")
          const startedAt = Date.now() - 60_000
          const completedAt = Date.now() - 5_000
          Database.use((db) => {
            db.insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                source: "test",
                title: "Revive me",
                request: "do thing",
                priority: "normal",
                time_created: startedAt,
                time_updated: completedAt,
                time_started: startedAt,
                time_completed: completedAt,
                error: fixture.fields.error,
                metadata: fixture.fields.metadata,
              } as any)
              .run()
          })

          const task = findTask(taskID)
          expect(task).toBeDefined()
          expect(deriveTaskStatus(task!)).toBe(fixture.label)
          expect(task!.time_completed).toBe(completedAt)

          const reopened = await openTaskForOperatorMessage(task!)
          expect(reopened.time_completed).toBe(completedAt)
          expect(reopened.error).toBe(fixture.fields.error)
          const md = (reopened.metadata ?? {}) as Record<string, unknown>
          expect(md.cancelled).toBe((fixture.fields.metadata as any)?.cancelled)
          expect(deriveTaskStatus(reopened)).toBe(fixture.label)

          // Persisted, not just in-memory: re-read from DB.
          const reread = findTask(taskID)
          expect(reread!.time_completed).toBe(completedAt)
          expect(deriveTaskStatus(reread!)).toBe(fixture.label)
        },
      })
    })
  }
})

/**
 * Source-level pin for the appendTaskSessionMessage hardening
 * (rule 7: no silent fallback). The previous `if (!task.session_id) return`
 * let injectMessage believe the append succeeded and dispatch fired with
 * an invisible message; the throw forces the failure to surface.
 */
describe("appendTaskSessionMessage — no silent no-op", () => {
  test("source throws when task.session_id or message context is missing", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "src", "task-api", "index.ts"),
      "utf8",
    )
    // The function signature must no longer admit `undefined` as a happy path.
    expect(src).toMatch(
      /async function appendTaskSessionMessage[\s\S]*?Promise<\{\s*info: Message\.User;\s*parts: Message\.Part\[\]\s*\}>/,
    )
    // Both guard branches must throw rather than `return`.
    expect(src).toMatch(/if \(!task\.session_id\) \{\s*throw new Error\(/)
    expect(src).toMatch(/if \(!ctx\) \{\s*throw new Error\(/)
    // The legacy silent-return wording is gone.
    expect(src).not.toMatch(/if \(!task\.session_id\) return\b/)
    expect(src).not.toMatch(/if \(!ctx\) return\b/)
  })
})

/**
 * Source-level pin for the overlay chat fix. The previous "completed →
 * fork new task" branch contradicted the same-task continuation invariant by severing
 * conversation history at the task boundary. Every status now goes
 * through /task/:id/message uniformly.
 */
describe("overlay chat — terminal tasks no longer fork on send", () => {
  test("panelMessage does not branch on taskStatus === 'completed'", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "..", "overlay", "src", "services", "chat.ts"),
      "utf8",
    )
    expect(src).not.toMatch(/taskStatus === ["']completed["']/)
    expect(src).not.toMatch(/Completed tasks → create a follow-up task/)
    expect(src).toMatch(/Every status .* send message directly to the task/s)
  })
})
