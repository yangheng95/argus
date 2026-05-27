import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Vite replaces this token at build time; the test runner has to provide
// a stub before importing any module that transitively depends on it.
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ =
  "test"

const GATEWAY_TSX = readFileSync(join(import.meta.dir, "../src/components/Gateway.tsx"), "utf8")
const SERVICES_GATEWAY = readFileSync(join(import.meta.dir, "../src/services/gateway.ts"), "utf8")
const HELPERS = readFileSync(join(import.meta.dir, "../src/utils/gateway-helpers.ts"), "utf8")
const I18N_ZH_CN = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")
const I18N_EN_US = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")

/**
 * Spec: gateway-master-supervisor-2026-05-26.md §2.7.
 *
 * The Gateway page's composer surface is now the MissionLauncher — it
 * starts or resumes a gateway-master session via POST /gateway/master/wake.
 * The legacy decompose-then-review flow (GatewayComposer +
 * GatewayProposalReview) is intentionally removed (rule 8 + 16 / 17).
 *
 * These structural assertions guard the wiring:
 *   - the source no longer references the dead decompose API surface,
 *   - the new wakeMaster client function is reachable from the page,
 *   - both locales carry the master.* copy the UI renders.
 */

// ── Dead surfaces purged ─────────────────────────────────────

test("Gateway.tsx no longer imports the decompose service surface", () => {
  expect(GATEWAY_TSX).not.toContain("decomposeRequirement")
  expect(GATEWAY_TSX).not.toContain("GatewayTaskCandidate")
  expect(GATEWAY_TSX).not.toContain("GatewayTaskDecomposition")
  expect(GATEWAY_TSX).not.toContain("composeTaskText")
})

test("Gateway.tsx no longer renders the proposal review UI", () => {
  expect(GATEWAY_TSX).not.toContain("GatewayProposalReview")
  expect(GATEWAY_TSX).not.toContain("ProposalCandidateState")
  expect(GATEWAY_TSX).not.toContain("gateway-proposal-")
})

test("services/gateway.ts no longer exports decompose API surface", () => {
  expect(SERVICES_GATEWAY).not.toContain("decomposeRequirement")
  expect(SERVICES_GATEWAY).not.toContain("GatewayTaskCandidate")
  expect(SERVICES_GATEWAY).not.toContain("GatewayTaskDecomposition")
})

test("gateway-helpers.ts no longer exports composeTaskText", () => {
  expect(HELPERS).not.toContain("composeTaskText")
})

// ── New mission supervisor surface present ───────────────────

test("Gateway.tsx uses wakeMaster from the gateway service", () => {
  expect(GATEWAY_TSX).toContain('wakeMaster')
})

test("Gateway wake result opens the shared mission conversation surface", () => {
  expect(GATEWAY_TSX).toContain("handleMissionAwake")
  expect(GATEWAY_TSX).toContain('setBoardStore("selectedSource", source)')
  expect(GATEWAY_TSX).toContain("loadConversation(source")
  expect(GATEWAY_TSX).toContain("startSSE(source")
  expect(GATEWAY_TSX).toContain("GatewayMissionConversation")
})

test("services/gateway.ts exports wakeMaster pointed at /gateway/master/wake", () => {
  expect(SERVICES_GATEWAY).toContain("export async function wakeMaster")
  expect(SERVICES_GATEWAY).toContain("`gateway/master/wake`")
  expect(SERVICES_GATEWAY).toContain("MasterWakeInput")
  expect(SERVICES_GATEWAY).toContain("MasterWakeResult")
})

test("MissionLauncher textarea respects the shared length cap", () => {
  // The supervisor wake text shares the same 32K cap as the prior
  // decompose endpoint; the constant is reused to keep client + server
  // in lockstep (helpers.GATEWAY_REQUIREMENT_MAX_CHARS).
  expect(GATEWAY_TSX).toContain("GATEWAY_REQUIREMENT_MAX_CHARS")
})

test("MissionLauncher exposes the standard data-ui hooks for downstream e2e", () => {
  // These attributes are part of the gateway page contract — the e2e
  // tests select on them rather than on i18n text.
  expect(GATEWAY_TSX).toContain('data-ui="gateway-composer-input"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-composer-submit"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-composer-mission-id"')
})

// ── i18n master keys present in both locales ─────────────────

const MASTER_KEYS = [
  "gateway.master.title",
  "gateway.master.placeholder",
  "gateway.master.length_counter",
  "gateway.master.mission_id_label",
  "gateway.master.mission_id_placeholder",
  "gateway.master.submitting",
  "gateway.master.start",
  "gateway.master.resume",
  "gateway.master.error",
  "gateway.master.discard",
  "gateway.master.discard_title",
  "gateway.master.result_created",
  "gateway.master.result_resumed",
]

for (const key of MASTER_KEYS) {
  test(`zh-CN locale defines ${key}`, () => {
    const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
    expect(typeof zh[key]).toBe("string")
    expect((zh[key] as string).length).toBeGreaterThan(0)
  })
  test(`en-US locale defines ${key}`, () => {
    const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
    expect(typeof en[key]).toBe("string")
    expect((en[key] as string).length).toBeGreaterThan(0)
  })
}

// ── No legacy compose/proposal keys leak through ─────────────

test("legacy gateway.compose.* keys are fully removed from both locales", () => {
  const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
  const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
  for (const map of [zh, en]) {
    const stragglers = Object.keys(map).filter((k) => k.startsWith("gateway.compose."))
    expect(stragglers).toEqual([])
  }
})

test("legacy gateway.proposal.* keys are fully removed from both locales", () => {
  const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
  const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
  for (const map of [zh, en]) {
    const stragglers = Object.keys(map).filter((k) => k.startsWith("gateway.proposal."))
    expect(stragglers).toEqual([])
  }
})
