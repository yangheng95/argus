import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDeliveryTools } from "../../src/delivery/tools"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { stopAllManagedPreviewSessions } from "../../src/preview/session"
import { AttachmentStore } from "../../src/storage/attachment-store"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

afterEach(async () => {
  await stopAllManagedPreviewSessions()
})

describe("delivery review-only tool surface", () => {
  test("does not expose file mutation tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-readonly-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: () => {
          const tools = createDeliveryTools({ taskID: "tsk_readonly" })
          expect(Object.keys(tools)).not.toContain("write_file")
          expect(Object.keys(tools)).not.toContain("edit_file")
          expect(Object.keys(tools)).toContain("run_command")
          expect(Object.keys(tools)).toContain("start_frontend_preview")
          expect(Object.keys(tools)).toContain("screenshot")
          expect(Object.keys(tools)).toContain("inspect_delivery_context")
          expect(Object.keys(tools)).toContain("compare_visual_artifacts")
          expect(Object.keys(tools)).not.toContain("submit_next_task")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("core prompt routes repair through rejection instead of file edits", async () => {
    const prompt = await Bun.file(
      path.join(repoRoot, "packages/opencorvus/src/prompt/core/delivery-core.txt"),
    ).text()

    expect(prompt).toContain("review-only acceptance gate")
    expect(prompt).toContain("MUST NOT edit the deliverable")
    expect(prompt).toContain("orchestrator can send the affected goal(s) back")
    expect(prompt).toContain("start_frontend_preview")
    expect(prompt).toContain("publishes the ready URL to the Overlay")
    expect(prompt).toContain("Orchestrator is the only agent allowed")
    expect(prompt).not.toContain("write_file")
    expect(prompt).not.toContain("edit_file")
    expect(prompt).not.toContain("submit_next_task")
    expect(prompt).not.toContain("Fix aggressively")
    expect(prompt).not.toContain(" or criteria")
  })

  test("delivery tools cannot create follow-up engine tasks", async () => {
    const source = await Bun.file(
      path.join(repoRoot, "packages/opencorvus/src/delivery/tools.ts"),
    ).text()

    expect(source).not.toContain("EngineService.createTask")
    expect(source).not.toContain("submit_next_task")
  })

  test("delivery agent exposes no registry tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-agent-readonly-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const agent = await Agent.get("delivery")
          expect(agent?.description).toContain("without editing deliverables")
          expect(agent?.tools).toEqual({ include: [] })
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("compare_visual_artifacts loads image bytes only when the tool is called", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-visual-tool-"))
    try {
      await Bun.$`git init`.cwd(dir).quiet()
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const rendered = await AttachmentStore.write(Instance.project.id, Buffer.from("rendered"), "image/png", "rendered.png")
          const reference = await AttachmentStore.write(Instance.project.id, Buffer.from("reference"), "image/png", "reference.png")
          const tools = createDeliveryTools({
            taskID: "tsk_visual_tool",
            attachments: [
              { ...rendered, intent: "rendered_output" },
              { ...reference, intent: "visual_reference" },
            ],
          })

          const output = await tools.compare_visual_artifacts.execute!(
            { include_all_references: false },
            {} as any,
          ) as any

          expect(output.text).toContain("rendered_output")
          expect(output.attachments).toHaveLength(2)
          // Post-2026-05-11 contract: tool result attachments are
          // canonical AttachmentStore refs (`/attachment/<projectID>/<sha>.<ext>`),
          // never inline data URLs. The Session.updatePart guard rejects
          // any data:image/...;base64 leakage at the write boundary, so
          // this is the only shape downstream code is allowed to see.
          // (specs/delivery-attachment-store-single-source-2026-05-11.md)
          for (const att of output.attachments) {
            expect(att.url).toStartWith(`/attachment/${Instance.project.id}/`)
            expect(att.url).not.toStartWith("data:")
            expect(AttachmentStore.nameFromUrl(att.url)).toBeTruthy()
          }
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("start_frontend_preview starts the declared dev command and returns the board URL", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-preview-tool-"))
    try {
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
        type: "module",
        packageManager: "bun@1.3.13",
        scripts: { dev: "bun scripts/dev-server.ts" },
      }, null, 2))
      await fs.writeFile(path.join(dir, "bun.lock"), "")
      await fs.mkdir(path.join(dir, "scripts"), { recursive: true })
      await fs.writeFile(path.join(dir, "scripts", "dev-server.ts"), `
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() {
    return new Response("<!doctype html><html><body><main>delivery preview tool</main></body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
console.log("Local: http://127.0.0.1:" + server.port + "/");
await new Promise(() => {});
`)
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const tools = createDeliveryTools({ taskID: "tsk_delivery_preview_tool" })
          const output = await tools.start_frontend_preview.execute!({}, {} as any) as string
          const parsed = JSON.parse(output)

          expect(parsed.ok).toBe(true)
          expect(parsed.status).toBe("ready")
          expect(parsed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
          expect(parsed.board_preview_url).toBe(parsed.url)
          expect(parsed.evidence).toContain("managed_preview_command=bun run dev")
        },
      })
    } finally {
      await stopAllManagedPreviewSessions()
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("start_frontend_preview resolves a frontend subpackage instead of the repo root", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-preview-subpackage-"))
    const webDir = path.join(dir, "packages", "web")
    try {
      await fs.mkdir(path.join(dir, "scripts"), { recursive: true })
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
        type: "module",
        packageManager: "bun@1.3.13",
        scripts: { dev: "bun scripts/root-fail.ts" },
      }, null, 2))
      await fs.writeFile(path.join(dir, "scripts", "root-fail.ts"), "process.exit(1)\n")
      await fs.mkdir(path.join(webDir, "scripts"), { recursive: true })
      await fs.mkdir(path.join(webDir, "src"), { recursive: true })
      await fs.writeFile(path.join(webDir, "package.json"), JSON.stringify({
        type: "module",
        packageManager: "bun@1.3.13",
        scripts: { dev: "bun scripts/dev-server.ts" },
      }, null, 2))
      await fs.writeFile(path.join(webDir, "bun.lock"), "")
      await fs.writeFile(path.join(webDir, "scripts", "dev-server.ts"), `
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() {
    return new Response("<!doctype html><html><body><main>subpackage preview tool</main></body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
console.log("Local: http://127.0.0.1:" + server.port + "/");
await new Promise(() => {});
`)
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const tools = createDeliveryTools({
            taskID: "tsk_delivery_preview_subpackage",
            delivery: { summary: "preview", changedFiles: ["packages/web/src/main.ts"] },
          })
          const output = await tools.start_frontend_preview.execute!({}, {} as any) as string
          const parsed = JSON.parse(output)

          expect(parsed.ok).toBe(true)
          expect(parsed.status).toBe("ready")
          expect(parsed.project_root).toBe(webDir)
          expect(parsed.workspace_dir).toBe(webDir)
          expect(parsed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
        },
      })
    } finally {
      await stopAllManagedPreviewSessions()
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("start_frontend_preview returns resolved root and evidence on preview failure", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-preview-failure-"))
    const webDir = path.join(dir, "packages", "web")
    try {
      await fs.mkdir(webDir, { recursive: true })
      await fs.writeFile(path.join(webDir, "package.json"), JSON.stringify({
        type: "module",
        packageManager: "bun@1.3.13",
        scripts: { dev: "bun -e \"process.exit(1)\"" },
      }, null, 2))
      await fs.writeFile(path.join(webDir, "bun.lock"), "")
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const tools = createDeliveryTools({
            taskID: "tsk_delivery_preview_failure",
            delivery: { summary: "preview", changedFiles: ["packages/web/src/main.ts"] },
          })
          const output = await tools.start_frontend_preview.execute!({}, {} as any) as string
          const parsed = JSON.parse(output)

          expect(parsed.ok).toBe(false)
          expect(parsed.status).toBe("failed")
          expect(parsed.project_root).toBe(webDir)
          expect(parsed.command).toBe("bun run dev")
          expect(parsed.reason).toContain("preview_process_exited")
          expect(parsed.evidence).toContain(`resolved_project_root=${webDir}`)
          expect(parsed.evidence).toContain("managed_preview_command=bun run dev")
        },
      })
    } finally {
      await stopAllManagedPreviewSessions()
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
