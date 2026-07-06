import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { ensureGitignore } from "../../src/engine/git"
import { InternalGitCommitSubject } from "../../src/engine/internal-git-commit-subject"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { tmpdir } from "../fixture/fixture"

async function gitTracked(dir: string, target: string) {
  const res = await $`git ls-files --error-unmatch -- ${target}`.cwd(dir).quiet().nothrow()
  return res.exitCode === 0
}

async function gitIgnoredNoIndex(dir: string, target: string) {
  const res = await $`git check-ignore -v --no-index -- ${target}`.cwd(dir).quiet().nothrow()
  const output = res.stdout.toString().trim()
  const lastMatch = output.split(/\r?\n/).filter(Boolean).at(-1)
  if (!lastMatch) return false
  const pattern = lastMatch.match(/^[^:]+:\d+:(.*?)\t/)?.[1]
  return pattern ? !pattern.startsWith("!") : false
}

async function commit(dir: string, files: string[], message: string) {
  for (const rel of files) await $`git add -- ${rel}`.cwd(dir).quiet()
  await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m ${message}`.cwd(dir).quiet()
}

async function installStrictMaintenanceCommitHook(dir: string) {
  const hookDir = path.join(dir, ".husky")
  await fs.mkdir(hookDir, { recursive: true })
  await fs.writeFile(
    path.join(hookDir, "commit-msg"),
    [
      "#!/bin/sh",
      "subject=$(sed -n '1p' \"$1\")",
      "root=$(git rev-parse --show-toplevel)",
      'printf \'%s\\n\' "$subject" >> "$root/.hook-subjects"',
      'case "$subject" in',
      "  'chore seed baseline .gitignore') exit 0 ;;",
      "  'chore untrack opencorvus ignored paths') exit 0 ;;",
      "  chore\\(*|chore:*) exit 1 ;;",
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
    "utf8",
  )
  await fs.chmod(path.join(hookDir, "commit-msg"), 0o755)
  await $`git config core.hooksPath .husky`.cwd(dir).quiet()
}

describe("ensureGitignore", () => {
  test("writes opencorvus scratch entries when .gitignore is absent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const body = await fs.readFile(path.join(tmp.path, ".gitignore"), "utf8")
        expect(body).toContain(".opencorvus/r/")
        expect(body).toContain(".opencorvus/runtime/")
        expect(body).toContain("!.opencorvus/expert-squads/**/agents/build/")
        expect(body).toContain("!.opencorvus/expert-squads/**/agents/build/**")
        expect(body).not.toMatch(/(^|\n)\.opencorvus\/(\r?\n|$)/)
        expect(body).toContain(".opencorvus-meta.json")
        expect(body).toContain(".opencorvus-worktrees/")
        expect(body).toContain("/artifacts/")
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
        expect(body).toContain(".opencorvus/r/")
        expect(body).toContain(".opencorvus/runtime/")
        expect(body).toContain("!.opencorvus/expert-squads/**/agents/build/")
        expect(body).toContain("!.opencorvus/expert-squads/**/agents/build/**")
        expect(body).not.toMatch(/(^|\n)\.opencorvus\/(\r?\n|$)/)
        expect(body).toContain(".opencorvus-meta.json")
        expect(body).toContain("/artifacts/")
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
    const dirpath = path.join(
      (await import("os")).tmpdir(),
      "opencorvus-test-fresh-" + Math.random().toString(36).slice(2),
    )
    await fs.mkdir(dirpath, { recursive: true })
    await $`git init`.cwd(dirpath).quiet()
    await installStrictMaintenanceCommitHook(dirpath)
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
    const subject = (await $`git log --format=%s -1 HEAD`.cwd(dirpath).text()).trim()
    expect(subject).toBe(InternalGitCommitSubject.seedGitignore)
    const hookSubjects = await fs.readFile(path.join(dirpath, ".hook-subjects"), "utf8")
    expect(hookSubjects.trim()).toBe(InternalGitCommitSubject.seedGitignore)
  })

  test("untracks opencorvus runtime paths and root artifacts committed before the ignore existed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, ".opencorvus-meta.json"), `{"goalID":"stale"}`)
    const runtimeIntent = ProjectRuntimePaths.intentPaths("", "tsk_git_ignore").relative
    const staticConfig = ".opencorvus/agents/demo.md"
    const visualArtifact = "artifacts/reference.png"
    await fs.mkdir(path.dirname(path.join(tmp.path, runtimeIntent)), { recursive: true })
    await fs.mkdir(path.dirname(path.join(tmp.path, staticConfig)), { recursive: true })
    await fs.mkdir(path.dirname(path.join(tmp.path, visualArtifact)), { recursive: true })
    await Bun.write(path.join(tmp.path, runtimeIntent), "leak\n")
    await Bun.write(path.join(tmp.path, staticConfig), "static config\n")
    await Bun.write(path.join(tmp.path, visualArtifact), "png bytes\n")
    await commit(tmp.path, [".opencorvus-meta.json", runtimeIntent, staticConfig, visualArtifact], "leak scratch")
    await installStrictMaintenanceCommitHook(tmp.path)

    expect(await gitTracked(tmp.path, ".opencorvus-meta.json")).toBe(true)
    expect(await gitTracked(tmp.path, runtimeIntent)).toBe(true)
    expect(await gitTracked(tmp.path, staticConfig)).toBe(true)
    expect(await gitTracked(tmp.path, visualArtifact)).toBe(true)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
      },
    })

    expect(await gitTracked(tmp.path, ".opencorvus-meta.json")).toBe(false)
    expect(await gitTracked(tmp.path, runtimeIntent)).toBe(false)
    expect(await gitTracked(tmp.path, staticConfig)).toBe(true)
    expect(await gitTracked(tmp.path, visualArtifact)).toBe(false)

    // Working tree copies must remain — untracking is a metadata operation,
    // not a filesystem delete. Goal executors still need to read them.
    const meta = await fs.readFile(path.join(tmp.path, ".opencorvus-meta.json"), "utf8")
    expect(meta).toContain("stale")
    const intent = await fs.readFile(path.join(tmp.path, runtimeIntent), "utf8")
    expect(intent).toContain("leak")
    const config = await fs.readFile(path.join(tmp.path, staticConfig), "utf8")
    expect(config).toContain("static config")
    const artifact = await fs.readFile(path.join(tmp.path, visualArtifact), "utf8")
    expect(artifact).toContain("png bytes")
    const subjects = (await fs.readFile(path.join(tmp.path, ".hook-subjects"), "utf8")).trim().split(/\r?\n/)
    expect(subjects).toContain(InternalGitCommitSubject.untrackIgnoredPaths)
    expect(subjects).toContain(InternalGitCommitSubject.seedGitignore)
  })

  test("appends expert-squad build unignore rules for existing projects with generic build ignore", async () => {
    await using tmp = await tmpdir({ git: true })
    const promptPath = ".opencorvus/expert-squads/builtin/frontend-replica/agents/build/system.md"
    await fs.mkdir(path.dirname(path.join(tmp.path, promptPath)), { recursive: true })
    await Bun.write(path.join(tmp.path, promptPath), "build overlay\n")
    await Bun.write(path.join(tmp.path, ".gitignore"), "node_modules/\nbuild/\n")

    expect(await gitIgnoredNoIndex(tmp.path, promptPath)).toBe(true)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
      },
    })

    const body = await fs.readFile(path.join(tmp.path, ".gitignore"), "utf8")
    expect(body).toContain("!.opencorvus/expert-squads/**/agents/build/")
    expect(body).toContain("!.opencorvus/expert-squads/**/agents/build/**")
    expect(await gitIgnoredNoIndex(tmp.path, promptPath)).toBe(false)
  })
})
