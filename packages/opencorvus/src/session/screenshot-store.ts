import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { Global } from "../global"
import { Log } from "../util/log"

const SCREENSHOT_DIR = path.join(Global.Path.data, "screenshots")
const SCHEME = "opencorvus://screenshot/"

const log = Log.create({ service: "screenshot-store" })

export namespace ScreenshotStore {
  export function isFileUrl(url: string): boolean {
    return url.startsWith(SCHEME)
  }

  export async function save(
    sessionID: string,
    mime: string,
    buffer: Buffer,
  ): Promise<string> {
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
    const ext = mime === "image/jpeg" ? "jpg" : "png"
    const dir = path.join(SCREENSHOT_DIR, sessionID)
    console.log("[ScreenshotStore] save called", { dir, sessionID, mime, bufLen: buffer.length })
    await fs.mkdir(dir, { recursive: true })
    const filename = `${hash}.${ext}`
    const filepath = path.join(dir, filename)
    await fs.writeFile(filepath, buffer)
    const url = `${SCHEME}${sessionID}/${filename}`
    console.log("[ScreenshotStore] saved", { filepath, url })
    return url
  }

  export async function resolve(url: string): Promise<{ mime: string; buffer: Buffer }> {
    if (!isFileUrl(url)) {
      // data: URL fallback
      const match = url.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) throw new Error("Invalid screenshot URL")
      return { mime: match[1], buffer: Buffer.from(match[2], "base64") }
    }
    const rel = url.slice(SCHEME.length)
    const filepath = path.join(SCREENSHOT_DIR, rel)
    const buffer = await fs.readFile(filepath)
    const mime = rel.endsWith(".jpg") ? "image/jpeg" : "image/png"
    return { mime, buffer }
  }

  export async function resolveBase64(url: string): Promise<{ mime: string; data: string }> {
    if (!isFileUrl(url)) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) throw new Error("Invalid screenshot URL")
      return { mime: match[1], data: match[2] }
    }
    const { mime, buffer } = await resolve(url)
    return { mime, data: buffer.toString("base64") }
  }

  export function resolveSync(url: string): { mime: string; buffer: Buffer } | null {
    if (!isFileUrl(url)) return null
    const rel = url.slice(SCHEME.length)
    const filepath = path.join(SCREENSHOT_DIR, rel)
    try {
      const buffer = require("fs").readFileSync(filepath)
      const mime = rel.endsWith(".jpg") ? "image/jpeg" : "image/png"
      return { mime, buffer }
    } catch {
      return null
    }
  }

  export async function removeSession(sessionID: string): Promise<void> {
    const dir = path.join(SCREENSHOT_DIR, sessionID)
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  export async function removeByUrl(url: string): Promise<void> {
    if (!isFileUrl(url)) return
    const rel = url.slice(SCHEME.length)
    const filepath = path.join(SCREENSHOT_DIR, rel)
    await fs.rm(filepath, { force: true }).catch(() => {})
  }
}
