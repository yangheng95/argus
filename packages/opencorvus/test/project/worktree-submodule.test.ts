import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

const gitEnv = ["-c", "user.email=t@t.local", "-c", "user.name=test"] as const

async function createParentWithLocalSubmodule(root: string) {
  const child = path.join(root, "child")
  const parent = path.join(root, "parent")
  await fs.mkdir(child, { recursive: true })
  await fs.mkdir(parent, { recursive: true })

  await $`git init`.cwd(child).quiet()
  await fs.writeFile(path.join(child, "nested.txt"), "submodule payload\n")
  await $`git add nested.txt`.cwd(child).quiet()
  await $`git ${gitEnv} commit -m "child seed"`.cwd(child).quiet()

  await $`git init`.cwd(parent).quiet()
  await fs.writeFile(path.join(parent, "root.txt"), "root\n")
  await $`git add root.txt`.cwd(parent).quiet()
  await $`git ${gitEnv} commit -m "parent seed"`.cwd(parent).quiet()
  await $`git -c protocol.file.allow=always submodule add ${child} vendor/child`.cwd(parent).quiet()
  await $`git ${gitEnv} commit -m "add submodule"`.cwd(parent).quiet()

  return { child, parent }
}

async function removeGitmodules(parent: string) {
  await fs.rm(path.join(parent, ".gitmodules"), { force: true })
  await $`git add -u .gitmodules`.cwd(parent).quiet()
  await $`git ${gitEnv} commit -m "drop gitmodules"`.cwd(parent).quiet()
}

describe("Worktree.create submodules", () => {
  test("initializes committed submodule contents in the created worktree", async () => {
    await using tmp = await tmpdir()
    const { parent } = await createParentWithLocalSubmodule(tmp.path)

    const info = await Instance.provide({
      directory: parent,
      fn: () => Worktree.create({ name: `submodule-${Date.now().toString(36)}` }),
    })

    const content = await fs.readFile(path.join(info.directory, "vendor", "child", "nested.txt"), "utf8")
    expect(content.replace(/\r\n/g, "\n")).toBe("submodule payload\n")
    expect((await $`git submodule status --recursive`.cwd(info.directory).text()).trim()).toMatch(
      /^[0-9a-f]{40} vendor\/child/,
    )
  }, 30_000)

  test("fails loud and cleans up when submodule initialization fails", async () => {
    await using tmp = await tmpdir()
    const { child, parent } = await createParentWithLocalSubmodule(tmp.path)
    await fs.rm(path.join(parent, ".git", "modules", "vendor", "child"), { recursive: true, force: true })
    await fs.rm(child, { recursive: true, force: true })

    const name = `broken-submodule-${Date.now().toString(36)}`
    const directory = path.join(parent, ".opencorvus", "worktrees", name)
    await expect(
      Instance.provide({
        directory: parent,
        fn: () => Worktree.create({ name }),
      }),
    ).rejects.toThrow("WorktreeCreateFailedError")
    await expect(fs.stat(directory)).rejects.toThrow()
  }, 30_000)

  test("materializes url-less gitlinks from the primary checkout", async () => {
    await using tmp = await tmpdir()
    const { parent } = await createParentWithLocalSubmodule(tmp.path)
    await removeGitmodules(parent)

    const info = await Instance.provide({
      directory: parent,
      fn: () => Worktree.create({ name: `local-gitlink-${Date.now().toString(36)}` }),
    })

    const content = await fs.readFile(path.join(info.directory, "vendor", "child", "nested.txt"), "utf8")
    expect(content.replace(/\r\n/g, "\n")).toBe("submodule payload\n")
    expect(
      (await $`git rev-parse --is-inside-work-tree`.cwd(path.join(info.directory, "vendor", "child")).text()).trim(),
    ).toBe("true")
  }, 30_000)

  test("reset rematerializes url-less gitlinks from the primary checkout", async () => {
    await using tmp = await tmpdir()
    const { parent } = await createParentWithLocalSubmodule(tmp.path)
    await removeGitmodules(parent)

    const info = await Instance.provide({
      directory: parent,
      fn: () => Worktree.create({ name: `reset-local-gitlink-${Date.now().toString(36)}` }),
    })
    const nestedFile = path.join(info.directory, "vendor", "child", "nested.txt")
    await fs.writeFile(nestedFile, "dirty nested checkout\n")

    await Instance.provide({
      directory: parent,
      fn: () => Worktree.reset({ directory: info.directory }),
    })

    const content = await fs.readFile(nestedFile, "utf8")
    expect(content.replace(/\r\n/g, "\n")).toBe("submodule payload\n")
  }, 30_000)
})
