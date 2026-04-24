/**
 * P2 · Delivery round 可观测表（stub，先于 Stream G 合入）。
 *
 * 存在动机：ainvest 事故中 26 轮 picky loop 的退化轨迹无结构化可查，必须先
 * 落地 schema，让 P0-C.1（每轮强制 commit）与 P0-C.4（LKG 回滚）写入、让
 * P2（replay 脚本）按 task 读取。
 *
 * 写入方：
 *  - P0-C.1：repair 每轮结束后 INSERT 一行（commit_sha 必填，score 可 null 至 P0-B merge）
 *  - P0-C.4：回滚时 UPDATE rollback_from_round
 * 读取方：
 *  - P2 replay.ts：按 task_id / delivery_id ASC 拉出 score 曲线
 *
 * App-layer invariants（与 EngineEvaluationTable.scope 同风格）：
 *  - 每一行必须对应一个真实 commit_sha（rule 21：禁空转，每轮必 commit）
 *  - (task_id, delivery_id, round_index) 唯一；round_index 从 0 递增
 *  - rollback_from_round=null 表示该轮为正向推进；非 null 表示该轮是从历史 best 回滚回来重来
 */
import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"
import { EngineTaskTable, EngineDeliveryTable } from "@/engine/engine.sql"
import type { VisualMetricResult } from "@/delivery/visual-metric"

/** Verdict 取 P0-B 硬门 + LLM judge 的最终判决，与 DeliveryVerdictType.verdict 对齐。 */
export type DeliveryRoundVerdict = "accepted" | "rejected" | "rolled_back"

/** Persisted 形态的 metrics；stub 下直接存 VisualMetricResult。 */
export type DeliveryRoundMetrics = VisualMetricResult

export const EngineDeliveryRoundTable = sqliteTable(
  "engine_delivery_round",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    delivery_id: text()
      .notNull()
      .references(() => EngineDeliveryTable.id, { onDelete: "cascade" }),
    /** 从 0 起自增；同一 delivery_id 下唯一。 */
    round_index: integer().notNull(),
    /** 复合 score（VisualMetricResult.score）；P0-B 合入前写入方可填 null。 */
    score: integer({ mode: "number" }),
    metrics: text({ mode: "json" }).$type<DeliveryRoundMetrics>(),
    verdict: text().notNull().$type<DeliveryRoundVerdict>(),
    llm_rationale: text(),
    /** 本轮 `git commit` 的 sha（rule 21 强制）。禁 null —— DB 侧 notNull 保障。 */
    commit_sha: text().notNull(),
    screenshot_path: text(),
    diff_region_path: text(),
    /** 若本轮由历史 best 回滚回来重来，填 best 轮的 round_index；正向推进填 null。 */
    rollback_from_round: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("engine_delivery_round_unique_idx").on(table.delivery_id, table.round_index),
    index("engine_delivery_round_task_idx").on(table.task_id),
  ],
)
