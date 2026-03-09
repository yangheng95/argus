import type { BotAdapter, MessageHandler } from "../adapter"
import { adapt, path, type Serve, type Server } from "./http"

type Body = {
  challenge?: string
  msgtype?: string
  text?: {
    content?: string
  }
  senderStaffId?: string
  conversationId?: string
  msgId?: string
  sessionWebhook?: string
}

export class DingTalkAdapter implements BotAdapter {
  readonly platform = "dingtalk"
  private handler?: MessageHandler
  private appKey: string
  private appSecret: string
  private host: string
  private port: number
  private hook: string
  private defaultWebhook?: string
  private serve: Serve
  private server?: Server
  private webhooks = new Map<string, string>()

  constructor(opts: {
    appKey: string
    appSecret: string
    host?: string
    port?: number
    path?: string
    defaultWebhook?: string
    serve?: Serve
  }) {
    this.appKey = opts.appKey
    this.appSecret = opts.appSecret
    this.host = opts.host ?? "0.0.0.0"
    this.port = opts.port ?? 16673
    this.hook = path(opts.path, "/dingtalk")
    this.defaultWebhook = opts.defaultWebhook
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
    console.log(`[DingTalk] Webhook listening at http://${this.server.hostname}:${this.server.port}${this.hook}`)
    if (!this.defaultWebhook) {
      console.log("[DingTalk] defaultWebhook not set, replies depend on inbound sessionWebhook")
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return
    this.server.stop(true)
    this.server = undefined
  }

  async sendMessage(channel: string, _thread: string, text: string): Promise<void> {
    await this.post(channel, {
      msgtype: "text",
      text: { content: text },
    })
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
        ? `${title}\n(image upload not supported in DingTalk text MVP)`
        : `Image "${filename}" generated (upload is not supported in DingTalk text MVP).`
    await this.sendMessage(channel, thread, text)
  }

  async uploadImageUrl(channel: string, _thread: string, url: string, filename: string, title?: string): Promise<void> {
    const heading = title ?? filename
    await this.post(channel, {
      msgtype: "markdown",
      markdown: {
        title: heading,
        text: `### ${heading}\n\n![](${url})`,
      },
    })
  }

  private async post(channel: string, payload: Record<string, unknown>) {
    const webhook = this.webhooks.get(channel) ?? this.defaultWebhook
    if (!webhook) throw new Error(`DingTalk conversation not initialized: ${channel}`)
    const res = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`DingTalk send failed: ${res.status} ${await res.text()}`)
  }

  private async route(req: Request) {
    const url = new URL(req.url)
    if (url.pathname !== this.hook) return new Response("Not Found", { status: 404 })
    if (req.method === "GET") return new Response("ok")
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 })

    const body = (await req.json().catch(() => undefined)) as Body | undefined
    if (!body) return Response.json({ error: "invalid body" }, { status: 400 })
    if (body.challenge) return Response.json({ challenge: body.challenge })
    if (!this.handler) return Response.json({ ok: true })

    const channel = body.conversationId
    const user = body.senderStaffId
    const thread = body.msgId ?? `${Date.now()}`
    const text = (body.text?.content ?? "").trim()
    if (!channel || !user || !thread || !text) return Response.json({ ok: true })
    if (body.sessionWebhook) this.webhooks.set(channel, body.sessionWebhook)

    await this.handler({
      platform: this.platform,
      channel,
      thread,
      user,
      text,
    })

    return Response.json({ ok: true })
  }
}
