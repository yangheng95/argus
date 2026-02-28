import { Log } from "../../util/log"

export namespace Keyboard {
  const log = Log.create({ service: "argus-keyboard" })

  const KEY_MAP: Record<string, string> = {
    Enter: "Return",
    Escape: "Escape",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Space: "Space",
    F1: "F1",
    F2: "F2",
    F3: "F3",
    F4: "F4",
    F5: "F5",
    F6: "F6",
    F7: "F7",
    F8: "F8",
    F9: "F9",
    F10: "F10",
    F11: "F11",
    F12: "F12",
  }

  export async function pressKey(keyName: string): Promise<void> {
    try {
      const { keyboard, Key } = await import("@nut-tree-fork/nut-js")

      const mapped = KEY_MAP[keyName] ?? keyName
      const key = (Key as any)[mapped]

      if (key === undefined) {
        log.warn("unknown key, attempting type", { keyName })
        await keyboard.type(keyName)
        return
      }

      await keyboard.pressKey(key)
      await keyboard.releaseKey(key)
      log.info("pressed key", { keyName })
    } catch (e) {
      log.error("pressKey failed", {
        keyName,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function typeText(text: string): Promise<void> {
    try {
      const { keyboard } = await import("@nut-tree-fork/nut-js")
      await keyboard.type(text)
      log.info("typed text", { length: text.length })
    } catch (e) {
      log.error("typeText failed", {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function hotkey(...keys: string[]): Promise<void> {
    try {
      const { keyboard, Key } = await import("@nut-tree-fork/nut-js")

      const nutKeys = keys.map((k) => {
        const mapped = KEY_MAP[k] ?? k
        const key = (Key as any)[mapped]
        if (key === undefined) throw new Error(`Unknown key: ${k}`)
        return key
      })

      for (const key of nutKeys) {
        await keyboard.pressKey(key)
      }
      const reverseKeys = [...nutKeys].reverse()
      try {
        for (const key of reverseKeys) {
          await keyboard.releaseKey(key)
        }
      } catch (err) {
        // Best-effort: try releasing remaining keys
        for (const key of reverseKeys) {
          await keyboard.releaseKey(key).catch(() => {})
        }
        throw err
      }

      log.info("hotkey", { keys })
    } catch (e) {
      log.error("hotkey failed", {
        keys,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }
}
