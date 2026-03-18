#!/usr/bin/env bun
/**
 * Converts an orchestrator events NDJSON file into a standalone HTML execution graph.
 *
 * Usage:
 *   bun run script/ndjson-to-exec-graph.ts <input.events.ndjson> [output.html]
 */

import { readFileSync, writeFileSync } from "fs"
import { basename } from "path"

// ── Types ──────────────────────────────────────────────────────────────────────

interface Ev {
  at: string
  elapsed_ms: number
  type: string
  taskID: string
  runID: string
  stage: string
  kind: string
  status: string
  toolName: string
  summary: string
  text: string
  progressType: string
  goalRunID: string
}

interface ToolCall {
  name: string
  startMs: number
  endMs: number
  args: string
}

interface Lane {
  id: string
  label: string
  type: "spec" | "planner" | "goal" | "judge"
  startMs: number
  endMs: number
  status?: string // 'accepted' | 'failed' | 'running'
  goalName?: string
  runID?: string
  goalRunID?: string
  retryIndex?: number
  toolCalls: ToolCall[]
  toolCounts: Record<string, number>
  textSnippet: string
}

// ── Parse ──────────────────────────────────────────────────────────────────────

const inputPath = process.argv[2]
if (!inputPath) {
  console.error("Usage: bun run script/ndjson-to-exec-graph.ts <input.events.ndjson> [output.html]")
  process.exit(1)
}

const outputPath =
  process.argv[3] ??
  inputPath
    .replace(/\.events\.ndjson$/, ".exec-graph.html")
    .replace(/\.ndjson$/, ".exec-graph.html")

const events: Ev[] = readFileSync(inputPath, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Ev)

const taskID = events.find((e) => e.taskID)?.taskID ?? "unknown"
const totalMs = events[events.length - 1]?.elapsed_ms ?? 1
const startAt = events[0]?.at ?? ""

// ── Build Lanes ────────────────────────────────────────────────────────────────

const lanesMap = new Map<string, Lane>()

function getLane(id: string, label: string, type: Lane["type"], ms: number, extra?: Partial<Lane>): Lane {
  if (!lanesMap.has(id)) {
    lanesMap.set(id, {
      id,
      label,
      type,
      startMs: ms,
      endMs: ms,
      toolCalls: [],
      toolCounts: {},
      textSnippet: "",
      ...extra,
    })
  }
  return lanesMap.get(id)!
}

// Lookups
const goalNames = new Map<string, string>() // runID → goal name
const runFinalStatus = new Map<string, string>() // runID → 'accepted'|'failed'
const runLaneId = new Map<string, string>() // runID → lane id
const goalAttemptCount = new Map<string, number>() // goalName → attempt count

// Pending tool calls: `laneId::toolName` → partial tool call
const pendingTools = new Map<string, ToolCall & { argsBuffer: string; laneId: string }>()

let finalTaskStatus = "running"
let planSummary = ""
let specSummary = ""

