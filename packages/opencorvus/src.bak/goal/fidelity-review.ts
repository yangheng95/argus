/**
 * Goal Fidelity Review — LLM-based verification that compiled goals
 * faithfully and completely cover spec requirements.
 *
 * Runs after GoalService.initial() and before the goal draft is persisted.
 * Single pass, no iterative loops.
 */
import z from "zod"
import { resolveHeadlessLanguageModel, completeHeadlessText } from "@/llm/headless"
import type { GoalDraft } from "@/goal/service"
import type { SpecDraft, Requirement } from "@/spec/agent"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-fidelity-review" })

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CoverageIssueSchema = z.object({
  requirement_id: z.string(),
  issue: z.enum(["uncovered", "partial", "distorted", "merged_incorrectly"]),
  explanation: z.string(),
})

const GoalCorrectionSchema = z.object({
  goal_id: z.string(),
  action: z.enum(["modify", "split", "remove"]),
  reason: z.string(),
  updated_objective: z.string().optional(),
  updated_done_definition: z.string().optional(),
  updated_owned_paths: z.array(z.string()).optional(),
  split_into: z
    .array(
      z.object({
        title: z.string(),
        objective: z.string(),
        requirement_ids: z.array(z.string()),
        done_definition: z.string(),
        owned_paths: z.array(z.string()),
      }),
    )
    .optional(),
})

const MissingGoalSchema = z.object({
  title: z.string(),
  objective: z.string(),
  requirement_ids: z.array(z.string()),
  done_definition: z.string(),
  owned_paths: z.array(z.string()),
  depends_on_goal_ids: z.array(z.string()),
  reason: z.string(),
})

const FidelityReviewSchema = z.object({
  verdict: z.enum(["approved", "needs_correction"]),
  coverage_issues: z.array(CoverageIssueSchema),
  goal_corrections: z.array(GoalCorrectionSchema),
  missing_goals: z.array(MissingGoalSchema),
})

