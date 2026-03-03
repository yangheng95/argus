import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Bus } from "../../src/bus"
import { TuiEvent } from "../../src/cli/cmd/tui/event"
import { TuiCommand } from "../../src/tui/command"
import { tmpdir } from "../fixture/fixture"

function nextCommand() {
  return Promise.race([
    new Promise<string>((resolve) => {
      Bus.once(TuiEvent.CommandExecute, (event) => {
        resolve(event.properties.command)
        return "done"
      })
    }),
    Bun.sleep(2000).then(() => {
      throw new Error("Timed out waiting for tui command event")
    }),
  ])
}

describe("tui command routes", () => {
  test("open-sessions publishes session.list", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const command = nextCommand()
        const response = await app.request("/tui/open-sessions", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        expect(await command).toBe(TuiCommand.action.sessions)
      },
    })
  })

  test("open-themes publishes theme.switch", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const command = nextCommand()
        const response = await app.request("/tui/open-themes", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        expect(await command).toBe(TuiCommand.action.themes)
      },
    })
  })
})
