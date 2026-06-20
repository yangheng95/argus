import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

async function projectIDFor(directory: string) {
  return Instance.provide({
    directory,
    fn: () => Instance.project.id,
  })
}

function seedTask(
  projectID: string,
  taskID: string,
  session?: { id: string; directory: string; kind?: "root" | "build"; parentID?: string },
) {
  const now = Date.now()
  Database.use((db) =>
    db.transaction((tx) => {
      if (session) {
        tx.insert(SessionTable)
          .values({
            id: session.id,
            project_id: projectID,
            slug: session.id,
            directory: session.directory,
            title: "worktree runtime materialization session",
            version: "test",
            kind: session.kind ?? "build",
            parent_id: session.parentID ?? null,
            time_created: now,
            time_updated: now,
          })
          .run()
      }
      tx.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          session_id: session?.id ?? null,
          title: "worktree runtime materialization",
          request: "materialize webpage evidence artifacts",
          priority: "normal",
          budget: { max_executor_groups: 1 },
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    }),
  )
}

function seedBuildSession(input: {
  projectID: string
  taskID: string
  rootSessionID: string
  buildSessionID: string
  directory: string
}) {
  const now = Date.now()
  Database.use((db) =>
    db.transaction((tx) => {
      tx.insert(SessionTable)
        .values({
          id: input.rootSessionID,
          project_id: input.projectID,
          slug: input.rootSessionID,
          directory: input.directory,
          title: "worktree runtime materialization root",
          version: "test",
          kind: "root",
          time_created: now,
          time_updated: now,
        })
        .run()
      tx.insert(SessionTable)
        .values({
          id: input.buildSessionID,
          project_id: input.projectID,
          parent_id: input.rootSessionID,
          slug: input.buildSessionID,
          directory: ProjectRuntimePaths.directBuildWorktreeDir(input.directory, input.taskID, input.buildSessionID),
          title: "worktree runtime materialization build",
          version: "test",
          kind: "build",
          time_created: now,
          time_updated: now,
        })
        .run()
      tx.insert(EngineTaskTable)
        .values({
          id: input.taskID,
          project_id: input.projectID,
          source: "test",
          session_id: input.rootSessionID,
          title: "worktree runtime materialization",
          request: "materialize webpage evidence artifacts",
          priority: "normal",
          budget: { max_executor_groups: 1 },
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    }),
  )
}

describe("Worktree lifecycle", () => {
  test("create returns only after startup scripts complete", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    await Project.update({
      projectID,
      commands: {
        start: "echo ready> startup-ready.txt",
      },
    })

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `startup-ready-${Date.now().toString(36)}` }),
    })

    const startupFile = path.join(info.directory, "startup-ready.txt")
    expect(await Filesystem.exists(startupFile)).toBe(true)
    expect((await Filesystem.readText(startupFile)).trim()).toBe("ready")
  }, 30_000)

  test(
    "withGitLock uses the primary project runtime when called from a managed worktree",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = "tsk_worktree_lock_primary"
      const sessionID = "ses_worktree_lock_primary"
      const info = await Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.create({ name: "lock-root", taskID, sessionID }),
      })

      await Instance.provide({
        directory: info.directory,
        fn: async () => {
          const primaryLock = ProjectRuntimePaths.projectGitLock(tmp.path)
          const worktreeLock = ProjectRuntimePaths.projectGitLock(info.directory)

          await Worktree.withGitLock(async () => {
            expect(await Filesystem.exists(primaryLock)).toBe(true)
            expect(await Filesystem.exists(worktreeLock)).toBe(false)
          })
        },
      })
    },
    30_000,
  )

  test("create fails loud and cleans up when startup scripts fail", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const name = `start-fail-${Date.now().toString(36)}`
    const directory = path.join(tmp.path, ".opencorvus", "r", "w", name)
    const branch = `opencorvus/${name}`

    await Project.update({
      projectID,
      commands: {
        start: "opencorvus-command-that-does-not-exist",
      },
    })

    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.create({ name }),
      }),
    ).rejects.toMatchObject({
      name: "WorktreeStartCommandFailedError",
      data: {
        message: expect.stringMatching(/startup scripts failed/i),
      },
    })

    expect(await Filesystem.exists(directory)).toBe(false)
    const ref = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(tmp.path).quiet().nothrow()
    expect(ref.exitCode).not.toBe(0)
    expect(Project.get(projectID)?.sandboxes).not.toContain(directory)
  }, 30_000)

  test("create does not share root node_modules into the worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const rootNodeModules = path.join(tmp.path, "node_modules")
    await fs.mkdir(rootNodeModules, { recursive: true })
    await Bun.write(path.join(rootNodeModules, "marker.txt"), "root")

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `no-node-modules-link-${Date.now().toString(36)}` }),
    })

    expect(await Filesystem.exists(path.join(info.directory, "node_modules"))).toBe(false)
  }, 30_000)

  test("create keeps task frontend-design artifacts only in canonical runtime", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const taskID = `tsk_wt_webpage_evidence_${Date.now().toString(36)}`
    seedTask(projectID, taskID)

    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await fs.mkdir(paths.skeletonProjectAbsolute, { recursive: true })
    await fs.writeFile(path.join(paths.webpageEvidenceAbsolute, "reference.txt"), "reference", "utf8")
    await fs.writeFile(path.join(paths.sourcePackageAbsolute, "README.md"), "source package", "utf8")
    await fs.writeFile(path.join(paths.skeletonProjectAbsolute, "README.md"), "frontend skeleton", "utf8")

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Worktree.create({
          name: `webpage-evidence-${Date.now().toString(36)}`,
          taskID,
          goalID: "gol_webpage_evidence",
          runID: "run_webpage_evidence",
        }),
    })

    expect(await Filesystem.exists(path.join(info.directory, "frontend-design-skeleton"))).toBe(false)
    expect(await Filesystem.exists(path.join(info.directory, "web-clone-source"))).toBe(false)
    expect(await Filesystem.exists(path.join(info.directory, ProjectRuntimePaths.relativeRuntimeRoot()))).toBe(false)
    expect(await Filesystem.readText(path.join(paths.sourcePackageAbsolute, "README.md"))).toBe("source package")
    expect(await Filesystem.readText(path.join(paths.webpageEvidenceAbsolute, "reference.txt"))).toBe("reference")
    expect(await Filesystem.readText(path.join(paths.skeletonProjectAbsolute, "README.md"))).toBe("frontend skeleton")
    const status = await $`git status --porcelain=v1`.cwd(info.directory).quiet()
    expect(status.stdout.toString().trim()).toBe("")
  }, 30_000)

  test("task frontend-design runtime is not copied into reusable worktrees", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const taskID = `tsk_wt_runtime_copy_${Date.now().toString(36)}`
    seedTask(projectID, taskID)

    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await fs.mkdir(paths.skeletonProjectAbsolute, { recursive: true })
    await fs.writeFile(path.join(paths.sourcePackageAbsolute, "README.md"), "source package", "utf8")
    await fs.writeFile(path.join(paths.skeletonProjectAbsolute, "README.md"), "frontend skeleton", "utf8")

    const createInput = {
      name: `runtime-copy-${Date.now().toString(36)}`,
      taskID,
      goalID: "gol_runtime_copy",
      runID: "run_runtime_copy",
    }
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create(createInput),
    })

    expect(await Filesystem.readText(path.join(paths.sourcePackageAbsolute, "README.md"))).toBe("source package")
    expect(await Filesystem.readText(path.join(paths.skeletonProjectAbsolute, "README.md"))).toBe("frontend skeleton")
    expect(await Filesystem.exists(path.join(info.directory, paths.sourcePackageRelative, "README.md"))).toBe(false)

    const reused = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ ...createInput, reuseIfValid: true }),
    })

    expect(reused.directory).toBe(info.directory)
    expect(await Filesystem.exists(path.join(reused.directory, paths.sourcePackageRelative, "README.md"))).toBe(false)
    expect(await Filesystem.exists(path.join(reused.directory, paths.skeletonProjectRelative, "README.md"))).toBe(false)
    const status = await $`git status --porcelain=v1`.cwd(reused.directory).quiet()
    expect(status.stdout.toString().trim()).toBe("")
  }, 30_000)

  test("create does not fall back to project-root web-clone-source", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const taskID = `tsk_wt_source_root_${Date.now().toString(36)}`
    seedTask(projectID, taskID)

    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await fs.mkdir(path.join(tmp.path, "web-clone-source"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "web-clone-source", "README.md"), "root source package", "utf8")

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Worktree.create({
          name: `source-root-${Date.now().toString(36)}`,
          taskID,
          goalID: "gol_source_root",
          runID: "run_source_root",
        }),
    })

    expect(await Filesystem.exists(path.join(info.directory, "web-clone-source"))).toBe(false)
    expect(await Filesystem.exists(path.join(info.directory, paths.sourcePackageRelative, "README.md"))).toBe(false)
  }, 30_000)

  test("reuseIfValid does not materialize a task webpage evidence view", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const taskID = `tsk_wt_webpage_evidence_reuse_${Date.now().toString(36)}`
    seedTask(projectID, taskID)

    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await fs.writeFile(path.join(paths.webpageEvidenceAbsolute, "reference.txt"), "reference", "utf8")
    await fs.writeFile(path.join(paths.sourcePackageAbsolute, "README.md"), "source package", "utf8")

    const name = `webpage-evidence-reuse-${Date.now().toString(36)}`
    const createInput = {
      name,
      taskID,
      goalID: "gol_webpage_evidence_reuse",
      runID: "run_webpage_evidence_reuse",
    }
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create(createInput),
    })

    expect(await Filesystem.exists(path.join(info.directory, paths.webpageEvidenceRelative, "reference.txt"))).toBe(
      false,
    )

    const reused = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ ...createInput, reuseIfValid: true }),
    })

    expect(reused.directory).toBe(info.directory)
    expect(await Filesystem.exists(path.join(reused.directory, "web-clone-source"))).toBe(false)
    expect(await Filesystem.exists(path.join(reused.directory, paths.webpageEvidenceRelative, "reference.txt"))).toBe(
      false,
    )
    expect(await Filesystem.exists(path.join(reused.directory, paths.sourcePackageRelative, "README.md"))).toBe(false)
    const status = await $`git status --porcelain=v1`.cwd(reused.directory).quiet()
    expect(status.stdout.toString().trim()).toBe("")
  }, 30_000)

  test("recoverRecorded does not materialize task webpage evidence view", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const taskID = `tsk_wt_webpage_evidence_recover_${Date.now().toString(36)}`
    const sessionID = `ses_wt_webpage_evidence_recover_${Date.now().toString(36)}`
    seedBuildSession({
      projectID,
      taskID,
      rootSessionID: `ses_wt_webpage_evidence_recover_root_${Date.now().toString(36)}`,
      buildSessionID: sessionID,
      directory: tmp.path,
    })

    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await fs.writeFile(path.join(paths.webpageEvidenceAbsolute, "reference.txt"), "reference", "utf8")
    await fs.writeFile(path.join(paths.sourcePackageAbsolute, "README.md"), "source package", "utf8")

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Worktree.create({
          name: `webpage-evidence-recover-${Date.now().toString(36)}`,
          taskID,
          sessionID,
        }),
    })

    const recovered = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.recoverRecorded({ directory: info.directory, branch: info.branch }),
    })

    expect(recovered).toMatchObject({ status: "recovered", directory: info.directory, branch: info.branch })
    expect(await Filesystem.exists(path.join(info.directory, "web-clone-source"))).toBe(false)
    expect(await Filesystem.exists(path.join(info.directory, paths.webpageEvidenceRelative, "reference.txt"))).toBe(
      false,
    )
    expect(await Filesystem.exists(path.join(info.directory, paths.sourcePackageRelative, "README.md"))).toBe(false)
    const status = await $`git status --porcelain=v1`.cwd(info.directory).quiet()
    expect(status.stdout.toString().trim()).toBe("")
  }, 30_000)

  test("reset does not materialize task webpage evidence view after git clean", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    const taskID = `tsk_wt_webpage_evidence_reset_${Date.now().toString(36)}`
    const sessionID = `ses_wt_webpage_evidence_reset_${Date.now().toString(36)}`
    seedBuildSession({
      projectID,
      taskID,
      rootSessionID: `ses_wt_webpage_evidence_reset_root_${Date.now().toString(36)}`,
      buildSessionID: sessionID,
      directory: tmp.path,
    })

    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await fs.writeFile(path.join(paths.webpageEvidenceAbsolute, "reference.txt"), "reference", "utf8")
    await fs.writeFile(path.join(paths.sourcePackageAbsolute, "README.md"), "source package", "utf8")

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Worktree.create({
          name: `webpage-evidence-reset-${Date.now().toString(36)}`,
          taskID,
          sessionID,
        }),
    })

    await fs.writeFile(path.join(info.directory, "scratch.txt"), "scratch", "utf8")
    await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.reset({ directory: info.directory }),
    })

    expect(await Filesystem.exists(path.join(info.directory, "scratch.txt"))).toBe(false)
    expect(await Filesystem.exists(path.join(info.directory, "web-clone-source"))).toBe(false)
    expect(await Filesystem.exists(path.join(info.directory, paths.webpageEvidenceRelative, "reference.txt"))).toBe(
      false,
    )
    expect(await Filesystem.exists(path.join(info.directory, paths.sourcePackageRelative, "README.md"))).toBe(false)
    const status = await $`git status --porcelain=v1`.cwd(info.directory).quiet()
    expect(status.stdout.toString().trim()).toBe("")
  }, 30_000)

  test("reset fails when startup scripts fail", async () => {
    // Bun's default 5s timeout is tight for this test on Windows: reset spawns
    // ~10 sequential git/cmd processes (worktree list, remote probe, two
    // show-ref checks, reset --hard, clean -ffdx, three submodule operations,
    // status) plus the cmd.exe startup-script probe; each spawn is ~300ms on
    // Windows. 30s is comfortable headroom without masking real regressions.
    await using tmp = await tmpdir({ git: true })
    const projectID = await projectIDFor(tmp.path)
    await Project.update({
      projectID,
      commands: {
        start: "echo ready> startup-ready.txt",
      },
    })

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `reset-start-fail-${Date.now().toString(36)}` }),
    })

    await Project.update({
      projectID,
      commands: {
        start: "opencorvus-command-that-does-not-exist",
      },
    })

    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.reset({ directory: info.directory }),
      }),
    ).rejects.toMatchObject({
      name: "WorktreeStartCommandFailedError",
      data: {
        message: expect.stringMatching(/startup scripts failed/i),
      },
    })
  }, 30_000)
})
