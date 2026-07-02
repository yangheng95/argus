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
import { Database, sql } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { Memory } from "../../src/memory"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { PermissionTable } from "../../src/session/session.sql"

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

async function withGitUnavailable(run: () => Promise<void>) {
  const originalPath = process.env.PATH
  const originalPathCase = process.env.Path
  process.env.PATH = ""
  process.env.Path = ""
  try {
    await run()
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    if (originalPathCase === undefined) delete process.env.Path
    else process.env.Path = originalPathCase
  }
}

async function loadProject() {
  return (await import("../../src/project/project")).Project
}

async function withDirectoryAlias(target: string, run: (alias: string) => Promise<void>) {
  const parent = path.join(
    path.dirname(target),
    `${path.basename(target)}-alias-${Math.random().toString(36).slice(2)}`,
  )
  const alias = path.join(parent, "visible")
  await fs.mkdir(parent, { recursive: true })
  try {
    await fs.symlink(target, alias, process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    await fs.rm(parent, { recursive: true, force: true })
    throw error
  }
  try {
    await run(alias)
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
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

  test("preserves selected root path when git top-level is the same real directory", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withDirectoryAlias(tmp.path, async (alias) => {
      const { project, sandbox } = await p.fromDirectory(alias)

      expect(project.id).not.toBe("global")
      expect(project.worktree).toBe(alias)
      expect(sandbox).toBe(alias)
      expect(Project.get(project.id)?.worktree).toBe(alias)
      expect(Project.isGitRepo(project.worktree)).toBe(true)
    })
  })

  test("rewrites an existing realpath-equivalent project row to the selected root path", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const original = await p.fromDirectory(tmp.path)
    expect(Project.get(original.project.id)?.worktree).toBe(tmp.path)

    await withDirectoryAlias(tmp.path, async (alias) => {
      const resolved = await p.fromDirectory(alias)

      expect(resolved.project.id).toBe(original.project.id)
      expect(resolved.project.worktree).toBe(alias)
      expect(resolved.sandbox).toBe(alias)
      expect(Project.get(original.project.id)?.worktree).toBe(alias)
      expect(resolved.project.sandboxes).not.toContain(tmp.path)
    })
  })

  test("converges polluted same-directory marker to the selected root project", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withDirectoryAlias(tmp.path, async (alias) => {
      const visibleID = Project.directoryProjectID(alias)
      const physicalID = Project.directoryProjectID(tmp.path)
      const now = Date.now()
      Database.use((db) => {
        db.insert(ProjectTable)
          .values([
            {
              id: visibleID,
              worktree: alias,
              time_created: now,
              time_updated: now,
              sandboxes: [],
            },
            {
              id: physicalID,
              worktree: tmp.path,
              time_created: now,
              time_updated: now,
              sandboxes: [],
            },
          ])
          .run()
      })
      await Filesystem.write(path.join(alias, ".git", "opencorvus"), physicalID)

      const resolved = await p.fromDirectory(alias)

      expect(resolved.project.id).toBe(visibleID)
      expect(resolved.project.worktree).toBe(alias)
      expect(resolved.sandbox).toBe(alias)
      expect(Project.get(visibleID)?.worktree).toBe(alias)
      expect(Project.get(physicalID)?.worktree).toBe(tmp.path)
      expect((await Filesystem.readText(path.join(alias, ".git", "opencorvus"))).trim()).toBe(visibleID)
    })
  })

  test("converges polluted same-directory marker when git binary is unavailable", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withDirectoryAlias(tmp.path, async (alias) => {
      const visibleID = Project.directoryProjectID(alias)
      const physicalID = Project.directoryProjectID(tmp.path)
      const now = Date.now()
      Database.use((db) => {
        db.insert(ProjectTable)
          .values([
            {
              id: visibleID,
              worktree: alias,
              time_created: now,
              time_updated: now,
              sandboxes: [],
            },
            {
              id: physicalID,
              worktree: tmp.path,
              time_created: now,
              time_updated: now,
              sandboxes: [],
            },
          ])
          .run()
      })
      await Filesystem.write(path.join(alias, ".git", "opencorvus"), physicalID)

      await withGitUnavailable(async () => {
        const resolved = await p.fromDirectory(alias)

        expect(resolved.project.id).toBe(visibleID)
        expect(resolved.project.worktree).toBe(alias)
        expect(resolved.sandbox).toBe(alias)
        expect((await Filesystem.readText(path.join(alias, ".git", "opencorvus"))).trim()).toBe(visibleID)
      })
    })
  })

  test("converges duplicate exact worktree rows by marker and preserves memory", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const canonicalID = "project_exact_marker_canonical"
    const duplicateID = "project_exact_marker_duplicate"
    const marker = path.join(tmp.path, ".git", "opencorvus")
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          {
            id: canonicalID,
            worktree: tmp.path,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          },
          {
            id: duplicateID,
            worktree: tmp.path,
            time_created: now - 10,
            time_updated: now - 10,
            sandboxes: [path.join(tmp.path, ".opencorvus", "r", "w", "AA", "worktree")],
          },
        ])
        .run()
    })
    await Filesystem.write(marker, canonicalID)
    const memory = Memory.writeFile({
      title: "Fact: Exact convergence sentinel",
      content: "## Exact convergence\nThe exact duplicate worktree memory must move with its FTS entry.",
      source: "agent",
      projectId: duplicateID,
      kind: "fact",
    })

    const resolved = await p.fromDirectory(tmp.path)

    expect(resolved.project.id).toBe(canonicalID)
    expect(resolved.project.worktree).toBe(tmp.path)
    expect(Project.get(duplicateID)).toBeUndefined()
    expect(Memory.getFileInProject({ fileId: memory.id, projectId: duplicateID })).toBeNull()
    expect(Memory.getFileInProject({ fileId: memory.id, projectId: canonicalID })?.title).toBe(memory.title)
    expect(Memory.search({ query: "duplicate worktree memory", projectId: canonicalID, limit: 3 }).length).toBe(1)
    expect(
      Database.use(
        (db) =>
          db.get<{ count: number }>(
            sql`SELECT count(*) as count FROM memory_fts WHERE project_id = ${duplicateID}`,
          )?.count,
      ),
    ).toBe(0)
  })

  test("keeps duplicate exact worktree conflict visible without a canonical signal", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    await fs.rm(path.join(tmp.path, ".git", "opencorvus"), { force: true })
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          {
            id: "project_exact_ambiguous_a",
            worktree: tmp.path,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          },
          {
            id: "project_exact_ambiguous_b",
            worktree: tmp.path,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          },
        ])
        .run()
    })

    await expect(p.fromDirectory(tmp.path)).rejects.toThrow("Project identity conflict")
    expect(Project.get("project_exact_ambiguous_a")?.worktree).toBe(tmp.path)
    expect(Project.get("project_exact_ambiguous_b")?.worktree).toBe(tmp.path)
  })

  test("rejects duplicate exact worktree convergence with embedded attachment refs", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const canonicalID = "project_exact_attachment_canonical"
    const duplicateID = "project_exact_attachment_duplicate"
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          { id: canonicalID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
          { id: duplicateID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
        ])
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: "task_exact_attachment_duplicate",
          project_id: duplicateID,
          source: "test",
          title: "Attachment duplicate",
          request: "Attachment duplicate",
          priority: "normal",
          attachments: [
            {
              sha: "sha",
              url: `/attachment/${duplicateID}/sha.png`,
              mime: "image/png",
              size: 1,
            },
          ],
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    await Filesystem.write(path.join(tmp.path, ".git", "opencorvus"), canonicalID)

    await expect(p.fromDirectory(tmp.path)).rejects.toThrow("embedded attachment reference")
    expect(Project.get(duplicateID)?.worktree).toBe(tmp.path)
    expect(Database.use((db) => db.select().from(EngineTaskTable).where(sql`id = ${"task_exact_attachment_duplicate"}`).get())?.project_id).toBe(
      duplicateID,
    )
  })

  test("rejects duplicate exact worktree convergence with project unique constraint conflicts", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const canonicalID = "project_exact_constraint_canonical"
    const duplicateID = "project_exact_constraint_duplicate"
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          { id: canonicalID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
          { id: duplicateID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
        ])
        .run()
      db.insert(PermissionTable)
        .values([
          { project_id: canonicalID, data: [], time_created: now, time_updated: now },
          { project_id: duplicateID, data: [], time_created: now, time_updated: now },
        ])
        .run()
    })
    await Filesystem.write(path.join(tmp.path, ".git", "opencorvus"), canonicalID)

    await expect(p.fromDirectory(tmp.path)).rejects.toThrow("duplicate permission rows")
    expect(Project.get(duplicateID)?.worktree).toBe(tmp.path)
  })

  test("rejects duplicate exact worktree convergence when duplicate rows conflict on permission", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const canonicalID = "project_exact_constraint_canonical_empty"
    const duplicateA = "project_exact_constraint_duplicate_a"
    const duplicateB = "project_exact_constraint_duplicate_b"
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          { id: canonicalID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
          { id: duplicateA, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
          { id: duplicateB, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
        ])
        .run()
      db.insert(PermissionTable)
        .values([
          { project_id: duplicateA, data: [], time_created: now, time_updated: now },
          { project_id: duplicateB, data: [], time_created: now, time_updated: now },
        ])
        .run()
    })
    await Filesystem.write(path.join(tmp.path, ".git", "opencorvus"), canonicalID)

    await expect(p.fromDirectory(tmp.path)).rejects.toThrow("duplicate permission rows")
    expect(Project.get(duplicateA)?.worktree).toBe(tmp.path)
    expect(Project.get(duplicateB)?.worktree).toBe(tmp.path)
  })

  test("rejects duplicate exact worktree convergence with duplicate request ids", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const canonicalID = "project_exact_request_canonical"
    const duplicateID = "project_exact_request_duplicate"
    const now = Date.now()
    const requestID = "request_exact_duplicate"
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          { id: canonicalID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
          { id: duplicateID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
        ])
        .run()
      db.insert(EngineTaskTable)
        .values([
          {
            id: "task_exact_request_canonical",
            project_id: canonicalID,
            request_id: requestID,
            source: "test",
            title: "Canonical request",
            request: "Canonical request",
            priority: "normal",
            time_created: now,
            time_updated: now,
          },
          {
            id: "task_exact_request_duplicate",
            project_id: duplicateID,
            request_id: requestID,
            source: "test",
            title: "Duplicate request",
            request: "Duplicate request",
            priority: "normal",
            time_created: now,
            time_updated: now,
          },
        ])
        .run()
    })
    await Filesystem.write(path.join(tmp.path, ".git", "opencorvus"), canonicalID)

    await expect(p.fromDirectory(tmp.path)).rejects.toThrow("duplicate request_id")
    expect(Project.get(duplicateID)?.worktree).toBe(tmp.path)
  })

  test("rejects duplicate exact worktree convergence when duplicate rows share request ids", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const canonicalID = "project_exact_request_canonical_empty"
    const duplicateA = "project_exact_request_duplicate_a"
    const duplicateB = "project_exact_request_duplicate_b"
    const now = Date.now()
    const requestID = "request_exact_duplicate_rows"
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          { id: canonicalID, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
          { id: duplicateA, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
          { id: duplicateB, worktree: tmp.path, time_created: now, time_updated: now, sandboxes: [] },
        ])
        .run()
      db.insert(EngineTaskTable)
        .values([
          {
            id: "task_exact_request_duplicate_a",
            project_id: duplicateA,
            request_id: requestID,
            source: "test",
            title: "Duplicate request A",
            request: "Duplicate request A",
            priority: "normal",
            time_created: now,
            time_updated: now,
          },
          {
            id: "task_exact_request_duplicate_b",
            project_id: duplicateB,
            request_id: requestID,
            source: "test",
            title: "Duplicate request B",
            request: "Duplicate request B",
            priority: "normal",
            time_created: now,
            time_updated: now,
          },
        ])
        .run()
    })
    await Filesystem.write(path.join(tmp.path, ".git", "opencorvus"), canonicalID)

    await expect(p.fromDirectory(tmp.path)).rejects.toThrow("duplicate request_id")
    expect(Project.get(duplicateA)?.worktree).toBe(tmp.path)
    expect(Project.get(duplicateB)?.worktree).toBe(tmp.path)
  })

  test("recognizes same filesystem identity even when real paths differ", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    const first = path.join(tmp.path, "first.txt")
    const second = path.join(tmp.path, "second.txt")
    await fs.writeFile(first, "same inode", "utf8")
    await fs.link(first, second)

    expect(await p.sameFilesystemLocation(first, second)).toBe(true)
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
    expect(Project.get("global")?.worktree).not.toBe(tmp.path)
    expect(Project.get(project.id)?.worktree).toBe(tmp.path)
    expect((await Filesystem.readText(marker)).trim()).toBe(project.id)
  })

  test("rewrites legacy global marker when git binary is unavailable", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()
    const marker = path.join(tmp.path, ".git", "opencorvus")
    await Filesystem.write(marker, "global")

    await withGitUnavailable(async () => {
      const { project } = await p.fromDirectory(tmp.path)

      expect(project.id).toBe(Project.directoryProjectID(tmp.path))
      expect(project.id).not.toBe("global")
      expect(Project.get("global")?.worktree).not.toBe(tmp.path)
      expect(Project.get(project.id)?.worktree).toBe(tmp.path)
      expect((await Filesystem.readText(marker)).trim()).toBe(project.id)
    })
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