for (const ev of events) {
  const ms = ev.elapsed_ms

  // ── Task lifecycle ──
  if (ev.type === "orchestrator.task.updated" && ev.status) {
    finalTaskStatus = ev.status
  }

  if (ev.type === "orchestrator.spec.created") {
    specSummary = ev.summary
  }

  if (ev.type === "orchestrator.plan.created") {
    planSummary = ev.summary
  }

  // ── Agent events (spec / planner / judge) ──
  if (ev.type === "orchestrator.agent.updated") {
    const stage = ev.stage
    if (!["spec", "planner", "judge"].includes(stage)) continue

    const laneId = stage === "judge" && ev.runID ? `judge:${ev.runID}` : stage
    const label =
      stage === "spec"
        ? "Spec Agent"
        : stage === "planner"
          ? "Planner Agent"
          : `Judge (${(ev.runID || "").slice(-6)})`
    const type = stage as Lane["type"]

    const lane = getLane(laneId, label, type, ms, { runID: ev.runID || undefined })
    lane.endMs = Math.max(lane.endMs, ms)

    const pendingKey = `${laneId}::${ev.toolName}`

    if (ev.kind === "tool_call") {
      // Finalize any previously dangling tool with same name
      const old = pendingTools.get(pendingKey)
      if (old) {
        const tc: ToolCall = { name: old.name, startMs: old.startMs, endMs: ms, args: old.argsBuffer }
        lane.toolCalls.push(tc)
        lane.toolCounts[old.name] = (lane.toolCounts[old.name] ?? 0) + 1
      }
      pendingTools.set(pendingKey, {
        name: ev.toolName,
        startMs: ms,
        endMs: ms,
        args: "",
        argsBuffer: "",
        laneId,
      })
    } else if (ev.kind === "tool_delta") {
      const p = pendingTools.get(pendingKey)
      if (p) p.argsBuffer += ev.text || ev.summary || ""
    } else if (ev.kind === "tool_result") {
      const p = pendingTools.get(pendingKey)
      if (p) {
        pendingTools.delete(pendingKey)
        const tc: ToolCall = { name: p.name, startMs: p.startMs, endMs: ms, args: p.argsBuffer }
        lane.toolCalls.push(tc)
        lane.toolCounts[p.name] = (lane.toolCounts[p.name] ?? 0) + 1
      }
    } else if (ev.kind === "message_delta") {
      const txt = ev.summary || ev.text || ""
      if (txt && lane.textSnippet.length < 600) lane.textSnippet += txt
    }
  }

  // ── Run/Goal lifecycle ──
  if (ev.type === "orchestrator.run.updated" && ev.runID) {
    // Extract goal name from "Goal queued: X" / "Goal accepted: X"
    const m = ev.summary?.match(/Goal (?:queued|accepted|running): (.+)/i)
    if (m) goalNames.set(ev.runID, m[1].trim())

    // Create lane for this run
    if (!runLaneId.has(ev.runID)) {
      const goalName = goalNames.get(ev.runID) ?? ev.runID.slice(-8)
      const attempt = goalAttemptCount.get(goalName) ?? 0
      goalAttemptCount.set(goalName, attempt + 1)
      const laneId = `goal:${ev.runID}`
      runLaneId.set(ev.runID, laneId)
      const label = attempt === 0 ? `Goal: ${goalName}` : `Goal: ${goalName} (retry ${attempt})`
      getLane(laneId, label, "goal", ms, { goalName, runID: ev.runID, retryIndex: attempt })
    }

    const laneId = runLaneId.get(ev.runID)!
    const lane = lanesMap.get(laneId)
    if (lane) {
      lane.endMs = Math.max(lane.endMs, ms)
      if (ev.status === "failed" || ev.status === "accepted") {
        lane.status = ev.status
        runFinalStatus.set(ev.runID, ev.status)
        if (ev.status === "failed") {
          const gn = lane.goalName ?? ""
          goalAttemptCount.set(gn, (goalAttemptCount.get(gn) ?? 1))
        }
      } else if (ev.status === "running" && !lane.status) {
        lane.status = "running"
      }
    }
  }

  // ── Run output (execution session stream) ──
  if (ev.type === "orchestrator.run.output" && ev.runID) {
    const laneId = runLaneId.get(ev.runID)
    if (laneId) {
      const lane = lanesMap.get(laneId)
      if (lane) {
        lane.endMs = Math.max(lane.endMs, ms)
        if (ev.goalRunID && !lane.goalRunID) lane.goalRunID = ev.goalRunID
        if (ev.progressType === "text_delta" && ev.text && lane.textSnippet.length < 600) {
          // Skip JSON tool args, keep prose
          const txt = ev.text.trim()
          if (txt && !txt.startsWith("{") && !txt.startsWith("[")) {
            lane.textSnippet += txt
          }
        }
      }
    }
  }
}

// Flush remaining pending tools
for (const [, p] of pendingTools) {
  const lane = lanesMap.get(p.laneId)
  if (lane) {
    lane.toolCalls.push({ name: p.name, startMs: p.startMs, endMs: totalMs, args: p.argsBuffer })
    lane.toolCounts[p.name] = (lane.toolCounts[p.name] ?? 0) + 1
  }
}

// Sort lanes: spec → planner → goal (by start time) → judge (by start time)
const typeOrder: Record<string, number> = { spec: 0, planner: 1, goal: 2, judge: 3 }
const sortedLanes = [...lanesMap.values()].sort((a, b) => {
  // Interleave goals and judges by start time
  if (a.type === "goal" || a.type === "judge" || b.type === "goal" || b.type === "judge") {
    const aOrd = a.type === "spec" || a.type === "planner" ? typeOrder[a.type] * 1e9 : a.startMs
    const bOrd = b.type === "spec" || b.type === "planner" ? typeOrder[b.type] * 1e9 : b.startMs
    return aOrd - bOrd
  }
  return typeOrder[a.type] - typeOrder[b.type]
})

// ── Compute summary stats ──────────────────────────────────────────────────────

