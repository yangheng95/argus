#!/usr/bin/env bun
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { terminateOwnedProcessTree } from "./process-tree"

type CheckResult = {
  name: string
  ok: boolean
  code?: number | null
  durationMs: number
  timedOut?: boolean
  message?: string
  tail?: string
}

type RoundRecord = {
  type: "round-summary"
  round: number
  ok: boolean
  durationMs: number
  checks: CheckResult[]
}

const here = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(here, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")
const bunBin = process.execPath

const rounds = envInt("VSCODE_BENCH_ROUNDS", 100)
const idleMs = envInt("VSCODE_BENCH_IDLE_MS", 120_000)
const fullSnapshotEvery = envInt("VSCODE_BENCH_FULL_SNAPSHOT_EVERY", 25)
const buildEvery = envInt("VSCODE_BENCH_BUILD_EVERY", 25)
const e2eEvery = envInt("VSCODE_BENCH_E2E_EVERY", 25)
const visualE2eEvery = envInt("VSCODE_BENCH_VISUAL_E2E_EVERY", 0)
const reportPath = path.resolve(
  repoRoot,
  process.env.VSCODE_BENCH_REPORT ?? "tmp/vscode-extension-100-round-report.jsonl",
)

const sourceGuards: Array<{
  name: string
  roots: string[]
  pattern: RegExp
  allow?: (file: string, line: string) => boolean
}> = [
  {
    name: "no EventSource in vscode extension",
    roots: ["packages/vscode-extension/src"],
    pattern: /\bnew\s+EventSource\b/,
  },
  {
    name: "no extension-host SSE parser marker outside TransportBridge",
    roots: ["packages/vscode-extension/src"],
    pattern: /text\/event-stream|startsWith\(["']data:/,
    allow: (file) => file.endsWith(path.normalize("packages/vscode-extension/src/transport/bridge.ts")),
  },
  {
    name: "no server password outside managed sidecar manager",
    roots: ["packages/vscode-extension/src"],
    pattern: /OPENCORVUS_SERVER_PASSWORD/,
    allow: (file) => file.endsWith(path.normalize("packages/vscode-extension/src/sidecar/manager.ts")),
  },
  {
    name: "no hidden route string for synchronous prompt",
    roots: ["packages/vscode-extension/src", "packages/overlay/src/services"],
    pattern: /\/session\/.*message|prompt_async/,
  },
  {
    name: "no source-level fallback marker in vscode extension",
    roots: ["packages/vscode-extension/src"],
    pattern: /\b(fallback|Fallback|FALLBACK)\b|兜底|降级/,
  },
]

async function main() {
  validateConfig()
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, "")
  console.log(
    `[bench] rounds=${rounds} idleMs=${idleMs} fullSnapshotEvery=${fullSnapshotEvery} buildEvery=${buildEvery} e2eEvery=${e2eEvery} visualE2eEvery=${visualE2eEvery}`,
  )
  console.log(`[bench] report=${path.relative(repoRoot, reportPath)}`)

  let failedChecks = 0
  const started = Date.now()
  for (let round = 1; round <= rounds; round++) {
    const roundStart = Date.now()
    console.log(`[round ${round}/${rounds}] start`)
    const checks: CheckResult[] = []

    checks.push(
      await commandCheck("vscode.typecheck", repoRoot, [
        bunBin,
        "run",
        "--cwd",
        "packages/vscode-extension",
        "typecheck",
      ]),
    )
    checks.push(
      await commandCheck("vscode.unit", repoRoot, [bunBin, "run", "--cwd", "packages/vscode-extension", "test"]),
    )
    checks.push(
      await commandCheck("transport-protocol.unit", path.join(repoRoot, "packages", "transport-protocol"), [
        bunBin,
        "test",
      ]),
    )
    checks.push(await sourceGuardCheck())
    checks.push(
      await commandCheck(
        "snapshot.smoke.no-destructive-api",
        repoRoot,
        [bunBin, "packages/opencorvus/script/benchmark/snapshot-benchmark.ts"],
        {
          SNAPSHOT_BENCH_ONLY: "gc.no-destructive-api",
          SNAPSHOT_BENCH_IDLE_TIMEOUT_MS: String(idleMs),
        },
      ),
    )

    if (buildEvery > 0 && round % buildEvery === 0) {
      checks.push(
        await commandCheck("vscode.build.production.skip-ui", extensionRoot, [
          "node",
          "esbuild.mjs",
          "--production",
          "--skip-ui",
        ]),
      )
      checks.push(await commandCheck("vscode.bundle.audit", extensionRoot, [bunBin, "run", "script/audit-bundle.ts"]))
    }

    if (e2eEvery > 0 && round % e2eEvery === 0) {
      checks.push(
        await commandCheck("vscode.e2e.ui", repoRoot, [
          bunBin,
          "run",
          "--cwd",
          "packages/vscode-extension",
          "test:e2e:vscode",
        ]),
      )
    }

    if (visualE2eEvery > 0 && round % visualE2eEvery === 0) {
      checks.push(
        await commandCheck("vscode.e2e.visual", repoRoot, [
          bunBin,
          "run",
          "--cwd",
          "packages/vscode-extension",
          "test:e2e:visual",
        ]),
      )
    }

    if (fullSnapshotEvery > 0 && round % fullSnapshotEvery === 0) {
      checks.push(
        await commandCheck("snapshot.full.unit", path.join(repoRoot, "packages", "opencorvus"), [
          bunBin,
          "test",
          "--timeout",
          "60000",
          "test/snapshot/snapshot.test.ts",
        ]),
      )
    }

    const ok = checks.every((c) => c.ok)
    failedChecks += checks.filter((c) => !c.ok).length
    const record: RoundRecord = {
      type: "round-summary",
      round,
      ok,
      durationMs: Date.now() - roundStart,
      checks,
    }
    appendRecord(record)
    console.log(`[round ${round}/${rounds}] ${ok ? "ok" : "fail"} durationMs=${record.durationMs}`)
  }

  const elapsed = Date.now() - started
  console.log(`[bench] complete rounds=${rounds} failedChecks=${failedChecks} elapsedMs=${elapsed}`)
  process.exit(failedChecks === 0 ? 0 : 1)
}

function validateConfig() {
  for (const [name, value] of [
    ["VSCODE_BENCH_ROUNDS", rounds],
    ["VSCODE_BENCH_IDLE_MS", idleMs],
    ["VSCODE_BENCH_FULL_SNAPSHOT_EVERY", fullSnapshotEvery],
    ["VSCODE_BENCH_BUILD_EVERY", buildEvery],
    ["VSCODE_BENCH_E2E_EVERY", e2eEvery],
    ["VSCODE_BENCH_VISUAL_E2E_EVERY", visualE2eEvery],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  }
  if (rounds === 0) throw new Error("VSCODE_BENCH_ROUNDS must be greater than 0")
  if (idleMs < 1_000) throw new Error("VSCODE_BENCH_IDLE_MS must be at least 1000")
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got ${raw}`)
  return value
}

async function commandCheck(
  name: string,
  cwd: string,
  cmd: string[],
  env: Record<string, string> = {},
): Promise<CheckResult> {
  if (cmd.length === 0) throw new Error(`${name} command must not be empty`)
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  let timedOut = false
  let tail = ""
  let termination: Promise<void> | undefined
  let terminationError: unknown
  let rejectTerminationFailure: (error: unknown) => void = () => {}
  const terminationFailure = new Promise<never>((_resolve, reject) => {
    rejectTerminationFailure = reject
  })
  const requestTermination = (proc: ChildProcessWithoutNullStreams) => {
    if (termination) return
    termination = terminateOwnedProcessTree(proc, `VS Code 100-round benchmark ${name}`).catch((error) => {
      terminationError = error
      rejectTerminationFailure(error)
    })
  }
  const touch = (proc: ChildProcessWithoutNullStreams) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      requestTermination(proc)
    }, idleMs)
    if (typeof timer.unref === "function") timer.unref()
  }

  const executable = cmd[0]!
  const proc = spawn(executable, cmd.slice(1), {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  })
  touch(proc)

  const collect = async (stream: NodeJS.ReadableStream, label: "stdout" | "stderr") => {
    const decoder = new TextDecoder()
    for await (const value of stream) {
      touch(proc)
      const text = decoder.decode(value as Buffer, { stream: true })
      tail = trimTail(tail + text)
      const lines = text.split(/\r?\n/).filter(Boolean)
      for (const line of lines.slice(-3)) console.log(`[${name}.${label}] ${line}`)
    }
  }

  const collectors = Promise.all([collect(proc.stdout, "stdout"), collect(proc.stderr, "stderr")])
  const completion = new Promise<{ code: number | null }>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (code) => resolve({ code }))
  })
  const completed = await Promise.race([completion, terminationFailure])
  if (timer) clearTimeout(timer)
  if (!termination) termination = terminateOwnedProcessTree(proc, `VS Code 100-round benchmark ${name}`)
  if (termination) await termination
  if (terminationError) throw terminationError
  await collectors
  const code = completed.code
  const ok = !timedOut && code === 0
  const result: CheckResult = {
    name,
    ok,
    code,
    durationMs: Date.now() - started,
    timedOut,
    tail: ok ? undefined : tail,
    message: ok ? undefined : timedOut ? `no output for ${idleMs}ms` : `exit code ${code}`,
  }
  console.log(`[check] ${name} ${ok ? "ok" : "fail"} durationMs=${result.durationMs}`)
  return result
}

async function sourceGuardCheck(): Promise<CheckResult> {
  const started = Date.now()
  const findings: string[] = []
  for (const guard of sourceGuards) {
    for (const root of guard.roots) {
      const absRoot = path.join(repoRoot, root)
      for (const file of walk(absRoot)) {
        const text = fs.readFileSync(file, "utf8")
        const rel = path.relative(repoRoot, file)
        const lines = text.split(/\r?\n/)
        lines.forEach((line, idx) => {
          guard.pattern.lastIndex = 0
          if (!guard.pattern.test(line)) return
          if (guard.allow?.(path.normalize(rel), line)) return
          findings.push(`${guard.name}: ${rel}:${idx + 1}: ${line.trim()}`)
        })
      }
    }
  }
  const ok = findings.length === 0
  const result: CheckResult = {
    name: "source.guards",
    ok,
    durationMs: Date.now() - started,
    message: ok ? undefined : `${findings.length} source guard finding(s)`,
    tail: ok ? undefined : findings.slice(0, 30).join("\n"),
  }
  console.log(`[check] source.guards ${ok ? "ok" : "fail"} findings=${findings.length}`)
  return result
}

function* walk(root: string): Generator<string> {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-vsix") continue
      yield* walk(full)
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      yield full
    }
  }
}

function trimTail(text: string): string {
  const limit = 12_000
  return text.length <= limit ? text : text.slice(text.length - limit)
}

function appendRecord(record: RoundRecord) {
  fs.appendFileSync(reportPath, `${JSON.stringify(record)}\n`)
}

await main()
