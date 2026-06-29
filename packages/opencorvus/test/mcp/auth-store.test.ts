import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"

import { McpAuth } from "../../src/mcp/auth"
import { Filesystem } from "../../src/util/filesystem"

function fsError(message: string, code: string) {
  return Object.assign(new Error(message), { code })
}

describe("McpAuth storage", () => {
  afterEach(() => {
    mock.restore()
  })

  test("missing auth storage is the only empty-store case", async () => {
    spyOn(Filesystem, "readJson").mockRejectedValue(fsError("missing mcp auth", "ENOENT"))

    await expect(McpAuth.all()).resolves.toEqual({})
  })

  test("scopedKey separates same-name MCP servers by project ID", () => {
    expect(McpAuth.scopedKey({ projectID: "project-a", mcpName: "oauth" })).toBe("project-a:oauth")
    expect(McpAuth.scopedKey({ projectID: "project-b", mcpName: "oauth" })).toBe("project-b:oauth")
    expect(() => McpAuth.scopedKey({ projectID: "", mcpName: "oauth" })).toThrow("projectID")
    expect(() => McpAuth.scopedKey({ projectID: "project-a", mcpName: "" })).toThrow("mcpName")
  })

  test("auth storage read failures propagate through all, set, and remove", async () => {
    const readJson = spyOn(Filesystem, "readJson").mockRejectedValue(new Error("invalid mcp auth json"))
    const writeJson = spyOn(Filesystem, "writeJson").mockResolvedValue(undefined)

    await expect(McpAuth.all()).rejects.toThrow("invalid mcp auth json")
    await expect(McpAuth.set("broken", { tokens: { accessToken: "token" } })).rejects.toThrow("invalid mcp auth json")
    await expect(McpAuth.remove("broken")).rejects.toThrow("invalid mcp auth json")

    expect(readJson).toHaveBeenCalled()
    expect(writeJson).not.toHaveBeenCalled()
  })

  test("invalid auth storage schema propagates before writes", async () => {
    spyOn(Filesystem, "readJson").mockResolvedValue({ server: { tokens: { refreshToken: "missing access" } } })
    const writeJson = spyOn(Filesystem, "writeJson").mockResolvedValue(undefined)

    await expect(McpAuth.set("server", { tokens: { accessToken: "next" } })).rejects.toThrow()
    expect(writeJson).not.toHaveBeenCalled()
  })
})
