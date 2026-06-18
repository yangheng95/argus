import { describe, expect, spyOn, test } from "bun:test"
import path from "node:path"
import { DefaultServeCommand, ServeCommand, handleServeCommand } from "../../src/cli/cmd/serve"

async function collect(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return ""
  return await new Response(stream).text()
}

async function runOverlayServer(args: string[]) {
  const proc = Bun.spawn(["bun", "src/overlay-server.ts", ...args], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: {
      ...process.env,
      OPENCORVUS_DISABLE_MODELS_FETCH: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([collect(proc.stdout), collect(proc.stderr), proc.exited])
  return { stdout, stderr, exitCode }
}

describe("serve default command", () => {
  test("bare overlay-server execution routes to the serve handler", () => {
    expect(DefaultServeCommand.command).toBe("$0")
    expect(DefaultServeCommand.handler).toBe(handleServeCommand)
    expect(ServeCommand.handler).toBe(handleServeCommand)
  })

  test("global option values before the command do not hide mcp routes", async () => {
    const result = await runOverlayServer(["--log-level", "INFO", "mcp", "serve", "--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("opencorvus mcp serve")
    expect(result.stdout).toContain("--cwd")
    expect(result.stdout).toContain("working directory for the MCP server")
  })

  test("occupied port fails without killing the unrelated listener", async () => {
    const owner = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("owner-alive")
      },
    })
    const port = owner.port
    if (!port) {
      owner.stop(true)
      throw new Error("test listener did not bind to a port")
    }

    const originalArgv = process.argv
    const spawnSync = spyOn(Bun, "spawnSync")
    try {
      process.argv = ["bun", "opencorvus", "serve", "--hostname", "127.0.0.1", "--port", String(port)]
      await expect(
        handleServeCommand({
          hostname: "127.0.0.1",
          port,
          mdns: false,
          "mdns-domain": "opencorvus.local",
          cors: [],
        } as any),
      ).rejects.toThrow(`Failed to start server on port ${port}`)

      expect(spawnSync).not.toHaveBeenCalled()
      const res = await fetch(`http://127.0.0.1:${port}/`)
      expect(await res.text()).toBe("owner-alive")
    } finally {
      process.argv = originalArgv
      spawnSync.mockRestore()
      owner.stop(true)
    }
  })
})
