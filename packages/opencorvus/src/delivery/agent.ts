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
import { completeHeadlessText, resolveHeadlessLanguageModel } from "@/llm/headless"
import { createDeliveryTools } from "./tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import { Config } from "@/config/config"
import { OrchestratorConfig } from "@/orchestrator/config"
import { operatorNotesSection } from "@/orchestrator/helpers"
import { loadStageSkills } from "@/orchestrator/skill-inject"
import { collectText, countToolCalls, firstContentLine, sectionBody } from "@/util/agent-text"
import { AgentTrace } from "@/util/agent-trace"
import type { GoalJudgmentType, GoalInfo, DeliveryInfo } from "@/evaluator/agent"

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

// deliveryTimeoutMs 已迁移到 OrchestratorConfig.delivery.timeout_ms
// 环境变量 OPENCORVUS_DELIVERY_AGENT_TIMEOUT_MS 仍然生效（最高优先级）

type VerifyInput = {
  task: { title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
  goals: GoalInfo[]
  delivery: DeliveryInfo
  checkResults?: Array<{ name: string; status: string; evidence?: string }>
  analysis?: GoalJudgmentType
  stream?: TextHooks
  signal?: AbortSignal
}

export namespace DeliveryAgent {
  export async function verify(input: VerifyInput): Promise<DeliveryVerdictType> {
    const resolved = await resolveHeadlessLanguageModel({
      label: "delivery",
      metadata: input.task.metadata,
      sessionID: input.task.sessionID,
    })
    if (!resolved) throw new Error("Delivery verification model is unavailable")
    const { language, model } = resolved
    const deliveryCfg = (await OrchestratorConfig.get()).delivery

    const guard = toolGuard(createDeliveryTools({ sessionID: input.task.sessionID }))
    const context = prefetchDeliveryContext(input)
    const userPrompt = buildUserPrompt(input, context)

    log.info("delivery agent starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      model: language.modelId,
      config: deliveryCfg,
    })

    const MAX_RETRIES = deliveryCfg.max_retries
    let parsed: DeliveryVerdictType | undefined
    let lastError: Error | undefined
    let toolCallCount = 0

    // Combine the per-attempt timeout with any external abort signal (e.g. from the orchestrator)
    const externalSignal = input.signal
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Don't retry if the external abort signal has already fired — it would fail instantly
        if (externalSignal?.aborted) break
        log.info("delivery agent retrying", { attempt, reason: lastError?.message })
      }

      let result: {
        text?: string
        finishReason?: string
        steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>
      }
      const attemptSignal = externalSignal
        ? AbortSignal.any([externalSignal, AbortSignal.timeout(deliveryCfg.timeout_ms), guard.signal])
        : AbortSignal.any([AbortSignal.timeout(deliveryCfg.timeout_ms), guard.signal])
      try {
        result = await completeHeadlessText({
          label: "delivery",
          model,
          language,
          sessionID: input.task.sessionID,
          stopWhen: [stepCountIs(deliveryCfg.max_steps)],
          tools: guard.tools,
          maxOutputTokens: 16384,
          timeoutMs: false,
          abortSignal: attemptSignal,
          system: await deliveryAgentSystem(),
          prompt: userPrompt,
          ...(input.stream as TextHooks<typeof guard.tools> | undefined),
          onStepFinish: guard.onStepFinish as any,
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const isAborted = externalSignal?.aborted || (err instanceof Error && err.name === "AbortError")
        log.warn("delivery agent generateText failed", { attempt, error: lastError.message, aborted: isAborted })
        // If aborted externally, don't retry — signal is already dead
        if (isAborted && externalSignal?.aborted) break
        continue
      }

      toolCallCount = countToolCalls(result.steps)

      log.info("delivery agent finished", {
        attempt,
        steps: result.steps.length,
        toolCalls: toolCallCount,
        finishReason: result.finishReason,
        textLength: collectText(result).length,
      })

      {
        const deliverySystem = await deliveryAgentSystem()
        AgentTrace.capture("delivery", attempt + 1,
          { system: deliverySystem, messages: [{ role: "user", content: userPrompt }] },
          collectText(result),
          { toolCalls: toolCallCount, finishReason: result.finishReason },
        )
      }

      try {
        const allText = collectText(result)
        if (!allText.trim()) {
          throw new Error("delivery agent produced no output")
        }
        parsed = extractVerdictText(allText)
      } catch (err) {
        lastError = new Error(`Delivery agent returned invalid output: ${err instanceof Error ? err.message : String(err)}`)
        log.warn("delivery: output extraction failed, will retry", {
          attempt,
          error: String(err),
          textLength: collectText(result).length,
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

  return normalizeVerdict({
    verdict: sectionBody(raw, ["Verdict", "结论"]).split(/\r?\n/)[0]?.trim().toLowerCase(),
    summary: sectionBody(raw, ["Summary", "摘要"]) || firstContentLine(raw),
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

function buildUserPrompt(
  input: {
    task: { title: string; request: string; metadata?: Record<string, unknown> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults?: Array<{ name: string; status: string; evidence?: string }>
    analysis?: GoalJudgmentType
  },
  context?: string,
): string {
  const sections: string[] = []

  sections.push(
    `# Task\n\nTitle: ${input.task.title}\n\nRequest:\n${input.task.request}`,
  )

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
    const notes = operatorNotesSection(taskID)
    if (notes) sections.push(notes)
  }

  sections.push(
    `# Goals (${input.goals.length})\n\n` +
      input.goals
        .map(
          (g, i) =>
            `${i}. [${g.priority}] ${g.description}\n   Criteria: ${g.criteria}`,
        )
        .join("\n\n"),
  )

  sections.push(
    `# Delivery\n\nSummary: ${input.delivery.summary}\n\nChanged files (${input.delivery.changedFiles.length}):\n` +
      input.delivery.changedFiles.map((f) => `- ${f}`).join("\n"),
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
      `# Evaluator Analysis\n\n` +
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

  return sections.join("\n\n")
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "\n... (truncated)"
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const DELIVERY_AGENT_SYSTEM = `You are a senior QA engineer acting as the final delivery gate for OpenCorvus. The evaluator ran fast checks (build/test/lint). Your job is to run extended checks, verify runtime behavior, and make the final acceptance decision.

IMPORTANT: You are a read-only verifier. You do NOT modify code. If you find issues, reject with detailed structured context so a new executor can fix them.

## Available Tools

### Exploration
- **read_file**, **find_files**, **search_code**, **list_directory**: Inspect codebase

### Execution
- **run_command**: Build, start server, run tests, curl endpoints

### Context
- **memory_search**: Search past delivery issues
- **memory_write**: Persist findings for future deliveries

## Process

### Phase 1: EXTENDED CHECKS
Run the quality checks that the evaluator skipped:
1. **Code review**: Read changed files, check for obvious bugs, bad patterns, security issues
2. **Dead code**: Check if any imports or functions became unused
3. **Style/conventions**: Check against project conventions
4. Record each check result with pass/fail and evidence.

### Phase 2: RUNTIME VERIFICATION
1. Find entry point (package.json scripts, src/app.ts, framework config)
2. Install deps if needed, build, run tests
3. Start application with short timeout — verify clean startup
4. For web apps: check HTTP response, frontend assets
5. For libraries: verify compile + tests pass

### Phase 3: PERSIST
Write runtime failure patterns and verification insights to memory.

### Phase 4: VERDICT
Output your decision as plain markdown with these sections:

- \`# Verdict\` — accepted or rejected
- \`# Summary\` — 1-3 sentences
- \`# Startup Verification\` — attempted, command, success, output
- \`# Frontend Check\` — attempted, renders_correctly, issues
- \`# Issues Found\` — all issues discovered (empty if none)
- \`# Rejection Details\` — (required when rejecting) structured list: category (build/test/lint/runtime/quality/startup), file (if applicable), error description, suggested fix approach
- \`# Deferred Checks\` — extended checks results: name, result (passed/failed/skipped), evidence

### Verdict Meanings
- **accepted**: All checks pass, application works, no significant issues found
- **rejected**: Issues found that need fixing — provide detailed rejection_details with category, affected file, exact error, and suggested fix approach so the executor can address them precisely

## Rules
- ALWAYS start the application to verify runtime behavior — reading code alone is NOT sufficient
- Every claim must be backed by actual tool output
- Do NOT modify any code — you are a verifier, not a fixer
- When rejecting, provide the most specific and actionable rejection_details possible
- Write body text in the same language as the task request
- If the project is a library, verify compile + tests instead of startup`

/** Config-aware resolver: checks config.prompt.delivery_system first, then config.agent.delivery.prompt, otherwise the default + skills. */
export async function deliveryAgentSystem() {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.delivery_system === "string") return systemOverride.delivery_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.delivery?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : DELIVERY_AGENT_SYSTEM
  const orchCfg = await OrchestratorConfig.get()
  const skills = await loadStageSkills(orchCfg.delivery.skills, "delivery")
  return core + skills
}
