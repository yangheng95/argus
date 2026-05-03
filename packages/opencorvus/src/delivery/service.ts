/**
 * DeliveryService — orchestrator-facing delivery verification stage.
 *
 * 责任：
 *   1. 采集 project manifest、runtime evidence、LLM semantic verdict、visual metric。
 *   2. 把所有 evidence 交给 delivery arbiter，只有 arbiter 生成最终 verdict。
 *
 * 所有意外升级为 DeliveryFailureError 让上游区分类型处理。
 */
import path from "node:path"
import { DeliveryAgent, type DeliveryVerdictType } from "./agent"
import type { GoalInfo, DeliveryInfo } from "./checks"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { AttachmentStore } from "@/storage/attachment-store"
import {
  computeVisualMetric,
  loadVisualThresholds,
  summarizeVisualMetric,
  type VisualMetricResult,
} from "./visual-metric"
import { issuesFound } from "./verdict"
import { arbitrateDeliveryVerdict } from "./arbiter"
import {
  computeRuntimeEvidence,
  summarizeRuntimeViolations,
  type RuntimeEvidenceReport,
} from "./checks/runtime-evidence"
import { buildDeliveryEvidenceManifest } from "./checks/project-gate"
import { resolveFrontendPreview } from "@/preview/frontend"
import {
  deliveryManifestFailureDetails,
  formatDeliveryManifestFailureDetails,
  persistDeliveryEvidenceManifest,
  type DeliveryEvidenceManifest,
} from "./manifest"

const log = Log.create({ service: "delivery-service" })

export class DeliveryFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "DeliveryFailureError"
  }
}

type AttachmentLike = {
  sha: string
  url: string
  mime: string
  size: number
  filename?: string
  intent?: string
  source?: string
}

