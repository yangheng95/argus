// S4 综合评分排序：成本/安全/任务效果得分 + 综合评分（公式可见），降序排序 + TOP 高亮 + R 徽标
import { For, Show, createMemo } from "solid-js"
import type { ToolScore } from "../lib/scoring"
import { SECURITY_CHECKLIST, SECURITY_INDICATORS } from "../lib/scoring"
import { MarkerBadge, MarkerSet, type MarkerKey } from "./MarkerBadge"
import { EChart } from "./EChart"
import type { DecisionParams } from "../App"

interface Props {
  scores: ToolScore[]
  weights: DecisionParams
  siteData: any
}

/** 工具 → R 推荐徽标（R1-R6 映射，来自 implementation-plan recommendation_highlight_mapping） */
const RECOMMENDATION_BADGES: { badge: string; tools: string[] }[] = [
  { badge: "R1 组合首选", tools: ["github-copilot", "claude-code"] },
  { badge: "R2 预算替代", tools: ["openai-codex", "amazon-q-developer"] },
  { badge: "R3 IDE 原生", tools: ["cursor"] },
  { badge: "R4 生态替代", tools: ["jetbrains-ai", "amazon-q-developer"] },
  { badge: "R5 排除/谨慎", tools: ["cline-aider", "windsurf-devin"] },
]

function recBadges(toolId: string): string[] {
  return RECOMMENDATION_BADGES.filter((r) => r.tools.includes(toolId)).map((r) => r.badge)
}

function scoreBar(value: number) {
  return (
    <div class="flex items-center gap-2">
      <div class="h-2 bg-gray-100 rounded flex-1 overflow-hidden">
        <div class="h-full bg-blue-500 rounded" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span class="text-sm font-semibold text-gray-800 w-12 text-right">{value}</span>
    </div>
  )
}

