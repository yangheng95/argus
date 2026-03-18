import { findRequirements, findSpecSnapshot } from "@/orchestrator/store"
import { Provider } from "@/provider/provider"
import { CheckConfig } from "@/orchestrator/model"
import { Snapshot } from "@/snapshot"
import { completeText, generateObject } from "@/llm/api"
import z from "zod"
import { Log } from "@/util/log"
import {
  type CheckTask,
  type CheckDelivery,
  type CheckOutcome,
  SpecCheckResult,
  ReviewResultSchema,
  clip,
  emptyOptional,
  softOrStrict,
  stripHtml,
  webPage,
} from "./shared"

const evaluatorLog = Log.create({ service: "evaluator" })
const REVIEW_TIMEOUT_MS = 480_000

export async function uiReviewResult(
  config: z.infer<typeof CheckConfig>["ui_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<CheckOutcome> {
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
): Promise<CheckOutcome> {
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
): Promise<CheckOutcome> {
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
): Promise<CheckOutcome> {
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

  const result = await completeText({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    abortSignal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    timeoutMs: false,
    maxOutputTokens: 4096,
    system: [
      input.prompt,
      "",
      "Output plain markdown only.",
      "Use these exact top-level sections in order:",
      "- `# Verdict`",
      "- `# Rationale`",
      "- `# Strengths`",
      "- `# Concerns`",
      "",
      "Under `# Verdict`, write exactly one of: accepted, rejected.",
      "Under `# Strengths` and `# Concerns`, write bullet lists.",
      "Do not output JSON.",
    ].join("\n"),
    prompt: [
      input.request ? `Task request:\n${input.request}` : "",
      `Delivery summary:\n${input.delivery.summary}`,
      input.context,
    ]
      .filter(Boolean)
      .join("\n\n"),
  }).catch((err) => {
    evaluatorLog.warn("review text generation failed", { name: input.name, error: err })
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

  const text = collectText(result)
  if (!text.trim()) {
    return {
      ok: false as const,
      summary: `${input.name} returned no review text.`,
      evidence: "Review model produced empty output.",
      payload: {
        available: true,
        mode: input.mode,
      },
    }
  }

  const object = extractReviewText(text)
  if (!object) {
    return {
      ok: false as const,
      summary: `${input.name} returned an unparsable review.`,
      evidence: clip(text, 2000),
      payload: {
        available: true,
        mode: input.mode,
      },
    }
  }

  return {
    ok: true as const,
    object,
  }
}

function reviewOutcome(
  name: "ui_review" | "code_quality" | "code_review" | "dead_code_review" | "goal_check",
  mode: "soft" | "strict",
  result:
    | { ok: false; summary: string; evidence: string; payload: Record<string, unknown> }
    | { ok: true; object: z.infer<typeof ReviewResultSchema> },
  extra: Record<string, unknown>,
): CheckOutcome {
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

function collectText(result: { text?: string; steps: Array<{ text?: string }> }) {
  const direct = result.text?.trim() || ""
  if (direct) return direct
  return result.steps.map((step) => step.text?.trim() || "").filter(Boolean).join("\n\n")
}

function extractReviewText(text: string) {
  const raw = text.trim()
  if (!raw) return undefined
  if (raw.startsWith("{") || raw.includes("```json")) return extractReviewJSON(raw)
  return normalizeReviewResult({
    verdict: sectionBody(raw, ["Verdict", "结论"]).split(/\r?\n/)[0]?.trim(),
    rationale:
      sectionBody(raw, ["Rationale", "Summary", "Reasoning", "理由", "摘要"]) ||
      firstContentLine(raw),
    strengths: parseList(sectionBody(raw, ["Strengths", "优点", "亮点"])),
    concerns: parseList(sectionBody(raw, ["Concerns", "Issues", "Problems", "问题", "风险"])),
  })
}

function extractReviewJSON(text: string) {
  let raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()
  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (!match) return undefined
    raw = match[1]
  }
  try {
    return normalizeReviewResult(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function normalizeReviewResult(input: unknown) {
  const row = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {}
  const verdict = normalizeVerdict(row.verdict)
  const rationale = typeof row.rationale === "string"
    ? row.rationale.trim()
    : typeof row.summary === "string"
    ? row.summary.trim()
    : ""
  if (!verdict || !rationale) return undefined
  try {
    return ReviewResultSchema.parse({
      verdict,
      rationale,
      strengths: normalizeList(row.strengths),
      concerns: normalizeList(row.concerns),
    })
  } catch {
    return undefined
  }
}

function normalizeVerdict(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!text) return undefined
  if (/(^|\b)(accepted|accept|pass|passed|通过|接受)(\b|$)/i.test(text)) return "accepted"
  if (/(^|\b)(rejected|reject|fail|failed|不通过|拒绝)(\b|$)/i.test(text)) return "rejected"
  return undefined
}

function normalizeList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : []
}

function sectionBody(text: string, names: string[]) {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].trim().replace(/^#{1,6}\s*/, "")
    if (!names.some((name) => title.localeCompare(name, "en", { sensitivity: "accent" }) === 0)) continue
    const body: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,6}\s+/.test(lines[j].trim())) break
      body.push(lines[j])
    }
    return body.join("\n").trim()
  }
  return ""
}

