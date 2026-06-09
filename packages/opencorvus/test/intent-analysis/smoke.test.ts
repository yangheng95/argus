/**
 * Real-LLM smoke test for the phase-3 intent-analysis migration
 * (specs/new-arch/16-unified-teardown.md §7-3-b).
 *
 * Verifies the migrated agent actually produces an IntentAnalysisResult
 * against a live DASHSCOPE model. Gated behind `OPENCORVUS_RUN_LIVE_E2E=1`
 * so the test is skipped during normal `bun test` runs but can be invoked
 * explicitly when credentials + model are available (see
 * `packages/opencorvus/script/benchmark/env.ts`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Server } from "../../src/server/server"
import { IntentAnalysisAgent } from "../../src/intent-analysis/agent"
import { INTENT_CLASSES, COMPLEXITY_BANDS } from "../../src/intent-analysis/output-tools"
import { loadBenchmarkEnv, resolveBenchmarkModel } from "../../script/benchmark/env"

await loadBenchmarkEnv(import.meta.dir)

const RUN_LIVE =
  process.env.OPENCORVUS_RUN_LIVE_E2E === "1" ||
  process.env.OPENCORVUS_RUN_LIVE_E2E === "true" ||
  process.env.OPENCORVUS_RUN_INTENT_SMOKE === "1"

// Start a minimal listener at import time so resolveBenchmarkModel's
// Instance.provide chain (which reaches Plugin.trigger → Server.url())
// has a URL to read. The listener binds to an ephemeral port and is
// stopped after the smoke test runs.
let _liveServer: ReturnType<typeof Server.listen> | undefined
if (RUN_LIVE) {
  _liveServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
}

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")

async function resolveModel() {
  return resolveBenchmarkModel(import.meta.dir, {
    explicitKeys: ["OPENCORVUS_INTENT_TEST_MODEL", "OPENCORVUS_E2E_MODEL"],
  })
}

async function hasModel(model: string) {
  try {
    await Instance.provide({
      directory: PACKAGE_ROOT,
      fn: async () => {
        const parsed = Provider.parseModel(model)
        const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
        await Provider.getLanguage(resolved)
      },
    })
    return true
  } catch (err) {
    console.warn(`[intent-analysis smoke] model unavailable for ${model}: ${String(err)}`)
    return false
  }
}

let liveModel: string | undefined
if (RUN_LIVE) {
  liveModel = await resolveModel().catch((err) => {
    console.warn(`[intent-analysis smoke] resolveBenchmarkModel failed: ${String(err)}`)
    return undefined
  })
}

const HAS_LIVE = !!liveModel && (await hasModel(liveModel!).catch(() => false))

const liveTest = RUN_LIVE && HAS_LIVE ? test : test.skip

afterAll(() => {
  _liveServer?.stop?.(true)
})

describe("intent-analysis agent (real-LLM smoke)", () => {
  liveTest(
    "returns a structured IntentAnalysisResult for a trivial bug-fix request",
    async () => {
      await Instance.provide({
        directory: PACKAGE_ROOT,
        fn: async () => {
          const parsed = Provider.parseModel(liveModel!)
          const { result, sessionID } = await IntentAnalysisAgent.analyze({
            request: "Fix the typo 'recieve' → 'receive' in README.md.",
            title: "Typo fix",
            model: { providerID: parsed.providerID, modelID: parsed.modelID },
          })

          expect(sessionID).toBeTruthy()
          expect((INTENT_CLASSES as readonly string[]).includes(result.intent_class)).toBe(true)
          expect((COMPLEXITY_BANDS as readonly string[]).includes(result.complexity)).toBe(true)
          expect(result.summary.length).toBeGreaterThan(0)
          expect(result.confidence).toBeGreaterThanOrEqual(0)
          expect(result.confidence).toBeLessThanOrEqual(1)
          // Phase-3-b contract: the migrated agent preserves the old
          // IntentAnalysisResult shape. Incremental fields are arrays
          // (possibly empty) even if the LLM did not call the incremental
          // tools.
          expect(Array.isArray(result.extracted_slots)).toBe(true)
          expect(Array.isArray(result.missing_info)).toBe(true)
          expect(Array.isArray(result.clarifications)).toBe(true)
        },
      })
    },
    180_000,
  )
})
