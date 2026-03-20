#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"

const executors = ["codex", "claude-code"] as const
const selected = (() => {
  const raw = process.argv.find((item) => item.startsWith("--executor="))?.split("=")[1]
  if (!raw || raw === "all") return [...executors]
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is (typeof executors)[number] => executors.includes(item as (typeof executors)[number]))
})()
const keep = process.argv.includes("--keep")
const report = process.argv.find((item) => item.startsWith("--report="))?.slice("--report=".length)
const timeoutMs = Number(process.argv.find((item) => item.startsWith("--timeout-ms="))?.split("=")[1]) || 15 * 60 * 1000

if (selected.length === 0) {
  console.error("No valid executors selected. Use --executor=codex, --executor=claude-code, or --executor=all.")
  process.exit(1)
}

const summaries: unknown[] = []

for (const executor of selected) {
  const summary = await runCase(executor, timeoutMs, keep)
  summaries.push(summary)
  console.log(JSON.stringify(summary, null, 2))
}

const out = {
  generated_at: new Date().toISOString(),
  cwd: process.cwd(),
  executors: selected,
  summaries,
}
const filepath = report || path.join(process.cwd(), `live-executor-e2e-report-${Date.now()}.json`)
await Bun.write(filepath, JSON.stringify(out, null, 2))
console.log(`report: ${filepath}`)

if (summaries.some((item) => (item as { ok: boolean }).ok === false)) {
  process.exit(1)
}

