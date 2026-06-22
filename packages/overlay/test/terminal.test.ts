import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { apiUrl, configure } from "../src/services/api"
import { HOST_CAPABILITIES, __setHostTransportForTest, type HostTransport } from "../src/services/host-transport"
import { listTerminalProfiles, openSystemTerminal } from "../src/services/terminal"
import {
  clearTerminalProfileSelection,
  reloadTerminalProfileSelection,
  selectedTerminalProfileID,
  terminalProfiles,
} from "../src/services/terminal-selection"

const root = join(import.meta.dir, "..")
const WORKSPACE_LAYOUT_CONTROLS_SOURCE = readFileSync(join(root, "src/components/WorkspaceLayoutControls.tsx"), "utf8")
const WORKSPACE_CODING_CLI_LAUNCHERS_SOURCE = readFileSync(
  join(root, "src/components/WorkspaceCodingCliLaunchers.tsx"),
  "utf8",
)

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  clearTerminalProfileSelection()
})

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

  test("terminal profile selection coalesces same-directory in-flight reloads", async () => {
    let requestCount = 0
    let releaseProfiles: () => void = () => undefined
    const profilesReady = new Promise<void>((resolve) => {
      releaseProfiles = resolve
    })
    const transport: HostTransport = {
      kind: "tauri",
      capabilities: HOST_CAPABILITIES.tauri,
      async request(req) {
        expect(req.path).toBe("terminal/profiles")
        expect(req.query?.directory).toBe("C:/repo/app")
        requestCount += 1
        await profilesReady
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            defaultProfileID: "powershell",
            profiles: [{ id: "powershell", label: "PowerShell", icon: "powershell" }],
          },
        }
      },
      openStream() {
        throw new Error("openStream not used in terminal profile selection test")
      },
      async native() {
        return true
      },
      subscribeUiCommand() {
        return { unsubscribe() {} }
      },
    }
    __setHostTransportForTest(transport)

    const first = reloadTerminalProfileSelection({
      directory: " C:/repo/app ",
      defaultProfileMissingMessage: "missing default terminal",
    })
    const second = reloadTerminalProfileSelection({
      directory: "C:/repo/app",
      defaultProfileMissingMessage: "missing default terminal",
    })
    await Promise.resolve()

    expect(requestCount).toBe(1)
    releaseProfiles()
    await Promise.all([first, second])

    expect(terminalProfiles()).toEqual([{ id: "powershell", label: "PowerShell", icon: "powershell" }])
    expect(selectedTerminalProfileID()).toBe("powershell")
  })

  test("workspace launchers reload profile data only when the directory key changes", () => {
    for (const source of [WORKSPACE_LAYOUT_CONTROLS_SOURCE, WORKSPACE_CODING_CLI_LAUNCHERS_SOURCE]) {
      expect(source).toContain("const directory = createMemo(() => activeDirectory().trim())")
      expect(source).toMatch(/createEffect<string>\(\(previous\) => \{[\s\S]*?const next = directory\(\)/)
      expect(source).toContain("if (next === previous) return previous")
      expect(source).toMatch(/void reloadProfiles\(next\)[\s\S]*?return next/)
      expect(source).not.toMatch(/createEffect\(\(\) => \{\s*activeDirectory\(\)\s*void reloadProfiles\(\)/)
    }
    expect(WORKSPACE_LAYOUT_CONTROLS_SOURCE).toContain("reloadTerminalProfileSelection({")
    expect(WORKSPACE_LAYOUT_CONTROLS_SOURCE).toContain("directory: nextDirectory")
    expect(WORKSPACE_CODING_CLI_LAUNCHERS_SOURCE).toContain("listCodingCliProfiles(nextDirectory)")
    expect(WORKSPACE_CODING_CLI_LAUNCHERS_SOURCE).toContain("directory: nextDirectory")
  })
})
