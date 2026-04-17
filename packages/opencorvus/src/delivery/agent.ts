/**
 * DeliveryAgent — An independent-context agent that performs end-to-end
 * verification of the delivered application, including starting the server/client,
 * checking frontend rendering, and fixing any bugs discovered during verification.
 *
 * Unlike the GoalJudge which is read-only, this agent can:
 * 1. Start the application (server, client, or both)
 * 2. Verify frontend rendering and runtime behavior
 * 3. Fix bugs found during verification (write/edit code)
 * 4. Re-verify after fixes to confirm the application works
 * 5. Make a final acceptance decision before publishing
 */
import { stepCountIs } from "ai"
import z from "zod"
import { extractRawJSON, repairTruncatedJSON, sanitizeJSON, trimToLastComplete, tryParseJSON } from "@/llm/json-repair"
import { resolveAgentModel } from "@/agent/model"
import { AgentRuntime } from "@/agent/runtime"
import { createDeliveryTools } from "./tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import { Config } from "@/config/config"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { loadStageSkills } from "@/engine/skill-inject"
import { collectText, countToolCalls, firstContentLine, sectionBody } from "@/util/agent-text"
import { AttachmentStore } from "@/storage/attachment-store"
import type { GoalJudgmentType, GoalInfo, DeliveryInfo } from "@/delivery/checks"

const log = Log.create({ service: "delivery-agent" })

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const StartupVerification = z.object({
  attempted: z.boolean().describe("Whether startup verification was attempted"),
  command: z.string().optional().describe("Command used to start the application"),
  success: z.boolean().describe("Whether the application started successfully"),
  output: z.string().optional().describe("Relevant startup output or error messages"),
})

export const FrontendCheck = z.object({
  attempted: z.boolean().describe("Whether frontend verification was attempted"),
  renders_correctly: z.boolean().optional().describe("Whether the frontend renders without errors"),
  issues: z.array(z.string()).optional().describe("Frontend issues found"),
})

export const DeliveryVerdict = z.object({
  verdict: z.enum(["accepted", "rejected"]),
  summary: z.string(),
  launch_command: z.string().optional().describe("The exact verified command to start the application (only present when startup_verification.success is true). Will be used to auto-launch after publish."),
  startup_verification: StartupVerification,
  frontend_check: FrontendCheck,
  issues_found: z.array(z.string()),
  rejection_details: z.array(z.object({
    category: z.enum(["build", "test", "lint", "runtime", "quality", "startup"]).describe("Category of the issue"),
    file: z.string().optional().describe("Affected file path, if applicable"),
    error: z.string().describe("Description of the error or issue"),
    suggestion: z.string().optional().describe("Suggested fix approach for the executor"),
  })).optional().describe("Structured rejection details for the executor to fix. Required when verdict is rejected."),
  deferred_checks: z.array(z.object({
    name: z.string().describe("Check name (e.g. code_review, dead_code_review)"),
    result: z.enum(["passed", "failed", "skipped"]),
    evidence: z.string().describe("Brief evidence or reason"),
  })).optional().describe("Extended checks that the evaluator deferred to delivery"),
})

export type DeliveryVerdictType = z.infer<typeof DeliveryVerdict>

// ---------------------------------------------------------------------------
// DeliveryAgent
// ---------------------------------------------------------------------------

