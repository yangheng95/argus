// 采购决策网站主应用（Phase 02）
// 数据唯一来源：src/data/site-data.json（源自 Phase 01 imported data.json，provenance 见文件头）
import { createSignal, createMemo, Show } from "solid-js"
import siteData from "./data/site-data.json"
import { calcAllAnnual, DEFAULT_OVERAGE_INPUTS, type Intensity, type OverageInputs } from "./lib/cost"
import { computeScores, rankScores } from "./lib/scoring"
import { evaluateFreshness } from "./lib/freshness"
import { ParamPanel } from "./components/ParamPanel"
import { ComparisonMatrix } from "./components/ComparisonMatrix"
import { CostModel } from "./components/CostModel"
import { ScoreRanking } from "./components/ScoreRanking"
import { Recommendations } from "./components/Recommendations"
import { DataFreshness } from "./components/DataFreshness"
import { MarkerBadge, type MarkerKey } from "./components/MarkerBadge"

export interface DecisionParams {
  N: number
  intensity: Intensity
  weightCost: number
  weightSecurity: number
  weightTask: number
  overage: OverageInputs
}

/** 工具 id → 显示名（site-data.json tools[].name） */
const toolNames: Record<string, string> = Object.fromEntries(siteData.tools.map((t) => [t.id, t.name]))

export default function App() {
  const [N, setN] = createSignal<number>(10)
  const [intensity, setIntensity] = createSignal<Intensity>("STANDARD")
  const [weightCost, setWeightCost] = createSignal<number>(40)
  const [weightSecurity, setWeightSecurity] = createSignal<number>(30)
  const [weightTask, setWeightTask] = createSignal<number>(30)
  const [overage, setOverage] = createSignal<OverageInputs>({ ...DEFAULT_OVERAGE_INPUTS })

  const params = createMemo<DecisionParams>(() => ({
    N: N(),
    intensity: intensity(),
    weightCost: weightCost(),
    weightSecurity: weightSecurity(),
    weightTask: weightTask(),
    overage: overage(),
  }))

  // 8 个可比工具（cline-aider NOT-COMPARABLE 排除，不进入成本/评分）
  const seatRows = createMemo(() => siteData.cost_model.per_tool_seat_cost.filter((row) => row.tool !== "cline-aider"))

  const annual = createMemo(() => calcAllAnnual(seatRows(), params().N, params().intensity, params().overage))

  const scores = createMemo(() =>
    rankScores(
      computeScores({
        rows: annual(),
        toolNames,
        weights: {
          cost: params().weightCost,
          security: params().weightSecurity,
          task: params().weightTask,
        },
      }),
    ),
  )

  const freshness = createMemo(() => evaluateFreshness())

  // N 校验：正整数
  const nValid = createMemo(() => Number.isInteger(N()) && N() > 0)

  return (
    <div class="site-container">
      {/* 页头 */}
      <header class="mb-6">
        <div class="flex items-center gap-3 flex-wrap">
          <h1 class="text-2xl font-bold text-gray-900">AI 编程工具采购决策网站</h1>
          <Show when={freshness().stale}>
            <MarkerBadge marker="STALE" />
          </Show>
        </div>
        <p class="text-sm text-gray-500 mt-1">
          Phase 02 参数化决策站点 · 数据源=Phase 01 官方复核成果（访问日期 2026-08-01 / 复核 2026-08-02，12/12 官方 URL
          一致）· 币种 USD
        </p>
        <p class="text-xs text-gray-400 mt-1">
          本网站只消费 Phase 01 官方复核数据，不新增任何价格/政策估计；NO_CONVERSION / PARTIAL / NOT_TESTED /
          NOT-COMPARABLE / ASSUMED 标记原样展示。
        </p>
      </header>

      {/* S1 参数面板 */}
      <ParamPanel
        N={N()}
        setN={setN}
        intensity={intensity()}
        setIntensity={setIntensity}
        weightCost={weightCost()}
        setWeightCost={setWeightCost}
        weightSecurity={weightSecurity()}
        setWeightSecurity={setWeightSecurity}
        weightTask={weightTask()}
        setWeightTask={setWeightTask}
        overage={overage()}
        setOverage={setOverage}
        nValid={nValid()}
      />

      <Show when={!nValid()}>
        <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 mb-6">
          N 必须为正整数，当前输入 {N()} 无效。请修正后再查看计算结果。
        </div>
      </Show>

      {/* S2 工具对比矩阵（7 维 + 实测 + 成本） */}
      <ComparisonMatrix tools={siteData.tools} seatRows={seatRows()} N={N()} nValid={nValid()} />

      {/* S3 年度成本模型 */}
      <CostModel
        annual={annual()}
        N={N()}
        intensity={intensity()}
        overage={overage()}
        nValid={nValid()}
        siteData={siteData}
      />

      {/* S4 综合评分排序 */}
      <ScoreRanking scores={scores()} weights={params()} siteData={siteData} />

      {/* S5 推荐方案 / 风险 / 试点计划 */}
      <Recommendations siteData={siteData} />

      {/* S6 数据来源与新鲜度 */}
      <DataFreshness siteData={siteData} freshness={freshness()} />

      <footer class="text-xs text-gray-400 mt-8 border-t border-gray-200 pt-4">
        本网站为采购决策辅助工具：所有价格/额度/政策为 2026-08-01 官方快照（2026-08-02
        复核一致），属动态事实；正式采购前须按厂商官方页复核。综合评分公式非厂商官方口径，为本站点基于 Phase 01
        数据定义的决策模型。
      </footer>
    </div>
  )
}