function parseList(text: string) {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const value = line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "")
      return value ? [value] : []
    })
}

function firstContentLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !!line && !/^#{1,6}\s+/.test(line))
    || ""
}

export async function goalCheckResult(
  config: z.infer<typeof CheckConfig>["goal_check"],
  task: CheckTask,
  delivery: CheckDelivery,
): Promise<CheckOutcome> {
  if (!config?.enabled) return emptyOptional()
  if (!task.goal) return emptyOptional()
  const mode = config.mode ?? "strict"
  const goal = task.goal
  const result = await reviewResult({
    name: "goal_check",
    mode,
    prompt: [
      "You are evaluating whether a single execution goal is complete.",
      "Reject if the delivery does not satisfy the goal contract, leaves core work incomplete, or drifts outside the owned paths and done definition.",
      "Accept only when the implementation is genuinely complete for this goal, not for the whole product.",
      goal.qaProfile?.goalCheckPrompt ? `Goal-specific QA focus: ${goal.qaProfile.goalCheckPrompt}` : "",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ].filter(Boolean).join("\n"),
    request: task.request,
    delivery,
    context: [
      `Goal title: ${goal.title}`,
      `Goal objective: ${goal.objective ?? goal.description}`,
      `Goal acceptance: ${goal.criteria}`,
      goal.doneDefinition ? `Done definition: ${goal.doneDefinition}` : "",
      goal.ownedPaths?.length ? `Owned paths: ${goal.ownedPaths.join(", ")}` : "",
      goal.requirementIDs?.length ? `Mapped requirements: ${goal.requirementIDs.join(", ")}` : "",
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
      `Diff review:\n${diffDigest(delivery.diffs ?? [], 6)}`,
    ].filter(Boolean).join("\n\n"),
  })
  return reviewOutcome("goal_check", mode, result, {
    goal_id: goal.id,
    requirement_ids: goal.requirementIDs,
  })
}

