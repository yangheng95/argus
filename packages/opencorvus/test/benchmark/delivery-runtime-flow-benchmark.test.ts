import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import http from "node:http"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildDeliveryEvidenceManifest } from "../../src/delivery/checks/project-gate"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"

const tempDirs: string[] = []
const childProcesses: ChildProcess[] = []

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode !== null) continue
    child.kill()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("delivery runtime flow benchmark", () => {
  test("structured runtime scenario requires a real rendered interaction", async () => {
    const fixture = await frontendFixture({ interactive: true })

    const manifest = await Instance.provide({
      directory: fixture.dir,
      fn: () => {
        recordPassingIntegrity("tsk_runtime_benchmark", "spec_runtime_benchmark")
        return buildDeliveryEvidenceManifest({
          taskID: "tsk_runtime_benchmark",
          runID: "run_runtime_benchmark",
          deliveryID: "dlv_runtime_benchmark",
          specSnapshotID: "spec_runtime_benchmark",
          changedFiles: ["dist/index.html"],
          metadata: { previewUrl: fixture.previewUrl },
          goals: [{
            id: "gol_chat_runtime",
            title: "Chat runtime flow",
            priority: "blocking",
            requirement_ids: ["REQ-chat"],
            acceptance_spec_count: 1,
            runtime_scenario_count: 1,
          }],
        })
      },
    })

    expect(manifest.finalGate.status).toBe("passed")
    expect(manifest.runtimeFlows).toHaveLength(1)
    expect(manifest.runtimeFlows[0]?.status).toBe("passed")
    expect(manifest.runtimeFlows[0]?.interaction?.visibleControlCount).toBeGreaterThan(0)
    expect(manifest.runtimeFlows[0]?.interaction?.attemptedInteractionCount).toBeGreaterThan(0)
    expect(
      manifest.runtimeFlows[0]?.interaction?.textChanged || manifest.runtimeFlows[0]?.interaction?.htmlChanged,
    ).toBe(true)
  }, 60_000)

  test("structured runtime scenario fails when rendered page has no controls", async () => {
    const fixture = await frontendFixture({ interactive: false })

    const manifest = await Instance.provide({
      directory: fixture.dir,
      fn: () => {
        recordPassingIntegrity("tsk_runtime_benchmark_fail", "spec_runtime_benchmark_fail")
        return buildDeliveryEvidenceManifest({
          taskID: "tsk_runtime_benchmark_fail",
          runID: "run_runtime_benchmark_fail",
          deliveryID: "dlv_runtime_benchmark_fail",
          specSnapshotID: "spec_runtime_benchmark_fail",
          changedFiles: ["dist/index.html"],
          metadata: { previewUrl: fixture.previewUrl },
          goals: [{
            id: "gol_chat_runtime",
            title: "Chat runtime flow",
            priority: "blocking",
            requirement_ids: ["REQ-chat"],
            acceptance_spec_count: 1,
            runtime_scenario_count: 1,
          }],
        })
      },
    })

    expect(manifest.finalGate.status).toBe("failed")
    expect(manifest.finalGate.failedRuntimeFlowIds).toEqual(["runtime:web:."])
    expect(manifest.runtimeFlows[0]?.status).toBe("failed")
    expect(manifest.runtimeFlows[0]?.evidence.join("\n")).toContain("interaction_required_but_missing")
  }, 60_000)

  test("structured runtime scenario evaluates the post-interaction DOM for auth-gated apps", async () => {
    const fixture = await frontendFixture({ interactive: "auth-gated" })

    const manifest = await Instance.provide({
      directory: fixture.dir,
      fn: () => {
        recordPassingIntegrity("tsk_runtime_auth_gate", "spec_runtime_auth_gate")
        return buildDeliveryEvidenceManifest({
          taskID: "tsk_runtime_auth_gate",
          runID: "run_runtime_auth_gate",
          deliveryID: "dlv_runtime_auth_gate",
          specSnapshotID: "spec_runtime_auth_gate",
          changedFiles: ["dist/index.html"],
          metadata: { previewUrl: fixture.previewUrl },
          goals: [{
            id: "gol_auth_runtime",
            title: "Mock login runtime flow",
            priority: "blocking",
            requirement_ids: ["REQ-auth"],
            acceptance_spec_count: 1,
            runtime_scenario_count: 1,
          }],
        })
      },
    })

    expect(manifest.finalGate.status).toBe("passed")
    expect(manifest.runtimeFlows[0]?.status).toBe("passed")
    expect(manifest.runtimeFlows[0]?.dom?.textLength).toBeGreaterThanOrEqual(120)
    expect(manifest.runtimeFlows[0]?.dom?.nodeCount).toBeGreaterThanOrEqual(60)
    expect(manifest.runtimeFlows[0]?.interaction?.htmlChanged).toBe(true)
  }, 60_000)
})

