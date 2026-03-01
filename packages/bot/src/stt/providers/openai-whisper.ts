import type { AudioBuffer, STTProvider, STTResult } from "../types"

export class OpenAIWhisperProvider implements STTProvider {
  readonly name = "openai-whisper"
  private apiKey?: string

  constructor(opts: { apiKey?: string }) {
    this.apiKey = opts.apiKey
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey
  }

  async transcribe(audio: AudioBuffer, options?: { language?: string; prompt?: string }): Promise<STTResult> {
    const start = performance.now()

    const form = new FormData()
    form.append("file", new Blob([new Uint8Array(audio.data)], { type: audio.mime }), audio.filename ?? "audio.ogg")
    form.append("model", "whisper-1")
    if (options?.language) form.append("language", options.language)
    if (options?.prompt) form.append("prompt", options.prompt)

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 200)}`)
    }

    const json = (await res.json()) as { text: string; language?: string }
    return {
      text: json.text,
      provider: this.name,
      language: json.language,
      durationMs: Math.round(performance.now() - start),
    }
  }
}
