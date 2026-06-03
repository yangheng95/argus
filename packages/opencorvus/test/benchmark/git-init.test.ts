import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { standaloneGitEnvForProject } from "../../script/benchmark/git"

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("benchmark git init creates an isolated repo inside a parent worktree", async () => {
  const repoRoot = path.resolve(import.meta.dir, "../../../..")
  const dir = path.join(repoRoot, ".scratch", `nested-benchmark-git-${Date.now()}`)
  created.push(dir)
  await fs.mkdir(dir, { recursive: true })

  const proc = Bun.spawn(["git", "init"], {
    cwd: dir,
    env: standaloneGitEnvForProject(dir),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ])

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  expect(await fs.stat(path.join(dir, ".git")).then((stat) => stat.isDirectory()).catch(() => false)).toBe(true)

  const topProc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd: dir,
    env: standaloneGitEnvForProject(dir),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [topExit, top] = await Promise.all([
    topProc.exited,
    new Response(topProc.stdout).text(),
  ])
  expect(topExit).toBe(0)
  expect(path.resolve(top.trim())).toBe(dir)
})
