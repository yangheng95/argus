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
 * 失败 ⇒ 作为 host hard gate evidence 注入 DeliveryAgent，由 agent 产出
 * rejected verdict 和 goal attribution；host 只负责阻止 accepted，不合成
 * rejection_details。
 */
import { captureRuntimePage } from "@/delivery/runtime-capture"
import { findRenderedIndex } from "./visual"

export type RuntimeEvidenceViolationKind =
  | "no_build_artifact"
  | "render_failed"
  | "empty_root_shell"
  | "dom_too_thin"
  | "interaction_required_but_missing"
  | "interaction_probe_failed"

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
    interaction?: {
      visibleControlCount: number
      textInputCount: number
      fileInputCount: number
      attemptedInteractionCount: number
      textChanged: boolean
      htmlChanged: boolean
      errorCount: number
      errors: string[]
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
  requireInteraction?: boolean
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

  // 2. 真实 render + DOM 快照。delivery 只从 RuntimeCapture 读取截图和页面层证据。
  const render = await captureRuntimePage({
    url: indexHtml,
    outDir: input.outDir,
    viewport_width: input.viewport?.width,
    viewport_height: input.viewport?.height,
    referenceForViewport: input.referenceForViewport,
    probeInteractions: input.requireInteraction ?? false,
    min_dom_descendants: RUNTIME_EVIDENCE_THRESHOLDS.min_dom_node_count,
  })
  if (!render.captured) {
    violations.push({
      kind: "render_failed",
      detail: `runtime capture 渲染 build artifact 失败: ${render.capture_error.message}`,
    })
    return report
  }
  report.evidence.renderedPngPath = render.path
  report.evidence.viewport = { width: render.viewport.width, height: render.viewport.height }
  report.evidence.dom = render.dom
  report.evidence.interaction = render.interaction

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
  if (input.requireInteraction) {
    violations.push(...runtimeInteractionViolations(render.interaction))
  }

  report.passed = violations.length === 0
  return report
}

export function runtimeInteractionViolations(
  interaction: RuntimeEvidenceReport["evidence"]["interaction"] | undefined,
): RuntimeEvidenceViolation[] {
  const violations: RuntimeEvidenceViolation[] = []
  if (!interaction || interaction.visibleControlCount === 0) {
    violations.push({
      kind: "interaction_required_but_missing",
      detail:
        `structured acceptance scenarios require a browser interaction flow, ` +
        `but the rendered page exposed no visible controls.`,
    })
    return violations
  }
  if (interaction.attemptedInteractionCount === 0 || (!interaction.textChanged && !interaction.htmlChanged)) {
    violations.push({
      kind: "interaction_probe_failed",
      detail:
        `browser interaction probe found ${interaction.visibleControlCount} visible control(s) ` +
        `but no observable page change after ${interaction.attemptedInteractionCount} interaction(s).`,
    })
  }
  if (interaction.errorCount > 0) {
    violations.push({
      kind: "interaction_probe_failed",
      detail: `browser interaction probe raised ${interaction.errorCount} error(s): ${interaction.errors.join("; ")}`,
    })
  }
  return violations
}

export function summarizeRuntimeViolations(
  violations: readonly RuntimeEvidenceViolation[],
): string {
  return violations.map((v) => `${v.kind}: ${v.detail}`).join("\n")
}
