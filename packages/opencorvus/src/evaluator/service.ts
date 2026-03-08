import { Instance } from "@/project/instance"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { Shell } from "@/shell/shell"
import { Shell as ShellUtil } from "@/shell/shell"
import { Snapshot } from "@/snapshot"
import { Filesystem } from "@/util/filesystem"
import { spawn } from "child_process"
import { generateObject } from "ai"
import path from "path"
import puppeteer from "puppeteer-core"
import z from "zod"
import { CheckConfig, EvaluationCheck } from "@/orchestrator/model"
import { EvaluatorAgent, type EvaluatorAnalysisType, type GoalInfo, type CheckResult, type DeliveryInfo } from "./agent"
import { Log } from "@/util/log"

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT = 12000

export const EvaluationResult = z.object({
  status: z.enum(["passed", "failed", "inconclusive"]),
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  summary: z.string(),
  checks: EvaluationCheck.array(),
  artifacts: z.array(
    z.object({
      kind: z.enum(["log", "report", "image"]),
      label: z.string(),
      payload: z.record(z.string(), z.any()),
    }),
  ),
})

const JudgeResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  strengths: z.array(z.string()).optional(),
  concerns: z.array(z.string()).optional(),
})

const ReviewResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
})

type EvaluatorCommand = {
  command: string
  cwd?: string
}

export namespace EvaluatorService {
  export async function evaluate(
    task: { request?: string; metadata?: Record<string, unknown> },
    delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
  ) {
    const config = await resolveConfig(task.metadata)
    const discovered = await discoverScripts(task.metadata?.delivery_changed_files)
    const commands = [
      { name: "build", commands: commandSpecs(config.build, discovered.build) },
      { name: "test", commands: commandSpecs(config.test, discovered.test) },
      { name: "lint", commands: commandSpecs(config.lint, discovered.lint) },
      { name: "verify_cmd", commands: commandSpecs(config.verify_cmd) },
    ].filter((item) => item.commands.length > 0)

    const results: z.infer<typeof EvaluationCheck>[] = []
    const artifacts: Array<{ kind: "log" | "report" | "image"; label: string; payload: Record<string, unknown> }> = []

    for (const group of commands) {
      for (const [index, command] of group.commands.entries()) {
        const label = group.commands.length === 1 ? group.name : `${group.name}#${index + 1}`
        const result = await commandResult(command, config.timeout_ms ?? DEFAULT_TIMEOUT_MS)
        artifacts.push({
          kind: "log",
          label: `evaluation:${label}`,
          payload: {
            command: result.command,
            cwd: result.cwd,
            code: result.code,
            output: clip(result.output),
          },
        })
        if (result.code === 0) {
          results.push({
            name: label,
            status: "passed",
            evidence: clip(result.output) || `${command} passed`,
          })
          continue
        }
        results.push({
          name: label,
          status: "failed",
          evidence: clip(result.output) || `${command} failed`,
        })
        return {
          status: "failed" as const,
          verdict: "rejected" as const,
          summary: `Evaluation failed at ${label}.`,
          checks: results,
          artifacts,
        }
      }
    }

    if (commands.length === 0) {
      results.push({
        name: "evaluation_config",
        status: "skipped",
        evidence: delivery.summary,
      })
    }

    const optional = [
      await startupResult(config.startup),
      await artifactResult(config.artifact, delivery),
      await visualResult(config.visual),
      await puppeteerResult(config.puppeteer),
      await uiReviewResult(config.ui_review, task.request, delivery),
      await codeQualityResult(config.code_quality, task.request, delivery),
      await codeReviewResult(config.code_review, task.request, delivery),
      await deadCodeReviewResult(config.dead_code_review, task.request, delivery),
      await judgeResult(config.judge, task.request, delivery),
    ]

    const pluginChecksOutput = { checks: [] as Array<{ name: string; mode: "soft" | "strict"; run: (ctx: { request?: string; delivery: { summary: string; diffs?: any[] } }) => Promise<{ status: "passed" | "failed" | "skipped"; evidence: string; artifacts?: Array<{ kind: string; label: string; payload: Record<string, any> }> }> }> }
    await Plugin.trigger("evaluation.checks", {
      taskID: (task.metadata as Record<string, unknown>)?.taskID as string | undefined,
      runID: (task.metadata as Record<string, unknown>)?.runID as string | undefined,
      request: task.request,
      config: (config as Record<string, unknown>).custom as Record<string, unknown> ?? {},
    }, pluginChecksOutput).catch(() => undefined)

    for (const pluginCheck of pluginChecksOutput.checks) {
      const checkResult = await pluginCheck.run({ request: task.request, delivery }).catch(() => ({
        status: "skipped" as const,
        evidence: `Plugin check ${pluginCheck.name} threw an error.`,
      }))
      const outcome = softOrStrict({
        mode: pluginCheck.mode,
        name: pluginCheck.name,
        summary: checkResult.status === "passed" ? `${pluginCheck.name} passed.` : `${pluginCheck.name} ${checkResult.status}.`,
        evidence: checkResult.evidence,
        payload: {},
      })
      optional.push(outcome)
      if ("artifacts" in checkResult && checkResult.artifacts) {
        for (const art of checkResult.artifacts) {
          artifacts.push({ kind: art.kind as "log" | "report" | "image", label: art.label, payload: art.payload })
        }
      }
    }

    const failed = optional.find((item) => item.outcome === "failed")
    for (const item of optional) {
      results.push(...item.checks)
      artifacts.push(...item.artifacts)
    }

    if (failed) {
      const output = {
        status: "failed" as const,
        verdict: "rejected" as const,
        summary: failed.summary,
        checks: results,
        artifacts,
      }
      await Plugin.trigger("evaluation.result", {
        taskID: (task.metadata as Record<string, unknown>)?.taskID as string | undefined,
        runID: (task.metadata as Record<string, unknown>)?.runID as string | undefined,
        request: task.request,
      }, output).catch(() => undefined)
      return output
    }

    const skipped = optional.filter((item) => item.outcome === "skipped")
    const optionalChecks = results.filter((item) => item.name !== "evaluation_config")
    if (commands.length === 0 && optionalChecks.length === 0 && results.every((item) => item.status === "skipped")) {
      const output = {
        status: "inconclusive" as const,
        verdict: "inconclusive" as const,
        summary: "No blocking evaluator checks ran.",
        checks: results,
        artifacts,
      }
      await Plugin.trigger("evaluation.result", {
        taskID: (task.metadata as Record<string, unknown>)?.taskID as string | undefined,
        runID: (task.metadata as Record<string, unknown>)?.runID as string | undefined,
        request: task.request,
      }, output).catch(() => undefined)
      return output
    }

    const output = {
      status: "passed" as const,
      verdict: "accepted" as const,
      summary:
        skipped.length > 0
          ? commands.length === 0
            ? "Optional evaluator checks ran in soft mode without blocking the flow."
            : "Core evaluator checks passed; optional checks were skipped."
          : "All evaluator checks passed.",
      checks: results,
      artifacts,
    }
    await Plugin.trigger("evaluation.result", {
      taskID: (task.metadata as Record<string, unknown>)?.taskID as string | undefined,
      runID: (task.metadata as Record<string, unknown>)?.runID as string | undefined,
      request: task.request,
    }, output).catch(() => undefined)
    return output
  }

