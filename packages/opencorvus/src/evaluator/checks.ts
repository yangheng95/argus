import { Env } from "@/env"
import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { CheckConfig } from "@/orchestrator/model"
import { Snapshot } from "@/snapshot"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import { spawn } from "child_process"
import z from "zod"
import puppeteer from "puppeteer-core"
import {
  type CommandGroup,
  type CheckArtifact,
  type CheckDelivery,
  type CheckOutcome,
  type CheckCommand,
  checkResult,
  clip,
  emptyOptional,
  softOrStrict,
  webPage,
} from "./shared"
import { Log } from "@/util/log"

const evaluatorLog = Log.create({ service: "evaluator-checks" })

function commandShell(command: string) {
  const shell = Shell.acceptable()
  if (process.platform !== "win32") return shell
  if (!/[&|]{2}/.test(command)) return shell
  if (!/powershell|pwsh/i.test(String(shell))) return shell
  return process.env.COMSPEC || "cmd.exe"
}

export async function commandChecks(
  commands: CommandGroup[],
  timeout: number,
  delivery: CheckDelivery,
) {
  const tasks = commands.flatMap((group) =>
    group.commands.map((command, index) => ({
      group,
      name: group.commands.length === 1 ? group.name : `${group.name}#${index + 1}`,
      command,
    })),
  )
  // Run checks sequentially to avoid spawning too many child processes at once
  const results: Array<typeof tasks[number] & { result: Awaited<ReturnType<typeof commandResult>> }> = []
  for (const task of tasks) {
    const result = await commandResult(task.command, timeout)
    results.push({ ...task, result })
  }
  const checks = results.map((item) => ({
    ...checkResult({
      name: item.name,
      label: item.group.label,
      family: item.group.family,
      status: item.result.code === 0 ? "passed" : "failed",
      evidence: clip(item.result.output) || `${typeof item.command === "string" ? item.command : item.command.command} ${item.result.code === 0 ? "passed" : "failed"}`,
    }),
  }))
  const artifacts: CheckArtifact[] = results.map((item) => ({
    kind: "log",
    label: `evaluation:${item.name}`,
    payload: {
      command: item.result.command,
      cwd: item.result.cwd,
      code: item.result.code,
      output: clip(item.result.output),
    },
  }))

  if (commands.length === 0) {
    checks.push(checkResult({
      name: "evaluation_config",
      status: "skipped",
      evidence: delivery.summary,
    }))
  }

  return { checks, artifacts }
}

export async function commandResult(input: string | CheckCommand, timeout: number) {
  const command = typeof input === "string" ? input : input.command
  const cwd = typeof input === "string" ? Instance.directory : input.cwd ?? Instance.directory
  const shell = commandShell(command)
  const proc = spawn(command, {
    shell,
    cwd,
    env: Env.all(),
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
    void Shell.killTree(proc, { exited: () => proc.exitCode !== null || proc.signalCode !== null })
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
    // Ensure child process tree is fully killed after completion
    if (proc.exitCode === null && proc.signalCode === null) {
      Shell.killTree(proc, { exited: () => proc.exitCode !== null || proc.signalCode !== null }).catch(() => {})
    }
  })

  return {
    code,
    output,
    command,
    cwd,
  }
}

export async function startupResult(config: z.infer<typeof CheckConfig>["startup"]): Promise<CheckOutcome> {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const timeout = config.timeout_ms ?? 20_000
  const warmup = config.warmup_ms ?? 1_500
  const shell = commandShell(config.command)
  const proc = spawn(config.command, {
    shell,
    cwd: Instance.directory,
    env: Env.all(),
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
    await Shell.killTree(proc, { exited: () => proc.exitCode !== null || proc.signalCode !== null })
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
      // requireExitZero: one-shot processes that exit 0 are considered ready,
      // even when readyURL is configured (the URL can't be checked after exit)
      if (input.requireExitZero && code === 0) {
        const textMatch = !input.readyText || input.output().includes(input.readyText)
        if (textMatch) {
          return {
            ok: true,
            evidence: input.readyText
              ? `Process exited 0 and output matched "${input.readyText}".`
              : "Process exited successfully (requireExitZero).",
          }
        }
      }
      if (!input.readyURL && !input.readyText && code === 0) {
        return { ok: true, evidence: "Process exited successfully." }
      }
      if (code === 0 && input.readyText && input.output().includes(input.readyText)) {
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

export async function artifactResult(
  config: z.infer<typeof CheckConfig>["artifact"],
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<CheckOutcome> {
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

export async function visualResult(config: z.infer<typeof CheckConfig>["visual"]): Promise<CheckOutcome> {
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

export async function puppeteerResult(config: z.infer<typeof CheckConfig>["puppeteer"]): Promise<CheckOutcome> {
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
  }).catch((err) => {
    evaluatorLog.warn("puppeteer launch failed", { executable, error: String(err) })
    return undefined
  })

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
    await new Promise((resolve) => setTimeout(resolve, 500))

    const title = await page.title().catch((err) => {
      evaluatorLog.warn("puppeteer page.title() failed", { url: config.url, error: String(err) })
      return ""
    })
    const content = await page.content().catch((err) => {
      evaluatorLog.warn("puppeteer page.content() failed", { url: config.url, error: String(err) })
      return ""
    })
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
    await browser.close().catch((err) => {
      evaluatorLog.warn("puppeteer browser.close() failed", { error: String(err) })
    })
  }
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
    const found = which(name)
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
