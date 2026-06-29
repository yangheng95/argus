import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

describe("MCP prompt and resource listing", () => {
  test(
    "runs the mocked MCP client fail-fast suite in an isolated process",
    async () => {
      const bun = Bun.which("bun") ?? process.execPath
      const isolated = resolve(import.meta.dir, "prompt-resource-fail-fast.isolated.ts")
      const home = await mkdtemp(join(tmpdir(), "opencorvus-mcp-isolated-"))
      try {
        const env = {
          ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])),
          OPENCORVUS_HOME: join(home, "portable"),
          OPENCORVUS_TEST_HOME: join(home, "home"),
          OPENCORVUS_TEST_MANAGED_CONFIG_DIR: join(home, "managed"),
          XDG_DATA_HOME: join(home, "share"),
          XDG_CACHE_HOME: join(home, "cache"),
          XDG_CONFIG_HOME: join(home, "config"),
          XDG_STATE_HOME: join(home, "state"),
        }
        const proc = Bun.spawn([bun, "test", isolated], {
          cwd: resolve(import.meta.dir, "../../.."),
          env,
          stdout: "pipe",
          stderr: "pipe",
        })
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ])
        if (exitCode !== 0) {
          throw new Error(
            [`isolated MCP prompt/resource suite failed with exit code ${exitCode}`, stdout, stderr].join("\n"),
          )
        }
        const output = `${stdout}\n${stderr}`
        expect(output).toContain("10 pass")
        expect(output).toContain("0 fail")
      } finally {
        await rm(home, { recursive: true, force: true }).catch(() => undefined)
      }
    },
    { timeout: 120_000 },
  )
})
