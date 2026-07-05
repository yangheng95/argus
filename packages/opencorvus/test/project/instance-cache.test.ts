import { afterEach, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

test("refreshes a cached directory project when the directory becomes a git repository", async () => {
  await using tmp = await tmpdir()
  let initialProjectID = ""

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      initialProjectID = Instance.project.id
      expect(Instance.project.id).toBe(Project.directoryProjectID(tmp.path))
      expect(Instance.project.id).not.toBe("global")
      expect(Instance.worktree).toBe(tmp.path)
    },
  })

  await $`git init`.cwd(tmp.path).quiet()

  await Instance.provide({
    directory: tmp.path,
    async fn() {
      expect(Instance.project.id).not.toBe("global")
      expect(Instance.project.id).toBe(initialProjectID)
      expect(Instance.directory).toBe(tmp.path)
      expect(Instance.worktree).toBe(tmp.path)
      expect(Instance.project.worktree).toBe(tmp.path)

      const info = await Worktree.create({ name: "stale-cache-smoke" })
      try {
        expect(info.directory).toContain(".opencorvus")
        expect(info.directory).not.toBe("/")
      } finally {
        await Worktree.remove({ directory: info.directory })
      }
    },
  })
}, 15_000)

test("refreshes a cached git directory project when the git directory disappears", async () => {
  await using tmp = await tmpdir({ git: true })
  let initialProjectID = ""

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      initialProjectID = Instance.project.id
      expect(Instance.current()?.git).toBe(true)
    },
  })

  await fs.rm(`${tmp.path}/.git`, { recursive: true, force: true })

  await Instance.provide({
    directory: tmp.path,
    fn() {
      expect(Instance.project.id).toBe(initialProjectID)
      expect(Instance.directory).toBe(tmp.path)
      expect(Instance.worktree).toBe(tmp.path)
      expect(Instance.project.worktree).toBe(tmp.path)
      expect(Instance.current()?.git).toBe(false)
    },
  })
}, 15_000)

test("runs a late init once for an already cached directory instance", async () => {
  await using tmp = await tmpdir({ git: true })
  let initCalls = 0
  const init = async () => {
    initCalls += 1
  }

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      expect(Instance.directory).toBe(tmp.path)
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init,
    fn: () => {
      expect(initCalls).toBe(1)
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init,
    fn: () => {
      expect(initCalls).toBe(1)
    },
  })
})

test("reuses one Windows instance for casing variants without canonicalizing the visible path", async () => {
  if (process.platform !== "win32") return

  await using tmp = await tmpdir({ git: true })
  const firstSpelling = tmp.path.toLowerCase()
  const secondSpelling = tmp.path.toUpperCase()
  let initCalls = 0
  const init = async () => {
    initCalls += 1
  }

  await Instance.provide({
    directory: firstSpelling,
    init,
    fn: () => {
      expect(Instance.directory).toBe(firstSpelling)
      expect(initCalls).toBe(1)
    },
  })

  await Instance.provide({
    directory: secondSpelling,
    init,
    fn: () => {
      expect(Instance.directory).toBe(firstSpelling)
      expect(initCalls).toBe(1)
    },
  })
})
