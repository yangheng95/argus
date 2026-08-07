// S1 参数面板：团队人数 N / 使用强度 / 三权重（成本/安全/任务效果 0-100%）/ 超额消耗量输入
// 公式可见：权重归一化 W_k = w_k / (w_cost+w_security+w_task)；全 0 → 等权 1/3
import { For, Show, createMemo, type Setter } from "solid-js"
import type { Intensity, OverageInputs } from "../lib/cost"
import { MarkerBadge } from "./MarkerBadge"

interface Props {
  N: number
  setN: Setter<number>
  intensity: Intensity
  setIntensity: Setter<Intensity>
  weightCost: number
  setWeightCost: Setter<number>
  weightSecurity: number
  setWeightSecurity: Setter<number>
  weightTask: number
  setWeightTask: Setter<number>
  overage: OverageInputs
  setOverage: Setter<OverageInputs>
  nValid: boolean
}

const INTENSITY_INFO: Record<Intensity, string> = {
  LIGHT: "约 5,000-15,000 次请求/月/人 或约 10M-30M tokens/月/人（代码补全、简单问答、小范围修改）",
  STANDARD: "约 15,000-40,000 次请求/月/人或约 30M-100M tokens/月/人（日常功能开发、常规缺陷修复、代码审查辅助）",
  HEAVY: "约 40,000+ 次请求/月/人或约 100M+ tokens/月/人（长会话 agent 任务、跨包多文件重构、无人值守批处理）",
}

function WeightSlider(props: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-sm font-medium text-gray-700">{props.label}</label>
        <span class="text-sm font-semibold text-blue-700">{props.value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={props.value}
        onChange={(e) => props.onChange(Number((e.target as HTMLInputElement).value))}
        class="w-full accent-blue-600"
      />
      <Show when={props.hint}>
        <p class="text-[11px] text-gray-400 mt-0.5">{props.hint}</p>
      </Show>
    </div>
  )
}

