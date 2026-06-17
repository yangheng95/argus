import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "../../src/storage/db"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { WorkspaceTable } from "../../src/workspace/workspace.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function projectID(directory: string) {
  let id = ""
  await Instance.provide({
    directory,
    fn: async () => {
      id = Instance.project.id
    },
  })
  return id
}

async function seedWorkspace(input: { id: string; projectID: string; directory: string }) {
  await fs.mkdir(input.directory, { recursive: true })
  await fs.writeFile(path.join(input.directory, "sentinel.txt"), "preserve")
  Database.use((db) =>
    db
      .insert(WorkspaceTable)
      .values({
        id: input.id,
        project_id: input.projectID,
        branch: null,
        config: { type: "worktree", directory: input.directory },
      })
      .run(),
  )
}

function workspaceRow(id: string) {
  return Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
}

describe("experimental workspace routes", () => {
  afterEach(async () => {
    Server.resetProjectRoutesAppForTest()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("DELETE /experimental/workspace/:id is scoped to the active project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    const suffix = Math.random().toString(36).slice(2)
    const projectAID = await projectID(projectA.path)
    const projectBID = await projectID(projectB.path)
    const workspaceAID = Identifier.ascending("workspace")
    const workspaceBID = Identifier.ascending("workspace")
    const workspaceADir = path.join(projectA.path, "..", `workspace-a-${suffix}`)
    const workspaceBDir = path.join(projectB.path, "..", `workspace-b-${suffix}`)
    await seedWorkspace({ id: workspaceAID, projectID: projectAID, directory: workspaceADir })
    await seedWorkspace({ id: workspaceBID, projectID: projectBID, directory: workspaceBDir })

    const app = Server.App()
    const foreignDelete = await app.request(`/experimental/workspace/${workspaceBID}`, {
      method: "DELETE",
      headers: { "x-opencorvus-directory": projectA.path },
    })

    expect(foreignDelete.status).toBe(404)
    expect(workspaceRow(workspaceBID)).toBeDefined()
    expect(await fs.readFile(path.join(workspaceBDir, "sentinel.txt"), "utf8")).toBe("preserve")

    const missingDelete = await app.request(`/experimental/workspace/${Identifier.ascending("workspace")}`, {
      method: "DELETE",
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(missingDelete.status).toBe(404)

    const ownDelete = await app.request(`/experimental/workspace/${workspaceAID}`, {
      method: "DELETE",
      headers: { "x-opencorvus-directory": projectA.path },
    })

    expect(ownDelete.status).toBe(200)
    expect(workspaceRow(workspaceAID)).toBeUndefined()
    await expect(fs.stat(workspaceADir)).rejects.toMatchObject({ code: "ENOENT" })
    expect(workspaceRow(workspaceBID)).toBeDefined()
    expect(await fs.readFile(path.join(workspaceBDir, "sentinel.txt"), "utf8")).toBe("preserve")
  }, 30_000)
})
