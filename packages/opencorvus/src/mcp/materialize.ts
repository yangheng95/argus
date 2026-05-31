import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { AttachmentStore } from "@/storage/attachment-store"

export interface MaterializedMcpToolResult {
  text: string
  attachments: AttachmentStore.Reference[]
  metadata: Record<string, unknown>
}

export async function materializeMcpToolResult(input: {
  projectID: string
  result: CallToolResult & { metadata?: unknown }
  imageFilename?: string
}): Promise<MaterializedMcpToolResult> {
  const textParts: string[] = []
  const attachments: AttachmentStore.Reference[] = []

  for (const contentItem of input.result.content) {
    if (contentItem.type === "text") {
      textParts.push(contentItem.text)
      continue
    }
    if (contentItem.type === "image") {
      if (!contentItem.mimeType) throw new Error("MCP image content missing mimeType")
      attachments.push(
        await AttachmentStore.write(
          input.projectID,
          Buffer.from(contentItem.data, "base64"),
          contentItem.mimeType,
          input.imageFilename,
        ),
      )
      continue
    }
    if (contentItem.type === "resource") {
      const { resource } = contentItem
      if ("text" in resource && resource.text) textParts.push(resource.text)
      if ("blob" in resource && resource.blob) {
        const mime = resource.mimeType ?? "application/octet-stream"
        attachments.push(
          await AttachmentStore.write(
            input.projectID,
            Buffer.from(resource.blob, "base64"),
            mime,
            resource.uri,
          ),
        )
      }
      continue
    }
    throw new Error(`Unsupported MCP content item type: ${(contentItem as { type?: string }).type ?? "(missing)"}`)
  }

  const metadata = input.result.metadata && typeof input.result.metadata === "object" && !Array.isArray(input.result.metadata)
    ? input.result.metadata as Record<string, unknown>
    : {}
  const browser = browserObservationMetadata(
    (input.result as { structuredContent?: unknown }).structuredContent,
    attachments,
  )

  return {
    text: textParts.join("\n\n"),
    attachments,
    metadata: browser ? { ...metadata, browser } : metadata,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

function numberValue(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}

function stringValue(input: unknown): string | undefined {
  return typeof input === "string" ? input : undefined
}

function diagnosticCount(input: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = input?.[key]
  return Array.isArray(value) ? value.length : undefined
}

function browserObservationMetadata(
  structuredContent: unknown,
  attachments: AttachmentStore.Reference[],
): Record<string, unknown> | undefined {
  if (!isRecord(structuredContent)) return
  const screenshot = isRecord(structuredContent.screenshot) ? structuredContent.screenshot : structuredContent
  const width = numberValue(screenshot.width)
  const height = numberValue(screenshot.height)
  const mimeType = stringValue(screenshot.mimeType)
  const hasScreenshotPayload = typeof screenshot.data === "string" || width !== undefined || height !== undefined || mimeType
  if (!hasScreenshotPayload) return

  const attachment = attachments.find((item) => item.mime.startsWith("image/"))
  const diagnostics = isRecord(structuredContent.diagnostics) ? structuredContent.diagnostics : undefined
  const viewport = isRecord(structuredContent.viewport)
    ? {
        width: numberValue(structuredContent.viewport.width),
        height: numberValue(structuredContent.viewport.height),
      }
    : undefined
  return {
    url: stringValue(structuredContent.url),
    title: stringValue(structuredContent.title),
    viewport,
    screenshot: {
      mimeType,
      width,
      height,
      attachmentUrl: attachment?.url,
      sha: attachment?.sha,
    },
    diagnostics: diagnostics
      ? {
          consoleErrors: diagnosticCount(diagnostics, "consoleErrors"),
          pageErrors: diagnosticCount(diagnostics, "pageErrors"),
          failedRequests: diagnosticCount(diagnostics, "failedRequests"),
          httpErrors: diagnosticCount(diagnostics, "httpErrors"),
        }
      : undefined,
  }
}
