/**
 * DeliveryAgent — An independent-context agent that performs end-to-end
 * verification of the delivered application, including starting the server/client,
 * checking frontend rendering, and reporting any bugs discovered during verification.
 *
 * The DeliveryAgent is review-only. It can:
 * 1. Start the application (server, client, or both)
 * 2. Verify frontend rendering and runtime behavior
 * 3. Produce concrete rejection evidence for orchestrator retry/replan
 * 4. Make a final acceptance decision before publishing
 */
import { createDeliveryTools } from "./tools"
import { createDeliveryOutputTools } from "./output-tools"
import DELIVERY_CORE from "@/prompt/core/delivery-core.txt"
import { runAgentSessionWithRetry } from "@/agent/runner"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { type TextHooks } from "@/llm/api"
import { Config } from "@/config/config"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { deriveUrlSignals, resolveStageSkills, type TaskSignals } from "@/engine/skill-inject"
import { buildTaskUpstreamAgentContextSections } from "@/prompt/upstream-context"
import { findActiveSpecForTask, findRequirements } from "@/engine/store"
import type { RequirementRow } from "@/engine/store"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import { AttachmentStore } from "@/storage/attachment-store"
import type { GoalInfo, DeliveryInfo } from "@/delivery/checks"
import {
  DeliveryVerdict,
  FrontendCheck,
  StartupVerification,
  affectedGoalIDs,
  issuesFound,
  type DeliveryVerdictType,
} from "./verdict"

const log = Log.create({ service: "delivery-agent" })

export {
  DeliveryVerdict,
  FrontendCheck,
  StartupVerification,
  affectedGoalIDs,
  issuesFound,
  type DeliveryVerdictType,
}

// ---------------------------------------------------------------------------
// DeliveryAgent
// ---------------------------------------------------------------------------

type VerifyInput = {
  task: { id?: string; title: string; request: string; sessionID?: string; metadata?: Record<string, unknown>; design_specs?: Array<{ id: string; category: string; title: string; requirement: string; applies_to: string; severity: "must" | "should"; rationale?: string }> }
  goals: GoalInfo[]
  delivery: DeliveryInfo
  /** Visual-reference attachments (already materialized under the attachment store).
   *  When provided, the delivery agent receives the image bytes as a multimodal
   *  `file` content part so it can actually see the target — text-only read_file
   *  on a PNG returns UTF-8 garbage and is not a substitute. */
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
  /** Explicit model override (provider/model). Skips `resolveAgentModel`. */
  model?: { providerID: string; modelID: string }
  /** Legacy passthrough; not wired after the SessionPrompt migration. */
  stream?: TextHooks
  signal?: AbortSignal
}

export namespace DeliveryAgent {
  export async function verify(input: VerifyInput): Promise<DeliveryVerdictType> {
    const deliveryCfg = (await EngineConfig.get()).delivery
    const context = prefetchDeliveryContext(input)
    const textPrompt = buildUserPrompt({ ...input, attachments: input.attachments }, context)
    const taskSignals: TaskSignals = {
      has_attachment_image: (input.attachments ?? []).some((a) => (a.mime ?? "").startsWith("image/")),
      ...deriveUrlSignals(input.task.request ?? ""),
      request_text: input.task.request,
    }

    // Delivery's output tool kit needs `requiredTools` at registration time —
    // the submit_verdict tool rejects accepted verdicts when the declared
    // required tools were not called. Skill resolution happens here in the
    // agent body (not inside the runner) so the tool kit can bind against
    // the returned list; the composed system prompt is then handed to the
    // runner as `rawSystemPrompt` so the runner does not re-resolve the
    // same skill set (rule 22).
    const systemResolved = await deliveryAgentSystem(input)

    log.info("delivery agent starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      config: deliveryCfg,
    })