export namespace DeliveryService {
  export async function verify(input: {
    task: { id?: string; title: string; request: string; sessionID?: string; metadata?: Record<string, unknown>; design_specs?: Array<{ id: string; category: string; title: string; requirement: string; applies_to: string; severity: "must" | "should"; rationale?: string }> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    attachments?: AttachmentLike[]
    signal?: AbortSignal
    /** Iteration index used to namespace gate-rejection cards in the overlay
     *  so a rework cycle replaces (not stacks on) the prior gate card. */
    iteration?: number
    /** Parent session for the delivery child session. Post-phase-3-b the
     *  delivery agent creates its own child session; this is only an
     *  optional parent pointer. */
    parentSessionID?: string
    runID?: string
    deliveryID?: string
    specSnapshotID?: string
  }): Promise<DeliveryVerdictType> {
    log.info("delivery service verify starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
    })

    const referencePath = resolveReferenceAttachmentPath(input.attachments)
    const goalIds = input.goals.map((g) => g.id)

    // 1. Project evidence manifest hard gate.
    let manifest: DeliveryEvidenceManifest
    try {
      manifest = await buildDeliveryEvidenceManifest({
        taskID: input.task.id,
        runID: input.runID,
        deliveryID: input.deliveryID,
        specSnapshotID: input.specSnapshotID,
        iteration: input.iteration,
        changedFiles: input.delivery.changedFiles,
        taskRequest: input.task.request,
        metadata: input.task.metadata,
        goals: input.goals,
      })
      persistDeliveryEvidenceManifest({ manifest })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("delivery evidence manifest raised", { title: input.task.title, error: msg })
      throw new DeliveryFailureError(`delivery evidence manifest crashed: ${msg}`, { cause: err })
    }
    if (manifest.finalGate.status !== "passed") {
      log.warn("delivery evidence manifest gate rejected delivery", {
        title: input.task.title,
        failedCheckIds: manifest.finalGate.failedCheckIds,
      })
    }
    const manifestFailureDetails = manifest.finalGate.status === "failed"
      ? deliveryManifestFailureDetails(manifest)
      : []
    const manifestFailures = manifest.finalGate.status === "failed"
      ? formatDeliveryManifestFailureDetails(manifest)
      : []
    const hostGateFailures: NonNullable<DeliveryInfo["hostGateFailures"]> = []
    if (manifest.finalGate.status === "failed") {
      hostGateFailures.push({
        kind: "manifest",
        id: manifest.id,
        summary: manifest.finalGate.summary,
        evidence: manifestFailures,
      })
    }

    // 2. Runtime-evidence front gate for visual-reference deliveries.
    let runtimeReport: RuntimeEvidenceReport | undefined
    let runtimeEvidenceFailures: string[] = [...(input.delivery.runtimeEvidenceFailures ?? [])]
    if (referencePath && manifest.finalGate.status === "passed") {
      try {
        const manifestPreviewUrl = manifest.runtimeFlows.find((flow) => flow.previewUrl)?.previewUrl
        const preview = manifestPreviewUrl
          ? { url: manifestPreviewUrl }
          : await resolveFrontendPreview({
              directory: Filesystem.resolve(Instance.directory),
              requireOwnedProcess: true,
            })
        runtimeReport = await computeRuntimeEvidence({
          projectDir: Filesystem.resolve(Instance.directory),
          previewUrl: preview.url ?? undefined,
          outDir: path.join(
            Filesystem.resolve(Instance.directory),
            ".opencorvus",
            "delivery-hard-gate",
            input.task.id ?? "no-task",
          ),
          referenceForViewport: referencePath,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error("runtime-evidence raised", { title: input.task.title, error: msg })
        throw new DeliveryFailureError(`runtime-evidence crashed: ${msg}`, { cause: err })
      }
      if (!runtimeReport.passed) {
        const runtimeFailureLines = runtimeReport.violations.map((v) => `[runtime] ${v.kind}: ${v.detail}`)
        log.warn("runtime-evidence gate rejected delivery", {
          title: input.task.title,
          violations: summarizeRuntimeViolations(runtimeReport.violations),
        })
        runtimeEvidenceFailures = [
          ...runtimeEvidenceFailures,
          ...runtimeFailureLines,
        ]
        hostGateFailures.push({
          kind: "runtime",
          id: "runtime-evidence",
          summary: `Runtime-evidence gate rejected delivery: ${runtimeReport.violations.length} violation(s).`,
          evidence: runtimeFailureLines,
        })
      }
      if (runtimeReport.passed) {
        log.info("runtime-evidence gate passed", {
          title: input.task.title,
          domTextLength: runtimeReport.evidence.dom?.textLength,
          domNodeCount: runtimeReport.evidence.dom?.nodeCount,
        })
      }
    }

    // 3. Visual metric hard gate. It runs before the agent so numeric visual
    // evidence is visible to the same agent-authored verdict; arbiter never
    // fabricates visual rejection_details after the fact.
    let visualMetric: VisualMetricResult | null = null
    let visualMetricFailures: string[] = []
    try {
      if (
        manifest.finalGate.status === "passed" &&
        referencePath &&
        runtimeReport?.passed &&
        !runtimeReport.evidence.renderedPngPath
      ) {
        throw new Error(
          "visual hard gate: runtime-evidence passed but did not provide a rendered PNG — " +
            "this indicates runtime-evidence lost visual evidence.",
        )
      }
      const canRunVisualMetric = manifest.finalGate.status === "passed"
        && !!referencePath
        && !!runtimeReport?.evidence.renderedPngPath
      visualMetric = canRunVisualMetric
        ? await runVisualHardGate({
            referencePath,
            preRenderedPath: runtimeReport?.evidence.renderedPngPath,
          })
        : null
      if (visualMetric) {
        log.info("delivery visual hard gate", {
          title: input.task.title,
          summary: summarizeVisualMetric(visualMetric),
          passed: visualMetric.passed,
          score: visualMetric.score,
        })
        if (!visualMetric.passed) {
          visualMetricFailures = visualMetric.gates
            .filter((gate) => !gate.passed)
            .map((gate) => `[visual] ${gate.name}: ${gate.note || `value=${gate.value} threshold=${gate.threshold}`}`)
          hostGateFailures.push({
            kind: "visual",
            id: "visual-metric",
            summary: summarizeVisualMetric(visualMetric),
            evidence: visualMetricFailures,
          })
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("delivery visual hard gate raised", {
        title: input.task.title,
        error: msg,
      })
      throw new DeliveryFailureError(`visual hard gate crashed: ${msg}`, { cause: err })
    }

    // 4. LLM semantic verdict. Host gate failures are hard gates, but the
    // delivery agent still owns semantic attribution into rejection_details.
    let llmVerdict: DeliveryVerdictType | undefined
    try {
      llmVerdict = await DeliveryAgent.verify({
        task: input.task,
        goals: input.goals,
        delivery: {
          ...input.delivery,
          manifestGate: manifest.finalGate,
          manifestFailureDetails,
          manifestFailures,
          hostGateFailures,
          runtimeEvidenceFailures,
          visualMetricFailures,
        },
        attachments: input.attachments,
        signal: input.signal,
      })
    } catch (error) {
      log.error("delivery service verify failed", {
        title: input.task.title,
        error: String(error),
        cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined,
      })
      if (error instanceof DeliveryFailureError) throw error
      throw new DeliveryFailureError("delivery agent failed", { cause: error })
    }

    const decision = arbitrateDeliveryVerdict({ manifest, goalIds, llmVerdict, runtimeReport, visualMetric })
    if (!decision) throw new DeliveryFailureError("delivery arbiter did not decide final verdict")
    const finalVerdict = decision.verdict

    log.info("delivery service verify completed", {
      title: input.task.title,
      llmVerdict: llmVerdict?.verdict ?? "skipped",
      finalVerdict: finalVerdict.verdict,
      overridden: llmVerdict ? llmVerdict.verdict !== finalVerdict.verdict : false,
      arbiterSource: decision.source,
      issuesFound: issuesFound(finalVerdict).length,
      startupSuccess: finalVerdict.startup_verification?.success,
    })
    return finalVerdict
  }
}

/**
 * 复用 runtime-evidence 已经渲染好的 PNG 跑硬门。reference 缺失 ⇒ 非视觉任务，
 * gate 不适用（返 null）；runtime-evidence 已产出 rendered 但缺失时属于调用方
 * 编排 bug（runtime-evidence 应先于此跑），直接异常。
 */
async function runVisualHardGate(input: {
  referencePath: string | undefined
  preRenderedPath: string | undefined
}): Promise<VisualMetricResult | null> {
  if (!input.referencePath) return null
  if (!input.preRenderedPath) {
    throw new Error(
      "visual hard gate: reference present but runtime-evidence did not provide a rendered PNG — " +
        "this indicates runtime-evidence was skipped or reported non-visual task with a reference attachment. Bug.",
    )
  }
  const thresholds = loadVisualThresholds()
  return await computeVisualMetric({
    renderedPath: input.preRenderedPath,
    referencePath: input.referencePath,
    thresholds,
    // chartRegion / referenceStrings / renderedText 由 P1-B (Stream F) 的
    // CaptureManifest 提供；在此前 text_hit_ratio gate 自动 skip。
  })
}

function resolveReferenceAttachmentPath(
  attachments: AttachmentLike[] | undefined,
): string | undefined {
  if (!attachments || attachments.length === 0) return undefined
  const ref = attachments.find(
    (a) => a.intent === "visual_reference" && a.mime.startsWith("image/"),
  )
  if (!ref) return undefined
  const located = AttachmentStore.nameFromUrl(ref.url)
  if (!located) return undefined
  return AttachmentStore.resolveAbsolute(located.projectID, located.name)
}
