import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Config } from "../../src/config/config"
import { SkillManager } from "../../src/skill/manager"
import { tmpdir } from "../fixture/fixture"

type Sentinels = {
  root: string
  parent: string
}

const unsafeGitSources = [".", "..", "---", ".git", "git://", "https://.git"]

async function withPortableHome<T>(home: string, fn: () => Promise<T>) {
  const previousHome = process.env.OPENCORVUS_HOME
  process.env.OPENCORVUS_HOME = home
  Config.global.reset()
  try {
    return await fn()
  } finally {
    if (previousHome === undefined) delete process.env.OPENCORVUS_HOME
    else process.env.OPENCORVUS_HOME = previousHome
    Config.global.reset()
  }
}

async function withFakeGit<T>(root: string, fn: (marker: string) => Promise<T>) {
  const bin = path.join(root, "fake-bin")
  const marker = path.join(root, "git-called.txt")
  await fs.mkdir(bin, { recursive: true })
  const cmd = path.join(bin, "git.cmd")
  const sh = path.join(bin, "git")
  await fs.writeFile(cmd, `@echo off\r\necho called > "${marker}"\r\nexit /b 42\r\n`)
  await fs.writeFile(sh, `#!/bin/sh\necho called > "${marker}"\nexit 42\n`)
  await fs.chmod(sh, 0o755)

  const previousPath = process.env.PATH
  const previousPathext = process.env.PATHEXT
  process.env.PATH = [bin, previousPath].filter((item): item is string => Boolean(item)).join(path.delimiter)
  process.env.PATHEXT = [".CMD", ".EXE", ".BAT", ".COM", previousPathext]
    .filter((item): item is string => Boolean(item))
    .join(";")
  try {
    return await fn(marker)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousPathext === undefined) delete process.env.PATHEXT
    else process.env.PATHEXT = previousPathext
  }
}

async function createManagedRootSentinels(): Promise<Sentinels> {
  const managedRoot = SkillManager.managedRoot()
  const parent = path.dirname(managedRoot)
  const sentinels = {
    root: path.join(managedRoot, "root-sentinel.txt"),
    parent: path.join(parent, "parent-sentinel.txt"),
  }
  await fs.mkdir(managedRoot, { recursive: true })
  await fs.writeFile(sentinels.root, "root")
  await fs.writeFile(sentinels.parent, "parent")
  return sentinels
}

async function expectSentinelsRemain(sentinels: Sentinels) {
  expect(await fs.readFile(sentinels.root, "utf8")).toBe("root")
  expect(await fs.readFile(sentinels.parent, "utf8")).toBe("parent")
}

async function rejectionOf(task: Promise<unknown>) {
  try {
    await task
    return undefined
  } catch (error) {
    return error
  }
}

describe("SkillManager managed git sources", () => {
  for (const source of unsafeGitSources) {
    test(`rejects unsafe git install slug ${source} without deleting managed directories`, async () => {
      await using tmp = await tmpdir({ git: true })
      await withPortableHome(path.join(tmp.path, "home"), async () => {
        await withFakeGit(tmp.path, async (gitMarker) => {
          const sentinels = await createManagedRootSentinels()
          const error = await rejectionOf(SkillManager.install({ kind: "git", value: source }))

          await expectSentinelsRemain(sentinels)
          await expect(fs.readFile(gitMarker, "utf8")).rejects.toThrow()
          expect(error).toBeInstanceOf(Error)
          expect((error as Error).message).toContain("Invalid git skill source slug")
        })
      })
    })
  }

  for (const source of unsafeGitSources) {
    test(`rejects unsafe git remove slug ${source} without deleting managed directories`, async () => {
      await using tmp = await tmpdir({ git: true })
      await withPortableHome(path.join(tmp.path, "home"), async () => {
        const sentinels = await createManagedRootSentinels()
        const error = await rejectionOf(SkillManager.remove({ kind: "git", source }))

        await expectSentinelsRemain(sentinels)
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain("Invalid git skill source slug")
      })
    })
  }
})
