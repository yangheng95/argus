// S3 年度成本模型：席位成本 + 超额成本（仅官方可换算单位）+ 年度总成本
// 公式可见：席位成本=官方单价×12×N（Windsurf=480×N+960）；超额按官方换算单位；NO_CONVERSION →「不可换算（官方无公开换算依据）」
import { For, Show, createMemo } from "solid-js"
import type { AnnualCostBreakdown, Intensity, OverageInputs } from "../lib/cost"
import { MarkerBadge, MarkerSet, type MarkerKey } from "./MarkerBadge"
import { EChart } from "./EChart"

const TOOL_DISPLAY: Record<string, string> = {
  "github-copilot": "GitHub Copilot",
  cursor: "Cursor (Anysphere)",
  "claude-code": "Claude Code (Anthropic)",
  "openai-codex": "OpenAI Codex",
  "windsurf-devin": "Windsurf (merged into Devin)",
  "jetbrains-ai": "JetBrains AI Assistant",
  "amazon-q-developer": "Amazon Q Developer",
  tabnine: "Tabnine (Tricentis)",
}

interface Props {
  annual: AnnualCostBreakdown[]
  N: number
  intensity: Intensity
  overage: OverageInputs
  nValid: boolean
  siteData: any
}

function overageCell(b: AnnualCostBreakdown) {
  if (b.overage.kind === "number") {
    return (
      <div class="space-y-1">
        <p class="font-semibold text-gray-900">
          {b.overage.annualTotalUsd > 0 ? `$${b.overage.annualTotalUsd.toLocaleString("en-US")}` : "$0"}
          <span class="text-gray-400 font-normal"> / 年</span>
        </p>
        <p class="text-[11px] text-gray-500 font-mono">{b.overage.formula}</p>
        {b.overage.assumed && <MarkerSet markers={["ASSUMED"]} title="用量为假设（章程 §3.1），非官方口径" />}
      </div>
    )
  }
  if (b.overage.kind === "no_conversion") {
    return (
      <div class="space-y-1">
        <MarkerBadge marker="NO_CONVERSION" title="官方无公开换算依据" />
        <p class="text-[11px] text-gray-500">{b.overage.note}（禁止估计）</p>
      </div>
    )
  }
  return <p class="text-[11px] text-gray-500">{b.overage.note}</p>
}

