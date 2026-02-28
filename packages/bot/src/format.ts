import type { Part, ToolPart } from "@opencode-ai/sdk"

const MAX_LENGTH = 3000

export function formatResponse(parts: Part[]): string {
  const textLines: string[] = []
  const toolLines: string[] = []

  for (const part of parts) {
    if (part.type === "text") {
      textLines.push(part.text)
    } else if (part.type === "tool" && part.state.status === "completed") {
      toolLines.push(`*${part.tool}* — ${part.state.title}`)
    }
  }

  let text = textLines.join("\n") || "I received your message but didn't have a response."

  if (toolLines.length > 0) {
    text += "\n\n" + toolLines.join("\n")
  }

  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH - 3) + "..."
  }

  return text
}

export function formatToolUpdate(part: ToolPart): string | undefined {
  if (part.state.status !== "completed") return undefined
  return `*${part.tool}* — ${part.state.title}`
}
