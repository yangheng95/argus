import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildDeliveryEvidenceManifest } from "../../src/delivery/checks/project-gate"
import { Instance } from "../../src/project/instance"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("delivery runtime flow benchmark", () => {
  test("structured runtime scenario requires a real rendered interaction", async () => {
    const dir = await frontendFixture({ interactive: true })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_runtime_benchmark",
        runID: "run_runtime_benchmark",
        deliveryID: "dlv_runtime_benchmark",
        changedFiles: ["dist/index.html"],
        goals: [{
          id: "gol_chat_runtime",
          title: "Chat runtime flow",
          priority: "blocking",
          requirement_ids: ["REQ-chat"],
          acceptance_spec_count: 1,
          runtime_scenario_count: 1,
        }],
      }),
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
    const dir = await frontendFixture({ interactive: false })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_runtime_benchmark_fail",
        runID: "run_runtime_benchmark_fail",
        deliveryID: "dlv_runtime_benchmark_fail",
        changedFiles: ["dist/index.html"],
        goals: [{
          id: "gol_chat_runtime",
          title: "Chat runtime flow",
          priority: "blocking",
          requirement_ids: ["REQ-chat"],
          acceptance_spec_count: 1,
          runtime_scenario_count: 1,
        }],
      }),
    })

    expect(manifest.finalGate.status).toBe("failed")
    expect(manifest.finalGate.failedRuntimeFlowIds).toEqual(["runtime:web:."])
    expect(manifest.runtimeFlows[0]?.evidence.join("\n")).toContain("interaction_required_but_missing")
  }, 60_000)

  test("structured runtime scenario evaluates the post-interaction DOM for auth-gated apps", async () => {
    const dir = await frontendFixture({ interactive: "auth-gated" })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_runtime_auth_gate",
        runID: "run_runtime_auth_gate",
        deliveryID: "dlv_runtime_auth_gate",
        changedFiles: ["dist/index.html"],
        goals: [{
          id: "gol_auth_runtime",
          title: "Mock login runtime flow",
          priority: "blocking",
          requirement_ids: ["REQ-auth"],
          acceptance_spec_count: 1,
          runtime_scenario_count: 1,
        }],
      }),
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
    dependencies: {
      react: "0.0.0",
    },
    scripts: {
      build: "bun -e \"console.log('build ok')\"",
    },
  }, null, 2))
  await fs.writeFile(path.join(dir, "dist", "index.html"), htmlFixture(input.interactive))
  return dir
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
