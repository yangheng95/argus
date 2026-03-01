import type { AudioBuffer, STTConfig, STTProvider, STTResult } from "./types"

const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

export class STTPipeline {
  private config: STTConfig
  private registry = new Map<string, STTProvider>()
  private available: STTProvider[] = []

  constructor(config: STTConfig) {
    this.config = config
  }

  register(provider: STTProvider): this {
    this.registry.set(provider.name, provider)
    return this
  }

  /** Probe each registered provider and build the prioritized fallback chain. */
  async init(): Promise<void> {
    this.available = []
    for (const name of this.config.providers) {
      const provider = this.registry.get(name)
      if (!provider) {
        console.warn(`[STT] Provider "${name}" not registered, skipping`)
        continue
      }
      try {
        if (await provider.isAvailable()) {
          this.available.push(provider)
          console.log(`[STT] Provider "${name}" available`)
        } else {
          console.warn(`[STT] Provider "${name}" not available`)
        }
      } catch (err) {
        console.warn(`[STT] Provider "${name}" availability check failed:`, err)
      }
    }
    console.log(`[STT] Pipeline initialized: ${this.available.map((p) => p.name).join(" → ") || "(none)"}`)
  }

  get isAvailable(): boolean {
    return this.available.length > 0
  }

  /** Transcribe audio, falling back through providers on failure. Returns null if all fail. */
  async transcribe(audio: AudioBuffer): Promise<STTResult | null> {
    const maxSize = this.config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE
    if (audio.size > maxSize) {
      console.warn(`[STT] Audio too large (${(audio.size / 1024 / 1024).toFixed(1)}MB > ${(maxSize / 1024 / 1024).toFixed(0)}MB limit)`)
      return null
    }

    for (const provider of this.available) {
      try {
        const result = await provider.transcribe(audio, { language: this.config.language })
        console.log(`[STT] "${provider.name}" transcribed in ${result.durationMs}ms: "${result.text.slice(0, 80)}"`)
        return result
      } catch (err) {
        console.warn(`[STT] "${provider.name}" failed, trying next:`, err)
      }
    }

    console.error("[STT] All providers failed")
    return null
  }
}
