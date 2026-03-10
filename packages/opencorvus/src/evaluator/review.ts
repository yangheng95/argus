import { findSpecSnapshot, findSpecItems } from "@/orchestrator/store"
import { Provider } from "@/provider/provider"
import { CheckConfig } from "@/orchestrator/model"
import { Snapshot } from "@/snapshot"
import { generateObject, generateText } from "ai"
import z from "zod"
import { Log } from "@/util/log"
import fs from "fs"
import path from "path"
import { Instance } from "@/project/instance"
import {
  type EvaluationDelivery,
  type EvaluationOutcome,
  JudgeResult,
  SpecCheckResult,
  ReviewResultSchema,
  clip,
  emptyOptional,
  softOrStrict,
  stripHtml,
  webPage,
} from "./shared"

const evaluatorLog = Log.create({ service: "evaluator" })
const REVIEW_TIMEOUT_MS = 120_000

async function loadSpecFromFilesystem(): Promise<string> {
  try {
    const specsDir = path.join(Instance.worktree, ".opencorvus", "specs")
    
    // Read all .md files from the specs directory
    if (!fs.existsSync(specsDir)) {
      return ""
    }
    
    const files = fs.readdirSync(specsDir).filter((f) => f.endsWith(".md"))
    if (files.length === 0) {
      return ""
    }
    
    // Try to load primary spec files in order of preference
    const preferredFiles = ["MOMENT_DIARY_SOLUTION.md", "SPEC.md", "README.md"]
    const primaryFile = preferredFiles.find((f) => files.includes(f)) || files[0]
    
    if (!primaryFile) {
      return ""
    }
    
    const filePath = path.join(specsDir, primaryFile)
    const content = fs.readFileSync(filePath, "utf-8")
    return content || ""
  } catch (error) {
    evaluatorLog.debug("Failed to load spec from filesystem", { error: String(error) })
    return ""
  }
}


