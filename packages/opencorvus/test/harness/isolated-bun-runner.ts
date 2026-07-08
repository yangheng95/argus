import { expect } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { ProcessSupervisor } from "@/shell/process-supervisor"

type IsolatedBunTestOptions = {
  suiteName: string
  isolatedFile: string
  temporaryPrefix: string
  expectedPassCount: number
  bunTestArgs?: string[]
  env?: Record<string, string>
  forbiddenOutput?: string[]
  inactivityTimeoutMilliseconds?: number
}

type IsolatedBunTestResult = {
  stdout: string
  stderr: string
  exitCode: number
  junit: string
}

const DEFAULT_INACTIVITY_TIMEOUT_MILLISECONDS = 120_000
const SIGTERM_ESCALATION_MILLISECONDS = 1_000
const SIGKILL_SETTLE_MILLISECONDS = 5_000
const STREAM_DRAIN_MILLISECONDS = 2_000
const RUNNER_OWNED_BUN_TEST_ARGS = new Set(["--timeout", "--reporter", "--reporter-outfile"])

type StreamCollector = {
  done: Promise<void>
  text: () => string
  cancel: () => Promise<void>
}

function inheritedStringEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1]))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function validateBunTestArgs(args: string[] | undefined): string[] {
  const values = args ?? []
  for (const arg of values) {
    const option = arg.split("=")[0] ?? arg
    if (RUNNER_OWNED_BUN_TEST_ARGS.has(option)) {
      throw new Error(`runIsolatedBunTest owns Bun test argument ${option}`)
    }
  }
  return values
}

function collectStream(stream: ReadableStream<Uint8Array>, recordActivity: () => void): StreamCollector {
  const decoder = new TextDecoder()
  const chunks: string[] = []
  const reader = stream.getReader()
  let cancelled = false
  let completed = false
  const done = (async () => {
    try {
      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        recordActivity()
        chunks.push(decoder.decode(value, { stream: true }))
      }
      const rest = decoder.decode()
      if (rest) chunks.push(rest)
    } catch (error) {
      if (!cancelled) throw error
    } finally {
      completed = true
      reader.releaseLock()
    }
  })()
  return {
    done,
    text: () => chunks.join(""),
    cancel: async () => {
      if (completed) return
      cancelled = true
      await reader.cancel().catch(() => undefined)
      await done.catch(() => undefined)
    },
  }
}

async function settleStreamCollectors(collectors: StreamCollector[], milliseconds: number): Promise<boolean> {
  const settled = await Promise.race([
    Promise.allSettled(collectors.map((collector) => collector.done)),
    delay(milliseconds).then(() => undefined),
  ])
  if (!settled) {
    await Promise.all(collectors.map((collector) => collector.cancel()))
    return false
  }
  const rejected = settled.find((result) => result.status === "rejected")
  if (rejected?.status === "rejected") throw rejected.reason
  return true
}

function killPosixProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

async function terminateIsolatedProcess(
  proc: ReturnType<typeof Bun.spawn>,
  exited: Promise<number>,
  opts: { requireProcessTreeSettle?: boolean } = {},
): Promise<void> {
  const pid = proc.pid
  if (!pid) throw new Error("isolated Bun process has no process id")
  if (process.platform === "win32") {
    await ProcessSupervisor.terminateProcessTree(pid, `isolated Bun process tree ${pid}`)
  } else {
    killPosixProcessGroup(pid, "SIGTERM")
  }
  if (opts.requireProcessTreeSettle) {
    await delay(SIGTERM_ESCALATION_MILLISECONDS)
  } else {
  const exitedAfterTerm = await Promise.race([
    exited.then(
      () => true,
      () => true,
    ),
    delay(SIGTERM_ESCALATION_MILLISECONDS).then(() => false),
  ])
  if (exitedAfterTerm) return
  }
  if (process.platform !== "win32") killPosixProcessGroup(pid, "SIGKILL")
  const exitedAfterKill = await Promise.race([
    exited.then(
      () => true,
      () => true,
    ),
    delay(SIGKILL_SETTLE_MILLISECONDS).then(() => false),
  ])
  if (!exitedAfterKill && !opts.requireProcessTreeSettle) {
    throw new Error("isolated Bun process did not exit after SIGKILL")
  }
}

