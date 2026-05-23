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
            // CZ Kimi K2.6 has thinking enabled by default — most output
            // goes to reasoning_content. 64 tokens runs out mid-reasoning so
            // `content` is null. Give it enough budget to also emit text.
            maxOutputTokens: 512,
            timeoutMs: false,
            abortSignal: AbortSignal.timeout(120_000),
          })

          // AI SDK v6 delta parts carry token text in `text:` (not `delta:` /
          // `textDelta:`). Accumulate both text-delta and reasoning-delta —
          // reasoning-content is where Kimi K2.6 (default thinking mode) puts
          // its image observation.
          let observed = ""
          for await (const part of result.fullStream) {
            if (part.type === "text-delta" || part.type === "reasoning-delta") {
              observed += (part as { text?: string; delta?: string }).text ?? (part as { delta?: string }).delta ?? ""
            }
            if (part.type === "error") throw part.error
          }

          expect(observed.toLowerCase()).toMatch(/image|pixel|png|1x1|small|tiny|white|transparent|black/)
        },
      })
    },
  )
})