const allGoalLanes = sortedLanes.filter((l) => l.type === "goal")
const acceptedGoals = allGoalLanes.filter((l) => l.status === "accepted").length
const failedGoals = allGoalLanes.filter((l) => l.status === "failed").length

const allToolCounts: Record<string, number> = {}
for (const lane of sortedLanes) {
  for (const [tool, count] of Object.entries(lane.toolCounts)) {
    allToolCounts[tool] = (allToolCounts[tool] ?? 0) + count
  }
}

const totalToolCalls = Object.values(allToolCounts).reduce((a, b) => a + b, 0)
const durationSec = Math.round(totalMs / 1000)

// ── HTML Generation ────────────────────────────────────────────────────────────

// Color scheme
const LANE_COLORS: Record<Lane["type"], { bg: string; bar: string; text: string }> = {
  spec: { bg: "#EBF3FD", bar: "#3A86FF", text: "#1A5DAC" },
  planner: { bg: "#F0EBFD", bar: "#7B54C9", text: "#4A2E8E" },
  goal: { bg: "#EDFCF2", bar: "#2ECC71", text: "#1A7A44" },
  judge: { bg: "#FFF8EC", bar: "#F39C12", text: "#8A5A00" },
}

const STATUS_COLORS: Record<string, string> = {
  accepted: "#27AE60",
  failed: "#E74C3C",
  running: "#F39C12",
}

const TOOL_COLORS: Record<string, string> = {
  read_file: "#3498DB",
  list_directory: "#5DADE2",
  find_files: "#76D7EA",
  search_code: "#F39C12",
  memory_search: "#9B59B6",
  preference_list: "#8E44AD",
  memory_get: "#A569BD",
  web_search: "#E67E22",
  write_file: "#27AE60",
  edit_file: "#2ECC71",
  bash: "#E74C3C",
  default: "#95A5A6",
}

function toolColor(name: string): string {
  return TOOL_COLORS[name] ?? TOOL_COLORS.default
}

// SVG Gantt chart
const CHART_W = 1180
const LANE_H = 38
const LANE_GAP = 6
const LABEL_W = 260
const CHART_CONTENT_W = CHART_W - LABEL_W - 20
const CHART_H = sortedLanes.length * (LANE_H + LANE_GAP) + 40

function msToX(ms: number): number {
  return Math.round((ms / totalMs) * CHART_CONTENT_W)
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}

function fmtMs(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = s - m * 60
  return `${m}m${rem.toFixed(0)}s`
}

// Build time axis ticks (every ~60s or 120s)
const tickInterval = totalMs > 600_000 ? 120_000 : totalMs > 300_000 ? 60_000 : 30_000
const ticks: number[] = []
for (let t = 0; t <= totalMs; t += tickInterval) ticks.push(t)

function buildGantt(): string {
  const lines: string[] = []

  // Background
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" font-family="monospace,sans-serif">`)

  // Time axis grid
  for (const t of ticks) {
    const x = LABEL_W + msToX(t)
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${CHART_H - 20}" stroke="#E0E0E0" stroke-width="1"/>`)
    lines.push(`<text x="${x}" y="${CHART_H - 5}" fill="#999" font-size="10" text-anchor="middle">${fmtMs(t)}</text>`)
  }

  // Lanes
  sortedLanes.forEach((lane, i) => {
    const y = i * (LANE_H + LANE_GAP) + 4
    const colors = LANE_COLORS[lane.type]
    const statusColor = lane.status ? (STATUS_COLORS[lane.status] ?? colors.bar) : colors.bar

    // Label background
    lines.push(`<rect x="0" y="${y}" width="${LABEL_W - 4}" height="${LANE_H}" rx="4" fill="${colors.bg}" stroke="${colors.bar}" stroke-width="1"/>`)

    // Status dot
    lines.push(`<circle cx="14" cy="${y + LANE_H / 2}" r="5" fill="${statusColor}"/>`)

    // Label text
    const labelText = truncate(lane.label, 32)
    lines.push(`<text x="26" y="${y + LANE_H / 2 + 4}" fill="${colors.text}" font-size="11" font-weight="600">${escHtml(labelText)}</text>`)

    // Duration label
    const dur = fmtMs(lane.endMs - lane.startMs)
    lines.push(`<text x="${LABEL_W - 8}" y="${y + LANE_H / 2 + 4}" fill="#999" font-size="10" text-anchor="end">${dur}</text>`)

    // Lane background bar
    const bx = LABEL_W + msToX(lane.startMs)
    const bw = Math.max(2, msToX(lane.endMs) - msToX(lane.startMs))
    lines.push(`<rect x="${bx}" y="${y + 8}" width="${bw}" height="${LANE_H - 16}" rx="3" fill="${colors.bg}" stroke="${colors.bar}" stroke-width="1" opacity="0.6"/>`)

    // Tool call blocks
    for (const tc of lane.toolCalls) {
      const tx = LABEL_W + msToX(tc.startMs)
      const tw = Math.max(3, msToX(tc.endMs) - msToX(tc.startMs))
      const ty = y + 10
      const th = LANE_H - 20
      const tc_color = toolColor(tc.name)
      const title = `${tc.name} (${fmtMs(tc.endMs - tc.startMs)})`
      lines.push(`<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="2" fill="${tc_color}" opacity="0.85">`)
      lines.push(`  <title>${escHtml(title)}</title>`)
      lines.push(`</rect>`)
    }
  })

  lines.push("</svg>")
  return lines.join("\n")
}

