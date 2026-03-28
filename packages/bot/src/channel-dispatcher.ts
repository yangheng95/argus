import type { OpencodeClient } from "@opencorvus-ai/sdk/v2"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { ChannelAttachment, ChannelResult, ControlPlatform, SessionEntry } from "./types"
import { controlPlatforms, imageAttachment, sameEntry } from "./types"

export class ChannelDispatcher {
  private taskBindings = new Map<string, SessionEntry[]>()
  private taskByThread = new Map<string, string>()

  channelProtocol(platform: string): platform is ControlPlatform {
    return process.env.OPENCORVUS_BOT_CHANNEL_PROTOCOL === "1" &&
      (controlPlatforms as readonly string[]).includes(platform)
  }

  async handleChannelMessage(
    msg: IncomingMessage & { platform: ControlPlatform },
    adapter: BotAdapter,
    text: string,
    client: OpencodeClient,
    mirror: (
      kind: "user" | "assistant" | "system",
      text: string,
      info?: { sessionId?: string; platform?: string; channel?: string; thread?: string },
    ) => void,
    serverUrl?: string,
  ) {
    const result = await client.channel.message({
      platform: msg.platform as ControlPlatform,
      channel: msg.channel,
      thread: msg.thread,
      text,
      user_id: msg.user,
      source: msg.platform,
      allow_create: true,
    })
    if (result.error) {
      const notice = "Failed to handle message."
      mirror("system", notice, {
        platform: msg.platform,
        channel: msg.channel,
        thread: msg.thread,
      })
      await adapter.sendMessage(msg.channel, msg.thread, notice)
      return
    }
    const data = result.data as ChannelResult
    if (data.task_id) {
      this.bindTask(data.task_id, {
        sessionId: data.task_id,
        adapter,
        channel: msg.channel,
        thread: msg.thread,
      })
    }
    await this.sendChannelResult(adapter, msg.channel, msg.thread, data, serverUrl)
  }

  bindTask(taskID: string, entry: SessionEntry) {
    const key = `${entry.adapter.platform}:${entry.channel}:${entry.thread}`
    const previous = this.taskByThread.get(key)
    if (previous && previous !== taskID) {
      const next = (this.taskBindings.get(previous) ?? []).filter((item) => !sameEntry(item, entry))
      if (next.length > 0) this.taskBindings.set(previous, next)
      else this.taskBindings.delete(previous)
    }
    this.taskByThread.set(key, taskID)
    const current = this.taskBindings.get(taskID) ?? []
    if (current.some((item) => sameEntry(item, entry))) return
    this.taskBindings.set(taskID, [...current, entry])
  }

  findTaskBindings(taskID: string) {
    return this.taskBindings.get(taskID) ?? []
  }

  async sendChannelResult(
    adapter: BotAdapter,
    channel: string,
    thread: string,
    result: ChannelResult,
    serverUrl?: string,
  ) {
    if (result.message.trim()) {
      await adapter.sendMessage(channel, thread, result.message)
    }
    for (const item of result.attachments ?? []) {
      const image = imageAttachment(item)
      if (!image) continue
      if (adapter.uploadImageUrl && serverUrl) {
        try {
          const url = await this.publishChannelAttachment(serverUrl, item.mime, image.buffer, image.filename)
          await adapter.uploadImageUrl(channel, thread, url, image.filename, result.message || image.filename)
          continue
        } catch (error) {
          console.warn("[BotCore] uploadImageUrl fallback:", error)
        }
      }
      await adapter.uploadImage(channel, thread, image.buffer, image.filename, result.message || image.filename)
    }
  }

  private async publishChannelAttachment(serverUrl: string, mime: string, buffer: Buffer, filename: string) {
    const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/channel/attachment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mime,
        filename,
        data: buffer.toString("base64"),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      throw new Error(`channel attachment publish failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as { url?: string }
    if (!data.url) throw new Error("channel attachment publish failed: missing url")
    return data.url
  }

  clear() {
    this.taskBindings.clear()
    this.taskByThread.clear()
  }
}
