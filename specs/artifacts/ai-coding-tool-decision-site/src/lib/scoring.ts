// 综合评分引擎（纯函数）——Phase 02 采购决策网站
// 全部公式（页面可见）：
//   权重归一化：W_k = w_k / (w_cost + w_security + w_task)；三者全 0 → 等权 1/3
//   成本得分 = 100 × (总成本max − 总成本i) / (总成本max − 总成本min)（8 个可比工具 min-max；max=min → 全 100）
//   安全得分 = 100 × Σ(维度权重k × 指示k) / Σ(维度权重k)；指示 1=官方明确支持 / 0.5=PARTIAL·部分披露 / 0=未披露
//   任务效果得分 = 100 × mean_quality / 5（官方 1-5 尺度）；claude=100、codex=86.6
//   综合评分 = W_cost×成本 + W_security×安全 + W_task×任务效果（0-100）
//   NOT_TESTED / 无实测工具：任务效果维度不可评分 → 去掉该维度后对剩余权重在各自和上重归一化，并显示徽标

import type { AnnualCostBreakdown } from "./cost"

export interface Weights {
  cost: number // 成本权重 0-100（%）
  security: number // 安全权重 0-100（%）
  task: number // 任务效果权重 0-100（%）
}

export interface SecurityChecklistItem {
  key: string
  label: string // 中文维度名
  weight: number // 维度权重（默认等权 1）
}

/** 安全 7 维 checklist（从 imported data.json 各工具 security_dimensions/admin_dimensions/comparability 实际字段提取） */
export const SECURITY_CHECKLIST: SecurityChecklistItem[] = [
  { key: "sso_scim", label: "SSO / SCIM（单点登录/跨域身份管理）", weight: 1 },
  { key: "audit_compliance", label: "审计日志 / 合规 API", weight: 1 },
  { key: "dpa_gdpr", label: "DPA / GDPR（数据处理协议）", weight: 1 },
  { key: "certification", label: "独立安全认证（SOC 2 / ISO 27001 等）", weight: 1 },
  { key: "training_excluded", label: "训练数据排除（默认不训练）", weight: 1 },
  { key: "residency", label: "数据驻留 / 区域控制", weight: 1 },
  { key: "admin", label: "企业管理面 / 治理控制", weight: 1 },
]

