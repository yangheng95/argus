// ECharts 包装组件（本地化，无运行时 CDN）——在 SolidJS 中管理实例生命周期
import { onMount, onCleanup, createEffect } from "solid-js"
import * as echarts from "echarts"

interface Props {
  option: any
  height?: number
  id?: string
}

export function EChart(props: Props) {
  let container: HTMLDivElement | undefined
  let chart: echarts.ECharts | undefined

  onMount(() => {
    if (!container) return
    chart = echarts.init(container)
    chart.setOption(props.option)
    const onResize = () => chart?.resize()
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      window.removeEventListener("resize", onResize)
      chart?.dispose()
      chart = undefined
    })
  })

  createEffect(() => {
    if (chart) {
      chart.setOption(props.option, true)
    }
  })

  return <div ref={container} id={props.id} style={{ width: "100%", height: `${props.height ?? 300}px` }} />
}
