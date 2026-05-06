import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import {
  ZipReader,
  ZipWriter,
  BlobReader,
  BlobWriter,
  TextReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

async function seedTask(directory: string, opts: { title: string; request: string }) {
  return await Instance.provide({
    directory,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      Database.use((db) => {
        db.insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            source: "test",
            title: opts.title,
            request: opts.request,
            priority: "normal",
            time_created: now,
            time_updated: now,
          })
          .run()
      })
      return taskID
    },
  })
}

async function readZipEntries(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob))
  const entries = await reader.getEntries()
  const result: Record<string, { directory: boolean; data?: Uint8Array; text?: string }> = {}
  for (const entry of entries) {
    if (entry.directory) {
      result[entry.filename] = { directory: true }
      continue
    }
    const data = await entry.getData!(new Uint8ArrayWriter())
    result[entry.filename] = {
      directory: false,
      data,
      text: new TextDecoder("utf-8", { fatal: false }).decode(data),
    }
  }
  await reader.close()
  return result
}

async function buildSyntheticArchive(input: {
  taskID: string
  request: string
  title?: string
  files: Record<string, string>
  manifest?: Record<string, unknown>
}): Promise<Blob> {
  const blobWriter = new BlobWriter("application/zip")
  const writer = new ZipWriter(blobWriter)
  const manifest = input.manifest ?? {
    format: "opencorvus-task-archive",
    version: 1,
    exportedAt: new Date().toISOString(),
    source: { taskID: input.taskID },
  }
  await writer.add("manifest.json", new TextReader(JSON.stringify(manifest)))
  await writer.add(
    "task.json",
    new TextReader(
      JSON.stringify({
        task: {
          id: input.taskID,
          title: input.title ?? "Imported task",
          request: input.request,
          source: "test",
          projectID: "synthetic",
        },
      }),
    ),
  )
  for (const [rel, contents] of Object.entries(input.files)) {
    await writer.add(`project/${rel}`, new TextReader(contents))
  }
  await writer.close()
  return blobWriter.getData()
}