/** 各工具安全维度指示值（1=官方明确支持、0.5=PARTIAL/部分披露、0=未披露）；来源字段见注释 */
export const SECURITY_INDICATORS: Record<string, Record<string, number>> = {
  "github-copilot": {
    // admin.sso="SAML SSO (Business+)" →1；admin.audit_logs="audit logs (Pro+)" →1；security.dpa_gdpr=true →1
    // security.certification="enterprise-grade (Business+)"（无具体认证名称）→0.5；data_usage="Business/Enterprise no-training" →1
    // 驻留未披露 →0；admin.usage_metrics/ip_indemnity →1
    sso_scim: 1,
    audit_compliance: 1,
    dpa_gdpr: 1,
    certification: 0.5,
    training_excluded: 1,
    residency: 0,
    admin: 1,
  },
  cursor: {
    // admin.sso="SAML+OIDC (Teams+)"、scim="SCIM (Enterprise)" →1；admin.audit_logs=true →1；DPA 未披露 →0
    // security.certification="SOC 2 Type II" →1；data_usage="Privacy Mode=no training"（需开启）→0.5
    // security.data_residency="no China infra；CMEK；residency +10%" →1；admin.central_billing/usage_analytics →1
    sso_scim: 1,
    audit_compliance: 1,
    dpa_gdpr: 0,
    certification: 1,
    training_excluded: 0.5,
    residency: 1,
    admin: 1,
  },
  "claude-code": {
    // admin.sso/scim/audit_logs/compliance_api=true →1；DPA 未披露 →0
    // security.enterprise_controls="enterprise controls (Team+)"、claude_security="Claude Security (beta)"（无独立认证名）→0.5
    // data_usage="Team/Enterprise no-training by default" →1；驻留未披露 →0；admin.rbac/custom_retention/hipaa_ready →1
    sso_scim: 1,
    audit_compliance: 1,
    dpa_gdpr: 0,
    certification: 0.5,
    training_excluded: 1,
    residency: 0,
    admin: 1,
  },
  "openai-codex": {
    // admin.sso="SAML SSO+MFA (Business+)"、scim_ekm_rbac="SCIM+EKM+RBAC (Enterprise)" →1；admin.compliance_api=true →1；DPA 未披露 →0
    // security.certification="SOC2+ISO (Enterprise)"（仅 Enterprise 档）→0.5；data_usage="Business no-training by default" →1
    // 驻留未披露 →0；admin.analytics →1
    sso_scim: 1,
    audit_compliance: 1,
    dpa_gdpr: 0,
    certification: 0.5,
    training_excluded: 1,
    residency: 0,
    admin: 1,
  },
  "windsurf-devin": {
    // admin.sso="SAML+OIDC (Enterprise)"（仅 Enterprise）→0.5；审计未披露 →0；DPA 未披露（数据政策 PARTIAL）→0
    // 认证未披露 →0；data_usage="standalone Windsurf policy 不再位于该 URL（PARTIAL）" →0
    // security/驻留 VPC (Enterprise) →0.5；admin.central_billing/admin_dashboard →1
    sso_scim: 0.5,
    audit_compliance: 0,
    dpa_gdpr: 0,
    certification: 0,
    training_excluded: 0,
    residency: 0.5,
    admin: 1,
  },
  "jetbrains-ai": {
    // admin.org_tier="AI Enterprise org tier (SSO/SCIM per docs)"（文档提及无独立页）→0.5；审计未披露 →0；DPA 未披露 →0
    // security.enterprise_compliance="…（PARTIAL：无独立认证细节页）" →0.5；data_usage="（PARTIAL：无独立数据政策页）" →0
    // 驻留未披露 →0；admin.org_tier →0.5
    sso_scim: 0.5,
    audit_compliance: 0,
    dpa_gdpr: 0,
    certification: 0.5,
    training_excluded: 0,
    residency: 0,
    admin: 0.5,
  },
  "amazon-q-developer": {
    // admin.iam_identity_center="IAM Identity Center dashboard (Pro)" →1；审计未披露 →0；DPA 未披露 →0
    // 认证未披露 →0；data_usage="Pro automatically opted out" →1；驻留未披露 →0
    // security.reference_tracking/suppress_public_code/ip_indemnity (Pro) + admin.per_use_activation →1
    sso_scim: 1,
    audit_compliance: 0,
    dpa_gdpr: 0,
    certification: 0,
    training_excluded: 1,
    residency: 0,
    admin: 1,
  },
  tabnine: {
    // admin.sso=true、auditability=true →1；DPA 未披露 →0
    // security.certification="SOC2+ISO27001" →1；security.no_training=true + data_usage="zero retention" →1
    // security.deployment="VPC+on-prem+air-gapped" →1；admin.governance/analytics/per_user_llm_control →1
    sso_scim: 1,
    audit_compliance: 1,
    dpa_gdpr: 0,
    certification: 1,
    training_excluded: 1,
    residency: 1,
    admin: 1,
  },
}

/** 任务效果基准映射：claude-code ← claude 实测；openai-codex ← codex 实测；其余无基准数据 */
export const TASK_SCORE_BY_TOOL: Record<string, { meanQuality: number; benchmarkTool: string } | null> = {
  "github-copilot": null, // NOT_TESTED
  cursor: null, // NOT_TESTED
  "claude-code": { meanQuality: 5, benchmarkTool: "claude" },
  "openai-codex": { meanQuality: 4.33, benchmarkTool: "codex" },
  "windsurf-devin": null, // 无基准数据
  "jetbrains-ai": null, // 无基准数据
  "amazon-q-developer": null, // 无基准数据
  tabnine: null, // 无基准数据
}

/** 权重归一化：W_k = w_k / Σ；三者全 0 → 等权 1/3 */
export function normalizeWeights(w: Weights): { cost: number; security: number; task: number } {
  const sum = w.cost + w.security + w.task
  if (sum <= 0) return { cost: 1 / 3, security: 1 / 3, task: 1 / 3 }
  return { cost: w.cost / sum, security: w.security / sum, task: w.task / sum }
}

