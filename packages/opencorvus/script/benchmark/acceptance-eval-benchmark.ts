#!/usr/bin/env bun

/**
 * Acceptance Evaluation Protocol (AEP) — end-to-end benchmark.
 *
 * Drives the spec defined in `docs/spec-acceptance-eval-protocol.md`. Stages
 * are ordered so that as each implementation milestone lands, additional
 * stages transition from MISSING_COMPONENT to ✓.
 *
 * Design rules (aligned with CLAUDE.md):
 *   • No fallback.  A missing implementation fails LOUDLY with a structured
 *     MISSING_COMPONENT error — never silently skipped.
 *   • Activity-based timeout (no-activity 3 min per stage), not start-time.
 *   • Report emits per-stage status + evidence for every criterion so the
 *     root cause is always pinpointed.
 *
 * Stages:
 *   1. schema-validate        — AcceptanceSpec zod-validates 100% of fixtures
 *   2. translate-idempotent   — translator(spec)==translate(translate(spec))
 *   3. translate-correctness  — trigger defaults, severity→mode mapping, sort order
 *   4. heuristic-determinism  — pass fixture → pass, fail fixture → fail
 *   5. llm-judge-calibration  — SKIP_LLM: fixture verdict; otherwise real provider
 *   6. goal-contract-shape    — goal-contract.schema accepts specs, rejects empty
 *
 * CLI flags:
 *   --stage-timeout-ms   (default 180000)  per-stage no-activity budget
 *   --report             (default ./aep-benchmark-report-<ts>.json)
 *   --only <stage>       run only the named stage
 *   --skip-llm           stub llm-judge calibration with a deterministic judge
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// ── CLI parsing ────────────────────────────────────────────────────────────
function flag(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return undefined
}
function boolFlag(name: string): boolean {
  return process.argv.includes(name)
}

const STAGE_TIMEOUT_MS = Number(flag("--stage-timeout-ms") ?? 180_000)
const REPORT_PATH = flag("--report") ?? path.join(process.cwd(), `aep-benchmark-report-${Date.now()}.json`)
const ONLY_STAGE = flag("--only")
const SKIP_LLM = boolFlag("--skip-llm")

if (!Number.isFinite(STAGE_TIMEOUT_MS) || STAGE_TIMEOUT_MS <= 0) {
  throw new Error("invalid --stage-timeout-ms")
}

// ── Missing-component error ───────────────────────────────────────────────
// Thrown when a stage needs a module that has not landed yet. The report
// records the exact specifier so the implementation order is trivially
// readable from a red report.
class MissingComponent extends Error {
  constructor(public readonly specifier: string, public readonly hint: string) {
    super(`MISSING_COMPONENT: ${specifier} — ${hint}`)
    this.name = "MissingComponent"
  }
}

async function tryImport<T = unknown>(specifier: string, hint: string): Promise<T> {
  try {
    return (await import(specifier)) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/cannot find|not found|no such file|resolve/i.test(msg)) {
      throw new MissingComponent(specifier, hint)
    }
    throw err
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────
// Inline to keep the benchmark self-contained. Seed size intentionally small;
// grow in a sibling fixtures/ dir if/when we need more.

type FixtureRequirement = {
  id: string
  description: string
  expectedSpecCount: number     // how many AcceptanceSpecs RequirementsAgent should emit
}

type FixtureSpec = {
  id: string
  source_requirement_id: string
  goal_id: string
  title: string
  scenario?: { given: string[]; when: string[]; then: string[] }
  severity: "essential" | "important" | "optional" | "pitfall"
  trigger?: "on_goal" | "on_delivery"
  scorers: Array<Record<string, unknown>>
}

type FixtureDelivery = {
  label: "pass" | "fail"
  summary: string
  changedFiles: string[]
  // for heuristic runner stubbing: exit code to return per shell cmd
  heuristicExit: Record<string, number>
  // for llm-judge stubbing: deterministic verdict per scorer name
  llmJudgeVerdict: Record<string, "accepted" | "rejected">
}

const REQUIREMENTS: FixtureRequirement[] = [
  { id: "req-login-error", description: "When login fails, the UI shows an error toast visible for 3 seconds.", expectedSpecCount: 1 },
  { id: "req-build-green", description: "Project must build without errors.", expectedSpecCount: 1 },
  { id: "req-no-todos",    description: "Shipped code must not contain TODO markers in production files.", expectedSpecCount: 1 },
]

const SPECS: FixtureSpec[] = [
  {
    id: "acc-login-3s",
    source_requirement_id: "req-login-error",
    goal_id: "goal-login-error",
    title: "Login error toast visible 3s",
    scenario: {
      given: ["user is on the login page"],
      when: ["user submits wrong password"],
      then: ["an error toast appears and remains visible for 3 seconds"],
    },
    severity: "essential",
    scorers: [
      {
        type: "llm_judge",
        name: "toast-visibility",
        criteria: "The delivery summary describes an error toast that remains visible for approximately 3 seconds after a failed login.",
        rubric: [
          { score: 0, label: "missing",  anchor: "no mention of error toast or duration", passes: false },
          { score: 1, label: "partial",  anchor: "mentions toast but not duration or vice versa", passes: false },
          { score: 2, label: "fully met", anchor: "mentions both toast and ~3s visible", passes: true },
        ],
        inputs: ["delivery_summary"],
      },
    ],
  },
  {
    id: "acc-build-green",
    source_requirement_id: "req-build-green",
    goal_id: "goal-build",
    title: "Project builds cleanly",
    severity: "essential",
    scorers: [
      { type: "heuristic", name: "bun-build", spec: { kind: "shell", cmd: "bun run build" }, expect: { exit_code: 0 } },
    ],
  },
  {
    id: "acc-no-todos",
    source_requirement_id: "req-no-todos",
    goal_id: "goal-hygiene",
    title: "No TODO markers in prod code",
    severity: "important",
    scorers: [
      {
        type: "heuristic",
        name: "grep-todos",
        spec: { kind: "shell", cmd: "sh -c '! grep -RIn --include=*.ts --exclude-dir=node_modules \"TODO\" src/'" },
        expect: { exit_code: 0 },
      },
    ],
  },
]

const DELIVERIES: FixtureDelivery[] = [
  {
    label: "pass",
    summary: "Added loginError() which renders an error toast that stays visible for 3 seconds (src/login/toast.ts:42).",
    changedFiles: ["src/login/toast.ts", "src/login/__tests__/toast.spec.ts"],
    heuristicExit: { "bun-build": 0, "grep-todos": 0 },
    llmJudgeVerdict: { "toast-visibility": "accepted" },
  },
  {
    label: "fail",
    summary: "Added login error handling (src/login/toast.ts). Toast duration still TODO.",
    changedFiles: ["src/login/toast.ts"],
    heuristicExit: { "bun-build": 1, "grep-todos": 1 },
    llmJudgeVerdict: { "toast-visibility": "rejected" },
  },
]

// ── Stage runner ───────────────────────────────────────────────────────────

type StageResult = {
  name: string
  status: "passed" | "failed" | "missing"
  durationMs: number
  details: Record<string, unknown>
  error?: string
}

const stages: StageResult[] = []
const overallStart = Date.now()
let exitCode = 1

async function withNoActivityTimeout<T>(
  label: string,
  fn: (tick: () => void) => Promise<T>,
): Promise<T> {
  let last = Date.now()
  const tick = () => { last = Date.now() }
  const stall = setInterval(() => {
    if (Date.now() - last > STAGE_TIMEOUT_MS) {
      console.error(`[aep-benchmark] ${label}: no activity for ${STAGE_TIMEOUT_MS}ms`)
      process.exit(2)
    }
  }, 1_000).unref()
  try {
    return await fn(tick)
  } finally {
    clearInterval(stall)
  }
}

async function runStage(name: string, fn: (tick: () => void) => Promise<Record<string, unknown>>): Promise<void> {
  if (ONLY_STAGE && ONLY_STAGE !== name) return
  const t = Date.now()
  try {
    const details = await withNoActivityTimeout(name, fn)
    stages.push({ name, status: "passed", durationMs: Date.now() - t, details })
    console.log(`[aep-benchmark] ✓ ${name} (${Date.now() - t}ms)`)
  } catch (err) {
    if (err instanceof MissingComponent) {
      stages.push({
        name,
        status: "missing",
        durationMs: Date.now() - t,
        details: { specifier: err.specifier, hint: err.hint },
        error: err.message,
      })
      console.warn(`[aep-benchmark] ⧗ ${name} MISSING: ${err.specifier}`)
      return
    }
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
    stages.push({ name, status: "failed", durationMs: Date.now() - t, details: {}, error: msg })
    console.error(`[aep-benchmark] ✗ ${name}: ${msg}`)
  }
}

// ── Stage 1: schema-validate ──────────────────────────────────────────────
// Every fixture spec must zod-parse under the canonical schema.
await runStage("schema-validate", async (tick) => {
  const mod = await tryImport<{ AcceptanceSpecSchema: any }>(
    "../../src/acceptance/types",
    "export const AcceptanceSpecSchema = z.object({...}) per docs/spec-acceptance-eval-protocol.md §IR",
  )
  const schema = mod.AcceptanceSpecSchema
  if (!schema || typeof schema.safeParse !== "function") {
    throw new Error("src/spec/acceptance-spec.ts must export AcceptanceSpecSchema (zod)")
  }
  let parsed = 0
  for (const spec of SPECS) {
    const r = schema.safeParse(spec)
    if (!r.success) {
      throw new Error(`fixture ${spec.id} failed to parse: ${JSON.stringify(r.error.issues)}`)
    }
    parsed++
    tick()
  }
  return { total: SPECS.length, parsed, passRate: parsed / SPECS.length }
})

// ── Stage 2: translate-idempotent ─────────────────────────────────────────
// translator(spec) is deterministic and idempotent: byte-identical on repeat.
await runStage("translate-idempotent", async (tick) => {
  const mod = await tryImport<{ translateSpecs: (s: unknown[]) => unknown }>(
    "../../src/acceptance/translator",
    "export function translateSpecs(specs): TranslationPlan per §Translation",
  )
  if (typeof mod.translateSpecs !== "function") {
    throw new Error("src/acceptance/translator.ts must export translateSpecs")
  }
  const a = JSON.stringify(mod.translateSpecs(SPECS))
  tick()
  const b = JSON.stringify(mod.translateSpecs(JSON.parse(JSON.stringify(SPECS))))
  if (a !== b) {
    throw new Error("translator output is not byte-identical on identical input (non-deterministic)")
  }
  return { bytes: a.length }
})

// ── Stage 3: heuristic-determinism ────────────────────────────────────────
// A stub runner takes the fixture's heuristicExit map and produces a verdict.
// Real runner wires to verify_cmd via evaluator — this stage locks the
// semantic contract (pass fixture → all pass, fail fixture → all fail).
await runStage("heuristic-determinism", async (tick) => {
  const mod = await tryImport<{
    runHeuristicScorers: (
      scorers: Array<{ name: string }>,
      env: { exec: (cmd: string) => Promise<number> },
    ) => Promise<Array<{ name: string; status: "passed" | "failed" }>>
  }>(
    "../../src/acceptance/heuristic-runner",
    "export async function runHeuristicScorers(scorers, env) per §Translation (heuristic.shell → verify_cmd)",
  )
  const heuristicScorers = SPECS
    .flatMap((s) => s.scorers.map((sc) => ({ spec: s, scorer: sc })))
    .filter(({ scorer }) => (scorer as { type: string }).type === "heuristic")

  const results: Record<string, Array<{ name: string; status: string }>> = {}
  for (const delivery of DELIVERIES) {
    const env = {
      exec: async (_cmd: string) => 0 as number,
    }
    const wantFail = delivery.label === "fail"
    env.exec = async (cmd: string) => {
      tick()
      // Map cmd back to scorer name via the fixture heuristicExit table.
      const match = heuristicScorers.find(({ scorer }) => {
        const s = scorer as { name: string; spec?: { cmd?: string } }
        return s.spec?.cmd === cmd
      })
      if (!match) throw new Error(`unmapped cmd: ${cmd}`)
      return delivery.heuristicExit[(match.scorer as { name: string }).name] ?? 0
    }
    const out = await mod.runHeuristicScorers(
      heuristicScorers.map(({ scorer }) => scorer as { name: string }),
      env,
    )
    results[delivery.label] = out
    const anyFail = out.some((r) => r.status === "failed")
    if (wantFail && !anyFail) throw new Error("fail fixture produced no failed scorers")
    if (!wantFail && anyFail) throw new Error(`pass fixture produced failures: ${JSON.stringify(out)}`)
  }
  return results
})

// ── Stage 4: llm-judge-calibration ────────────────────────────────────────
// With --skip-llm, uses fixture's deterministic verdict map (unit-test mode).
// Without, translates fixture specs → TranslatedRubric and invokes the real
// rubric runner. status=passed→accepted, status=failed→rejected.
await runStage("llm-judge-calibration", async (tick) => {
  const judgeMod = await tryImport<{
    runRubric: (
      entry: { name: string; kind: "llm_judge" | "prebuilt"; scorer: unknown; [k: string]: unknown },
      input: { deliverySummary: string; changedFiles?: string[]; requirementText?: string },
    ) => Promise<{ status: "passed" | "failed" | "skipped"; evidence?: string }>
  }>(
    "../../src/evaluator/llm-judge-runner",
    "export async function runRubric(entry, input) — single-criterion rubric evaluator",
  )
  const translatorMod = await tryImport<{
    translateSpecs: (specs: unknown[]) => { rubric: Array<{ name: string; kind: string; scorer: { name: string } }> }
  }>(
    "../../src/acceptance/translator",
    "export function translateSpecs(specs): TranslationPlan — needed to produce TranslatedRubric entries",
  )

  const plan = translatorMod.translateSpecs(SPECS as unknown[])
  const rubricEntries = plan.rubric.filter((r) => r.kind === "llm_judge")

  const samples: Array<{
    entry: typeof rubricEntries[number]
    delivery: FixtureDelivery
    expected: "accepted" | "rejected"
    fixtureVerdict: "accepted" | "rejected"
  }> = []
  for (const entry of rubricEntries) {
    const scorerName = entry.scorer.name
    for (const d of DELIVERIES) {
      const v = d.llmJudgeVerdict[scorerName]
      if (!v) continue
      samples.push({
        entry,
        delivery: d,
        expected: d.label === "pass" ? "accepted" : "rejected",
        fixtureVerdict: v,
      })
    }
  }
  if (samples.length === 0) {
    throw new Error("no llm_judge samples in fixtures — acceptance criteria cannot be measured")
  }

  let correct = 0
  const results: Array<{ expected: string; got: string }> = []
  for (const s of samples) {
    tick()
    let got: "accepted" | "rejected"
    if (SKIP_LLM) {
      got = s.fixtureVerdict
    } else {
      const r = await judgeMod.runRubric(s.entry as any, {
        deliverySummary: s.delivery.summary,
        changedFiles: s.delivery.changedFiles,
      })
      if (r.status === "skipped") {
        throw new Error(`runRubric returned skipped for ${s.entry.name} — no LLM available? evidence: ${r.evidence}`)
      }
      got = r.status === "passed" ? "accepted" : "rejected"
    }
    results.push({ expected: s.expected, got })
    if (got === s.expected) correct++
  }
  const accuracy = correct / samples.length
  if (accuracy < 0.85) {
    throw new Error(`llm-judge accuracy ${accuracy.toFixed(2)} < 0.85 threshold. Per-sample: ${JSON.stringify(results)}`)
  }
  return { samples: samples.length, correct, accuracy, skippedRealLlm: SKIP_LLM }
})

// ── Stage 5: translate-correctness ────────────────────────────────────────
// Verifies translator semantics: trigger defaults by severity, severity→mode
// mapping, deterministic sort order. Catches regressions in resolveTrigger /
// scorerMode / buildHeuristicCommand without running an LLM.
await runStage("translate-correctness", async () => {
  const translator = await tryImport<{
    translateSpecs: (specs: unknown[]) => {
      heuristic: Array<{ name: string; mode: string; severity: string; trigger: string; command: string }>
      rubric:    Array<{ name: string; mode: string; severity: string; trigger: string; kind: string }>
    }
  }>(
    "../../src/acceptance/translator",
    "translator must export translateSpecs",
  )

  const plan = translator.translateSpecs(SPECS as unknown[])

  // 1. sort order: heuristic + rubric entries sorted by name ascending.
  const hNames = plan.heuristic.map((e) => e.name)
  const rNames = plan.rubric.map((e) => e.name)
  if (hNames.join("|") !== [...hNames].sort().join("|")) {
    throw new Error(`heuristic not sorted: ${hNames.join(",")}`)
  }
  if (rNames.join("|") !== [...rNames].sort().join("|")) {
    throw new Error(`rubric not sorted: ${rNames.join(",")}`)
  }

  // 2. severity→mode: essential/important = strict; optional/pitfall = soft.
  const all = [...plan.heuristic, ...plan.rubric]
  for (const e of all) {
    const expected = e.severity === "essential" || e.severity === "important" ? "strict" : "soft"
    if (e.mode !== expected) {
      throw new Error(`${e.name}: severity=${e.severity} → expected mode=${expected}, got ${e.mode}`)
    }
  }

  // 3. trigger defaults: heuristic/prebuilt = on_goal; llm_judge essential = on_goal; otherwise on_delivery.
  for (const h of plan.heuristic) {
    if (h.trigger !== "on_goal") throw new Error(`heuristic ${h.name}: trigger=${h.trigger}, expected on_goal`)
  }
  for (const r of plan.rubric) {
    const want =
      r.kind === "prebuilt" ? "on_goal" :
      r.severity === "essential" ? "on_goal" : "on_delivery"
    if (r.trigger !== want) {
      throw new Error(`rubric ${r.name}: severity=${r.severity} kind=${r.kind} → expected trigger=${want}, got ${r.trigger}`)
    }
  }

  return { heuristicCount: plan.heuristic.length, rubricCount: plan.rubric.length }
})

// ── Stage 6: goal-contract-shape ──────────────────────────────────────────
// Every goal written to the DB / orchestrator must have ≥1 acceptance_spec.
// This stage locks that contract via GoalContractFieldsSchema so a later
// refactor cannot quietly downgrade acceptance_specs to optional.
await runStage("goal-contract-shape", async () => {
  const mod = await tryImport<{
    GoalContractFieldsSchema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }
  }>(
    "../../src/pipeline/goal-contract.schema",
    "goal contract schema must enforce acceptance_specs >= 1",
  )
  const schema = mod.GoalContractFieldsSchema
  if (!schema || typeof schema.safeParse !== "function") {
    throw new Error("goal-contract.schema.ts must export GoalContractFieldsSchema (zod)")
  }

  // Positive: a valid goal parses.
  const validGoal = {
    id: "goal-login-error",
    title: "Login error toast",
    objective:
      "Implement the login-failure toast that surfaces an error message and remains visible for three seconds before auto-dismissing, matching the acceptance scenarios.",
    acceptance_specs: [SPECS[0]],
    owned_paths: ["src/login/toast.ts"],
    depends_on: [],
    exports: [],
    imports: [],
    priority: "blocking",
    kind: "feature",
    requirement_ids: ["req-login-error"],
  }
  const valid = schema.safeParse(validGoal)
  if (!valid.success) {
    throw new Error(`valid fixture goal failed schema: ${JSON.stringify(valid.error)}`)
  }

  // Negative: goal with empty acceptance_specs[] must be rejected.
  const emptyGoal = { ...validGoal, acceptance_specs: [] }
  const empty = schema.safeParse(emptyGoal)
  if (empty.success) {
    throw new Error("empty acceptance_specs was accepted — contract regression")
  }

  return { positiveAccepted: true, negativeRejected: true }
})

// ── Report ─────────────────────────────────────────────────────────────────
const passed = stages.filter((s) => s.status === "passed").length
const missing = stages.filter((s) => s.status === "missing").length
const failed = stages.filter((s) => s.status === "failed").length

// Policy: MISSING counts as a non-fatal "not yet implemented" in the
// in-progress milestone view. Failed stages are fatal. Once M3 lands, the
// policy flips to "missing is fatal" by passing --strict (TODO: wire when
// implementation reaches M3). For now we exit 0 if only missing, 1 if any
// failed, 1 if all passed but stage count is zero.
exitCode = failed > 0 ? 1 : passed > 0 ? 0 : 1

const report = {
  ok: exitCode === 0,
  startedAt: overallStart,
  finishedAt: Date.now(),
  durationMs: Date.now() - overallStart,
  summary: { passed, missing, failed, total: stages.length },
  stages,
}
await Bun.write(REPORT_PATH, JSON.stringify(report, null, 2))
console.log(`[aep-benchmark] report -> ${REPORT_PATH}`)
console.log(JSON.stringify(report.summary, null, 2))

process.exit(exitCode)
