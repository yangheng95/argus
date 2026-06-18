import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Database } from "../../src/storage/db"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Ownership } from "../../src/engine/ownership"
import { Instance } from "../../src/project/instance"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { Project } from "../../src/project/project"

Log.init({ print: false })

describe("project routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("POST /project/current/init-git initializes a standalone directory", async () => {
    await using tmp = await tmpdir()
    const app = Server.App()

    const response = await app.request("/project/current/init-git", {
      method: "POST",
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { created: boolean }
    expect(body.created).toBe(true)
    expect(await Filesystem.exists(path.join(tmp.path, ".git"))).toBe(true)

    const current = await app.request("/project/current", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    expect(current.status).toBe(200)
  }, 30_000)

  test("POST /project/current/init-git is idempotent for git projects", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()

    const response = await app.request("/project/current/init-git", {
      method: "POST",
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { created: boolean }
    expect(body.created).toBe(false)
  }, 30_000)

  test(
    "PATCH /project/:projectID only updates the active project selected by directory",
    async () => {
      await using projectA = await tmpdir()
      await using projectB = await tmpdir()
      const app = Server.App()
      let projectAID = ""
      let projectBID = ""

      await Instance.provide({
        directory: projectA.path,
        fn: () => {
          projectAID = Instance.project.id
        },
      })
      await Instance.provide({
        directory: projectB.path,
        fn: () => {
          projectBID = Instance.project.id
        },
      })

      const ownUpdate = await app.request(`/project/${projectAID}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": projectA.path,
        },
        body: JSON.stringify({ name: "project A renamed" }),
      })
      expect(ownUpdate.status).toBe(200)
      const ownBody = (await ownUpdate.json()) as { id: string; name?: string }
      expect(ownBody.id).toBe(projectAID)
      expect(ownBody.name).toBe("project A renamed")

      const projectBBefore = Project.get(projectBID)!
      const crossUpdate = await app.request(`/project/${projectBID}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": projectA.path,
        },
        body: JSON.stringify({ name: "project B hijacked" }),
      })

      expect(crossUpdate.status).toBe(404)
      expect(Project.get(projectBID)?.name).toBe(projectBBefore.name)
    },
    30_000,
  )

  test("GET /project/current/worktrees marks live goal bindings and expired worktrees", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const now = Date.now()
    const activeDir = path.join(tmp.path, "..", `project-route-active-${now}`)
    const expiredDir = path.join(tmp.path, "..", `project-route-expired-${now}`)

    await $`git worktree add --no-checkout -b ${`opencorvus/active-${now}`} ${activeDir}`.cwd(tmp.path).quiet()
    await $`git reset --hard`.cwd(activeDir).quiet()
    await $`git worktree add --no-checkout -b ${`opencorvus/expired-${now}`} ${expiredDir}`.cwd(tmp.path).quiet()
    await $`git reset --hard`.cwd(expiredDir).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = `task_project_worktrees_${now}`
        const goalID = `goal_project_worktrees_${now}`
        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "worktree route task",
              request: "verify worktree route",
              priority: "normal",
              kind: "workflow",
              queue_order: 0,
              system_artifacts: [],
              design_specs: [],
              criteria_results: [],
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "live route goal",
              slug: "live-route-goal",
              objective: "bind active worktree",
              acceptance_specs: [],
              owned_paths: [],
              depends_on: [],
              kind: "feature",
              requirement_ids: [],
              priority: "blocking",
              source: "test",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID,
          workspaceDir: activeDir,
          workspaceBranch: `opencorvus/active-${now}`,
          status: "running",
          now,
        })
      },
    })

    const response = await app.request("/project/current/worktrees", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{
      directory: string
      goalID?: string
      status: "primary" | "active" | "expired"
      removable: boolean
    }>
    const active = body.find((item) => path.resolve(item.directory) === path.resolve(activeDir))
    const expired = body.find((item) => path.resolve(item.directory) === path.resolve(expiredDir))
    const primary = body.find((item) => path.resolve(item.directory) === path.resolve(tmp.path))
    expect(primary?.status).toBe("primary")
    expect(primary?.removable).toBe(false)
    expect(active?.status).toBe("active")
    expect(active?.goalID).toBe(`goal_project_worktrees_${now}`)
    expect(active?.removable).toBe(true)
    expect(expired?.status).toBe("expired")
    expect(expired?.goalID).toBeUndefined()
    expect(expired?.removable).toBe(true)
  }, 30_000)

  test("DELETE /project/current/worktrees removes a registered worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const now = Date.now()
    const expiredDir = path.join(tmp.path, "..", `project-route-delete-${now}`)

    await $`git worktree add --no-checkout -b ${`opencorvus/delete-${now}`} ${expiredDir}`.cwd(tmp.path).quiet()
    await $`git reset --hard`.cwd(expiredDir).quiet()
    await Instance.provide({
      directory: tmp.path,
      fn: () => Project.addSandbox(Instance.project.id, expiredDir),
    })

    const response = await app.request("/project/current/worktrees", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ directory: expiredDir }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(await Filesystem.exists(expiredDir)).toBe(false)
    const list = await $`git worktree list --porcelain`.cwd(tmp.path).quiet().text()
    expect(list).not.toContain(path.resolve(expiredDir))
    const project = await Instance.provide({
      directory: tmp.path,
      fn: () => Project.get(Instance.project.id),
    })
    expect(project?.sandboxes).not.toContain(expiredDir)
  }, 30_000)

  test.each([
    ["/project/current/worktrees", { ok: true }],
    ["/experimental/worktree", true],
  ] as const)("DELETE %s rejects an unregistered sibling directory without deleting it", async (route) => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const victimDir = path.join(tmp.path, "..", `project-route-delete-victim-${Date.now()}`)
    const sentinel = path.join(victimDir, "sentinel.txt")
    await fs.mkdir(victimDir, { recursive: true })
    await Bun.write(sentinel, "keep")

    const response = await app.request(route, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ directory: victimDir }),
    })

    expect(response.status).toBe(404)
    expect(await Filesystem.exists(victimDir)).toBe(true)
    expect(await Bun.file(sentinel).text()).toBe("keep")
  }, 30_000)

  test("GET /project/current/cleanup-candidates is read-only ownership inspection", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const deadPid = 999_999_991
    const missingWorktree = path.join(tmp.path, "missing-worktree")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Ownership.Process.record({
          primaryWorktreeDir: tmp.path,
          pid: deadPid,
          cwd: tmp.path,
          taskID: "tsk_dead_process",
          sessionID: "ses_dead_process",
        })
        await Ownership.Process.record({
          primaryWorktreeDir: tmp.path,
          pid: process.pid,
          cwd: tmp.path,
          taskID: "tsk_live_process",
          sessionID: "ses_live_process",
        })
        await Ownership.Worktree.record({
          primaryWorktreeDir: tmp.path,
          worktreeDir: missingWorktree,
          taskID: "tsk_missing_worktree",
          sessionID: "ses_missing_worktree",
        })
      },
    })

    const beforeProcessMarkers = await Ownership.Process.list(tmp.path)
    const beforeWorktreeMarkers = await Ownership.Worktree.list(tmp.path)
    const response = await app.request("/project/current/cleanup-candidates", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      processOrphans: Array<{ marker: { taskID: string; ownerPid: number }; reason: string }>
      worktreeOrphans: Array<{ marker: { taskID: string }; reason: string }>
      worktreeGCCandidates: unknown[]
    }
    expect(body.processOrphans).toContainEqual(
      expect.objectContaining({
        marker: expect.objectContaining({ taskID: "tsk_dead_process", ownerPid: deadPid }),
        reason: "owner-process-dead",
      }),
    )
    expect(body.processOrphans.some((entry) => entry.marker.taskID === "tsk_live_process")).toBe(false)
    expect(body.worktreeOrphans).toContainEqual(
      expect.objectContaining({
        marker: expect.objectContaining({ taskID: "tsk_missing_worktree" }),
        reason: "target-missing",
      }),
    )
    expect(await Ownership.Process.list(tmp.path)).toHaveLength(beforeProcessMarkers.length)
    expect(await Ownership.Worktree.list(tmp.path)).toHaveLength(beforeWorktreeMarkers.length)
  }, 30_000)
})
