import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { createGoalRun, updateGoalRun } from "../../src/engine/persist"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Worktree } from "../../src/worktree"

export type RewindStep = {
  userMessageID: string
}

export type RewindScenario = {
  taskID: string
  sessionID: string
  primaryFile: string
  existingGoalFile: string
  existingGoalWorktree: string
  existingGoalRunID: string
  postCursorGoalWorktree: string
  postCursorGoalRunID: string
  steps: RewindStep[]
  cursorAfterSecondStep: number
}

async function commitPrimaryFile(root: string, relative: string, body: string): Promise<string> {
  await fs.writeFile(path.join(root, relative), body, "utf8")
  await $`git add ${relative}`.cwd(root).quiet()
  await $`git commit -m ${`rewind fixture ${relative}`}`.cwd(root).quiet()
  const head = await $`git rev-parse HEAD`.cwd(root).quiet()
  return head.stdout.toString().trim()
}

function insertGoal(input: { taskID: string; id: string; title: string; now: number }) {
  Database.use((db) =>
    db
      .insert(EngineGoalTable)
      .values({
        id: input.id,
        task_id: input.taskID,
        title: input.title,
        slug: input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        objective: input.title,
        acceptance_specs: [],
        owned_paths: [],
        depends_on: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        order_index: 0,
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
}

async function createMessage(sessionID: string, index: number, timeCreated: number): Promise<string> {
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID,
    agent: "default",
    model: { providerID: "openai", modelID: "gpt-4" },
    time: { created: timeCreated },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: message.id,
    sessionID,
    type: "text",
    text: `step-${index} request`,
  })
  return message.id
}

async function createGoalWorktree(input: {
  taskID: string
  goalID: string
  runID: string
  baseRef: string
  fileRelative: string
  nextBody: string
}) {
  const info = await Worktree.create({
    name: `rewind-${input.goalID}`,
    taskID: input.taskID,
    goalID: input.goalID,
    runID: input.runID,
  })
  await fs.writeFile(path.join(info.directory, input.fileRelative), input.nextBody, "utf8")
  return { info, file: path.join(info.directory, input.fileRelative), baseRef: input.baseRef }
}

export async function createRewindScenario(root: string): Promise<RewindScenario> {
  const sessionID = (await Session.create({ kind: "root", title: "rewind root" })).id
  const taskID = Identifier.ascending("task")
  const base = Date.now()
  const cursorAfterSecondStep = base + 20
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        session_id: sessionID,
        source: "test",
        title: "rewind task",
        request: "rewind task",
        priority: "normal",
        time_created: base,
        time_updated: base,
      })
      .run(),
  )

  await commitPrimaryFile(root, "primary.txt", "primary-current")
  const primaryFile = path.join(root, "primary.txt")

  const baseRef = await commitPrimaryFile(root, "goal-before.txt", "goal-before-base")
  const postCursorBaseRef = await commitPrimaryFile(root, "goal-after.txt", "goal-after-base")

  const steps: RewindStep[] = []
  for (let index = 1; index <= 4; index += 1) {
    steps.push({ userMessageID: await createMessage(sessionID, index, base + index * 10) })
  }

  const existingGoalID = Identifier.ascending("goal")
  const postCursorGoalID = Identifier.ascending("goal")
  insertGoal({ taskID, id: existingGoalID, title: "Existing Goal", now: base + 10 })
  insertGoal({ taskID, id: postCursorGoalID, title: "Post Cursor Goal", now: base + 40 })

  const existingRun = createGoalRun({
    taskID,
    goalID: existingGoalID,
    coordinatorRunID: Identifier.ascending("run"),
    now: base + 15,
  })
  const postCursorRun = createGoalRun({
    taskID,
    goalID: postCursorGoalID,
    coordinatorRunID: Identifier.ascending("run"),
    now: base + 50,
  })

  const existing = await createGoalWorktree({
    taskID,
    goalID: existingGoalID,
    runID: existingRun.id,
    baseRef,
    fileRelative: "goal-before.txt",
    nextBody: "goal-before-mutated",
  })
  const postCursor = await createGoalWorktree({
    taskID,
    goalID: postCursorGoalID,
    runID: postCursorRun.id,
    baseRef: postCursorBaseRef,
    fileRelative: "goal-after.txt",
    nextBody: "goal-after-mutated",
  })

  updateGoalRun(existingRun.id, {
    status: "running",
    time_started: base + 15,
    workspace_dir: existing.info.directory,
    workspace_branch: existing.info.branch,
    workspace_base_ref: existing.baseRef,
  })
  updateGoalRun(postCursorRun.id, {
    status: "running",
    workspace_dir: postCursor.info.directory,
    workspace_branch: postCursor.info.branch,
    workspace_base_ref: postCursor.baseRef,
  })

  return {
    taskID,
    sessionID,
    primaryFile,
    existingGoalFile: existing.file,
    existingGoalWorktree: existing.info.directory,
    existingGoalRunID: existingRun.id,
    postCursorGoalWorktree: postCursor.info.directory,
    postCursorGoalRunID: postCursorRun.id,
    steps,
    cursorAfterSecondStep,
  }
}