async function runCase(executor: (typeof executors)[number], timeoutMs: number, keep: boolean) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), `opencorvus-live-${executor === "codex" ? "codex" : "claude"}-home-`))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `opencorvus-${executor === "codex" ? "codex" : "claude"}-tank-`))
  process.env.OPENCORVUS_HOME = home
  process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"
  process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "bypassPermissions"
  delete process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL
  delete process.env.OPENCORVUS_EXECUTOR_CLAUDE_PROTOCOL

  const { Log } = await import("../src/util/log")
  Log.init({ print: false })
  const { Database } = await import("../src/storage/db")
  const { Identifier } = await import("../src/id/id")
  const { Server } = await import("../src/server/server")
  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Session } = await import("../src/session")
  const { WorkbenchService } = await import("../src/workbench/service")
  const { OrchestratorRuntime } = await import("../src/orchestrator/runtime")
  const { hooks } = await import("../src/orchestrator/state")
  const { ExecutorBootstrap } = await import("../src/executor/bootstrap")
  const {
    OrchestratorTaskTable,
    OrchestratorPlanVersionTable,
    OrchestratorMilestoneTable,
    OrchestratorGoalTable,
    OrchestratorRunTable,
    OrchestratorProgressSnapshotTable,
  } = await import("../src/orchestrator/orchestrator.sql")
  const { resetDatabase } = await import("../test/fixture/db")

  await resetDatabase()
  await scaffold(dir, executor)

  const app = Server.App()
  const request = async (url: string, init?: RequestInit, timeout = 20_000) =>
    Promise.race([
      app.request(url, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          "x-opencorvus-directory": dir,
        },
      }),
      Bun.sleep(timeout).then(() => {
        throw new Error(`request timeout: ${url}`)
      }),
    ])
  const json = async (url: string, init?: RequestInit, timeout?: number) => {
    const response = await request(url, init, timeout)
    return {
      response,
      body: await response.json(),
    }
  }
  const local = async (args: string[]) => {
    const proc = Bun.spawn(args, { cwd: dir, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { command: args.join(" "), exitCode, stdout, stderr }
  }

  let taskID = ""
  let runID = ""
  let sessionID = ""
  await Instance.provide({
    directory: dir,
    init: InstanceBootstrap,
    fn: async () => {
      await ExecutorBootstrap.autoRegister(true)
      const now = Date.now()
      const planID = Identifier.ascending("plan")
      const milestoneID = Identifier.ascending("milestone")
      taskID = Identifier.ascending("task")
      runID = Identifier.ascending("run")
      const session = await Session.create({ title: "Build a playable tank battle game" })
      sessionID = session.id
      await Session.setPermission({
        sessionID,
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: sessionID,
            active_plan_version_id: planID,
            active_run_id: runID,
            source: "script",
            title: "Build a playable tank battle game",
            request: taskRequest(),
            status: "queued",
            priority: "normal",
            budget: {
              max_runs: 2,
              max_replans: 1,
              max_evaluations: 2,
              max_wall_time_ms: timeoutMs,
            },
            metadata: {
              case: "tank-battle-live-e2e",
              executor_protocol_test: true,
              checks: {
                verify_cmd: ["node scripts/verify-game.mjs"],
              },
            },
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            version: 1,
            status: "active",
            summary: "Build a playable tank battle game in the repo root.",
            prompt: taskPrompt(),
            metadata: {
              strategy: "synthetic_live_case",
              steps: [
                "Read the starter files.",
                "Implement the game loop and controls.",
                "Add enemies, bullets, collisions, and HUD.",
                "Run build, test, and lint before finishing.",
              ],
            },
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorMilestoneTable)
          .values({
            id: milestoneID,
            task_id: taskID,
            plan_version_id: planID,
            title: "Core gameplay",
            description: "Ship the tank loop, movement, shooting, enemies, and collisions.",
            status: "pending",
            order_index: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorGoalTable)
          .values([
            {
              id: Identifier.ascending("goal"),
              task_id: taskID,
              plan_version_id: planID,
              milestone_id: milestoneID,
              description: "Playable core tank combat exists in the root files",
              criteria:
                "index.html, styles.css, and game.js implement player movement, shooting, enemy tanks, collisions, and a requestAnimationFrame loop.",
              metadata: { check_selector: ["build", "test", "lint", "verify_cmd"] },
              priority: "blocking",
              status: "pending",
              order_index: 0,
              time_created: now,
              time_updated: now,
            },
            {
              id: Identifier.ascending("goal"),
              task_id: taskID,
              plan_version_id: planID,
              milestone_id: null,
              description: "The UI communicates game state clearly",
              criteria:
                "The page shows score, health, enemy count, controls, win or lose messaging, and a restart affordance.",
              metadata: { check_selector: ["build", "test", "lint", "verify_cmd"] },
              priority: "blocking",
              status: "pending",
              order_index: 1,
              time_created: now,
              time_updated: now,
            },
          ])
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            session_id: sessionID,
            executor,
            status: "queued",
            phase: "execute",
            retry_count: 0,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorProgressSnapshotTable)
          .values({
            id: Identifier.ascending("progress"),
            task_id: taskID,
            status: "created",
            summary: "Synthetic live executor task created",
            payload: { sessionID },
            time_created: now,
            time_updated: now,
          })
          .run()
      })
      WorkbenchService.recordTaskRequest({
        taskID,
        content: "Synthetic live tank battle case",
        source: "script",
      })
      await OrchestratorRuntime.dispatch(runID, hooks())
    },
  })

  let progress: any
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = await json(`/task/${taskID}/progress`)
    progress = current.body
    const pending = Array.isArray(progress.pendingInteractions)
      ? progress.pendingInteractions.filter((item: { status: string }) => item.status === "pending")
      : []
    for (const item of pending) {
      const body = item.type === "permission"
        ? { reply: "always" }
        : { answers: [["Use reasonable defaults for a browser tank battle game."]] }
      await json(`/interaction/${item.id}/reply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      })
    }
    if (["completed", "failed", "cancelled"].includes(progress.task.status)) break
    await Bun.sleep(5_000)
  }

  const executorSession = await json(`/run/${runID}/executor`).then((item) => item.body).catch(() => null)
  const executorEvents = await json(`/run/${runID}/executor-events`).then((item) => item.body).catch(() => [])
  const taskExport = await json(`/export/task/${taskID}`).then((item) => item.body).catch(() => null)
  const sessionExport = await json(`/export/session/${sessionID}`).then((item) => item.body).catch(() => null)
  const localResults = [
    await local(["bun", "run", "build"]),
    await local(["bun", "run", "test"]),
    await local(["bun", "run", "lint"]),
  ]
  const ok =
    progress?.task?.status === "completed" &&
    progress?.evaluation?.verdict === "accepted" &&
    localResults.every((item) => item.exitCode === 0)

  const summary = {
    ok,
    executor,
    home,
    dir,
    taskID,
    runID,
    taskStatus: progress?.task?.status,
    evaluation: progress?.evaluation?.verdict,
    taskError: progress?.task?.error,
    goalStatuses: Array.isArray(progress?.goals)
      ? progress.goals.map((item: { description: string; status: string }) => ({ description: item.description, status: item.status }))
      : [],
    milestoneStatuses: Array.isArray(progress?.milestones)
      ? progress.milestones.map((item: { title: string; status: string }) => ({ title: item.title, status: item.status }))
      : [],
    changedFiles: progress?.delivery?.result?.changedFiles ?? [],
    executorProtocol: executorSession?.protocol,
    executorEventCount: Array.isArray(executorEvents) ? executorEvents.length : 0,
    transcriptMessages: Array.isArray(sessionExport?.messages) ? sessionExport.messages.length : 0,
    exportCounts: {
      runs: Array.isArray(taskExport?.runs) ? taskExport.runs.length : 0,
      interactions: Array.isArray(taskExport?.interactions) ? taskExport.interactions.length : 0,
      evaluations: Array.isArray(taskExport?.evaluations) ? taskExport.evaluations.length : 0,
      artifacts: Array.isArray(taskExport?.artifacts) ? taskExport.artifacts.length : 0,
    },
    local: localResults,
  }

  await Instance.disposeAll().catch(() => undefined)
  Database.close()
  if (!keep) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
  return summary
}

async function scaffold(dir: string, executor: string) {
  await $`git init`.cwd(dir).quiet()
  await $`git config user.email opencorvus@example.com`.cwd(dir).quiet()
  await $`git config user.name OpenCorvus`.cwd(dir).quiet()
  await $`git commit --allow-empty -m root`.cwd(dir).quiet()
  await fs.mkdir(path.join(dir, "scripts"), { recursive: true })
  await Promise.all([
    Bun.write(path.join(dir, "package.json"), JSON.stringify({
      name: `tank-battle-${executor}`,
      private: true,
      type: "module",
      scripts: {
        build: "node --check game.js && node --check scripts/verify-game.mjs && node --check scripts/lint.mjs",
        test: "node scripts/verify-game.mjs",
        lint: "node scripts/lint.mjs",
      },
    }, null, 2)),
    Bun.write(path.join(dir, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tank Battle</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main>
      <h1>Tank Battle</h1>
      <p>Starter shell for the live executor case.</p>
      <canvas id="game" width="960" height="640"></canvas>
    </main>
    <script type="module" src="./game.js"></script>
  </body>
</html>
`),
    Bun.write(path.join(dir, "styles.css"), `body { margin: 0; font-family: sans-serif; }
canvas { display: block; }
`),
    Bun.write(path.join(dir, "game.js"), `console.log("starter shell")
`),
    Bun.write(path.join(dir, "scripts", "verify-game.mjs"), `import fs from "fs"
const need = (value, message) => {
  if (value) return
  console.error(message)
  process.exit(1)
}
const html = fs.readFileSync("index.html", "utf8")
const css = fs.readFileSync("styles.css", "utf8")
const js = fs.readFileSync("game.js", "utf8")
const combined = [html, css, js].join("\\n")
need(/<canvas/i.test(html), "index.html must render a canvas")
need(/requestAnimationFrame/.test(js), "game.js must drive a game loop")
need(/WASD|Arrow/i.test(combined), "controls must mention WASD or arrow keys")
need(/score/i.test(combined), "game must show a score")
need(/health|hp/i.test(combined), "game must track player health")
need(/restart|play again/i.test(combined), "game must expose a restart affordance")
need(/enemy/i.test(js), "game.js must model enemy tanks")
need(/bullet|projectile|shell/i.test(js), "game.js must model bullets or projectiles")
need(/collision|hit|overlap|intersect/i.test(js), "game.js must handle collisions")
need(/win|victory|lose|defeat|game over/i.test(combined), "game must expose win/lose messaging")
need(/canvas/i.test(css), "styles.css must style the canvas")
console.log("tank verification passed")
`),
    Bun.write(path.join(dir, "scripts", "lint.mjs"), `import fs from "fs"
for (const file of ["index.html", "styles.css", "game.js"]) {
  const text = fs.readFileSync(file, "utf8")
  if (!text.trim()) {
    console.error(file + " is empty")
    process.exit(1)
  }
  if (/TODO|FIXME|starter shell/i.test(text)) {
    console.error(file + " still contains placeholder markers")
    process.exit(1)
  }
}
console.log("lint passed")
`),
  ])
}

function taskRequest() {
  return [
    "Turn the starter repo into a small single-page tank battle game using only index.html, styles.css, and game.js in the repo root.",
    "Requirements:",
    "- Player tank can move with WASD or arrow keys.",
    "- Space fires bullets.",
    "- At least 3 enemy tanks move with simple AI and can damage the player.",
    "- Show score, health, enemy count, and a restart control.",
    "- Show a clear win or lose message.",
    "- Do not add frameworks or external dependencies.",
    "- Update the existing placeholder files instead of creating a new app structure.",
    "Before finishing, run bun run build, bun run test, and bun run lint.",
  ].join("\n")
}

function taskPrompt() {
  return [
    "You are executing a headless coding task inside OpenCorvus.",
    "Task: Build a playable tank battle game.",
    "Implement the game in index.html, styles.css, and game.js only.",
    "Requirements:",
    "- Player tank can move with WASD or arrow keys.",
    "- Space fires bullets.",
    "- At least 3 enemy tanks move with simple AI and can damage the player.",
    "- Show score, health, enemy count, controls, restart, and clear win/lose messaging.",
    "- Do not add frameworks or external dependencies.",
    "Run bun run build, bun run test, and bun run lint before finishing.",
  ].join("\n")
}
