export interface VisionAnalysis {
  description: string
  model: string
  tokens: { prompt: number; completion: number }
}

export interface VisionPipelineOptions {
  apiKey: string
  baseURL?: string
  model?: string
}

export class VisionPipeline {
  private apiKey: string
  private baseURL: string
  private model: string

  constructor(opts: VisionPipelineOptions) {
    this.apiKey = opts.apiKey
    // Default: coding plan endpoint (sk-sp-*); callers should pass baseURL explicitly when using sk-* keys
    this.baseURL = (opts.baseURL ?? "https://coding.dashscope.aliyuncs.com/api/v1").replace(/\/$/, "")
    this.model = opts.model ?? "qwen-vl-max"
  }

  async analyze(imageBase64: string, prompt?: string): Promise<VisionAnalysis> {
    // Guard: skip if base64 payload is too large for the vision API
    const base64MB = imageBase64.length / (1024 * 1024)
    if (base64MB > 10) {
      throw new Error(`Vision skipped: base64 payload too large (${base64MB.toFixed(1)}MB)`)
    }

    const userPrompt = prompt ?? "Describe what you see on this screen. Focus on the main content, UI state, and any notable elements."

    const body = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageBase64}` },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
      max_tokens: 512,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)

    try {
      const url = `${this.baseURL}/chat/completions`
      const fetchOpts: RequestInit & { tls?: any } = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }

      // Bun on Windows/MINGW may not trust certain CAs — disable strict TLS
      // verification for the vision API if SSL_CERT_FILE is not configured.
      if (process.platform === "win32" && !process.env.SSL_CERT_FILE) {
        fetchOpts.tls = { rejectUnauthorized: false }
      }

      const res = await fetch(url, fetchOpts)

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`Vision API ${res.status}: ${text.slice(0, 200)}`)
      }

      const data: any = await res.json()
      const choice = data.choices?.[0]
      const usage = data.usage ?? {}

      return {
        description: choice?.message?.content ?? "(no description)",
        model: data.model ?? this.model,
        tokens: {
          prompt: usage.prompt_tokens ?? 0,
          completion: usage.completion_tokens ?? 0,
        },
      }
    } catch (err) {
      // Re-throw with more context for diagnosis
      if (err instanceof DOMException && err.name === "AbortError") {
        const elapsed = "timeout or SSL handshake failure"
        throw new Error(`Vision API aborted (${elapsed}). URL: ${this.baseURL}. Tip: set SSL_CERT_FILE env var on Windows.`)
      }
      throw err
    } finally {
      clearTimeout(timeout)
    }
  }
}