export function ParamPanel(props: Props) {
  // createMemo：props 是响应式 getter，组件函数体只执行一次，直接 const 计算不会随信号更新
  const weightSum = createMemo(() => props.weightCost + props.weightSecurity + props.weightTask)
  return (
    <section class="section-card" id="params">
      <h2 class="section-title">参数面板（调整后即时重算）</h2>
      <p class="section-subtitle">
        五个核心参数：团队人数 N、使用强度、成本权重、安全权重、任务效果权重；另含官方可换算超额单位的消耗量输入。
      </p>

      {/* 公式可见 */}
      <div class="formula-box">
        权重归一化：W_cost = w_cost / (w_cost+w_security+w_task)，W_security、W_task 同理； 三者全为 0 时按等权
        1/3。当前归一化后：W_cost={weightSum() > 0 ? ((props.weightCost / weightSum()) * 100).toFixed(1) : "33.3"}% ·
        W_security={weightSum() > 0 ? ((props.weightSecurity / weightSum()) * 100).toFixed(1) : "33.3"}% · W_task=
        {weightSum() > 0 ? ((props.weightTask / weightSum()) * 100).toFixed(1) : "33.3"}%
      </div>

      <div class="grid grid-cols-2 gap-x-8 gap-y-5">
        {/* 人数 */}
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">团队人数 N（正整数）</label>
          <div class="flex items-center gap-2 flex-wrap">
            <For each={[10, 30, 100]}>
              {(n) => (
                <button
                  class={`rounded px-3 py-1.5 text-sm border ${
                    props.N === n
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                  onClick={() => props.setN(n)}
                >
                  {n} 人
                </button>
              )}
            </For>
            <input
              type="number"
              min={1}
              step={1}
              value={props.N}
              onInput={(e) => props.setN(Number((e.target as HTMLInputElement).value))}
              class={`w-28 rounded border px-3 py-1.5 text-sm ${
                props.nValid ? "border-gray-300" : "border-red-400 bg-red-50"
              }`}
              placeholder="自由输入"
            />
          </div>
          <Show when={!props.nValid}>
            <p class="text-xs text-red-600 mt-1">N 必须为正整数</p>
          </Show>
        </div>

        {/* 使用强度 */}
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">
            使用强度 <MarkerBadge marker="ASSUMED" title="强度档用量为假设（章程 §3.1），非官方口径" />
          </label>
          <div class="flex items-center gap-2 flex-wrap">
            <For each={["LIGHT", "STANDARD", "HEAVY"] as Intensity[]}>
              {(iv) => (
                <button
                  class={`rounded px-3 py-1.5 text-sm border ${
                    props.intensity === iv
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                  onClick={() => props.setIntensity(iv)}
                >
                  {iv === "LIGHT" ? "轻度 LIGHT" : iv === "STANDARD" ? "标准 STANDARD" : "重度 HEAVY"}
                </button>
              )}
            </For>
          </div>
          <p class="text-[11px] text-gray-400 mt-1">{INTENSITY_INFO[props.intensity]}</p>
        </div>

        {/* 三权重 */}
        <div class="col-span-2 grid grid-cols-3 gap-6">
          <WeightSlider
            label="成本权重"
            value={props.weightCost}
            onChange={props.setWeightCost}
            hint="对年度总成本重视程度"
          />
          <WeightSlider
            label="安全权重"
            value={props.weightSecurity}
            onChange={props.setWeightSecurity}
            hint="对安全/数据政策重视程度"
          />
          <WeightSlider
            label="任务效果权重"
            value={props.weightTask}
            onChange={props.setWeightTask}
            hint="对实测质量重视程度"
          />
        </div>

        {/* 超额消耗量输入（仅官方可换算单位） */}
        <div class="col-span-2 rounded-lg bg-gray-50 border border-gray-200 p-4">
          <p class="text-sm font-medium text-gray-700 mb-2">
            超额消耗量输入（仅对官方给出可换算单位的工具生效；默认=官方额度内 → 超额 0）
          </p>
          <div class="grid grid-cols-3 gap-6">
            <div>
              <label class="text-xs text-gray-600 block mb-1">
                JetBrains credits/月/人 <MarkerBadge marker="ASSUMED" />
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={props.overage.jetbrainsCreditsPerSeatPerMonth}
                onInput={(e) =>
                  props.setOverage({
                    ...props.overage,
                    jetbrainsCreditsPerSeatPerMonth: Number((e.target as HTMLInputElement).value),
                  })
                }
                class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
              <p class="text-[11px] text-gray-400 mt-1">额度 70 credits/mo；1 credit=$1（官方）</p>
            </div>
            <div>
              <label class="text-xs text-gray-600 block mb-1">
                Amazon Q transformation LOC/月/人 <MarkerBadge marker="ASSUMED" />
              </label>
              <input
                type="number"
                min={0}
                step={100}
                value={props.overage.amazonQTransformationLOCPerSeatPerMonth}
                onInput={(e) =>
                  props.setOverage({
                    ...props.overage,
                    amazonQTransformationLOCPerSeatPerMonth: Number((e.target as HTMLInputElement).value),
                  })
                }
                class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
              <p class="text-[11px] text-gray-400 mt-1">额度 4K LOC/mo pooled；$0.003/LOC（官方）</p>
            </div>
            <div>
              <label class="text-xs text-gray-600 block mb-1">
                Tabnine LLM provider $/月/人 <MarkerBadge marker="ASSUMED" />
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={props.overage.tabnineProviderCostPerSeatPerMonth}
                onInput={(e) =>
                  props.setOverage({
                    ...props.overage,
                    tabnineProviderCostPerSeatPerMonth: Number((e.target as HTMLInputElement).value),
                  })
                }
                class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
              <p class="text-[11px] text-gray-400 mt-1">0=own-LLM 无超额；&gt;0 按 provider 价+5%（官方公式）</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
