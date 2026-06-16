import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { $ } from "bun"
import path from "path"
import fs from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { GlobalBus } from "../../src/bus/global"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

const gitModule = await import("../../src/util/git")
const originalGit = gitModule.git

type Mode = "none" | "rev-list-fail" | "top-fail" | "common-dir-fail"
let mode: Mode = "none"

mock.module("../../src/util/git", () => ({
  git: (args: string[], opts: { cwd: string; env?: Record<string, string> }) => {
    const cmd = ["git", ...args].join(" ")
    if (
      mode === "rev-list-fail" &&
      cmd.includes("git rev-list") &&
      cmd.includes("--max-parents=0") &&
      cmd.includes("--all")
    ) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "top-fail" && cmd.includes("git rev-parse") && cmd.includes("--show-toplevel")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "common-dir-fail" && cmd.includes("git rev-parse") && cmd.includes("--git-common-dir")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    return originalGit(args, opts)
  },
}))

async function withMode(next: Mode, run: () => Promise<void>) {
  const prev = mode
  mode = next
  try {
    await run()
  } finally {
    mode = prev
  }
}

async function loadProject() {
  return (await import("../../src/project/project")).Project
}

describe("Project.fromDirectory", () => {
  beforeEach(() => {
    resetDatabase()
  })

  afterEach(() => {
    resetDatabase()
  })

  test("should handle git repository with no commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(Project.isGitRepo(project.worktree)).toBe(true)
    expect(project.worktree).toBe(tmp.path)

    const opencorvusFile = path.join(tmp.path, ".git", "opencorvus")
    const fileExists = await Filesystem.exists(opencorvusFile)
    expect(fileExists).toBe(true)
  })

  test("should handle git repository with commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(Project.isGitRepo(project.worktree)).toBe(true)
    expect(project.worktree).toBe(tmp.path)

    const opencorvusFile = path.join(tmp.path, ".git", "opencorvus")
    const fileExists = await Filesystem.exists(opencorvusFile)
    expect(fileExists).toBe(true)
  })

  test("keeps git vcs when rev-list exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await withMode("rev-list-fail", async () => {
      const { project } = await p.fromDirectory(tmp.path)
      expect(Project.isGitRepo(project.worktree)).toBe(true)
      expect(project.id).not.toBe("global")
      expect(project.worktree).toBe(tmp.path)
    })
  })

  test("does not inherit an unrelated parent git for non-git subdirectories", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const child = path.join(tmp.path, "generated-project")
    await Filesystem.write(path.join(child, "README.md"), "hello")

    const parent = await p.fromDirectory(tmp.path)
    const nested = await p.fromDirectory(child)

    expect(await Filesystem.exists(path.join(child, ".git"))).toBe(false)
    expect(Project.isGitRepo(nested.project.worktree)).toBe(false)
    expect(nested.project.id).toBe(Project.directoryProjectID(child))
    expect(nested.project.id).not.toBe("global")
    expect(nested.project.id).not.toBe(parent.project.id)
    expect(nested.project.worktree).toBe(child)
    expect(nested.sandbox).toBe(child)
  })

  test("keeps standalone non-git directories outside git mode", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()

    const { project, sandbox } = await p.fromDirectory(tmp.path)

    expect(project.id).toBe(Project.directoryProjectID(tmp.path))
    expect(project.id).not.toBe("global")
    expect(Project.isGitRepo(project.worktree)).toBe(false)
    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
    expect(await Filesystem.exists(path.join(tmp.path, ".git"))).toBe(false)
  })

  test("keeps non-git project identity stable after git init", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()

    const before = await p.fromDirectory(tmp.path)
    expect(before.project.id).toBe(Project.directoryProjectID(tmp.path))
    expect(before.project.worktree).toBe(tmp.path)

    await $`git init`.cwd(tmp.path).quiet()
    const after = await p.fromDirectory(tmp.path)

    expect(after.project.id).toBe(before.project.id)
    expect(after.project.worktree).toBe(tmp.path)
    expect(Project.get(before.project.id)?.worktree).toBe(tmp.path)
  })

  test("rewrites legacy global marker before inserting project row", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()
    const marker = path.join(tmp.path, ".git", "opencorvus")
    await Filesystem.write(marker, "global")

    const { project } = await p.fromDirectory(tmp.path)

    expect(project.id).toBe(Project.directoryProjectID(tmp.path))
    expect(project.id).not.toBe("global")
    expect(Project.get("global")).toBeUndefined()
    expect((await Filesystem.readText(marker)).trim()).toBe(project.id)
  })

  test("keeps git vcs when show-toplevel exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withMode("top-fail", async () => {
      const { project, sandbox } = await p.fromDirectory(tmp.path)
      expect(Project.isGitRepo(project.worktree)).toBe(true)
      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(tmp.path)
    })
  })

  test("keeps git vcs when git-common-dir exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withMode("common-dir-fail", async () => {
      const { project, sandbox } = await p.fromDirectory(tmp.path)
      expect(Project.isGitRepo(project.worktree)).toBe(true)
      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(tmp.path)
    })
  })

  test("gives copied standalone repositories different project identities", async () => {
    const p = await loadProject()
    await using source = await tmpdir({ git: true })
    const copy = path.join(path.dirname(source.path), `${path.basename(source.path)}-copy`)
    await fs.cp(source.path, copy, { recursive: true })

    const sourceProject = await p.fromDirectory(source.path)
    const copyProject = await p.fromDirectory(copy)

    expect(sourceProject.project.id).not.toBe(copyProject.project.id)
    expect(Project.get(sourceProject.project.id)?.worktree).toBe(source.path)
    expect(Project.get(copyProject.project.id)?.worktree).toBe(copy)
  })

  test("rewrites a copied standalone marker instead of overwriting the original worktree", async () => {
    const p = await loadProject()
    await using source = await tmpdir({ git: true })
    const sourceProject = await p.fromDirectory(source.path)
    const sourceMarker = await Filesystem.readText(path.join(source.path, ".git", "opencorvus"))

    const copy = path.join(path.dirname(source.path), `${path.basename(source.path)}-legacy-copy`)
    await fs.cp(source.path, copy, { recursive: true })
    expect((await Filesystem.readText(path.join(copy, ".git", "opencorvus"))).trim()).toBe(sourceMarker.trim())

    const copyProject = await p.fromDirectory(copy)

    expect(copyProject.project.id).not.toBe(sourceProject.project.id)
    expect(Project.get(sourceProject.project.id)?.worktree).toBe(source.path)
    expect(Project.get(copyProject.project.id)?.worktree).toBe(copy)
    expect((await Filesystem.readText(path.join(copy, ".git", "opencorvus"))).trim()).toBe(copyProject.project.id)
  })
})