    // Retry across attempts is owned by `runAgentSessionWithRetry` (rule 22 /
    // rule 24): each attempt mints a fresh tool kit + child session so the
    // submit_verdict collector and stateful review tools cannot bleed across
    // retries. The helper handles abort propagation, stream-error retry, and
    // exhausted-attempts surfacing — delivery only declares: how many
    // retries, how to mint a kit, and what counts as "complete".
    const out = await runAgentSessionWithRetry({
      kind: "delivery",
      core: systemResolved.prompt,
      rawSystemPrompt: true,
      sessionTitle: `Delivery: ${input.task.title}`,
      sessionDirectory: Instance.directory,
      parentSessionID: input.task.sessionID,
      taskID: input.task.id,
      model: input.model,
      signal: input.signal,
      maxRetries: deliveryCfg.max_retries,
      toolKitFactory: () => {
        const reviewTools = createDeliveryTools({ sessionID: input.task.sessionID, taskID: input.task.id })
        const outputToolKit = createDeliveryOutputTools({ requiredTools: systemResolved.requiredTools })
        const guard = toolGuard({ ...reviewTools, ...outputToolKit.tools })
        return {
          tools: guard.tools as any,
          getCollector: () => outputToolKit.getCollector(),
        }
      },
      isComplete: (collector) => {
        if (collector.finalized && collector.verdict) return { ok: true }
        return {
          ok: false,
          reason: "delivery agent did not call submit_verdict before the step budget ran out",
        }
      },
      buildUserPrompt: () => textPrompt,
      buildUserParts: () => buildPromptParts(textPrompt, input.attachments),
    })

    const verdict = out.collector.verdict
    if (!verdict) {
      throw new Error("delivery: runAgentSessionWithRetry returned without a verdict")
    }

    log.info("delivery agent output", {
      verdict: verdict.verdict,
      issuesFound: issuesFound(verdict).length,
      startupSuccess: verdict.startup_verification.success,
      attempts: out.attempts,
    })

    return verdict
  }
}

// ---------------------------------------------------------------------------
// Pre-fetch context
// ---------------------------------------------------------------------------

function prefetchDeliveryContext(input: {
  task: { title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
  delivery: DeliveryInfo
}): string {
  const sections: string[] = []

  try {
    const projectId = Instance.project.id
    const query = `delivery startup runtime ${input.task.title}`
    const recalled = Memory.promptSection({
      query,
      projectId,
      sessionID: input.task.sessionID,
      scope: "all",
      limit: 3,
      minScore: 0.15,
      heading: "Historical Context (Auto-Recalled)",
      includeEpisodes: true,
    })
    if (recalled) sections.push(recalled)
  } catch (err) {
    log.warn("delivery: memory prefetch failed", { error: err instanceof Error ? err.message : String(err) })
  }

  return sections.length > 0 ? sections.join("\n\n") : ""
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build SessionPrompt-compatible message parts. Text first, then inline
 * multimodal attachments (images / audio / video / PDFs) so delivery can
 * actually see the visual reference. Post-phase-3-b migration the shape
 * matches PromptInput.parts — FilePart uses data URLs instead of Buffer
 * so Session.saveMessage can persist without re-resolving a local path.
 */
async function buildPromptParts(
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
) {
  const inlineParts = await AttachmentStore.inlineFileParts(attachments)
  const enrichedText = text + AttachmentStore.renderAttachmentInventory(attachments)
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "file"; url: string; mime: string; filename?: string }
  > = [{ type: "text", text: enrichedText }, ...inlineParts]
  return parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))
}