export async function specCheckResult(
  config: z.infer<typeof CheckConfig>["spec_check"],
  task: CheckTask,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
): Promise<CheckOutcome> {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "strict"
  const activeSpecVersionID = task.activeSpecVersionID
  if (!activeSpecVersionID) {
    return softOrStrict({
      mode,
      name: "spec_check",
      summary: "Spec check failed because no active spec version is available.",
      evidence: "No active spec version was available for scoped acceptance checking.",
      payload: { available: false, reason: "missing_active_spec" },
    })
  }

  let specContent = ""
  try {
    const snapshot = findSpecSnapshot(activeSpecVersionID)
    if (snapshot?.content) specContent = snapshot.content
  } catch (err) {
    evaluatorLog.warn("failed to load spec snapshot", { specVersionID: activeSpecVersionID, error: err })
  }
  if (!specContent.trim()) {
    return softOrStrict({
      mode,
      name: "spec_check",
      summary: "Spec check failed because the active specification content is empty.",
      evidence: "The active spec snapshot exists but contains no formulation content for acceptance checking.",
      payload: { available: false, reason: "empty_spec_content", specID: activeSpecVersionID },
    })
  }

  const scope = resolveSpecScope(config, task)
  const selected = selectRequirements(task, activeSpecVersionID, scope)
  if ("error" in selected) {
    return softOrStrict({
      mode,
      name: "spec_check",
      summary: selected.summary,
      evidence: selected.error,
      payload: {
        specID: activeSpecVersionID,
        scope,
        available: false,
      },
    })
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
          payload: { mode, available: false, scope, specID: activeSpecVersionID },
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
          payload: { mode, available: false, specID: activeSpecVersionID, scope },
        },
      ],
    }
  }

  const specCheckMessages = [
    {
      role: "system" as const,
      content:
        "Evaluate whether the delivery satisfies ALL scoped acceptance criteria from the specification. " +
        "You are provided with the actual file contents after changes. Use them to verify each criterion. " +
        "For each scoped criterion, determine pass/fail with evidence from the code. " +
        "ALL criteria must pass for acceptance. Be thorough and precise. " +
        "Respond with a JSON object: {\"verdict\":\"accepted\"|\"rejected\",\"rationale\":\"...\",\"criteria\":[{\"criterion\":\"...\",\"status\":\"passed\"|\"failed\",\"evidence\":\"...\"}]}",
    },
    {
      role: "user" as const,
      content: [
        config.prompt ? `Additional instruction: ${config.prompt}` : "",
        `Specification (source of truth):\n${specContent}`,
        `QA scope: ${scope}`,
        task.goal ? `Active goal:\n${task.goal.title}\n${task.goal.criteria}` : "",
        `Scoped requirements:\n${requirementsSection(selected.requirements)}`,
        task.request ? `Task request:\n${task.request}` : "",
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
      payload: { available: true, mode, specID: activeSpecVersionID, scope },
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
            scope,
            requirement_ids: selected.requirements.map((item) => item.id),
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
      scope,
      requirement_ids: selected.requirements.map((item) => item.id),
      ...object,
    },
  })
}

function resolveSpecScope(
  config: z.infer<typeof CheckConfig>["spec_check"],
  task: CheckTask,
) {
  const configured = config?.scope ?? task.goal?.qaProfile?.specScope ?? "both"
  if (configured !== "both") return configured
  return Array.isArray(task.requirementIDs) && task.requirementIDs.length > 0
    ? "mapped_requirements" as const
    : "full_spec" as const
}

type ScopedRequirements =
  | { requirements: ReturnType<typeof findRequirements> }
  | { summary: string; error: string }

function selectRequirements(
  task: CheckTask,
  specID: string,
  scope: "mapped_requirements" | "full_spec",
): ScopedRequirements {
  const requirements = findRequirements(specID)
  if (requirements.length < 1) {
    return {
      summary: "Spec check failed because the active specification has no persisted requirements.",
      error: `No requirements were found for active spec ${specID}.`,
    }
  }
  if (scope === "full_spec") {
    const blocking = requirements.filter((item) => item.priority === "blocking")
    return {
      requirements: blocking.length > 0 ? blocking : requirements,
    }
  }
  const mapped = [...new Set(
    [
      ...(Array.isArray(task.requirementIDs) ? task.requirementIDs : []),
      ...(Array.isArray(task.goal?.requirementIDs) ? task.goal.requirementIDs : []),
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0),
  )]
  if (mapped.length < 1) {
    return {
      summary: "Spec check failed because the goal has no mapped requirements.",
      error: "Mapped requirement scope was requested, but no requirement ids were provided in the QA context.",
    }
  }
  const selected = requirements.filter((item) => mapped.includes(item.id))
  const missing = mapped.filter((id) => !selected.some((item) => item.id === id))
  if (missing.length > 0) {
    return {
      summary: "Spec check failed because the goal references unknown requirements.",
      error: `Mapped requirement ids were not found in the active spec: ${missing.join(", ")}.`,
    }
  }
  return {
    requirements: selected,
  }
}

function requirementsSection(
  requirements: Array<{
    id: string
    title: string
    description: string
    priority: string
    acceptance: string[] | null
    evidence_refs?: string[] | null
    non_goals?: string[] | null
  }>,
) {
  return requirements.map((item, index) =>
    [
      `${index + 1}. [${item.priority}] ${item.id} :: ${item.title}`,
      `Description: ${item.description}`,
      `Acceptance: ${(item.acceptance ?? []).join("; ") || item.description}`,
      item.evidence_refs?.length ? `Evidence refs: ${item.evidence_refs.join(", ")}` : "",
      item.non_goals?.length ? `Non-goals: ${item.non_goals.join("; ")}` : "",
    ].filter(Boolean).join("\n")
  ).join("\n\n")
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
