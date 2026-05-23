import { describe, expect, test } from "bun:test"
import { streamText } from "../../src/llm/api"
import { Provider } from "../../src/provider/provider"
import { ProviderLLM } from "../../src/provider/llm"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { tmpdir } from "../fixture/fixture"

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

describe("OpenAI-compatible vision transport", () => {
  test.skipIf(process.env.OPENCORVUS_INTEGRATION !== "1")(
    "CZ kimik26 accepts opencorvus attachment refs after provider-transform inlining",
    async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = await Provider.getModel("kimik26", "kimik26")
          expect(model.capabilities.input.image).toBe(true)

          const ref = await AttachmentStore.write(Instance.project.id, ONE_BY_ONE_PNG, "image/png", "one.png")
          const language = ProviderLLM.wrapModel(await Provider.getLanguage(model), model, {})
          const result = streamText({
            model: language,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "Describe this image in one short sentence." },
                  { type: "file", data: ref.url, mediaType: "image/png", filename: "one.png" },
                ],
              },
            ],
            maxOutputTokens: 64,
            timeoutMs: false,
            abortSignal: AbortSignal.timeout(60_000),
          })

          let text = ""
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              text += (part as { delta?: string; textDelta?: string }).delta ?? (part as { textDelta?: string }).textDelta ?? ""
            }
            if (part.type === "error") throw part.error
          }

          expect(text.toLowerCase()).toMatch(/image|pixel|png|1x1|small|tiny|white|transparent|black/)
        },
      })
    },
  )
})
