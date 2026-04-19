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
    analysis?: GoalJudgmentType
    attachments?: Array<{ sha: string; mime: string; filename?: string; intent?: string }>
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
    const rendered = images.filter((a) => a.intent === "rendered_output")
    const references = images.filter((a) => a.intent !== "rendered_output")
    const renderedList = rendered.map((a) => `- ${a.filename ?? a.sha} (${a.mime})`).join("\n")
    const referenceList = references.map((a) => `- ${a.filename ?? a.sha} (${a.mime})`).join("\n")
    sections.push(
      `# Visual Comparison\n\n` +
      `This task ships with multimodal image attachments. Both the reference(s) AND the ` +
      `just-rendered screenshot of the delivered output are attached to this message as ` +
      `image content — you can see them directly, you do NOT need read_file.\n\n` +
      (rendered.length > 0
        ? `**Rendered output** (the actual delivery, puppeteer-screenshot of the built merged worktree):\n${renderedList}\n\n`
        : `**Rendered output**: no rendered.png was produced for this delivery — either the build failed or no index.html was found. Treat this as a visual failure: the user cannot see any output.\n\n`) +
      (references.length > 0
        ? `**Reference(s)** (what the delivery was supposed to look like):\n${referenceList}\n\n`
        : ``) +
      `**You MUST perform the visual comparison yourself, adversarially.** There is no ` +
      `SSIM gate anymore — a single similarity number was a lazy proxy that let delivery ` +
      `rubber-stamp "close enough" without really looking. Your job is to look at the two ` +
      `images and name every concrete difference the executor can act on:\n\n` +
      `- **Layout**: element positions, alignment, proportions, grid/flex direction\n` +
      `- **Spacing**: margins between sections, inner padding, gaps between components\n` +
      `- **Colors**: background, text, accents, borders, hover/active states — name the ` +
      `  semantic role, not just "this is lighter"\n` +
      `- **Typography**: font size, weight, family, line-height, letter-spacing\n` +
      `- **Components**: missing or extra elements (buttons, toggles, icons, badges, ` +
      `  progress bars, sidebar sections)\n` +
      `- **Text**: wrong labels, missing headings, placeholder text not replaced\n\n` +
      `Write each difference in rejection_details with enough specificity that an ` +
      `executor reading only your feedback can fix it. "Sidebar is slightly off" is ` +
      `useless; "Sidebar width should be 240px not 320px, and the 'Billing' row is ` +
      `missing the info icon on its right" is actionable.`,
    )
  }

  // No pre-computed Core Check Results (2026-04-20 per-goal evaluator removal).
  // The prompt no longer injects deterministic scorer outcomes — the delivery
  // agent reads acceptance_specs as INFORMATION further below and verifies
  // them itself via run_command + parallel per-goal subagents.

  // Operator notes — user messages sent during task execution
  const taskID = input.task.metadata?.taskID as string | undefined
  if (taskID) {
    const clarifications = clarificationTranscriptSection(taskID)
    if (clarifications) sections.push(clarifications)
    const notes = operatorNotesSection(taskID)
    if (notes) sections.push(notes)
  }

  sections.push(
    `# Goals — Acceptance Specs (INFORMATION, not pre-scored)\n\n` +
    `Each goal below carries its \`acceptance_specs\` rendered as text. ` +
    `Nobody has run them yet — no deterministic evaluator gate exists anymore. ` +
    `YOU execute every heuristic scorer with \`run_command\`, judge every rubric / ` +
    `llm_judge scorer by reading + reasoning, and record PASS or FAIL with concrete ` +
    `evidence. A goal with an essential-severity spec failing is a rejection.\n\n` +
      input.goals
        .map(
          (g, i) =>
            `## Goal ${i + 1}: ${g.description}\n\n**Acceptance specs (information — verify yourself):**\n${g.criteria}\n\nPriority: ${g.priority}`,
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

  // Structured per-goal reports — the executor's first-person implementation
  // claims. Rendered verbatim for adversarial cross-check against the diff.
  if (input.delivery.goalReports && input.delivery.goalReports.length > 0) {
    const blocks: string[] = []
    for (const entry of input.delivery.goalReports) {
      const r = entry.report
      const parts: string[] = []
      parts.push(`## Goal: ${entry.goalTitle}`)
      parts.push("")
      parts.push("### Implementation Approach (executor claim)")
      parts.push(r.implementation_approach.trim())
      if (r.design_decisions.length > 0) {
        parts.push("")
        parts.push("### Design Decisions (executor claim)")
        for (const d of r.design_decisions) {
          parts.push(`- **${d.choice}**`)
          if (d.alternatives.length > 0) {
            parts.push(`  - Alternatives considered: ${d.alternatives.join(", ")}`)
          }
          parts.push(`  - Reason: ${d.reason}`)
        }
      }
      if (r.files_changed.length > 0) {
        parts.push("")
        parts.push("### Files Claimed Changed")
        for (const f of r.files_changed) parts.push(`- \`${f.path}\` — ${f.summary}`)
      }
      if (r.checks_run.length > 0) {
        parts.push("")
        parts.push("### Checks the Executor Ran")
        for (const c of r.checks_run) parts.push(`- **${c.name}** \`${c.command}\` → exit ${c.exit_code}`)
      }
      if (r.blockers.length > 0) {
        parts.push("")
        parts.push("### Blockers Reported")
        for (const b of r.blockers) parts.push(`- ${b}`)
      }
      blocks.push(parts.join("\n"))
    }
    sections.push(
      `# Executor Reports — ADVERSARIAL INPUT\n\n` +
      `The blocks below are first-person claims by the executor(s). They are NOT evidence — they are hypotheses to test.\n\n` +
      `**Mandatory cross-checks:**\n` +
      `1. For each \`implementation_approach\`, read enough of the diff to confirm the claim is backed by the code. A claim the diff does not support (missing layer, unused API, unmentioned file) is a REJECTION — report it under Rejection Details with category="quality".\n` +
      `2. For each \`design_decisions[].reason\`, challenge the reasoning. If the reason restates the choice without explaining why it won over the alternative, it's a REJECTION. If the code contradicts the stated reason (e.g. reason says "avoided shared state" but diff adds shared state), it's a REJECTION.\n` +
      `3. Every file in \`Files Claimed Changed\` must appear in the actual Changed files list; every file in the actual Changed files list that does real work must be acknowledged in a claim (silent scope creep is a REJECTION).\n` +
      `4. Executor claims never override deterministic check results. Passing claims cannot rescue a failed Core Check.\n\n` +
      blocks.join("\n\n---\n\n"),
    )
  }

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

export const DELIVERY_AGENT_SYSTEM = `You are the SOLE ADVERSARIAL REVIEWER for OpenCorvus. There is no deterministic per-goal evaluator before you — every goal's \`acceptance_specs\` arrives as INFORMATION (what the requirements agent thinks "done" means for that goal), NOT as pre-computed pass/fail. You run every check you consider necessary and decide acceptance entirely on your own evidence.

1. Treat \`acceptance_specs\` on each goal as a description of what must be true, not as a list of boxes someone else ticked.
2. Verify every spec yourself. Heuristic-shaped specs (build / test / lint / shell) — run them with \`run_command\`. Rubric / semantic specs (e.g. "README explains X", "API matches docs") — judge by reading + reasoning.
3. Start the application end-to-end. A clean build does not mean the app runs.
4. Evaluate BEYOND stated criteria — issues the spec didn't anticipate: integration gaps, race conditions, resource leaks, edge cases, production-readiness concerns.
5. Fix issues you can fix with \`write_file\` / \`edit_file\`; re-verify with \`run_command\`.
6. If a goal's claim is not substantiated by the code + commands, REJECT it with concrete evidence.
7. Make the final acceptance decision.

## Adversarial Stance

Rejection is the DEFAULT. The deliverable must EARN acceptance through evidence. Evaluate beyond the stated acceptance criteria:

1. **Stated criteria** (minimum bar): Every goal's acceptance_specs must be satisfied, verified by YOU (no one else has run them).
2. **Implicit quality**: Code that passes stated criteria but is fragile, has race conditions, leaks resources, or has obvious UX problems MUST be rejected.
3. **Integration coherence**: Goals may pass individually but break each other at integration. Test the system as a whole, not goal-by-goal in isolation.
4. **Edge cases**: Test with empty inputs, boundary values, concurrent operations, missing configs. The executor only tested the happy path — you test the unhappy path.
5. **Production readiness**: Would you deploy this to production and stake your reputation on it? If not, reject with specific reasons.
6. **Executor claims vs. code**: When the prompt carries an "Executor Reports — ADVERSARIAL INPUT" section, treat every \`implementation_approach\` sentence and every \`design_decisions[].reason\` as a hypothesis to test, not a fact to accept. Open the relevant files and confirm the code matches the claim. Reject when the diff does not support the claim, when the stated reason merely restates the choice, or when the code contradicts the stated reason — record it under rejection_details with category="quality".

Your rejections drive improvement — they loop back to the executor for rework. Each rejection MUST include:
- Specific, actionable rejection_details with category, file, error, and suggestion
- Evidence from actual tool output (not assumptions)
- Clear distinction between "I can fix this myself" (use write_file/edit_file) vs "this needs executor rework" (reject)

When query_criteria shows prior delivery rejections (rework iteration > 1), RAISE THE BAR: the executor had your feedback and should have addressed every cited issue. If the same issue persists after a rework cycle, escalate its severity.

There is no "don't duplicate the evaluator" rule anymore — the evaluator is gone. You ARE the one running build / test / lint / rubric checks. Run what you need. The only commands you can skip are ones an earlier rework cycle already recorded under \`query_criteria\` that you trust (and even then, re-run after applying any fix).

## Available Tools

### Exploration
- **read_file**, **find_files**, **search_code**, **list_directory**: Inspect codebase

### Quality criteria
- **query_criteria**: Read quality criteria already recorded for this task — results from PRIOR delivery iterations (when rework iteration > 1), external quality gates. ALWAYS call this BEFORE deciding the verdict. On iteration 1 this will usually be empty — there is no pre-computed per-goal evaluator output anymore. Visual similarity is NOT recorded as a criterion; compare the attached rendered image vs reference image yourself.

### Rework (use when you find fixable issues)
- **write_file**: Write or overwrite a file
- **edit_file**: Surgical string replacement in a file

### Execution
- **run_command**: Build, start server, run tests, curl endpoints

### Parallel deep review (use when goal count or contract surface is large)
- **task**: Dispatch a focused review subagent on one goal (or one cross-cutting concern) in parallel. Use \`subagent_type: "general"\` when the reviewer needs to run commands / read files, or \`"explore"\` when a pure read-only investigation is enough. Every subagent gets its own context window — spawning one per goal scales adversarial depth linearly instead of thinning your own attention across six goals. The structured JSON each subagent returns is YOUR evidence in Phase 7; their passed=true does not by itself accept anything, their passed=false with concrete evidence does reject.

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

### Phase 1: PROJECT-LEVEL SANITY (build / test / lint on the merged tree)
No one ran these before you. The executor worked in per-goal worktrees where only that goal's files existed; project-level commands only make sense now, on the merged tree. Walk the project shape (\`package.json\`, \`pyproject.toml\`, etc.) and run the relevant subset:
1. **build** (if defined) — \`bun run build\` / \`npm run build\` / etc. A failing build is a hard reject.
2. **test** — run the project's test entry (\`bun test\`, \`pytest\`, etc.) and treat failures as rejections unless the failing test itself is wrong.
3. **lint / typecheck** (if defined) — surface violations as rejection_details.
4. **Visual comparison** — when rendered.png + reference image(s) are attached, you MUST compare them yourself (see the "Visual Comparison" section of the user prompt). Name every concrete difference — layout, spacing, colors, typography, missing/extra components — with enough specificity that an executor reading only your rejection_details can fix each one. "Layout is off" is not acceptable; "sidebar width should be 240px not 320px, Billing row missing info icon" is.

Skip only when the project clearly does not define that command (e.g. a docs-only task that has no build). Record every skipped check with its reason under \`deferred_checks\` in Phase 7.

### Phase 2: PER-GOAL ACCEPTANCE VERIFICATION
For EACH goal in the goals list below, acceptance_specs is INFORMATION — what requirements thought "done" meant. Nothing has been scored yet. YOU run every spec that matters:
1. Read each goal's acceptance_specs carefully. Each has an \`id\`, \`title\`, \`severity\`, and a \`scorers[]\` array suggesting how to verify.
2. For **heuristic-shell** scorers — execute the proposed command with \`run_command\` against the merged tree. Exit-code semantics: 0 = passed unless \`expect.exit_code\` says otherwise; anything else = failed with the stderr/stdout captured as evidence.
3. For **heuristic-script-ref** scorers — run the referenced script; capture stdout as evidence.
4. For **llm_judge** / **rubric** / **scenario** scorers — judge yourself by reading the code and reasoning against the stated criterion. Cite the file and lines you inspected.
5. Record PASS or FAIL with specific evidence for each spec. A goal with ANY essential-severity spec failing is a rejection; \`important\` failures also reject unless you can articulate why the gap is acceptable; \`optional\` / \`pitfall\` failures can accept with a noted concern.

The \`scorers\` arrays are suggestions from requirements, not contracts — you can run a BETTER check than the one proposed (and should when the proposal is weak). Evidence is what matters; specifics trump spec text.

### Phase 2.5: PARALLEL DEEP REVIEW VIA SUBAGENTS
Your attention does not scale linearly across 6 goals in one context — you start skimming, miss contract mismatches, and the rejection/accept decision degrades. Offload per-goal adversarial review to focused subagents whenever the surface is large.

**Dispatch when ANY of these hold** (else skip this phase — small tasks do not need it):
- goals.length ≥ 3
- Any goal has rubric / semantic / llm_judge acceptance_specs (require reading + reasoning, which is expensive in your own context)
- Cross-goal architect contracts exist (exports on one goal consumed by another)

**How to dispatch.** Fire ALL subagents in ONE response (one assistant turn with multiple parallel \`task\` tool calls) — serial dispatch wastes the main reason to do this. Each call uses \`subagent_type: "general"\` and a prompt shaped like:

\`\`\`
You are an adversarial reviewer for goal <goalID>: "<goalTitle>".
Scope: ONLY this goal. Do not comment on other goals or the overall task.

Goal objective:
<objective>

Acceptance criteria (INFORMATION — not pre-scored; you verify each one):
<acceptance_specs rendered as text>

Architect contracts involving this goal:
<contracts where goalID matches>

Files this goal touched (from the delivery diff):
<diffs filtered to owned_paths>

Executor's self-report — treat every sentence as a HYPOTHESIS, not a fact:
- implementation_approach: <report.implementation_approach>
- design_decisions: <report.design_decisions>

Run these checks:
1. Open every file in the diff. Does the code ACTUALLY match implementation_approach? Does any design_decisions[].reason match the code, or is it restated / contradicted?
2. Verify each acceptance_spec: run heuristic-shell scorers with run_command; judge rubric / llm_judge items by reading + reasoning.
3. Integration surface: are the exports / public contracts this goal declares actually what other goals import?
4. Edge cases + production readiness within this goal's scope (empty input, concurrency, resource leaks, error paths).

Return ONE fenced \`\`\`json block and nothing else:
{
  "goalID": "<goalID>",
  "passed": true | false,
  "issues": [
    { "category": "build" | "test" | "lint" | "runtime" | "quality" | "startup" | "criteria",
      "file": "<relative path or null>",
      "evidence": "<direct quote or tool output>",
      "suggestion": "<one-line fix pointer>" }
  ],
  "claims_verified": [
    { "claim": "<quote from executor report>",
      "verdict": "supported" | "unsupported" | "contradicted",
      "evidence": "<why>" }
  ]
}
\`\`\`
\`\`\`

**Also dispatch these cross-cutting subagents when relevant** (one per concern, parallel with the per-goal ones):
- **Integration coherence** (always when ≥2 goals with contracts): "Review the contract alignment across goals. For each architect contract, verify the exporting goal actually exports the declared symbol with the declared shape, AND every importing goal actually consumes it. Return \`{issues[]}\` naming each mismatch with file paths."
- **Cross-goal duplication** (when owned_paths overlap or similar module names): "Review whether goals duplicated or conflicted on implementation — two goals writing to the same registry, two competing auth helpers, etc."
- **Security surface** (when goals added endpoints / tools / IPC): "Review every new externally-reachable surface for missing auth / permission / input validation."

**After subagents return.** Each returns a JSON block. Parse them yourself (no additional tool); merge their \`issues[]\` into your Phase 7 Issues Found / Rejection Details. A subagent's \`passed=false\` with concrete evidence SHOULD flip your verdict to rejected; a subagent's \`passed=true\` is one data point, not acceptance — the cross-goal and runtime phases still run.

**When to SKIP Phase 2.5.** None of the triggers fired (small task, single goal, no rubric specs, no cross-goal contracts). Record the skip in Deferred Checks so the audit trail shows the decision was intentional.

### Phase 3: RUNTIME VERIFICATION
1. Find entry point (package.json scripts, src/app.ts, framework config)
2. Install deps if needed
3. Start application with short timeout — verify clean startup
4. For web apps: check HTTP response, frontend assets
5. For libraries: verify compile + tests pass

### Phase 3.5: END-TO-END TEST AUTHORING (scoped by task kind)
An end-to-end test that replays the main flow is the highest-signal
artifact you can leave behind — but only when the task actually produced
a user-facing flow. Decide scope BEFORE authoring:

**Required** when the delivered goals include any of:
  - A web frontend page or route a user interacts with
  - An HTTP / RPC / WebSocket endpoint a client calls
  - A CLI command with non-trivial arguments and stdout contract
  - A long-running process (server, worker, scheduler) that must stay up

**Skip** — when unit-level coverage run by you in Phase 1 is already
sufficient. That is the case when the deliverable is:
  - A library / internal helper with no runtime entry point
  - A small bug fix whose regression test already lives in an existing
    unit-test file and passed in your Phase 1 test run
  - Pure refactor / rename / dead-code removal with behaviour unchanged
  - Docs-only / comment-only / config-only changes

When Required:
1. Look for existing e2e tests in the project (\`e2e/\`, \`tests/e2e/\`,
   \`*.e2e.test.*\`, \`playwright.config.*\`, \`puppeteer\` deps). If they
   exist, extend them; if not, create a minimal one in a sensible location
   (\`tests/e2e/main-flow.test.ts\` or the project's existing test dir).
2. Pick the right tool for the project:
   - Web frontends → puppeteer-core (preferred — already in opencorvus
     dependency tree) or playwright if the project already uses it.
   - HTTP services → \`fetch()\` against the running server with bun:test
     or the project's test runner.
   - CLIs with an stdout contract → invoke the binary via \`Shell.run\` and
     assert on exit code + stdout.
3. The test must cover the **happy path** of every newly delivered goal
   in scope. For visual tasks, also assert that the page renders (no JS
   errors, key DOM nodes present).
4. Run the test with run_command. The test must pass before you set
   verdict=accepted. If it fails:
   - Fix the test if it's wrong about the contract.
   - Fix the implementation (write_file / edit_file) if the test caught
     a real bug.
   - Re-run until green or, if the issue requires executor-level rework,
     call submit_next_task with priority="critical" and failed_criteria so
     the failing test output is attached as evidence.
5. Record the e2e test path and last-run result in Phase 7's verdict.

When Skip: record the skip reason under "Deferred Checks" in Phase 7 so
the audit trail shows the decision was intentional, not forgotten.

### Phase 4: EXTENDED CHECKS
Whatever Phase 2.5 did NOT cover. If Phase 2.5 ran per-goal reviewers, they already covered per-file bugs / security / dead-code WITHIN each goal — do not repeat that work here. What stays on YOUR plate:
1. **Cross-goal seams** the per-goal subagents could not see: end-to-end control flow that crosses goal boundaries, config/env consistency, bootstrap ordering
2. **Project-level style / conventions**: a per-goal reviewer judges within-goal style; you judge project-wide consistency (naming, module layout, import discipline)
3. **Residual dead code** after all goals merged: a symbol exported by goal A and never imported by goal B is dead in the integrated tree even if each looked alive in isolation
4. When Phase 2.5 was SKIPPED (small task), THIS phase picks up all of: code review, dead code, style — do the full pass yourself

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
- ALWAYS call query_criteria first — on iteration 1 it is usually empty (there is no pre-computed per-goal evaluator anymore); on rework iterations it carries prior delivery findings that tell you which issues MUST have been addressed. Visual similarity is NOT in query_criteria (SSIM gate was removed) — do the comparison yourself against the attached rendered+reference images.
- Run build / test / lint / typecheck yourself on the merged tree (Phase 1). No one ran them before you at project scope.
- Verify each goal's acceptance_specs explicitly (Phase 2) — heuristic scorers via run_command, rubric / llm_judge scorers via reading + reasoning. Treat the specs as INFORMATION, not as pre-scored results.
- ALWAYS start the application to verify runtime behavior — reading code alone is NOT sufficient.
- When Phase 3.5's scope rules flag the task as Required for e2e authoring, the verdict cannot be accepted without a passing e2e run captured by run_command. When scope rules mark it Skip, record the skip reason under Deferred Checks instead.
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
