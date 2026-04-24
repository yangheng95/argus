#!/usr/bin/env bun
/**
 * P2 · Delivery round replay (Stream G.2).
 *
 * 按 taskID 拉出 engine_delivery_round 里的所有轮，打印 ASCII score 轨迹 +
 * 退化点标红。目的：26 轮 picky loop 不需要肉眼翻 PNG 就能看出从第 N 轮开始
 * 反向退化（参考 ainvest 事故复盘，specs/delivery-quality-gate.md §P2）。
 *
 * 用法：
 *   bun run script/delivery/replay.ts <taskID>
 *
 * 前置：
 *   - `OPENCORVUS_HOME` 或 cwd 指向真实项目目录（Database.Path() 依赖它）
 *   - delivery_round 表已有行（写入方在 picky loop 里由 Stream D 接入后才会产生）
 *
 * 约束（CLAUDE.md）：
 *  - rule 22：唯一数据源是 delivery_round 表；不 fallback 解析 git log
 *  - rule 26：不生成 PNG 曲线图（本轮 ASCII 足够），仅输出到 stdout
 *  - rule 1：表为空 ⇒ 直接退出 1，不猜
 */
import {
  listDeliveryRoundsByTask,
  type DeliveryRoundRow,
} from "../../src/delivery/round-store"
import type { VisualGateName, VisualGateResult } from "../../src/delivery/visual-metric"

const args = process.argv.slice(2)
const taskID = args.find((a) => !a.startsWith("--"))
const showGateDetail = args.includes("--gates")
if (!taskID) {
  console.error("usage: bun run script/delivery/replay.ts <taskID> [--gates]")
  console.error("  --gates  print per-gate breakdown after each row")
  process.exit(2)
}

const rows = listDeliveryRoundsByTask(taskID)
if (rows.length === 0) {
  console.error(`replay: no delivery_round rows found for task=${taskID}`)
  console.error("(writers land in Stream D's picky loop after round-store adoption)")
  process.exit(1)
}

/**
 * 复合 score 的理论范围是 [0,1]。若 P0-C.4 未接入导致 score=null，我们不假造
 * 默认值（rule 1），直接标 "—" 输出并在 markers 列提示。
 */
function fmtScore(row: DeliveryRoundRow): string {
  return row.score === null ? "  —  " : row.score.toFixed(3)
}

