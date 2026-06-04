import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { readdir, readFile } from "fs/promises"
import path from "path"
import * as TuiKeybind from "../../src/cli/cmd/tui/config/keybind"

const tuiRoot = path.join(import.meta.dir, "../../src/cli/cmd/tui")
const projectRoot = path.join(import.meta.dir, "../..")

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      if (/\.(ts|tsx)$/.test(entry.name)) return [full]
      return []
    }),
  )
  return files.flat()
}

describe("OpenCode-derived TUI keymap migration guard", () => {
  test("removes handwritten keybind and command-palette sources instead of keeping compatibility layers", () => {
    for (const relative of [
      "src/cli/cmd/tui/component/dialog-command.tsx",
      "src/cli/cmd/tui/component/textarea-keybindings.ts",
      "src/cli/cmd/tui/context/keybind.tsx",
      "src/util/keybind.ts",
      "test/keybind.test.ts",
    ]) {
      expect(existsSync(path.join(projectRoot, relative))).toBe(false)
    }
  })

  test("does not import deleted local keybind or dialog command modules from TUI source", async () => {
    const forbidden = [
      "dialog-command",
      "context/keybind",
      "util/keybind",
      "textarea-keybindings",
      "useCommandDialog",
      "useKeybind",
      "CommandProvider",
      "KeybindProvider",
    ]

    for (const file of await sourceFiles(tuiRoot)) {
      const text = await readFile(file, "utf8")
      for (const token of forbidden) {
        expect(text, `${path.relative(projectRoot, file)} contains ${token}`).not.toContain(token)
      }
    }
  })

  test("keeps agent workflow entry commands in the OpenTUI binding lookup single source", () => {
    const lookup = TuiKeybind.createLookup(
      TuiKeybind.parse({
        command_list: "ctrl+p",
        input_clear: "ctrl+c",
        input_paste: "ctrl+v",
        session_child_first: "<leader>down",
        session_child_cycle: "right",
        session_child_cycle_reverse: "left",
        session_parent: "up",
        "permission.prompt.fullscreen": "ctrl+f",
      }),
    )

    expect(lookup.get("command.palette.show")[0]?.key).toBe("ctrl+p")
    expect(lookup.get("prompt.clear")[0]?.key).toBe("ctrl+c")
    expect(lookup.get("prompt.paste")[0]?.key).toBe("ctrl+v")
    expect(lookup.get("session.child.first")[0]?.key).toBe("<leader>down")
    expect(lookup.get("session.child.next")[0]?.key).toBe("right")
    expect(lookup.get("session.child.previous")[0]?.key).toBe("left")
    expect(lookup.get("session.parent")[0]?.key).toBe("up")
    expect(lookup.get("permission.prompt.fullscreen")[0]?.key).toBe("ctrl+f")
    expect(lookup.get("app.exit").length).toBeGreaterThan(0)
  })
})
