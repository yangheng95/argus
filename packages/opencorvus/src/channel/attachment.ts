import { Identifier } from "@/id/id"
import { Global } from "@/global"
import { Config } from "@/config/config"
import { Filesystem } from "@/util/filesystem"
import { createHmac, timingSafeEqual } from "node:crypto"
import path from "node:path"
import z from "zod"

const dir = path.join(Global.Path.data, "channel-attachments")
const lifetime = 1000 * 60 * 60 * 24
const loopback = new Set(["127.0.0.1", "localhost", "::1"])

const Meta = z.object({
  filename: z.string(),
  mime: z.string(),
  file: z.string(),
})

export namespace ChannelAttachment {
  export const Input = z.object({
    filename: z.string().trim().min(1),
    mime: z.string().trim().min(1),
    data: z.string().trim().min(1),
  })

  export async function create(raw: z.input<typeof Input>) {
    const input = Input.parse(raw)
    const base = await publicUrl()
    if (!base) {
      throw new Error("No public URL configured. Set OPENCORVUS_PUBLIC_URL or config.server.publicUrl.")
    }
    const id = Identifier.ascending("attachment")
    const ext = suffix(input.filename, input.mime)
    const file = `${id}${ext}`
    await Filesystem.write(path.join(dir, file), Buffer.from(input.data, "base64"))
    await Filesystem.write(
      path.join(dir, `${id}.json`),
      JSON.stringify({
        filename: input.filename,
        mime: input.mime,
        file,
      }),
    )
    const expires = Date.now() + lifetime
    const token = sign(id, expires)
    return {
      id,
      url: `${base}/channel/attachment/${id}?e=${expires}&s=${token}`,
      mime: input.mime,
      filename: input.filename,
      expires_at: expires,
    }
  }

  export async function get(id: string) {
    const raw = await Bun.file(path.join(dir, `${id}.json`))
      .text()
      .catch(() => undefined)
    if (!raw) return
    const meta = Meta.parse(JSON.parse(raw))
    return {
      ...meta,
      path: path.join(dir, meta.file),
    }
  }

  export function authorize(id: string, expires: string | null, token: string | null) {
    if (!secret()) return true
    const stamp = Number(expires)
    if (!token || !Number.isFinite(stamp) || stamp < Date.now()) return false
    const expected = sign(id, stamp)
    const left = Buffer.from(expected)
    const right = Buffer.from(token)
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
  }
}

async function publicUrl() {
  const direct = text(process.env.OPENCORVUS_PUBLIC_URL)
  if (direct) return trim(direct)
  const config = await Config.get()
  const configured = text(config.server?.publicUrl)
  if (configured) return trim(configured)
  const current = text(process.env.OPENCORVUS_SERVER_URL)
  if (!current) return
  try {
    const url = new URL(current)
    if (loopback.has(url.hostname)) return
    return trim(url.origin)
  } catch {
    return
  }
}

function trim(value: string) {
  return value.replace(/\/+$/, "")
}

function secret() {
  return text(process.env.OPENCORVUS_PUBLIC_URL_SECRET, process.env.OPENCORVUS_SERVER_PASSWORD)
}

function sign(id: string, expires: number) {
  const key = secret()
  if (!key) return ""
  return createHmac("sha256", key).update(`${id}:${expires}`).digest("hex")
}

function suffix(filename: string, mime: string) {
  const ext = path.extname(filename).trim()
  if (ext) return ext
  if (mime === "image/png") return ".png"
  if (mime === "image/jpeg") return ".jpg"
  if (mime === "image/webp") return ".webp"
  return ".bin"
}

function text(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}
