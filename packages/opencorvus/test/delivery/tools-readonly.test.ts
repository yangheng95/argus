import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDeliveryTools } from "../../src/delivery/tools"
import { EngineGoalTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { stopAllManagedPreviewSessions } from "../../src/preview/session"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await stopAllManagedPreviewSessions()
  await resetDatabase()
})

describe("delivery bounded repair tool surface", () => {
  test("exposes bounded file mutation tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-readonly-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: () => {
          const tools = createDeliveryTools({ taskID: "tsk_readonly" })
          expect(Object.keys(tools)).toContain("write_file")
          expect(Object.keys(tools)).toContain("edit_file")
          expect(Object.keys(tools)).toContain("run_command")
          expect(Object.keys(tools)).toContain("start_frontend_preview")
          expect(Object.keys(tools)).toContain("screenshot")
          expect(Object.keys(tools)).toContain("inspect_delivery_context")
          expect(Object.keys(tools)).toContain("run_integrity_review")
          expect(Object.keys(tools)).toContain("compare_visual_artifacts")
          expect(Object.keys(tools)).not.toContain("submit_next_task")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("edit_file applies localized project repairs and blocks path escapes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-repair-"))
    try {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await fs.writeFile(path.join(dir, "src", "app.ts"), "import './missing'\nconsole.log('ok')\n")
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const tools = createDeliveryTools({ taskID: "tsk_repair" })
          const output = await tools.edit_file.execute!(
            {
              path: "src/app.ts",
              old_text: "import './missing'",
              new_text: "import './present'",
              replace_all: false,
            },
            {} as any,
          ) as string

          expect(output).toContain("delivery repair updated src/app.ts")
          expect(await fs.readFile(path.join(dir, "src", "app.ts"), "utf-8")).toContain("import './present'")

          await expect(tools.edit_file.execute!(
            {
              path: "../outside.ts",
              old_text: "x",
              new_text: "y",
              replace_all: false,
            },
            {} as any,
          )).rejects.toThrow("escapes the project root")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("delivery tools cannot create follow-up engine tasks", async () => {
    const source = await Bun.file(
      path.join(repoRoot, "packages/opencorvus/src/delivery/tools.ts"),
    ).text()

    expect(source).not.toContain("EngineService.createTask")
    expect(source).not.toContain("submit_next_task")
  })

  test("integrity review tool requires task and parent session context", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-integrity-context-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const noTaskTools = createDeliveryTools()
          await expect(
            noTaskTools.run_integrity_review.execute!({ reason: "delivery evidence needs semantic review" }, {} as any),
          ).rejects.toThrow("requires taskID")

          const noSessionTools = createDeliveryTools({ taskID: "tsk_integrity_context" })
          await expect(
            noSessionTools.run_integrity_review.execute!(
              { reason: "delivery evidence needs semantic review" },
              {} as any,
            ),
          ).rejects.toThrow("requires delivery session context")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("upstream context hard-fails when architect contract graph is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-missing-graph-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          const specID = Identifier.ascending("spec")
          const goalID = Identifier.ascending("goal")
          Database.use((db) => {
            db.insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                source: "test",
                title: "Missing delivery graph",
                request: "Verify delivery graph is mandatory",
                priority: "normal",
                time_created: now,
                time_updated: now,
              })
              .run()
            db.insert(EngineSpecSnapshotTable)
              .values({
                id: specID,
                task_id: taskID,
                version: 1,
                status: "ready",
                summary: "Spec",
                content: "# Spec",
                scope: "Scope",
                time_created: now,
                time_updated: now,
              })
              .run()
            db.insert(EngineGoalTable)
              .values({
                id: goalID,
                task_id: taskID,
                spec_snapshot_id: specID,
                title: "Goal without graph",
                slug: "goal-without-graph",
                objective: "Create a goal row without graph artifact.",
                acceptance_specs: [],
                owned_paths: ["src/App.tsx"],
                depends_on: [],
                kind: "feature",
                requirement_ids: [],
                priority: "blocking",
                source: "spec",
                order_index: 0,
                time_created: now,
                time_updated: now,
              })
              .run()
          })

          const tools = createDeliveryTools({ taskID })
          await expect(
            tools.inspect_delivery_context.execute!({ section: "upstream_context", max_chars: 12_000 }, {} as any),
          ).rejects.toThrow("missing architect_contract_graph artifact")
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
