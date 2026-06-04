import { describe, expect, test } from "bun:test"
import * as TuiKeybind from "../../src/cli/cmd/tui/config/keybind"

describe("OpenCode-derived TUI keymap substrate", () => {
  test("resolves tui keybind config through the OpenTUI binding lookup single source", () => {
    const keybinds = TuiKeybind.parse({
      leader: "ctrl+x",
      command_list: "ctrl+p",
      input_move_left: "left,ctrl+b",
    })
    const lookup = TuiKeybind.createLookup(keybinds)

    expect(TuiKeybind.LeaderTimeoutDefault).toBe(2000)
    expect(lookup.has("leader")).toBe(true)
    expect(lookup.get("leader")[0]?.key).toBe("ctrl+x")
    expect(lookup.get("command.palette.show")[0]?.key).toBe("ctrl+p")
    expect(lookup.get("input.move.left").map((binding) => binding.key)).toEqual(["left,ctrl+b"])
  })

  test("rejects unknown keybind names instead of preserving compatibility leftovers", () => {
    expect(() => TuiKeybind.parse({ old_local_only_key: "ctrl+o" } as never)).toThrow("Unrecognized keybind")
  })
})
