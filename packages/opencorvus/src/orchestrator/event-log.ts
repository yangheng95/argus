import { mkdirSync, appendFileSync } from "fs"
import { join } from "path"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

/**
 * Accumulated event logger.
 *
 * Instead of recording every streaming delta, accumulates tool calls and
 * flushes on stage / turn boundaries. Two files per task:
 *   .timeline.log  — human-readable progress timeline
 *   .events.ndjson  — machine-readable accumulated events (no deltas)
 */

const LOGGED_TYPES = new Set([
  "orchestrator.task.created",
  "orchestrator.task.updated",
  "orchestrator.spec.created",
  "orchestrator.spec.updated",
  "orchestrator.plan.created",
  "orchestrator.plan.activated",
  "orchestrator.run.created",
  "orchestrator.run.updated",
  "orchestrator.run.progress",
  "orchestrator.run.output",
  "orchestrator.agent.updated",
  "orchestrator.interaction.requested",
  "orchestrator.interaction.resolved",
  "orchestrator.delivery.ready",
  "orchestrator.evaluation.completed",
])

/** run.progress type values that are pure noise */
const DROP_PROGRESS_TYPES = new Set([
  "reasoning.delta",
])

/** executor.progress summaries that are protocol bookkeeping */
const DROP_EXEC_SUMMARIES = new Set([
  "message_start",
  "message_delta",
  "content_block_stop",
  "rate_limit_event",
])

// ---------------------------------------------------------------------------

type ToolBucket = { count: number; firstAt: number; lastAt: number }

type StageAcc = {
  stage: string
  startAt: number
  tools: Map<string, ToolBucket>
  toolOrder: string[]
}

type TurnAcc = {
  num: number
  startAt: number
  tools: Map<string, number>
  toolOrder: string[]
}

type TaskCtx = {
  ndjson: string
  timeline: string
  t0: number
  stage: StageAcc | null
  turn: TurnAcc | null
  turnSeq: number
}

// ---------------------------------------------------------------------------

export namespace OrchestratorEventLog {
  const log = Log.create({ service: "orchestrator.event-log" })
  const tasks = new Map<string, TaskCtx>()

  // -- I/O helpers --

