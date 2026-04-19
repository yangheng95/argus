import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

async function projectIDFor(directory: string) {
  return Instance.provide({
    directory,
    fn: () => Instance.project.id,
  })
}

describe("Worktree lifecycle", () => {
  test("create returns only after startup scripts complete", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    await Project.update({
      projectID,
      commands: {
        start: "echo ready> startup-ready.txt",
      },
    })

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `startup-ready-${Date.now().toString(36)}` }),
    })

    const startupFile = path.join(info.directory, "startup-ready.txt")
    expect(await Filesystem.exists(startupFile)).toBe(true)
    expect((await Filesystem.readText(startupFile)).trim()).toBe("ready")
  })

  test("create fails loud and cleans up when startup scripts fail", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const name = `start-fail-${Date.now().toString(36)}`
    const directory = path.join(tmp.path, ".opencorvus", "worktrees", name)
    const branch = `opencorvus/${name}`

    await Project.update({
      projectID,
      commands: {
        start: "opencorvus-command-that-does-not-exist",
      },
    })

    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.create({ name }),
      }),
    ).rejects.toMatchObject({
      name: "WorktreeStartCommandFailedError",
      data: {
        message: expect.stringMatching(/startup scripts failed/i),
      },
    })

    expect(await Filesystem.exists(directory)).toBe(false)
    const ref = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(tmp.path).quiet().nothrow()
    expect(ref.exitCode).not.toBe(0)
    expect(Project.get(projectID)?.sandboxes).not.toContain(directory)
  })

  test("create does not share root node_modules into the worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const rootNodeModules = path.join(tmp.path, "node_modules")
    await fs.mkdir(rootNodeModules, { recursive: true })
    await Bun.write(path.join(rootNodeModules, "marker.txt"), "root")

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `no-node-modules-link-${Date.now().toString(36)}` }),
    })

    expect(await Filesystem.exists(path.join(info.directory, "node_modules"))).toBe(false)
  })

  test("reset fails when startup scripts fail", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    await Project.update({
      projectID,
      commands: {
        start: "echo ready> startup-ready.txt",
      },
    })

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `reset-start-fail-${Date.now().toString(36)}` }),
    })

    await Project.update({
      projectID,
      commands: {
        start: "opencorvus-command-that-does-not-exist",
      },
    })

    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.reset({ directory: info.directory }),
      }),
    ).rejects.toMatchObject({
      name: "WorktreeStartCommandFailedError",
      data: {
        message: expect.stringMatching(/startup scripts failed/i),
      },
    })
  })
})
