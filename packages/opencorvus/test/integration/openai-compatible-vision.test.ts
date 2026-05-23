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

  // Autonomous-read scenario: agent calls a tool that returns an image
  // attachment. Opencorvus's session pipeline (session/message.ts:988-992)
  // injects a synthetic user message containing the file parts after the
  // tool result, then the next provider call routes through
  // ProviderTransform.message — which must inline `/attachment/...` refs.
  // This faithfully reproduces the message shape without spinning a full
  // Session (Session would itself wrap streamText with the same transform).
  test.skipIf(process.env.OPENCORVUS_INTEGRATION !== "1")(
    "CZ kimik26 sees image surfaced via tool-result + synthetic user-message media re-injection",
    async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = await Provider.getModel("kimik26", "kimik26")
          const ref = await AttachmentStore.write(Instance.project.id, ONE_BY_ONE_PNG, "image/png", "tool-result.png")
          const language = ProviderLLM.wrapModel(await Provider.getLanguage(model), model, {})

          const result = streamText({
            model: language,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "Read the file tool-result.png and describe it." }],
              },
              {
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "call_read_1",
                    toolName: "read",
                    input: { filePath: "tool-result.png" },
                  },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "call_read_1",
                    toolName: "read",
                    output: { type: "text", value: "Read tool-result.png (image attached on next turn)." },
                  },
                ],
              },
              // The synthetic user-message that opencorvus inserts to surface
              // tool-result media to providers that don't carry images in
              // tool_result blocks (see session/message.ts:988-992). The
              // `/attachment/...` ref MUST be inlined to raw base64 by
              // ProviderTransform for CZ Kimi to actually receive the bytes.
              {
                role: "user",
                content: [
                  { type: "text", text: "Attached image(s) from tool result:" },
                  { type: "file", data: ref.url, mediaType: "image/png", filename: "tool-result.png" },
                ],
              },
            ],
            maxOutputTokens: 512,
            timeoutMs: false,
            abortSignal: AbortSignal.timeout(120_000),
          })

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
