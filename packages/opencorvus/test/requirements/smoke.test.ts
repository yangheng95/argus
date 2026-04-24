/**
 * Real-LLM smoke test for the phase-3-b-3 requirements migration.
 * Gated by OPENCORVUS_RUN_LIVE_E2E=1 / OPENCORVUS_RUN_REQUIREMENTS_SMOKE=1.
 */
import { afterAll, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Server } from "../../src/server/server"
import { RequirementsAgent } from "../../src/requirements/agent"
import { loadBenchmarkEnv, resolveBenchmarkModel } from "../../script/benchmark/env"

await loadBenchmarkEnv(import.meta.dir)

const RUN_LIVE =
  process.env.OPENCORVUS_RUN_LIVE_E2E === "1" ||
  process.env.OPENCORVUS_RUN_LIVE_E2E === "true" ||
  process.env.OPENCORVUS_RUN_REQUIREMENTS_SMOKE === "1"

let _liveServer: ReturnType<typeof Server.listen> | undefined
if (RUN_LIVE) {
  _liveServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
}

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")

let liveModel: string | undefined
if (RUN_LIVE) {
  liveModel = await resolveBenchmarkModel(import.meta.dir, {
    explicitKeys: ["OPENCORVUS_REQUIREMENTS_TEST_MODEL", "OPENCORVUS_E2E_MODEL"],
  }).catch((err) => {
    console.warn(`[requirements smoke] resolveBenchmarkModel failed: ${String(err)}`)
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
        console.warn(`[requirements smoke] model unavailable for ${liveModel}: ${String(err)}`)
        return false
      }
    },
  }).catch(() => false)
}

const liveTest = RUN_LIVE && HAS_LIVE ? test : test.skip

afterAll(() => {
  _liveServer?.stop?.(true)
})

describe("requirements agent (real-LLM smoke)", () => {
  liveTest(
    "produces REQ-N entries + decisions + summary from a simple brief",
    async () => {
      await Instance.provide({
        directory: PACKAGE_ROOT,
        fn: async () => {
          const parsed = Provider.parseModel(liveModel!)
          const result = await RequirementsAgent.run({
            title: "Add TODO list persistence",
            request:
              "Add persistence to our in-memory TodoStore so todos survive app restarts. " +
              "Acceptance: `bun test` passes; re-running the app shows previously added todos.",
            model: { providerID: parsed.providerID, modelID: parsed.modelID },
          })

          expect(typeof result.summary).toBe("string")
          expect(result.summary.length).toBeGreaterThan(0)
          expect(result.requirements.length).toBeGreaterThan(0)
          for (const req of result.requirements) {
            expect(/^REQ-\d+$/.test(req.id)).toBe(true)
            expect(["explicit", "implicit"]).toContain(req.type)
            expect(req.description.length).toBeGreaterThan(0)
          }
          for (const d of result.decisions) {
            expect(d.key.length).toBeGreaterThan(0)
            expect(d.value.length).toBeGreaterThan(0)
          }
        },
      })
    },
    300_000,
  )
})
