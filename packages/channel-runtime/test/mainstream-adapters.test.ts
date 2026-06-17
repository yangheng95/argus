import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { WhatsappAdapter } from "../src/adapters/whatsapp"
import { GoogleChatAdapter } from "../src/adapters/googlechat"
import { MSTeamsAdapter } from "../src/adapters/msteams"
import { LineAdapter } from "../src/adapters/line"
import { MatrixAdapter } from "../src/adapters/matrix"
import { MattermostAdapter } from "../src/adapters/mattermost"
import { SignalAdapter } from "../src/adapters/signal"
import { WeComAdapter } from "../src/adapters/wecom"
import { DingTalkAdapter } from "../src/adapters/dingtalk"
import { QQAdapter } from "../src/adapters/qq"

type ServeOpts = {
  hostname?: string
  port?: number
  fetch: (req: Request) => Response | Promise<Response>
}

type Server = {
  hostname: string
  port: number
  stop: (force?: boolean) => void
}

function stub() {
  let route: ((req: Request) => Response | Promise<Response>) | undefined
  return {
    serve(opts: ServeOpts) {
      route = opts.fetch
      return {
        hostname: "127.0.0.1",
        port: 19999,
        stop() {},
      } as Server
    },
    route() {
      if (!route) throw new Error("route not ready")
      return route
    },
  }
}

function qqSigned(adapter: QQAdapter, body: Record<string, unknown>, timestamp = "1710000") {
  const raw = JSON.stringify(body)
  const key = (adapter as unknown as { privateKey: KeyObject }).privateKey
  const signature = sign(null, Buffer.from(timestamp + raw), key).toString("hex")
  return {
    raw,
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
  }
}

function lineSignedRequest(body: unknown, secret: string) {
  const raw = JSON.stringify(body)
  return new Request("http://127.0.0.1:19999/line", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": createHmac("sha256", secret).update(raw).digest("base64"),
    },
    body: raw,
  })
}

let oldFetch: typeof globalThis.fetch

beforeEach(() => {
  oldFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = oldFetch
})

