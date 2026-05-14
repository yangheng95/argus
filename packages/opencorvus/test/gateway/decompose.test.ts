import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  GatewayCandidatePriority,
  GatewayTaskCandidate,
  GatewayTaskDecomposition,
  validateCandidateDependencies,
} from "../../src/gateway/decompose"

const DECOMPOSE_SRC = readFileSync(
  path.join(import.meta.dir, "..", "..", "src", "gateway", "decompose.ts"),
  "utf8",
)
const GATEWAY_ROUTE_SRC = readFileSync(
  path.join(import.meta.dir, "..", "..", "src", "server", "routes", "gateway.ts"),
  "utf8",
)
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("Gateway requirement decomposition (PRD §8 / §11)", () => {
  // ── Schema invariants ──────────────────────────────────────────────

  test("response schema rejects unknown priorities", () => {
    expect(GatewayCandidatePriority.safeParse("normal").success).toBe(true)
    expect(GatewayCandidatePriority.safeParse("urgent").success).toBe(false)
  })

  test("candidate schema requires id, title, description, priority and recommended_queue", () => {
    const minimal = {
      id: "x",
      title: "t",
      description: "d",
      priority: "normal" as const,
      recommended_queue: false,
      acceptance: [],
      dependencies: [],
      risks: [],
    }
    expect(GatewayTaskCandidate.safeParse(minimal).success).toBe(true)
    // Missing recommended_queue must fail.
    const { recommended_queue: _omit, ...without } = minimal
    expect(GatewayTaskCandidate.safeParse(without).success).toBe(false)
  })

  test("acceptance/dependencies/risks default to empty arrays so callers never need a fallback", () => {
    const parsed = GatewayTaskCandidate.parse({
      id: "x",
      title: "t",
      description: "d",
      priority: "normal",
      recommended_queue: false,
    })
    expect(parsed.acceptance).toEqual([])
    expect(parsed.dependencies).toEqual([])
    expect(parsed.risks).toEqual([])
  })

  test("response top-level schema requires proposal_id, requirement, summary, and tasks", () => {
    const ok = GatewayTaskDecomposition.safeParse({
      proposal_id: "proposal_abc",
      requirement: "hello",
      summary: "ok",
      tasks: [
        {
          id: "x",
          title: "t",
          description: "d",
          priority: "normal",
          recommended_queue: false,
          acceptance: [],
          dependencies: [],
          risks: [],
        },
      ],
    })
    expect(ok.success).toBe(true)
  })

  // ── Dependency graph invariants (PRD §18 — unit "dependency ids must refer to proposed task ids") ──

  test("validateCandidateDependencies accepts a topologically ordered list", () => {
    expect(() =>
      validateCandidateDependencies([
        candidate("a", []),
        candidate("b", ["a"]),
        candidate("c", ["a", "b"]),
      ]),
    ).not.toThrow()
  })

  test("validateCandidateDependencies rejects forward references", () => {
    expect(() =>
      validateCandidateDependencies([
        candidate("a", ["b"]),
        candidate("b", []),
      ]),
    ).toThrow(/depends on "b"/)
  })

  test("validateCandidateDependencies rejects unknown dependency ids", () => {
    expect(() =>
      validateCandidateDependencies([
        candidate("a", []),
        candidate("b", ["nope"]),
      ]),
    ).toThrow(/depends on "nope"/)
  })

  test("validateCandidateDependencies rejects duplicate candidate ids (codex round-3 P2)", () => {
    expect(() =>
      validateCandidateDependencies([
        candidate("a", []),
        candidate("b", ["a"]),
        candidate("a", []),
      ]),
    ).toThrow(/duplicate candidate id "a"/)
  })

  // ── Codex round-2 P2: timeout / cancellation behaviour ──

  test("decompose uses activity-aware idle timeout, not wall-clock", () => {
    // Pre-fix: a 60 s wall-clock cap killed valid slow streams.
    // Fix: chunk-driven idle gate via withStreamActivity.
    expect(DECOMPOSE_SRC).toContain("withStreamActivity")
    expect(DECOMPOSE_SRC).toContain("DECOMPOSE_IDLE_MS")
    expect(DECOMPOSE_SRC).toMatch(/gate\.observe\(\)/)
    expect(DECOMPOSE_SRC).toMatch(/abortSignal:\s*gate\.signal/)
    // The wall-clock SDK timeout must be explicitly opted out.
    expect(DECOMPOSE_SRC).toMatch(/timeoutMs:\s*false/)
  })

  test("decompose tears down the activity gate on every code path (no leak)", () => {
    // `withStreamActivity` returns a gate with a setTimeout — failing
    // to dispose leaks the timer if the function throws.
    expect(DECOMPOSE_SRC).toMatch(/finally\s*\{\s*gate\.dispose\(\)\s*\}/)
  })

  test("/gateway/task/decompose route forwards the client abort signal", () => {
    // Without this the LLM stream keeps running after a client
    // disconnect, burning tokens. The route MUST forward c.req.raw.signal.
    expect(GATEWAY_ROUTE_SRC).toMatch(/signal:\s*c\.req\.raw\.signal/)
  })

  test("/gateway/task/decompose returns an actionable but sanitized error (codex round-2 P2)", () => {
    // Pre-fix: every failure collapsed to "check server logs" which
    // killed the PRD-required explicit decomposition error.
    // Post-fix: response carries `Gateway decomposition failed — <class>: <truncated msg>`.
    expect(GATEWAY_ROUTE_SRC).toContain("Gateway decomposition failed — ")
    // Truncation guard so we don't echo long stack traces.
    expect(GATEWAY_ROUTE_SRC).toMatch(/safeDetail\s*=\s*detail\.length\s*>\s*240/)
    // The full error is still recorded server-side for diagnosis.
    expect(GATEWAY_ROUTE_SRC).toContain('decomposeLog.error("decompose failed"')
  })
})

function candidate(id: string, dependencies: string[]) {
  return {
    id,
    title: id,
    description: id,
    priority: "normal" as const,
    recommended_queue: false,
    acceptance: [],
    dependencies,
    risks: [],
  }
}
