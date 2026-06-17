import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto"
import type { ChannelAdapter, IncomingMessage, MessageHandler } from "../adapter"
import { adapt, path, type Serve, type Server } from "./http"

type Target = {
  kind: "c2c" | "group" | "channel"
  id: string
}

type TokenData = {
  code?: number
  message?: string
  access_token?: string
  expires_in?: string | number
}

type Payload = {
  op?: number
  t?: string
  d?: number | ValidationData | EventData
}

type ValidationData = {
  plain_token?: string
  event_ts?: string
}

type EventData = {
  id?: string
  channel_id?: string
  group_id?: string
  content?: string
  author?: {
    id?: string
    bot?: boolean
  }
}

type SendBody = {
  content: string
  msg_type?: number
  msg_id?: string
  msg_seq?: number
  message_reference?: {
    message_id: string
    ignore_get_message_error: boolean
  }
}

type Routed = IncomingMessage & {
  target: Target
}

function seed(secret: string) {
  if (!secret) throw new Error("QQ app secret is required")
  const source = Buffer.from(secret)
  const result = Buffer.alloc(32)
  for (let i = 0; i < result.length; i++) result[i] = source[i % source.length]!
  return result
}

function keyPair(secret: string) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed(secret)]),
    format: "der",
    type: "pkcs8",
  })
  return {
    privateKey,
    publicKey: createPublicKey(privateKey),
  }
}

function hex(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return undefined
  return Buffer.from(value, "hex")
}

function clean(text: string) {
  return text.replace(/<@!?\d+>/g, "").trim()
}

function original(timestamp: string, body: string | Buffer) {
  if (!timestamp) throw new Error("QQ signature timestamp is required")
  return Buffer.concat([Buffer.from(timestamp), typeof body === "string" ? Buffer.from(body) : body])
}

function ack(op: number, data: number) {
  return Response.json({ op, d: data })
}

function key(channel: string, thread?: string) {
  return thread ? `${channel}:${thread}` : channel
}

export class QQAdapter implements ChannelAdapter {
  readonly platform = "qq"

  private handler?: MessageHandler
  private appId: string
  private appSecret: string
  private host: string
  private port: number
  private hook: string
  private api: string
  private serve: Serve
  private server?: Server
  private publicKey: KeyObject
  private privateKey: KeyObject
  private token?: string
  private expires = 0
  private targets = new Map<string, Target>()
  private seq = new Map<string, number>()

  constructor(opts: {
    appId: string
    appSecret: string
    host?: string
    port?: number
    path?: string
    sandbox?: boolean
    serve?: Serve
  }) {
    const pair = keyPair(opts.appSecret)
    this.appId = opts.appId
    this.appSecret = opts.appSecret
    this.host = opts.host ?? "0.0.0.0"
    this.port = opts.port ?? 16674
    this.hook = path(opts.path, "/qqbot")
    this.api = opts.sandbox ? "https://sandbox.api.sgroup.qq.com" : "https://api.sgroup.qq.com"
    this.serve = adapt(opts.serve)
    this.publicKey = pair.publicKey
    this.privateKey = pair.privateKey
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
    console.log(`[QQ] Webhook listening at http://${this.server.hostname}:${this.server.port}${this.hook}`)
  }

  async stop(): Promise<void> {
    if (!this.server) return
    this.server.stop(true)
    this.server = undefined
  }

  async sendMessage(channel: string, thread: string, text: string): Promise<void> {
    const target = this.targets.get(key(channel, thread)) ?? this.targets.get(channel)
    if (!target) throw new Error(`QQ conversation not initialized: ${channel}`)
    await this.send(target, channel, thread, text)
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
        ? `${title}\n(Image upload is not supported in QQ Bot MVP.)`
        : `Image "${filename}" generated. Native QQ upload is not wired in this MVP.`
    await this.sendMessage(channel, thread, text)
  }

  async uploadImageUrl(channel: string, thread: string, url: string, filename: string, title?: string): Promise<void> {
    const heading = title ?? filename
    await this.sendMessage(channel, thread, `${heading}\n${url}`)
  }

