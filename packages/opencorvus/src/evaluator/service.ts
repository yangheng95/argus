import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Shell } from "@/shell/shell"
import { Shell as ShellUtil } from "@/shell/shell"
import { Snapshot } from "@/snapshot"
import { spawn } from "child_process"
import { generateObject } from "ai"
import path from "path"
import z from "zod"
import { CheckConfig, EvaluationCheck } from "@/orchestrator/model"

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
})

export namespace EvaluatorService {
  export async function evaluate(
    task: { request?: string; metadata?: Record<string, unknown> },
    delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
  ) {
    const config = await resolveConfig(task.metadata)
    const commands = [
      { name: "build", commands: config.build ?? [] },
      { name: "test", commands: config.test ?? [] },
      { name: "lint", commands: config.lint ?? [] },
      { name: "verify_cmd", commands: config.verify_cmd ?? [] },
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
            command,
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
      await artifactResult(config.artifact, delivery),
      await visualResult(config.visual),
      await judgeResult(config.judge, task.request, delivery),
    ]

    const failed = optional.find((item) => item.outcome === "failed")
    for (const item of optional) {
      results.push(...item.checks)
      artifacts.push(...item.artifacts)
    }

    if (failed) {
      return {
        status: "failed" as const,
        verdict: "rejected" as const,
        summary: failed.summary,
        checks: results,
        artifacts,
      }
    }

    const skipped = optional.filter((item) => item.outcome === "skipped")
    const optionalChecks = results.filter((item) => item.name !== "evaluation_config")
    if (commands.length === 0 && optionalChecks.length === 0 && results.every((item) => item.status === "skipped")) {
      return {
        status: "inconclusive" as const,
        verdict: "inconclusive" as const,
        summary: "No blocking evaluator checks ran.",
        checks: results,
        artifacts,
      }
    }

    return {
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
  }
}

async function resolveConfig(metadata?: Record<string, unknown>) {
  const configured = CheckConfig.safeParse(metadata?.checks)
  if (configured.success) {
    return fillDiscovered(configured.data)
  }
  return fillDiscovered({})
}

async function fillDiscovered(input: z.input<typeof CheckConfig>) {
  const discovered = await discoverScripts()
  const config = CheckConfig.parse(input)
  return {
    build: config.build ?? discovered.build,
    test: config.test ?? discovered.test,
    lint: config.lint ?? discovered.lint,
    verify_cmd: config.verify_cmd ?? [],
    artifact: config.artifact,
    visual: config.visual,
    judge: config.judge,
    timeout_ms: config.timeout_ms,
  }
}

async function discoverScripts() {
  const file = Bun.file(path.join(Instance.directory, "package.json"))
  const json = await file.json().catch(() => undefined) as { scripts?: Record<string, string> } | undefined
  const scripts = json?.scripts ?? {}
  const run = (name: string) => [`bun run ${name}`]
  return {
    build: scripts.build ? run("build") : [],
    test: scripts.test ? run("test") : [],
    lint: scripts.lint ? run("lint") : [],
  }
}

async function commandResult(command: string, timeout: number) {
  const shell = Shell.acceptable()
  const proc = spawn(command, {
    shell,
    cwd: Instance.directory,
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
  }
}

function clip(input: string) {
  const value = input.trim()
  if (value.length <= MAX_OUTPUT) return value
  return value.slice(0, MAX_OUTPUT) + "\n...[truncated]"
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
