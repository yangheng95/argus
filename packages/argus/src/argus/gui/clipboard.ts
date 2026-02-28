import { Log } from "../../util/log"

export namespace ClipboardInput {
  const log = Log.create({ service: "argus-clipboard" })

  export async function paste(text: string): Promise<void> {
    try {
      const clipboardy = await import("clipboardy")
      await clipboardy.default.write(text)

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
      log.error("paste failed", {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function read(): Promise<string> {
    const clipboardy = await import("clipboardy")
    return clipboardy.default.read()
  }
}
