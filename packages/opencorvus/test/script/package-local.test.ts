import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

describe("package-local", () => {
  test("fails closed when Docker is unavailable for Linux overlay builds", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../..")
    const emptyPathDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-package-local-no-docker-"))
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue
      if (key.toLowerCase() === "path") continue
      env[key] = value
    }
    env.PATH = emptyPathDir

    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, "run", "script/package-local.ts", "--skip-cli", "--skip-native"],
        cwd: repoRoot,
        env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      const output = `${stdout}\n${stderr}`

      expect(exitCode).not.toBe(0)
      expect(output).toContain("Docker is required for Linux overlay builds")
      expect(output).not.toContain("=== Package complete ===")
    } finally {
      fs.rmSync(emptyPathDir, { recursive: true, force: true })
    }
  })
})
