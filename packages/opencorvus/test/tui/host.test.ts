import { afterEach, describe, expect, test } from "bun:test"
import { Tui } from "../../src/tui"
import { TuiHost } from "../../src/tui/host"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function echoCommand(cwd: string, text: string): Tui.EmbeddedCommand {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Write-Output ${JSON.stringify(text)}; Start-Sleep -Seconds 30`],
      cwd,
      url: "http://127.0.0.1:1",
      port: 1,
      hostname: "127.0.0.1",
    }
  }
  return {
    command: "sh",
    args: ["-lc", `printf '%s' ${JSON.stringify(text)}; sleep 30`],
    cwd,
    url: "http://127.0.0.1:1",
    port: 1,
    hostname: "127.0.0.1",
  }
}

function inputEchoCommand(cwd: string): Tui.EmbeddedCommand {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "while (($line=[Console]::In.ReadLine()) -ne $null) { Write-Output $line }",
      ],
      cwd,
      url: "http://127.0.0.1:2",
      port: 2,
      hostname: "127.0.0.1",
    }
  }
  return {
    command: "sh",
    args: ["-c", 'while IFS= read -r line; do printf "%s\\n" "$line"; done'],
    cwd,
    url: "http://127.0.0.1:2",
    port: 2,
    hostname: "127.0.0.1",
  }
}

async function waitFor(check: () => boolean, message: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

describe("tui.host", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("captures output from a real Pseudo Terminal process", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await TuiHost.startPrepared({ command: echoCommand(tmp.path, "opencorvus-host-capture") })
        await waitFor(
          () => TuiHost.snapshot().buffer.includes("opencorvus-host-capture"),
          "Pseudo Terminal host did not capture process output",
        )
        const snapshot = TuiHost.snapshot()
        expect(snapshot.buffer).toContain("opencorvus-host-capture")
        expect(snapshot.directory).toBe(tmp.path)
        await TuiHost.stop()
        expect(TuiHost.status().status).toBe("idle")
      },
    })
  })

  test("writes input and resizes the embedded host", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await TuiHost.startPrepared({ command: inputEchoCommand(tmp.path), cols: 80, rows: 24 })
        const resized = TuiHost.resize({ cols: 120, rows: 40 })
        expect(resized.cols).toBe(120)
        expect(resized.rows).toBe(40)

        TuiHost.input("opencorvus-host-input\r\n")
        await waitFor(
          () => TuiHost.snapshot().buffer.includes("opencorvus-host-input"),
          "Pseudo Terminal host did not receive input",
        )
        expect(TuiHost.snapshot().buffer).toContain("opencorvus-host-input")
        const current = TuiHost.output()
        expect(current.data).toContain("opencorvus-host-input")
        expect(current.cursor).toBeGreaterThan(0)
        expect(TuiHost.output({ cursor: current.cursor })).toMatchObject({
          data: "",
          cursor: current.cursor,
          from: current.cursor,
          truncated: false,
        })
        TuiHost.input("opencorvus-host-cursor\r\n")
        await waitFor(
          () => TuiHost.output({ cursor: current.cursor }).data.includes("opencorvus-host-cursor"),
          "Pseudo Terminal host did not return cursor output",
        )
        const delta = TuiHost.output({ cursor: current.cursor })
        expect(delta.data).toContain("opencorvus-host-cursor")
        expect(delta.cursor).toBeGreaterThan(current.cursor)
        await TuiHost.stop()
      },
    })
  })

  test("prepares PTY connections that stream retained and live output", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await TuiHost.startPrepared({ command: inputEchoCommand(tmp.path), cols: 80, rows: 24 })
        TuiHost.input("opencorvus-host-retained\r\n")
        await waitFor(
          () => TuiHost.snapshot().buffer.includes("opencorvus-host-retained"),
          "Pseudo Terminal host did not retain output before connect",
        )

        const status = TuiHost.status()
        const prepared = TuiHost.preparePtyConnect({ id: status.id!, cursor: 0 })
        const chunks: string[] = []
        const connection = prepared.attach({
          send: (chunk) => {
            if (typeof chunk === "string") chunks.push(chunk)
          },
          close: () => undefined,
        })
        expect(chunks.join("")).toContain("opencorvus-host-retained")

        connection.onMessage("opencorvus-host-live\r\n")
        await waitFor(
          () => chunks.join("").includes("opencorvus-host-live"),
          "ticketed host connection did not receive live output",
        )
        connection.onClose()
        await TuiHost.stop()
      },
    })
  })

  test("resolves embedded command from the same TUI spawn options", async () => {
    await using tmp = await tmpdir()
    const command = await Tui.resolveEmbeddedCommand({
      directory: tmp.path,
      sessionID: "ses_000000000001abcdefghijklmn",
      model: "provider/model",
      agent: "build",
      prompt: "hello",
      port: 4567,
      hostname: "127.0.0.1",
      bin: "opencorvus-bin",
    })

    expect(command.command).toBe("opencorvus-bin")
    expect(command.cwd).toBe(tmp.path)
    expect(command.url).toBe("http://127.0.0.1:4567")
    expect(command.args).toEqual([
      tmp.path,
      "--port",
      "4567",
      "--hostname",
      "127.0.0.1",
      "-s",
      "ses_000000000001abcdefghijklmn",
      "-m",
      "provider/model",
      "--agent",
      "build",
      "--prompt",
      "hello",
    ])
  })
})
