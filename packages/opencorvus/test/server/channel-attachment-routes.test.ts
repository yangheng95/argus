import { afterEach, describe, expect, test } from "bun:test"
import { routeRequiresProjectDirectory } from "@opencorvus-ai/transport-protocol"
import { rm } from "node:fs/promises"
import path from "node:path"
import { ChannelAttachment } from "../../src/channel/attachment"
import { Global } from "../../src/global"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

const originalPublicUrl = process.env.OPENCORVUS_PUBLIC_URL
const originalPublicSecret = process.env.OPENCORVUS_PUBLIC_URL_SECRET
const attachmentRoot = path.join(Global.Path.data, "channel-attachments")

function applyChannelAttachmentEnv() {
  process.env.OPENCORVUS_PUBLIC_URL = "https://channels.example.test"
  process.env.OPENCORVUS_PUBLIC_URL_SECRET = "channel-attachment-test-secret"
}

function localPathFromPublicUrl(publicUrl: string) {
  const parsed = new URL(publicUrl)
  return `${parsed.pathname}${parsed.search}`
}

function queryValue(publicUrl: string, name: string) {
  const value = new URL(publicUrl).searchParams.get(name)
  if (!value) throw new Error(`Generated channel attachment URL is missing ${name}`)
  return value
}

async function createAttachment() {
  applyChannelAttachmentEnv()
  return ChannelAttachment.create({
    filename: "quoted-name.txt",
    mime: "text/plain",
    data: Buffer.from("channel attachment body").toString("base64"),
  })
}

describe("channel attachment routes", () => {
  afterEach(async () => {
    if (originalPublicUrl === undefined) delete process.env.OPENCORVUS_PUBLIC_URL
    else process.env.OPENCORVUS_PUBLIC_URL = originalPublicUrl
    if (originalPublicSecret === undefined) delete process.env.OPENCORVUS_PUBLIC_URL_SECRET
    else process.env.OPENCORVUS_PUBLIC_URL_SECRET = originalPublicSecret
    Server.resetProjectRoutesAppForTest()
    await rm(attachmentRoot, { recursive: true, force: true })
    await resetDatabase()
  })

  test("GET /channel/attachment/:id is the only public channel directory-policy exception", () => {
    expect(routeRequiresProjectDirectory("/channel/attachment/attachment_123", "GET")).toBe(false)
    expect(routeRequiresProjectDirectory("/channel/attachment/attachment_123?e=1&s=x", "GET")).toBe(false)
    expect(routeRequiresProjectDirectory("/channel/attachment", "GET")).toBe(true)
    expect(routeRequiresProjectDirectory("/channel/attachment/attachment_123/extra", "GET")).toBe(true)
    expect(routeRequiresProjectDirectory("/channel/attachment", "POST")).toBe(true)
    expect(routeRequiresProjectDirectory("/channel/message", "POST")).toBe(true)
    expect(routeRequiresProjectDirectory("/channel/runtime", "GET")).toBe(true)
  })

  test("serves a valid signed channel attachment URL without project directory", async () => {
    const created = await createAttachment()

    const response = await Server.App().request(localPathFromPublicUrl(created.url))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/plain")
    expect(response.headers.get("content-disposition")).toBe('inline; filename="quoted-name.txt"')
    expect(await response.text()).toBe("channel attachment body")
  })

  test("rejects missing, invalid, expired, and orphaned signed channel attachment URLs", async () => {
    const created = await createAttachment()
    const parsed = new URL(created.url)
    const signature = queryValue(created.url, "s")
    const basePath = parsed.pathname

    const missingSignature = await Server.App().request(`${basePath}?e=${created.expires_at}`)
    expect(missingSignature.status).toBe(404)

    const invalidSignature = await Server.App().request(`${basePath}?e=${created.expires_at}&s=invalid`)
    expect(invalidSignature.status).toBe(404)

    const expired = await Server.App().request(`${basePath}?e=1&s=${signature}`)
    expect(expired.status).toBe(404)

    await rm(path.join(attachmentRoot, `${created.id}.json`), { force: true })
    const orphaned = await Server.App().request(localPathFromPublicUrl(created.url))
    expect(orphaned.status).toBe(404)
  })
})
