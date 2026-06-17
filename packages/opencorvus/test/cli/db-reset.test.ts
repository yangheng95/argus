import { afterEach, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ResetCommand } from "../../src/cli/cmd/db"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
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
  mock.restore()
  Database.close()
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.OPENCORVUS_HOME
  else process.env.OPENCORVUS_HOME = originalHome
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("db reset --force aborts before deleting files when disposeAll rejects", async () => {
  const tempHome = mktemp("opencorvus-cli-reset-home-")
  const projectDir = mktemp("opencorvus-cli-reset-project-")
  process.env.OPENCORVUS_HOME = tempHome
  process.chdir(projectDir)

  const dbPath = Database.Path()
  const runtimeDir = ProjectRuntimePaths.projectRuntimeRoot(projectDir)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, "db")
  fs.writeFileSync(`${dbPath}-wal`, "wal")
  fs.writeFileSync(`${dbPath}-shm`, "shm")
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(path.join(runtimeDir, "runtime.txt"), "runtime")

  const disposeAll = spyOn(Instance, "disposeAll").mockRejectedValue(new Error("dispose failed"))
  const reset = spyOn(Database, "reset")

  expect(ResetCommand.handler).toBeDefined()
  const handler = ResetCommand.handler as (args: { force: boolean }) => Promise<void>
  await expect(handler({ force: true })).rejects.toThrow("dispose failed")

  expect(disposeAll).toHaveBeenCalledTimes(1)
  expect(reset).not.toHaveBeenCalled()
  expect(fs.existsSync(dbPath)).toBe(true)
  expect(fs.existsSync(`${dbPath}-wal`)).toBe(true)
  expect(fs.existsSync(`${dbPath}-shm`)).toBe(true)
  expect(fs.existsSync(path.join(runtimeDir, "runtime.txt"))).toBe(true)
})