  private async route(req: Request) {
    const url = new URL(req.url)
    if (url.pathname !== this.hook) return new Response("Not Found", { status: 404 })
    if (req.method === "GET") return new Response("ok")
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 })

    const raw = await req.text()
    if (!this.valid(req, raw)) return Response.json({ error: "invalid signature" }, { status: 401 })

    // Malformed JSON → 400 below
    const body = raw ? await new Response(raw).json().catch(() => undefined) : undefined
    if (!body || typeof body !== "object") return Response.json({ error: "invalid body" }, { status: 400 })

    const payload = body as Payload
    if (payload.op === 13) return this.validation(payload.d)
    if (payload.op === 1) return ack(11, typeof payload.d === "number" ? payload.d : 0)
    if (payload.op !== 0) return Response.json({ ok: true })
    if (!this.handler) return ack(12, 0)

    const msg = this.parse(payload.t, payload.d)
    if (!msg) return ack(12, 0)
    this.targets.set(msg.channel, msg.target)
    this.targets.set(key(msg.channel, msg.thread), msg.target)

    const ok = await this.handler(msg).then(
      () => true,
      (error) => {
        console.error("[QQ] handler error:", error)
        return false
      },
    )

    return ack(12, ok ? 0 : 1)
  }

  private valid(req: Request, raw: string) {
    const signature = req.headers.get("X-Signature-Ed25519")
    const timestamp = req.headers.get("X-Signature-Timestamp")
    if (!signature || !timestamp) return false
    const data = hex(signature)
    if (!data) return false
    return verify(null, original(timestamp, raw), this.publicKey, data)
  }

  private validation(data: Payload["d"]) {
    if (!data || typeof data !== "object") return Response.json({ error: "invalid validation" }, { status: 400 })
    const body = data as ValidationData
    if (!body.plain_token || !body.event_ts) return Response.json({ error: "invalid validation" }, { status: 400 })
    const signature = sign(null, original(body.event_ts, body.plain_token), this.privateKey).toString("hex")
    return Response.json({
      plain_token: body.plain_token,
      signature,
    })
  }

  private parse(type: string | undefined, data: Payload["d"]) {
    if (!data || typeof data !== "object") return
    const body = data as EventData
    if (!body.id || !body.author?.id || body.author.bot) return
    const text = clean(body.content ?? "")
    if (!text) return
    if (type === "C2C_MESSAGE_CREATE") {
      return {
        platform: this.platform,
        channel: body.author.id,
        thread: body.id,
        user: body.author.id,
        text,
        target: {
          kind: "c2c",
          id: body.author.id,
        },
      } satisfies Routed
    }
    if (type === "GROUP_AT_MESSAGE_CREATE" && body.group_id) {
      return {
        platform: this.platform,
        channel: body.group_id,
        thread: body.id,
        user: body.author.id,
        text,
        target: {
          kind: "group",
          id: body.group_id,
        },
      } satisfies Routed
    }
    if (type === "AT_MESSAGE_CREATE" && body.channel_id) {
      return {
        platform: this.platform,
        channel: body.channel_id,
        thread: body.id,
        user: body.author.id,
        text,
        target: {
          kind: "channel",
          id: body.channel_id,
        },
      } satisfies Routed
    }
  }

  private async accessToken() {
    if (this.token && this.expires > Date.now()) return this.token
    const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appId: this.appId,
        clientSecret: this.appSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`QQ access token failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as TokenData
    if (data.code && data.code !== 0)
      throw new Error(`QQ access token failed: ${data.code} ${data.message ?? "unknown"}`)
    if (!data.access_token) throw new Error("QQ access token failed: missing access_token")
    const ttl = Number(data.expires_in)
    this.token = data.access_token
    this.expires = Date.now() + Math.max(60, Number.isFinite(ttl) ? ttl - 60 : 7140) * 1000
    return this.token
  }

  private next(target: Target, channel: string, thread: string) {
    if (!thread) return undefined
    const key = `${target.kind}:${channel}:${thread}`
    const seq = (this.seq.get(key) ?? 0) + 1
    this.seq.set(key, seq)
    return seq
  }

  private async send(target: Target, channel: string, thread: string, text: string) {
    const token = await this.accessToken()
    const seq = this.next(target, channel, thread)
    const body: SendBody = {
      content: text,
      msg_type: 0,
      ...(thread ? { msg_id: thread } : {}),
      ...(seq ? { msg_seq: seq } : {}),
      ...(target.kind === "channel" && thread
        ? {
            message_reference: {
              message_id: thread,
              ignore_get_message_error: true,
            },
          }
        : {}),
    }

    const endpoint =
      target.kind === "c2c"
        ? `/v2/users/${encodeURIComponent(target.id)}/messages`
        : target.kind === "group"
          ? `/v2/groups/${encodeURIComponent(target.id)}/messages`
          : `/channels/${encodeURIComponent(target.id)}/messages`

    const res = await fetch(`${this.api}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
        "X-Union-Appid": this.appId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`QQ send message failed: ${res.status} ${await res.text()}`)
  }
}
