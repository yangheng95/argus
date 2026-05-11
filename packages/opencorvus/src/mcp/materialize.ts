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

  return {
    text: textParts.join("\n\n"),
    attachments,
    metadata,
  }
}
