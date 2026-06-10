import { describe, expect, test } from "bun:test"
import { DefaultServeCommand, ServeCommand, handleServeCommand } from "../../src/cli/cmd/serve"

describe("serve default command", () => {
  test("bare overlay-server execution routes to the serve handler", () => {
    expect(DefaultServeCommand.command).toBe("$0")
    expect(DefaultServeCommand.handler).toBe(handleServeCommand)
    expect(ServeCommand.handler).toBe(handleServeCommand)
  })
})
