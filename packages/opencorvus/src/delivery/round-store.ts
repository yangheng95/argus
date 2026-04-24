/**
 * P2 · Delivery round 可观测 —— DB CRUD 层（Stream G 第一阶段）。
 *
 * 写入方：P0-C.1（每轮 repair 结束强制 commit 后写行）、P0-C.4（回滚时标记
 * rollback_from_round）。
 * 读取方：script/delivery/replay.ts（P2 第二阶段）、picky loop 取 best / latest。
 *
 * 契约不变式（与 delivery.sql.ts 对齐）：
 *  - 每行必带真实 commit_sha（DB 侧 notNull，rule 21）
 *  - (delivery_id, round_index) 唯一
 *  - rollback_from_round=null 表示正向推进；非 null 指向历史 best round_index
 *
 * 设计约束：
 *  - 只做 CRUD，不含回滚/打分/升级逻辑（那属于 picky loop，rule 22 禁双源）
 *  - `score` 在 P0-B 未完全落盘时允许 null；读取方处理 null
 *  - 不引入 schema 迁移（rule 13）
 */
import { Database, and, asc, desc, eq } from "@/storage/db"
import { Identifier } from "@/id/id"
import { EngineDeliveryRoundTable } from "./delivery.sql"
import type {
  DeliveryRoundVerdict,
  DeliveryRoundMetrics,
} from "./delivery.sql"

export interface InsertDeliveryRoundInput {
  task_id: string
  delivery_id: string
  round_index: number
  commit_sha: string
  verdict: DeliveryRoundVerdict
  score?: number | null
  metrics?: DeliveryRoundMetrics | null
  llm_rationale?: string | null
  screenshot_path?: string | null
  diff_region_path?: string | null
  rollback_from_round?: number | null
}

export interface DeliveryRoundRow {
  id: string
  task_id: string
  delivery_id: string
  round_index: number
  commit_sha: string
  verdict: DeliveryRoundVerdict
  score: number | null
  metrics: DeliveryRoundMetrics | null
  llm_rationale: string | null
  screenshot_path: string | null
  diff_region_path: string | null
  rollback_from_round: number | null
  time_created: number
  time_updated: number
}

/**
 * 插入一行。(delivery_id, round_index) 冲突由 DB 唯一索引抛出，调用方不需要二次校验。
 * 返回新行的 id。
 */
export function insertDeliveryRound(input: InsertDeliveryRoundInput): string {
  const id = Identifier.ascending("delivery_round")
  Database.transaction((db) => {
    db.insert(EngineDeliveryRoundTable)
      .values({
        id,
        task_id: input.task_id,
        delivery_id: input.delivery_id,
        round_index: input.round_index,
        commit_sha: input.commit_sha,
        verdict: input.verdict,
        score: input.score ?? null,
        metrics: input.metrics ?? null,
        llm_rationale: input.llm_rationale ?? null,
        screenshot_path: input.screenshot_path ?? null,
        diff_region_path: input.diff_region_path ?? null,
        rollback_from_round: input.rollback_from_round ?? null,
      })
      .run()
  })
  return id
}

/** 按 round_index ASC 拉出某个 delivery 的完整 picky loop 轨迹。 */
export function listDeliveryRoundsByDelivery(deliveryId: string): DeliveryRoundRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineDeliveryRoundTable)
      .where(eq(EngineDeliveryRoundTable.delivery_id, deliveryId))
      .orderBy(asc(EngineDeliveryRoundTable.round_index))
      .all(),
  ) as DeliveryRoundRow[]
}

/** 跨 delivery、全任务的 round 视图（replay 全景用）。 */
export function listDeliveryRoundsByTask(taskId: string): DeliveryRoundRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineDeliveryRoundTable)
      .where(eq(EngineDeliveryRoundTable.task_id, taskId))
      .orderBy(
        asc(EngineDeliveryRoundTable.delivery_id),
        asc(EngineDeliveryRoundTable.round_index),
      )
      .all(),
  ) as DeliveryRoundRow[]
}

/**
 * 该 delivery 下 score 最大的一行（LKG anchor）。
 * - score=null 的行被排除（未打分的过渡态不参与 best 评估）
 * - 多行同分时取 round_index 更小者（更早的 LKG 更稳，回滚代价更低）
 * 无任何打分行则返回 null。
 */
export function findBestDeliveryRound(deliveryId: string): DeliveryRoundRow | null {
  const rows = listDeliveryRoundsByDelivery(deliveryId)
  let best: DeliveryRoundRow | null = null
  for (const row of rows) {
    if (row.score === null) continue
    if (best === null || row.score > (best.score as number)) {
      best = row
      continue
    }
    if (row.score === best.score && row.round_index < best.round_index) best = row
  }
  return best
}

/** 最近一轮（picky loop 续跑时定位前一轮状态）。 */
export function findLatestDeliveryRound(deliveryId: string): DeliveryRoundRow | null {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineDeliveryRoundTable)
      .where(eq(EngineDeliveryRoundTable.delivery_id, deliveryId))
      .orderBy(desc(EngineDeliveryRoundTable.round_index))
      .limit(1)
      .all(),
  ) as DeliveryRoundRow[]
  return row[0] ?? null
}

/**
 * 给某一轮标记"由 fromRoundIndex 回滚而来"。
 * 精确到 (delivery_id, round_index)，使用 `and(eq, eq)` —— 避免之前草稿里只按
 * delivery_id 筛导致整批误改的 bug。
 */
export function markDeliveryRoundRollback(
  deliveryId: string,
  roundIndex: number,
  fromRoundIndex: number,
): void {
  Database.transaction((db) => {
    db.update(EngineDeliveryRoundTable)
      .set({ rollback_from_round: fromRoundIndex })
      .where(
        and(
          eq(EngineDeliveryRoundTable.delivery_id, deliveryId),
          eq(EngineDeliveryRoundTable.round_index, roundIndex),
        ),
      )
      .run()
  })
}
