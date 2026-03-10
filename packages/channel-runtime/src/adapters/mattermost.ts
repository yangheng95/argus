import type { ChannelAdapter, MessageHandler } from "../adapter"
import { adapt, base, path, type Serve, type Server } from "./http"

type HookBody = {
  channel_id?: string
  user_id?: string
  text?: string
  post_id?: string
  root_id?: string
}

type PostResponse = {
  id?: string
}

type FileResponse = {
  file_infos?: Array<{
    id?: string
  }>
}

export class MattermostAdapter implements ChannelAdapter {
  readonly platform = "mattermost"
  private handler?: MessageHandler
  private url: string
  private token: string
  private host: string
  private port: number
  private hook: string
  private serve: Serve
  private server?: Server

  constructor(opts: { url: string; token: string; host?: string; port?: number; path?: string; serve?: Serve }) {
    this.url = base(opts.url)
    this.token = opts.token
    this.host = opts.host ?? "0.0.0.0"
    this.port = opts.port ?? 16671
    this.hook = path(opts.path, "/mattermost")
    this.serve = adapt(opts.serve)
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    if (this.server) return
    this.server = this.serve({
      hostname: this.host,
      port: this.port,
      fetch: (req) => this.route(req),
    })
    console.log(`[Mattermost] Webhook listening at http://${this.server.hostname}:${this.server.port}${this.hook}`)
  }

  async stop(): Promise<void> {
    if (!this.server) return
    this.server.stop(true)
    this.server = undefined
  }

  async sendMessage(channel: string, thread: string, text: string): Promise<void> {
    await this.post({
      channel_id: channel,
      message: text,
      root_id: thread || undefined,
    })
  }

  async startThread(channel: string, text: string): Promise<string> {
    const data = await this.post({
      channel_id: channel,
      message: text,
    })
    return data.id ?? `${Date.now()}`
  }

  async uploadImage(
    channel: string,
    thread: string,
    imageBuffer: Buffer,
    filename: string,
    title?: string,
  ): Promise<void> {
    const form = new FormData()
    form.set("channel_id", channel)
    form.set("files", new Blob([Uint8Array.from(imageBuffer)]), filename)
    const uploaded = await fetch(`${this.url}/api/v4/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (!uploaded.ok) throw new Error(`Mattermost upload failed: ${uploaded.status} ${await uploaded.text()}`)

    const data = (await uploaded.json()) as FileResponse
    const ids = data.file_infos?.map((item) => item.id).filter((id): id is string => Boolean(id)) ?? []
    if (ids.length === 0) throw new Error("Mattermost upload failed: missing file id")

    await this.post({
      channel_id: channel,
      message: title,
      root_id: thread || undefined,
      file_ids: ids,
    })
  }

  private async post(payload: Record<string, unknown>) {
    const res = await fetch(`${this.url}/api/v4/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Mattermost send failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as PostResponse
  }

  private async route(req: Request) {
    const url = new URL(req.url)
    if (url.pathname !== this.hook) return new Response("Not Found", { status: 404 })
    if (req.method === "GET") return new Response("ok")
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 })
    if (!this.handler) return Response.json({ ok: true })

    const type = req.headers.get("content-type") ?? ""
    const body = type.includes("application/json")
      ? ((await req.json().catch(() => ({}))) as HookBody)
      : await this.form(req)
    const channel = body.channel_id
    const user = body.user_id
    const thread = body.root_id ?? body.post_id
    const text = (body.text ?? "").trim()
    if (!channel || !user || !thread || !text) return Response.json({ ok: true })

    await this.handler({
      platform: this.platform,
      channel,
      thread,
      user,
      text,
    })

    return Response.json({ ok: true })
  }

  private async form(req: Request): Promise<HookBody> {
    const data = await req.formData()
    return {
      channel_id: data.get("channel_id")?.toString(),
      user_id: data.get("user_id")?.toString(),
      text: data.get("text")?.toString(),
      post_id: data.get("post_id")?.toString(),
      root_id: data.get("root_id")?.toString(),
    }
  }
}