describe("export archive routes", () => {
  test("GET /export/task/:taskID/archive bundles task.json + project tree honoring .gitignore", async () => {
    await using tmp = await tmpdir({ git: true })
    // Tracked files (including the gitignore itself)
    await fs.writeFile(path.join(tmp.path, ".gitignore"), "ignored.txt\nbuild/\n")
    await fs.writeFile(path.join(tmp.path, "keep.txt"), "kept content")
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "src", "main.ts"), "console.log('hi')")
    // Files that MUST be excluded
    await fs.writeFile(path.join(tmp.path, "ignored.txt"), "secret")
    await fs.mkdir(path.join(tmp.path, "build"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "build", "out.js"), "// generated")
    // Commit so `git ls-files --cached` has something to enumerate.
    await $`git add -A`.cwd(tmp.path).quiet()
    await $`git -c user.name=test -c user.email=t@t commit -m setup`.cwd(tmp.path).quiet()

    const taskID = await seedTask(tmp.path, { title: "T1", request: "Do thing" })

    const response = await Server.App().request(`/export/task/${taskID}/archive`, {
      headers: { "x-opencorvus-directory": tmp.path },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/zip")
    expect(response.headers.get("content-disposition")).toContain(`task-${taskID}.zip`)

    const blob = await response.blob()
    const entries = await readZipEntries(blob)

    expect(entries["manifest.json"]).toBeDefined()
    expect(entries["task.json"]).toBeDefined()
    const manifest = JSON.parse(entries["manifest.json"]!.text!)
    expect(manifest.format).toBe("opencorvus-task-archive")
    expect(manifest.version).toBe(1)
    expect(manifest.source.taskID).toBe(taskID)

    const taskExport = JSON.parse(entries["task.json"]!.text!)
    expect(taskExport.task.id).toBe(taskID)
    expect(taskExport.task.title).toBe("T1")
    expect(taskExport.task.request).toBe("Do thing")

    expect(entries["project/keep.txt"]).toBeDefined()
    expect(entries["project/keep.txt"]!.text).toBe("kept content")
    expect(entries["project/src/main.ts"]).toBeDefined()
    expect(entries["project/src/main.ts"]!.text).toBe("console.log('hi')")
    expect(entries["project/.gitignore"]).toBeDefined()

    // The whole point of the test: gitignored files MUST be absent.
    expect(entries["project/ignored.txt"]).toBeUndefined()
    expect(entries["project/build/out.js"]).toBeUndefined()
  })

  test("GET /export/task/:taskID/archive includes uncommitted-but-untracked-and-not-ignored files", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, ".gitignore"), "ignored.txt\n")
    await $`git add -A`.cwd(tmp.path).quiet()
    await $`git -c user.name=test -c user.email=t@t commit -m setup`.cwd(tmp.path).quiet()
    // Untracked but not ignored: must be bundled (parity with `git ls-files --others --exclude-standard`).
    await fs.writeFile(path.join(tmp.path, "draft.md"), "wip")
    // Untracked AND ignored: must be excluded.
    await fs.writeFile(path.join(tmp.path, "ignored.txt"), "secret")

    const taskID = await seedTask(tmp.path, { title: "T2", request: "draft check" })

    const response = await Server.App().request(`/export/task/${taskID}/archive`, {
      headers: { "x-opencorvus-directory": tmp.path },
    })
    expect(response.status).toBe(200)
    const entries = await readZipEntries(await response.blob())
    expect(entries["project/draft.md"]).toBeDefined()
    expect(entries["project/draft.md"]!.text).toBe("wip")
    expect(entries["project/ignored.txt"]).toBeUndefined()
  })

  test("POST /export/import restores files into an empty git directory and creates a new task", async () => {
    await using src = await tmpdir({ git: true })
    await fs.writeFile(path.join(src.path, ".gitignore"), "secret.txt\n")
    await fs.writeFile(path.join(src.path, "README.md"), "hello world")
    await fs.mkdir(path.join(src.path, "lib"), { recursive: true })
    await fs.writeFile(path.join(src.path, "lib", "util.ts"), "export const x = 1")
    await fs.writeFile(path.join(src.path, "secret.txt"), "ignored")
    await $`git add -A`.cwd(src.path).quiet()
    await $`git -c user.name=test -c user.email=t@t commit -m setup`.cwd(src.path).quiet()
    const sourceTaskID = await seedTask(src.path, {
      title: "Original task",
      request: "implement export+import",
    })

    const exportRes = await Server.App().request(`/export/task/${sourceTaskID}/archive`, {
      headers: { "x-opencorvus-directory": src.path },
    })
    expect(exportRes.status).toBe(200)
    const archive = await exportRes.blob()

    // Fresh directory for import — must already be a git repo (rule 7:
    // import does not auto-init; use POST /project/current/init-git first).
    await using dst = await tmpdir({ git: true })

    const importRes = await Server.App().request(`/export/import`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": dst.path,
        "content-type": "application/zip",
      },
      body: await archive.arrayBuffer(),
    })
    expect(importRes.status).toBe(201)
    const summary = (await importRes.json()) as {
      taskID: string
      importedFromTaskID?: string
      restoredFiles: number
      directory: string
    }
    expect(summary.taskID).toMatch(/^tsk_/)
    expect(summary.taskID).not.toBe(sourceTaskID)
    expect(summary.importedFromTaskID).toBe(sourceTaskID)
    expect(summary.restoredFiles).toBeGreaterThanOrEqual(2)
    expect((summary as { skippedFiles?: string[] }).skippedFiles ?? []).toContain(".gitignore")
    expect(summary.directory).toBe(dst.path)

    expect(await fs.readFile(path.join(dst.path, "README.md"), "utf8")).toBe("hello world")
    expect(await fs.readFile(path.join(dst.path, "lib", "util.ts"), "utf8")).toBe("export const x = 1")
    // Default import preserves target files. Instance bootstrap has already
    // created the target .gitignore, so the source .gitignore is reported as
    // skipped unless the operator explicitly chooses overwrite=true.
    const gitignoreText = await fs.readFile(path.join(dst.path, ".gitignore"), "utf8")
    expect(gitignoreText.startsWith("secret.txt\n")).toBe(false)
    // Gitignored file from the source MUST NOT have been bundled.
    expect(await fs.access(path.join(dst.path, "secret.txt")).then(() => true).catch(() => false)).toBe(false)

    // Verify the new task is queryable in the destination project and carries
    // the imported_from breadcrumb in its metadata.
    await Instance.provide({
      directory: dst.path,
      fn: async () => {
        Database.use((db) => {
          const rows = db
            .select()
            .from(EngineTaskTable)
            .all()
          const newTask = rows.find((r) => r.id === summary.taskID)
          expect(newTask).toBeDefined()
          expect(newTask!.title).toBe("Original task")
          expect(newTask!.request).toBe("implement export+import")
          expect(newTask!.source).toBe("import")
          const md = newTask!.metadata as { imported_from?: { taskID?: string } } | null
          expect(md?.imported_from?.taskID).toBe(sourceTaskID)
        })
      },
    })
  })

  test("POST /export/import skips existing files by default", async () => {
    await using dst = await tmpdir({ git: true })
    await fs.writeFile(path.join(dst.path, "existing.txt"), "stale content")

    const archive = await buildSyntheticArchive({
      taskID: Identifier.ascending("task"),
      request: "test",
      files: { "existing.txt": "fresh content", "new.txt": "imported" },
    })

    const res = await Server.App().request(`/export/import`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": dst.path,
        "content-type": "application/zip",
      },
      body: await archive.arrayBuffer(),
    })
    expect(res.status).toBe(201)
    const summary = (await res.json()) as { restoredFiles: number; skippedFiles: string[] }
    expect(summary.restoredFiles).toBe(1)
    expect(summary.skippedFiles).toEqual(["existing.txt"])
    // Existing file preserved; only new files are restored.
    expect(await fs.readFile(path.join(dst.path, "existing.txt"), "utf8")).toBe("stale content")
    expect(await fs.readFile(path.join(dst.path, "new.txt"), "utf8")).toBe("imported")
  })

  test("POST /export/import?overwrite=true replaces existing files explicitly", async () => {
    await using dst = await tmpdir({ git: true })
    await fs.writeFile(path.join(dst.path, "existing.txt"), "stale content")

    const archive = await buildSyntheticArchive({
      taskID: Identifier.ascending("task"),
      request: "test",
      files: { "existing.txt": "fresh content", "new.txt": "imported" },
    })

    const res = await Server.App().request(`/export/import?overwrite=true`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": dst.path,
        "content-type": "application/zip",
      },
      body: await archive.arrayBuffer(),
    })
    expect(res.status).toBe(201)
    const summary = (await res.json()) as { restoredFiles: number; skippedFiles: string[] }
    expect(summary.restoredFiles).toBe(2)
    expect(summary.skippedFiles).toEqual([])
    expect(await fs.readFile(path.join(dst.path, "existing.txt"), "utf8")).toBe("fresh content")
    expect(await fs.readFile(path.join(dst.path, "new.txt"), "utf8")).toBe("imported")
  })

  test("POST /export/import?overwrite=false skips files that already exist", async () => {
    await using dst = await tmpdir({ git: true })
    await fs.writeFile(path.join(dst.path, "existing.txt"), "do not touch")

    const archive = await buildSyntheticArchive({
      taskID: Identifier.ascending("task"),
      request: "merge into existing dir",
      files: { "existing.txt": "would clobber", "new.txt": "imported" },
    })

    const res = await Server.App().request(`/export/import?overwrite=false`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": dst.path,
        "content-type": "application/zip",
      },
      body: await archive.arrayBuffer(),
    })
    expect(res.status).toBe(201)
    const summary = (await res.json()) as { restoredFiles: number; skippedFiles: string[] }
    expect(summary.restoredFiles).toBe(1)
    expect(summary.skippedFiles).toEqual(["existing.txt"])
    // Original preserved; only new files written.
    expect(await fs.readFile(path.join(dst.path, "existing.txt"), "utf8")).toBe("do not touch")
    expect(await fs.readFile(path.join(dst.path, "new.txt"), "utf8")).toBe("imported")
  })

  test("POST /export/import rejects zip-slip attempts (../ in entry name)", async () => {
    await using dst = await tmpdir({ git: true })

    // Hand-craft a zip with a malicious entry. We bypass the normal helper
    // because zip.js's add() does its own normalization.
    const blobWriter = new BlobWriter("application/zip")
    const writer = new ZipWriter(blobWriter)
    await writer.add(
      "manifest.json",
      new TextReader(
        JSON.stringify({ format: "opencorvus-task-archive", version: 1 }),
      ),
    )
    await writer.add(
      "task.json",
      new TextReader(JSON.stringify({ task: { id: "task_x", request: "x" } })),
    )
    // Filename retained verbatim by zip.js — confirmed by reading back.
    await writer.add("project/../escape.txt", new TextReader("pwned"))
    await writer.close()
    const archive = await blobWriter.getData()

    const res = await Server.App().request(`/export/import`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": dst.path,
        "content-type": "application/zip",
      },
      body: await archive.arrayBuffer(),
    })
    expect(res.status).toBe(400)
    // Verify nothing escaped to the parent directory.
    const parent = path.dirname(dst.path)
    expect(
      await fs.access(path.join(parent, "escape.txt")).then(() => true).catch(() => false),
    ).toBe(false)
  })

  test("POST /export/import rejects unsupported manifest version", async () => {
    await using dst = await tmpdir({ git: true })
    const archive = await buildSyntheticArchive({
      taskID: Identifier.ascending("task"),
      request: "test",
      files: {},
      manifest: {
        format: "opencorvus-task-archive",
        version: 99,
      },
    })

    const res = await Server.App().request(`/export/import`, {
      method: "POST",
      headers: {
        "x-opencorvus-directory": dst.path,
        "content-type": "application/zip",
      },
      body: await archive.arrayBuffer(),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { name?: string; data?: { message?: string }; message?: string }
    const message = body.data?.message ?? body.message ?? ""
    expect(message).toMatch(/version/i)
  })

  test("POST /export/import rejects malformed body", async () => {
    await using dst = await tmpdir({ git: true })

    // Empty body
    const empty = await Server.App().request(`/export/import`, {
      method: "POST",
      headers: { "x-opencorvus-directory": dst.path, "content-type": "application/zip" },
      body: new Uint8Array(),
    })
    expect(empty.status).toBe(400)

    // Non-zip bytes
    const garbage = await Server.App().request(`/export/import`, {
      method: "POST",
      headers: { "x-opencorvus-directory": dst.path, "content-type": "application/zip" },
      body: new TextEncoder().encode("not a zip"),
    })
    expect(garbage.status).toBe(400)
  })
})