export type FidelityReviewResult = z.infer<typeof FidelityReviewSchema>

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type FidelityReviewInput = {
  request: string
  spec: SpecDraft
  goalDraft: GoalDraft
  sessionID?: string
  metadata?: Record<string, unknown>
  timeoutMs?: number
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

function formatRequirements(requirements: Requirement[]): string {
  return requirements
    .map((req) => {
      const acceptance = req.acceptance.join("; ")
      return [
        `[${req.id}] "${req.title}" (${req.priority ?? "blocking"})`,
        `  Description: ${req.description}`,
        acceptance ? `  Acceptance: ${acceptance}` : "",
        req.evidence_refs.length > 0 ? `  Files: ${req.evidence_refs.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n\n")
}

function formatGoals(goals: GoalDraft["goals"]): string {
  return goals
    .map((goal) =>
      [
        `[${goal.id}] "${goal.title}" (${goal.priority}, kind: ${goal.kind})`,
        `  Objective: ${goal.objective}`,
        `  Done definition: ${goal.done_definition}`,
        `  Requirement IDs: ${goal.requirement_ids.join(", ")}`,
        `  Owned paths: ${goal.owned_paths.join(", ")}`,
        goal.depends_on_goal_ids.length > 0 ? `  Depends on: ${goal.depends_on_goal_ids.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run(input: FidelityReviewInput): Promise<FidelityReviewResult> {
  const requirements = input.spec.requirements ?? []
  if (requirements.length === 0) {
    throw new Error("Fidelity review requires at least one spec requirement")
  }
  if (input.goalDraft.goals.length === 0) {
    throw new Error("Fidelity review requires at least one goal")
  }

  const { model, language } = await resolveHeadlessLanguageModel({
    label: "goal-fidelity-review",
    metadata: input.metadata,
    sessionID: input.sessionID,
  })

  const requirementIDs = requirements.map((r) => r.id)
  const goalIDs = input.goalDraft.goals.map((g) => g.id)

  const prompt = `You are a goal fidelity reviewer. Verify that compiled goals faithfully and completely cover all specification requirements.

## Original Request
${input.request}

## Spec Content
${input.spec.content ?? "(no content)"}

## Spec Requirements (${requirements.length} total)
${formatRequirements(requirements)}

## Compiled Goals (${input.goalDraft.goals.length} total)
${formatGoals(input.goalDraft.goals)}

## Instructions

For EACH requirement, verify:
1. **Coverage**: Is it mapped to at least one goal via requirement_ids? If not, report "uncovered".
2. **Completeness**: Does the goal's objective + done_definition fully address the requirement's acceptance criteria? If only partially, report "partial".
3. **Faithfulness**: Is the goal's objective consistent with the requirement's intent? If distorted, report "distorted".
4. **Clustering**: Was the requirement incorrectly merged with unrelated requirements in the same goal? If so, report "merged_incorrectly".

Also check for implicit requirements mentioned in the spec content but not present in the structured requirements list. If found, add them as missing_goals.

## Rules
- Only report REAL issues. If coverage is correct, set verdict to "approved" with empty arrays.
- Every correction and missing goal must cite specific requirement_ids from this list: ${requirementIDs.join(", ")}
- For "split" actions, each sub-goal must have non-empty requirement_ids, owned_paths, and done_definition.
- For missing_goals, use depends_on_goal_ids from this list: ${goalIDs.join(", ")}
- Preserve the compiler's work. Only make targeted corrections where coverage is genuinely wrong.
- Do NOT add goals for requirements that are already adequately covered.

Output ONLY a JSON object (no markdown fences, no other text):
{
  "verdict": "approved or needs_correction",
  "coverage_issues": [{"requirement_id": "...", "issue": "uncovered or partial or distorted or merged_incorrectly", "explanation": "..."}],
  "goal_corrections": [{"goal_id": "...", "action": "modify or split or remove", "reason": "...", "updated_objective": "...", "updated_done_definition": "...", "updated_owned_paths": ["..."], "split_into": [{"title": "...", "objective": "...", "requirement_ids": ["..."], "done_definition": "...", "owned_paths": ["..."]}]}],
  "missing_goals": [{"title": "...", "objective": "...", "requirement_ids": ["..."], "done_definition": "...", "owned_paths": ["..."], "depends_on_goal_ids": ["..."], "reason": "..."}]
}`

  // Application-level retry: the LLM call may return empty or truncated text
  // (observed with Copilot Responses API). Retry up to MAX_REVIEW_ATTEMPTS times.
  // If all attempts produce unparseable output, throw — the pipeline's stage
  // retry will re-run the entire goal decomposition.
  const MAX_REVIEW_ATTEMPTS = 3
  let lastError: Error | undefined
  let result: z.infer<typeof FidelityReviewSchema> | undefined

  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt++) {
    let text: string
    try {
      const res = await completeHeadlessText({
        label: "goal-fidelity-review",
        model,
        language,
        prompt,
        system:
          "You are a precise goal coverage reviewer for a software task orchestrator. " +
          "Output only valid JSON. Never wrap output in markdown code fences. " +
          "Be conservative: only flag issues where coverage is genuinely wrong or missing.",
        tools: {},
        maxOutputTokens: 8192,
        sessionID: input.sessionID,
        timeoutMs: input.timeoutMs ?? 120_000,
        abortSignal: input.signal,
      })
      text = res.text
    } catch (streamErr) {
      lastError = new Error(`Goal fidelity review LLM call failed (attempt ${attempt}/${MAX_REVIEW_ATTEMPTS}): ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`)
      log.warn("fidelity review: LLM call failed, retrying", {
        attempt,
        maxAttempts: MAX_REVIEW_ATTEMPTS,
        error: streamErr instanceof Error ? streamErr.message : String(streamErr),
      })
      continue
    }

    const jsonStart = text.indexOf("{")
    const jsonEnd = text.lastIndexOf("}")
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      lastError = new Error(`Goal fidelity review returned unparseable output (attempt ${attempt}/${MAX_REVIEW_ATTEMPTS}): ${text.slice(0, 300)}`)
      log.warn("fidelity review: unparseable output, retrying", {
        attempt,
        maxAttempts: MAX_REVIEW_ATTEMPTS,
        outputLength: text.length,
        preview: text.slice(0, 100),
      })
      continue
    }

    try {
      const raw = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
      result = FidelityReviewSchema.parse(raw)
      break
    } catch (parseErr) {
      lastError = new Error(`Goal fidelity review JSON parse failed (attempt ${attempt}/${MAX_REVIEW_ATTEMPTS}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`)
      log.warn("fidelity review: JSON parse error, retrying", {
        attempt,
        maxAttempts: MAX_REVIEW_ATTEMPTS,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      })
      continue
    }
  }

  if (!result) {
    throw lastError ?? new Error("Goal fidelity review failed after all attempts")
  }

  // Filter out invalid references — the LLM may hallucinate IDs
  const requirementIDSet = new Set(requirementIDs)
  const goalIDSet = new Set(goalIDs)

  result.coverage_issues = result.coverage_issues.filter((issue) => requirementIDSet.has(issue.requirement_id))
  result.goal_corrections = result.goal_corrections.filter((c) => goalIDSet.has(c.goal_id))
  result.missing_goals = result.missing_goals
    .map((g) => ({
      ...g,
      requirement_ids: g.requirement_ids.filter((id) => requirementIDSet.has(id)),
      depends_on_goal_ids: g.depends_on_goal_ids.filter((id) => goalIDSet.has(id)),
    }))
    .filter((g) => g.requirement_ids.length > 0)

  // Reconcile verdict with actual corrections
  if (result.verdict === "approved" && (result.goal_corrections.length > 0 || result.missing_goals.length > 0)) {
    result.verdict = "needs_correction"
  }
  if (result.verdict === "needs_correction" && result.goal_corrections.length === 0 && result.missing_goals.length === 0) {
    result.verdict = "approved"
  }

  log.info("fidelity review completed", {
    verdict: result.verdict,
    issues: result.coverage_issues.length,
    corrections: result.goal_corrections.length,
    missing: result.missing_goals.length,
  })

  return result
}

// ---------------------------------------------------------------------------
// Apply corrections to goal draft
// ---------------------------------------------------------------------------

function sanitizeGoalId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return `goal_${slug || "new"}`
}

function uniqueGoalId(base: string, existingIDs: Set<string>): string {
  let id = base
  let counter = 1
  while (existingIDs.has(id)) {
    id = `${base}_${counter}`
    counter++
  }
  return id
}

function trimStrings(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))]
}

