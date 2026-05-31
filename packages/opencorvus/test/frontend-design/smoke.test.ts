/**
 * Real-LLM smoke test for the phase-3-b-2 frontend-design migration.
 *
 * Gated behind OPENCORVUS_RUN_LIVE_E2E=1 / OPENCORVUS_RUN_DESIGN_SMOKE=1.
 * Runs with no visual attachments so the agent exercises the text-only
 * code path — enough to prove the SessionPrompt + extraTools + multimodal
 * parts pipeline resolves and the submit_frontend_template terminal call lands.
 * An image-backed smoke test that verifies extracted color/typography
 * specs is deferred until the phase-3 sweep reaches a full dispatch run.
 */
import { afterAll, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Server } from "../../src/server/server"
import { FrontendDesignAgent } from "../../src/frontend-design/agent"
import { loadBenchmarkEnv, resolveBenchmarkModel } from "../../script/benchmark/env"

await loadBenchmarkEnv(import.meta.dir)

const RUN_LIVE =
  process.env.OPENCORVUS_RUN_LIVE_E2E === "1" ||
  process.env.OPENCORVUS_RUN_LIVE_E2E === "true" ||
  process.env.OPENCORVUS_RUN_DESIGN_SMOKE === "1"

let _liveServer: ReturnType<typeof Server.listen> | undefined
if (RUN_LIVE) {
  _liveServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
}

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")

let liveModel: string | undefined
if (RUN_LIVE) {
  liveModel = await resolveBenchmarkModel(import.meta.dir, {
    explicitKeys: ["OPENCORVUS_DESIGN_TEST_MODEL", "OPENCORVUS_E2E_MODEL"],
  }).catch((err) => {
    console.warn(`[frontend-design smoke] resolveBenchmarkModel failed: ${String(err)}`)
    return undefined
  })
}

let HAS_LIVE = false
if (RUN_LIVE && liveModel) {
  HAS_LIVE = await Instance.provide({
    directory: PACKAGE_ROOT,
    fn: async () => {
      try {
        const parsed = Provider.parseModel(liveModel!)
        const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
        await Provider.getLanguage(resolved)
        return true
      } catch (err) {
        console.warn(`[frontend-design smoke] model unavailable for ${liveModel}: ${String(err)}`)
        return false
      }
    },
  }).catch(() => false)
}

const liveTest = RUN_LIVE && HAS_LIVE ? test : test.skip

afterAll(() => {
  _liveServer?.stop?.(true)
})

describe("frontend-design agent (real-LLM smoke)", () => {
  liveTest(
    "produces frontend template fields from a text-only brief",
    async () => {
      await Instance.provide({
        directory: PACKAGE_ROOT,
        fn: async () => {
          const parsed = Provider.parseModel(liveModel!)
          const result = await FrontendDesignAgent.analyze({
            title: "Minimal docs landing page",
            request:
              "Build a single-page docs site with a hero section " +
              "(title `Welcome to Opencorvus` on a dark navy background #0A1628), " +
              "a two-column content area below, and a footer. " +
              "Use Inter as the heading font and system sans for body. " +
              "Primary CTA button is teal #14B8A6.",
            model: { providerID: parsed.providerID, modelID: parsed.modelID },
          })

          expect(Array.isArray(result.specs)).toBe(true)
          expect(typeof result.designSystem).toBe("string")
          expect(result.designSystem.length).toBeGreaterThan(0)
          expect(Array.isArray(result.techStack)).toBe(true)
          expect(result.techStack.length).toBeGreaterThanOrEqual(1)
          expect(typeof result.frontendTemplate).toBe("string")
          expect(result.frontendTemplate.length).toBeGreaterThan(0)
          expect(typeof result.fillableModules).toBe("string")
          expect(result.fillableModules.length).toBeGreaterThan(0)
          expect(typeof result.componentInventory).toBe("string")
          expect(result.componentInventory.length).toBeGreaterThan(0)
          expect(Array.isArray(result.componentReusePlan)).toBe(true)
          expect(Array.isArray(result.baselineReplacementPlan)).toBe(true)
          expect(typeof result.materialInventory).toBe("string")
          expect(result.materialInventory.length).toBeGreaterThan(0)
          expect(typeof result.visualConsistencyContract).toBe("string")
          expect(result.visualConsistencyContract.length).toBeGreaterThan(0)
          expect(typeof result.uiDataContract).toBe("string")
          expect(result.uiDataContract.length).toBeGreaterThan(0)
          expect(Array.isArray(result.templateIterationNotes)).toBe(true)
          expect(result.templateIterationNotes.length).toBeGreaterThanOrEqual(2)
          expect(typeof result.completenessReview).toBe("string")
          expect(result.completenessReview.length).toBeGreaterThan(0)
          expect(Array.isArray(result.referenceArtifacts)).toBe(true)
          expect(Array.isArray(result.openQuestions)).toBe(true)
          // Spec count is LLM-dependent; just assert well-formed structure
          // when any specs exist.
          for (const spec of result.specs) {
            expect(typeof spec.id).toBe("string")
            expect(spec.id.startsWith("vis-")).toBe(true)
            expect(typeof spec.category).toBe("string")
          }
        },
      })
    },
    300_000,
  )
})
