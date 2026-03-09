import { createOpenCorvusClient } from "@opencorvus-ai/sdk/v2"
import type { Part, SessionCreateResponse, SessionPromptResponse } from "@opencorvus-ai/sdk/v2"
import type { Worker } from "./worker"

export function createOpencodeWorker(input?: { baseUrl?: string; directory?: string }): Worker {
  const client = createOpenCorvusClient({
    baseUrl: input?.baseUrl ?? "http://127.0.0.1:7878",
    directory: input?.directory,
  })

  return {
    async run(job) {
      const sessionId =
        job.sessionId ??
        need<SessionCreateResponse>(
          await client.session.create({
            title: job.title,
          }),
        ).id

      const result = need<SessionPromptResponse>(
        await client.session.prompt({
          sessionID: sessionId,
          agent: job.agent,
          parts: [
            {
              type: "text",
              text: job.prompt,
            },
          ],
        }),
      )

      return {
        sessionId,
        messageId: result.info.id,
        text: text(result.parts),
      }
    },
  }
}

function text(parts: Part[]) {
  return parts
    .filter((item): item is Extract<Part, { type: "text" }> => item.type === "text")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function need<T>(result: { data?: T }) {
  if (result.data) return result.data
  throw new Error("OpenCode request returned no data")
}