  /**
   * analyzeDelivery — calls the independent-context EvaluatorAgent to deeply
   * analyze check results, investigate failures, assess each goal individually,
   * and produce structured failure classification + replan guidance.
   *
   * This is separate from evaluate() so automated checks remain fast and
   * the agent analysis is an optional enrichment step.
   */
  export async function analyzeDelivery(input: {
    task: { title: string; request: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
  }): Promise<EvaluatorAnalysisType> {
    return EvaluatorAgent.analyze(input)
  }
}

const evaluatorLog = Log.create({ service: "evaluator" })

async function resolveConfig(metadata?: Record<string, unknown>) {
  const configured = CheckConfig.safeParse(metadata?.checks)
  return CheckConfig.parse(configured.success ? configured.data : {})
}

function commandSpecs(configured?: string[], discovered: EvaluatorCommand[] = []) {
  if (configured && configured.length > 0) {
    return configured.map((command) => ({ command }))
  }
  return discovered
}

async function discoverScripts(changedFiles?: unknown) {
  const cwd = await discoverPackageRoot(changedFiles)
  const file = Bun.file(path.join(cwd, "package.json"))
  const json = await file.json().catch(() => undefined) as { scripts?: Record<string, string> } | undefined
  const scripts = json?.scripts ?? {}
  const run = (name: string): EvaluatorCommand[] => [{ command: `bun run ${name}`, cwd }]
  const files = Array.isArray(changedFiles)
    ? changedFiles
        .filter((item): item is string => typeof item === "string" && /\.(spec|test)\.[cm]?[jt]sx?$/.test(item))
        .map((item) => path.resolve(Instance.directory, item))
        .filter((item) => Filesystem.contains(cwd, item))
        .map((item) => path.relative(cwd, item).replaceAll("\\", "/"))
    : []
  const tests = await classifyTests(files, cwd)
  return {
    build: scripts.build ? run("build") : [],
    test: tests.playwright.length > 0
      ? [{ command: `bunx playwright test ${tests.playwright.map(quote).join(" ")}`, cwd }]
      : tests.bun.length > 0
        ? [{ command: `bun test ${tests.bun.map(quote).join(" ")}`, cwd }]
        : scripts.test ? run("test") : [],
    lint: scripts.lint ? run("lint") : [],
  }
}

async function startupResult(config: z.infer<typeof CheckConfig>["startup"]) {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const timeout = config.timeout_ms ?? 20_000
  const warmup = config.warmup_ms ?? 1_500
  const shell = Shell.acceptable()
  const proc = spawn(config.command, {
    shell,
    cwd: Instance.directory,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })

  let output = ""
  let code: number | undefined
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.once("exit", (value, signal) => {
    code = signal ? 1 : value ?? 1
  })

  const started = Date.now()
  const readiness = await waitForStartup({
    proc,
    readyURL: config.ready_url,
    readyText: config.ready_text,
    timeout,
    warmup,
    output: () => output,
    requireExitZero: config.require_exit_zero ?? false,
  })

  if (proc.exitCode === null && proc.signalCode === null) {
    await ShellUtil.killTree(proc, { exited: () => proc.exitCode !== null || proc.signalCode !== null })
  }

  if (readiness.ok) {
    return {
      outcome: "passed" as const,
      summary: "Startup acceptance passed.",
      checks: [
        {
          name: "startup",
          status: "passed" as const,
          evidence: readiness.evidence,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:startup",
          payload: {
            command: config.command,
            ready_url: config.ready_url,
            ready_text: config.ready_text,
            code,
            started_ms: Date.now() - started,
            output: clip(output),
          },
        },
      ],
    }
  }

  return softOrStrict({
    mode,
    name: "startup",
    summary: "Startup acceptance failed.",
    evidence: readiness.evidence,
    payload: {
      command: config.command,
      ready_url: config.ready_url,
      ready_text: config.ready_text,
      code,
      started_ms: Date.now() - started,
      output: clip(output),
    },
  })
}

async function waitForStartup(input: {
  proc: ReturnType<typeof spawn>
  readyURL?: string
  readyText?: string
  timeout: number
  warmup: number
  output: () => string
  requireExitZero: boolean
}) {
  const started = Date.now()
  while (Date.now() - started < input.timeout) {
    if (typeof input.proc.exitCode === "number" || input.proc.signalCode !== null) {
      const code = input.proc.exitCode ?? 1
      if (!input.readyURL && !input.readyText && code === 0) {
        return { ok: true, evidence: "Process exited successfully." }
      }
      if (input.requireExitZero && code === 0 && input.readyText && input.output().includes(input.readyText)) {
        return { ok: true, evidence: `Process output matched "${input.readyText}".` }
      }
      return { ok: false, evidence: `Process exited before becoming ready (code ${code}).` }
    }

    if (input.readyURL) {
      const page = await webPage(input.readyURL, 1_500)
      if (page) {
        if (!input.readyText || page.content.includes(input.readyText)) {
          return {
            ok: true,
            evidence: input.readyText
              ? `${input.readyURL} responded and matched "${input.readyText}".`
              : `${input.readyURL} responded successfully.`,
          }
        }
      }
    } else if (input.readyText && input.output().includes(input.readyText)) {
      return { ok: true, evidence: `Process output matched "${input.readyText}".` }
    } else if (!input.readyText && Date.now() - started >= input.warmup) {
      return { ok: true, evidence: `Process stayed alive for ${input.warmup} ms.` }
    }

    await Bun.sleep(300)
  }

  return { ok: false, evidence: `Timed out after ${input.timeout} ms.` }
}

async function classifyTests(files: string[], cwd: string) {
  const items = await Promise.all(
    files.map(async (file) => ({
      file,
      text: await Bun.file(path.join(cwd, file)).text().catch(() => ""),
    })),
  )
  return {
    playwright: items
      .filter((item) => !/["']bun:test["']/.test(item.text))
      .filter((item) =>
        /from ["']@playwright\/test["']|from ["']playwright\/test["']|require\(["']@playwright\/test["']\)|require\(["']playwright\/test["']\)/.test(item.text),
      )
      .map((item) => item.file),
    bun: items
      .filter((item) => /["']bun:test["']/.test(item.text))
      .map((item) => item.file),
  }
}

async function commandResult(input: string | EvaluatorCommand, timeout: number) {
  const command = typeof input === "string" ? input : input.command
  const cwd = typeof input === "string" ? Instance.directory : input.cwd ?? Instance.directory
  const shell = Shell.acceptable()
  const proc = spawn(command, {
    shell,
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })

  let output = ""
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
  })

  const timer = setTimeout(() => {
    void ShellUtil.killTree(proc, { exited: () => proc.exitCode !== null || proc.signalCode !== null })
  }, timeout)
  timer.unref()

  const code = await new Promise<number>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("exit", (value, signal) => {
      if (signal) {
        resolve(1)
        return
      }
      resolve(value ?? 1)
    })
  }).finally(() => {
    clearTimeout(timer)
  })

  return {
    code,
    output,
    command,
    cwd,
  }
}

async function discoverPackageRoot(changedFiles?: unknown) {
  const root = Instance.directory
  const candidates = new Map<string, number>()
  const items = Array.isArray(changedFiles)
    ? changedFiles.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []

  for (const file of items) {
    let current = path.dirname(path.resolve(root, file))
    while (Filesystem.contains(root, current)) {
      if (await Filesystem.exists(path.join(current, "package.json"))) {
        candidates.set(current, (candidates.get(current) ?? 0) + 1)
        break
      }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  if (candidates.size === 0) return root
  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0]
}

function clip(input: string) {
  const value = input.trim()
  if (value.length <= MAX_OUTPUT) return value
  return value.slice(0, MAX_OUTPUT) + "\n...[truncated]"
}

function quote(input: string) {
  return `"${input.replaceAll('"', '\\"')}"`
}

async function artifactResult(
  config: z.infer<typeof CheckConfig>["artifact"],
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config) return emptyOptional()
  const changedFiles = delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []
  const diffs = delivery.diffs ?? []
  const mode = config.mode ?? "soft"
  const unmet = [
    config.require_summary && !delivery.summary.trim() ? "missing summary" : undefined,
    config.require_changed_files && changedFiles.length === 0 ? "no changed files" : undefined,
    config.require_diff && diffs.length === 0 ? "no diff output" : undefined,
    typeof config.min_changed_files === "number" && changedFiles.length < config.min_changed_files
      ? `changed files ${changedFiles.length}/${config.min_changed_files}`
      : undefined,
  ].filter((item): item is string => Boolean(item))

  if (unmet.length === 0) {
    return {
      outcome: "passed" as const,
      summary: "Artifact checks passed.",
      checks: [
        {
          name: "artifact",
          status: "passed" as const,
          evidence: `changed_files=${changedFiles.length}, diffs=${diffs.length}`,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:artifact",
          payload: {
            changed_files: changedFiles,
            diff_count: diffs.length,
          },
        },
      ],
    }
  }

  if (mode === "strict") {
    return {
      outcome: "failed" as const,
      summary: `Artifact checks failed: ${unmet.join(", ")}.`,
      checks: [
        {
          name: "artifact",
          status: "failed" as const,
          evidence: unmet.join(", "),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:artifact",
          payload: {
            unmet,
            changed_files: changedFiles,
            diff_count: diffs.length,
          },
        },
      ],
    }
  }

  return {
    outcome: "skipped" as const,
    summary: "Artifact checks skipped in soft mode.",
    checks: [
      {
        name: "artifact",
        status: "skipped" as const,
        evidence: unmet.join(", "),
      },
    ],
    artifacts: [
      {
        kind: "report" as const,
        label: "evaluation:artifact",
        payload: {
          unmet,
          changed_files: changedFiles,
          diff_count: diffs.length,
          mode,
        },
      },
    ],
  }
}

async function visualResult(config: z.infer<typeof CheckConfig>["visual"]) {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const page = await webPage(config.url, config.timeout_ms ?? 10_000)
  if (!page) {
    if (mode === "strict") {
      return {
        outcome: "failed" as const,
        summary: `Web visual check failed to load ${config.url}.`,
        checks: [
          {
            name: "visual",
            status: "failed" as const,
            evidence: `Could not load ${config.url}`,
          },
        ],
        artifacts: [
          {
            kind: "report" as const,
            label: "evaluation:visual",
            payload: {
              target: config.url,
              mode,
              loaded: false,
            },
          },
        ],
      }
    }
    return {
      outcome: "skipped" as const,
      summary: "Web visual check skipped because the page could not be loaded.",
      checks: [
        {
          name: "visual",
          status: "skipped" as const,
          evidence: `Could not load ${config.url}`,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            mode,
            loaded: false,
          },
        },
      ],
    }
  }

  const unmet = [
    config.require_title && !page.title.toLowerCase().includes(config.require_title.toLowerCase())
      ? `missing title: ${config.require_title}`
      : undefined,
    ...(config.require_text ?? []).map((item) =>
      page.content.toLowerCase().includes(item.toLowerCase()) ? undefined : `missing text: ${item}`,
    ),
  ].filter((item): item is string => Boolean(item))

  if (unmet.length === 0) {
    return {
      outcome: "passed" as const,
      summary: "Web visual checks passed.",
      checks: [
        {
          name: "visual",
          status: "passed" as const,
          evidence: page.title || config.url,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            title: page.title,
          },
        },
      ],
    }
  }