function buildPhaseCards(): string {
  const cards: string[] = []

  for (const lane of sortedLanes) {
    const colors = LANE_COLORS[lane.type]
    const statusColor = lane.status ? (STATUS_COLORS[lane.status] ?? colors.bar) : colors.bar
    const statusBadge = lane.status
      ? `<span class="badge" style="background:${statusColor}">${lane.status}</span>`
      : ""

    const toolList = Object.entries(lane.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `<span class="tool-chip" style="border-color:${toolColor(t)};color:${toolColor(t)}">${escHtml(t)} ×${c}</span>`)
      .join(" ")

    const snippet = lane.textSnippet.trim()
    const snippetHtml = snippet
      ? `<div class="snippet">${escHtml(truncate(snippet, 400))}</div>`
      : ""

    // Tool call table
    const tcRows = lane.toolCalls
      .map(
        (tc) =>
          `<tr>
            <td style="color:${toolColor(tc.name)}">${escHtml(tc.name)}</td>
            <td>${fmtMs(tc.startMs)}</td>
            <td>${fmtMs(tc.endMs - tc.startMs)}</td>
          </tr>`,
      )
      .join("")

    const tcTable =
      tcRows.length > 0
        ? `<details>
          <summary>Tool calls (${lane.toolCalls.length})</summary>
          <table class="tc-table">
            <thead><tr><th>Tool</th><th>At</th><th>Duration</th></tr></thead>
            <tbody>${tcRows}</tbody>
          </table>
        </details>`
        : ""

    cards.push(`
      <div class="card" style="border-left:4px solid ${colors.bar}">
        <div class="card-header">
          <div>
            <span class="card-title">${escHtml(lane.label)}</span>
            ${statusBadge}
          </div>
          <div class="card-meta">${fmtMs(lane.startMs)} → ${fmtMs(lane.endMs)} · ${fmtMs(lane.endMs - lane.startMs)}</div>
        </div>
        ${toolList ? `<div class="tools-row">${toolList}</div>` : ""}
        ${snippetHtml}
        ${tcTable}
      </div>`)
  }

  return cards.join("\n")
}

function buildToolTable(): string {
  const sorted = Object.entries(allToolCounts).sort((a, b) => b[1] - a[1])
  const max = sorted[0]?.[1] ?? 1
  return sorted
    .map(
      ([tool, count]) =>
        `<tr>
          <td><span style="color:${toolColor(tool)}">${escHtml(tool)}</span></td>
          <td>${count}</td>
          <td><div class="bar-cell"><div class="bar" style="width:${Math.round((count / max) * 200)}px;background:${toolColor(tool)}"></div></div></td>
        </tr>`,
    )
    .join("")
}