export function CostModel(props: Props) {
  // createMemo：props.annual 是响应式，普通 const 只在函数体执行一次会冻结快照
  const rows = createMemo(() => props.annual)
  return (
    <section class="section-card" id="cost">
      <h2 class="section-title">年度成本模型（席位 + 超额 + 年度总成本）</h2>
      <p class="section-subtitle">
        当前参数：N={props.nValid ? props.N : "（无效）"} 人 · 强度={props.intensity}（ASSUMED
        非官方口径）。全部价格/政策来自 Phase 01 官方复核成果（访问日期 2026-08-01）。
      </p>

      {/* 公式可见 */}
      <div class="formula-box">
        席位成本(USD/年) = 官方单价 × 12 × N（Windsurf 特殊公式 = 480×N + 960 平台费）。
        <br />
        超额成本仅按官方可换算单位计算：Cursor $0.25/MTok（强度档 ASSUMED token 区间，闭区间取中点/开区间取下限）、
        JetBrains 1 credit=$1（超额=(消耗−70)×$1）、Amazon Q $0.003/LOC（超额=(LOC−4000)×$0.003）、 Tabnine LLM=provider
        价格+5%。NO_CONVERSION 项 → 「不可换算（官方无公开换算依据）」，禁止估计。
        <br />
        年度总成本 = 席位成本 + 超额成本（月度化 ×12）；NO_CONVERSION 工具仅计席位并标注「未含超额」；Enterprise 档
        PARTIAL 不纳入模型（L2）。
      </div>

      {/* 年度总成本 ECharts 对比图（成熟图表库，本地化无 CDN） */}
      <Show when={props.nValid}>
        <EChart
          id="cost-chart"
          height={360}
          option={createMemo(() => ({
            title: {
              text: `年度总成本对比（${props.N} 人 · ${props.intensity}）`,
              left: "center",
              textStyle: { fontSize: 14, fontWeight: 600 },
            },
            tooltip: {
              trigger: "axis",
              axisPointer: { type: "shadow" },
              formatter: (params: any) => {
                const p = Array.isArray(params) ? params[0] : params
                const b = props.annual.find((x) => x.tool === p.dataIndexToolId)
                if (!b) return ""
                return `<b>${TOOL_DISPLAY[b.tool] ?? b.tool}</b><br/>席位：$${b.seatAnnual.toLocaleString("en-US")}/年<br/>总成本：$${(b.totalAnnual ?? 0).toLocaleString("en-US")}/年${b.overage.kind === "no_conversion" ? "<br/>超额：不可换算（官方无公开换算依据）" : b.overage.kind === "number" ? `<br/>超额：$${b.overage.annualTotalUsd.toLocaleString("en-US")}/年` : ""}`
              },
            },
            grid: { left: 130, right: 60, top: 48, bottom: 40 },
            xAxis: {
              type: "value",
              name: "USD/年",
              axisLabel: { formatter: (v: number) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "K" : v}` },
            },
            yAxis: {
              type: "category",
              inverse: true,
              data: props.annual.map((b) => TOOL_DISPLAY[b.tool] ?? b.tool),
              axisLabel: { fontSize: 11 },
            },
            series: [
              {
                type: "bar",
                data: props.annual.map((b) => ({
                  value: b.totalAnnual ?? 0,
                  dataIndexToolId: b.tool,
                  itemStyle: {
                    color:
                      (b.totalAnnual ?? 0) === Math.min(...props.annual.map((x) => x.totalAnnual ?? 0))
                        ? "#16a34a"
                        : (b.totalAnnual ?? 0) === Math.max(...props.annual.map((x) => x.totalAnnual ?? 0))
                          ? "#dc2626"
                          : "#3b82f6",
                  },
                })),
                label: {
                  show: true,
                  position: "right",
                  formatter: (p: any) => `$${p.value >= 1000 ? (p.value / 1000).toFixed(1) + "K" : p.value}`,
                  fontSize: 10,
                },
                barMaxWidth: 26,
              },
            ],
          }))()}
        />
      </Show>

      <div class="overflow-x-auto">
        <table class="border-collapse w-full min-w-[1100px]">
          <thead>
            <tr>
              <th class="mat-head">工具（团队档位 / 官方单价原文）</th>
              <th class="mat-head w-[150px]">席位成本（{props.nValid ? `${props.N} 人` : "N 无效"} / 年）</th>
              <th class="mat-head w-[220px]">超额成本（强度档相关）</th>
              <th class="mat-head w-[160px]">年度总成本</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(b) => {
                const seatRow = (props.siteData as any).cost_model.per_tool_seat_cost.find(
                  (r: any) => r.tool === b.tool,
                )
                return (
                  <tr>
                    <td class="mat-cell">
                      <div class="font-semibold text-gray-900">{TOOL_DISPLAY[b.tool] ?? b.tool}</div>
                      <div class="text-[11px] text-gray-500">{seatRow?.team_plan}</div>
                      <div class="text-[11px] text-gray-500">{seatRow?.unit_price_original}</div>
                    </td>
                    <td class="mat-cell">
                      <div class="font-semibold text-gray-900">
                        {props.nValid ? `$${b.seatAnnual.toLocaleString("en-US")}` : "—"}
                      </div>
                      <div class="text-[11px] text-gray-500 font-mono">{b.seatFormula}</div>
                      {seatRow?.platform_fee_note && (
                        <div class="text-[11px] text-purple-700 mt-1">{seatRow.platform_fee_note}</div>
                      )}
                    </td>
                    <td class="mat-cell">{overageCell(b)}</td>
                    <td class="mat-cell">
                      {b.totalAnnual !== null && props.nValid ? (
                        <div class="space-y-1">
                          <p class="font-bold text-gray-900">${b.totalAnnual.toLocaleString("en-US")}</p>
                          <p class="text-[11px] text-gray-500">{b.totalFormula}</p>
                          {b.overage.kind === "no_conversion" && (
                            <MarkerSet markers={["NO_CONVERSION"]} title="超额不可换算，年度成本未含超额" />
                          )}
                          {b.overage.kind === "none" && (
                            <span class="text-[11px] text-gray-400">无超额（own-LLM unlimited）</span>
                          )}
                        </div>
                      ) : (
                        <span class="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={!props.nValid}>
        <p class="text-xs text-red-600 mt-2">N 非正整数，成本不展示数值。</p>
      </Show>
      <p class="text-[11px] text-gray-400 mt-2">
        注：Cursor/JetBrains/Amazon Q/Tabnine 超额依赖强度档 ASSUMED 用量或用户输入（非官方数字），已以 ASSUMED
        徽标标注； Copilot/Claude 订阅档/Codex/Windsurf 超额为 NO_CONVERSION（官方无公开换算依据），禁止估计；
        Enterprise 档价格多为 PARTIAL/custom，未纳入本模型（limitations.L2）。
      </p>
    </section>
  )
}
