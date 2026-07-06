import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ImportCommand, importSessionData } from "../../src/cli/cmd/import"
import { Instance } from "../../src/project/instance"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { count, Database } from "../../src/storage/db"

const originalCwd = process.cwd()
const originalHome = process.env.OPENCORVUS_HOME
const tempDirs: string[] = []

function mktemp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function handler() {
  if (!ImportCommand.handler) throw new Error("ImportCommand handler missing")
  return ImportCommand.handler as (args: { file: string }) => Promise<void>
}

function importedRowCounts() {
  return Database.use((db) => ({
    sessions: db.select({ count: count() }).from(SessionTable).get()!.count,
    messages: db.select({ count: count() }).from(MessageTable).get()!.count,
    parts: db.select({ count: count() }).from(PartTable).get()!.count,
  }))
}

function runImportCli(file: string) {
  const tempHome = mktemp("opencorvus-import-cli-home-")
  const projectDir = mktemp("opencorvus-import-cli-project-")
  return spawnSync(process.execPath, [path.resolve(import.meta.dir, "../../src/index.ts"), "import", file], {
    cwd: projectDir,
    env: {
      ...process.env,
      OPENCORVUS_HOME: tempHome,
    },
    encoding: "utf8",
    timeout: 45_000,
  })
}

async function withIsolatedCli(fn: (projectDir: string) => Promise<void>) {
  const tempHome = mktemp("opencorvus-import-home-")
  const projectDir = mktemp("opencorvus-import-project-")
  process.env.OPENCORVUS_HOME = tempHome
  process.chdir(projectDir)
  await fn(projectDir)
}

afterEach(async () => {
  mock.restore()
  Database.close()
  await Instance.disposeAll()
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.OPENCORVUS_HOME
  else process.env.OPENCORVUS_HOME = originalHome
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

describe("import command input failures", () => {
  test("missing import file rejects and leaves import target tables empty", async () => {
    await withIsolatedCli(async () => {
      const stdout = spyOn(process.stdout, "write").mockImplementation(() => true)
      const missing = path.join(process.cwd(), "missing-session.json")

      await expect(handler()({ file: missing })).rejects.toThrow(`Import file not found: ${missing}`)

      expect(stdout).not.toHaveBeenCalled()
      expect(importedRowCounts()).toEqual({ sessions: 0, messages: 0, parts: 0 })
    })
  })

  test("malformed import JSON rejects distinctly and leaves import target tables empty", async () => {
    await withIsolatedCli(async () => {
      const stdout = spyOn(process.stdout, "write").mockImplementation(() => true)
      const malformed = path.join(process.cwd(), "malformed-session.json")
      fs.writeFileSync(malformed, "{not-json")

      await expect(handler()({ file: malformed })).rejects.toThrow(`Import file is not valid JSON: ${malformed}`)

      expect(stdout).not.toHaveBeenCalled()
      expect(importedRowCounts()).toEqual({ sessions: 0, messages: 0, parts: 0 })
    })
  })

  test("source no longer collapses read failures into successful stdout output", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dir, "../../src/cli/cmd/import.ts"), "utf8")

    expect(source).not.toContain(".catch(() => undefined)")
    expect(source).not.toContain("File not found:")
    expect(source).not.toContain("Failed to read session data")
  })

  test("CLI process exits nonzero for missing import file", () => {
    const missing = path.join(os.tmpdir(), `opencorvus-missing-import-${Date.now()}.json`)

    const result = runImportCli(missing)

    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain("Imported session")
    expect(result.stderr).toContain(`Import file not found: ${missing}`)
  })

  test("CLI process exits nonzero for malformed import JSON", () => {
    const malformed = path.join(mktemp("opencorvus-import-cli-file-"), "malformed-session.json")
    fs.writeFileSync(malformed, "{not-json")

    const result = runImportCli(malformed)

    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain("Imported session")
    expect(result.stderr).toContain(`Import file is not valid JSON: ${malformed}`)
  })
})

describe("import command session part write boundary", () => {
  test("normalizes json_schema format defaults before snapshot import", async () => {
    await withIsolatedCli(async (projectDir) => {
      const now = Date.now()

      await Instance.provide({
        directory: projectDir,
        fn: async () => {
          await importSessionData({
            info: {
              id: "ses_import_format_default",
              slug: "import-format-default",
              projectID: Instance.project.id,
              version: "local",
              directory: process.cwd(),
              title: "Format default import",
              kind: "root",
              time: { created: now, updated: now },
            } as any,
            messages: [
              {
                info: {
                  id: "msg_import_format_default",
                  sessionID: "ses_import_format_default",
                  role: "user",
                  time: { created: now },
                  format: {
                    type: "json_schema",
                    schema: { type: "object" },
                  },
                  agent: "orchestrator",
                  model: {
                    providerID: "test",
                    modelID: "test",
                  },
                } as any,
                parts: [],
              },
            ],
          })
        },
      })

      const messageRow = Database.use((db) => db.select({ data: MessageTable.data }).from(MessageTable).get())
      expect((messageRow?.data as any).format.retryCount).toBe(2)
      expect(importedRowCounts()).toEqual({ sessions: 1, messages: 1, parts: 0 })
    })
  })

  test("rejects inline base64 part data through Session.updatePart", async () => {
    await withIsolatedCli(async (projectDir) => {
      const now = Date.now()

      await Instance.provide({
        directory: projectDir,
        fn: async () => {
          await expect(
            importSessionData({
              info: {
                id: "ses_import_inline_guard",
                slug: "import-inline-guard",
                projectID: Instance.project.id,
                version: "local",
                directory: process.cwd(),
                title: "Inline guard import",
                kind: "root",
                time: { created: now, updated: now },
              } as any,
              messages: [
                {
                  info: {
                    id: "msg_import_inline_guard",
                    sessionID: "ses_import_inline_guard",
                    role: "user",
                    time: { created: now },
                    agent: "user",
                    model: { providerID: "test", modelID: "test" },
                  } as any,
                  parts: [
                    {
                      id: "prt_import_inline_guard",
                      sessionID: "ses_import_inline_guard",
                      messageID: "msg_import_inline_guard",
                      type: "file",
                      mime: "image/png",
                      filename: "inline.png",
                      url: "data:image/png;base64,UE5H",
                    } as any,
                  ],
                },
              ],
            }),
          ).rejects.toThrow("refusing inline base64 data URL")
        },
      })

      expect(importedRowCounts()).toEqual({ sessions: 0, messages: 0, parts: 0 })
    })
  })
})
