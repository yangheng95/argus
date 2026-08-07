// S2 工具对比矩阵：7 维（价格档位/IDE 支持/CLI/Agent 能力/管理面/安全/数据使用）+ 实测列 + 成本列
// 标记位原样展示：NOT-COMPARABLE（cline-aider 排除主矩阵）/ PARTIAL（Enterprise 档等）
import { For, Show } from "solid-js"
import { MarkerSet, type MarkerKey } from "./MarkerBadge"
import type { SeatCostRow } from "../lib/cost"

interface ToolJson {
  id: string
  name: string
  pricing_tiers: { tier: string; monthly_cost_original: string; currency: string }[]
  usage_allowance: string
  ide_support: string[]
  cli: boolean
  agent_capability: string
  admin_dimensions: Record<string, string | boolean | undefined>
  security_dimensions: Record<string, string | boolean | undefined>
  data_usage: string
  source_urls: string[]
  access_date: string
  comparability: string
  comparability_partial_notes?: string
  not_comparable_reason?: string
}

interface Props {
  tools: ToolJson[]
  seatRows: SeatCostRow[]
  N: number
  nValid: boolean
}

/** 实测映射：claude-code ← claude；openai-codex ← codex；其余 NOT_TESTED/无基准 */
const BENCH_BY_TOOL: Record<string, { toolId: string; meanQuality: number; totalDuration: number } | null> = {
  "github-copilot": null,
  cursor: null,
  "claude-code": { toolId: "claude", meanQuality: 5.0, totalDuration: 25.42 },
  "openai-codex": { toolId: "codex", meanQuality: 4.33, totalDuration: 22.3 },
  "windsurf-devin": null,
  "jetbrains-ai": null,
  "amazon-q-developer": null,
  tabnine: null,
}

function markTool(tool: ToolJson): MarkerKey[] {
  const m: MarkerKey[] = []
  if (tool.comparability === "NOT-COMPARABLE") m.push("NOT-COMPARABLE")
  if (tool.comparability === "PARTIAL") m.push("PARTIAL")
  if (tool.id === "windsurf-devin" || tool.id === "jetbrains-ai") m.push("PARTIAL")
  return m
}

function tierCell(tool: ToolJson) {
  return (
    <ul class="space-y-1">
      <For each={tool.pricing_tiers}>
        {(t) => (
          <li>
            <span class="font-medium text-gray-800">{t.tier}</span>：{t.monthly_cost_original}
            <Show when={t.monthly_cost_original.includes("(PARTIAL)")}>
              {" "}
              <MarkerSet markers={["PARTIAL"]} title="官方档位价格不完整" />
            </Show>
          </li>
        )}
      </For>
    </ul>
  )
}

function adminCell(tool: ToolJson) {
  const entries = Object.entries(tool.admin_dimensions)
  if (entries.length === 0) return <span class="text-gray-400">—</span>
  return (
    <ul class="space-y-1">
      <For each={entries}>
        {([k, v]) => (
          <li>
            <span class="font-medium text-gray-800">{k}</span>：{String(v)}
          </li>
        )}
      </For>
    </ul>
  )
}

function securityCell(tool: ToolJson) {
  const entries = Object.entries(tool.security_dimensions)
  if (entries.length === 0) return <span class="text-gray-400">—</span>
  return (
    <ul class="space-y-1">
      <For each={entries}>
        {([k, v]) => (
          <li>
            <span class="font-medium text-gray-800">{k}</span>：{String(v)}
            <Show when={String(v).includes("PARTIAL")}>
              {" "}
              <MarkerSet markers={["PARTIAL"]} />
            </Show>
          </li>
        )}
      </For>
    </ul>
  )
}

function benchCell(toolId: string) {
  const b = BENCH_BY_TOOL[toolId]
  if (!b) {
    return (
      <div class="space-y-1">
        <MarkerSet markers={["NOT_TESTED"]} title="本机 CLI 不可用/无基准数据，未实测" />
        <p class="text-[11px] text-gray-400">Agent 能力/质量仅官方文档支撑（L3）</p>
      </div>
    )
  }
  return (
    <div class="space-y-1">
      <p>
        <span class="font-semibold text-gray-900">quality {b.meanQuality}/5</span> · 总耗时 {b.totalDuration} min
      </p>
      <p class="text-[11px] text-gray-400">基准：{b.toolId}（Phase 01 实测，12 次运行）</p>
    </div>
  )
}