function buildLegend(): string {
  const items = [
    ["Spec Agent", LANE_COLORS.spec.bar],
    ["Planner Agent", LANE_COLORS.planner.bar],
    ["Goal Execution", LANE_COLORS.goal.bar],
    ["Judge Agent", LANE_COLORS.judge.bar],
  ]
  return items
    .map(
      ([label, color]) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${label}</span>`,
    )
    .join("")
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execution Graph – ${escHtml(taskID.slice(-12))}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F7F9FC; color: #1A2332; line-height: 1.5; }
  header { background: #1A2332; color: #fff; padding: 16px 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  header h1 { font-size: 18px; font-weight: 700; }
  .stat-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
  .chip { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #2D3A4E; color: #CBD5E1; }
  .chip.ok { background: #1A7A44; color: #fff; }
  .chip.fail { background: #922B21; color: #fff; }
  .chip.warn { background: #7A4800; color: #fff; }
  main { max-width: 1240px; margin: 0 auto; padding: 24px 16px; }
  .section { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); padding: 20px; margin-bottom: 20px; }
  .section h2 { font-size: 15px; font-weight: 700; color: #374151; margin-bottom: 14px; letter-spacing: 0.02em; text-transform: uppercase; }
  .legend { display: flex; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; font-size: 12px; color: #6B7280; }
  .legend-item { display: flex; align-items: center; gap: 5px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
  .gantt-wrap { overflow-x: auto; }
  /* Cards */
  .cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 800px) { .cards-grid { grid-template-columns: 1fr; } }
  .card { background: #FAFBFC; border-radius: 8px; padding: 14px 16px; border-left: 4px solid #ccc; }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 8px; }
  .card-title { font-size: 13px; font-weight: 700; color: #1A2332; }
  .card-meta { font-size: 11px; color: #9CA3AF; white-space: nowrap; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; color: #fff; margin-left: 6px; }
  .tools-row { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; }
  .tool-chip { font-size: 11px; padding: 1px 7px; border-radius: 10px; border: 1px solid; background: #fff; font-family: monospace; }
  .snippet { margin: 8px 0; font-size: 12px; color: #4B5563; background: #F3F4F6; border-radius: 6px; padding: 8px 10px; font-family: monospace; white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow-y: auto; }
  details { margin-top: 8px; }
  details summary { font-size: 12px; color: #6B7280; cursor: pointer; user-select: none; }
  details summary:hover { color: #374151; }
  .tc-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  .tc-table th { text-align: left; font-size: 11px; color: #9CA3AF; padding: 3px 6px; border-bottom: 1px solid #E5E7EB; }
  .tc-table td { padding: 3px 6px; border-bottom: 1px solid #F3F4F6; font-family: monospace; }
  /* Tool usage table */
  .usage-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .usage-table th { text-align: left; font-size: 11px; color: #9CA3AF; padding: 4px 8px; border-bottom: 1px solid #E5E7EB; }
  .usage-table td { padding: 4px 8px; border-bottom: 1px solid #F9FAFB; }
  .bar-cell { display: flex; align-items: center; }
  .bar { height: 14px; border-radius: 3px; min-width: 2px; }
  /* Plan summary */
  .plan-text { font-size: 13px; color: #374151; background: #F8FAFC; border-radius: 6px; padding: 12px; border-left: 3px solid #7B54C9; white-space: pre-wrap; }
</style>
</head>
<body>

<header>
  <div>
    <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">Task ID</div>
    <h1>${escHtml(taskID)}</h1>
  </div>
  <div class="stat-chips">
    <span class="chip">Started: ${escHtml(startAt.replace("T", " ").replace(/\.\d+Z/, " UTC"))}</span>
    <span class="chip">Duration: ${durationSec >= 60 ? Math.floor(durationSec / 60) + "m" + (durationSec % 60) + "s" : durationSec + "s"}</span>
    <span class="chip">Goals: ${allGoalLanes.length} (${acceptedGoals} ✓, ${failedGoals} ✗)</span>
    <span class="chip">Tool calls: ${totalToolCalls}</span>
    <span class="chip ${finalTaskStatus === "accepted" ? "ok" : finalTaskStatus === "failed" ? "fail" : "warn"}">
      Status: ${finalTaskStatus}
    </span>
  </div>
</header>

<main>

  ${
    planSummary || specSummary
      ? `<div class="section">
    <h2>Task Summary</h2>
    ${specSummary ? `<div class="plan-text">${escHtml(truncate(specSummary, 600))}</div>` : ""}
  </div>`
      : ""
  }

  <div class="section">
    <h2>Execution Timeline</h2>
    <div class="legend">${buildLegend()}</div>
    <div class="gantt-wrap">
      ${buildGantt()}
    </div>
  </div>

  <div class="section">
    <h2>Tool Usage</h2>
    <table class="usage-table">
      <thead><tr><th>Tool</th><th>Total</th><th>Relative</th></tr></thead>
      <tbody>${buildToolTable()}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Phase Details</h2>
    <div class="cards-grid">
      ${buildPhaseCards()}
    </div>
  </div>

</main>
</body>
</html>`

writeFileSync(outputPath, html, "utf-8")
console.log(`✓ Written to ${outputPath}`)
console.log(`  Lanes: ${sortedLanes.length}`)
console.log(`  Tool calls: ${totalToolCalls}`)
console.log(`  Duration: ${fmtMs(totalMs)}`)