export function ScoreRanking(props: Props) {
  const topN = props.scores[0]?.composite ?? 0
  return (
    <section class="section-card" id="ranking">
      <h2 class="section-title">综合评分排序</h2>
      <p class="section-subtitle">
        综合评分 = W_cost×成本得分 + W_security×安全得分 + W_task×任务效果得分（0-100，降序）；TOP 名次高亮；
        NOT_TESTED/无实测工具评分不含任务效果维度（剩余权重重归一化）；Cline/Aider（NOT-COMPARABLE）不进入评分。
      </p>

      {/* 公式可见 */}
      <div class="formula-box">
        成本得分 = 100 × (总成本max − 总成本i) / (总成本max − 总成本min)（当前 N/强度档下 8 个可比工具 min-max；max=min
        → 全 100）。
        <br />
        安全得分 = 100 × Σ(维度权重 × 指示值) / Σ(维度权重)；指示 1=官方明确支持 / 0.5=PARTIAL·部分披露 / 0=未披露；7 维
        checklist 见下方。
        <br />
        任务效果得分 = 100 × mean_quality / 5（官方 1-5 尺度）；claude=100、codex=86.6。
        <br />
        权重归一化 W_k = w_k / Σw；NOT_TESTED/无实测工具去掉任务效果维度，对剩余两权重在各自和上重归一化。
        <br />
        当前权重：成本 {props.weights.weightCost}% · 安全 {props.weights.weightSecurity}% · 任务效果{" "}
        {props.weights.weightTask}%。
      </div>

      {/* 综合评分 ECharts 对比图（成熟图表库，本地化无 CDN） */}
      <EChart
        id="score-chart"
        height={340}
        option={createMemo(() => ({
          title: {
            text: `综合评分对比（成本 ${props.weights.weightCost}% · 安全 ${props.weights.weightSecurity}% · 任务效果 ${props.weights.weightTask}%）`,
            left: "center",
            textStyle: { fontSize: 14, fontWeight: 600 },
          },
          tooltip: {
            trigger: "axis",
            axisPointer: { type: "shadow" },
            formatter: (params: any) => {
              const p = Array.isArray(params) ? params[0] : params
              const s = props.scores[p.dataIndexScoreId]
              if (!s) return ""
              return `<b>${s.toolName}</b><br/>综合：${s.composite}<br/>成本得分：${s.costScore}<br/>安全得分：${s.securityScore ?? "—"}<br/>任务效果：${s.taskScore ?? "未实测（NOT_TESTED）"}`
            },
          },
          grid: { left: 150, right: 60, top: 48, bottom: 40 },
          xAxis: {
            type: "value",
            min: 0,
            max: 100,
            name: "综合评分（0-100）",
          },
          yAxis: {
            type: "category",
            inverse: true,
            data: props.scores.map((s) => s.toolName),
            axisLabel: { fontSize: 11 },
          },
          series: [
            {
              type: "bar",
              data: props.scores.map((s) => ({
                value: s.composite,
                dataIndexScoreId: s.toolId,
                itemStyle: {
                  color: s.hasTaskDimension ? "#3b82f6" : "#a855f7",
                },
              })),
              label: {
                show: true,
                position: "right",
                formatter: (p: any) => String(p.value),
                fontSize: 11,
              },
              barMaxWidth: 26,
            },
          ],
        }))()}
      />
      <p class="text-[11px] text-gray-400 -mt-2 mb-3">
        蓝色=含任务效果维度；紫色=未实测（NOT_TESTED），评分不含任务效果维度（剩余权重重归一化）。
      </p>

      <div class="overflow-x-auto">
        <table class="border-collapse w-full min-w-[1050px]">
          <thead>
            <tr>
              <th class="mat-head w-[44px]">名次</th>
              <th class="mat-head w-[210px]">工具</th>
              <th class="mat-head w-[140px]">综合评分</th>
              <th class="mat-head w-[170px]">成本得分</th>
              <th class="mat-head w-[170px]">安全得分</th>
              <th class="mat-head w-[190px]">任务效果得分</th>
              <th class="mat-head">推荐徽标 / 备注</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.scores}>
              {(s, i) => {
                const isTop = i() === 0
                const markers: MarkerKey[] = []
                if (!s.hasTaskDimension) markers.push("NOT_TESTED")
                return (
                  <tr class={isTop ? "bg-yellow-50" : i() % 2 === 1 ? "bg-gray-50/50" : ""}>
                    <td class="mat-cell text-center">
                      <span
                        class={`inline-flex items-center justify-center rounded-full w-7 h-7 text-sm font-bold ${
                          i() === 0
                            ? "bg-yellow-400 text-yellow-950"
                            : i() === 1
                              ? "bg-gray-300 text-gray-800"
                              : i() === 2
                                ? "bg-orange-300 text-orange-950"
                                : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {i() + 1}
                      </span>
                    </td>
                    <td class="mat-cell">
                      <div class="font-semibold text-gray-900">{s.toolName}</div>
                      <div class="text-[11px] text-gray-400">{s.toolId}</div>
                    </td>
                    <td class="mat-cell">
                      <div class="text-xl font-bold text-gray-900">{s.composite}</div>
                      {isTop && <span class="text-[11px] text-yellow-700 font-medium">TOP 推荐</span>}
                    </td>
                    <td class="mat-cell">{scoreBar(s.costScore)}</td>
                    <td class="mat-cell">
                      <Show when={s.securityScore !== null} fallback={<span class="text-gray-400">—</span>}>
                        {scoreBar(s.securityScore as number)}
                        {s.securityNote && <div class="text-[10px] text-orange-600 mt-1">{s.securityNote}</div>}
                      </Show>
                    </td>
                    <td class="mat-cell">
                      <Show
                        when={s.taskScore !== null}
                        fallback={
                          <div class="space-y-1">
                            <span class="text-gray-400">—</span>
                            <MarkerSet markers={markers} title="未实测：评分不含任务效果维度" />
                          </div>
                        }
                      >
                        {scoreBar(s.taskScore as number)}
                      </Show>
                    </td>
                    <td class="mat-cell">
                      <div class="flex flex-wrap gap-1">
                        <For each={recBadges(s.toolId)}>
                          {(b) => (
                            <span class="inline-block rounded bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 text-[11px] font-medium">
                              {b}
                            </span>
                          )}
                        </For>
                        {s.taskNote && <span class="text-[11px] text-gray-500">{s.taskNote}</span>}
                      </div>
                    </td>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
      </div>

      {/* 安全 7 维 checklist（来源：imported data.json security_dimensions/admin_dimensions/comparability） */}
      <div class="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-4">
        <p class="text-sm font-medium text-gray-700 mb-2">安全 7 维 checklist（指示值来源）</p>
        <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-gray-600">
          <For each={SECURITY_CHECKLIST}>
            {(d) => (
              <div class="flex items-center justify-between gap-2">
                <span>{d.label}</span>
                <span class="text-gray-400">权重 {d.weight}</span>
              </div>
            )}
          </For>
        </div>
        <p class="text-[11px] text-gray-400 mt-2">
          指示值判定：1=官方明确支持；0.5=PARTIAL/官方部分披露（如 Enterprise 专属认证、需开启的 Privacy
          Mode、文档提及无独立页）； 0=官方未披露。各工具指示值表见{" "}
          <code class="font-mono">src/lib/scoring.ts SECURITY_INDICATORS</code>，字段来自 imported data.json。
        </p>
      </div>
    </section>
  )
}
