export interface AudioBuffer {
  data: Buffer
  mime: string // "audio/ogg", "audio/webm", etc.
  filename?: string
  size: number
  duration?: number // seconds, filled when platform provides it
}

export interface STTResult {
  text: string
  provider: string // "openai-whisper", "groq", etc.
  language?: string
  durationMs: number // transcription latency
}

export interface STTProvider {
  readonly name: string
  isAvailable(): Promise<boolean>
  transcribe(audio: AudioBuffer, options?: { language?: string; prompt?: string }): Promise<STTResult>
}

export interface STTConfig {
  providers: string[] // provider names in priority order
  language?: string // default language hint
  maxFileSizeBytes?: number // default 25MB
}