type VerifyInput = {
  task: { id?: string; title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
  goals: GoalInfo[]
  delivery: DeliveryInfo
  checkResults?: Array<{ name: string; status: string; evidence?: string }>
  analysis?: GoalJudgmentType
  /** Visual-reference attachments (already materialized under the attachment store).
   *  When provided, the delivery agent receives the image bytes as a multimodal
   *  `file` content part so it can actually see the target — text-only read_file
   *  on a PNG returns UTF-8 garbage and is not a substitute. */
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
  stream?: TextHooks
  signal?: AbortSignal
}

export namespace DeliveryAgent {
  export async function verify(input: VerifyInput): Promise<DeliveryVerdictType> {
    // Per-agent model override: if config sets agent.delivery.model, honor it;
    // otherwise inherit the user's most recent in-session model pick from the
    // task session; otherwise fall through to Provider.defaultModel().
    const model = await resolveAgentModel("delivery", { sessionID: input.task.sessionID })
    const deliveryCfg = (await EngineConfig.get()).delivery

    const guard = toolGuard(createDeliveryTools({ sessionID: input.task.sessionID, taskID: input.task.id }))
    const context = prefetchDeliveryContext(input)
    const textPrompt = buildUserPrompt({ ...input, attachments: input.attachments }, context)
    const userPrompt = await buildMultimodalPrompt(textPrompt, input.attachments)
    const systemPrompt = await deliveryAgentSystem()

    log.info("delivery agent starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      model: model.id,
      config: deliveryCfg,
    })

    // Stream hooks the caller (DeliveryService) supplied — tunneled through
    // AgentRuntime so the same chunk/step callbacks reach this run.
    // AgentRuntime already owns progress-guard wiring (alive/progress/absolute
    // tiers) and signal composition, so we no longer construct an
    // AbortSignal.timeout here.
    const passthroughHooks = {
      onChunk: input.stream?.onChunk,
      onError: input.stream?.onError,
      flush: async () => {},
      failures: { snapshot: () => ({ count: 0, items: [] as any[] }) },
    } as any

    const externalSignal = input.signal
    const abortSignals: AbortSignal[] = [guard.signal]
    if (externalSignal) abortSignals.push(externalSignal)

    const MAX_RETRIES = deliveryCfg.max_retries
    let parsed: DeliveryVerdictType | undefined
    let lastError: Error | undefined
    let toolCallCount = 0

    // Retry loop here covers OUTPUT-PARSE failures (the agent ran, returned
    // text, but the structured verdict wasn't extractable). Stream-level
    // failures and timeouts are handled by AgentRuntime's failure tracker
    // and progress guard — we propagate them as thrown errors and only retry
    // the parse path.
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        if (externalSignal?.aborted) break
        log.info("delivery agent retrying", { attempt, reason: lastError?.message })
      }

      let runResult: Awaited<ReturnType<typeof AgentRuntime.run>>
      try {
        runResult = await AgentRuntime.run({
          agent: "delivery",
          model,
          system: systemPrompt,
          messages: [{ role: "user" as const, content: userPrompt }],
          tools: guard.tools,
          stopWhen: stepCountIs(deliveryCfg.max_steps),
          cacheKey: `task-${input.task.id}-delivery`,
          sessionID: input.task.sessionID ?? "",
          taskID: input.task.id,
          stage: "delivery",
          signal: AbortSignal.any(abortSignals),
          onStepFinish: guard.onStepFinish,
          hooks: passthroughHooks,
          policies: {
            progressTimeoutMs: deliveryCfg.timeout_ms,
            failurePolicy: "collect",
          },
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const isAborted = externalSignal?.aborted || (err instanceof Error && err.name === "AbortError")
        log.warn("delivery agent run failed", { attempt, error: lastError.message, aborted: isAborted })
        if (isAborted && externalSignal?.aborted) break
        continue
      }

      toolCallCount = runResult.toolCallCount
      log.info("delivery agent finished", {
        attempt,
        steps: runResult.steps.length,
        toolCalls: toolCallCount,
        finishReason: runResult.finishReason,
        textLength: collectText(runResult).length,
        timeoutTier: runResult.timeout?.tier,
        streamFailures: runResult.failures.count,
      })

      try {
        const allText = collectText(runResult)
        if (!allText.trim()) {
          throw new Error("delivery agent produced no output")
        }
        parsed = extractVerdictText(allText)
      } catch (err) {
        lastError = new Error(`Delivery agent returned invalid output: ${err instanceof Error ? err.message : String(err)}`)
        log.warn("delivery: output extraction failed, will retry", {
          attempt,
          error: String(err),
          textLength: collectText(runResult).length,
        })
        continue
      }

      break
    }

    if (!parsed) {
      throw new Error(lastError?.message ?? "Delivery agent failed after retries")
    }

    log.info("delivery agent output", {
      verdict: parsed.verdict,
      issuesFound: parsed.issues_found.length,
      startupSuccess: parsed.startup_verification.success,
    })

    return parsed
  }
}

// ---------------------------------------------------------------------------
// Output extraction
// ---------------------------------------------------------------------------

