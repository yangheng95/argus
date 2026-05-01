/**
 * Tool set for the DeliveryAgent.
 *
 * Includes exploration tools, execution tools, screenshot tools, follow-up
 * task tools, and memory tools. Delivery is review-only: it verifies runtime
 * behavior and makes the final acceptance decision, while repair belongs to
 * orchestrator retry/replan and build agents.
 */
import { tool } from "ai"
import z from "zod"
import fs from "fs/promises"
import path from "path"
import crypto from "node:crypto"
import { createCodebaseTools } from "@/engine/codebase-tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { EngineService } from "@/task-api"
import { findTask } from "@/engine/store"
import { renderPage, findBrowserExecutable } from "@/delivery/checks/visual"
import { buildMultimodalToolResult } from "@/delivery/tool-result"

const TASK_CHAIN_DEPTH_LIMIT = 3

const log = Log.create({ service: "delivery-tools" })

/**
 * Creates the tool set for the DeliveryAgent.
 *
 * Includes:
 * - 4 codebase read tools: read_file, find_files, search_code, list_directory
 * - 2 memory tools: memory_search, memory_write
 * - 1 execution tool: run_command (for builds, startup checks)
 */
export function createDeliveryTools(input?: { sessionID?: string; taskID?: string }) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id
  const projectDir = Filesystem.resolve(Instance.directory)
  const taskID = input?.taskID

  return {
    ...codebase,

    query_metric_trajectory: tool({
      description:
        "Read the adversarial metric trajectory and the current iteration's metric results. " +
        "Use this BEFORE deciding the verdict so you see which blocking metrics are unmet, " +
        "which counterexamples are open, and whether the loop is making progress. The output " +
        "lists per-iteration aggregate scores, deltas, open counterexample counts, and the " +
        "current iteration's per-metric results with freshness flags. This trajectory is " +
        "supporting evidence for delivery and orchestrator rework decisions — ground your " +
        "verdict in this signal rather than guessing from the diff alone.",
      inputSchema: z.object({
        window: z.number().int().min(1).max(20).default(5).describe("Number of recent iterations to surface."),
      }),
      execute: async ({ window }) => {
        if (!taskID) return "query_metric_trajectory: no task context available"
        const {
          readIterationHistory,
          readResultsForIteration,
          readSpecsForTask,
          readCounterexamplesForTask,
        } = await import("@/metrics/store")
        const history = readIterationHistory(taskID)
        const tail = history.slice(-window)
        const currentIter = history.length > 0 ? history[history.length - 1].iteration : 0
        const results = readResultsForIteration(taskID, currentIter)
        const specs = new Map(readSpecsForTask(taskID).map((s) => [s.id, s]))
        const ces = readCounterexamplesForTask(taskID)
        const open = ces.filter((c) => c.iteration_resolved === null)

        const lines: string[] = []
        lines.push(`## Trajectory (last ${tail.length} iterations)`)
        if (tail.length === 0) {
          lines.push("(no iterations recorded yet)")
        }
        for (const it of tail) {
          lines.push(
            `iter=${it.iteration} trajectory=${it.arbiter_verdict} S_k=${it.aggregate_score.toFixed(3)} ΔS=${it.delta_vs_prev.toFixed(3)} blocking_unmet=${it.blocking_unmet_count} open_ce=${it.open_counterexamples} novelty=${it.novelty_score} regressed=${it.regressed_blocking}`,
          )
        }
        lines.push("")
        lines.push(`## Current iteration (${currentIter}) metric results`)
        if (results.length === 0) {
          lines.push("(no metric results for this iteration — executor may not have run yet)")
        }
        for (const r of results) {
          const spec = specs.get(r.metric_spec_id)
          if (!spec) continue
          const scope = spec.scope === "goal" ? `goal=${spec.goal_id}` : "global"
          lines.push(
            `- ${spec.name} [${scope}, ${spec.gate_class}, ${spec.evaluator_kind}] raw=${r.raw_value.toFixed(3)} norm=${r.normalized_value.toFixed(3)} met_target=${r.met_target} met_floor=${r.met_floor} fresh=${r.evidence_fresh}`,
          )
        }
        if (open.length > 0) {
          lines.push("")
          lines.push(`## Open counterexamples (${open.length})`)
          for (const c of open) {
            lines.push(`- ${c.id} [${c.target_scope}/${c.target_ref}, ${c.severity}] ${c.claim.slice(0, 140)}`)
          }
        }
        void findTask
        return lines.join("\n")
      },
    }),

    /** Drill-down into a single evaluation-evidence row. Use when
     *  query_metric_trajectory flags a stuck metric or open counterexample
     *  and you need the raw scorer detail for rejection_details. */
    query_evidence: tool({
      description:
        "Drill down into a single verification-evidence row — raw scorer detail " +
        "(spec_id, scorer_kind, exit_code, output digest) for one goal's latest " +
        "goal_run evidence, a specific goal_run, or the latest delivery-scope " +
        "evidence. Use this after query_metric_trajectory when you need to cite " +
        "a specific failing scorer in rejection_details.",
      inputSchema: z.object({
        scope: z
          .enum(["goal_run", "delivery"])
          .describe(
            'Which evidence scope to read. "goal_run" for a specific goal\'s latest at-exit evaluation; "delivery" for the merged-worktree result.',
          ),
        goal_id: z
          .string()
          .optional()
          .describe('Required when scope="goal_run". Ignored for "delivery".'),
        goal_run_id: z
          .string()
          .optional()
          .describe(
            'Optional: when set with scope="goal_run", returns evidence for THAT specific run rather than the latest for the goal.',
          ),
      }),
      execute: async ({ scope, goal_id, goal_run_id }) => {
        if (!taskID) return "query_evidence: no task context available"
        try {
          const { queryEvidence, renderEvidence } = await import("@/verification")
          const evidence = queryEvidence({
            scope,
            goalID: goal_id,
            goalRunID: goal_run_id,
            taskID,
          })
          if (!evidence) {
            return `query_evidence: no ${scope} evidence found yet${goal_id ? ` for goal ${goal_id}` : ""}${goal_run_id ? ` (goal_run=${goal_run_id})` : ""}.`
          }
          return renderEvidence(evidence)
        } catch (err) {
          return `query_evidence error: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),

    submit_next_task: tool({
      description:
        "Spawn a follow-up task in the same project. Use this whenever what " +
        "needs to happen next belongs in a fresh task rather than inside this " +
        "one. Common shapes:\n" +
        "  - Fix: repair failed acceptance criteria that need another executor " +
        "pass. Pick priority='critical' so it jumps the queue ahead of new " +
        "user work (but never preempts an already-active task).\n" +
        "  - Iterate: continue the project's work — next milestone, hardening " +
        "pass, follow-up feature surfaced during this round. Normal priority.\n" +
        "  - Recommend: surface a suggested next step to the user. Low " +
        "priority; it waits for the user (or queue) to promote it.\n" +
        "The new task links back via `metadata.parent_task`, and chain depth " +
        "is bounded to " + TASK_CHAIN_DEPTH_LIMIT + " to prevent runaway chains. " +
        "When `failing_metrics` is provided, the latest iteration's metric " +
        "results for those names are auto-attached to the new task's request.",
      inputSchema: z.object({
        title: z.string().describe(
          "Short task title, e.g. 'Repair sidebar layout' or 'Add filter chip to feed'.",
        ),
        request: z.string().describe(
          "Full task description — what the new task should accomplish, with " +
          "enough context that a fresh agent run (not this one) can act on it.",
        ),
        priority: z.enum(["critical", "high", "normal", "low"]).describe(
          "Queue priority. 'critical' jumps ahead of all user-submitted work — " +
          "reserve it for repairing verification failures. 'high'/'normal'/'low' " +
          "for iteration and recommendation tasks, matching urgency.",
        ),
        failing_metrics: z.array(z.string()).optional().describe(
          "Optional: canonical names of metrics currently failing (e.g. " +
          "'functional_correctness', 'user_intent_fidelity'). The latest " +
          "iteration's result rows are attached to the new task request.",
        ),
        scope_files: z.array(z.string()).optional().describe(
          "Optional list of files the next task should focus on (relative to project root).",
        ),
      }),
      execute: async ({ title, request, priority, failing_metrics, scope_files }) => {
        if (!taskID) return "submit_next_task: no task context available"
        const original = findTask(taskID)
        if (!original) return `submit_next_task: original task ${taskID} not found`
        const meta = (original.metadata as Record<string, unknown> | null) ?? {}
        const depth = typeof meta.task_chain_depth === "number" ? meta.task_chain_depth : 0
        if (depth >= TASK_CHAIN_DEPTH_LIMIT) {
          return `submit_next_task: task chain depth ${depth} reached limit ${TASK_CHAIN_DEPTH_LIMIT}; refusing to spawn another follow-up task`
        }
        let evidenceBlock = ""
        if (failing_metrics && failing_metrics.length > 0) {
          const {
            readIterationHistory,
            readResultsForIteration,
            readSpecsForTask,
          } = await import("@/metrics/store")
          const history = readIterationHistory(taskID)
          const currentIter = history.length > 0 ? history[history.length - 1].iteration : 0
          const results = readResultsForIteration(taskID, currentIter)
          const specs = new Map(readSpecsForTask(taskID).map((s) => [s.id, s]))
          const wanted = new Set(failing_metrics)
          const matched = results
            .map((r) => ({ r, spec: specs.get(r.metric_spec_id) }))
            .filter((x) => x.spec && wanted.has(x.spec.name))
          evidenceBlock = matched.length > 0
            ? "\n\n## Failing metrics from previous iteration\n" + matched
                .map(({ r, spec }) =>
                  `- **${spec!.name}** [${spec!.gate_class}]: raw=${r.raw_value.toFixed(3)} met_target=${r.met_target} met_floor=${r.met_floor} fresh=${r.evidence_fresh}\n  evidence_ref: ${String(r.evidence_ref).slice(0, 400)}`,
                )
                .join("\n") + "\n\nAddress every failing metric above. Do not regress metrics that currently pass."
            : "\n\n## Failing metrics (no matching results in current iteration — query_metric_trajectory first)\n" +
              failing_metrics.map((n) => `- **${n}**`).join("\n")
        }
        const scopeBlock = scope_files && scope_files.length > 0
          ? `\n\n## Scope (focus area)\n${scope_files.map((f) => `- ${f}`).join("\n")}`
          : ""
        const fullRequest = [
          `# Follow-up task — derived from \`${original.id}\` ("${original.title}")`,
          ``,
          request,
          ``,
          `## Original request`,
          original.request,
          evidenceBlock,
          scopeBlock,
        ].join("\n")
        const newTaskID = await EngineService.createTask({
          title: title.slice(0, 80),
          request: fullRequest,
          priority,
          metadata: {
            ...meta,
            parent_task: original.id,
            task_chain_depth: depth + 1,
            ...(failing_metrics && failing_metrics.length > 0 ? { failing_metrics } : {}),
            ...(scope_files && scope_files.length > 0 ? { next_task_scope_files: scope_files } : {}),
          },
        })
        return `submit_next_task: created new task ${newTaskID} (priority=${priority}, task_chain_depth=${depth + 1}). It enters the queue at the requested priority.`
      },
    }),

    memory_search: tool({
      description:
        "Search project memory for prior delivery failures, known runtime issues, or startup problems. " +
        "Use when investigating why the application fails to start or render correctly.",
      inputSchema: z.object({
        query: z.string().describe("Search query — keywords about the failure or pattern"),
        max_results: z.number().default(5).describe("Max results"),
      }),
      execute: async ({ query, max_results }) => {
        try {
          const results = Memory.search({
            query,
            projectId,
            sessionID: input?.sessionID,
            scope: "all",
            limit: max_results,
            minScore: 0.1,
          })
          if (results.length === 0) return "No relevant memories found."
          return results
            .map(
              (r, i) =>
                `[${i + 1}] ${r.fileTitle} (${r.kind}/${r.scope}, score: ${r.score.toFixed(2)})\n${r.content.slice(0, 500)}`,
            )
            .join("\n\n---\n\n")
        } catch (err) {
          log.warn("memory search failed in delivery agent", { query, err })
          return "Memory search unavailable."
        }
      },
    }),

    memory_write: tool({
      description:
        "Write knowledge to project memory. Use to persist delivery findings, runtime failure patterns, " +
        "and verification insights so future deliveries can reference them.",
      inputSchema: z.object({
        title: z.string().describe("Short descriptive title"),
        content: z.string().describe("Markdown content to save"),
        kind: z.enum(["fact", "lesson", "episode"]).default("lesson").describe("Memory kind"),
      }),
      execute: async ({ title, content, kind }) => {
        try {
          const file = Memory.writeFile({
            title,
            content,
            source: "agent",
            projectId,
            scope: "global",
            kind,
          })
          return `Saved: ${title} (id: ${file.id})`
        } catch (err) {
          log.warn("memory write failed in delivery agent", { title, err })
          return "Memory write failed."
        }
      },
    }),

    run_command: tool({
      description:
        "Run a shell command in the project directory and capture stdout/stderr/exit code. " +
        "Use to build the project, start servers, run smoke tests, or verify frontend rendering. " +
        "For server startup verification, use a short timeout (e.g., 10-15 seconds) to check if " +
        "the server starts without crashing — do NOT keep servers running indefinitely.\n\n" +
        "If you background a process (`cmd &`) and it keeps the port alive past this call's " +
        "timeout, note the returned `pid` line — that is the PID of the SHELL that spawned " +
        "your backgrounded child, and you can target its whole tree on a later turn with " +
        "`taskkill /F /T /PID <pid>` (Windows) or `kill -TERM -- -<pid>` (Unix). Prefer " +
        "that over `netstat | findstr :3000` guessing — the shell's own PID is deterministic.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to run (runs in project root)"),
        timeout_ms: z.number().default(120_000).describe("Max execution time ms"),
      }),
      execute: async ({ command, timeout_ms }) => {
        try {
          const result = await Shell.run(command, {
            cwd: projectDir,
            env: process.env,
            timeoutMs: timeout_ms,
          })
          const parts = [`exit_code: ${result.exitCode}`]
          if (typeof result.pid === "number") parts.push(`pid: ${result.pid}`)
          if (result.timedOut) parts.push(`timeout_ms: ${timeout_ms}`)
          if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.slice(0, 8000)}`)
          if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.slice(0, 5000)}`)
          return parts.join("\n") || `exit_code: ${result.exitCode} (no output)`
        } catch (e) {
          log.warn("run_command failed in delivery agent", { command, err: e })
          return `Error running command: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    screenshot: tool({
      description:
        "Capture a PNG screenshot of a URL or a local HTML file via puppeteer and write it to the " +
        "project's .opencorvus/delivery-screenshots/ directory. Use this to produce visual evidence " +
        "that the running application actually renders, or to capture before/after images around a " +
        "fix. The screenshot is saved to disk; reference the returned absolute path and sha when " +
        "citing this call in submit_verdict.tool_call_evidence. The tool returns the shot's size " +
        "(bytes + dimensions) and a pixel-variance signal — a near-zero variance means the page " +
        "rendered blank/uniform (JSON error, pre-hydration stub, loading state) and the capture " +
        "itself does NOT count as a passed check. " +
        "P0-0: the captured PNG is attached to this tool result as multimodal image content — you " +
        "see it directly in your next reasoning step, no read_file required.",
      inputSchema: z.object({
        url: z.string().describe("Absolute http(s) URL, file:// URL, or absolute local path to an HTML file. The file path form launches a short-lived static/project server so ES-module scripts resolve correctly — same logic as the pipeline's visual-diff helper."),
        viewport_width: z.number().int().min(100).max(4096).default(1440).describe("Viewport width in CSS pixels."),
        viewport_height: z.number().int().min(100).max(4096).default(900).describe("Viewport height in CSS pixels."),
        label: z.string().optional().describe("Short label used in the output filename, e.g. 'after-fix-1' or 'chart-area'. Alphanum / dash only."),
      }),
      execute: async ({ url, viewport_width, viewport_height, label }) => {
        const safeLabel = (label ?? "shot").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40) || "shot"
        const outDir = path.join(projectDir, ".opencorvus", "delivery-screenshots")
        await fs.mkdir(outDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, "-")
        const workDir = path.join(outDir, `${stamp}-${safeLabel}`)
        try {
          const rendered = await renderPage({
            rendered: url,
            outDir: workDir,
            viewport: { width: viewport_width, height: viewport_height },
          })
          const buf = await fs.readFile(rendered.renderedPath)
          const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16)
          const variance = luminanceVariance(buf)
          const finalPath = path.join(outDir, `${stamp}-${safeLabel}-${sha}.png`)
          await fs.rename(rendered.renderedPath, finalPath).catch(async () => {
            await fs.copyFile(rendered.renderedPath, finalPath)
          })
          await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
          // P0-0 — return the PNG as multimodal image content so the LLM sees
          // the screenshot in THIS reasoning step instead of having to chain
          // read_file on a path it almost never invokes.
          return await buildMultimodalToolResult({
            text: JSON.stringify({
              ok: true,
              path: finalPath,
              sha,
              bytes: buf.length,
              width: rendered.size.width,
              height: rendered.size.height,
              viewport: rendered.viewport,
              pixel_variance: Number(variance.toFixed(2)),
              degenerate: variance < 25,
              note: variance < 25
                ? "Pixel variance < 25 — the screenshot is near-uniform (blank page, JSON error body, or unhydrated shell). Do NOT count as a passed visual check."
                : undefined,
            }, null, 2),
            images: [{ path: finalPath, mime: "image/png", filename: `${safeLabel}-${sha}.png` }],
          })
        } catch (err) {
          log.warn("screenshot failed", { url, err })
          await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
          // P0-0: failures stay text-only — there is no PNG to attach. Do NOT
          // return a stale prior-run image (rule 1: no fallback that lies
          // about what was captured this turn).
          return `screenshot failed: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),

    verify_page_integrity: tool({
      description:
        "Hard verification that a URL actually serves a live, interactive application — NOT a curl " +
        "bypass. One puppeteer session attaches 5 observers (request failures, response bodies, " +
        "console errors, page errors, unhandled rejections) and runs six checks simultaneously:\n" +
        "  1. HTTP: status 2xx + content-type text/html + body ≥ 200B at the page URL.\n" +
        "  2. Asset: every <script src>/<link href>/<img src> loads with status 2xx (no 404/blocked).\n" +
        "  3. DOM: the root element has ≥ min_dom_descendants subtree nodes (hydration check).\n" +
        "  4. JS: zero pageerror events + zero console.error events during load.\n" +
        "  5. Pixel: rendered screenshot pixel-variance ≥ 25 (rejects blank / JSON error pages).\n" +
        "  6. Expected: every expect_selectors entry present and every expect_texts entry found in " +
        "     the body's textContent.\n" +
        "Returns a structured report per layer. The call PASSES only when every layer with an " +
        "assertion passes — any single layer failure marks the whole call failed. Cite the returned " +
        "JSON in submit_verdict.tool_call_evidence with detail=the failure list (or the key numbers " +
        "when passed).",
      inputSchema: z.object({
        url: z.string().describe("http(s):// URL the app is listening on. If you only have a local file path, run the project's server first via run_command and target the listening URL."),
        viewport_width: z.number().int().min(100).max(4096).default(1440),
        viewport_height: z.number().int().min(100).max(4096).default(900),
        min_dom_descendants: z.number().int().min(1).max(10000).default(20).describe("Minimum descendant count under document.body. 20 is a reasonable floor for any non-trivial app shell."),
        expect_selectors: z.array(z.string()).default([]).describe("CSS selectors that MUST resolve to at least one element. Cite ids/classes from your spec."),
        expect_texts: z.array(z.string()).default([]).describe("Substrings that MUST appear in document.body.textContent (case-sensitive). Use for headers, visible labels, data markers."),
        wait_for_selector: z.string().optional().describe("Optional CSS selector to wait for before assertions run (e.g. '.chart canvas'). Default: just waitUntil networkidle0."),
        wait_timeout_ms: z.number().int().min(1000).max(120000).default(30000),
      }),
      execute: async (args) => {
        let puppeteer: typeof import("puppeteer-core")
        try {
          puppeteer = (await import("puppeteer-core")).default as any
        } catch (err) {
          return `verify_page_integrity: puppeteer-core unavailable — ${err instanceof Error ? err.message : String(err)}`
        }
        let executablePath: string
        try {
          executablePath = await findBrowserExecutable()
        } catch (err) {
          return `verify_page_integrity: no browser — ${err instanceof Error ? err.message : String(err)}`
        }

        const report = {
          url: args.url,
          passed: false,
          layers: {
            http: { passed: false, status: 0, content_type: "", body_length: 0, reason: "" },
            asset: { passed: false, total: 0, failed: [] as Array<{ url: string; status: number; reason: string }> },
            dom: { passed: false, body_descendants: 0, required: args.min_dom_descendants },
            js: { passed: false, console_errors: [] as string[], page_errors: [] as string[] },
            pixel: { passed: false, variance: 0, floor: 25, screenshot_path: "" },
            expected: {
              passed: false,
              missing_selectors: [] as string[],
              missing_texts: [] as string[],
            },
          },
          summary: "",
        }

        const browser = await puppeteer.launch({
          executablePath,
          headless: true,
          args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        })
        try {
          const page = await browser.newPage()
          await page.setViewport({
            width: args.viewport_width,
            height: args.viewport_height,
            deviceScaleFactor: 1,
          })

          const failedRequests: Array<{ url: string; status: number; reason: string }> = []
          let totalRequests = 0
          page.on("response", (res) => {
            totalRequests += 1
            const status = res.status()
            if (status >= 400 && status < 600) {
              failedRequests.push({ url: res.url(), status, reason: res.statusText() || `HTTP ${status}` })
            }
          })
          page.on("requestfailed", (req) => {
            failedRequests.push({ url: req.url(), status: 0, reason: req.failure()?.errorText ?? "request failed" })
          })
          const consoleErrors: string[] = []
          page.on("console", (msg) => {
            if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 400))
          })
          const pageErrors: string[] = []
          page.on("pageerror", (err) => {
            const e = err as Error
            pageErrors.push(e.message?.slice(0, 400) ?? String(err))
          })

          // Layer 1 — HTTP / content-type
          const response = await page.goto(args.url, {
            waitUntil: "networkidle0",
            timeout: args.wait_timeout_ms,
          })
          const status = response?.status() ?? 0
          const contentType = String(response?.headers()["content-type"] ?? "").toLowerCase()
          const bodyBuf = response ? await response.buffer().catch(() => Buffer.alloc(0)) : Buffer.alloc(0)
          report.layers.http.status = status
          report.layers.http.content_type = contentType
          report.layers.http.body_length = bodyBuf.length
          if (status < 200 || status >= 300) {
            report.layers.http.reason = `status=${status}`
          } else if (!contentType.includes("text/html")) {
            report.layers.http.reason = `content-type=${contentType || "(missing)"} — app root must serve text/html`
          } else if (bodyBuf.length < 200) {
            report.layers.http.reason = `body=${bodyBuf.length}B — too small to be an app shell`
          } else {
            report.layers.http.passed = true
          }

          if (args.wait_for_selector) {
            try {
              await page.waitForSelector(args.wait_for_selector, { timeout: args.wait_timeout_ms })
            } catch {
              // surface as selector miss in layer 6; do NOT throw
            }
          }

          // Layer 2 — asset loads
          report.layers.asset.total = totalRequests
          report.layers.asset.failed = failedRequests
          report.layers.asset.passed = failedRequests.length === 0

          // Layer 3 — DOM descendants
          const bodyDescendants = await page.evaluate(() =>
            document.body ? document.body.getElementsByTagName("*").length : 0,
          )
          report.layers.dom.body_descendants = bodyDescendants
          report.layers.dom.passed = bodyDescendants >= args.min_dom_descendants

          // Layer 4 — JS errors
          report.layers.js.console_errors = consoleErrors
          report.layers.js.page_errors = pageErrors
          report.layers.js.passed = consoleErrors.length === 0 && pageErrors.length === 0

          // Layer 5 — pixel variance on a screenshot
          const shotDir = path.join(projectDir, ".opencorvus", "delivery-screenshots")
          await fs.mkdir(shotDir, { recursive: true })
          const shotPath = path.join(
            shotDir,
            `verify-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
          )
          await page.screenshot({ path: shotPath as `${string}.png`, type: "png" })
          const shotBuf = await fs.readFile(shotPath)
          const variance = luminanceVariance(shotBuf)
          report.layers.pixel.variance = Number(variance.toFixed(2))
          report.layers.pixel.screenshot_path = shotPath
          report.layers.pixel.passed = variance >= report.layers.pixel.floor

          // Layer 6 — expected selectors / texts
          const missingSelectors: string[] = []
          for (const sel of args.expect_selectors ?? []) {
            const found = await page.$(sel).then((e) => !!e).catch(() => false)
            if (!found) missingSelectors.push(sel)
          }
          const bodyText = await page.evaluate(() => document.body?.textContent ?? "")
          const missingTexts = (args.expect_texts ?? []).filter((t) => !bodyText.includes(t))
          report.layers.expected.missing_selectors = missingSelectors
          report.layers.expected.missing_texts = missingTexts
          report.layers.expected.passed = missingSelectors.length === 0 && missingTexts.length === 0

          report.passed =
            report.layers.http.passed &&
            report.layers.asset.passed &&
            report.layers.dom.passed &&
            report.layers.js.passed &&
            report.layers.pixel.passed &&
            report.layers.expected.passed

          const failedLayers = Object.entries(report.layers)
            .filter(([, v]) => !(v as { passed: boolean }).passed)
            .map(([k]) => k)
          report.summary = report.passed
            ? `all 6 layers passed on ${args.url}`
            : `failed layers: ${failedLayers.join(", ")}`
        } catch (err) {
          report.summary = `verify_page_integrity crashed: ${err instanceof Error ? err.message : String(err)}`
          log.warn("verify_page_integrity failed", { url: args.url, err })
        } finally {
          await browser.close().catch(() => undefined)
        }
        // P0-0 — attach the layer-5 screenshot as multimodal image content so
        // the LLM sees the rendered page in THIS reasoning step instead of
        // chaining read_file on the screenshot_path field it never reads.
        // Skip the attachment when the screenshot was never produced (early
        // crash before layer 5) — text-only is the correct shape there.
        const shotPath = report.layers.pixel.screenshot_path
        const text = JSON.stringify(report, null, 2)
        if (shotPath) {
          try {
            return await buildMultimodalToolResult({
              text,
              images: [{ path: shotPath, mime: "image/png", filename: path.basename(shotPath) }],
            })
          } catch (err) {
            log.warn("verify_page_integrity: failed to attach screenshot", { shotPath, err })
          }
        }
        return text
      },
    }),

  }
}

/** Stride-sampled luminance variance on a PNG buffer. A blank page, a JSON
 *  error body rendered on white, and a pre-hydration stub all land near zero
 *  (empirical floor: ~25/255² for real app shells). Used by screenshot and
 *  verify_page_integrity as a fast structural sanity gate on the capture. */
function luminanceVariance(pngBuffer: Buffer): number {
  // Decode via pngjs on demand — dependency is already pulled by checks/visual.ts.
  const { PNG } = require("pngjs") as typeof import("pngjs")
  let png: import("pngjs").PNG
  try {
    png = PNG.sync.read(pngBuffer)
  } catch {
    return 0
  }
  const data = png.data
  const stride = 64 * 4
  let sum = 0
  let sumSq = 0
  let samples = 0
  for (let i = 0; i + 2 < data.length; i += stride) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += lum
    sumSq += lum * lum
    samples += 1
  }
  if (samples === 0) return 0
  const mean = sum / samples
  return sumSq / samples - mean * mean
}
