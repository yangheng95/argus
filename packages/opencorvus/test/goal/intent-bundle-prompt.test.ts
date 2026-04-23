import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { ProjectTable } from "@/project/project.sql"
import {
  EngineTaskTable,
  EnginePlanVersionTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
} from "@/engine/engine.sql"
import { WorkbenchTaskNoteTable } from "@/workbench/workbench.sql"
import { buildGoalPrompt } from "@/goal/runner"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let projectID = ""
let taskID = ""
let planID = ""
let goalID = ""
let tmp: Awaited<ReturnType<typeof tmpdir>>

function seedBase() {
  const now = Date.now()
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: process.cwd(),
      name: "Intent Bundle Test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Intent bundle exposure test",
      request: "Do a thing",
      status: "active",
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EnginePlanVersionTable).values({
      id: planID,
      task_id: taskID,
      version: 1,
      status: "active",
      summary: "plan",
      prompt: "plan prompt",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineGoalTable).values({
      id: goalID,
      task_id: taskID,
      plan_version_id: planID,
      title: "Implement X",
      slug: "implement-x",
      objective: "Implement X with enough detail for the executor to proceed.",
      done_definition: "tests pass",
      owned_paths: ["src/x.ts"],
      depends_on: [],
      exports: [],
      imports: [],
      kind: "feature",
      requirement_ids: [],
      priority: "blocking",
      status: "pending",
      acceptance_specs: [],
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

function seedClarificationAndNote() {
  const now = Date.now()
  // Answered clarification
  const interactionID = Identifier.ascending("interaction")
  Database.use((db) =>
    db.insert(EngineInteractionRequestTable).values({
      id: interactionID,
      task_id: taskID,
      external_id: interactionID,
      request_type: "question",
      status: "answered",
      title: "runtime clarification",
      body: "Which runtime should we use?",
      payload: { questions: [{ question: "Which runtime should we use?" }] } as any,
      response: { answers: ["Bun"] } as any,
      time_resolved: now,
      time_created: now,
      time_updated: now,
    } as any).run(),
  )
  // Operator note
  Database.use((db) =>
    db.insert(WorkbenchTaskNoteTable).values({
      id: Identifier.ascending("note"),
      task_id: taskID,
      kind: "operator_note",
      source: "user_message",
      content: "Remember: we only ship Bun, never npm.",
      time_created: now,
      time_updated: now,
    } as any).run(),
  )
}

function loadSeeded() {
  const goal = Database.use((db) =>
    db.select().from(EngineGoalTable).all(),
  ).find((g) => g.id === goalID)!
  const plan = Database.use((db) =>
    db.select().from(EnginePlanVersionTable).all(),
  ).find((p) => p.id === planID)!
  return { goal, plan }
}

function mkNode() {
  return {
    id: "node_1",
    task_id: taskID,
    plan_version_id: planID,
    kind: "goal",
    goal_id: goalID,
    title: "Implement X",
    brief: "Write src/x.ts",
    depends_on_ids: [],
    order_index: 0,
    metadata: null,
    time_created: Date.now(),
    time_updated: Date.now(),
  } as any
}

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir()
  const stamp = Date.now().toString(16)
  projectID = `project_ib_${stamp}`
  taskID = `tsk_${stamp}ib`
  planID = `plan_${stamp}ib`
  goalID = `goal_${stamp}ib`
  seedBase()
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("buildGoalPrompt — intent bundle advertisement", () => {
  test("unconditionally advertises intent bundle paths (caller contract: always mounted)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { goal, plan } = loadSeeded()
        const prompt = buildGoalPrompt({
          plan, node: mkNode(), goal,
          taskRequest: "user task request",
          taskID, dependencies: [], cwd: tmp.path,
        })

        expect(prompt).toContain("## User Intent Bundle")
        expect(prompt).toContain(".opencorvus/intent/")
        expect(prompt).toContain("intent/request.md")
        expect(prompt).toContain("attachment://<sha>.<ext>")
        expect(prompt).toContain(".opencorvus/attachments/")
      },
    })
  })
})

describe("buildGoalPrompt — clarifications/notes double-exposure guard", () => {
  test("clarifications + operator notes are NOT inlined in prompt (bundle is the sole channel)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedClarificationAndNote()
        const { goal, plan } = loadSeeded()
        const prompt = buildGoalPrompt({
          plan, node: mkNode(), goal,
          taskRequest: "user task request",
          taskID, dependencies: [], cwd: tmp.path,
        })

        // Section headers emitted by the helpers must NOT appear inline —
        // the bundle file is the sole authoritative channel.
        expect(prompt).not.toContain("## Clarifications Already Answered")
        expect(prompt).not.toContain("## Operator Notes")
        expect(prompt).not.toContain("Remember: we only ship Bun, never npm.")
        expect(prompt).not.toContain("Which runtime should we use?")

        // Sanity check: bundle advertisement still present.
        expect(prompt).toContain("intent/clarifications.md")
        expect(prompt).toContain("intent/operator-notes.md")
        expect(prompt).toContain("Task attachments are NOT duplicated into `.opencorvus/intent/`.")
      },
    })
  })
})
