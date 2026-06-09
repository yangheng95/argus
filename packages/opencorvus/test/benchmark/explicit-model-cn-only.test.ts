import { test, expect } from "bun:test"
import { explicitModel } from "../../script/benchmark/env"

/**
 * Bench scripts use 国内 sk-sp-* keys, which the international
 * `alibaba-coding-plan` endpoint (coding-intl.dashscope.aliyuncs.com) rejects
 * with HTTP 401. Rule 8 (no double source): bench must commit to the `-cn`
 * variant exclusively. Both auto-resolution and explicit env-var pinning
 * (`OPENCORVUS_BENCHMARK_MODEL=alibaba-coding-plan/...`) must refuse the
 * international variant rather than silently 401 inside the orchestrator
 * stream (see _session-r2-glm5.out 14:47:25).
 */

const STUB_PROVIDERS = {
  "alibaba-coding-plan-cn": {
    id: "alibaba-coding-plan-cn",
    models: { "glm-5": { id: "glm-5" } },
  },
} as any

test("explicit alibaba-coding-plan/<model> is rejected with rule-8 message", () => {
  expect(() => explicitModel(STUB_PROVIDERS, "alibaba-coding-plan/glm-5")).toThrow(/alibaba-coding-plan-cn/)
})

test("explicit alibaba-coding-plan-cn/<model> passes through unchanged", () => {
  expect(explicitModel(STUB_PROVIDERS, "alibaba-coding-plan-cn/glm-5")).toBe("alibaba-coding-plan-cn/glm-5")
})

test("bare model id resolves through preferredProviders to the -cn variant", () => {
  expect(explicitModel(STUB_PROVIDERS, "glm-5")).toBe("alibaba-coding-plan-cn/glm-5")
})
