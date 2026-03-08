#!/usr/bin/env bun
import { OrchestratorService } from "../src/orchestrator/service"
import { WorkbenchService } from "../src/workbench/service"
import { Database } from "../src/storage/db"
import { WorkbenchTaskNoteTable } from "../src/workbench/workbench.sql"
import { eq } from "drizzle-orm"
import { Instance } from "../src/project/instance"
import { tmpdir } from "../test/fixture/fixture"

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

console.log("note-smoke: starting...")

try {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const taskID = await OrchestratorService.createTask({
        request: "smoke test task",
      })

      const result = await WorkbenchService.ingestTaskMessage({
        taskID,
        text: "This is a tiny smoke test note",
        source: "smoke_test",
      })

      assert(result.kind === "note", `Expected kind 'note', got '${result.kind}'`)
      assert(result.message === "Operator note recorded.", `Unexpected message: ${result.message}`)
      assert(result.should_resume === true, "Expected should_resume to be true")

      const notes = Database.use((db: any) =>
        db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all(),
      )

      console.log("note-smoke: notes found:", notes.length)
      notes.forEach((n: any, i: any) => console.log(`  note ${i}:`, n.kind, n.content.slice(0, 50)))

      const ourNote = notes.find((n: any) => n.content === "This is a tiny smoke test note")
      assert(ourNote !== undefined, "Our note not found")
      assert(ourNote.kind === "operator_note", `Expected kind 'operator_note', got '${ourNote.kind}'`)
      assert(ourNote.source === "smoke_test", `Expected source 'smoke_test', got '${ourNote.source}'`)

      console.log("note-smoke: ok")
      process.exit(0)
    },
  })
} catch (error) {
  console.error("note-smoke: failed", error)
  process.exit(1)
}
