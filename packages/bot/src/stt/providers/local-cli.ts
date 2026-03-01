import { tmpdir } from "os"
import { join } from "path"
import { unlinkSync, readFileSync, mkdtempSync } from "fs"
import type { AudioBuffer, STTProvider, STTResult } from "../types"

export class LocalCLIProvider implements STTProvider {
  readonly name = "local-cli"
  private command?: string

  constructor(opts: { command?: string }) {
    this.command = opts.command
  }

  async isAvailable(): Promise<boolean> {
    if (!this.command) return false
    // Check if the base binary exists by running a simple test
    const bin = this.command.split(/\s+/)[0]
    try {
      const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    } catch {
      return false
    }
  }

  async transcribe(audio: AudioBuffer, options?: { language?: string; prompt?: string }): Promise<STTResult> {
    const start = performance.now()

    // Write audio to a temp file
    const outputDir = mkdtempSync(join(tmpdir(), "stt-"))
    const ext = audio.mime.split("/")[1]?.replace("mpeg", "mp3").replace("ogg", "ogg") ?? "ogg"
    const mediaPath = join(outputDir, `input.${ext}`)
    await Bun.write(mediaPath, audio.data)

    try {
      // Build command by replacing template placeholders
      let cmd = this.command!
        .replace("{{MediaPath}}", mediaPath)
        .replace("{{OutputDir}}", outputDir)

      if (options?.language) {
        cmd = cmd.replace("{{Language}}", options.language)
      }

      const parts = cmd.split(/\s+/)
      const proc = Bun.spawn(parts, {
        stdout: "pipe",
        stderr: "pipe",
        cwd: outputDir,
      })

      // 60s timeout for local CLI
      const timeout = setTimeout(() => proc.kill(), 60_000)
      await proc.exited
      clearTimeout(timeout)

      if (proc.exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        throw new Error(`CLI exited with code ${proc.exitCode}: ${stderr.slice(0, 200)}`)
      }

      // Read the output .txt file (whisper convention: input.txt in output dir)
      const txtPath = join(outputDir, "input.txt")
      const text = readFileSync(txtPath, "utf-8").trim()

      return {
        text,
        provider: this.name,
        durationMs: Math.round(performance.now() - start),
      }
    } finally {
      // Cleanup temp files
      try {
        unlinkSync(mediaPath)
        const txtPath = join(outputDir, "input.txt")
        try { unlinkSync(txtPath) } catch {}
        // Remove the temp directory (may fail if other files exist, that's ok)
        try { Bun.spawn(["rm", "-rf", outputDir]) } catch {}
      } catch {}
    }
  }
}
