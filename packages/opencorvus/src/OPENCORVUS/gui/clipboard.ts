import { Log } from "../../util/log"

export namespace ClipboardInput {
  const log = Log.create({ service: "opencorvus-clipboard" })

  export async function paste(text: string): Promise<void> {
    const clipboardy = (await import("clipboardy")).default

    // Save current clipboard content so we can restore it afterwards
    let previous: string | null = null
    try {
      previous = await clipboardy.read()
    } catch {
      // clipboard may be empty or unreadable — proceed without saving
    }

    try {
      await clipboardy.write(text)

      // Use nut-js to press Ctrl+V / Cmd+V
      const { keyboard, Key } = await import("@nut-tree-fork/nut-js")
      const isMac = process.platform === "darwin"

      if (isMac) {
        await keyboard.pressKey(Key.LeftSuper)
        await keyboard.pressKey(Key.V)
        await keyboard.releaseKey(Key.V)
        await keyboard.releaseKey(Key.LeftSuper)
      } else {
        await keyboard.pressKey(Key.LeftControl)
        await keyboard.pressKey(Key.V)
        await keyboard.releaseKey(Key.V)
        await keyboard.releaseKey(Key.LeftControl)
      }

      log.info("pasted text", { length: text.length })
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      log.error("paste failed", {
        errorName: err.name,
        error: err.message,
        stack: err.stack,
        rawType: typeof e,
      })
      throw err
    } finally {
      // Restore the previous clipboard content regardless of success or failure
      if (previous !== null) {
        await clipboardy.write(previous).catch(() => {})
      }
    }
  }

  export async function read(): Promise<string> {
    const clipboardy = await import("clipboardy")
    return clipboardy.default.read()
  }
}