function extractVerdictJSON(text: string): DeliveryVerdictType {
  let raw = extractRawJSON(text)
  raw = sanitizeJSON(raw)

  if (raw.startsWith("{") && !raw.endsWith("}")) {
    log.warn("delivery: JSON appears truncated, attempting repair", { length: raw.length, tail: raw.slice(-100) })
    raw = repairTruncatedJSON(raw)
  }

  let obj: any
  const parseErr = tryParseJSON(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParseJSON(trimmed)
    if (retryErr.ok) {
      log.warn("delivery: repaired truncated JSON by trimming", {
        originalLength: raw.length,
        trimmedLength: trimmed.length,
      })
      obj = retryErr.value
    } else {
      log.error("delivery: JSON parse failed after all repair attempts", {
        error: String(parseErr.error),
        rawLength: raw.length,
        rawHead: raw.slice(0, 500),
        rawTail: raw.slice(-300),
      })
      throw parseErr.error
    }
  }

  return normalizeVerdict(obj)
}

function extractVerdictText(text: string): DeliveryVerdictType {
  const raw = text.trim()
  if (!raw) throw new Error("delivery output empty")
  if (raw.startsWith("{") || raw.includes("```json")) return extractVerdictJSON(raw)

  const launchCmd = sectionBody(raw, ["Launch Command", "启动命令"]).trim().replace(/^`+|`+$/g, "").trim()
  return normalizeVerdict({
    verdict: sectionBody(raw, ["Verdict", "结论"]).split(/\r?\n/)[0]?.trim().toLowerCase(),
    summary: sectionBody(raw, ["Summary", "摘要"]) || firstContentLine(raw),
    launch_command: launchCmd || undefined,
    startup_verification: parseStartupVerification(sectionBody(raw, ["Startup Verification", "启动验证"])),
    frontend_check: parseFrontendCheck(sectionBody(raw, ["Frontend Check", "前端检查"])),
    issues_found: parseIssuesFound(sectionBody(raw, ["Issues Found", "发现的问题"])),
  })
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeVerdict(input: unknown): DeliveryVerdictType {
  if (!input || typeof input !== "object") {
    throw new Error(`Delivery agent produced non-object output: ${typeof input}`)
  }
  const obj = { ...(input as Record<string, unknown>) }

  const rawVerdict = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : ""
  if (rawVerdict.includes("accepted")) obj.verdict = "accepted"
  else if (rawVerdict.includes("rejected")) obj.verdict = "rejected"
  else throw new Error(`Delivery agent produced unrecognizable verdict: "${rawVerdict}"`)

  if (!obj.summary || typeof obj.summary !== "string") {
    throw new Error("Delivery agent produced no summary")
  }

  // launch_command is optional — strip if empty
  if (typeof obj.launch_command === "string") {
    obj.launch_command = obj.launch_command.trim().replace(/^`+|`+$/g, "").trim() || undefined
  }

  if (!obj.startup_verification || typeof obj.startup_verification !== "object") {
    throw new Error("Delivery agent produced no startup_verification section")
  }
  const sv = obj.startup_verification as Record<string, unknown>
  if (typeof sv.attempted !== "boolean") sv.attempted = false
  if (typeof sv.success !== "boolean") sv.success = false

  if (!obj.frontend_check || typeof obj.frontend_check !== "object") {
    throw new Error("Delivery agent produced no frontend_check section")
  }
  const fc = obj.frontend_check as Record<string, unknown>
  if (typeof fc.attempted !== "boolean") fc.attempted = false

  if (!Array.isArray(obj.issues_found)) obj.issues_found = []
  obj.issues_found = (obj.issues_found as unknown[]).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  )

  return DeliveryVerdict.parse(obj)
}

// ---------------------------------------------------------------------------
// Markdown section parsers
// ---------------------------------------------------------------------------

function parseRecordLines(lines: string[]) {
  const record: Record<string, string> = {}
  for (const line of lines) {
    const value = line.trim().replace(/^[-*\u2022]\s+/, "")
    const match = value.match(/^([a-zA-Z_ ]+|尝试|命令|成功|输出|渲染正常|问题)[:：]\s*(.+)$/)
    if (!match) continue
    record[match[1].trim().toLowerCase()] = match[2].trim()
  }
  return record
}

function parseStartupVerification(text: string) {
  if (!text.trim()) return { attempted: false, success: false }
  const record = parseRecordLines(text.split(/\r?\n/))
  return {
    attempted: (record["attempted"] || record["尝试"] || "false").toLowerCase() === "true",
    command: record["command"] || record["命令"],
    success: (record["success"] || record["成功"] || "false").toLowerCase() === "true",
    output: record["output"] || record["输出"],
  }
}

