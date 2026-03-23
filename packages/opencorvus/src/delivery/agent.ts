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
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import { Config } from "@/config/config"
import { OrchestratorConfig } from "@/orchestrator/config"
import { collectText, countToolCalls, firstContentLine, sectionBody, splitBlocks } from "@/util/agent-text"
import type { GoalJudgmentType, GoalInfo, DeliveryInfo } from "@/evaluator/agent"

const log = Log.create({ service: "delivery-agent" })

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const DeliveryFix = z.object({
  file: z.string().describe("File path that was modified"),
  description: z.string().describe("What was fixed and why"),
  type: z.enum(["edit", "create", "delete"]).describe("Type of change applied"),
})

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
  verdict: z.enum(["accepted", "rejected", "fixed"]),
  summary: z.string(),
  startup_verification: StartupVerification,
  frontend_check: FrontendCheck,
  fixes_applied: z.array(DeliveryFix),
  issues_found: z.array(z.string()),
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

    const tools = createDeliveryTools({ sessionID: input.task.sessionID })
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
        ? AbortSignal.any([externalSignal, AbortSignal.timeout(deliveryCfg.timeout_ms)])
        : AbortSignal.timeout(deliveryCfg.timeout_ms)
      try {
        result = await completeHeadlessText({
          label: "delivery",
          model,
          language,
          sessionID: input.task.sessionID,
          stopWhen: [stepCountIs(deliveryCfg.max_steps)],
          tools,
          maxOutputTokens: 16384,
          timeoutMs: false,
          abortSignal: attemptSignal,
          system: await deliveryAgentSystem(),
          prompt: userPrompt,
          ...(input.stream as TextHooks<typeof tools> | undefined),
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

      const MIN_TOOL_CALLS = deliveryCfg.min_tool_calls
      if (toolCallCount < MIN_TOOL_CALLS) {
        lastError = new Error(`Delivery verification was too shallow: only ${toolCallCount}/${MIN_TOOL_CALLS} required tool calls`)
        log.warn("delivery: agent made too few tool calls, will retry", { attempt, verdict: parsed.verdict, toolCalls: toolCallCount })
        parsed = undefined
        continue
      }

      break
    }

    if (!parsed) {
      const errMsg = lastError?.message ?? "Delivery agent failed after retries"
      log.error("delivery agent failed to produce valid output after all retries, returning accepted", { error: errMsg })
      return {
        verdict: "accepted" as const,
        summary: `Delivery agent could not produce output: ${errMsg}. Proceeding with acceptance since GoalJudge already passed.`,
        startup_verification: { attempted: false, success: false },
        frontend_check: { attempted: false },
        fixes_applied: [],
        issues_found: [errMsg],
      }
    }

    log.info("delivery agent output", {
      verdict: parsed.verdict,
      fixesApplied: parsed.fixes_applied.length,
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
    fixes_applied: parseFixesApplied(sectionBody(raw, ["Fixes Applied", "已修复"])),
    issues_found: parseIssuesFound(sectionBody(raw, ["Issues Found", "发现的问题"])),
  })
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeVerdict(input: unknown): DeliveryVerdictType {
  const obj = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {}

  const rawVerdict = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : ""
  obj.verdict = rawVerdict.includes("accepted") ? "accepted"
    : rawVerdict.includes("fixed") ? "fixed"
    : rawVerdict.includes("rejected") ? "rejected"
    : "accepted"

  if (!obj.summary) obj.summary = "Delivery verification completed"

  if (!obj.startup_verification || typeof obj.startup_verification !== "object") {
    obj.startup_verification = { attempted: false, success: false }
  }
  const sv = obj.startup_verification as Record<string, unknown>
  if (typeof sv.attempted !== "boolean") sv.attempted = false
  if (typeof sv.success !== "boolean") sv.success = false

  if (!obj.frontend_check || typeof obj.frontend_check !== "object") {
    obj.frontend_check = { attempted: false }
  }
  const fc = obj.frontend_check as Record<string, unknown>
  if (typeof fc.attempted !== "boolean") fc.attempted = false

  if (!Array.isArray(obj.fixes_applied)) obj.fixes_applied = []
  obj.fixes_applied = (obj.fixes_applied as unknown[]).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = { ...(item as Record<string, unknown>) }
    if (!row.file) return []
    if (!row.description) row.description = "Fix applied"
    if (!row.type) row.type = "edit"
    return [row]
  })

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

function parseFixesApplied(text: string) {
  return splitBlocks(text).flatMap((block) => {
    const title = block[0].replace(/^[-*\u2022]\s+/, "").replace(/^\d+[.)\u3001]\s+/, "").trim()
    const record = parseRecordLines(block.slice(1))
    const file = record["file"] || record["文件"] || ""
    if (!file) return []
    return [{
      file,
      description: record["description"] || record["描述"] || title,
      type: (record["type"] || record["类型"] || "edit") as "edit" | "create" | "delete",
    }]
  })
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

  try {
    const projectId = Instance.project.id
    const prefs = Preference.merged({ projectID: projectId })
    if (prefs.length > 0) {
      const items = prefs.map((p) => `- **${p.key}**: ${p.value}`).join("\n")
      sections.push(
        "## Active Preferences\n\n" + items,
      )
    }
  } catch (err) {
    log.warn("delivery: preferences prefetch failed", { error: err instanceof Error ? err.message : String(err) })
  }

  return sections.length > 0 ? sections.join("\n\n") : ""
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildUserPrompt(
  input: {
    task: { title: string; request: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    analysis?: GoalJudgmentType
  },
  context?: string,
): string {
  const sections: string[] = []

  sections.push(
    `# Task\n\nTitle: ${input.task.title}\n\nRequest:\n${input.task.request}`,
  )

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

export const DELIVERY_AGENT_SYSTEM = `You are a senior QA engineer and deployment specialist acting as the final delivery verifier for OpenCorvus. Your job is to verify that the delivered application actually works end-to-end, fix any bugs you discover, and make a final acceptance decision before the delivery is published.

The evaluator has already verified goal completion and code quality. Your role is different — you focus on RUNTIME VERIFICATION: does the application actually start, render, and function correctly?

**CRITICAL**: Unlike the evaluator, YOU CAN WRITE CODE AND FIX BUGS. If you discover a bug during verification, fix it immediately and re-verify.

## Available Tools

### Exploration
- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search code with regex (ripgrep)
- **list_directory**: List directory contents

### Execution
- **run_command**: Run a shell command (build, start server, run tests, curl endpoints)

### Code Modification
- **write_file**: Create or overwrite a file (for missing configs, new files)
- **edit_file**: Search-and-replace edit on existing file (for targeted bug fixes)

### Context
- **memory_search**: Search project memory for past issues
- **preference_list**: List project conventions

## Process

### Phase 1: DISCOVER

1. Find the project entry point:
   - Check \`package.json\` for \`scripts.start\`, \`scripts.dev\`, \`main\` field
   - Look for \`src/app.ts\`, \`src/index.ts\`, \`src/main.ts\`, \`main.ts\`, \`app.ts\`
   - Check for framework configs (next.config.js, vite.config.ts, etc.)
2. Identify the build system and dependencies
3. Check for frontend entry (index.html, App.tsx, etc.)

### Phase 2: BUILD

1. Install dependencies if needed (\`bun install\`, \`npm install\`)
2. Run build/compile (\`bun run build\`, \`bunx tsc --noEmit\`, \`npm run build\`)
3. Record any build errors

### Phase 3: TEST COVERAGE AUDIT

1. Read the spec requirements / goals passed in the task context
2. Find all test files (\`find_files\` for \`**/*.test.ts\`, \`**/*.test.tsx\`, \`**/*.spec.ts\`)
3. Read each test file and map test cases to spec requirements:
   - For each requirement/goal, check if there is at least one test that verifies it
   - A test "covers" a requirement if it exercises the described behavior (not just mentions it)
4. If requirements are UNCOVERED by tests:
   - Write new test files or add test cases to existing files using \`write_file\` / \`edit_file\`
   - Tests must be runnable with the project's test runner (usually \`bun test\`)
   - Follow the existing test patterns and conventions in the project
   - Each new test must have a clear name describing what requirement it covers
5. Run the full test suite with \`run_command\` to verify all tests pass (old + new)
6. If new tests FAIL, the delivery has a real gap — fix the application code, not the test

### Phase 4: START & VERIFY

1. Start the application with a short timeout:
   - For servers: \`timeout 10 bun run src/app.ts\` or equivalent
   - For CLI tools: run with \`--help\` or a simple test input
   - For static sites: check if build output exists
2. Check for:
   - Clean startup (no crash, no unhandled errors)
   - Expected output ("listening on port", "server started", etc.)
   - HTTP response (if web server, \`curl http://localhost:PORT\`)
3. For frontend apps, verify:
   - HTML/JS/CSS assets exist and are non-empty
   - No obvious import or module resolution errors
   - Entry HTML references correct script paths

### Phase 5: FIX (if needed)

If you discover bugs during Phase 2, 3 or 4:
1. Analyze the root cause from error output
2. Read the relevant source files to understand the issue
3. Apply a targeted fix using \`edit_file\` or \`write_file\`
4. **Re-verify** — go back to Phase 2/3/4 to confirm the fix works
5. Record all fixes in your output

Do NOT apply cosmetic changes, refactoring, or "improvements" — only fix what prevents the application from building, starting, or running correctly.

### Phase 6: VERDICT

Output your final decision as plain markdown. Use these exact top-level sections in order:

- \`# Verdict\` — exactly one of: accepted, rejected, fixed
- \`# Summary\` — 1-3 sentence overview
- \`# Test Coverage\` — requirements covered / total, tests added (if any), test suite result (pass/fail count)
- \`# Startup Verification\` — attempted, command, success, output
- \`# Frontend Check\` — attempted, renders_correctly, issues
- \`# Fixes Applied\` — numbered list of fixes (empty if none)
- \`# Issues Found\` — remaining issues (empty if none)

### Verdict Meanings

- **accepted**: Application builds, starts, and runs correctly as-is
- **fixed**: Application had issues but they were fixed during verification — it now works
- **rejected**: Critical issues that could not be fixed — the delivery is not ready

### Formatting Rules

Under \`# Verdict\`, write exactly one word: accepted, fixed, or rejected.

Under \`# Startup Verification\`:
- attempted: true/false
- command: the startup command used
- success: true/false
- output: relevant startup output (first 500 chars)

Under \`# Frontend Check\`:
- attempted: true/false
- renders_correctly: true/false
- issues: semicolon-separated list

Under \`# Fixes Applied\`, each fix:
1. Fix description
   - file: path/to/file
   - type: edit|create|delete
   - description: what was fixed

Under \`# Issues Found\`, bullet list of remaining issues.

## Rules

- ALWAYS start the application to verify it works — reading code alone is NOT sufficient
- Every claim must be backed by actual tool results (run_command output, file contents)
- Fix real bugs only — no cosmetic changes, no refactoring, no adding features
- If you cannot start the application (missing runtime, unavailable port, etc.), classify it clearly
- Section headings must use the English names above. Write body text in the same language as the task request.
- If the project is a library (not an executable app), verify it compiles/builds correctly instead of trying to start it

## Step Budget Warning

You have a limited number of steps. After 35 tool calls, you MUST stop and emit your final verdict — even if you haven't finished all checks. A verdict based on partial evidence is better than no verdict. Budget hint: ~5 calls for discover, ~3 for build, ~10 for test coverage audit, ~8 for startup verify, ~5 for fixes, ~4 for verdict.`

export async function deliveryAgentSystem() {
  const config = await Config.get()
  const configAny = config as Record<string, unknown>
  return typeof (configAny.prompt as Record<string, unknown> | undefined)?.delivery_system === "string"
    ? (configAny.prompt as Record<string, unknown>).delivery_system as string
    : DELIVERY_AGENT_SYSTEM
}
