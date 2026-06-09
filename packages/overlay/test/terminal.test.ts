import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { apiUrl, configure } from "../src/services/api"
import { listTerminalProfiles, openSystemTerminal } from "../src/services/terminal"

const root = join(import.meta.dir, "..")

describe("terminal client", () => {
  test("terminal profile requests use the system terminal route", () => {
    configure({
      serverUrl: "http://127.0.0.1:4099",
      username: "opencorvus",
      password: "secret",
      directory: "C:/work/project",
    })

    const url = new URL(apiUrl("terminal/profiles"))

    expect(url.protocol).toBe("http:")
    expect(url.host).toBe("127.0.0.1:4099")
    expect(url.searchParams.get("directory")).toBe("C:/work/project")
  })

  test("terminal service exposes system terminal calls without PTY sockets", () => {
    const service = readFileSync(join(root, "src/services/terminal.ts"), "utf8")
    const pkg = readFileSync(join(root, "package.json"), "utf8")

    expect(listTerminalProfiles).toBeFunction()
    expect(openSystemTerminal).toBeFunction()
    expect(service).toContain("terminal/profiles?directory=")
    expect(service).toContain('"terminal/open"')
    expect(service).not.toContain("connectTerminal")
    expect(service).not.toContain("apiWebSocketUrl")
    expect(service).not.toContain('"pty"')
    expect(pkg).not.toContain('"@xterm/xterm"')
    expect(pkg).not.toContain('"@xterm/addon-fit"')
  })
})
