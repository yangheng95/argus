/**
 * P1-A · Runtime-evidence check。
 *
 * goal-agent 不得仅靠 `mirror/scaffold.json` + `App.tsx` 级文本脚手架就标记完成
 * （ainvest 事故的上游根因）。本 check 在 delivery verdict 之前独立采集：
 *   1. 必须找到可被 puppeteer render 的 build artifact（dist/ / build/ / .next/ /
 *      可运行 `bun run start|preview|server`）
 *   2. 必须真实渲染出非空 DOM（textLength ≥ 阈值，非 `<div id="root"></div>` 空壳）
 *   3. 产出的 rendered.png 与 dom metrics 向下游（P0-B 硬门 / 调试 artifact）复用
 *      单次 render（rule 22：禁双源）
 *
 * 失败 ⇒ delivery 直接 rejected；不经过 LLM verdict。符合 rule 1（no fallback）
 * 与 rule 12（视觉 benchmark 以视觉呈现）。
 */
import { findRenderedIndex, renderPage } from "./visual"

export type RuntimeEvidenceViolationKind =
  | "no_build_artifact"
  | "render_failed"
  | "empty_root_shell"
  | "dom_too_thin"

export interface RuntimeEvidenceViolation {
  kind: RuntimeEvidenceViolationKind
  detail: string
}

export interface RuntimeEvidenceReport {
  passed: boolean
  violations: RuntimeEvidenceViolation[]
  evidence: {
    projectDir: string
    buildArtifactPath?: string
    renderedPngPath?: string
    viewport?: { width: number; height: number }
    dom?: {
      textLength: number
      nodeCount: number
      hasBodyChildren: boolean
      isEmptyRootShell: boolean
    }
  }
}

/** 阈值写死但集中，调节无需跨文件。 */
export const RUNTIME_EVIDENCE_THRESHOLDS = {
  /** 有意义交付的最低可见文本长度。ainvest 空骨架 < 50；常规 landing > 500。 */
  min_dom_text_length: 120,
  /** DOM 节点数下限。纯 Vite scaffold ~20 节点；真实 UI 通常 > 100。 */
  min_dom_node_count: 60,
} as const

export async function computeRuntimeEvidence(input: {
  projectDir: string
  outDir: string
  /** 供 SSIM / 硬门共享的视口；缺失时用 reference 自适应或默认 1440×900。 */
  referenceForViewport?: string
  viewport?: { width: number; height: number }
}): Promise<RuntimeEvidenceReport> {
  const violations: RuntimeEvidenceViolation[] = []
  const report: RuntimeEvidenceReport = {
    passed: false,
    violations,
    evidence: { projectDir: input.projectDir },
  }

  // 1. 找 build artifact / 入口 index.html
  const indexHtml = await findRenderedIndex(input.projectDir)
  if (!indexHtml) {
    violations.push({
      kind: "no_build_artifact",
      detail:
        `no index.html found under ${input.projectDir} (dist/build/.next/out/ 皆缺，` +
        `且项目未暴露 start|preview|server 脚本）。goal-agent 必须产出真实可运行的前端，` +
        `仅靠 mirror/scaffold.json + App.tsx 文本不算完成。`,
    })
    return report
  }
  report.evidence.buildArtifactPath = indexHtml

  // 2. 真实 render + DOM 快照（renderPage 已处理 vite/preview 启动脚本与静态兜底）
  let render: Awaited<ReturnType<typeof renderPage>>
  try {
    render = await renderPage({
      rendered: indexHtml,
      outDir: input.outDir,
      viewport: input.viewport,
      referenceForViewport: input.referenceForViewport,
    })
  } catch (e) {
    violations.push({
      kind: "render_failed",
      detail: `puppeteer 渲染 build artifact 失败: ${e instanceof Error ? e.message : String(e)}`,
    })
    return report
  }
  report.evidence.renderedPngPath = render.renderedPath
  report.evidence.viewport = render.viewport
  report.evidence.dom = render.dom

  // 3. DOM 实证：空壳 or 过薄？
  if (render.dom.isEmptyRootShell) {
    violations.push({
      kind: "empty_root_shell",
      detail:
        `rendered DOM 只有一个空的 <div id="root"|app|__next"> 容器。` +
        `text=${render.dom.textLength} nodes=${render.dom.nodeCount}. ` +
        `React/Next 根节点未 hydrate 或 App 挂空，属于 ainvest 空骨架模式，拒收。`,
    })
  }
  if (render.dom.textLength < RUNTIME_EVIDENCE_THRESHOLDS.min_dom_text_length) {
    violations.push({
      kind: "dom_too_thin",
      detail:
        `rendered body.innerText 长度=${render.dom.textLength} < 阈值` +
        ` ${RUNTIME_EVIDENCE_THRESHOLDS.min_dom_text_length}。` +
        `疑似仅输出占位文案（Lorem ipsum / Loading... / 标题栏）。`,
    })
  }
  if (render.dom.nodeCount < RUNTIME_EVIDENCE_THRESHOLDS.min_dom_node_count) {
    violations.push({
      kind: "dom_too_thin",
      detail:
        `rendered DOM 节点数=${render.dom.nodeCount} < 阈值` +
        ` ${RUNTIME_EVIDENCE_THRESHOLDS.min_dom_node_count}。` +
        `这是 mirror/App.tsx 级脚手架产物，非实际可交互 UI。`,
    })
  }

  report.passed = violations.length === 0
  return report
}

export function summarizeRuntimeViolations(
  violations: readonly RuntimeEvidenceViolation[],
): string {
  return violations.map((v) => `${v.kind}: ${v.detail}`).join("\n")
}
