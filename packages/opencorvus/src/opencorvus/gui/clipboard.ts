import { Log } from "../../util/log"
import { Keyboard } from "./keyboard"

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

      // Reuse keyboard abstraction so win32 native fallback can handle missing nut-js Key exports.
      if (process.platform === "darwin") await Keyboard.hotkey("cmd", "v")
      if (process.platform !== "darwin") await Keyboard.hotkey("ctrl", "v")

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
