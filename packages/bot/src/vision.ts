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
    this.baseURL = (opts.baseURL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "")
    this.model = opts.model ?? "qwen-vl-max"
  }

  async analyze(imageBase64: string, prompt?: string): Promise<VisionAnalysis> {
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
    const timeout = setTimeout(() => controller.abort(), 30_000)

    try {
      const res = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

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
    } finally {
      clearTimeout(timeout)
    }
  }
}