export async function uiReviewResult(
  config: z.infer<typeof CheckConfig>["ui_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<EvaluationOutcome> {
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

export async function codeQualityResult(
  config: z.infer<typeof CheckConfig>["code_quality"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<EvaluationOutcome> {
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

export async function codeReviewResult(
  config: z.infer<typeof CheckConfig>["code_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<EvaluationOutcome> {
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

export async function deadCodeReviewResult(
  config: z.infer<typeof CheckConfig>["dead_code_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<EvaluationOutcome> {
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
    abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
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
    schema: ReviewResultSchema,
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
    | { ok: true; object: z.infer<typeof ReviewResultSchema> },
  extra: Record<string, unknown>,
): EvaluationOutcome {
  if (!result.ok) {
    return {
      outcome: "failed" as const,
      summary: result.summary,
      checks: [
        {
          name,
          status: "failed" as const,
          evidence: result.evidence,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: `evaluation:${name}`,
          payload: {
            ...extra,
            ...result.payload,
          },
        },
      ],
    }
  }

  return result.object.verdict === "accepted"
    ? {
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
    : softOrStrict({
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

export async function judgeResult(
  config: z.infer<typeof CheckConfig>["judge"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<EvaluationOutcome> {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const model = await judgeModel()
  if (!model) {
    return {
      outcome: "failed" as const,
      summary: "Judge check unavailable because no model is configured.",
      checks: [
        {
          name: "judge",
          status: "failed" as const,
          evidence: "No evaluator judge model available.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: {
            mode,
            available: false,
          },
        },
      ],
    }
  }

  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) {
    return {
      outcome: "failed" as const,
      summary: "Judge check unavailable because the language model could not be loaded.",
      checks: [
        {
          name: "judge",
          status: "failed" as const,
          evidence: "Could not load evaluator judge model.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: {
            mode,
            available: false,
          },
        },
      ],
    }
  }

  const result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
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
  }).catch((err) => {
    evaluatorLog.warn("judge model call failed", { error: String(err), model: `${model.providerID}/${model.id}` })
    return undefined
  })

  if (!result) {
    return {
      outcome: "failed" as const,
      summary: "Judge check failed to execute.",
      checks: [
        {
          name: "judge",
          status: "failed" as const,
          evidence: "Judge model call failed.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: {
            mode,
            available: true,
          },
        },
      ],
    }
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

export async function specCheckResult(
  config: z.infer<typeof CheckConfig>["spec_check"],
  request: string | undefined,
  activeSpecVersionID: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<EvaluationOutcome> {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "strict"

  let specContent = ""
  let specItemsSection = ""
  if (activeSpecVersionID) {
    try {
      const snapshot = findSpecSnapshot(activeSpecVersionID)
      if (snapshot?.content) specContent = snapshot.content
    } catch {}
    try {
      const items = findSpecItems(activeSpecVersionID)
      if (items.length > 0) {
        specItemsSection = "\n\n## Required Spec Items (each MUST be verified)\n\n" +
          items.map((item, i) =>
            `${i + 1}. [${item.priority}] ${item.title}\n   ${item.description}`,
          ).join("\n")
      }
    } catch {}
   }
   if (!specContent.trim()) {
     // Try to load from filesystem as fallback
     specContent = await loadSpecFromFilesystem()
   }
   if (!specContent.trim()) {
     return softOrStrict({
       mode,
      name: "spec_check",
      summary: "No spec found in database.",
      evidence: "Cannot verify delivery against spec: no spec exists.",
      payload: { available: false },
    })
  }

  const model = await judgeModel()
  if (!model) {
    return {
      outcome: "failed" as const,
      summary: "Spec check unavailable because no model is configured.",
      checks: [
        {
          name: "spec_check",
          status: "failed" as const,
          evidence: "No evaluator model available for spec check.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: { mode, available: false },
        },
      ],
    }
  }

  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) {
    return {
      outcome: "failed" as const,
      summary: "Spec check unavailable because the language model could not be loaded.",
      checks: [
        {
          name: "spec_check",
          status: "failed" as const,
          evidence: "Could not load evaluator model for spec check.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: { mode, available: false, specID: activeSpecVersionID },
        },
      ],
    }
  }

  const fileCount = delivery.diffs?.length ?? 0
  const perFileLimit = fileCount <= 1 ? 60000 : fileCount <= 3 ? 20000 : 8000
  const diffsSection = delivery.diffs?.length
    ? delivery.diffs.map((d) => {
        const content = d.status === "deleted"
          ? `[DELETED] ${d.file}`
          : `--- ${d.file} ---\n${clip(d.after, perFileLimit)}`
        return content
      }).join("\n\n")
    : "(no diffs available)"

  const specCheckMessages = [
    {
      role: "system" as const,
      content:
        "Evaluate whether the delivery satisfies ALL acceptance criteria in the specification. " +
        "You are provided with the actual file contents after changes. Use them to verify each criterion. " +
        "For each criterion in the spec, determine pass/fail with evidence from the code. " +
        "Pay special attention to the 'Required Spec Items' section — each item marked [blocking] " +
        "MUST be individually verified as passed for acceptance. " +
        "ALL criteria must pass for acceptance. Be thorough and precise. " +
        "Respond with a JSON object: {\"verdict\":\"accepted\"|\"rejected\"|\"inconclusive\",\"rationale\":\"...\",\"criteria\":[{\"criterion\":\"...\",\"status\":\"passed\"|\"failed\"|\"inconclusive\",\"evidence\":\"...\"}]}",
    },
    {
      role: "user" as const,
      content: [
        config.prompt ? `Additional instruction: ${config.prompt}` : "",
        `Specification (source of truth):\n${specContent}${specItemsSection}`,
        request ? `Task request:\n${request}` : "",
        `Delivery summary:\n${delivery.summary}`,
        `File contents after changes:\n${diffsSection}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ]

  let result: { object: z.infer<typeof SpecCheckResult> } | undefined
  result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    messages: specCheckMessages,
    schema: SpecCheckResult,
  }).catch(() => undefined)

  if (!result) {
    const textResult = await generateText({
      model: language,
      temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
      abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
      messages: specCheckMessages,
    }).catch((err) => {
      evaluatorLog.warn("spec_check text fallback failed", { error: String(err), model: `${model.providerID}/${model.id}` })
      return undefined
    })
    if (textResult?.text) {
      try {
        const jsonMatch = textResult.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = SpecCheckResult.parse(JSON.parse(jsonMatch[0]))
          result = { object: parsed }
        }
      } catch {
        evaluatorLog.warn("spec_check JSON parse failed", { text: textResult.text.substring(0, 200) })
      }
    }
  }

  if (!result) {
    return {
      outcome: "failed" as const,
      summary: "Spec check failed to execute.",
      checks: [
        {
          name: "spec_check",
          status: "failed" as const,
          evidence: "Spec check model call failed.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: { mode, available: true, specID: activeSpecVersionID },
        },
      ],
    }
  }

  const allPassed = result.object.criteria.every((c) => c.status === "passed")
  if (allPassed && result.object.verdict === "accepted") {
    return {
      outcome: "passed" as const,
      summary: "Spec check: all criteria passed.",
      checks: [
        {
          name: "spec_check",
          status: "passed" as const,
          evidence: clip(result.object.rationale),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: {
            specID: activeSpecVersionID,
            ...result.object,
          },
        },
      ],
    }
  }

  const failedCriteria = result.object.criteria.filter((c) => c.status !== "passed")
  return softOrStrict({
    mode,
    name: "spec_check",
    summary: `Spec check: ${failedCriteria.length} criteria not passed.`,
    evidence: clip(
      failedCriteria.map((c) => `[${c.status}] ${c.criterion}: ${c.evidence}`).join("\n"),
    ),
    payload: {
      specID: activeSpecVersionID,
      ...result.object,
    },
  })
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
