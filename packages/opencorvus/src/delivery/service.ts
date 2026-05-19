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
import { composeDeliveryDecision, type DeliveryDecision, type HostGateFailureGroup } from "./arbiter"
import {
  computeRuntimeEvidence,
  summarizeRuntimeViolations,
  type RuntimeEvidenceReport,
} from "./checks/runtime-evidence"
import { buildDeliveryEvidenceManifest } from "./checks/project-gate"
import {
  formatDeliveryManifestFailureDetails,
  persistDeliveryEvidenceManifest,
  type DeliveryEvidenceManifest,
} from "./manifest"
import { Event } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import {
  emitReviewStreamProgress,
  emitReviewStreamStarted,
  reviewIDForDelivery,
  type ReviewStreamStep,
} from "@/review/stream"

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
    criteriaResults?: Array<{
      name: string
      status: "passed" | "failed" | "skipped" | "inconclusive"
      evidence?: string
      family?: string
      label?: string
      goal_id?: string
      goal_run_id?: string
    }>
  }): Promise<DeliveryDecision> {
    log.info("delivery service verify starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
    })

    const taskID = input.task.id
    const iteration = input.iteration ?? 0
    const reviewID = taskID ? reviewIDForDelivery(taskID, iteration) : undefined
    const startedAt = Date.now()
    const progress = (currentStep: ReviewStreamStep, summary?: string) => {
      emitReviewStreamProgress({
        taskID,
        reviewID,
        phase: "delivery",
        currentStep,
        attempt: 1,
        elapsedMs: Date.now() - startedAt,
        summary,
        source: "delivery.service",
      })
    }
    emitReviewStreamStarted({
      taskID,
      reviewID,
      phase: "delivery",
      source: "delivery.service",
    })

    const referencePath = resolveReferenceAttachmentPath(input.attachments)

    // 1. Project evidence manifest hard gate.
    let manifest: DeliveryEvidenceManifest
    try {
      progress("manifest", "Building delivery evidence manifest.")
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
        criteriaResults: input.criteriaResults ?? [],
        progress: (event) => progress(event.currentStep, event.summary),
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
    const manifestFailures = manifest.finalGate.status === "failed"
      ? formatDeliveryManifestFailureDetails(manifest)
      : []
    const hostGateFailures: HostGateFailureGroup[] = []
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
    if (referencePath && manifest.finalGate.status === "passed") {
      try {
        progress("runtime", "Computing runtime evidence for visual reference.")
        const manifestPreviewUrl = manifest.runtimeFlows.find((flow) => flow.previewUrl)?.previewUrl
        runtimeReport = await computeRuntimeEvidence({
          projectDir: Filesystem.resolve(Instance.directory),
          previewUrl: manifestPreviewUrl,
          outDir: path.join(
            Filesystem.resolve(Instance.directory),
            ".opencorvus",
            "delivery-hard-gate",
            input.task.id ?? "no-task",
          ),
          referenceForViewport: referencePath,
          progress: (event) => progress(event.currentStep, event.summary),
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
        ? await (async () => {
            progress("visual", "Evaluating visual hard gate.")
            return runVisualHardGate({
              referencePath,
              preRenderedPath: runtimeReport?.evidence.renderedPngPath,
            })
          })()
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

    // Host deterministic gate composite: manifest finalGate AND the
    // visual-reference runtime/visual probes (when they ran). These are
    // objective data-integrity facts (rule 6.1), owned entirely by the host.
    const hostGatePassedPreAgent =
      manifest.finalGate.status === "passed" &&
      (runtimeReport ? runtimeReport.passed : true) &&
      (visualMetric ? visualMetric.passed : true)

    // 4a. Host gate failed → the agent is NOT run to restate the failure
    // (fresh-eyes decoupling, specs/delivery-fresh-eyes-decoupling-2026-05-18.md).
    // The host emits the final rejected decision directly.
    if (!hostGatePassedPreAgent) {
      progress("agent", "Host gate rejected delivery before the delivery agent.")
      const decision = composeDeliveryDecision({
        hostGate: {
          passed: false,
          manifest,
          runtimeReport,
          visualMetric,
          failures: hostGateFailures,
        },
      })
      await emitGateRejectedIfNeeded(decision, {
        taskID: input.task.id,
        runID: input.runID,
        iteration: input.iteration,
        failures: hostGateFailures,
      })
      await emitDeliveryReviewCompleted(decision.final, { taskID, runID: input.runID, reviewID })
      log.info("delivery service verify completed", {
        title: input.task.title,
        llmVerdict: "skipped (host gate failed before agent)",
        finalVerdict: decision.final.verdict,
        arbiterSource: decision.source,
        issuesFound: issuesFound(decision.final).length,
      })
      return decision
    }

    // 4b. Host gate passed → the fresh-eyes DeliveryAgent runs BLIND. It does
    // NOT receive manifestGate / hostGateFailures / runtime / visual failure
    // conclusions; it investigates the merged tree independently.
    let llmVerdict: DeliveryVerdictType
    try {
      progress("agent", "Running fresh-eyes delivery review.")
      llmVerdict = await DeliveryAgent.verify({
        task: input.task,
        goals: input.goals,
        delivery: input.delivery,
        attachments: input.attachments,
        signal: input.signal,
        deliveryID: input.deliveryID,
        reviewID,
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

    // Delivery may have made a narrow final repair. An accepted verdict must
    // re-pass a fresh deterministic manifest so a repair that broke the build
    // cannot ride out on the pre-repair pass.
    let finalManifest = manifest
    if (llmVerdict.verdict === "accepted") {
      try {
        progress("post_repair", "Rebuilding evidence manifest after delivery repair.")
        finalManifest = await buildDeliveryEvidenceManifest({
          taskID: input.task.id,
          runID: input.runID,
          deliveryID: input.deliveryID,
          specSnapshotID: input.specSnapshotID,
          iteration: input.iteration,
          changedFiles: input.delivery.changedFiles,
          taskRequest: input.task.request,
          metadata: input.task.metadata,
          goals: input.goals,
          criteriaResults: input.criteriaResults ?? [],
          progress: (event) => progress(event.currentStep, event.summary),
        })
        persistDeliveryEvidenceManifest({ manifest: finalManifest })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error("post-repair delivery evidence manifest raised", { title: input.task.title, error: msg })
        throw new DeliveryFailureError(`post-repair delivery evidence manifest crashed: ${msg}`, { cause: err })
      }
    }

    const postRepairPassed = finalManifest.finalGate.status === "passed"
    const decision = postRepairPassed
      ? composeDeliveryDecision({
          hostGate: { passed: true, manifest: finalManifest, runtimeReport, visualMetric, failures: [] },
          agentVerdict: llmVerdict,
        })
      : composeDeliveryDecision({
          hostGate: {
            passed: false,
            manifest: finalManifest,
            runtimeReport,
            visualMetric,
            failures: [
              {
                kind: "manifest",
                id: finalManifest.id,
                summary: finalManifest.finalGate.summary,
                evidence: formatDeliveryManifestFailureDetails(finalManifest),
              },
            ],
          },
          agentVerdict: llmVerdict,
        })

    await emitGateRejectedIfNeeded(decision, {
      taskID: input.task.id,
      runID: input.runID,
      iteration: input.iteration,
      failures: decision.hostGate.failures,
    })
    await emitDeliveryReviewCompleted(decision.final, { taskID, runID: input.runID, reviewID })

    log.info("delivery service verify completed", {
      title: input.task.title,
      llmVerdict: llmVerdict.verdict,
      finalVerdict: decision.final.verdict,
      overridden: llmVerdict.verdict !== decision.final.verdict,
      arbiterSource: decision.source,
      issuesFound: issuesFound(decision.final).length,
      startupSuccess: decision.final.startup_verification?.success,
    })
    return decision
  }
}

/** Emit the overlay DeliveryGateRejected card only when the host gate is the
 *  rejecting source. The card namespaces by iteration so a rework cycle
 *  replaces (not stacks on) the prior card. */
async function emitGateRejectedIfNeeded(
  decision: DeliveryDecision,
  ctx: { taskID?: string; runID?: string; iteration?: number; failures: HostGateFailureGroup[] },
): Promise<void> {
  if (decision.source !== "host_gate" || !ctx.taskID) return
  await EngineProtocol.emit(
    Event.DeliveryGateRejected,
    {
      taskID: ctx.taskID,
      runID: ctx.runID,
      iteration: ctx.iteration ?? 0,
      violations: deliveryGateNotificationViolations(ctx.failures),
    },
    { source: "delivery.service" },
  )
}

async function emitDeliveryReviewCompleted(
  final: DeliveryVerdictType,
  ctx: { taskID?: string; runID?: string; reviewID?: string },
): Promise<void> {
  if (!ctx.taskID || !ctx.reviewID) return
  const rejectionDetails = final.verdict === "rejected" ? final.rejection_details : []
  const hostEvidence = final.tool_call_evidence.some((item) => item.tool === "DeliveryEvidenceManifest")
  await EngineProtocol.emit(
    Event.DeliveryReviewCompleted,
    {
      taskID: ctx.taskID,
      runID: ctx.runID,
      reviewID: ctx.reviewID,
      verdict: final.verdict,
      source: hostEvidence ? "host_gate" : "llm",
      summary: final.summary,
      hostGatePassed: !hostEvidence,
      failureKinds: [...new Set(rejectionDetails.map((item) => item.category))],
      rejectionCount: rejectionDetails.length,
      deferredCount: final.deferred_checks.length,
      details:
        final.verdict === "rejected"
          ? rejectionDetails.map((item) => item.error)
          : final.tool_call_evidence.map((item) => item.detail),
    },
    { source: "delivery.service" },
  )
}

function deliveryGateNotificationViolations(
  failures: HostGateFailureGroup[],
): Array<{ kind: string; detail: string }> {
  return failures.map((failure) => ({
    kind: failure.kind,
    detail: [
      failure.summary,
      ...failure.evidence,
    ].filter((item) => item.trim().length > 0).join("\n"),
  }))
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
