// S6 数据来源与新鲜度：来源文件+sha256、12 个官方 source_urls、访问日期 2026-08-01/复核 2026-08-02
// STALE 动态判定：当前日期 - 2026-08-01 > 14 天 → STALE 徽标+复核提示（动态计算，非静态文案）
import { For } from "solid-js"
import type { FreshnessResult } from "../lib/freshness"
import { MarkerBadge } from "./MarkerBadge"

interface Props {
  siteData: any
  freshness: FreshnessResult
}

export function DataFreshness(props: Props) {
  const tools = props.siteData.tools as {
    id: string
    name: string
    source_urls: string[]
    access_date: string
  }[]
  const costSources = props.siteData.cost_model.source_urls as Record<string, string>
  const markers = props.siteData.markers as Record<string, { label: string; meaning: string; where: string[] }>

  return (
    <section class="section-card" id="freshness">
      <h2 class="section-title">数据来源与新鲜度</h2>
      <p class="section-subtitle">
        全部价格/额度/政策数据来自 Phase 01 官方复核成果（imported data.json），访问日期 2026-08-01，2026-08-02 复核
        12/12 官方 URL 一致。
      </p>

      {/* 新鲜度状态 */}
      <div class="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4 flex-wrap">
        <div class="text-sm text-gray-700">
          访问日期快照：<span class="font-semibold">{props.freshness.accessDate}</span> · 复核日期：
          <span class="font-semibold">{props.freshness.reviewDate}</span>（12/12 一致）· 今天：
          <span class="font-semibold">{props.freshness.today}</span> · 距访问日{" "}
          <span class="font-semibold">{props.freshness.daysSinceAccess}</span> 天
        </div>
        {props.freshness.stale ? (
          <span class="inline-flex items-center gap-2">
            <MarkerBadge marker="STALE" />
            <span class="text-sm text-red-700 font-medium">
              数据已超 {props.freshness.thresholdDays} 天未复核，采购前必须按厂商官方页复核（limitations.L1）。
            </span>
          </span>
        ) : (
          <span class="text-sm text-green-700">
            数据在 {props.freshness.thresholdDays} 天新鲜期内（{props.freshness.thresholdDays}{" "}
            天规则，limitations.L1）。
          </span>
        )}
      </div>

      {/* 来源文件 */}
      <div class="rounded-lg bg-gray-50 border border-gray-200 p-4 mb-4">
        <p class="text-sm font-medium text-gray-700 mb-1">数据来源文件（Phase 01 终态，sha256）</p>
        <ul class="text-[12px] text-gray-600 font-mono space-y-1">
          <li>specs/artifacts/ai-coding-tools-selection-data.json — {props.siteData.provenance.source_sha256}</li>
          <li>
            specs/artifacts/ai-coding-tools-selection-report.md —
            aadd1bf100e572302b2fcada46fb4f72e17233d3afe814aec4b624c6a15f9fae
          </li>
          <li>
            specs/artifacts/ai-coding-tools-selection-review-2026-08-02.md —
            35275d37cc0ed1e531659e8d5e53d588ba5298ed359725d6d4657252389763a3
          </li>
          <li>
            本站数据文件：specs/artifacts/ai-coding-tool-decision-site/data/site-data.json（派生，provenance 见文件头）
          </li>
        </ul>
      </div>

      {/* 官方 URL */}
      <div class="rounded-lg bg-gray-50 border border-gray-200 p-4 mb-4">
        <p class="text-sm font-medium text-gray-700 mb-1">官方 source_urls（12 个，2026-08-02 复核一致）</p>
        <ul class="text-[12px] text-gray-600 space-y-1">
          <For each={tools}>
            {(t) => (
              <li>
                <span class="font-medium text-gray-700">{t.name}</span>（{t.access_date}）：
                <For each={t.source_urls}>
                  {(u, i) => (
                    <span>
                      <a href={u} target="_blank" rel="noreferrer" class="text-blue-600 hover:underline break-all">
                        {u}
                      </a>
                      {i() < t.source_urls.length - 1 && "、"}
                    </span>
                  )}
                </For>
              </li>
            )}
          </For>
          <li>
            <span class="font-medium text-gray-700">成本模型来源</span>：{" "}
            <For each={Object.entries(costSources)}>
              {([tool, url], i) => (
                <span>
                  {tool}=
                  <a href={url} target="_blank" rel="noreferrer" class="text-blue-600 hover:underline break-all">
                    {url}
                  </a>
                  {i() < Object.entries(costSources).length - 1 && "；"}
                </span>
              )}
            </For>
          </li>
        </ul>
      </div>

      {/* 标记位语义表 */}
      <div class="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <p class="text-sm font-medium text-gray-700 mb-2">标记位语义表（原样展示，禁止换算成数值）</p>
        <table class="border-collapse w-full">
          <thead>
            <tr>
              <th class="mat-head w-[150px]">标记</th>
              <th class="mat-head">含义</th>
              <th class="mat-head">出现位置</th>
            </tr>
          </thead>
          <tbody>
            <For each={Object.values(markers)}>
              {(m) => (
                <tr>
                  <td class="mat-cell">
                    <MarkerBadge marker={m.label as any} />
                  </td>
                  <td class="mat-cell">{m.meaning}</td>
                  <td class="mat-cell">{m.where.join("；")}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  )
}
