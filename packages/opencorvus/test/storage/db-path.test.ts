import { afterEach, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"
import { Global } from "../../src/global"
import { Database, DatabaseSchemaResetRequiredError } from "../../src/storage/db"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

const originalCwd = process.cwd()
const originalHome = process.env.OPENCORVUS_HOME
const tempDirs: string[] = []

function mktemp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  Database.close()
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.OPENCORVUS_HOME
  else process.env.OPENCORVUS_HOME = originalHome
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

test("Database.Path is single-source and no longer depends on cwd", () => {
  delete process.env.OPENCORVUS_HOME
  const firstCwd = mktemp("opencorvus-db-cwd-a-")
  const secondCwd = mktemp("opencorvus-db-cwd-b-")

  process.chdir(firstCwd)
  const first = Database.Path()
  process.chdir(secondCwd)
  const second = Database.Path()

  expect(first).toBe(path.join(Global.Path.data, "opencorvus.db"))
  expect(second).toBe(path.join(Global.Path.data, "opencorvus.db"))
  expect(second).toBe(first)
})

test("Database.Path follows Global.Path.data when OPENCORVUS_HOME is set", () => {
  const tempHome = mktemp("opencorvus-db-home-path-")
  process.env.OPENCORVUS_HOME = tempHome

  expect(Database.Path()).toBe(path.join(Global.Path.data, "opencorvus.db"))
  expect(Database.Path()).toBe(path.join(tempHome, "data", "opencorvus.db"))
})

test("Database.reset removes the runtime DB and the specified project's scratch", async () => {
  const tempHome = mktemp("opencorvus-db-home-")
  const projectDir = mktemp("opencorvus-db-project-")
  process.env.OPENCORVUS_HOME = tempHome

  const dbPath = Database.Path()
  const runtimeDir = ProjectRuntimePaths.projectRuntimeRoot(projectDir)
  const worktreesDir = path.join(projectDir, ".opencorvus", "worktrees")
  const ownershipDir = path.join(projectDir, ".opencorvus", "ownership")

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, "db")
  fs.writeFileSync(`${dbPath}-wal`, "wal")
  fs.writeFileSync(`${dbPath}-shm`, "shm")
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(path.join(runtimeDir, "runtime.txt"), "runtime")
  fs.mkdirSync(worktreesDir, { recursive: true })
  fs.writeFileSync(path.join(worktreesDir, "worktree.txt"), "worktree")
  fs.mkdirSync(ownershipDir, { recursive: true })
  fs.writeFileSync(path.join(ownershipDir, "owner.txt"), "owner")

  const results = await Database.reset(projectDir)

  expect(results.map((item) => item.path)).toEqual([
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
    runtimeDir,
    ...ProjectRuntimePaths.legacyRuntimeRelativePaths.map((relative) => path.join(projectDir, ...relative.split("/"))),
  ])
  expect(results.every((item) => item.ok)).toBe(true)
  expect(fs.existsSync(dbPath)).toBe(false)
  expect(fs.existsSync(runtimeDir)).toBe(false)
  expect(fs.existsSync(worktreesDir)).toBe(false)
  expect(fs.existsSync(ownershipDir)).toBe(false)
})

