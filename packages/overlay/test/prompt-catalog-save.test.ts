import { describe, expect, test } from "bun:test"
import { promptConfigValueForSave } from "../src/services/config"

describe("prompt catalog save values", () => {
  const appendEntry = {
    key: "architect",
    prompt_mode: "append",
    default_prompt: "Default architect prompt.",
  }

  test("append-mode unchanged default clears prompt_append", () => {
    expect(promptConfigValueForSave(appendEntry, "Default architect prompt.")).toBe("")
  })

  test("append-mode saves only text appended after the default prompt", () => {
    expect(promptConfigValueForSave(appendEntry, "Default architect prompt.\n\nExtra instruction.")).toBe(
      "Extra instruction.",
    )
  })

  test("append-mode rejects replacing the code-owned default prompt", () => {
    expect(() => promptConfigValueForSave(appendEntry, "Replaced architect prompt.")).toThrow(
      "prompt.append_core_edit_error",
    )
  })

  test("override-mode saves the editor text exactly", () => {
    expect(
      promptConfigValueForSave(
        {
          key: "coding",
          prompt_mode: "override",
          default_prompt: "Default coding prompt.",
        },
        "Custom coding prompt.",
      ),
    ).toBe("Custom coding prompt.")
  })
})
