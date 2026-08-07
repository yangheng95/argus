// 成本计算引擎（纯函数）——Phase 02 采购决策网站
// 数据口径唯一来源：site-data.json（源自 Phase 01 imported data.json）
// 公式（页面可见）：
//   席位成本(USD/年) = 官方单价 × 12 × N（Windsurf 特殊公式 = 480×N + 960）
//   超额成本仅按官方可换算单位计算（Cursor $0.25/MTok、JetBrains 1 credit=$1、Amazon Q $0.003/LOC、Tabnine provider+5%）
//   NO_CONVERSION 项 → 「不可换算（官方无公开换算依据）」，禁止估计

export type Intensity = "LIGHT" | "STANDARD" | "HEAVY"

/** 强度档 ASSUMED token 区间（来自 site-data.json intensity_tier_assumptions，章程 §3.1 非官方口径） */
export const INTENSITY_TOKEN_RANGE_MTok: Record<Intensity, { min: number; max: number | null }> = {
  LIGHT: { min: 10, max: 30 }, // 约 10M-30M tokens/月/人
  STANDARD: { min: 30, max: 100 }, // 约 30M-100M tokens/月/人
  HEAVY: { min: 100, max: null }, // 约 100M+ tokens/月/人
}

/**
 * 区间取值规则：闭区间取中点、开区间取下限（页面脚注明示）。
 * LIGHT → 20M、STANDARD → 65M、HEAVY → 100M（下限）。
 */
export function intensityMidTokensMTok(intensity: Intensity): number {
  const r = INTENSITY_TOKEN_RANGE_MTok[intensity]
  if (r.max === null) return r.min // 开区间（100M+）取下限
  return (r.min + r.max) / 2
}

/** 超额消耗量用户输入（仅官方给出可换算单位时生效；默认=官方额度内 → 超额 0） */
export interface OverageInputs {
  /** JetBrains AI Ultimate Org：每月每席实际消耗 credits（额度 70/mo，1 credit=$1，ASSUMED 消耗量为用户输入） */
  jetbrainsCreditsPerSeatPerMonth: number
  /** Amazon Q Developer Pro：每月每席 transformation LOC（额度 4K LOC/mo pooled，$0.003/LOC，用户输入） */
  amazonQTransformationLOCPerSeatPerMonth: number
  /** Tabnine：Tabnine LLM 模式 provider 每月每席成本 USD（官方公式=provider 价格+5%；own-LLM 模式无超额） */
  tabnineProviderCostPerSeatPerMonth: number
}

export const DEFAULT_OVERAGE_INPUTS: OverageInputs = {
  jetbrainsCreditsPerSeatPerMonth: 70, // 额度内 → 超额 0
  amazonQTransformationLOCPerSeatPerMonth: 4000, // 额度内 → 超额 0
  tabnineProviderCostPerSeatPerMonth: 0, // own-LLM 无超额
}

/** 单工具席位成本行（来自 site-data.json cost_model.per_tool_seat_cost） */
export interface SeatCostRow {
  tool: string
  team_plan: string
  unit_price_original: string
  currency: string
  per_seat_annual_usd: number
  team_annual_usd: { n10: number; n30: number; n100: number }
  overage_policy: string
  overage_conversion: string
  platform_fee_note?: string
}

export interface AnnualCostBreakdown {
  tool: string
  seatAnnual: number // 席位成本（USD/年）
  seatFormula: string // 席位计算式（页面可见）
  overage: OverageResult // 超额结果
  totalAnnual: number | null // 年度总成本（null = 无数值，仅当 NO_CONVERSION 且无可换算超额时仍计席位）
  totalFormula: string // 总成本计算式
  hasOverageNumber: boolean // 超额是否产生数值
  includesOverageAssumed: boolean // 超额是否依赖 ASSUMED 用量
}

export type OverageResult =
  | { kind: "number"; monthlyPerSeatUsd: number; annualTotalUsd: number; formula: string; assumed: boolean }
  | { kind: "no_conversion"; note: string }
  | { kind: "none"; note: string }

/** 席位成本：官方单价×12×N（Windsurf 特殊 = 480×N+960） */
export function calcSeatAnnual(row: SeatCostRow, N: number): { seatAnnual: number; formula: string } {
  if (row.tool === "windsurf-devin") {
    return {
      seatAnnual: 480 * N + 960,
      formula: `480×${N}+960（平台费 $80/mo×12）`,
    }
  }
  return {
    seatAnnual: row.per_seat_annual_usd * N,
    formula: `${row.unit_price_original} × 12 × ${N} = ${row.per_seat_annual_usd}×${N}`,
  }
}

