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
