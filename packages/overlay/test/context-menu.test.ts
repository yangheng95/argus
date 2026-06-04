import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  installNativeContextMenuSuppression,
  suppressNativeContextMenu,
} from "../src/utils/context-menu"

const MAIN_SOURCE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "main.tsx"),
  "utf8",
)

describe("overlay context menu policy", () => {
  test("native context menu events are prevented at the policy source", () => {
    let prevented = false
    const event = {
      preventDefault: () => {
        prevented = true
      },
    } as Event

    suppressNativeContextMenu(event)

    expect(prevented).toBe(true)
  })

  test("policy installs a capture-phase contextmenu listener with teardown", () => {
    const signal = new AbortController().signal
    const calls: Array<{
      type: string
      listener: EventListenerOrEventListenerObject | null
      options?: AddEventListenerOptions | boolean
    }> = []
    const target = {
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: AddEventListenerOptions | boolean,
      ) => {
        calls.push({ type, listener, options })
      },
    } satisfies Pick<EventTarget, "addEventListener">

    installNativeContextMenuSuppression(target, signal)

    expect(calls).toHaveLength(1)
    expect(calls[0].type).toBe("contextmenu")
    expect(calls[0].listener).toBe(suppressNativeContextMenu)
    expect(calls[0].options).toEqual({ capture: true, signal })
  })

  test("main installs the single source global policy", () => {
    expect(MAIN_SOURCE).toContain('import { installNativeContextMenuSuppression } from "./utils/context-menu"')
    expect(MAIN_SOURCE).toContain("installNativeContextMenuSuppression(document, moduleTeardown.signal)")
    expect(MAIN_SOURCE).not.toContain('document.addEventListener("contextmenu"')
  })
})
