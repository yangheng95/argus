import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { stripNestedGitDirs, createGoalDeliveryCommit } from "../../src/goal/runner"
import { Instance } from "../../src/project/instance"

async function mktmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function initGitRepo(dir: string): Promise<void> {
  await $`git -c init.defaultBranch=main init`.quiet().cwd(dir)
  await $`git config user.email test@local`.quiet().cwd(dir)
  await $`git config user.name Test`.quiet().cwd(dir)
  await fs.writeFile(path.join(dir, "README.md"), "seed\n")
  await $`git add README.md`.quiet().cwd(dir)
  await $`git commit -m initial`.quiet().cwd(dir)
}

describe("stripNestedGitDirs", () => {
  let root: string
  beforeAll(async () => {
    root = await mktmp("strip-nested-git-")
    // Root .git (must be preserved)
    await initGitRepo(root)
    // Nested scaffolded project with its own .git
    const nested = path.join(root, "my-app")
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(path.join(nested, "package.json"), `{"name":"my-app"}\n`)
    await fs.mkdir(path.join(nested, ".git"), { recursive: true })
    await fs.writeFile(path.join(nested, ".git", "HEAD"), "ref: refs/heads/main\n")
    await fs.writeFile(path.join(nested, ".git", "config"), "[core]\n")
    // Deeper nested .git
    const deeper = path.join(root, "packages", "lib")
    await fs.mkdir(deeper, { recursive: true })
    await fs.mkdir(path.join(deeper, ".git"), { recursive: true })
    await fs.writeFile(path.join(deeper, ".git", "HEAD"), "ref: refs/heads/main\n")
    // node_modules with fake .git — must NOT be walked (perf guard)
    const nm = path.join(root, "node_modules", "fake-pkg")
    await fs.mkdir(nm, { recursive: true })
    await fs.mkdir(path.join(nm, ".git"), { recursive: true })
  })
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  test("removes nested .git dirs but preserves root .git and skips node_modules", async () => {
    const stripped = await stripNestedGitDirs(root)
    expect(stripped.sort()).toEqual(["my-app/.git", "packages/lib/.git"])
    // Root .git preserved
    const rootGit = await fs.stat(path.join(root, ".git"))
    expect(rootGit.isDirectory()).toBe(true)
    // Nested .git gone
    await expect(fs.stat(path.join(root, "my-app", ".git"))).rejects.toThrow()
    await expect(fs.stat(path.join(root, "packages", "lib", ".git"))).rejects.toThrow()
    // Nested content retained
    const pkg = await fs.readFile(path.join(root, "my-app", "package.json"), "utf8")
    expect(pkg).toContain("my-app")
    // node_modules .git untouched (not walked)
    const nmGit = await fs.stat(path.join(root, "node_modules", "fake-pkg", ".git"))
    expect(nmGit.isDirectory()).toBe(true)
  })
})

async function scaffoldNestedRepo(root: string, name: string): Promise<void> {
  const nested = path.join(root, name)
  await fs.mkdir(nested, { recursive: true })
  await fs.writeFile(path.join(nested, "package.json"), `{"name":"${name}"}\n`)
  await fs.writeFile(path.join(nested, "index.ts"), `export const n = "${name}"\n`)
  await $`git -c init.defaultBranch=main init`.quiet().cwd(nested)
  await $`git config user.email test@local`.quiet().cwd(nested)
  await $`git config user.name Test`.quiet().cwd(nested)
  await $`git add -A`.quiet().cwd(nested)
  await $`git commit -m scaffolded`.quiet().cwd(nested)
}

describe("createGoalDeliveryCommit gitlink guard", () => {
  test("throws when staged entry is a gitlink (nested .git not stripped)", async () => {
    const root = await mktmp("gitlink-guard-a-")
    try {
      await initGitRepo(root)
      await scaffoldNestedRepo(root, "my-app")
      await Instance.provide({
        directory: root,
        fn: async () => {
          await expect(
            createGoalDeliveryCommit([{ file: "my-app", status: "added" }], "Goal TESTGITL"),
          ).rejects.toThrow(/submodule pointer/)
        },
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("succeeds after stripNestedGitDirs removes the nested .git", async () => {
    const root = await mktmp("gitlink-guard-b-")
    try {
      await initGitRepo(root)
      await scaffoldNestedRepo(root, "my-app")
      await Instance.provide({
        directory: root,
        fn: async () => {
          await stripNestedGitDirs(root)
          const commitRef = await createGoalDeliveryCommit(
            [{ file: "my-app", status: "added" }],
            "Goal TESTGITL2",
          )
          expect(commitRef).toMatch(/^[0-9a-f]{40}$/)
          const tree = (await $`git ls-tree -r ${commitRef}`.quiet().cwd(root).text()).trim()
          expect(tree).not.toMatch(/^160000/m)
          expect(tree).toMatch(/my-app\/package\.json/)
          expect(tree).toMatch(/my-app\/index\.ts/)
        },
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