  if (mode === "strict") {
    return {
      outcome: "failed" as const,
      summary: `Web visual checks failed: ${unmet.join(", ")}.`,
      checks: [
        {
          name: "visual",
          status: "failed" as const,
          evidence: unmet.join(", "),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            title: page.title,
            unmet,
          },
        },
      ],
    }
  }

  return {
    outcome: "skipped" as const,
    summary: "Web visual checks skipped in soft mode.",
    checks: [
      {
        name: "visual",
        status: "skipped" as const,
        evidence: unmet.join(", "),
      },
    ],
    artifacts: [
      {
        kind: "report" as const,
        label: "evaluation:visual",
        payload: {
          target: config.url,
          title: page.title,
          unmet,
          mode,
        },
      },
    ],
  }
}

async function puppeteerResult(config: z.infer<typeof CheckConfig>["puppeteer"]) {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const executable = await resolvePuppeteerExecutable(config)
  if (!executable) {
    return softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer acceptance could not find a browser executable.",
      evidence: "No Chrome/Chromium/Edge executable was detected.",
      payload: {
        target: config.url,
        browser: config.browser,
        available: false,
        mode,
      },
    })
  }

  const browser = await puppeteer.launch({
    executablePath: executable,
    headless: true,
    defaultViewport: {
      width: config.viewport?.width ?? 1440,
      height: config.viewport?.height ?? 900,
    },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  }).catch(() => undefined)

  if (!browser) {
    return softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer acceptance failed to launch the browser.",
      evidence: `Failed to launch ${executable}.`,
      payload: {
        target: config.url,
        executable,
        available: false,
        mode,
      },
    })
  }

  try {
    const page = await browser.newPage()
    await page.goto(config.url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeout_ms ?? 20_000,
    })
    if (config.wait_for_selector) {
      await page.waitForSelector(config.wait_for_selector, { timeout: config.timeout_ms ?? 20_000 })
    }
    if (config.wait_for_text) {
      await page.waitForFunction(
        (text) => document.body?.innerText?.includes(text),
        { timeout: config.timeout_ms ?? 20_000 },
        config.wait_for_text,
      )
    }
    await page.waitForTimeout(500)

    const title = await page.title().catch(() => "")
    const content = await page.content().catch(() => "")
    const screenshot = await page.screenshot({
      type: "png",
      encoding: "base64",
      fullPage: config.full_page ?? true,
    })

    const unmet = [
      config.require_title && !title.toLowerCase().includes(config.require_title.toLowerCase())
        ? `missing title: ${config.require_title}`
        : undefined,
      ...(config.require_text ?? []).map((item) =>
        content.toLowerCase().includes(item.toLowerCase()) ? undefined : `missing text: ${item}`,
      ),
    ].filter((item): item is string => Boolean(item))

    const artifacts = [
      {
        kind: "image" as const,
        label: "evaluation:puppeteer:screenshot",
        payload: {
          target: config.url,
          title,
          browser: config.browser ?? "auto",
          executable,
          data_url: `data:image/png;base64,${screenshot}`,
        },
      },
      {
        kind: "report" as const,
        label: "evaluation:puppeteer",
        payload: {
          target: config.url,
          title,
          browser: config.browser ?? "auto",
          executable,
          wait_for_selector: config.wait_for_selector,
          wait_for_text: config.wait_for_text,
          unmet,
          mode,
        },
      },
    ]

    if (unmet.length === 0) {
      return {
        outcome: "passed" as const,
        summary: "Puppeteer browser acceptance passed.",
        checks: [
          {
            name: "puppeteer",
            status: "passed" as const,
            evidence: title || config.url,
          },
        ],
        artifacts,
      }
    }

    if (mode === "strict") {
      return {
        outcome: "failed" as const,
        summary: `Puppeteer browser acceptance failed: ${unmet.join(", ")}.`,
        checks: [
          {
            name: "puppeteer",
            status: "failed" as const,
            evidence: unmet.join(", "),
          },
        ],
        artifacts,
      }
    }

    return {
      outcome: "skipped" as const,
      summary: "Puppeteer browser acceptance skipped in soft mode.",
      checks: [
        {
          name: "puppeteer",
          status: "skipped" as const,
          evidence: unmet.join(", "),
        },
      ],
      artifacts,
    }
  } catch (error) {
    return softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer browser acceptance failed to capture the page.",
      evidence: error instanceof Error ? error.message : String(error),
      payload: {
        target: config.url,
        executable,
        browser: config.browser ?? "auto",
        mode,
      },
    })
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function uiReviewResult(
  config: z.infer<typeof CheckConfig>["ui_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const page = config.url ? await webPage(config.url, config.timeout_ms ?? 10_000) : undefined
  if (config.url && !page) {
    return softOrStrict({
      mode,
      name: "ui_review",
      summary: "UI/UX review could not load the target page.",
      evidence: `Could not load ${config.url}.`,
      payload: {
        target: config.url,
        available: false,
        mode,
      },
    })
  }

  const result = await reviewResult({
    name: "ui_review",
    mode,
    prompt: [
      "You are reviewing a web UI/UX delivery.",
      "Focus on information hierarchy, clarity, layout, interaction affordances, feedback, and accessibility.",
      "Be specific and concise. Reject only when there is a meaningful usability or clarity problem.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      config.focus?.length ? `Focus areas: ${config.focus.join(", ")}` : "",
      page ? `Page title: ${page.title || "(none)"}` : "",
      page ? `Page excerpt:\n${clip(stripHtml(page.content))}` : "",
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  })

  return reviewOutcome("ui_review", mode, result, {
    target: config.url,
    focus: config.focus,
  })
}

async function codeQualityResult(
  config: z.infer<typeof CheckConfig>["code_quality"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const result = await reviewResult({
    name: "code_quality",
    mode,
    prompt: [
      "You are reviewing code quality for a software change.",
      "Focus on correctness risk, maintainability, scope discipline, test coverage, and avoidable complexity.",
      "Be specific and concise. Reject only when there is a material code quality risk.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
      `Diff review:\n${diffDigest(delivery.diffs ?? [], config.max_diffs ?? 4)}`,
    ].join("\n\n"),
  })

  return reviewOutcome("code_quality", mode, result, {
    max_diffs: config.max_diffs ?? 4,
  })
}

async function codeReviewResult(
  config: z.infer<typeof CheckConfig>["code_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const result = await reviewResult({
    name: "code_review",
    mode,
    prompt: [
      "You are reviewing a code change like a professional code reviewer.",
      "Focus on bugs, regressions, unsafe assumptions, missing validation, and missing tests.",
      "Treat maintainability as secondary to correctness. Reject only when there is a real review finding.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
      `Review diff:\n${diffDigest(delivery.diffs ?? [], config.max_diffs ?? 4)}`,
    ].join("\n\n"),
  })

  return reviewOutcome("code_review", mode, result, {
    max_diffs: config.max_diffs ?? 4,
  })
}

async function deadCodeReviewResult(
  config: z.infer<typeof CheckConfig>["dead_code_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const result = await reviewResult({
    name: "dead_code_review",
    mode,
    prompt: [
      "You are reviewing the change for dead code and obsolete implementation leftovers.",
      "Focus on unused exports, unreachable branches, stale helpers, duplicate compatibility code, dead flags, and code paths that should have been removed.",
      "Reject only when dead or obsolete code meaningfully remains after the change.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
      `Dead code review diff:\n${diffDigest(delivery.diffs ?? [], config.max_diffs ?? 4)}`,
    ].join("\n\n"),
  })

  return reviewOutcome("dead_code_review", mode, result, {
    max_diffs: config.max_diffs ?? 4,
  })
}

async function reviewResult(input: {
  name: string
  mode: "soft" | "strict"
  prompt: string
  request: string | undefined
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] }
  context: string
}) {
  const model = await reviewModel()
  if (!model) {
    return {
      ok: false as const,
      summary: `${input.name} unavailable because no review model is configured.`,
      evidence: "No review model available.",
      payload: {
        available: false,
        mode: input.mode,
      },
    }
  }

  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) {
    return {
      ok: false as const,
      summary: `${input.name} unavailable because the review model could not be loaded.`,
      evidence: "Could not load review model.",
      payload: {
        available: false,
        mode: input.mode,
      },
    }
  }

  const result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    messages: [
      {
        role: "system",
        content: input.prompt,
      },
      {
        role: "user",
        content: [
          input.request ? `Task request:\n${input.request}` : "",
          `Delivery summary:\n${input.delivery.summary}`,
          input.context,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: ReviewResult,
  }).catch(() => undefined)

  if (!result) {
    return {
      ok: false as const,
      summary: `${input.name} failed to execute.`,
      evidence: "Review model call failed.",
      payload: {
        available: true,
        mode: input.mode,
      },
    }
  }

  return {
    ok: true as const,
    object: result.object,
  }
}

