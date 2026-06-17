import { afterEach, describe, expect, test } from "bun:test"
import { Memory } from "../../src/memory"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("panel memory routes", () => {
  afterEach(async () => {
    Server.resetProjectRoutesAppForTest()
    await resetDatabase()
  })

  test(
    "get and delete only access memory owned by the active project",
    async () => {
      await using projectA = await tmpdir({ git: true })
      await using projectB = await tmpdir({ git: true })
      const app = Server.App()
      let projectAFileID = ""
      let projectBFileID = ""

      await Instance.provide({
        directory: projectA.path,
        fn: async () => {
          projectAFileID = Memory.captureEpisode({
            title: "Project A public note",
            content: "## Note\n- Project A visible memory.",
            source: "manual",
            projectId: Instance.project.id,
            scope: "global",
          }).episode.id
        },
      })

      await Instance.provide({
        directory: projectB.path,
        fn: async () => {
          projectBFileID = Memory.captureEpisode({
            title: "Project B private note",
            content: "## Private\n- Project B private memory.",
            source: "manual",
            projectId: Instance.project.id,
            scope: "global",
          }).episode.id
        },
      })

      const own = await app.request(`/panel/knowledge/memory/${projectAFileID}`, {
        headers: { "x-opencorvus-directory": projectA.path },
      })
      expect(own.status).toBe(200)
      const ownBody = (await own.json()) as { content: string; file: { id: string } }
      expect(ownBody.file.id).toBe(projectAFileID)
      expect(ownBody.content).toContain("Project A visible memory")

      const foreignGet = await app.request(`/panel/knowledge/memory/${projectBFileID}`, {
        headers: { "x-opencorvus-directory": projectA.path },
      })
      expect(foreignGet.status).toBe(404)

      const foreignDelete = await app.request(`/panel/knowledge/memory/${projectBFileID}`, {
        method: "DELETE",
        headers: { "x-opencorvus-directory": projectA.path },
      })
      expect(foreignDelete.status).toBe(404)

      const ownDelete = await app.request(`/panel/knowledge/memory/${projectAFileID}`, {
        method: "DELETE",
        headers: { "x-opencorvus-directory": projectA.path },
      })
      expect(ownDelete.status).toBe(200)

      await Instance.provide({
        directory: projectA.path,
        fn: async () => {
          const projectId = Instance.project.id
          expect(Memory.getFileInProject({ fileId: projectAFileID, projectId })).toBeNull()
          const search = Memory.search({
            query: "project a visible memory",
            projectId,
            limit: 5,
          })
          expect(search.some((r) => r.fileId === projectAFileID)).toBe(false)
        },
      })

      await Instance.provide({
        directory: projectB.path,
        fn: async () => {
          const projectId = Instance.project.id
          expect(Memory.getFileInProject({ fileId: projectBFileID, projectId })?.title).toBe("Project B private note")
          expect(Memory.getChunksInProject({ fileId: projectBFileID, projectId }).length).toBeGreaterThan(0)
          const search = Memory.search({
            query: "project b private memory",
            projectId,
            limit: 5,
          })
          expect(search.some((r) => r.fileId === projectBFileID)).toBe(true)
        },
      })
    },
    30_000,
  )
})
