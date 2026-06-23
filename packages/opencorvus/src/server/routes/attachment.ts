import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { stat, readFile } from "node:fs/promises"
import path from "node:path"
import { AttachmentStore } from "@/storage/attachment-store"
import { lazy } from "../../util/lazy"

const MIME_FROM_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  weba: "audio/webm",
  oga: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  bin: "application/octet-stream",
}

function mimeFromName(name: string): string {
  const ext = path.extname(name).replace(/^\./, "").toLowerCase()
  return MIME_FROM_EXT[ext] ?? "application/octet-stream"
}

function attachmentHeaders(name: string, size: number) {
  const mime = mimeFromName(name)
  const headers: Record<string, string> = {
    "content-type": mime,
    "content-length": String(size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  }
  if (mime === "image/svg+xml") {
    headers["content-type"] = "application/octet-stream"
    headers["content-disposition"] = `attachment; filename="${name}"`
  }
  return headers
}

function thumbnailHeaders(size: number) {
  return {
    "content-type": AttachmentStore.SCREENSHOT_BROWSER_THUMBNAIL_MIME,
    "content-length": String(size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  }
}

/**
 * GET /attachment/:projectID/:name
 * Serves a content-addressed attachment previously written by AttachmentStore.
 * Content-Type is derived from the stored file extension, except SVG files:
 * those are served as download-only octet-streams because active SVG can run
 * same-origin script when opened as a top-level document.
 * 404 when the project or file is unknown — no fallback lookups.
 */
export const AttachmentRoutes = lazy(() =>
  new Hono().get(
    "/:projectID/:name",
    describeRoute({
      summary: "Fetch a task attachment",
      operationId: "attachment.get",
      responses: {
        200: { description: "Attachment bytes" },
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const projectID = c.req.param("projectID")
      const name = c.req.param("name")
      if (!projectID || !name || name.includes("/") || name.includes("\\")) {
        return c.text("Not found", 404)
      }
      const variant = c.req.query("variant") ?? ""
      if (variant) {
        if (variant !== AttachmentStore.SCREENSHOT_BROWSER_THUMBNAIL_VARIANT) return c.text("Not found", 404)
        const sourceAbs = AttachmentStore.resolveAbsolute(projectID, name)
        if (!sourceAbs) return c.text("Not found", 404)
        const sourceInfo = await stat(sourceAbs).catch(() => undefined)
        if (!sourceInfo || !sourceInfo.isFile()) return c.text("Not found", 404)
        const thumbnail = await AttachmentStore.screenshotBrowserThumbnail(projectID, name)
        const body = await readFile(thumbnail.abs)
        return new Response(body as unknown as BodyInit, {
          status: 200,
          headers: thumbnailHeaders(thumbnail.size),
        })
      }
      const abs = AttachmentStore.resolveAbsolute(projectID, name)
      if (!abs) return c.text("Not found", 404)
      const info = await stat(abs).catch(() => undefined)
      if (!info || !info.isFile()) return c.text("Not found", 404)
      const body = await readFile(abs)
      return new Response(body as unknown as BodyInit, {
        status: 200,
        headers: attachmentHeaders(name, info.size),
      })
    },
  ),
)
