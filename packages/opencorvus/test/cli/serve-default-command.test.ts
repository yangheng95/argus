import { describe, expect, spyOn, test } from "bun:test"
import { DefaultServeCommand, ServeCommand, handleServeCommand } from "../../src/cli/cmd/serve"

describe("serve default command", () => {
  test("bare overlay-server execution routes to the serve handler", () => {
    expect(DefaultServeCommand.command).toBe("$0")
    expect(DefaultServeCommand.handler).toBe(handleServeCommand)
    expect(ServeCommand.handler).toBe(handleServeCommand)
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
