import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { ensureGitignore } from "../../src/engine/git"
import { tmpdir } from "../fixture/fixture"

async function gitTracked(dir: string, target: string) {
  const res = await $`git ls-files --error-unmatch -- ${target}`.cwd(dir).quiet().nothrow()
  return res.exitCode === 0
}

async function commit(dir: string, files: string[], message: string) {
  for (const rel of files) await $`git add -- ${rel}`.cwd(dir).quiet()
  await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m ${message}`.cwd(dir).quiet()
}

describe("ensureGitignore", () => {
  test("writes opencorvus scratch entries when .gitignore is absent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const body = await fs.readFile(path.join(tmp.path, ".gitignore"), "utf8")
        expect(body).toContain(".opencorvus/")
        expect(body).toContain(".opencorvus-meta.json")
        expect(body).toContain(".opencorvus-worktrees/")
      },
    })
  })

  test("appends missing opencorvus entries into an existing .gitignore", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, ".gitignore"), "node_modules/\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const body = await fs.readFile(path.join(tmp.path, ".gitignore"), "utf8")
        expect(body).toContain("node_modules/")
        expect(body).toContain(".opencorvus/")
        expect(body).toContain(".opencorvus-meta.json")
      },
    })
  })

  test("seeds the first HEAD commit on a fresh `git init` repo (no prior commits)", async () => {
    // 2026-04-30 — the seed `git commit --only -- .gitignore -m "..."` had
    // its `-m`/subject placed AFTER `--`, so git parsed both as pathspecs
    // and the commit silently failed on every fresh greenfield project.
    // HEAD stayed unset, and `Worktree.create` then died for every build
    // goal with `WorktreeCreateFailedError` (observed on the gemini chat
    // task 2026-04-29). Regression test pins the contract: "ensureGitignore
    // returning on a fresh repo means HEAD has the .gitignore committed".
    const dirpath = path.join((await import("os")).tmpdir(), "opencorvus-test-fresh-" + Math.random().toString(36).slice(2))
    await fs.mkdir(dirpath, { recursive: true })
    await $`git init`.cwd(dirpath).quiet()
    // explicitly NOT creating a root commit — this is the greenfield case

    await Instance.provide({
      directory: dirpath,
      fn: async () => {
        await ensureGitignore()
      },
    })

    const head = await $`git rev-parse --verify HEAD`.cwd(dirpath).quiet().nothrow()
    expect(head.exitCode).toBe(0)
    const headTree = await $`git ls-tree --name-only HEAD`.cwd(dirpath).quiet()
    expect(headTree.stdout.toString()).toContain(".gitignore")
  })

  test("untracks .opencorvus-meta.json that was committed before the ignore existed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, ".opencorvus-meta.json"), `{"goalID":"stale"}`)
    await fs.mkdir(path.join(tmp.path, ".opencorvus", "intent"), { recursive: true })
    await Bun.write(path.join(tmp.path, ".opencorvus", "intent", "request.md"), "leak\n")
    await commit(tmp.path, [".opencorvus-meta.json", ".opencorvus/intent/request.md"], "leak scratch")

    expect(await gitTracked(tmp.path, ".opencorvus-meta.json")).toBe(true)
    expect(await gitTracked(tmp.path, ".opencorvus/intent/request.md")).toBe(true)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
      },
    })

    expect(await gitTracked(tmp.path, ".opencorvus-meta.json")).toBe(false)
    expect(await gitTracked(tmp.path, ".opencorvus/intent/request.md")).toBe(false)

    // Working tree copies must remain — untracking is a metadata operation,
    // not a filesystem delete. Goal executors still need to read them.
    const meta = await fs.readFile(path.join(tmp.path, ".opencorvus-meta.json"), "utf8")
    expect(meta).toContain("stale")
    const intent = await fs.readFile(path.join(tmp.path, ".opencorvus", "intent", "request.md"), "utf8")
    expect(intent).toContain("leak")
  })
})