export interface SecurityScoreResult {
  score: number // 0-100
  totalWeight: number
  earnedWeight: number
  perDimension: { key: string; label: string; indicator: number; weight: number }[]
}

/** 安全得分 = 100 × Σ(维度权重×指示) / Σ(维度权重)；工具无表 → 0 并标注「安全信息未披露」 */
export function securityScore(toolId: string): SecurityScoreResult {
  const indicators = SECURITY_INDICATORS[toolId]
  if (!indicators) {
    return { score: 0, totalWeight: 0, earnedWeight: 0, perDimension: [] }
  }
  const perDimension = SECURITY_CHECKLIST.map((d) => ({
    key: d.key,
    label: d.label,
    indicator: indicators[d.key] ?? 0,
    weight: d.weight,
  }))
  const totalWeight = perDimension.reduce((s, d) => s + d.weight, 0)
  const earnedWeight = perDimension.reduce((s, d) => s + d.indicator * d.weight, 0)
  const score = totalWeight > 0 ? (100 * earnedWeight) / totalWeight : 0
  return { score: round1(score), totalWeight, earnedWeight, perDimension }
}

/** 任务效果得分 = 100 × mean_quality / 5；无基准 → null（不可评分） */
export function taskScore(toolId: string): { score: number | null; meanQuality: number | null } {
  const entry = TASK_SCORE_BY_TOOL[toolId]
  if (!entry) return { score: null, meanQuality: null }
  return { score: round1((100 * entry.meanQuality) / 5), meanQuality: entry.meanQuality }
}

export interface ToolScore {
  toolId: string
  toolName: string
  costScore: number
  securityScore: number | null
  securityNote?: string
  taskScore: number | null
  taskNote?: string
  composite: number
  weightUsed: { cost: number; security: number; task: number }
  hasTaskDimension: boolean // 是否计入任务效果维度
  totalAnnual: number | null
  notComparable?: boolean
}

/**
 * 综合评分排序（可比工具，cline-aider NOT-COMPARABLE 排除）。
 * 成本得分基于当前 N/强度档下 8 个可比工具年度总成本 min-max；
 * NOT_TESTED/无实测工具去掉任务效果维度，对剩余权重在各自和上重归一化。
 */
export function computeScores(params: {
  rows: AnnualCostBreakdown[]
  toolNames: Record<string, string>
  weights: Weights
}): ToolScore[] {
  const { rows, toolNames, weights } = params
  const totals = rows.map((r) => r.totalAnnual ?? 0)
  const maxCost = Math.max(...totals)
  const minCost = Math.min(...totals)
  const costSpan = maxCost - minCost

  return rows.map((r) => {
    const costScore = costSpan <= 0 ? 100 : (100 * (maxCost - (r.totalAnnual ?? 0))) / costSpan
    const sec = securityScore(r.tool)
    const tk = taskScore(r.tool)
    const hasTask = tk.score !== null

    const W = normalizeWeights(weights)
    // 无任务效果维度时：对剩余两权重在各自和上重归一化
    let composite: number
    let weightUsed = W
    if (hasTask) {
      composite = W.cost * round1(costScore) + W.security * sec.score + W.task * (tk.score as number)
    } else {
      const rem = W.cost + W.security
      const wCost = rem > 0 ? W.cost / rem : 0.5
      const wSec = rem > 0 ? W.security / rem : 0.5
      weightUsed = { cost: wCost, security: wSec, task: 0 }
      composite = wCost * round1(costScore) + wSec * sec.score
    }
    return {
      toolId: r.tool,
      toolName: toolNames[r.tool] ?? r.tool,
      costScore: round1(costScore),
      securityScore: round1(sec.score),
      securityNote: sec.totalWeight === 0 ? "安全信息未披露" : undefined,
      taskScore: tk.score,
      taskNote: tk.score === null ? "未实测（NOT_TESTED）：评分不含任务效果维度" : undefined,
      composite: round1(composite),
      weightUsed,
      hasTaskDimension: hasTask,
      totalAnnual: r.totalAnnual,
    }
  })
}

/** 综合评分降序排序 */
export function rankScores(scores: ToolScore[]): ToolScore[] {
  return [...scores].sort((a, b) => b.composite - a.composite)
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}
