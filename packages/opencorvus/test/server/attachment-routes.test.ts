import { afterEach, describe, expect, test } from "bun:test"
import sharp from "sharp"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("attachment routes", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("serves stored SVG as a non-executable download", async () => {
    await using tmp = await tmpdir({ git: true })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>globalThis.__owned = true</script></svg>`

    let url = ""
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ref = await AttachmentStore.write(Instance.project.id, Buffer.from(svg), "image/svg+xml", "owned.svg")
        url = ref.url
      },
    })

    const response = await Server.App().request(url, {
      method: "GET",
      headers: { "x-opencorvus-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/octet-stream")
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="[0-9a-f]{64}\.svg"$/)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toBe(svg)
  })

  test("keeps ordinary image attachments renderable inline", async () => {
    await using tmp = await tmpdir({ git: true })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

    let url = ""
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ref = await AttachmentStore.write(Instance.project.id, png, "image/png", "shot.png")
        url = ref.url
      },
    })

    const response = await Server.App().request(url, {
      method: "GET",
      headers: { "x-opencorvus-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("content-disposition")).toBeNull()
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })

  test("serves screenshot browser thumbnail variant as a bounded derived image", async () => {
    await using tmp = await tmpdir({ git: true })
    const png = await sharp({
      create: {
        width: 1440,
        height: 900,
        channels: 3,
        background: "#4f46e5",
      },
    })
      .png()
      .toBuffer()

    let projectID = ""
    let url = ""
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        projectID = Instance.project.id
        const ref = await AttachmentStore.write(Instance.project.id, png, "image/png", "shot.png")
        url = ref.url
      },
    })

    const response = await Server.App().request(
      `${url}?variant=${AttachmentStore.SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
      {
        method: "GET",
        headers: { "x-opencorvus-directory": tmp.path },
      },
    )
    const bytes = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(bytes).metadata()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe(AttachmentStore.SCREENSHOT_BROWSER_THUMBNAIL_MIME)
    expect(response.headers.get("content-disposition")).toBeNull()
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(metadata.format).toBe("webp")
    expect(metadata.width).toBe(360)
    expect(metadata.height).toBe(225)
    expect(bytes.length).toBeLessThan(png.length)

    const originalName = url.slice(url.lastIndexOf("/") + 1)
    const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : ""
    const stem = ext ? originalName.slice(0, -ext.length) : originalName
    const directDerivedResponse = await Server.App().request(
      `/attachment/${projectID}/${stem}.${AttachmentStore.SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}.webp`,
      {
        method: "GET",
        headers: { "x-opencorvus-directory": tmp.path },
      },
    )
    expect(directDerivedResponse.status).toBe(404)
  })

  test("unknown attachment variants fail instead of serving the original", async () => {
    await using tmp = await tmpdir({ git: true })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

    let url = ""
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ref = await AttachmentStore.write(Instance.project.id, png, "image/png", "shot.png")
        url = ref.url
      },
    })

    const response = await Server.App().request(`${url}?variant=unknown`, {
      method: "GET",
      headers: { "x-opencorvus-directory": tmp.path },
    })

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("Not found")
  })
})
