// 统一标记位徽标渲染（NOT_TESTED / NOT-COMPARABLE / PARTIAL / NO_CONVERSION / ASSUMED / STALE）
// 标记语义原样展示，绝不换算成数值
import { For } from "solid-js"

export type MarkerKey = "NOT_TESTED" | "NOT-COMPARABLE" | "PARTIAL" | "NO_CONVERSION" | "ASSUMED" | "STALE"

const STYLES: Record<MarkerKey, string> = {
  NOT_TESTED: "bg-amber-100 text-amber-800 border-amber-300",
  "NOT-COMPARABLE": "bg-gray-200 text-gray-700 border-gray-400",
  PARTIAL: "bg-orange-100 text-orange-800 border-orange-300",
  NO_CONVERSION: "bg-red-100 text-red-800 border-red-300",
  ASSUMED: "bg-purple-100 text-purple-800 border-purple-300",
  STALE: "bg-red-600 text-white border-red-700",
}

const LABELS: Record<MarkerKey, string> = {
  NOT_TESTED: "NOT_TESTED（未实测）",
  "NOT-COMPARABLE": "NOT-COMPARABLE（不可比）",
  PARTIAL: "PARTIAL（部分）",
  NO_CONVERSION: "NO_CONVERSION（不可换算）",
  ASSUMED: "ASSUMED（假设）",
  STALE: "STALE（数据过期）",
}

export function MarkerBadge(props: { marker: MarkerKey; title?: string }) {
  return (
    <span
      class={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold border whitespace-nowrap ${STYLES[props.marker]}`}
      title={props.title}
    >
      {LABELS[props.marker]}
    </span>
  )
}

/** 一组标记位（多个标记并排显示） */
export function MarkerSet(props: { markers: MarkerKey[]; title?: string }) {
  return (
    <span class="inline-flex flex-wrap gap-1">
      <For each={props.markers}>{(m) => <MarkerBadge marker={m} title={props.title} />}</For>
    </span>
  )
}
