import { describe, expect, test } from "bun:test"
import "../../src/session/prompt"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

/**
 * Phase E of deleted pre-June record 2026-04-28-structured-output-systemic-fix:
 * end-to-end provider probe for the `{ type: "tool", toolName: "..." }`
 * tool-choice pin.
 *
 * Default-skipped — only runs when:
 *
 *   OPENCORVUS_PROVIDER_E2E=1
 *   OPENCORVUS_E2E_PROVIDER_ID=<provider-id>
 *   OPENCORVUS_E2E_MODEL_ID=<model-id>
 *
 * When enabled the test registers two tools (`useless_work` and
 * `target`), drives a single LLM stream with `toolChoice = { type: "tool",
 * toolName: "target" }`, and asserts the model only invokes `target` with a
 * schema-valid object payload.
 * Failure means the provider does NOT honour the protocol-level pin —
 * which is a structural blocker for any agent that depends on
 * StructuredOutput hard-pinning. Per spec §E禁止项, we do NOT introduce
 * an `activeTools` fallback for such providers; the test surfaces the
 * provider as incompatible and the operator must pick a different model.
 *
 * The probe is intentionally NOT wired into default CI to avoid spending
 * tokens on every test run. Operators run it manually before promoting a
 * provider/model into the production catalogue.
 */
const enabled = Bun.env.OPENCORVUS_PROVIDER_E2E === "1"
const providerID = Bun.env.OPENCORVUS_E2E_PROVIDER_ID ?? ""
const modelID = Bun.env.OPENCORVUS_E2E_MODEL_ID ?? ""
const ready = enabled && providerID.length > 0 && modelID.length > 0

describe.skipIf(!ready)("provider hard-pin probe (opt-in)", () => {
  test(`provider=${providerID} model=${modelID} respects toolChoice={type:"tool",toolName:"target"}`, async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Imported lazily so the module graph is not loaded when the suite
        // is skipped — keeps the default test run fast.
        const { LLM } = await import("../../src/session/llm")
        const { Provider } = await import("../../src/provider/provider")
        const { Agent } = await import("../../src/agent/agent")
        const { tool, jsonSchema } = await import("ai")
        const z = (await import("zod")).default

        const model = await Provider.getModel(providerID, modelID)
        const agent = await Agent.defaultAgent()

        let useless = 0
        let target = 0
        const targetInputs: unknown[] = []
        const tools = {
          useless_work: tool({
            description: "Do nothing useful — never call this.",
            inputSchema: jsonSchema(z.toJSONSchema(z.object({})) as never),
            async execute() {
              useless++
              return { output: "ignored", title: "", metadata: {} }
            },
          }),
          target: tool({
            description: "The only tool the model is allowed to call.",
            inputSchema: jsonSchema(z.toJSONSchema(z.object({ note: z.string() })) as never),
            async execute(args) {
              target++
              targetInputs.push(args)
              return { output: "captured", title: "", metadata: {} }
            },
          }),
        }

        const stream = await LLM.stream({
          agent,
          model,
          sessionID: "ses_e2e_probe",
          system: ["You are a probe. Call the tool you are pinned to."],
          messages: [{ role: "user", content: "Please call your tool." }],
          tools,
          toolChoice: { type: "tool", toolName: "target" },
          retries: 0,
          abort: AbortSignal.timeout(30_000),
          user: {
            id: "msg_e2e",
            sessionID: "ses_e2e_probe",
            role: "user",
            time: { created: Date.now() },
            agent: agent.name,
            model: { providerID, modelID },
          },
        })

        // Drain the stream so provider tool calls and SDK validation complete.
        for await (const event of stream.fullStream) {
          if (event.type === "error") {
            throw event.error
          }
        }

        expect(useless).toBe(0)
        expect(target).toBeGreaterThanOrEqual(1)
        expect(targetInputs.length).toBe(target)
        for (const input of targetInputs) {
          expect(input).toEqual({ note: expect.any(String) })
          expect((input as { note: string }).note.length).toBeGreaterThan(0)
        }
      },
    })
  }, 60_000)
})