function buildUserPrompt(
  input: {
    task: { id?: string; title: string; request: string; metadata?: Record<string, unknown>; design_specs?: Array<{ id: string; category: string; title: string; requirement: string; applies_to: string; severity: "must" | "should"; rationale?: string }> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    attachments?: Array<{ sha: string; mime: string; filename?: string; intent?: string }>
  },
  context?: string,
): string {
  const sections: string[] = []

  sections.push("# Delegation\n\nOrchestrator is asking delivery to verify the integrated result and return an acceptance verdict.")

  sections.push(
    `# Task\n\nTitle: ${input.task.title}\n\nRequest:\n${input.task.request}`,
  )

  // Design Contract — visual specs from design-analyst.
  // Not auto-scored. Delivery treats them as a checklist during its own
  // visual review and cites `visual_spec_id` in rejection_details when a
  // specific spec is violated.
  const designSpecs = input.task.design_specs ?? []
  if (designSpecs.length > 0) {
    const byCategory = new Map<string, typeof designSpecs>()
    const order = ["color", "typography", "spacing", "layout", "component", "interaction", "responsive"]
    for (const s of designSpecs) {
      const group = byCategory.get(s.category) ?? []
      group.push(s)
      byCategory.set(s.category, group)
    }
    const lines: string[] = []
    lines.push("# Design Contract (verify yourself during visual review)")
    lines.push("")
    lines.push(
      "Design-analyst extracted these visual constraints from the reference(s). Every entry " +
      "is GATING — BOTH severities ('must' AND 'should') must be verified-satisfied for " +
      "acceptance; 'should' is NOT a soft preference that lets you accept a miss. Look at the " +
      "rendered output yourself and judge each spec. When a spec is unmet, set " +
      "`rejection_details[].category = 'visual'` and cite the spec id in `visual_spec_id`. " +
      "Severity labels only tune attention: 'must' = exact hex / precise layout (highest " +
      "specificity); 'should' = structural / proportional preference (still required, just " +
      "less pixel-exact). A miss on either severity = reject.",
    )
    for (const cat of order) {
      const group = byCategory.get(cat)
      if (!group || group.length === 0) continue
      lines.push("")
      lines.push(`## ${cat}`)
      for (const s of group) {
        const rat = s.rationale ? ` — ${s.rationale}` : ""
        lines.push(`- \`${s.id}\` [${s.severity}] **${s.title}**: ${s.requirement} @ ${s.applies_to}${rat}`)
      }
    }
    sections.push(lines.join("\n"))
  }

  if (input.task.id) {
    const upstreamContext = buildTaskUpstreamAgentContextSections(input.task.id)
    if (upstreamContext.length > 0) sections.push(...upstreamContext)
  }

  // Mirror cache + pipeline steering — delivery must never re-fetch a URL
  // the pipeline has already captured; it reads artifacts off disk instead.
  try {
    const mirrorSection = buildMirrorToolsPromptSection({ cwd: Instance.directory })
    if (mirrorSection.trim().length > 0) sections.push(mirrorSection)
  } catch {
    // Instance not initialised — advisory, skip.
  }

  // Inline hint: when the user message carries image attachments (attached
  // as file parts alongside this text), steer the model to reason over them
  // visually instead of trying to read_file on the binary path.
  const images = (input.attachments ?? []).filter((a) => typeof a?.mime === "string" && a.mime.startsWith("image/"))
  if (images.length > 0) {
    const rendered = images.filter((a) => a.intent === "rendered_output")
    const references = images.filter((a) => a.intent !== "rendered_output")
    const renderedList = rendered.map((a) => `- ${a.filename ?? a.sha} (${a.mime})`).join("\n")
    const referenceList = references.map((a) => `- ${a.filename ?? a.sha} (${a.mime})`).join("\n")
    sections.push(
      `# Visual Comparison\n\n` +
      `This task ships with multimodal image attachments. Both the reference(s) AND the ` +
      `just-rendered screenshot of the delivered output are attached to this message as ` +
      `image content — you can see them directly, you do NOT need read_file.\n\n` +
      (rendered.length > 0
        ? `**Rendered output** (the actual delivery, puppeteer-screenshot of the built merged worktree):\n${renderedList}\n\n`
        : `**Rendered output**: no rendered.png was produced for this delivery — either the build failed or no index.html was found. Treat this as a visual failure: the user cannot see any output.\n\n`) +
      (references.length > 0
        ? `**Reference(s)** (what the delivery was supposed to look like):\n${referenceList}\n\n`
        : ``) +
      `**You MUST perform the visual comparison yourself, adversarially — AND you must ` +
      `not trust the attached rendered.png as a substitute for your own screenshot of ` +
      `the running app.** There is no SSIM gate anymore — a single similarity number was ` +
      `a lazy proxy that let delivery rubber-stamp "close enough" without really looking. ` +
      `Two-stage visual review, BOTH stages required before you may accept:\n\n` +
      `**Stage A — first-look discipline on the attachments.** Open the rendered.png and ` +
      `the reference side-by-side mentally. If any of the following is true on first ` +
      `glance, REJECT immediately with category="visual" and do NOT spend more context ` +
      `pretending it's salvageable:\n` +
      `  - Rendered output is mostly white / mostly empty / a single error page.\n` +
      `  - Layout skeleton is unrecognizable vs reference (e.g. reference is a dense grid ` +
      `    of cards, rendered is a single vertical stack).\n` +
      `  - Brand colors, logo, or signature elements are absent or clearly wrong.\n` +
      `  - Text content is placeholder / lorem ipsum / English when the reference is in ` +
      `    another language.\n` +
      `A first-look reject costs one prompt; a charitable "let me list 30 micro-issues" ` +
      `on an obvious miss wastes an iteration.\n\n` +
      `**Stage B — your own screenshot (Phase 3 Runtime Verification).** The attached ` +
      `rendered.png is the PIPELINE's shot of the worktree before your review session. ` +
      `After your runtime verification succeeds, take your own screenshot with the ` +
      `screenshot tool or an equivalent runtime command. Compare YOUR screenshot ` +
      `against the reference. If your screenshot differs from the pipeline's rendered.png, trust yours — that is the current ` +
      `truth.\n\n` +
      `For every concrete difference surfaced in either stage, write one ` +
      `\`rejection_details\` entry with enough specificity that an executor reading only ` +
      `your feedback can fix it:\n` +
      `  - **Layout**: element positions, alignment, proportions, grid/flex direction\n` +
      `  - **Spacing**: margins between sections, inner padding, gaps between components\n` +
      `  - **Colors**: background, text, accents, borders, hover/active states — name ` +
      `    the semantic role, not just "this is lighter"\n` +
      `  - **Typography**: font size, weight, family, line-height, letter-spacing\n` +
      `  - **Components**: missing or extra elements (buttons, toggles, icons, badges, ` +
      `    progress bars, sidebar sections)\n` +
      `  - **Text**: wrong labels, missing headings, placeholder text not replaced\n\n` +
      `"Sidebar is slightly off" is useless; "Sidebar width should be 240px not 320px, ` +
      `and the 'Billing' row is missing the info icon on its right" is actionable. ` +
      `Pickiness is the point — you are the last human-proxy line before the user sees ` +
      `the delivery, and users notice every layout drift, every wrong color, every ` +
      `missing component. A delivery that looks 70% right is not 70% accepted; it is ` +
      `rejected with 30 specific bullets.`,
    )
  }

  // Deterministic delivery gates now run before the LLM and persist a
  // DeliveryEvidenceManifest. The prompt below treats acceptance specs as the
  // semantic contract the agent reviews against; project command
  // execution and structural coverage are not self-credited by prose.

  // Operator notes — user messages sent during task execution
  if (input.task.id) {
    const clarifications = clarificationTranscriptSection(input.task.id)
    if (clarifications) sections.push(clarifications)
    const notes = operatorNotesSection(input.task.id)
    if (notes) sections.push(notes)
  }

  // Build a REQ-id → row map once so each goal's requirement_ids can be
  // expanded inline (P1 of req/arch evaluation tightening). Source of truth:
  // engine_requirement keyed off the active spec snapshot (rule 22).
  const requirementsByID = new Map<string, RequirementRow>()
  if (input.task.id) {
    const snap = findActiveSpecForTask(input.task.id)
    if (snap) {
      for (const r of findRequirements(snap.id)) requirementsByID.set(r.id, r)
    }
  }

  sections.push(
    `# Goals — Acceptance Specs (semantic contract)\n\n` +
    `Each goal below carries its \`acceptance_specs\` rendered as text. ` +
    `The host has already run the deterministic DeliveryEvidenceManifest gates ` +
    `before this session: project commands, forbidden shell-success coercion, ` +
    `blocking-goal acceptance coverage, and linked requirement coverage. If any ` +
      `of those gates failed, you will receive a rejected verdict path instead of ` +
      `being asked to self-credit them. Your job here is to verify semantic and ` +
      `runtime issues that remain and return ` +
    `concrete residual findings.\n\n` +
    `Your verdict is a semantic judgment layered on top of the manifest, not a ` +
    `replacement for it. Use ` +
    `\`query_metric_trajectory\` to ground yourself in prior iterations and current ` +
    `metric results, but do NOT outsource the acceptance decision to the trajectory. ` +
    `What matters is that your \`rejection_details\` are concrete and evidence-backed: ` +
    `if you reject, the orchestrator reads your findings to decide what to change next.\n\n` +
    `Cross-check every linked requirement (see "Linked requirements" under each ` +
    `goal): the acceptance_specs MUST collectively satisfy the REQ acceptance ` +
    `criteria. A goal whose acceptance_specs all PASS but whose linked REQ ` +
    `acceptance is unmet = reject with category="quality" and cite the REQ id ` +
    `inside the error text; do not invent fields or category values outside the ` +
    `submit_verdict schema.\n\n` +
      input.goals
        .map(
          (g, i) =>
            `## Goal ${i + 1}: ${g.title}\n\n**Goal ID**: \`${g.id}\` (cite this in rejection_details[].goal_id when you reject)\n\n**Objective:** ${g.description}${renderGoalContractDetails(g, requirementsByID)}\n\n**Acceptance specs:**\n${g.criteria}\n\nPriority: ${g.priority}`,
        )
        .join("\n\n---\n\n"),
  )

  // Cap the changed-files list so a wide refactor (hundreds of touched files)
  // does not flood the prompt. The diff section below already shows up to 8
  // representative files; the full path list is reference material, not the
  // signal delivery reasons over.
  const CHANGED_FILES_PROMPT_CAP = 80
  const filesShown = input.delivery.changedFiles.slice(0, CHANGED_FILES_PROMPT_CAP)
  const filesOmitted = input.delivery.changedFiles.length - filesShown.length
  const filesHeader = filesOmitted > 0
    ? `Changed files (${input.delivery.changedFiles.length} total; first ${filesShown.length} listed, ${filesOmitted} omitted):`
    : `Changed files (${input.delivery.changedFiles.length}):`
  sections.push(
    `# Delivery\n\nSummary: ${input.delivery.summary}\n\n${filesHeader}\n` +
      filesShown.map((f) => `- ${f}`).join("\n"),
  )

  // Structured per-goal reports — the executor's first-person implementation
  // claims. Rendered verbatim for adversarial cross-check against the diff.
  if (input.delivery.goalReports && input.delivery.goalReports.length > 0) {
    const blocks: string[] = []
    for (const entry of input.delivery.goalReports) {
      const r = entry.report
      const parts: string[] = []
      parts.push(`## Goal: ${entry.goalTitle}`)
      parts.push("")
      parts.push("### Implementation Approach (executor claim)")
      parts.push(r.implementation_approach.trim())
      if (r.design_decisions.length > 0) {
        parts.push("")
        parts.push("### Design Decisions (executor claim)")
        for (const d of r.design_decisions) {
          parts.push(`- **${d.choice}**`)
          if (d.alternatives.length > 0) {
            parts.push(`  - Alternatives considered: ${d.alternatives.join(", ")}`)
          }
          parts.push(`  - Reason: ${d.reason}`)
        }
      }
      if (r.files_changed.length > 0) {
        parts.push("")
        parts.push("### Files Claimed Changed")
        for (const f of r.files_changed) parts.push(`- \`${f.path}\` — ${f.summary}`)
      }
      if (r.checks_run.length > 0) {
        parts.push("")
        parts.push("### Checks the Executor Ran")
        let forbiddenSeen = 0
        for (const c of r.checks_run) {
          // P1-B / Stream F.2 — flag self-fabricated acceptance evidence
          // (test -f path, grep keyword, ls -l, find … -name) inline so the
          // delivery LLM cannot count them as evidence. The pipeline ainvest
          // event hinged on goal-agent self-passing via `test -f` — it must
          // never be a positive signal again.
          const forbidden = forbiddenCheckReason(c.command)
          if (forbidden) {
            forbiddenSeen += 1
            parts.push(`- ❌ **${c.name}** \`${c.command}\` → exit ${c.exit_code}  _[FORBIDDEN: ${forbidden}; not acceptance evidence]_`)
          } else {
            parts.push(`- **${c.name}** \`${c.command}\` → exit ${c.exit_code}`)
          }
        }
        if (forbiddenSeen > 0) {
          parts.push("")
          parts.push(
            `> ${forbiddenSeen} of ${r.checks_run.length} check(s) above are self-fabricated acceptance evidence (file-existence / keyword grep). Treat this goal as acceptance-unverified and REJECT with category="quality"; cite the forbidden command(s) in rejection_details so the executor's next attempt rewrites the spec to use external anchors (reference_strings / palette / layout from CaptureManifest).`,
          )
        }
      }
      if (r.blockers.length > 0) {
        parts.push("")
        parts.push("### Blockers Reported")
        for (const b of r.blockers) parts.push(`- ${b}`)
      }
      blocks.push(parts.join("\n"))
    }
    sections.push(
      `# Executor Reports — ADVERSARIAL INPUT\n\n` +
      `The blocks below are first-person claims by the executor(s). They are NOT evidence — they are hypotheses to test.\n\n` +
      `**Mandatory cross-checks:**\n` +
      `1. For each \`implementation_approach\`, read enough of the diff to confirm the claim is backed by the code. A claim the diff does not support (missing layer, unused API, unmentioned file) is a REJECTION — report it under Rejection Details with category="quality".\n` +
      `2. For each \`design_decisions[].reason\`, challenge the reasoning. If the reason restates the choice without explaining why it won over the alternative, it's a REJECTION. If the code contradicts the stated reason (e.g. reason says "avoided shared state" but diff adds shared state), it's a REJECTION.\n` +
      `3. Every file in \`Files Claimed Changed\` must appear in the actual Changed files list; every file in the actual Changed files list that does real work must be acknowledged in a claim (silent scope creep is a REJECTION).\n` +
      `4. Executor claims never override deterministic check results. Passing claims cannot rescue a failed Core Check.\n` +
      `5. Any \`checks_run\` entry rendered with **❌ FORBIDDEN** is self-fabricated acceptance evidence (file-existence / self-keyword grep). It is NOT evidence — the goal is acceptance-unverified until a real external-anchor check (CaptureManifest reference_strings / palette / layout, runtime DOM observation, behavioural test) replaces it. REJECT with category="quality" and cite the forbidden command(s).\n\n` +
      blocks.join("\n\n---\n\n"),
    )
  }

  if (input.delivery.diffs && input.delivery.diffs.length > 0) {
    const diffText = input.delivery.diffs
      .filter((d) => d.diff)
      .slice(0, 8)
      .map((d) => `--- ${d.file} ---\n${truncate(d.diff!, 1200)}`)
      .join("\n\n")
    if (diffText) {
      sections.push(`# Code Diffs (up to 8 files)\n\n${diffText}`)
    }
  }

  if (context) {
    sections.push(`# Pre-fetched Context\n\n${context}`)
  }

  sections.push(
    "IMPORTANT: You MUST verify the application works end-to-end.\n" +
      "1. Find the entry point (e.g., src/app.ts, src/index.ts, main.ts, package.json scripts)\n" +
      "2. Run build/compile if needed\n" +
      "3. Start the application with a short timeout to verify it doesn't crash\n" +
      "4. If it crashes, investigate enough to produce concrete rejection evidence and affected goal attribution\n" +
      "5. Capture runtime output or screenshots for every user-visible surface\n" +
      "6. Produce your semantic verdict for the host delivery arbiter without editing project files",
  )

  return sections.join("\n\n")
}

function renderGoalContractDetails(
  goal: GoalInfo,
  requirementsByID: ReadonlyMap<string, RequirementRow>,
): string {
  const lines: string[] = []
  // Linked requirements — expand id → title + acceptance so delivery can
  // verify the goal's acceptance_specs actually cover the linked REQ. Falls
  // through to bare ID listing only when the requirement row is missing
  // (writer/reader race or stale snapshot — surfaces as a visible gap rather
  // than a silently-truncated label).
  if (goal.requirement_ids.length > 0) {
    lines.push("- Linked requirements:")
    for (const reqID of goal.requirement_ids) {
      const r = requirementsByID.get(reqID)
      if (r) {
        lines.push(`  - **${r.id}** [${r.priority}] ${r.title} — acceptance: ${r.acceptance}`)
      } else {
        lines.push(`  - **${reqID}** (requirement row not found in active spec snapshot)`)
      }
    }
  }
  if (goal.depends_on.length > 0) lines.push(`- Depends on goal IDs: ${goal.depends_on.join(", ")}`)
  if (goal.imports.length > 0) lines.push(`- Imports: ${goal.imports.join(", ")}`)
  if (goal.exports.length > 0) lines.push(`- Exports: ${goal.exports.join(", ")}`)
  if (goal.owned_paths.length > 0) lines.push(`- Owned paths: ${goal.owned_paths.join(", ")}`)
  return lines.length > 0 ? `\n\n**Goal contract:**\n${lines.join("\n")}` : ""
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "\n... (truncated)"
}

/**
 * P1-B / Stream F.2 — `checks_run` allowlist (negative form).
 *
 * The acceptance contract demands evidence drawn from external anchors
 * (CaptureManifest.{reference_strings, palette, layout} after Stream B,
 * runtime-evidence after Stream E) — NOT from "the file I wrote exists" or
 * "my own keyword appears in my own scaffold". When the executor reports a
 * check whose command matches one of these self-fabrication patterns, return
 * a short reason string so the renderer can flag it inline; the delivery LLM
 * is instructed to treat the entire goal as acceptance-unverified.
 *
 * Pattern matching is deliberately narrow — we only flag the ainvest-class
 * smoking guns. A real `bun test`, `vitest`, `pytest`, `cargo test`, etc.
 * passes through untouched. False positives are worse than false negatives
 * here: an over-broad regex would block legitimate verification commands.
 */
function forbiddenCheckReason(rawCommand: string): string | undefined {
  const command = rawCommand.trim()
  if (!command) return
  // Drop leading wrappers like `bash -c "..."` so the pattern check sees the
  // actual program. Single layer is enough — nested wrapping is rare and the
  // outer wrapper rarely changes the verdict.
  const stripped = command
    .replace(/^bash\s+-c\s+(['"])(.+)\1\s*$/, "$2")
    .replace(/^sh\s+-c\s+(['"])(.+)\1\s*$/, "$2")
    .trim()
  // `test -f|-d|-e ...` — file existence is not acceptance evidence.
  if (/^\[?\s*test\s+-[fdeLhsr]\b/.test(stripped)) return "test -f / file-existence is not acceptance evidence"
  if (/^\[\s+-[fdeLhsr]\b/.test(stripped)) return "[ -f ] / file-existence is not acceptance evidence"
  // `grep "<self-chosen keyword>" path/to/own/file` — keyword self-grep
  // against the executor's own output rounds back to "I wrote what I wrote".
  if (/^(?:grep|egrep|fgrep|rg|ripgrep)\b/.test(stripped)) return "self-keyword grep on own artifacts is not acceptance evidence"
  // `find ... -name '...'` — file discovery is the same shape as `test -f`,
  // it only proves a path exists, never that the artifact is correct.
  if (/^find\b[^|;&]*-name\b/.test(stripped)) return "find -name / file-discovery is not acceptance evidence"
  // `ls -l path/to/file` — ditto, presence not behaviour.
  if (/^ls\b\s+(-[a-zA-Z]+\s+)?\S+/.test(stripped) && !/[|;&]/.test(stripped)) return "ls / file-listing is not acceptance evidence"
  // `cat path/to/own/file` to "show it works" — content of a file the
  // executor itself wrote does not verify acceptance against external anchors.
  if (/^cat\b/.test(stripped) && !/[|;&]/.test(stripped)) return "cat of own artifact is not acceptance evidence"
  return
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const DELIVERY_AGENT_SYSTEM = DELIVERY_CORE

/** Single-source delivery system prompt.
 *
 * Composition (strict order, no bypass):
 *   1. DELIVERY_AGENT_SYSTEM — code-owned canonical core (role, phases, rules)
 *   2. config.agent.delivery.prompt — optional user append (MUST NOT replace)
 *   3. resolveStageSkills output — invariant section + matched skills
 *
 * Returns the composed prompt and the union of required_tools declared by
 * every matched skill so submit_verdict can enforce them. Task signals
 * (attachments, request URL) drive auto-detect alongside project files/deps. */
export async function deliveryAgentSystem(input?: VerifyInput): Promise<{ prompt: string; requiredTools: string[] }> {
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.delivery?.prompt
  const core = typeof userAppend === "string" && userAppend.trim().length > 0
    ? DELIVERY_AGENT_SYSTEM + "\n\n" + userAppend
    : DELIVERY_AGENT_SYSTEM
  const orchCfg = await EngineConfig.get()
  const taskSignals: TaskSignals | undefined = input
    ? {
        has_attachment_image: (input.attachments ?? []).some((a) => (a.mime ?? "").startsWith("image/")),
        ...deriveUrlSignals(input.task.request ?? ""),
        request_text: input.task.request,
      }
    : undefined
  const resolved = await resolveStageSkills(orchCfg.delivery.skills, "delivery", taskSignals)
  return { prompt: core + resolved.prompt, requiredTools: resolved.requiredTools }
}
