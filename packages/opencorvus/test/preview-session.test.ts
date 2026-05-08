import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  ensureManagedPreviewSession,
  getManagedPreviewSession,
  stopAllManagedPreviewSessions,
  stopManagedPreviewSession,
} from "../src/preview/session"

const tempDirs: string[] = []

afterEach(async () => {
  await stopAllManagedPreviewSessions()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("managed frontend preview session", () => {
  test("starts an explicit dev command and keeps a task-scoped preview URL", async () => {
    const dir = await packageFixture({
      "scripts/dev-server.ts": `
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() {
    return new Response("<!doctype html><html><body><main>managed preview session</main></body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
console.log("Local: http://127.0.0.1:" + server.port + "/");
await new Promise(() => {});
`,
    })

    const session = await ensureManagedPreviewSession({
      taskID: "tsk_preview_session",
      workspaceDir: dir,
    })

    expect(session.status).toBe("ready")
    expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    expect(session.evidence).toContain("managed_preview_command=bun run dev")
    expect(getManagedPreviewSession({ taskID: "tsk_preview_session", workspaceDir: dir })?.url).toBe(session.url)

    await stopManagedPreviewSession({ taskID: "tsk_preview_session", workspaceDir: dir })
    expect(getManagedPreviewSession({ taskID: "tsk_preview_session", workspaceDir: dir })).toBeUndefined()
  }, 60_000)

  test("parses a colored Vite-style loopback URL from dev output", async () => {
    const dir = await packageFixture({
      "scripts/dev-server.ts": `
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() {
    return new Response("<!doctype html><html><body><main>colored url preview</main></body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
console.log("\\u001b[32m➜\\u001b[39m Local: \\u001b[36mhttp://127.0.0.1:\\u001b[1m" + server.port + "\\u001b[22m/\\u001b[39m");
await new Promise(() => {});
`,
    })

    const session = await ensureManagedPreviewSession({
      taskID: "tsk_preview_colored_url",
      workspaceDir: dir,
    })

    expect(session.status).toBe("ready")
    expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  }, 60_000)

  test("starts npm package-manager scripts on Windows command shims", async () => {
    const dir = await packageFixture({
      "scripts/dev-server.mjs": `
import http from "node:http";
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body><main>npm preview session</main></body></html>");
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  console.log("Local: http://127.0.0.1:" + address.port + "/");
});
`,
    }, {
      packageManager: "npm@10.0.0",
      scripts: { dev: "node scripts/dev-server.mjs" },
    })

    const session = await ensureManagedPreviewSession({
      taskID: "tsk_preview_npm_manager",
      workspaceDir: dir,
    })

    expect(session.status).toBe("ready")
    expect(session.command).toBe("npm run dev")
    expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  }, 60_000)

  test("uses explicit metadata preview URL without starting a process", async () => {
    const dir = await packageFixture({})

    const session = await ensureManagedPreviewSession({
      taskID: "tsk_preview_metadata",
      workspaceDir: dir,
      metadata: { previewUrl: "http://127.0.0.1:5555/" },
    })

    expect(session).toMatchObject({
      status: "ready",
      url: "http://127.0.0.1:5555/",
      command: "metadata.previewUrl",
    })
    expect(session.evidence).toContain("preview_source=metadata")
  })

  test("fails when the workspace has no explicit dev script", async () => {
    const dir = await packageFixture({}, { scripts: {} })

    await expect(ensureManagedPreviewSession({
      taskID: "tsk_preview_no_script",
      workspaceDir: dir,
    })).rejects.toThrow("no_preview_start_script")
  })

  test("preserves failed session status and reason when the dev command exits", async () => {
    const dir = await packageFixture({
      "scripts/dev-server.ts": `process.exit(42);`,
    })

    await expect(ensureManagedPreviewSession({
      taskID: "tsk_preview_exit",
      workspaceDir: dir,
    })).rejects.toThrow("preview_process_exited")

    const session = getManagedPreviewSession({
      taskID: "tsk_preview_exit",
      workspaceDir: dir,
    })
    expect(session?.status).toBe("failed")
    expect(session?.reason).toContain("preview_process_exited")
  })
})

async function packageFixture(
  files: Record<string, string>,
  options?: { packageManager?: string; scripts?: Record<string, string> },
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-preview-session-"))
  tempDirs.push(dir)
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    type: "module",
    packageManager: options?.packageManager ?? "bun@1.3.13",
    scripts: options?.scripts ?? { dev: "bun scripts/dev-server.ts" },
  }, null, 2))
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
  return dir
}
