import path from "path"
import { mkdir, readdir } from "fs/promises"
import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const originalProjectDir = process.env.OPENCORVUS_PROJECT_DIR
const originalCwd = process.cwd()

describe("global project discovery", () => {
  afterEach(() => {
    if (originalProjectDir === undefined) delete process.env.OPENCORVUS_PROJECT_DIR
    else process.env.OPENCORVUS_PROJECT_DIR = originalProjectDir
    process.chdir(originalCwd)
  })

  test("GET /global/projects/discover scans explicit launch root and uses it as default directory", async () => {
    await using root = await tmpdir()
    const nested = path.join(root.path, "nested-project")
    const plain = path.join(root.path, "plain-folder")
    await mkdir(path.join(root.path, ".opencorvus"), { recursive: true })
    await mkdir(path.join(nested, ".opencorvus"), { recursive: true })
    await mkdir(path.join(plain, "src"), { recursive: true })
    process.env.OPENCORVUS_PROJECT_DIR = root.path

    const response = await Server.App().request("/global/projects/discover")

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      root: string
      defaultDirectory: string
      projects: Array<{ directory: string; name: string; marker: string }>
    }
    expect(path.resolve(body.root)).toBe(path.resolve(root.path))
    expect(path.resolve(body.defaultDirectory)).toBe(path.resolve(root.path))
    expect(body.projects.map((project) => path.resolve(project.directory)).sort()).toEqual(
      [root.path, nested].map((item) => path.resolve(item)).sort(),
    )
    expect(body.projects.find((project) => path.resolve(project.directory) === path.resolve(plain))).toBeUndefined()
    expect(body.projects.every((project) => path.basename(project.marker) === ".opencorvus")).toBe(true)
  })

  test("GET /global/projects/discover is read-only when no project dir is passed", async () => {
    await using root = await tmpdir()
    const nested = path.join(root.path, "nested-project")
    await mkdir(path.join(nested, ".opencorvus"), { recursive: true })
    delete process.env.OPENCORVUS_PROJECT_DIR
    process.chdir(root.path)

    const first = await Server.App().request("/global/projects/discover")
    const second = await Server.App().request("/global/projects/discover")

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const body = (await first.json()) as {
      root: string
      defaultDirectory: string
      projects: Array<{ directory: string; name: string; marker: string }>
    }
    const secondBody = (await second.json()) as { defaultDirectory: string }
    expect(path.resolve(body.root)).toBe(path.resolve(root.path))
    expect(body.defaultDirectory).toBe("")
    expect(secondBody.defaultDirectory).toBe("")
    const children = await readdir(root.path, { withFileTypes: true })
    expect(children.some((entry) => entry.isDirectory() && /^[0-9a-f]{8}$/.test(entry.name))).toBe(false)
    expect(body.projects.map((project) => path.resolve(project.directory))).toEqual([path.resolve(nested)])
  })
})
