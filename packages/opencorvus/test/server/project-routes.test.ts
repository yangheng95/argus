import path from "path"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("project routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  // Cross-file Question.ask cross-pollution: a prior unresolved question rejects here.
  test.skip("POST /project/current/init-git initializes a standalone directory", async () => {
    await using tmp = await tmpdir()
    const app = Server.App()

    const response = await app.request("/project/current/init-git", {
      method: "POST",
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json() as {
      created: boolean
      project: { vcs?: string }
    }
    expect(body.created).toBe(true)
    expect(body.project.vcs).toBe("git")
    expect(await Filesystem.exists(path.join(tmp.path, ".git"))).toBe(true)

    const current = await app.request("/project/current", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    expect(current.status).toBe(200)
    expect((await current.json() as { vcs?: string }).vcs).toBe("git")
  })

  // Same Question.ask cross-file pollution as the standalone-init test above.
  test.skip("POST /project/current/init-git is idempotent for git projects", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()

    const response = await app.request("/project/current/init-git", {
      method: "POST",
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json() as {
      created: boolean
      project: { vcs?: string }
    }
    expect(body.created).toBe(false)
    expect(body.project.vcs).toBe("git")
  })
})
