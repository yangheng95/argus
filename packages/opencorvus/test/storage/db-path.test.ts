import { afterEach, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Global } from "../../src/global"
import { Database } from "../../src/storage/db"

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
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
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

test("Database.reset removes the global DB and the specified project's scratch", async () => {
  const tempHome = mktemp("opencorvus-db-home-")
  const projectDir = mktemp("opencorvus-db-project-")
  process.env.OPENCORVUS_HOME = tempHome

  const dbPath = Database.Path()
  const snapshotDir = path.join(Global.Path.data, "snapshot")
  const worktreesDir = path.join(projectDir, ".opencorvus", "worktrees")
  const ownershipDir = path.join(projectDir, ".opencorvus", "ownership")

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, "db")
  fs.writeFileSync(`${dbPath}-wal`, "wal")
  fs.writeFileSync(`${dbPath}-shm`, "shm")
  fs.mkdirSync(snapshotDir, { recursive: true })
  fs.writeFileSync(path.join(snapshotDir, "snap.txt"), "snap")
  fs.mkdirSync(worktreesDir, { recursive: true })
  fs.writeFileSync(path.join(worktreesDir, "worktree.txt"), "worktree")
  fs.mkdirSync(ownershipDir, { recursive: true })
  fs.writeFileSync(path.join(ownershipDir, "owner.txt"), "owner")

  const results = await Database.reset(projectDir)

  expect(results.map((item) => item.path)).toEqual([
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
    snapshotDir,
    worktreesDir,
    ownershipDir,
  ])
  expect(results.every((item) => item.ok)).toBe(true)
  expect(fs.existsSync(dbPath)).toBe(false)
  expect(fs.existsSync(snapshotDir)).toBe(false)
  expect(fs.existsSync(worktreesDir)).toBe(false)
  expect(fs.existsSync(ownershipDir)).toBe(false)
})