async function frontendFixture(input: { interactive: boolean | "auth-gated" }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-delivery-runtime-bench-"))
  tempDirs.push(dir)
  await fs.mkdir(path.join(dir, "dist"), { recursive: true })
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    type: "module",
    packageManager: "bun@1.3.13",
    dependencies: {
      react: "0.0.0",
    },
    scripts: {
      build: "bun -e \"console.log('build ok')\"",
    },
  }, null, 2))
  await fs.writeFile(path.join(dir, "dist", "index.html"), htmlFixture(input.interactive))
  const previewUrl = await startFixturePreviewServer(dir)
  return { dir, previewUrl }
}

function recordPassingIntegrity(taskID: string, specSnapshotID: string) {
  const now = Date.now()
  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: `project_${taskID}`,
      worktree: Instance.directory,
      name: `Project ${taskID}`,
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).onConflictDoNothing().run()
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: `project_${taskID}`,
      source: "test",
      title: `Task ${taskID}`,
      request: "Test delivery runtime flow",
      kind: "workflow",
      priority: "normal",
      status: "active",
      attachments: [],
      system_artifacts: [],
      design_specs: [],
      metadata: {},
      time_created: now,
      time_updated: now,
      time_started: now,
    }).onConflictDoNothing().run()
  })
  recordIntegrityAttempt({
    taskID,
    sessionID: `ses_${specSnapshotID}`,
    specSnapshotID,
    verdict: "pass",
    perDimension: [
      { id: "goal_fidelity", verdict: "pass" },
      { id: "technical_feasibility", verdict: "pass" },
      { id: "hallucination", verdict: "pass" },
      { id: "solution_quality", verdict: "pass" },
    ],
    issuesCount: 0,
    correctionsCount: 0,
    missingCount: 0,
  })
}

async function startFixturePreviewServer(dir: string): Promise<string> {
  const port = await firstAvailablePreviewPort()
  const serverPath = path.join(dir, "preview-server.mjs")
  await fs.writeFile(serverPath, `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const port = Number(process.argv[2]);
const server = createServer(async (_req, res) => {
  const html = await readFile(join(root, "dist", "index.html"));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});
server.listen(port, "127.0.0.1");
`)
  const child = spawn(process.execPath, [serverPath, String(port)], {
    cwd: dir,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  })
  childProcesses.push(child)
  const url = `http://127.0.0.1:${port}/`
  await waitForHttp(url)
  return url
}

async function firstAvailablePreviewPort(): Promise<number> {
  for (const port of [5173, 4173, 3000, 3001, 4321, 8080, 8000, 5000]) {
    if (await canBind(port)) return port
  }
  throw new Error("no preview benchmark port is available")
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.once("error", () => resolve(false))
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true))
    })
  })
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const ok = await fetch(url).then((response) => response.ok, () => false)
    if (ok) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`preview fixture did not start: ${url}`)
}

function htmlFixture(interactive: boolean | "auth-gated") {
  if (interactive === "auth-gated") return authGatedHtmlFixture()
  const rows = Array.from({ length: 80 }, (_, index) =>
    `<li>Runtime benchmark transcript row ${index}: persistent chat history, mock login, upload state, and editable title are visible.</li>`,
  ).join("\n")
  const controls = interactive
    ? `
      <textarea id="message" aria-label="message"></textarea>
      <button id="send" type="button">Send</button>
      <div id="log">Ready for runtime probe.</div>
      <script>
        document.getElementById("send").addEventListener("click", () => {
          const message = document.getElementById("message").value || "empty";
          document.getElementById("log").textContent = "Sent: " + message;
          document.body.setAttribute("data-runtime-probe", "changed");
        });
      </script>
    `
    : `<div id="log">Read-only delivery shell with no user controls.</div>`
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Delivery Runtime Benchmark</title></head>
  <body>
    <main>
      <h1>Delivery Runtime Benchmark</h1>
      <section>${controls}</section>
      <ol>${rows}</ol>
    </main>
  </body>
</html>`
}

function authGatedHtmlFixture() {
  const rows = Array.from({ length: 72 }, (_, index) =>
    `<li>Authenticated chat row ${index}: sessions, messages, uploads, settings, and editable titles are available after mock login.</li>`,
  ).join("\n")
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Auth Gated Runtime Benchmark</title></head>
  <body>
    <main id="app">
      <h1>Claude Chat</h1>
      <p>Login to continue.</p>
      <button id="login" type="button">Mock Google login</button>
    </main>
    <script>
      document.getElementById("login").addEventListener("click", () => {
        document.getElementById("app").innerHTML = \`
          <h1>Claude Chat workspace</h1>
          <label>Message <textarea id="message"></textarea></label>
          <button id="send" type="button">Send</button>
          <button id="rename" type="button">Rename session</button>
          <button id="delete" type="button">Delete session</button>
          <section aria-label="history"><ol>${rows}</ol></section>
        \`;
      });
    </script>
  </body>
</html>`
}
