import { createHmac } from "node:crypto"
import type { BotAdapter, MessageHandler } from "../adapter"
import { adapt, path, type Serve, type Server } from "./http"

type Body = {
  events?: Array<{
    type?: string
    replyToken?: string
    timestamp?: number
    source?: {
      userId?: string
      groupId?: string
      roomId?: string
    }
    message?: {
      id?: string
      type?: string
      text?: string
    }
  }>
}

export class LineAdapter implements BotAdapter {
  readonly platform = "line"
  private handler?: MessageHandler
  private token: string
  private host: string
  private port: number
  private hook: string
  private secret?: string
  private serve: Serve
  private server?: Server

  constructor(opts: { token: string; host?: string; port?: number; path?: string; secret?: string; serve?: Serve }) {
    this.token = opts.token
    this.host = opts.host ?? "0.0.0.0"
    this.port = opts.port ?? 16670
    this.hook = path(opts.path, "/line")
    this.secret = opts.secret
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
    console.log(`[LINE] Webhook listening at http://${this.server.hostname}:${this.server.port}${this.hook}`)
  }

  async stop(): Promise<void> {
    if (!this.server) return
    this.server.stop(true)
    this.server = undefined
  }

  async sendMessage(channel: string, _thread: string, text: string): Promise<void> {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: channel,
        messages: [{ type: "text", text: text.slice(0, 5000) }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`LINE send failed: ${res.status} ${await res.text()}`)
  }

  async startThread(channel: string, text: string): Promise<string> {
    await this.sendMessage(channel, "", text)
    return `${Date.now()}`
  }

  async uploadImage(
    channel: string,
    thread: string,
    _imageBuffer: Buffer,
    filename: string,
    title?: string,
  ): Promise<void> {
    const text =
      title && title !== filename
        ? `${title}\n(image upload not supported in LINE text MVP)`
        : `Image "${filename}" generated (upload is not supported in LINE text MVP).`
    await this.sendMessage(channel, thread, text)
  }

  private async route(req: Request) {
    const url = new URL(req.url)
    if (url.pathname !== this.hook) return new Response("Not Found", { status: 404 })
    if (req.method === "GET") return new Response("ok")
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 })

    const raw = await req.text()
    if (this.secret) {
      const digest = createHmac("sha256", this.secret).update(raw).digest("base64")
      const sig = req.headers.get("x-line-signature")
      if (!sig || sig !== digest) return Response.json({ error: "invalid signature" }, { status: 401 })
    }

    const body = JSON.parse(raw) as Body
    if (!this.handler) return Response.json({ ok: true })
    for (const event of body.events ?? []) {
      if (event.type !== "message") continue
      if (event.message?.type !== "text") continue
      const channel = event.source?.userId ?? event.source?.groupId ?? event.source?.roomId
      const user = event.source?.userId ?? event.source?.groupId ?? event.source?.roomId
      const thread = event.message?.id
      const text = (event.message?.text ?? "").trim()
      if (!channel || !user || !thread || !text) continue
      await this.handler({
        platform: this.platform,
        channel,
        thread,
        user,
        text,
      })
    }

    return Response.json({ ok: true })
  }
}