function costCell(toolId: string, seatRows: SeatCostRow[], N: number, nValid: boolean) {
  const row = seatRows.find((r) => r.tool === toolId)
  if (!row) return <span class="text-gray-400">—</span>
  const seatAnnual = row.tool === "windsurf-devin" ? 480 * N + 960 : row.per_seat_annual_usd * N
  return (
    <div class="space-y-1">
      <p class="font-semibold text-gray-900">
        {nValid ? `$${seatAnnual.toLocaleString("en-US")}` : "—"}
        <span class="text-gray-400 font-normal"> / 年（{N} 人）</span>
      </p>
      <p class="text-[11px] text-gray-400">{row.team_plan}</p>
      <p class="text-[11px] text-gray-400">{row.unit_price_original}</p>
    </div>
  )
}

export function ComparisonMatrix(props: Props) {
  return (
    <section class="section-card" id="matrix">
      <h2 class="section-title">工具对比矩阵（7 维 + 实测 + 成本）</h2>
      <p class="section-subtitle">
        官方事实保留原文（访问日期 2026-08-01，2026-08-02 复核一致）；NOT-COMPARABLE 工具（Cline/Aider）按章程 §3.3
        排除主矩阵。
      </p>
      <div class="overflow-x-auto">
        <table class="border-collapse w-full min-w-[1180px]">
          <thead>
            <tr>
              <th class="mat-head w-[130px]">维度</th>
              <For each={props.tools}>
                {(t) => (
                  <th class="mat-head min-w-[150px]">
                    <div class="flex items-center gap-1 flex-wrap">
                      <span class="font-semibold text-gray-900">{t.name}</span>
                      <MarkerSet markers={markTool(t)} />
                    </div>
                    <span class="text-[10px] text-gray-400 font-normal">{t.access_date}</span>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            {/* 价格档位 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">价格档位</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{tierCell(t)}</td>}</For>
            </tr>
            {/* 额度 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">额度</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{t.usage_allowance}</td>}</For>
            </tr>
            {/* IDE 支持 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">IDE 支持</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{t.ide_support.join(" / ")}</td>}</For>
            </tr>
            {/* CLI */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">CLI</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{t.cli ? "是" : "否"}</td>}</For>
            </tr>
            {/* Agent 能力 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">Agent 能力</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{t.agent_capability}</td>}</For>
            </tr>
            {/* 企业管理 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">企业管理</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{adminCell(t)}</td>}</For>
            </tr>
            {/* 安全 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">安全</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{securityCell(t)}</td>}</For>
            </tr>
            {/* 数据使用 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">数据使用</td>
              <For each={props.tools}>
                {(t) => (
                  <td class="mat-cell">
                    {t.data_usage}
                    <Show when={t.data_usage.includes("PARTIAL")}>
                      {" "}
                      <MarkerSet markers={["PARTIAL"]} title="数据政策无法从官方完全确认" />
                    </Show>
                  </td>
                )}
              </For>
            </tr>
            {/* 实测 */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">实测（quality/duration）</td>
              <For each={props.tools}>{(t) => <td class="mat-cell">{benchCell(t.id)}</td>}</For>
            </tr>
            {/* 成本（当前 N） */}
            <tr>
              <td class="mat-cell font-medium text-gray-900">
                成本（{props.nValid ? `${props.N} 人` : "N 无效"}，席位/年）
              </td>
              <For each={props.tools}>
                {(t) => <td class="mat-cell">{costCell(t.id, props.seatRows, props.N, props.nValid)}</td>}
              </For>
            </tr>
          </tbody>
        </table>
      </div>
      <Show when={!props.nValid}>
        <p class="text-xs text-red-600 mt-2">N 非正整数，成本列不展示数值。</p>
      </Show>
      <p class="text-[11px] text-gray-400 mt-2">
        NOT-COMPARABLE（Cline/Aider）：无官方企业定价/政策，按章程 §3.3 排除主矩阵，成本与评分均不纳入。
        PARTIAL：官方存在但信息不完整/页面失效（如 Enterprise 档 custom/varies、Windsurf 数据政策、JetBrains
        认证细节）。
      </p>
    </section>
  )
}
