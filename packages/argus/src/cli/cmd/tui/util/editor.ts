import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

export namespace Editor {
  export function splitCommand(command: string): string[] {
    const result: string[] = []
    let current = ""
    let quote: '"' | "'" | undefined

    for (let i = 0; i < command.length; i++) {
      const ch = command[i]

      if (quote) {
        if (ch === quote) {
          quote = undefined
          continue
        }
        if (quote === '"' && ch === "\\" && i + 1 < command.length) {
          const next = command[i + 1]
          if (next === '"' || next === "\\") {
            current += next
            i++
            continue
          }
        }
        current += ch
        continue
      }

      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }

      if (/\s/.test(ch)) {
        if (current) {
          result.push(current)
          current = ""
        }
        continue
      }

      if (ch === "\\" && i + 1 < command.length) {
        const next = command[i + 1]
        if (/\s/.test(next) || next === '"' || next === "'") {
          current += next
          i++
          continue
        }
      }

      current += ch
    }

    if (quote) {
      throw new Error("Invalid editor command: unmatched quote")
    }

    if (current) result.push(current)
    return result
  }

  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Filesystem.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    const parts = splitCommand(editor)
    if (parts.length === 0) return
    const proc = Process.spawn([...parts, filepath], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    await proc.exited
    const content = await Filesystem.readText(filepath)
    opts.renderer.currentRenderBuffer.clear()
    opts.renderer.resume()
    opts.renderer.requestRender()
    return content || undefined
  }
}