/** 8 字符宽度的 ASCII bar；score=null 留空。 */
function scoreBar(score: number | null, width = 12): string {
  if (score === null) return " ".repeat(width)
  const clamped = Math.max(0, Math.min(1, score))
  const filled = Math.round(clamped * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

/**
 * 5 条硬门状态压到单列："p:✓ s:✗ d:✓ u:✓ t:-"
 *  ✓ passed / ✗ failed / - gate 未参与（例如 text_hit_ratio 在 P1-B referenceStrings
 *    缺失时 skip 并从 score 权重中扣除）
 * metrics=null 或 gates 字段缺失时返回空串。
 */
const GATE_LABEL: Record<VisualGateName, string> = {
  phash_hamming: "p",
  ssim: "s",
  chart_region_density: "d",
  unique_color_ratio: "u",
  text_hit_ratio: "t",
}

function gateBadges(row: DeliveryRoundRow): string {
  const gates = row.metrics?.gates
  if (!gates || gates.length === 0) return ""
  const order: VisualGateName[] = [
    "phash_hamming",
    "ssim",
    "chart_region_density",
    "unique_color_ratio",
    "text_hit_ratio",
  ]
  const byName = new Map(gates.map((g) => [g.name, g]))
  return order
    .map((name) => {
      const g = byName.get(name)
      const label = GATE_LABEL[name]
      if (!g) return `${label}:-`
      if (Number.isNaN(g.value)) return `${label}:-`
      return `${label}:${g.passed ? "✓" : "✗"}`
    })
    .join(" ")
}

function formatGateDetail(row: DeliveryRoundRow): string[] {
  const gates = row.metrics?.gates
  if (!gates || gates.length === 0) return []
  return gates.map((g: VisualGateResult) => {
    const valueStr = Number.isNaN(g.value) ? "   skip" : g.value.toFixed(3).padStart(7)
    const thresholdStr = g.threshold.toFixed(3).padStart(7)
    const status = g.passed ? "✓" : (Number.isNaN(g.value) ? "·" : "✗")
    const note = g.note ? `  ${g.note}` : ""
    return `      [${status}] ${g.name.padEnd(22)} value=${valueStr}  threshold=${thresholdStr}${note}`
  })
}

/** 退化检测：遍历时维护 running best，score 严格下降标 ▼。 */
interface AnnotatedRow {
  row: DeliveryRoundRow
  degraded: boolean
  isBest: boolean
}
function annotate(rows: DeliveryRoundRow[]): AnnotatedRow[] {
  const out: AnnotatedRow[] = []
  let runningBest = -Infinity
  let bestKey: string | null = null
  // 先找全局 best，之后扫第二遍决定 isBest/degraded。
  for (const r of rows) {
    if (r.score !== null && r.score > runningBest) {
      runningBest = r.score
      bestKey = `${r.delivery_id}#${r.round_index}`
    }
  }
  let prevScore: number | null = null
  for (const r of rows) {
    const key = `${r.delivery_id}#${r.round_index}`
    let degraded = false
    if (prevScore !== null && r.score !== null && r.score < prevScore - 1e-6) degraded = true
    out.push({ row: r, degraded, isBest: key === bestKey })
    if (r.score !== null) prevScore = r.score
  }
  return out
}

const annotated = annotate(rows)

console.log(`# delivery-round replay for task=${taskID}`)
console.log(`# ${rows.length} rounds across ${new Set(rows.map((r) => r.delivery_id)).size} deliveries`)
console.log()

const header = [
  "delivery_id".padEnd(22),
  "rnd".padStart(3),
  "verdict".padEnd(11),
  "score",
  "trajectory".padEnd(12),
  "gates".padEnd(19),
  "commit".padEnd(9),
  "rollback",
  "markers",
].join("  ")
console.log(header)
console.log("-".repeat(header.length))

for (const a of annotated) {
  const r = a.row
  const markers: string[] = []
  if (a.isBest) markers.push("★best")
  if (a.degraded) markers.push("▼degraded")
  if (r.rollback_from_round !== null) markers.push(`↺from=${r.rollback_from_round}`)
  if (r.verdict === "rejected") markers.push("✗rejected")
  if (r.score === null) markers.push("no_score")

  const commitShort = r.commit_sha.slice(0, 8)
  const rollback = r.rollback_from_round === null ? "  —  " : String(r.rollback_from_round).padStart(5)
  const gates = gateBadges(r)

  console.log(
    [
      r.delivery_id.padEnd(22),
      String(r.round_index).padStart(3),
      r.verdict.padEnd(11),
      fmtScore(r),
      scoreBar(r.score),
      gates.padEnd(19),
      commitShort.padEnd(9),
      rollback,
      markers.join(" "),
    ].join("  "),
  )

  if (showGateDetail) {
    for (const line of formatGateDetail(r)) console.log(line)
  }
}

// 汇总：best / 总 score drop 次数 / 是否以 accepted 结尾
const scored = annotated.filter((a) => a.row.score !== null)
const degradedCount = annotated.filter((a) => a.degraded).length
const finalRow = annotated[annotated.length - 1].row

console.log()
console.log(`# summary`)
console.log(`#   total_rounds     = ${rows.length}`)
console.log(`#   scored_rounds    = ${scored.length}`)
console.log(`#   degradation_hits = ${degradedCount}`)
console.log(`#   final_verdict    = ${finalRow.verdict}`)
if (scored.length > 0) {
  const best = annotated.find((a) => a.isBest)!.row
  console.log(`#   best_score       = ${best.score!.toFixed(3)} @ round=${best.round_index} (${best.delivery_id})`)
  console.log(`#   best_commit      = ${best.commit_sha.slice(0, 12)}`)
}