  function elapsed(ctx: TaskCtx) {
    const ms = Date.now() - ctx.t0
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`
  }

  function tl(ctx: TaskCtx, line: string) {
    try { appendFileSync(ctx.timeline, line + "\n", "utf-8") } catch (err) {
      log.warn("timeline append failed", { path: ctx.timeline, error: String(err) })
    }
  }

  function nd(ctx: TaskCtx, entry: Record<string, unknown>) {
    try { appendFileSync(ctx.ndjson, JSON.stringify(entry) + "\n", "utf-8") } catch (err) {
      log.warn("ndjson append failed", { path: ctx.ndjson, error: String(err) })
    }
  }

  function clip(s: string, max = 120) {
    return s.length <= max ? s : s.slice(0, max - 3) + "..."
  }

  // -- Flush accumulators --

  function flushStage(ctx: TaskCtx) {
    const acc = ctx.stage
    if (!acc || acc.tools.size === 0) return
    for (const name of acc.toolOrder) {
      const b = acc.tools.get(name)!
      const dur = ((b.lastAt - b.firstAt) / 1000).toFixed(1)
      tl(ctx, `[${elapsed(ctx)}]   ${name} ×${b.count}  (${dur}s)`)
      nd(ctx, {
        at: new Date().toISOString(), elapsed_ms: Date.now() - ctx.t0,
        type: "agent.tool_calls", stage: acc.stage, tool: name,
        count: b.count, duration_ms: b.lastAt - b.firstAt,
      })
    }
  }

  function flushTurn(ctx: TaskCtx) {
    const t = ctx.turn
    if (!t || t.toolOrder.length === 0) { ctx.turn = null; return }
    const parts = t.toolOrder.map(n => {
      const c = t.tools.get(n)!
      return c > 1 ? `${n} ×${c}` : n
    })
    const dur = ((Date.now() - t.startAt) / 1000).toFixed(1)
    tl(ctx, `[${elapsed(ctx)}]   Turn ${t.num}: ${parts.join(", ")}  (${dur}s)`)
    nd(ctx, {
      at: new Date().toISOString(), elapsed_ms: Date.now() - ctx.t0,
      type: "exec.turn", turn: t.num,
      tools: Object.fromEntries(t.tools), duration_ms: Date.now() - t.startAt,
    })
    ctx.turn = null
  }

  // -- Event routing --

  function handleAgentUpdated(ctx: TaskCtx, p: Record<string, unknown>) {
    const stage = String(p.stage ?? "")
    const kind = String(p.kind ?? "")
    const summary = String(p.summary ?? "")
    const S = stage.toUpperCase()

    if (kind === "error") {
      flushStage(ctx); ctx.stage = null
      tl(ctx, `[${elapsed(ctx)}] ${S} ✗ ${summary}`)
      nd(ctx, { at: new Date().toISOString(), elapsed_ms: Date.now() - ctx.t0, type: "orchestrator.agent.updated", stage, kind, summary })
      return
    }

    if (kind !== "status") return // drop message_delta, tool_delta, etc.

    // "Spec agent → toolName" — accumulate
    if (summary.includes("→")) {
      const tool = summary.split("→").pop()!.trim()
      if (!ctx.stage) ctx.stage = { stage, startAt: Date.now(), tools: new Map(), toolOrder: [] }
      const existing = ctx.stage.tools.get(tool)
      if (existing) { existing.count++; existing.lastAt = Date.now() }
      else { ctx.stage.tools.set(tool, { count: 1, firstAt: Date.now(), lastAt: Date.now() }); ctx.stage.toolOrder.push(tool) }
      return
    }

    // "finished/completed" — flush accumulated tools, then mark end
    if (/finished|completed/i.test(summary)) {
      const startAt = ctx.stage?.startAt
      flushStage(ctx); ctx.stage = null
      const dur = startAt ? ` (${((Date.now() - startAt) / 1000).toFixed(0)}s)` : ""
      tl(ctx, `[${elapsed(ctx)}] ${S} ▸ finished${dur}`)
      nd(ctx, { at: new Date().toISOString(), elapsed_ms: Date.now() - ctx.t0, type: "orchestrator.agent.updated", stage, kind, summary })
      return
    }

    // "started" — begin new stage
    if (/started|start$/i.test(summary)) {
      flushStage(ctx); ctx.stage = null
      ctx.stage = { stage, startAt: Date.now(), tools: new Map(), toolOrder: [] }
      tl(ctx, `[${elapsed(ctx)}] ${S} ▸ started`)
      nd(ctx, { at: new Date().toISOString(), elapsed_ms: Date.now() - ctx.t0, type: "orchestrator.agent.updated", stage, kind, summary })
      return
    }

    // other status (e.g. "Goal compiler classifying 12 requirements")
    tl(ctx, `[${elapsed(ctx)}] ${S} ▸ ${summary}`)
    nd(ctx, { at: new Date().toISOString(), elapsed_ms: Date.now() - ctx.t0, type: "orchestrator.agent.updated", stage, kind, summary })
  }

  function handleRunProgress(ctx: TaskCtx, p: Record<string, unknown>) {
    const pt = String(p.type ?? "")
    const summary = String(p.summary ?? "")

    if (DROP_PROGRESS_TYPES.has(pt)) return

    if (pt === "executor.progress") {
      if (DROP_EXEC_SUMMARIES.has(summary)) return
      if (summary === "message_stop") { flushTurn(ctx); return }
      // meaningful: queued, running, init, done
      tl(ctx, `[${elapsed(ctx)}] EXEC ▸ ${summary}`)
      nd(ctx, { at: new Date().toISOString(), elapsed_ms: Date.now() - ctx.t0, type: "orchestrator.run.progress", progressType: pt, summary })
      return
    }

    if (pt === "tool.call") {
      const tool = summary.replace(/^Tool call:\s*/i, "").trim() || "unknown"
      if (!ctx.turn) { ctx.turnSeq++; ctx.turn = { num: ctx.turnSeq, startAt: Date.now(), tools: new Map(), toolOrder: [] } }
      ctx.turn.tools.set(tool, (ctx.turn.tools.get(tool) ?? 0) + 1)
      if (!ctx.turn.toolOrder.includes(tool)) ctx.turn.toolOrder.push(tool)
      return
    }

    // drop everything else (tool.result deltas, etc.)
  }

  function handleMilestone(ctx: TaskCtx, type: string, p: Record<string, unknown>) {
    const summary = String(p.summary ?? "")
    const status = String(p.status ?? "")
    const taskID = String(p.taskID ?? "")
    const runID = String(p.runID ?? p.run_id ?? "")
    const now = new Date().toISOString()
    const ms = Date.now() - ctx.t0

    switch (type) {
      case "orchestrator.task.created":
        tl(ctx, `[${elapsed(ctx)}] TASK created  ${taskID}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, status, summary })
        break
      case "orchestrator.task.updated":
        flushStage(ctx); ctx.stage = null; flushTurn(ctx)
        tl(ctx, `[${elapsed(ctx)}] TASK → ${status}  ${summary}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, status, summary })
        break
      case "orchestrator.spec.created":
      case "orchestrator.spec.updated": {
        const label = type.endsWith("created") ? "SPEC created" : "SPEC updated"
        tl(ctx, `[${elapsed(ctx)}] ${label}  "${clip(summary)}"`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, summary })
        break
      }
      case "orchestrator.plan.created":
        tl(ctx, `[${elapsed(ctx)}] PLAN created  "${clip(summary)}"`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, summary })
        break
      case "orchestrator.plan.activated":
        tl(ctx, `[${elapsed(ctx)}] PLAN ▸ activated`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, summary })
        break
      case "orchestrator.run.created":
        tl(ctx, `[${elapsed(ctx)}] RUN created  ${runID}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, runID, status, summary })
        break
      case "orchestrator.run.updated":
        flushTurn(ctx)
        tl(ctx, `[${elapsed(ctx)}] RUN → ${status}  ${summary}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, runID, status, summary })
        break
      case "orchestrator.interaction.requested":
        tl(ctx, `[${elapsed(ctx)}] INTERACTION requested  ${summary}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, summary })
        break
      case "orchestrator.interaction.resolved":
        tl(ctx, `[${elapsed(ctx)}] INTERACTION resolved  ${summary}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, summary })
        break
      case "orchestrator.delivery.ready":
        tl(ctx, `[${elapsed(ctx)}] DELIVERY ready  ${summary}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, summary })
        break
      case "orchestrator.evaluation.completed": {
        const verdict = String(p.verdict ?? "")
        tl(ctx, `[${elapsed(ctx)}] EVAL completed  verdict=${verdict}  ${summary}`)
        nd(ctx, { at: now, elapsed_ms: ms, type, taskID, verdict, status, summary })
        break
      }
    }
  }

  // -- Entry point --

  export function init() {
    Bus.subscribeAll((event: any) => {
      const type = event?.type as string | undefined
      if (!type || !LOGGED_TYPES.has(type)) return
      const p = event.properties ?? {}
      const taskID = String(p.taskID ?? p.task_id ?? "")
      if (!taskID) return

      if (!tasks.has(taskID)) {
        try {
          const dir = join(Instance.directory, ".opencorvus", "logs")
          mkdirSync(dir, { recursive: true })
          const tag = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")
          tasks.set(taskID, {
            ndjson: join(dir, `${taskID}_${tag}.events.ndjson`),
            timeline: join(dir, `${taskID}_${tag}.timeline.log`),
            t0: Date.now(), stage: null, turn: null, turnSeq: 0,
          })
          log.info("task log started", { taskID })
        } catch (e) {
          log.warn("failed to init task log", { error: String(e) })
          return
        }
      }

      const ctx = tasks.get(taskID)!

      if (type === "orchestrator.agent.updated") return handleAgentUpdated(ctx, p)
      if (type === "orchestrator.run.progress") return handleRunProgress(ctx, p)
      if (type === "orchestrator.run.output") return // text deltas — skip
      handleMilestone(ctx, type, p)
    })
  }
}
