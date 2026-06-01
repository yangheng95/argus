import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

const gitEnv = ["-c", "user.email=t@t.local", "-c", "user.name=test"] as const

describe("Worktree.mergeSafely", () => {
  test("returns merged instead of throwing on a clean publication", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-clean-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "feature.txt"), "feature\n")
    await $`git add feature.txt`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "feature"`.cwd(info.directory).quiet()

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("merged")
    if (outcome.status !== "merged") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.primaryBranch).toBe("master")
    expect(outcome.primaryHead).toMatch(/^[0-9a-f]{40}$/)
  })

  test("returns conflict and preserves MERGE_HEAD instead of throwing", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, "shared.txt"), "base\n")
    await $`git add shared.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-conflict-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "shared.txt"), "goal\n")
    await $`git add shared.txt`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "goal edit"`.cwd(info.directory).quiet()

    await fs.writeFile(path.join(tmp.path, "shared.txt"), "primary\n")
    await $`git add shared.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "primary edit"`.cwd(tmp.path).quiet()

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("conflict")
    if (outcome.status !== "conflict") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.conflictPaths).toEqual(["shared.txt"])
    const mergeHead = await $`git rev-parse --verify --quiet MERGE_HEAD`
      .quiet()
      .nothrow()
      .cwd(info.directory)
    expect(mergeHead.exitCode).toBe(0)
  })

  test("returns blocked with dirty paths instead of throwing", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "base\n")
    await $`git add tracked.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-dirty-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "tracked.txt"), "dirty\n")
    await fs.writeFile(path.join(info.directory, "new.txt"), "new\n")

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("blocked")
    if (outcome.status !== "blocked") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.reason).toContain("worktree is dirty")
    expect(outcome.dirtyPaths).toEqual(["M tracked.txt", "?? new.txt"])
  })

  test("ignores untracked evidence input views during publication", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-evidence-view-${Date.now().toString(36)}` }),
    })
    await fs.mkdir(path.join(info.directory, "web-clone-source"), { recursive: true })
    await fs.writeFile(path.join(info.directory, "web-clone-source", "README.md"), "evidence\n")
    await fs.writeFile(path.join(info.directory, "feature.ts"), "feature\n")
    await $`git add feature.ts`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "goal feature"`.cwd(info.directory).quiet()

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("merged")
    expect((await fs.readFile(path.join(tmp.path, "feature.ts"), "utf8")).replace(/\r\n/g, "\n")).toBe("feature\n")
    await expect(fs.stat(path.join(tmp.path, "web-clone-source", "README.md"))).rejects.toThrow()
  })

  test("blocks committed evidence input files from merge_back", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-evidence-committed-${Date.now().toString(36)}` }),
    })
    await fs.mkdir(path.join(info.directory, "web-clone-source"), { recursive: true })
    await fs.writeFile(path.join(info.directory, "web-clone-source", "README.md"), "must remain input\n")
    await $`git add web-clone-source/README.md`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "bad evidence commit"`.cwd(info.directory).quiet()

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("blocked")
    if (outcome.status !== "blocked") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.reason).toContain("refusing to merge committed frontend evidence input files")
    expect(outcome.reason).toContain("web-clone-source/README.md")
    await expect(fs.stat(path.join(tmp.path, "web-clone-source", "README.md"))).rejects.toThrow()
  })

  test("committed reference files are normal project files, not frontend evidence gates", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-references-committed-${Date.now().toString(36)}` }),
    })
    await fs.mkdir(path.join(info.directory, "references"), { recursive: true })
    await fs.writeFile(path.join(info.directory, "references", "screenshot.png"), "must remain input\n")
    await $`git add -f references/screenshot.png`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "bad staged reference commit"`.cwd(info.directory).quiet()

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("merged")
    expect((await fs.readFile(path.join(tmp.path, "references", "screenshot.png"), "utf8")).replace(/\r\n/g, "\n")).toBe("must remain input\n")
  })

  test("preserves dirty primary worktree changes before publishing goal branch", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, "kept.txt"), "base\n")
    await fs.writeFile(path.join(tmp.path, "removed.test.ts"), "obsolete\n")
    await $`git add kept.txt removed.test.ts`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-primary-dirty-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "feature.ts"), "feature\n")
    await $`git add feature.ts`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "goal feature"`.cwd(info.directory).quiet()

    await fs.rm(path.join(tmp.path, "removed.test.ts"))

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("merged")
    if (outcome.status !== "merged") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.primaryRecoveryCommit).toMatch(/^[0-9a-f]{40}$/)
    expect((await fs.readFile(path.join(tmp.path, "feature.ts"), "utf8")).replace(/\r\n/g, "\n")).toBe("feature\n")
    await expect(fs.stat(path.join(tmp.path, "removed.test.ts"))).rejects.toThrow()
    const status = (await $`git status --porcelain`.cwd(tmp.path).text()).trim()
    expect(status).toBe("")
    const recoveryMessage = (await $`git log --format=%s -1 ${outcome.primaryRecoveryCommit}`.cwd(tmp.path).text()).trim()
    expect(recoveryMessage).toBe("chore(opencorvus): preserve primary worktree changes before merge_back")
  })

  test("preserves dirty primary worktree without staging ignored evidence directories", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, ".gitignore"), "mirror/\n")
    await fs.writeFile(path.join(tmp.path, "kept.txt"), "base\n")
    await $`git add .gitignore kept.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-primary-ignored-evidence-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "feature.ts"), "feature\n")
    await $`git add feature.ts`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "goal feature"`.cwd(info.directory).quiet()

    await fs.writeFile(path.join(tmp.path, "kept.txt"), "primary dirty\n")
    await fs.mkdir(path.join(tmp.path, "mirror"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "mirror", "source.html"), "<html></html>\n")

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("merged")
    if (outcome.status !== "merged") throw new Error(`unexpected outcome ${outcome.status}`)
    expect((await fs.readFile(path.join(tmp.path, "feature.ts"), "utf8")).replace(/\r\n/g, "\n")).toBe("feature\n")
    expect((await fs.readFile(path.join(tmp.path, "kept.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe("primary dirty\n")
    expect((await fs.readFile(path.join(tmp.path, "mirror", "source.html"), "utf8")).replace(/\r\n/g, "\n")).toBe("<html></html>\n")
    const tracked = await $`git ls-files mirror`.cwd(tmp.path).text()
    expect(tracked.trim()).toBe("")
  })

  test("blocks host merge when goal worktree git linkage is missing", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, "seed.txt"), "seed\n")
    await $`git add seed.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-missing-git-${Date.now().toString(36)}` }),
    })
    await fs.rm(path.join(info.directory, ".git"), { force: true })
    await fs.rm(path.join(tmp.path, ".git", "worktrees", path.basename(info.directory)), { recursive: true, force: true })
    await fs.writeFile(path.join(info.directory, "ignored-by-primary.txt"), "must not affect primary\n")

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("blocked")
    if (outcome.status !== "blocked") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.reason).toContain("worktree git linkage is invalid")
    expect(await fs.stat(path.join(info.directory, "ignored-by-primary.txt"))).toBeTruthy()
    await expect(fs.stat(path.join(tmp.path, "ignored-by-primary.txt"))).rejects.toThrow()
    const primaryStatus = (await $`git status --porcelain`.cwd(tmp.path).text()).trim()
    expect(primaryStatus).toBe("")
  })
})
