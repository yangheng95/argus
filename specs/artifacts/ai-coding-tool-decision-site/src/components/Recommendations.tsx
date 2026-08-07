// S5 推荐方案 / 风险 / 试点计划：R1-R6 原文逐条渲染 + limitations 风险 + 试点摘要
import { For } from "solid-js"
import { MarkerBadge } from "./MarkerBadge"

interface Props {
  siteData: any
}

export function Recommendations(props: Props) {
  const recs = props.siteData.recommendations as {
    id: string
    recommendation: string
    rationale: string
    condition: string
    fact_check_note?: string
  }[]
  const limitations = props.siteData.limitations as {
    id: string
    limitation: string
    impact: string
  }[]

  return (
    <section class="section-card" id="recommendations">
      <h2 class="section-title">推荐方案 / 风险 / 试点计划</h2>
      <p class="section-subtitle">
        R1-R6 原文来自 Phase 01 官方复核成果（recommendations 数组）；风险引用 limitations L1-L7；试点计划为 10 人团队 4
        周试点摘要。
      </p>

      {/* R1-R6 */}
      <h3 class="text-base font-semibold text-gray-800 mt-2 mb-3">推荐方案（R1–R6，原文）</h3>
      <div class="space-y-3">
        <For each={recs}>
          {(r) => (
            <div class="rounded-lg border border-gray-200 p-4">
              <div class="flex items-start gap-2">
                <span class="shrink-0 inline-flex items-center justify-center rounded bg-blue-600 text-white text-xs font-bold px-2 py-1">
                  {r.id}
                </span>
                <div>
                  <p class="text-sm font-medium text-gray-900 leading-relaxed">{r.recommendation}</p>
                  <p class="text-[12px] text-gray-600 mt-1">
                    <span class="text-gray-400">理由：</span>
                    {r.rationale}
                  </p>
                  <p class="text-[12px] text-gray-600 mt-0.5">
                    <span class="text-gray-400">适用条件：</span>
                    {r.condition}
                  </p>
                  {r.fact_check_note && <p class="text-[11px] text-gray-400 mt-1">fact-check：{r.fact_check_note}</p>}
                </div>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* 风险 */}
      <h3 class="text-base font-semibold text-gray-800 mt-6 mb-3">主要风险（limitations L1–L7，原文）</h3>
      <div class="overflow-x-auto">
        <table class="border-collapse w-full min-w-[800px]">
          <thead>
            <tr>
              <th class="mat-head w-[64px]">编号</th>
              <th class="mat-head">风险描述</th>
              <th class="mat-head">影响</th>
            </tr>
          </thead>
          <tbody>
            <For each={limitations}>
              {(l) => (
                <tr>
                  <td class="mat-cell font-semibold text-gray-800">
                    {l.id}
                    {l.id === "L1" && (
                      <div class="mt-1">
                        <MarkerBadge marker="STALE" title="交付超 14 天需标 STALE" />
                      </div>
                    )}
                  </td>
                  <td class="mat-cell">{l.limitation}</td>
                  <td class="mat-cell">{l.impact}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      {/* 试点计划 */}
      <h3 class="text-base font-semibold text-gray-800 mt-6 mb-3">10 人团队 4 周试点计划（摘要）</h3>
      <div class="rounded-lg bg-gray-50 border border-gray-200 p-4 text-[13px] text-gray-700 space-y-2">
        <p>
          <span class="font-semibold">目标</span>：在最小预算与治理成本下验证「Copilot Business + Claude
          Code」组合（R1） 在 OpenCorvus 真实工程形态（TypeScript/Bun monorepo、CLI+Agent
          工作流）上的质量、效率与合规，并保留 R2 备选路径。
        </p>
        <p>
          <span class="font-semibold">W1（准备）</span>：采购开通 Copilot Business（10 seats）+ Claude Team Standard（10
          seats）； 建立隔离评测环境；录制四包 typecheck/test 全绿基线。
        </p>
        <p>
          <span class="font-semibold">W2（实测）</span>：用 T1（跨包修改）/T2（缺陷调查）/T3（测试）类真实任务运行
          Claude Code； Copilot 用于 IDE 补全与日常 agent 任务；每任务记录 quality / duration / human_interventions /
          修改范围 / 验证结果。
        </p>
        <p>
          <span class="font-semibold">W3（扩展）</span>：覆盖 T4（代码审查）/T5（文档研究）/T6（跨包接口）任务面；
          每周独立复核（类型探针/契约测试抽查）；既有契约测试保持全绿。
        </p>
        <p>
          <span class="font-semibold">W4（决策）</span>：汇总指标；对照 R2 预算敏感替代（Codex/Amazon Q 单价）与 R3/R4
          备选；形成采购决策书。
        </p>
        <p class="text-[12px] text-gray-500">
          试点指标：验收命令通过率 ≥90%；类型探针/契约测试零回归；人工介入 0-2 次/任务；成本（$228+$240/人/年）vs
          预算；SSO/审计/无训练默认策略确认。 退出条件：通过（扩至 30 人）/ 不通过（转 R2 或重评）/ 灰度（延长 2
          周）。完整原文见 Phase 01 报告 §6.3。
        </p>
      </div>
    </section>
  )
}
