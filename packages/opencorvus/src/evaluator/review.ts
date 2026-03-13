import { findSpecSnapshot, findSpecItems } from "@/orchestrator/store"
import { Provider } from "@/provider/provider"
import { CheckConfig } from "@/orchestrator/model"
import { Snapshot } from "@/snapshot"
import { generateObject } from "@/llm/api"
import z from "zod"
import { Log } from "@/util/log"
import {
  type EvaluationDelivery,
  type EvaluationOutcome,
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

  // Provider.getLanguage may fail if the provider is misconfigured or unavailable;
  // the undefined result is handled immediately below.
  const language = await Provider.getLanguage(model).catch((err) => {
    evaluatorLog.warn("failed to load language model for review", { name: input.name, error: err })
    return undefined
  })
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
    timeoutMs: REVIEW_TIMEOUT_MS,
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
  }).catch((err) => {
    evaluatorLog.warn("review generateObject failed", { name: input.name, error: err })
    return undefined
  })

  if (!result) {
    return {
      ok: false as const,
      summary: `${input.name} failed to execute after retries.`,
      evidence: "Review model call failed after retries.",
      payload: {
        available: true,
        mode: input.mode,
      },
    }
  }

  return {
    ok: true as const,
    object: result.object as z.infer<typeof ReviewResultSchema>,
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
    return softOrStrict({
      mode,
      name,
      summary: result.summary,
      evidence: result.evidence,
      payload: { ...extra, ...result.payload },
    })
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
        summary: `${name} rejected the delivery.`,
        evidence: clip(result.object.rationale),
        payload: {
          ...extra,
          ...result.object,
        },
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
  if (!activeSpecVersionID) {
    return {
      outcome: "passed" as const,
      summary: "Spec check skipped: no active spec version available.",
      checks: [{
        name: "spec_check",
        status: "passed" as const,
        evidence: "No active spec version to compare against; skipping spec check.",
      }],
      artifacts: [],
    }
  }

  let specContent = ""
  let specItemsSection = ""
  if (activeSpecVersionID) {
    try {
      const snapshot = findSpecSnapshot(activeSpecVersionID)
      if (snapshot?.content) specContent = snapshot.content
    } catch (err) {
      evaluatorLog.warn("failed to load spec snapshot", { specVersionID: activeSpecVersionID, error: err })
    }
    try {
      const items = findSpecItems(activeSpecVersionID)
      if (items.length > 0) {
        specItemsSection = "\n\n## Required Spec Items (each MUST be verified)\n\n" +
          items.map((item, i) =>
            `${i + 1}. [${item.priority}] ${item.title}\n   ${item.description}`,
          ).join("\n")
      }
    } catch (err) {
      evaluatorLog.warn("failed to load spec items", { specVersionID: activeSpecVersionID, error: err })
    }
  }
  if (!specContent.trim()) {
    return {
      outcome: "passed" as const,
      summary: "Spec check skipped: no spec content available.",
      checks: [{
        name: "spec_check",
        status: "passed" as const,
        evidence: "Spec content is empty (LLM did not generate expanded_spec); skipping comparison.",
      }],
      artifacts: [],
    }
  }

  const payload = specCheckPayload(delivery.diffs ?? [])

  const model = await evaluationModel()
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

  // Provider.getLanguage may fail if the provider is misconfigured or unavailable;
  // the undefined result is handled immediately below.
  const language = await Provider.getLanguage(model).catch((err) => {
    evaluatorLog.warn("failed to load language model for spec check", { error: err })
    return undefined
  })
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
        "Respond with a JSON object: {\"verdict\":\"accepted\"|\"rejected\",\"rationale\":\"...\",\"criteria\":[{\"criterion\":\"...\",\"status\":\"passed\"|\"failed\",\"evidence\":\"...\"}]}",
    },
    {
      role: "user" as const,
      content: [
        config.prompt ? `Additional instruction: ${config.prompt}` : "",
        `Specification (source of truth):\n${specContent}${specItemsSection}`,
        request ? `Task request:\n${request}` : "",
        `Delivery summary:\n${delivery.summary}`,
        `File contents after changes:\n${payload.text}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ]

  const result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    timeoutMs: REVIEW_TIMEOUT_MS,
    abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    messages: specCheckMessages,
    schema: SpecCheckResult,
  }).catch((err) => {
    evaluatorLog.warn("spec_check generateObject failed", { error: err })
    return undefined
  })

  if (!result) {
    // Model call failed after retries — in strict mode this must block the
    // delivery because it was not verified against the spec.
    return softOrStrict({
      mode,
      name: "spec_check",
      summary: "Spec check could not be executed (model call failed or timed out after retries).",
      evidence: "The spec check model call failed after retries. The delivery was not verified against the specification.",
      payload: { available: true, mode, specID: activeSpecVersionID },
    })
  }

  const object = result.object as z.infer<typeof SpecCheckResult>
  const allPassed = object.criteria.every((c) => c.status === "passed")
  if (allPassed && object.verdict === "accepted") {
    return {
      outcome: "passed" as const,
      summary: "Spec check: all criteria passed.",
      checks: [
        {
          name: "spec_check",
          status: "passed" as const,
          evidence: clip(object.rationale),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: {
            specID: activeSpecVersionID,
            ...object,
          },
        },
      ],
    }
  }

  const failedCriteria = object.criteria.filter((c) => c.status !== "passed")
  return softOrStrict({
    mode,
    name: "spec_check",
    summary: `Spec check: ${failedCriteria.length} criteria not passed.`,
    evidence: clip(
      failedCriteria.map((c) => `[${c.status}] ${c.criterion}: ${c.evidence}`).join("\n"),
    ),
    payload: {
      specID: activeSpecVersionID,
      ...object,
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

function specCheckPayload(diffs: Snapshot.FileDiff[]) {
  return {
    text: diffs.length > 0
      ? diffs.map((item) =>
          item.status === "deleted"
            ? `[DELETED] ${item.file}`
            : `--- ${item.file} ---\n${item.after ?? ""}`,
        ).join("\n\n")
      : "(no diffs available)",
  }
}

let _pendingReviewModel: Promise<Awaited<ReturnType<typeof Provider.getModel>> | undefined> | undefined

function reviewModel() {
  if (_pendingReviewModel) return _pendingReviewModel
  _pendingReviewModel = (async () => {
    try {
      // defaultModel may fail if no provider is configured; returns undefined to signal unavailability.
      const def = await Provider.defaultModel().catch((err) => {
        evaluatorLog.warn("failed to resolve default model for review", { error: err })
        return undefined
      })
      if (!def) return
      // Prefer a small model for reviews; fall back to the default model if no small model is available.
      // Either lookup may fail if the provider is misconfigured.
      return (
        (await Provider.getSmallModel(def.providerID).catch((err) => {
          evaluatorLog.warn("small model lookup failed, falling back to default", { providerID: def.providerID, error: err })
          return undefined
        })) ??
        (await Provider.getModel(def.providerID, def.modelID).catch((err) => {
          evaluatorLog.warn("default model lookup failed for review", { providerID: def.providerID, modelID: def.modelID, error: err })
          return undefined
        }))
      )
    } finally {
      _pendingReviewModel = undefined
    }
  })()
  return _pendingReviewModel
}

async function evaluationModel() {
  // defaultModel may fail if no provider is configured; returns undefined to signal unavailability.
  const def = await Provider.defaultModel().catch((err) => {
    evaluatorLog.warn("failed to resolve default model for evaluation", { error: err })
    return undefined
  })
  if (!def) return
  // getModel may fail if the provider or model ID is invalid/unavailable.
  return Provider.getModel(def.providerID, def.modelID).catch((err) => {
    evaluatorLog.warn("evaluation model lookup failed", { providerID: def.providerID, modelID: def.modelID, error: err })
    return undefined
  })
}
