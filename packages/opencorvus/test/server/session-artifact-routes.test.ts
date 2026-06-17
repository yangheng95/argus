import { afterEach, describe, expect, test } from "bun:test"
import { TaskPlan } from "../../src/memory/task-plan"
import { Scratchpad } from "../../src/memory/scratchpad"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function createSessionArtifacts(input: { title: string; todo: string; task: string; scratchpad: string }) {
  const session = await Session.create({ kind: "root", title: input.title })
  Todo.update({
    sessionID: session.id,
    todos: [{ content: input.todo, status: "pending", priority: "high" }],
  })
  TaskPlan.add({ sessionID: session.id, goal: input.task })
  Scratchpad.set(session.id, input.scratchpad)
  return session
}

describe("session artifact read routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test(
    "todo, task-plan, and scratchpad reads reject sessions outside the active project",
    async () => {
      await using one = await tmpdir({ git: true })
      await using two = await tmpdir({ git: true })
      const app = Server.App()
      let oneSessionID = ""
      let twoSessionID = ""

      await Instance.provide({
        directory: one.path,
        fn: async () => {
          const session = await createSessionArtifacts({
            title: "project-a-artifacts",
            todo: "project-a-todo-marker",
            task: "project-a-task-marker",
            scratchpad: "project-a-scratchpad-marker",
          })
          oneSessionID = session.id
        },
      })
      await Instance.provide({
        directory: two.path,
        fn: async () => {
          const session = await createSessionArtifacts({
            title: "project-b-artifacts",
            todo: "project-b-todo-secret",
            task: "project-b-task-secret",
            scratchpad: "project-b-scratchpad-secret",
          })
          twoSessionID = session.id
        },
      })

      const foreignTodo = await app.request(`/session/${twoSessionID}/todo`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(foreignTodo.status).toBe(404)
      expect(await foreignTodo.text()).not.toContain("project-b-todo-secret")

      const foreignTaskPlan = await app.request(`/experimental/task-plan?sessionId=${twoSessionID}`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(foreignTaskPlan.status).toBe(404)
      expect(await foreignTaskPlan.text()).not.toContain("project-b-task-secret")

      const foreignScratchpad = await app.request(`/experimental/scratchpad?sessionId=${twoSessionID}`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(foreignScratchpad.status).toBe(404)
      expect(await foreignScratchpad.text()).not.toContain("project-b-scratchpad-secret")

      const ownTodo = await app.request(`/session/${oneSessionID}/todo`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(ownTodo.status).toBe(200)
      expect(await ownTodo.json()).toEqual([
        { content: "project-a-todo-marker", status: "pending", priority: "high" },
      ])

      const ownTaskPlan = await app.request(`/experimental/task-plan?sessionId=${oneSessionID}`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(ownTaskPlan.status).toBe(200)
      const ownTaskPlanBody = (await ownTaskPlan.json()) as Array<{ goal: string }>
      expect(ownTaskPlanBody.map((task) => task.goal)).toContain("project-a-task-marker")

      const ownScratchpad = await app.request(`/experimental/scratchpad?sessionId=${oneSessionID}`, {
        headers: { "x-opencorvus-directory": one.path },
      })
      expect(ownScratchpad.status).toBe(200)
      expect(await ownScratchpad.json()).toEqual({ content: "project-a-scratchpad-marker" })
    },
    30_000,
  )
})