describe("Project.fromDirectory with worktrees", () => {
  test("should set worktree to root when called from root", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project, sandbox } = await p.fromDirectory(tmp.path)

    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
    expect(project.sandboxes).not.toContain(tmp.path)
  })

  test("should set worktree to root when called from a worktree", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const { project, sandbox } = await p.fromDirectory(worktreePath)

      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(worktreePath)
      expect(project.sandboxes).toContain(worktreePath)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("should accumulate multiple worktrees in sandboxes", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktree1 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt1")
    const worktree2 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt2")
    try {
      await $`git worktree add ${worktree1} -b branch-${Date.now()}`.cwd(tmp.path).quiet()
      await $`git worktree add ${worktree2} -b branch-${Date.now() + 1}`.cwd(tmp.path).quiet()

      await p.fromDirectory(worktree1)
      const { project } = await p.fromDirectory(worktree2)

      expect(project.worktree).toBe(tmp.path)
      expect(project.sandboxes).toContain(worktree1)
      expect(project.sandboxes).toContain(worktree2)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktree1}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
      await $`git worktree remove ${worktree2}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })
})

describe("Project.discover", () => {
  test("should discover favicon.png in root", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await p.discover(project)

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeDefined()
    expect(updated!.icon?.url).toStartWith("data:")
    expect(updated!.icon?.url).toContain("base64")
    expect(updated!.icon?.color).toBeUndefined()
  })

  test("should not discover non-image files", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    await Bun.write(path.join(tmp.path, "favicon.txt"), "not an image")

    await p.discover(project)

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeUndefined()
  })
})

describe("Project.update", () => {
  test("should update name", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      name: "New Project Name",
    })

    expect(updated.name).toBe("New Project Name")

    const fromDb = Project.get(project.id)
    expect(fromDb?.name).toBe("New Project Name")
  })

  test("should update icon url", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      icon: { url: "https://example.com/icon.png" },
    })

    expect(updated.icon?.url).toBe("https://example.com/icon.png")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.url).toBe("https://example.com/icon.png")
  })

  test("should update icon color", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      icon: { color: "#ff0000" },
    })

    expect(updated.icon?.color).toBe("#ff0000")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.color).toBe("#ff0000")
  })

  test("should update commands", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      commands: { start: "npm run dev" },
    })

    expect(updated.commands?.start).toBe("npm run dev")

    const fromDb = Project.get(project.id)
    expect(fromDb?.commands?.start).toBe("npm run dev")
  })

  test("should throw error when project not found", async () => {
    await expect(
      Project.update({
        projectID: "nonexistent-project-id",
        name: "Should Fail",
      }),
    ).rejects.toThrow("Project not found: nonexistent-project-id")
  })

  test("should emit GlobalBus event on update", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    let eventFired = false
    let eventPayload: any = null

    GlobalBus.on("event", (data) => {
      eventFired = true
      eventPayload = data
    })

    await Project.update({
      projectID: project.id,
      name: "Updated Name",
    })

    expect(eventFired).toBe(true)
    expect(eventPayload.payload.type).toBe("project.updated")
    expect(eventPayload.payload.properties.name).toBe("Updated Name")
  })

  test("should update multiple fields at once", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      name: "Multi Update",
      icon: { url: "https://example.com/favicon.ico", color: "#00ff00" },
      commands: { start: "make start" },
    })

    expect(updated.name).toBe("Multi Update")
    expect(updated.icon?.url).toBe("https://example.com/favicon.ico")
    expect(updated.icon?.color).toBe("#00ff00")
    expect(updated.commands?.start).toBe("make start")
  })
})