function reviewOutcome(
  name: "ui_review" | "code_quality" | "code_review" | "dead_code_review",
  mode: "soft" | "strict",
  result:
    | { ok: false; summary: string; evidence: string; payload: Record<string, unknown> }
    | { ok: true; object: z.infer<typeof ReviewResult> },
  extra: Record<string, unknown>,
) {
  if (!result.ok) {
    return softOrStrict({
      mode,
      name,
      summary: result.summary,
      evidence: result.evidence,
      payload: {
        ...extra,
        ...result.payload,
      },
    })
  }

  if (result.object.verdict === "accepted") {
    return {
      outcome: "passed" as const,
      summary: `${name} accepted the delivery.`,
      checks: [
        {
          name,
          status: "passed" as const,
          evidence: clip(result.object.rationale),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: `evaluation:${name}`,
          payload: {
            ...extra,
            ...result.object,
          },
        },
      ],
    }
  }

  return softOrStrict({
    mode,
    name,
    summary: result.object.verdict === "rejected" ? `${name} rejected the delivery.` : `${name} was inconclusive.`,
    evidence: clip(result.object.rationale),
    payload: {
      ...extra,
      ...result.object,
    },
  })
}

async function judgeResult(
  config: z.infer<typeof CheckConfig>["judge"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const model = await judgeModel()
  if (!model) {
    return softOrStrict({
      mode,
      name: "judge",
      summary: "Judge check unavailable because no model is configured.",
      evidence: "No evaluator judge model available.",
      payload: {
        mode,
        available: false,
      },
    })
  }

  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) {
    return softOrStrict({
      mode,
      name: "judge",
      summary: "Judge check unavailable because the language model could not be loaded.",
      evidence: "Could not load evaluator judge model.",
      payload: {
        mode,
        available: false,
      },
    })
  }

  const result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    messages: [
      {
        role: "system",
        content:
          "Judge whether the implementation appears complete based on the request and concrete delivery summary. Be pragmatic. If evidence is weak, return inconclusive.",
      },
      {
        role: "user",
        content: [
          config.prompt ? `Judge instruction: ${config.prompt}` : "",
          request ? `Task request:\n${request}` : "",
          `Delivery summary:\n${delivery.summary}`,
          `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: JudgeResult,
  }).catch(() => undefined)

  if (!result) {
    return softOrStrict({
      mode,
      name: "judge",
      summary: "Judge check failed to execute.",
      evidence: "Judge model call failed.",
      payload: {
        mode,
        available: true,
      },
    })
  }

  if (result.object.verdict === "accepted") {
    return {
      outcome: "passed" as const,
      summary: "Judge check accepted the delivery.",
      checks: [
        {
          name: "judge",
          status: "passed" as const,
          evidence: clip(result.object.rationale),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: result.object,
        },
      ],
    }
  }

  return softOrStrict({
    mode,
    name: "judge",
    summary:
      result.object.verdict === "rejected"
        ? "Judge check rejected the delivery."
        : "Judge check was inconclusive.",
    evidence: clip(result.object.rationale),
    payload: result.object,
  })
}

async function webPage(url: string, timeoutMs: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const response = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "user-agent": "OpenCorvus evaluator",
    },
  }).catch(() => undefined)
  clearTimeout(timer)
  if (!response?.ok) return
  const content = await response.text().catch(() => "")
  return {
    content,
    title: titleOf(content),
  }
}

function titleOf(html: string) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is)
  if (!match?.[1]) return ""
  return match[1].replace(/\s+/g, " ").trim()
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function resolvePuppeteerExecutable(config: z.infer<typeof CheckConfig>["puppeteer"]) {
  const explicit = [config?.executable_path, process.env.OPENCORVUS_PUPPETEER_EXECUTABLE_PATH]
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim())
  for (const item of explicit) {
    if (await Filesystem.exists(item)) return item
  }

  const names =
    process.platform === "win32"
      ? []
      : config?.browser === "edge"
        ? ["microsoft-edge", "msedge"]
        : config?.browser === "chromium"
          ? ["chromium", "chromium-browser"]
          : ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "microsoft-edge", "msedge"]

  for (const name of names) {
    const found = Bun.which(name)
    if (found) return found
  }

  const absolute =
    process.platform === "win32"
      ? windowsBrowserCandidates(config?.browser)
      : process.platform === "darwin"
        ? macBrowserCandidates(config?.browser)
        : []
  for (const item of absolute) {
    if (await Filesystem.exists(item)) return item
  }

  return undefined
}

function windowsBrowserCandidates(browser?: "chrome" | "edge" | "chromium") {
  const chrome = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ]
  const edge = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ]
  const chromium = [
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe",
  ]
  if (browser === "chrome") return chrome
  if (browser === "edge") return edge
  if (browser === "chromium") return chromium
  return [...chrome, ...edge, ...chromium]
}

function macBrowserCandidates(browser?: "chrome" | "edge" | "chromium") {
  const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  const edge = ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
  const chromium = ["/Applications/Chromium.app/Contents/MacOS/Chromium"]
  if (browser === "chrome") return chrome
  if (browser === "edge") return edge
  if (browser === "chromium") return chromium
  return [...chrome, ...edge, ...chromium]
}

function diffDigest(diffs: Snapshot.FileDiff[], limit: number) {
  if (diffs.length === 0) return "(no diffs)"
  return diffs
    .slice(0, limit)
    .map((item) =>
      [
        `File: ${item.file}`,
        `Status: ${item.status ?? "modified"} (+${item.additions}/-${item.deletions})`,
        `After excerpt:\n${clip(item.after)}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n")
}

async function reviewModel() {
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) return
  return (
    (await Provider.getSmallModel(def.providerID).catch(() => undefined)) ??
    (await Provider.getModel(def.providerID, def.modelID).catch(() => undefined))
  )
}

async function judgeModel() {
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) return
  return Provider.getModel(def.providerID, def.modelID).catch(() => undefined)
}

function emptyOptional() {
  return {
    outcome: "passed" as const,
    summary: "",
    checks: [],
    artifacts: [] as Array<{ kind: "log" | "report" | "image"; label: string; payload: Record<string, unknown> }>,
  }
}

function softOrStrict(input: {
  mode: "soft" | "strict"
  name: string
  summary: string
  evidence: string
  payload: Record<string, unknown>
}) {
  if (input.mode === "strict") {
    return {
      outcome: "failed" as const,
      summary: input.summary,
      checks: [
        {
          name: input.name,
          status: "failed" as const,
          evidence: input.evidence,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: `evaluation:${input.name}`,
          payload: input.payload,
        },
      ],
    }
  }
  return {
    outcome: "skipped" as const,
    summary: input.summary,
    checks: [
      {
        name: input.name,
        status: "skipped" as const,
        evidence: input.evidence,
      },
    ],
    artifacts: [
      {
        kind: "report" as const,
        label: `evaluation:${input.name}`,
        payload: input.payload,
      },
    ],
  }
}