function parseFrontendCheck(text: string) {
  if (!text.trim()) return { attempted: false }
  const record = parseRecordLines(text.split(/\r?\n/))
  const issues = (record["issues"] || record["问题"] || "")
    .split(/[;\n,，；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return {
    attempted: (record["attempted"] || record["尝试"] || "false").toLowerCase() === "true",
    renders_correctly: record["renders_correctly"] || record["渲染正常"]
      ? (record["renders_correctly"] || record["渲染正常"] || "false").toLowerCase() === "true"
      : undefined,
    issues: issues.length > 0 ? issues : undefined,
  }
}

function parseIssuesFound(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*\u2022]\s+/, "").replace(/^\d+[.)\u3001]\s+/, ""))
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Pre-fetch context
// ---------------------------------------------------------------------------

function prefetchDeliveryContext(input: {
  task: { title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
  delivery: DeliveryInfo
}): string {
  const sections: string[] = []

  try {
    const projectId = Instance.project.id
    const query = `delivery startup runtime ${input.task.title}`
    const recalled = Memory.promptSection({
      query,
      projectId,
      sessionID: input.task.sessionID,
      scope: "all",
      limit: 3,
      minScore: 0.15,
      heading: "Historical Context (Auto-Recalled)",
      includeEpisodes: true,
    })
    if (recalled) sections.push(recalled)
  } catch (err) {
    log.warn("delivery: memory prefetch failed", { error: err instanceof Error ? err.message : String(err) })
  }

  return sections.length > 0 ? sections.join("\n\n") : ""
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Merge the text prompt with any visual-reference attachments into the
 * multimodal user content the LLM expects. Falls back to the plain string
 * when there are no image attachments so non-vision stages are unchanged.
 */
async function buildMultimodalPrompt(
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
): Promise<string | Array<{ type: "text"; text: string } | { type: "file"; data: Buffer; mediaType: string; filename?: string }>> {
  if (!attachments?.length) return text
  // Mirror orchestrator / requirements / design-analyst routing: only inline
  // MIMEs the provider actually accepts as multimodal (image / audio / video
  // / PDF). The previous image-only filter dropped PDFs that delivery agents
  // legitimately need to inspect.
  const inlineable = attachments.filter((a) => AttachmentStore.isMultimodalSupported(typeof a.mime === "string" ? a.mime : ""))
  if (inlineable.length === 0) return text
  const parts: Array<{ type: "text"; text: string } | { type: "file"; data: Buffer; mediaType: string; filename?: string }> = [
    { type: "text", text },
  ]
  for (const a of inlineable) {
    const located = AttachmentStore.nameFromUrl(a.url)
    if (!located) {
      log.warn("delivery: attachment url did not resolve", { url: a.url, filename: a.filename })
      continue
    }
    try {
      const bytes = await AttachmentStore.read(located.projectID, located.name)
      parts.push({
        type: "file",
        data: bytes,
        mediaType: a.mime,
        ...(a.filename ? { filename: a.filename } : {}),
      })
    } catch (err) {
      log.warn("delivery: attachment read failed", { url: a.url, filename: a.filename, err: String(err) })
    }
  }
  return parts.length > 1 ? parts : text
}

function buildUserPrompt(
  input: {
    task: { title: string; request: string; metadata?: Record<string, unknown> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults?: Array<{ name: string; status: string; evidence?: string }>
    analysis?: GoalJudgmentType
    attachments?: Array<{ sha: string; mime: string; filename?: string }>
  },
  context?: string,
): string {
  const sections: string[] = []

  sections.push(
    `# Task\n\nTitle: ${input.task.title}\n\nRequest:\n${input.task.request}`,
  )

  // Inline hint: when the user message carries image attachments (attached
  // as file parts alongside this text), steer the model to reason over them
  // visually instead of trying to read_file on the binary path.
  const images = (input.attachments ?? []).filter((a) => typeof a?.mime === "string" && a.mime.startsWith("image/"))
  if (images.length > 0) {
    const list = images.map((a) => `- ${a.filename ?? a.sha} (${a.mime})`).join("\n")
    sections.push(
      `# Visual Reference\n\n` +
      `The target design is attached to this message as image content (not as a project file).\n\n` +
      `**You MUST perform visual comparison yourself.** Follow these steps:\n` +
      `1. The reference image is attached above — study it carefully (layout, colors, spacing, typography, component structure).\n` +
      `2. Use \`read_file\` on \`.opencorvus/visual-diff/rendered.png\` to see the actual rendered screenshot. ` +
      `The read tool handles images correctly and returns them as visual content — do NOT skip this step.\n` +
      `3. Compare the two images visually. Identify EVERY concrete difference:\n` +
      `   - Layout mismatches (element positions, alignment, proportions)\n` +
      `   - Color differences (background, text, progress bars, borders)\n` +
      `   - Typography issues (font size, weight, family, line-height)\n` +
      `   - Spacing/padding errors (margins between sections, inner padding)\n` +
      `   - Missing or extra elements\n` +
      `   - Interaction elements (buttons, toggles, links) that look wrong\n` +
      `4. If visual_diff failed in query_criteria, you MUST reject with specific visual feedback — ` +
      `listing each difference so the executor knows exactly what to fix. ` +
      `A generic "visual diff failed" is NOT acceptable feedback.\n` +
      `5. The SSIM score from query_criteria is a supporting metric, not a substitute for your visual judgment.\n\n` +
      `Attached reference images:\n${list}`,
    )
  }

  // Core check results — delivery agent must fix failures before proceeding
  if (input.checkResults && input.checkResults.length > 0) {
    const failed = input.checkResults.filter((c) => c.status === "failed")
    const lines = input.checkResults.map((c) => {
      const icon = c.status === "passed" ? "PASSED" : "FAILED"
      const evidence = c.evidence && c.status === "failed" ? `\n  \`\`\`\n  ${c.evidence.slice(0, 4000)}\n  \`\`\`` : ""
      return `- ${c.name}: ${icon}${evidence}`
    })
    if (failed.length > 0) {
      sections.push(
        `# Core Check Results\n\n` +
        `**${failed.length} check(s) FAILED.** You MUST fix these before proceeding to extended verification.\n\n` +
        lines.join("\n"),
      )
    } else {
      sections.push(
        `# Core Check Results\n\nAll core checks passed.\n\n` + lines.join("\n"),
      )
    }
  }

  // Operator notes — user messages sent during task execution
  const taskID = input.task.metadata?.taskID as string | undefined
  if (taskID) {
    const clarifications = clarificationTranscriptSection(taskID)
    if (clarifications) sections.push(clarifications)
    const notes = operatorNotesSection(taskID)
    if (notes) sections.push(notes)
  }

  sections.push(
    `# Goals — Acceptance Criteria (MANDATORY: verify each one)\n\n` +
    `You MUST check every goal's acceptance criteria explicitly. For each goal, produce a PASS or FAIL verdict with evidence.\n\n` +
      input.goals
        .map(
          (g, i) =>
            `## Goal ${i + 1}: ${g.description}\n\n**Acceptance Criteria:**\n${g.criteria}\n\nPriority: ${g.priority}`,
        )
        .join("\n\n---\n\n"),
  )

  // Cap the changed-files list so a wide refactor (hundreds of touched files)
  // does not flood the prompt. The diff section below already shows up to 8
  // representative files; the full path list is reference material, not the
  // signal delivery reasons over.
  const CHANGED_FILES_PROMPT_CAP = 80
  const filesShown = input.delivery.changedFiles.slice(0, CHANGED_FILES_PROMPT_CAP)
  const filesOmitted = input.delivery.changedFiles.length - filesShown.length
  const filesHeader = filesOmitted > 0
    ? `Changed files (${input.delivery.changedFiles.length} total; first ${filesShown.length} listed, ${filesOmitted} omitted):`
    : `Changed files (${input.delivery.changedFiles.length}):`
  sections.push(
    `# Delivery\n\nSummary: ${input.delivery.summary}\n\n${filesHeader}\n` +
      filesShown.map((f) => `- ${f}`).join("\n"),
  )

  if (input.delivery.diffs && input.delivery.diffs.length > 0) {
    const diffText = input.delivery.diffs
      .filter((d) => d.diff)
      .slice(0, 8)
      .map((d) => `--- ${d.file} ---\n${truncate(d.diff!, 1200)}`)
      .join("\n\n")
    if (diffText) {
      sections.push(`# Code Diffs (up to 8 files)\n\n${diffText}`)
    }
  }

  if (input.analysis) {
    sections.push(
      `# Prior Analysis\n\n` +
        `Verdict: ${input.analysis.verdict}\n` +
        `Classification: ${input.analysis.classification}\n` +
        `Summary: ${input.analysis.summary}\n\n` +
        `Goal statuses:\n` +
        input.analysis.goal_statuses
          .map((g) => `- Goal ${g.goal_index}: ${g.status} — ${g.evidence}`)
          .join("\n"),
    )
  }

  if (context) {
    sections.push(`# Pre-fetched Context\n\n${context}`)
  }

  sections.push(
    "IMPORTANT: You MUST verify the application works end-to-end.\n" +
      "1. Find the entry point (e.g., src/app.ts, src/index.ts, main.ts, package.json scripts)\n" +
      "2. Run build/compile if needed\n" +
      "3. Start the application with a short timeout to verify it doesn't crash\n" +
      "4. If it crashes, investigate and fix the issue\n" +
      "5. Re-verify after any fix\n" +
      "6. Produce your final verdict",
  )

  // Step budget is finite — the agent is cut off after `delivery.max_steps`
  // tool calls. Without an explicit final-emission rule it can spend every
  // step on rework and never write the structured verdict, which makes the
  // whole stage fail extraction. Reserve the last step for the verdict.
  sections.push(
    "## Final Output (REQUIRED)\n\n" +
    "Before you stop, you MUST emit the verdict in the structured format the " +
    "extractor expects. Use these exact section headers (Markdown), in order:\n\n" +
    "### Verdict\n" +
    "accepted\n" +
    "(or: rejected)\n\n" +
    "### Summary\n" +
    "<one paragraph: what works, what's left>\n\n" +
    "### Launch Command\n" +
    "`<the verified start command, e.g. bun dev>`\n\n" +
    "### Startup Verification\n" +
    "- attempted: true|false\n" +
    "- success: true|false\n" +
    "- output: <relevant log excerpt>\n\n" +
    "### Frontend Check\n" +
    "- attempted: true|false\n" +
    "- renders_correctly: true|false\n" +
    "- issues: <bullet list or 'none'>\n\n" +
    "### Issues Found\n" +
    "- <bullet list, or write 'none'>\n\n" +
    "Do NOT skip any header. Do NOT wrap the verdict in JSON unless you " +
    "have already finished all rework — plain Markdown sections are fine.",
  )

  return sections.join("\n\n")
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "\n... (truncated)"
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const DELIVERY_AGENT_SYSTEM = `You are an ADVERSARIAL EVALUATOR for OpenCorvus — the counterpart to the assistant and executor agents. Your role is to challenge deliverables, not rubber-stamp them. The deterministic Evaluator has already run before you (build/test/lint/spec heuristics declared in each goal's acceptance_specs); its results are pre-loaded into "Core Check Results" in your prompt. Your job picks up where deterministic checks stop:
1. Read Core Check Results — confront every failed deterministic check
2. Verify each goal's acceptance criteria — including parts the evaluator could not run deterministically (rubrics, semantic checks)
3. Start and test the application end-to-end (deterministic checks pass ≠ the app actually runs)
4. Evaluate BEYOND stated acceptance criteria — find issues the spec didn't anticipate
5. Fix issues you find (you have write_file and edit_file)
6. Re-verify after fixing
7. Make the final acceptance decision

## Adversarial Stance

Rejection is the DEFAULT. The deliverable must EARN acceptance through evidence. Evaluate beyond the stated acceptance criteria:

1. **Stated criteria** (minimum bar): Every goal's acceptance_specs must be satisfied.
2. **Implicit quality**: Code that passes stated criteria but is fragile, has race conditions, leaks resources, or has obvious UX problems MUST be rejected.
3. **Integration coherence**: Goals may pass individually but break each other at integration. Test the system as a whole, not goal-by-goal in isolation.
4. **Edge cases**: Test with empty inputs, boundary values, concurrent operations, missing configs. The executor only tested the happy path — you test the unhappy path.
5. **Production readiness**: Would you deploy this to production and stake your reputation on it? If not, reject with specific reasons.

Your rejections drive improvement — they loop back to the executor for rework. Each rejection MUST include:
- Specific, actionable rejection_details with category, file, error, and suggestion
- Evidence from actual tool output (not assumptions)
- Clear distinction between "I can fix this myself" (use write_file/edit_file) vs "this needs executor rework" (reject)

When criteria_results show prior delivery rejections (rework iteration > 1), RAISE THE BAR: the executor had your feedback and should have addressed every cited issue. If the same issue persists after a rework cycle, escalate its severity.

Do NOT re-run build/test/lint commands the Evaluator already ran — the results are above. Re-run only when (a) you applied a fix and need to confirm, or (b) the Core Check Results show no entry for a check you believe must exist.

## Available Tools

### Exploration
- **read_file**, **find_files**, **search_code**, **list_directory**: Inspect codebase

### Quality criteria
- **query_criteria**: Read every quality criterion already recorded for this task — per-goal evaluator outcomes (build / test / lint / visual_diff), prior delivery checks, external quality gates. ALWAYS call this BEFORE deciding the verdict.

### Rework (use when you find fixable issues)
- **write_file**: Write or overwrite a file
- **edit_file**: Surgical string replacement in a file

### Execution
- **run_command**: Build, start server, run tests, curl endpoints

### Follow-up pipeline
- **submit_next_task**: Spawn any follow-up task in the same project. Three shapes to pick between:
  1. **Fix** — verification surfaced failed criteria the executor needs to repair. Pass \`priority="critical"\` + \`failed_criteria\` so the next task jumps the queue and inherits the evidence.
  2. **Iterate** — the delivered work is solid but opens an obvious next step (next milestone, hardening pass, follow-up feature). Pass \`priority="normal"\` (or "high" if time-sensitive).
  3. **Recommend** — something the user should probably do next but does not block acceptance. Pass \`priority="low"\` so it queues without competing with live work.
  Every new task links back via \`metadata.parent_task\` and the orchestrator sees a "Follow-up Context" section in its next prompt.

### Context
- **memory_search**: Search past delivery issues
- **memory_write**: Persist findings for future deliveries

## Process

### Phase 1: READ CORE CHECK RESULTS
The Evaluator already ran the deterministic part. Look at the "Core Check Results" section of your prompt:
1. For each FAILED check — open the cited evidence, decide whether you can fix it (small targeted patch) or whether it needs a full executor re-run (call submit_next_task with priority="critical" + failed_criteria)
2. For PASSED checks — accept them, do NOT re-run the same commands
3. If a check you believe should exist is missing entirely (e.g. project has tests but no test entry), run it once with run_command and record it under deferred_checks (the evaluator did not detect it; this is gap coverage, not duplication)
4. **visual_diff failed** — this is a STRICT check. You MUST read_file on \`.opencorvus/visual-diff/rendered.png\` to see the rendered output, visually compare it against the attached reference image, and list every concrete difference in your rejection. Do NOT accept when visual_diff is failed.

### Phase 2: PER-GOAL CRITERIA VERIFICATION (rubric / semantic)
For EACH goal in the goals list below, evaluator covered the heuristic-shaped (executable command) part of its acceptance_specs. You handle the rest:
1. Read the goal's acceptance criteria carefully
2. Identify rubric / semantic items the evaluator could not run (e.g. "the README explains X", "API matches the documented contract") — judge these with read_file + reasoning
3. Record: PASS or FAIL with specific evidence for each criterion item

### Phase 3: RUNTIME VERIFICATION
1. Find entry point (package.json scripts, src/app.ts, framework config)
2. Install deps if needed
3. Start application with short timeout — verify clean startup
4. For web apps: check HTTP response, frontend assets
5. For libraries: verify compile + tests pass

### Phase 3.5: END-TO-END TEST AUTHORING
You are responsible for authoring (or extending) an end-to-end test that
exercises the main flow of what was just delivered. Reading code and
"looking right" is not enough — write a test that any future delivery
re-run can replay.

1. Look for existing e2e tests in the project (\`e2e/\`, \`tests/e2e/\`,
   \`*.e2e.test.*\`, \`playwright.config.*\`, \`puppeteer\` deps). If they
   exist, extend them; if not, create a minimal one in a sensible location
   (\`tests/e2e/main-flow.test.ts\` or the project's existing test dir).
2. Pick the right tool for the project:
   - Web frontends → puppeteer-core (preferred — already in opencorvus
     dependency tree) or playwright if the project already uses it.
   - HTTP services → \`fetch()\` against the running server with bun:test
     or the project's test runner.
   - CLIs / libraries → exercise the public API or the binary via
     \`Shell.run\` equivalent in the project's test framework.
3. The test must cover the **happy path** of every newly delivered goal.
   For visual tasks, also assert that the page renders (no JS errors,
   key DOM nodes present).
4. Run the test with run_command. The test must pass before you set
   verdict=accepted. If it fails:
   - Fix the test if it's wrong about the contract.
   - Fix the implementation (write_file / edit_file) if the test caught
     a real bug.
   - Re-run until green or, if the issue requires executor-level rework,
     call submit_next_task with priority="critical" and failed_criteria so
     the failing test output is attached as evidence.
5. Record the e2e test path and last-run result in Phase 7's verdict.

### Phase 4: EXTENDED CHECKS
1. **Code review**: Read changed files, check for obvious bugs, bad patterns, security issues
2. **Dead code**: Check if any imports or functions became unused
3. **Style/conventions**: Check against project conventions

### Phase 5: FIX AND RE-VERIFY
If you find issues in Phase 1-4 that you can fix:
1. Use write_file or edit_file to apply the fix (minimal targeted changes only)
2. Re-run the relevant check to verify the fix worked
3. Repeat until the check passes, or conclude the issue requires a full executor re-run

### Phase 6: PERSIST
Write runtime failure patterns and verification insights to memory.

### Phase 7: VERDICT
Output your decision as plain markdown with these sections:

- \`# Verdict\` — accepted or rejected
- \`# Summary\` — 1-3 sentences
- \`# Goal Criteria Results\` — per-goal list: goal title, acceptance criteria, result (PASS/FAIL), evidence
- \`# Launch Command\` — the exact command used to successfully start the application (e.g. \`bun run start\`, \`node dist/index.js\`). REQUIRED when startup_verification.success is true. This command will be used to auto-launch the deliverable after publish — make it runnable from the project root with no extra arguments.
- \`# Startup Verification\` — attempted, command, success, output
- \`# Frontend Check\` — attempted, renders_correctly, issues
- \`# Issues Found\` — all issues discovered (empty if none)
- \`# Fixes Applied\` — list of fixes you applied during verification (empty if none)
- \`# Rejection Details\` — (required when rejecting) structured list: category (build/test/lint/runtime/quality/startup/criteria), file (if applicable), error description. Only include issues that remain after your fix attempts.
- \`# Deferred Checks\` — extended checks results: name, result (passed/failed/skipped), evidence

### Verdict Meanings
- **accepted**: All goal criteria satisfied AND implicit quality, integration coherence, edge cases, and production readiness checks pass. You would stake your reputation on this code working in production.
- **rejected**: Issues remain that require executor-level rework (not fixable by delivery agent). Rejection loops back to the executor with your structured feedback — be specific so the rework is targeted.

## Rules
- ALWAYS call query_criteria first — it shows every check already recorded for this task (Evaluator's deterministic outcomes including build/test/lint/visual_diff, prior delivery work). Do NOT duplicate work that already passed; do confront every failed criterion before deciding.
- Do NOT re-run build/test/lint commands the Evaluator already ran. Trust their outcome; re-run only after applying a fix to confirm it landed.
- ALWAYS verify each goal's acceptance criteria explicitly — for the rubric/semantic parts the Evaluator could not run deterministically — this is mandatory, not optional
- ALWAYS start the application to verify runtime behavior — reading code alone is NOT sufficient (Evaluator does not start the app)
- ALWAYS author or extend an end-to-end test that replays the main flow (Phase 3.5). The verdict cannot be accepted without a passing e2e run captured by run_command.
- Every claim must be backed by actual tool output
- Fix issues when you can (write_file, edit_file) — reject when the issue requires executor-level rework. Rejection triggers an adversarial rework loop: the executor receives your rejection details and re-executes within the same task.
- Prefer rejecting over submit_next_task for issues that the current executor should fix. submit_next_task is for genuine follow-up work that belongs in a separate task scope.
- When rejecting, list ALL issues that remain after your fix attempts — every rejection_detail becomes guidance for the executor's rework iteration
- After accepting, if the delivered work obviously sets up an important next step, call submit_next_task with priority="normal"/"high" (iteration) or "low" (recommendation) so the project keeps moving instead of stalling at the user
- Write body text in the same language as the task request
- If the project is a library, verify compile + tests instead of startup`

/** Config-aware resolver: checks config.prompt.delivery_system first, then config.agent.delivery.prompt, otherwise the default + skills. */
export async function deliveryAgentSystem() {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.delivery_system === "string") return systemOverride.delivery_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.delivery?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : DELIVERY_AGENT_SYSTEM
  const orchCfg = await EngineConfig.get()
  const skills = await loadStageSkills(orchCfg.delivery.skills, "delivery")
  return core + skills
}