describe("mainstream adapters", () => {
  test("whatsapp handles webhook and outbound send", async () => {
    const s = stub()
    const adapter = new WhatsappAdapter({
      token: "wa_token",
      numberId: "wa_number",
      verifyToken: "check",
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()

    const challenge = await s.route()(
      new Request("http://127.0.0.1:19999/whatsapp?hub.mode=subscribe&hub.verify_token=check&hub.challenge=abc"),
    )
    expect(await challenge.text()).toBe("abc")

    const inbound = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.1",
                    from: "15550001",
                    type: "text",
                    text: { body: "hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    }
    const ok = await s.route()(
      new Request("http://127.0.0.1:19999/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inbound),
      }),
    )
    expect(ok.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "whatsapp",
      channel: "15550001",
      thread: "wamid.1",
      user: "15550001",
      text: "hello",
    })

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Response.json({ messages: [{ id: "wamid.out" }] })
    }) as typeof globalThis.fetch
    await adapter.sendMessage("15550001", "wamid.1", "done")
    expect(calls[0]).toContain("/wa_number/messages")
  })

  test("googlechat maps inbound and sends outbound with service account", async () => {
    const key = generateKeyPairSync("rsa", { modulusLength: 1024 })
      .privateKey.export({ type: "pkcs1", format: "pem" })
      .toString()
    const s = stub()
    const adapter = new GoogleChatAdapter({
      serviceAccount: JSON.stringify({
        client_email: "bot@example.iam.gserviceaccount.com",
        private_key: key,
      }),
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()

    const event = {
      type: "MESSAGE",
      space: { name: "spaces/AAA" },
      message: {
        name: "spaces/AAA/messages/msg-1",
        thread: { name: "spaces/AAA/threads/t-1" },
        sender: { name: "users/123" },
        text: "run task",
      },
    }
    await s.route()(
      new Request("http://127.0.0.1:19999/googlechat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      }),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "googlechat",
      channel: "spaces/AAA",
      thread: "spaces/AAA/threads/t-1",
      user: "users/123",
      text: "run task",
    })

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "g_token", expires_in: 3600 })
      }
      return Response.json({ name: "spaces/AAA/messages/m2" })
    }) as typeof globalThis.fetch
    await adapter.sendMessage("spaces/AAA", "spaces/AAA/threads/t-1", "done")
    expect(calls.some((item) => item.includes("oauth2.googleapis.com/token"))).toBe(true)
    expect(calls.some((item) => item.includes("/v1/spaces/AAA/messages"))).toBe(true)
  })

  test("googlechat sends screenshot cards from a public image URL", async () => {
    const key = generateKeyPairSync("rsa", { modulusLength: 1024 })
      .privateKey.export({ type: "pkcs1", format: "pem" })
      .toString()
    const adapter = new GoogleChatAdapter({
      serviceAccount: JSON.stringify({
        client_email: "bot@example.iam.gserviceaccount.com",
        private_key: key,
      }),
    })
    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "g_token", expires_in: 3600 })
      }
      return Response.json({ name: "spaces/AAA/messages/m2" })
    }) as typeof globalThis.fetch

    await adapter.uploadImageUrl?.(
      "spaces/AAA",
      "spaces/AAA/threads/t-1",
      "https://public.opencorvus.dev/overlay.png",
      "overlay.png",
      "Captured OpenCorvus GUI.",
    )

    const payload = JSON.parse(calls.at(-1)!.body!) as {
      thread?: { name?: string }
      cardsV2?: Array<{ card?: { sections?: Array<{ widgets?: Array<Record<string, unknown>> }> } }>
    }
    expect(payload.thread?.name).toBe("spaces/AAA/threads/t-1")
    const widgets = payload.cardsV2?.[0]?.card?.sections?.[0]?.widgets ?? []
    expect(widgets.some((item) => "image" in item)).toBe(true)
  })

  test("msteams maps inbound and can reply", async () => {
    const s = stub()
    const adapter = new MSTeamsAdapter({
      appId: "bot-app",
      appSecret: "bot-secret",
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()
    await s.route()(
      new Request("http://127.0.0.1:19999/msteams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "message",
          id: "m-1",
          text: "hello",
          serviceUrl: "https://smba.trafficmanager.net/emea",
          conversation: { id: "conv-1" },
          from: { id: "user-1" },
        }),
      }),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "msteams",
      channel: "conv-1",
      thread: "m-1",
      user: "user-1",
      text: "hello",
    })

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes("oauth2/v2.0/token")) {
        return Response.json({ access_token: "ms_token", expires_in: 3600 })
      }
      return Response.json({ id: "reply-1" })
    }) as typeof globalThis.fetch
    await adapter.sendMessage("conv-1", "m-1", "done")
    expect(calls.some((item) => item.includes("oauth2/v2.0/token"))).toBe(true)
    expect(calls.some((item) => item.includes("/v3/conversations/conv-1/activities"))).toBe(true)
  })

  test("msteams sends screenshot hero cards from a public image URL", async () => {
    const adapter = new MSTeamsAdapter({
      appId: "bot-app",
      appSecret: "bot-secret",
    })
    ;(adapter as unknown as { session: Map<string, { serviceUrl: string; conversationId: string }> }).session.set(
      "conv-1",
      {
        serviceUrl: "https://smba.trafficmanager.net/emea",
        conversationId: "conv-1",
      },
    )
    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      if (url.includes("oauth2/v2.0/token")) {
        return Response.json({ access_token: "ms_token", expires_in: 3600 })
      }
      return Response.json({ id: "reply-1" })
    }) as typeof globalThis.fetch

    await adapter.uploadImageUrl?.(
      "conv-1",
      "m-1",
      "https://public.opencorvus.dev/overlay.png",
      "overlay.png",
      "Captured OpenCorvus GUI.",
    )

    const payload = JSON.parse(calls.at(-1)!.body!) as {
      replyToId?: string
      attachments?: Array<{ content?: { images?: Array<{ url?: string }> } }>
    }
    expect(payload.replyToId).toBe("m-1")
    expect(payload.attachments?.[0]?.content?.images?.[0]?.url).toBe("https://public.opencorvus.dev/overlay.png")
  })

  test("line maps inbound and pushes outbound", async () => {
    const s = stub()
    const secret = "line_secret"
    const adapter = new LineAdapter({
      token: "line_token",
      secret,
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()

    await s.route()(
      lineSignedRequest(
        {
          events: [
            {
              type: "message",
              source: { userId: "u-1" },
              message: { id: "mid-1", type: "text", text: "hello" },
            },
          ],
        },
        secret,
      ),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "line",
      channel: "u-1",
      thread: "mid-1",
      user: "u-1",
      text: "hello",
    })

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(null, { status: 200 })
    }) as typeof globalThis.fetch
    await adapter.sendMessage("u-1", "", "done")
    expect(calls[0]).toContain("/v2/bot/message/push")
  })

  test("line requires channel secret and valid signature before dispatch", async () => {
    const body = {
      events: [
        {
          type: "message",
          source: { userId: "u-1" },
          message: { id: "mid-1", type: "text", text: "hello" },
        },
      ],
    }

    const unsigned = stub()
    const noSecret = new LineAdapter({
      token: "line_token",
      serve: unsigned.serve,
    })
    const unsignedSeen: Array<any> = []
    noSecret.onMessage(async (msg) => {
      unsignedSeen.push(msg)
    })
    await noSecret.start()
    const missingSecret = await unsigned.route()(
      new Request("http://127.0.0.1:19999/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    expect(missingSecret.status).toBe(401)
    expect(unsignedSeen).toHaveLength(0)

    const signed = stub()
    const adapter = new LineAdapter({
      token: "line_token",
      secret: "line_secret",
      serve: signed.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()

    const missingSignature = await signed.route()(
      new Request("http://127.0.0.1:19999/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    const wrongSignature = await signed.route()(
      new Request("http://127.0.0.1:19999/line", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-signature": "wrong",
        },
        body: JSON.stringify(body),
      }),
    )
    const valid = await signed.route()(lineSignedRequest(body, "line_secret"))

    expect(missingSignature.status).toBe(401)
    expect(wrongSignature.status).toBe(401)
    expect(valid.status).toBe(200)
    expect(seen).toHaveLength(1)
  })

  test("line sends screenshot image messages from a public image URL", async () => {
    const adapter = new LineAdapter({
      token: "line_token",
    })
    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      return new Response(null, { status: 200 })
    }) as typeof globalThis.fetch

    await adapter.uploadImageUrl?.(
      "u-1",
      "",
      "https://public.opencorvus.dev/overlay.png",
      "overlay.png",
      "Captured OpenCorvus GUI.",
    )

    const payload = JSON.parse(calls[0]!.body!) as {
      to: string
      messages: Array<{ type?: string; originalContentUrl?: string; previewImageUrl?: string }>
    }
    expect(payload.to).toBe("u-1")
    expect(payload.messages.at(-1)).toMatchObject({
      type: "image",
      originalContentUrl: "https://public.opencorvus.dev/overlay.png",
      previewImageUrl: "https://public.opencorvus.dev/overlay.png",
    })
  })

  test("matrix sends message with reply relation", async () => {
    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      return Response.json({ event_id: "$out-1" })
    }) as typeof globalThis.fetch

    const adapter = new MatrixAdapter({
      homeserver: "https://matrix.example.com",
      token: "mx_token",
    })
    await adapter.sendMessage("!room:example.com", "$root-1", "done")

    expect(calls[0]?.url).toContain("/_matrix/client/v3/rooms/!room%3Aexample.com/send/m.room.message/")
    const payload = JSON.parse(calls[0]!.body!) as {
      msgtype: string
      body: string
      "m.relates_to"?: {
        "m.in_reply_to"?: {
          event_id?: string
        }
      }
    }
    expect(payload.msgtype).toBe("m.text")
    expect(payload.body).toBe("done")
    expect(payload["m.relates_to"]?.["m.in_reply_to"]?.event_id).toBe("$root-1")
  })

  test("mattermost maps inbound and posts outbound", async () => {
    const s = stub()
    const adapter = new MattermostAdapter({
      url: "https://mm.example.com",
      token: "mm_token",
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()

    await s.route()(
      new Request("http://127.0.0.1:19999/mattermost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel_id: "ch-1",
          user_id: "u-1",
          post_id: "p-1",
          text: "hello",
        }),
      }),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "mattermost",
      channel: "ch-1",
      thread: "p-1",
      user: "u-1",
      text: "hello",
    })

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Response.json({ id: "p-out-1" })
    }) as typeof globalThis.fetch
    await adapter.sendMessage("ch-1", "p-1", "done")
    expect(calls[0]).toContain("/api/v4/posts")
  })

  test("signal sends outbound message", async () => {
    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      return Response.json({ timestamp: 123456 })
    }) as typeof globalThis.fetch

    const adapter = new SignalAdapter({
      service: "http://127.0.0.1:8080",
      account: "+15550001",
    })
    await adapter.sendMessage("+15550002", "123", "done")
    expect(calls[0]?.url).toContain("/v2/send")
    const body = JSON.parse(calls[0]!.body!) as {
      number: string
      recipients: string[]
      message: string
    }
    expect(body.number).toBe("+15550001")
    expect(body.recipients).toEqual(["+15550002"])
    expect(body.message).toBe("done")
  })

  test("wecom maps inbound xml and sends outbound", async () => {
    const s = stub()
    const adapter = new WeComAdapter({
      corpId: "wxcorp",
      secret: "wxsec",
      agentId: "1000002",
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()

    const xml = `<xml>
  <ToUserName><![CDATA[to]]></ToUserName>
  <FromUserName><![CDATA[user1]]></FromUserName>
  <CreateTime>1710000</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[hello]]></Content>
  <MsgId>999</MsgId>
</xml>`
    await s.route()(
      new Request("http://127.0.0.1:19999/wecom", {
        method: "POST",
        headers: { "content-type": "application/xml" },
        body: xml,
      }),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "wecom",
      channel: "user1",
      thread: "999",
      user: "user1",
      text: "hello",
    })

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes("/cgi-bin/gettoken")) {
        return Response.json({ errcode: 0, access_token: "wx_token", expires_in: 7200 })
      }
      return Response.json({ errcode: 0, errmsg: "ok" })
    }) as typeof globalThis.fetch
    await adapter.sendMessage("user1", "", "done")
    expect(calls.some((item) => item.includes("/cgi-bin/gettoken"))).toBe(true)
    expect(calls.some((item) => item.includes("/cgi-bin/message/send"))).toBe(true)
  })

  test("dingtalk maps inbound and replies with session webhook", async () => {
    const s = stub()
    const adapter = new DingTalkAdapter({
      appKey: "ding_key",
      appSecret: "ding_secret",
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()
    await s.route()(
      new Request("http://127.0.0.1:19999/dingtalk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: "hello" },
          senderStaffId: "staff_1",
          conversationId: "cid_1",
          msgId: "mid_1",
          sessionWebhook: "https://oapi.dingtalk.com/robot/send?access_token=abc",
        }),
      }),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "dingtalk",
      channel: "cid_1",
      thread: "mid_1",
      user: "staff_1",
      text: "hello",
    })

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Response.json({ errcode: 0, errmsg: "ok" })
    }) as typeof globalThis.fetch
    await adapter.sendMessage("cid_1", "", "done")
    expect(calls[0]).toContain("oapi.dingtalk.com/robot/send")
  })

  test("dingtalk sends markdown screenshot links from a public image URL", async () => {
    const adapter = new DingTalkAdapter({
      appKey: "ding_key",
      appSecret: "ding_secret",
      defaultWebhook: "https://oapi.dingtalk.com/robot/send?access_token=abc",
    })
    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      return Response.json({ errcode: 0, errmsg: "ok" })
    }) as typeof globalThis.fetch

    await adapter.uploadImageUrl?.(
      "cid_1",
      "",
      "https://public.opencorvus.dev/overlay.png",
      "overlay.png",
      "Captured OpenCorvus GUI.",
    )

    const payload = JSON.parse(calls[0]!.body!) as {
      msgtype?: string
      markdown?: { text?: string }
    }
    expect(payload.msgtype).toBe("markdown")
    expect(payload.markdown?.text).toContain("https://public.opencorvus.dev/overlay.png")
  })

  test("qq handles validation and c2c outbound replies", async () => {
    const s = stub()
    const adapter = new QQAdapter({
      appId: "1024",
      appSecret: "qq_secret",
      serve: s.serve,
    })
    const seen: Array<any> = []
    adapter.onMessage(async (msg) => {
      seen.push(msg)
    })
    await adapter.start()

    const validation = qqSigned(adapter, {
      op: 13,
      d: {
        plain_token: "plain-token",
        event_ts: "1710001",
      },
    })
    const handshake = await s.route()(
      new Request("http://127.0.0.1:19999/qqbot", {
        method: "POST",
        headers: validation.headers,
        body: validation.raw,
      }),
    )
    expect(handshake.status).toBe(200)
    const ack = (await handshake.json()) as { plain_token?: string; signature?: string }
    expect(ack.plain_token).toBe("plain-token")
    expect((ack.signature?.length ?? 0) > 10).toBe(true)

    const inbound = qqSigned(adapter, {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "mid-1",
        content: "hello",
        author: { id: "u-1" },
      },
    })
    const ok = await s.route()(
      new Request("http://127.0.0.1:19999/qqbot", {
        method: "POST",
        headers: inbound.headers,
        body: inbound.raw,
      }),
    )
    expect(ok.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      platform: "qq",
      channel: "u-1",
      thread: "mid-1",
      user: "u-1",
      text: "hello",
    })

    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      if (url.includes("/app/getAppAccessToken")) {
        return Response.json({ code: 0, access_token: "qq_token", expires_in: "7200" })
      }
      return Response.json({ id: "out-1" })
    }) as typeof globalThis.fetch

    await adapter.sendMessage("u-1", "mid-1", "done")

    expect(calls[0]?.url).toContain("/app/getAppAccessToken")
    expect(calls[1]?.url).toContain("/v2/users/u-1/messages")
    const payload = JSON.parse(calls[1]!.body!) as {
      content?: string
      msg_id?: string
      msg_seq?: number
    }
    expect(payload.content).toBe("done")
    expect(payload.msg_id).toBe("mid-1")
    expect(payload.msg_seq).toBe(1)
  })

  test("qq routes channel at-messages to channel send API", async () => {
    const s = stub()
    const adapter = new QQAdapter({
      appId: "1024",
      appSecret: "qq_secret",
      serve: s.serve,
    })
    adapter.onMessage(async () => {})
    await adapter.start()

    const inbound = qqSigned(adapter, {
      op: 0,
      t: "AT_MESSAGE_CREATE",
      d: {
        id: "mid-2",
        channel_id: "ch-1",
        content: "<@!42> run task",
        author: { id: "u-2" },
      },
    })
    await s.route()(
      new Request("http://127.0.0.1:19999/qqbot", {
        method: "POST",
        headers: inbound.headers,
        body: inbound.raw,
      }),
    )

    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      if (url.includes("/app/getAppAccessToken")) {
        return Response.json({ code: 0, access_token: "qq_token", expires_in: "7200" })
      }
      return Response.json({ id: "out-2" })
    }) as typeof globalThis.fetch

    await adapter.sendMessage("ch-1", "mid-2", "done")

    expect(calls[1]?.url).toContain("/channels/ch-1/messages")
    const payload = JSON.parse(calls[1]!.body!) as {
      content?: string
      msg_id?: string
      message_reference?: {
        message_id?: string
      }
    }
    expect(payload.content).toBe("done")
    expect(payload.msg_id).toBe("mid-2")
    expect(payload.message_reference?.message_id).toBe("mid-2")
  })
})