function parseJunitSummary(xml: string): { passCount: number; failCount: number } {
  const tag = /<testsuites\b[^>]*>/.exec(xml)?.[0] ?? /<testsuite\b[^>]*>/.exec(xml)?.[0]
  if (!tag) throw new Error(`Bun JUnit summary is missing a testsuites tag:\n${xml}`)
  const attributes = new Map<string, number>()
  for (const match of tag.matchAll(/\s([A-Za-z_:-]+)="([^"]*)"/g)) {
    const value = Number(match[2])
    if (Number.isFinite(value)) attributes.set(match[1]!, value)
  }
  const tests = attributes.get("tests")
  const failures = attributes.get("failures") ?? 0
  const errors = attributes.get("errors") ?? 0
  const skipped = attributes.get("skipped") ?? 0
  if (tests === undefined) throw new Error(`Bun JUnit summary is missing tests count:\n${xml}`)
  const failCount = failures + errors
  const passCount = tests - failCount - skipped
  if (passCount < 0) throw new Error(`Bun JUnit summary has invalid pass count:\n${xml}`)
  return { passCount, failCount }
}

async function runIsolatedBunProcess(input: IsolatedBunTestOptions): Promise<IsolatedBunTestResult> {
  const bunTestArgs = validateBunTestArgs(input.bunTestArgs)
  const inactivityTimeoutMilliseconds = input.inactivityTimeoutMilliseconds ?? DEFAULT_INACTIVITY_TIMEOUT_MILLISECONDS
  const bun = Bun.which("bun") ?? process.execPath
  const home = await mkdtemp(join(tmpdir(), input.temporaryPrefix))
  const junitPath = join(home, "bun-junit.xml")
  let proc: ReturnType<typeof Bun.spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let exited = false
  let exitTask: Promise<number> | undefined
  let terminationTask: Promise<void> | undefined
  let failTermination: ((error: unknown) => void) | undefined
  const terminationFailure = new Promise<never>((_, reject) => {
    failTermination = reject
  })
  let stdoutCollector: StreamCollector | undefined
  let stderrCollector: StreamCollector | undefined

  try {
    const env = {
      ...inheritedStringEnvironment(),
      OPENCORVUS_HOME: join(home, "portable"),
      OPENCORVUS_TEST_HOME: join(home, "home"),
      OPENCORVUS_TEST_MANAGED_CONFIG_DIR: join(home, "managed"),
      XDG_DATA_HOME: join(home, "share"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_STATE_HOME: join(home, "state"),
      ...input.env,
    }
    proc = Bun.spawn(
      [
        bun,
        "test",
        "--timeout=0",
        "--reporter=junit",
        `--reporter-outfile=${junitPath}`,
        input.isolatedFile,
        ...bunTestArgs,
      ],
      {
        cwd: resolve(import.meta.dir, "../../.."),
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: process.platform !== "win32",
      },
    )
    exitTask = proc.exited.then((code) => {
      exited = true
      return code
    })

    const recordActivity = () => {
      if (timedOut) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        if (proc && exitTask) {
          terminationTask = terminateIsolatedProcess(proc, exitTask).catch((error) => {
            failTermination?.(error)
          })
        }
      }, inactivityTimeoutMilliseconds)
    }
    recordActivity()

    stdoutCollector = collectStream(proc.stdout, recordActivity)
    stderrCollector = collectStream(proc.stderr, recordActivity)
    const exitCode = await Promise.race([exitTask, terminationFailure])
    const streamCollectors = [stdoutCollector, stderrCollector]
    const streamsSettled = await settleStreamCollectors(streamCollectors, STREAM_DRAIN_MILLISECONDS)
    if (!streamsSettled && proc && exitTask) {
      await terminateIsolatedProcess(proc, exitTask, { requireProcessTreeSettle: true })
    }
    const stdout = stdoutCollector.text()
    const stderr = stderrCollector.text()
    if (timedOut) {
      throw new Error(
        [
          `${input.suiteName} isolated Bun process had no output activity for ${inactivityTimeoutMilliseconds} milliseconds`,
          stdout,
          stderr,
        ].join("\n"),
      )
    }
    const junit = exitCode === 0 ? await readFile(junitPath, "utf8") : ""
    return { stdout, stderr, exitCode, junit }
  } finally {
    if (timer) clearTimeout(timer)
    if (stdoutCollector) await stdoutCollector.cancel()
    if (stderrCollector) await stderrCollector.cancel()
    if (terminationTask) {
      await terminationTask.catch(() => undefined)
    } else if (proc && timedOut && exitTask && !exited) {
      await terminateIsolatedProcess(proc, exitTask).catch(() => undefined)
    }
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function runIsolatedBunTest(input: IsolatedBunTestOptions): Promise<void> {
  const result = await runIsolatedBunProcess(input)
  const output = `${result.stdout}\n${result.stderr}`
  if (result.exitCode !== 0) {
    throw new Error(
      [`${input.suiteName} failed with exit code ${result.exitCode}`, result.stdout, result.stderr].join("\n"),
    )
  }
  const { passCount, failCount } = parseJunitSummary(result.junit)
  expect(passCount).toBe(input.expectedPassCount)
  expect(failCount).toBe(0)
  for (const forbidden of input.forbiddenOutput ?? []) {
    expect(output).not.toContain(forbidden)
  }
}
