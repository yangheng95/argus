// 数据新鲜度引擎——STALE 动态判定
// 规则（limitations.L1 原文）：价格/额度/政策为 2026-08-01 快照，属动态事实；交付超 14 天需标 STALE，采购前须复核。
// 实现：以访问日期 2026-08-01 为基准，当前日期 - 访问日期 > 14 天 → 显示 STALE 徽标并提示复核（动态计算，非静态文案）。

/** 数据访问日期快照（Phase 01 全部价格/额度/政策访问日期，禁止改写） */
export const ACCESS_DATE_SNAPSHOT = "2026-08-01"
/** 复核日期（2026-08-02，12/12 官方 URL 一致） */
export const REVIEW_DATE = "2026-08-02"
/** STALE 阈值（天），limitations.L1：交付超 14 天 */
export const STALE_THRESHOLD_DAYS = 14

export interface FreshnessResult {
  accessDate: string
  reviewDate: string
  today: string
  daysSinceAccess: number
  stale: boolean
  thresholdDays: number
}

/**
 * 新鲜度判定（可注入 today 便于核对；运行时默认取当前日期）。
 * 判定：daysSinceAccess = 当前日期 - 2026-08-01（日历天）；> 14 天 → stale = true。
 */
export function evaluateFreshness(today: Date = new Date()): FreshnessResult {
  const access = new Date(`${ACCESS_DATE_SNAPSHOT}T00:00:00`)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.floor((startOfToday.getTime() - access.getTime()) / 86400000)
  return {
    accessDate: ACCESS_DATE_SNAPSHOT,
    reviewDate: REVIEW_DATE,
    today: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
    daysSinceAccess: days,
    stale: days > STALE_THRESHOLD_DAYS,
    thresholdDays: STALE_THRESHOLD_DAYS,
  }
}