export function applyGoalCorrections(goalDraft: GoalDraft, review: FidelityReviewResult): GoalDraft {
  if (review.verdict === "approved") return goalDraft

  const existingIDs = new Set(goalDraft.goals.map((g) => g.id))
  const goals = goalDraft.goals.map((g) => ({ ...g }))

  for (const correction of review.goal_corrections) {
    const index = goals.findIndex((g) => g.id === correction.goal_id)
    if (index < 0) continue

    switch (correction.action) {
      case "modify": {
        const goal = goals[index]!
        if (correction.updated_objective) goal.objective = correction.updated_objective.trim()
        if (correction.updated_done_definition) goal.done_definition = correction.updated_done_definition.trim()
        if (correction.updated_owned_paths && correction.updated_owned_paths.length > 0) {
          goal.owned_paths = trimStrings(correction.updated_owned_paths)
        }
        break
      }
      case "split": {
        if (!correction.split_into || correction.split_into.length === 0) break
        const original = goals[index]!
        const newGoals = correction.split_into.map((sub) => {
          const newID = uniqueGoalId(sanitizeGoalId(sub.title), existingIDs)
          existingIDs.add(newID)
          return {
            ...original,
            id: newID,
            title: sub.title.trim(),
            objective: sub.objective.trim(),
            requirement_ids: trimStrings(sub.requirement_ids.length > 0 ? sub.requirement_ids : original.requirement_ids),
            done_definition: sub.done_definition.trim(),
            owned_paths: trimStrings(sub.owned_paths.length > 0 ? sub.owned_paths : original.owned_paths),
            depends_on_goal_ids: [...original.depends_on_goal_ids],
            qa_profile: {
              ...original.qa_profile,
              goal_check_prompt: `Verify requirements ${(sub.requirement_ids.length > 0 ? sub.requirement_ids : original.requirement_ids).join(", ")} are fully satisfied.`,
            },
          }
        })
        const removedID = original.id
        const newIDs = newGoals.map((g) => g.id)
        goals.splice(index, 1, ...newGoals)
        // Dependents of the removed goal now depend on all split sub-goals
        for (const goal of goals) {
          if (goal.depends_on_goal_ids.includes(removedID)) {
            goal.depends_on_goal_ids = [
              ...goal.depends_on_goal_ids.filter((id) => id !== removedID),
              ...newIDs,
            ]
          }
        }
        break
      }
      case "remove": {
        const removedID = goals[index]!.id
        goals.splice(index, 1)
        for (const goal of goals) {
          goal.depends_on_goal_ids = goal.depends_on_goal_ids.filter((id) => id !== removedID)
        }
        break
      }
    }
  }

  // Add missing goals — with dedup to prevent exponential growth
  // A missing goal is skipped if its requirement_ids are already fully covered
  // by existing goals, or if its normalized title duplicates an existing goal.
  const coveredRequirementIDs = new Set(goals.flatMap((g) => g.requirement_ids))
  const normalizedTitles = new Set(goals.map((g) => g.title.trim().toLowerCase()))
  let skippedDuplicates = 0

  for (const missing of review.missing_goals) {
    const reqIDs = trimStrings(missing.requirement_ids)
    const normalizedTitle = missing.title.trim().toLowerCase()

    // Skip if all requirement_ids already covered by existing goals
    if (reqIDs.length > 0 && reqIDs.every((id) => coveredRequirementIDs.has(id))) {
      skippedDuplicates++
      continue
    }
    // Skip if title duplicates an existing goal
    if (normalizedTitles.has(normalizedTitle)) {
      skippedDuplicates++
      continue
    }

    const id = uniqueGoalId(sanitizeGoalId(missing.title), existingIDs)
    existingIDs.add(id)
    normalizedTitles.add(normalizedTitle)
    for (const reqID of reqIDs) coveredRequirementIDs.add(reqID)

    goals.push({
      id,
      title: missing.title.trim(),
      objective: missing.objective.trim(),
      requirement_ids: reqIDs,
      depends_on_goal_ids: missing.depends_on_goal_ids.filter((depID) => existingIDs.has(depID)),
      owned_paths: trimStrings(missing.owned_paths.length > 0 ? missing.owned_paths : ["src/"]),
      done_definition: missing.done_definition.trim(),
      qa_profile: {
        rule_selectors: ["build", "test"],
        goal_check_prompt: `Verify requirements ${missing.requirement_ids.join(", ")} are fully satisfied.`,
        spec_scope: "mapped_requirements" as const,
      },
      priority: "blocking" as const,
      kind: "feature" as const,
    })
  }

  if (skippedDuplicates > 0) {
    log.info("skipped duplicate missing goals", { skipped: skippedDuplicates })
  }

  log.info("applied goal corrections", {
    originalGoals: goalDraft.goals.length,
    finalGoals: goals.length,
    corrections: review.goal_corrections.length,
    added: review.missing_goals.length,
  })

  return {
    summary: `${goals.length} goals (${review.goal_corrections.length} corrected, ${review.missing_goals.length} added by fidelity review)`,
    goals,
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const GoalFidelityReview = { run }