/** 超额成本（年度化 = 月超额 × 12 × N）；NO_CONVERSION → 「不可换算（官方无公开换算依据）」 */
export function calcOverage(row: SeatCostRow, N: number, intensity: Intensity, inputs: OverageInputs): OverageResult {
  switch (row.tool) {
    case "cursor": {
      // 官方 $0.25/MTok（Teams+）；用量取强度档 ASSUMED token 区间（闭区间中点/开区间下限）
      const tokMTok = intensityMidTokensMTok(intensity)
      const monthlyPerSeat = tokMTok * 0.25
      const annualTotal = monthlyPerSeat * 12 * N
      return {
        kind: "number",
        monthlyPerSeatUsd: round2(monthlyPerSeat),
        annualTotalUsd: round2(annualTotal),
        formula: `${tokMTok} MTok/月/人 × $0.25/MTok × 12 × ${N}`,
        assumed: true, // 强度档用量 ASSUMED（章程 §3.1）
      }
    }
    case "jetbrains-ai": {
      // 官方 1 credit=$1；超额 = max(0,(实际消耗−70))×$1；消耗量为用户输入（ASSUMED）
      const monthlyPerSeat = Math.max(0, inputs.jetbrainsCreditsPerSeatPerMonth - 70) * 1
      const annualTotal = monthlyPerSeat * 12 * N
      if (monthlyPerSeat <= 0) {
        return {
          kind: "number",
          monthlyPerSeatUsd: 0,
          annualTotalUsd: 0,
          formula: `max(0,(${inputs.jetbrainsCreditsPerSeatPerMonth}−70 credits))×$1×12×${N}=0（额度内）`,
          assumed: true,
        }
      }
      return {
        kind: "number",
        monthlyPerSeatUsd: round2(monthlyPerSeat),
        annualTotalUsd: round2(annualTotal),
        formula: `max(0,(${inputs.jetbrainsCreditsPerSeatPerMonth}−70 credits))×$1×12×${N}`,
        assumed: true,
      }
    }
    case "amazon-q-developer": {
      // 官方 $0.003/LOC（beyond 4K LOC pool）；transformation 超额；agentic 超额 NO_CONVERSION
      const monthlyPerSeat = Math.max(0, inputs.amazonQTransformationLOCPerSeatPerMonth - 4000) * 0.003
      const annualTotal = monthlyPerSeat * 12 * N
      if (monthlyPerSeat <= 0) {
        return {
          kind: "number",
          monthlyPerSeatUsd: 0,
          annualTotalUsd: 0,
          formula: `max(0,(${inputs.amazonQTransformationLOCPerSeatPerMonth}−4000 LOC))×$0.003×12×${N}=0（额度内）`,
          assumed: true,
        }
      }
      return {
        kind: "number",
        monthlyPerSeatUsd: round2(monthlyPerSeat),
        annualTotalUsd: round2(annualTotal),
        formula: `max(0,(${inputs.amazonQTransformationLOCPerSeatPerMonth}−4000 LOC))×$0.003×12×${N}`,
        assumed: true,
      }
    }
    case "tabnine": {
      // own-LLM unlimited（无超额）；Tabnine LLM 模式 = provider 价格+5%（官方公式，provider 成本为用户输入）
      if (inputs.tabnineProviderCostPerSeatPerMonth <= 0) {
        return {
          kind: "none",
          note: "own-LLM 无超额（官方：Unlimited usage when using your own LLM）",
        }
      }
      const monthlyPerSeat = inputs.tabnineProviderCostPerSeatPerMonth * 0.05
      const annualTotal = monthlyPerSeat * 12 * N
      return {
        kind: "number",
        monthlyPerSeatUsd: round2(monthlyPerSeat),
        annualTotalUsd: round2(annualTotal),
        formula: `provider $${inputs.tabnineProviderCostPerSeatPerMonth}/月/人 × 5% × 12 × ${N}`,
        assumed: true, // provider 成本为用户输入
      }
    }
    default: {
      // NO_CONVERSION：copilot / claude-code 订阅档 / openai-codex / windsurf-devin
      return {
        kind: "no_conversion",
        note: "不可换算（官方无公开换算依据）",
      }
    }
  }
}

/** 年度总成本 = 席位成本 + 超额成本（年度化）；NO_CONVERSION 仅计席位并标注未含超额 */
export function calcAnnualBreakdown(
  row: SeatCostRow,
  N: number,
  intensity: Intensity,
  inputs: OverageInputs,
): AnnualCostBreakdown {
  const { seatAnnual, formula: seatFormula } = calcSeatAnnual(row, N)
  const overage = calcOverage(row, N, intensity, inputs)
  let totalAnnual = seatAnnual
  let totalFormula = seatFormula
  let hasOverageNumber = false
  if (overage.kind === "number") {
    totalAnnual = seatAnnual + overage.annualTotalUsd
    totalFormula = `席位 ${seatAnnual.toLocaleString("en-US")} + 超额 ${overage.annualTotalUsd.toLocaleString("en-US")}`
    hasOverageNumber = true
  } else if (overage.kind === "no_conversion") {
    totalFormula = `席位 ${seatAnnual.toLocaleString("en-US")}（未含超额：${overage.note}）`
  } else {
    totalFormula = seatFormula
  }
  return {
    tool: row.tool,
    seatAnnual: round2(seatAnnual),
    seatFormula,
    overage,
    totalAnnual: round2(totalAnnual),
    totalFormula,
    hasOverageNumber,
    includesOverageAssumed: overage.kind === "number" && overage.assumed,
  }
}

/** 计算全部可比工具的年度成本分解（cline-aider NOT-COMPARABLE 排除） */
export function calcAllAnnual(
  seatCostRows: SeatCostRow[],
  N: number,
  intensity: Intensity,
  inputs: OverageInputs,
): AnnualCostBreakdown[] {
  return seatCostRows.map((row) => calcAnnualBreakdown(row, N, intensity, inputs))
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}