test("Database.resetFiles removes only the provided current DB files", async () => {
  const tempHome = mktemp("opencorvus-db-files-home-")
  const projectDir = mktemp("opencorvus-db-files-project-")
  process.env.OPENCORVUS_HOME = tempHome

  const dbPath = Database.Path()
  const runtimeDir = ProjectRuntimePaths.projectRuntimeRoot(projectDir)
  const legacyRuntimeDir = path.join(projectDir, ".opencorvus", "runtime")

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, "db")
  fs.writeFileSync(`${dbPath}-wal`, "wal")
  fs.writeFileSync(`${dbPath}-shm`, "shm")
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(path.join(runtimeDir, "runtime.txt"), "runtime")
  fs.mkdirSync(legacyRuntimeDir, { recursive: true })
  fs.writeFileSync(path.join(legacyRuntimeDir, "legacy.txt"), "legacy")

  const results = await Database.resetFiles(dbPath)

  expect(results.map((item) => item.path)).toEqual([dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
  expect(results.every((item) => item.ok)).toBe(true)
  expect(fs.existsSync(dbPath)).toBe(false)
  expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
  expect(fs.existsSync(`${dbPath}-shm`)).toBe(false)
  expect(fs.readFileSync(path.join(runtimeDir, "runtime.txt"), "utf8")).toBe("runtime")
  expect(fs.readFileSync(path.join(legacyRuntimeDir, "legacy.txt"), "utf8")).toBe("legacy")
})

test("Database.resetFiles rejects relative database paths before deleting files", async () => {
  const tempHome = mktemp("opencorvus-db-files-relative-home-")
  process.env.OPENCORVUS_HOME = tempHome

  const dbPath = Database.Path()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, "db")

  await expect(Database.resetFiles("relative-opencorvus.db")).rejects.toThrow(/absolute path/)
  expect(fs.existsSync(dbPath)).toBe(true)
})

test("Database.resetFiles rejects non-current absolute database paths before deleting files", async () => {
  const tempHome = mktemp("opencorvus-db-files-current-home-")
  const otherDir = mktemp("opencorvus-db-files-current-other-")
  process.env.OPENCORVUS_HOME = tempHome

  const dbPath = Database.Path()
  const otherDbPath = path.join(otherDir, "opencorvus.db")
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.mkdirSync(path.dirname(otherDbPath), { recursive: true })
  fs.writeFileSync(dbPath, "db")
  fs.writeFileSync(otherDbPath, "other")

  await expect(Database.resetFiles(otherDbPath)).rejects.toThrow(/Database\.Path/)
  expect(fs.readFileSync(dbPath, "utf8")).toBe("db")
  expect(fs.readFileSync(otherDbPath, "utf8")).toBe("other")
})

test("Database.Client requires explicit reset for stale on-disk schema and preserves the file", () => {
  const tempHome = mktemp("opencorvus-db-stale-schema-")
  process.env.OPENCORVUS_HOME = tempHome

  const dbPath = Database.Path()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const stale = new BunDatabase(dbPath, { create: true })
  stale.exec(`
    CREATE TABLE engine_artifact (
      id           text PRIMARY KEY,
      task_id      text NOT NULL,
      run_id       text,
      goal_run_id  text,
      kind         text NOT NULL,
      label        text NOT NULL,
      payload      text,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    );
    INSERT INTO engine_artifact (
      id, task_id, run_id, goal_run_id, kind, label, payload, time_created, time_updated
    ) VALUES (
      'stale-artifact', 'task-1', NULL, NULL, 'acceptance', 'stale', '{}', 1, 1
    );
  `)
  stale.close()

  try {
    Database.Client()
    throw new Error("Database.Client should have required an explicit reset")
  } catch (error) {
    expect(DatabaseSchemaResetRequiredError.isInstance(error)).toBe(true)
    expect(error instanceof Error ? error.message : String(error)).toContain(dbPath)
  }

  const current = new BunDatabase(dbPath)
  try {
    const columns = current
      .query<{ name: string }, []>("PRAGMA table_info(engine_artifact)")
      .all()
      .map((column) => column.name)
    const staleRows = current.query<{ count: number }, []>("SELECT count(*) AS count FROM engine_artifact").get()

    expect(columns).not.toContain("acceptance_id")
    expect(staleRows?.count).toBe(1)
  } finally {
    current.close()
  }
})

test("Database.reset rejects relative project directories before deleting files", async () => {
  const tempHome = mktemp("opencorvus-db-reset-relative-home-")
  process.env.OPENCORVUS_HOME = tempHome

  const dbPath = Database.Path()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, "db")

  await expect(Database.reset("relative-project")).rejects.toThrow(/absolute path/)
  expect(fs.existsSync(dbPath)).toBe(true)
})
