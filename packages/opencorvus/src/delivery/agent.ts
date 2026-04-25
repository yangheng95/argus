/**
 * DeliveryAgent — An independent-context agent that performs end-to-end
 * verification of the delivered application, including starting the server/client,
 * checking frontend rendering, and fixing any bugs discovered during verification.
 *
 * Unlike the GoalJudge which is read-only, this agent can:
 * 1. Start the application (server, client, or both)
 * 2. Verify frontend rendering and runtime behavior
 * 3. Fix bugs found during verification (write/edit code)
 * 4. Re-verify after fixes to confirm the application works
 * 5. Make a final acceptance decision before publishing
 */
import { resolveAgentModel } from "@/agent/model"
import { createDeliveryTools } from "./tools"
import { createDeliveryOutputTools } from "./output-tools"
import DELIVERY_CORE from "@/prompt/core/delivery-core.txt"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { type TextHooks } from "@/llm/api"
import { Config } from "@/config/config"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { resolveStageSkills, type TaskSignals } from "@/engine/skill-inject"
import { buildTaskUpstreamAgentContextSections } from "@/prompt/upstream-context"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import { AttachmentStore } from "@/storage/attachment-store"
import type { GoalInfo, DeliveryInfo } from "@/delivery/checks"
import {
  DeliveryVerdict,
  FrontendCheck,
  StartupVerification,
  type DeliveryVerdictType,
} from "./verdict"

const log = Log.create({ service: "delivery-agent" })

export {
  DeliveryVerdict,
  FrontendCheck,
  StartupVerification,
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
    // Per-agent model override: if config sets agent.delivery.model, honor it;
    // otherwise inherit the user's most recent in-session model pick from the
    // task session; otherwise fall through to Provider.defaultModel().
    let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
    if (input.model) {
      model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
    } else {
      model = await resolveAgentModel("delivery", { sessionID: input.task.sessionID }).catch(() => undefined)
    }
    if (!model) throw new Error("no LLM model available for delivery agent")

    const deliveryCfg = (await EngineConfig.get()).delivery

    const reworkTools = createDeliveryTools({ sessionID: input.task.sessionID, taskID: input.task.id })
    const systemResolved = await deliveryAgentSystem(input)
    const outputToolKit = createDeliveryOutputTools({ requiredTools: systemResolved.requiredTools })
    const guard = toolGuard({ ...reworkTools, ...outputToolKit.tools })
    const enableMap: Record<string, boolean> = Object.fromEntries(
      Object.keys(guard.tools).map((name) => [name, true]),
    )
    const context = prefetchDeliveryContext(input)
    const textPrompt = buildUserPrompt({ ...input, attachments: input.attachments }, context)
    const parts = await buildPromptParts(textPrompt, input.attachments)
    const systemPrompt = systemResolved.prompt

    log.info("delivery agent starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      model: model.id,
      config: deliveryCfg,
    })

    const externalSignal = input.signal

    const MAX_RETRIES = deliveryCfg.max_retries
    let verdict: DeliveryVerdictType | undefined
    let lastError: Error | undefined

    // Retry loop covers missing-submit_verdict failures — the agent ran but did
    // not call submit_verdict before the step budget ended. Same shape as the
    // pre-migration loop; wraps SessionPrompt.prompt instead of SessionPrompt.prompt.
    // Each attempt opens its own child session so the collector state on retry
    // is not entangled with a prior attempt's message history.
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        if (externalSignal?.aborted) break
        log.info("delivery agent retrying", { attempt, reason: lastError?.message })
        outputToolKit.reset()
      }

      const agentSession = await Session.createNext({
        kind: "delivery",
        parentID: input.task.sessionID,
        title: `Delivery: ${input.task.title}`,
        directory: Instance.directory,
      })
      const abortPrompt = () => {
        try {
          SessionPrompt.cancel(agentSession.id)
        } catch {
          /* session may already be stopped */
        }
      }
      externalSignal?.addEventListener("abort", abortPrompt, { once: true })

      const streamErrors: Array<{ reason: string; name?: string }> = []
      const errorUnsub = Bus.subscribe(Session.Event.Error, (evt) => {
        const props = evt.properties as { sessionID: string; error: { message?: string; name?: string } }
        if (props.sessionID !== agentSession.id) return
        streamErrors.push({ reason: props.error?.message ?? "unknown error", name: props.error?.name })
      })

      try {
        await SessionPrompt.withExtraTools(agentSession.id, guard.tools as any, async () => {
          await SessionPrompt.prompt({
            sessionID: agentSession.id,
            model: { providerID: model!.providerID, modelID: model!.api.id },
            agent: "delivery",
            system: systemPrompt,
            tools: enableMap,
            parts,
          })
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const isAborted = externalSignal?.aborted || (err instanceof Error && err.name === "AbortError")
        log.warn("delivery agent run failed", { attempt, error: lastError.message, aborted: isAborted })
        if (isAborted && externalSignal?.aborted) break
        errorUnsub()
        externalSignal?.removeEventListener("abort", abortPrompt)
        continue
      } finally {
        errorUnsub()
        externalSignal?.removeEventListener("abort", abortPrompt)
      }

      log.info("delivery agent finished", {
        attempt,
        sessionID: agentSession.id,
        streamErrors: streamErrors.length,
      })

      if (streamErrors.length > 0) {
        lastError = new Error(
          `delivery: session stream error: ${streamErrors[0].name ?? "error"}: ${streamErrors[0].reason}`,
        )
        log.warn("delivery: stream error, will retry", { attempt, error: lastError.message })
        continue
      }

      const collector = outputToolKit.getCollector()
      if (collector.finalized && collector.verdict) {
        verdict = collector.verdict
        break
      }

      lastError = new Error(
        "delivery agent did not call submit_verdict before the step budget ran out",
      )
      log.warn("delivery: submit_verdict not called, will retry", { attempt })
    }

    if (!verdict) {
      throw new Error(lastError?.message ?? "Delivery agent failed after retries")
    }

    log.info("delivery agent output", {
      verdict: verdict.verdict,
      issuesFound: verdict.issues_found.length,
      startupSuccess: verdict.startup_verification.success,
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
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "file"; url: string; mime: string; filename?: string }
  > = [{ type: "text", text }]

  if (!attachments?.length) return parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))

  const inlineable = attachments.filter((a) =>
    AttachmentStore.isMultimodalSupported(typeof a.mime === "string" ? a.mime : ""),
  )
  for (const a of inlineable) {
    const located = AttachmentStore.nameFromUrl(a.url)
    if (!located) {
      log.warn("delivery: attachment url did not resolve", { url: a.url, filename: a.filename })
      continue
    }
    try {
      const bytes = await AttachmentStore.read(located.projectID, located.name)
      const base64 = Buffer.from(bytes).toString("base64")
      parts.push({
        type: "file",
        url: `data:${a.mime};base64,${base64}`,
        mime: a.mime,
        filename: a.filename,
      })
    } catch (err) {
      log.warn("delivery: attachment read failed", { url: a.url, filename: a.filename, err: String(err) })
    }
  }

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

  sections.push(
    `# Task\n\nTitle: ${input.task.title}\n\nRequest:\n${input.task.request}`,
  )

  // Design Contract — advisory visual specs from design-analyst.
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
    lines.push("# Design Contract (advisory — verify yourself during visual review)")
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
      `glance, REJECT immediately with category="visual" and do NOT waste repair budget ` +
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
      `rendered.png is the PIPELINE's shot of the worktree **before** your Phase 0 ` +
      `stitching and Phase 5 repairs. After your runtime verification succeeds, take ` +
      `your own screenshot via puppeteer-core + run_command (see Phase 3 step 4b for the ` +
      `skeleton). Compare YOUR screenshot against the reference. If your screenshot ` +
      `differs from the pipeline's rendered.png, trust yours — that is the post-repair ` +
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

  // No pre-computed Core Check Results (2026-04-20 per-goal evaluator removal).
  // The prompt no longer injects deterministic scorer outcomes — the delivery
  // agent reads acceptance_specs as INFORMATION further below and verifies
  // them itself via run_command + parallel per-goal subagents.

  // Operator notes — user messages sent during task execution
  if (input.task.id) {
    const clarifications = clarificationTranscriptSection(input.task.id)
    if (clarifications) sections.push(clarifications)
    const notes = operatorNotesSection(input.task.id)
    if (notes) sections.push(notes)
  }

  sections.push(
    `# Goals — Acceptance Specs (INFORMATION, not pre-scored)\n\n` +
    `Each goal below carries its \`acceptance_specs\` rendered as text. ` +
    `Nobody has run them yet — no deterministic evaluator gate exists anymore. ` +
    `YOU execute every heuristic scorer with \`run_command\`, judge every rubric / ` +
    `llm_judge scorer by reading + reasoning, and record PASS or FAIL with concrete ` +
    `evidence.\n\n` +
    `Your verdict is authoritative for this delivery pass. Use ` +
    `\`query_metric_trajectory\` to ground yourself in prior iterations and current ` +
    `metric results, but do NOT outsource the acceptance decision to the trajectory. ` +
    `What matters is that your \`issues_found\` and \`rejection_details\` are ` +
    `concrete and evidence-backed: if you reject, the orchestrator reads your ` +
    `findings to decide what to change next.\n\n` +
      input.goals
        .map(
          (g, i) =>
            `## Goal ${i + 1}: ${g.title}\n\n**Goal ID**: \`${g.id}\` (cite this in rejection_details[].goal_id and affected_goal_ids when you reject)\n\n**Objective:** ${g.description}${renderGoalContractDetails(g)}\n\n**Acceptance specs (information — verify yourself):**\n${g.criteria}\n\nPriority: ${g.priority}`,
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
      "4. If it crashes, investigate and fix the issue\n" +
      "5. Re-verify after any fix\n" +
      "6. Produce your final verdict",
  )

  // Step budget is finite — the agent is cut off after `delivery.max_steps`
  // tool calls. Without an explicit final-emission rule it can spend every
  // step on rework and never finalize, which makes the whole stage fail.
  // Reserve the last step for submit_verdict.
  sections.push(
    "## Final Output (REQUIRED)\n\n" +
    "Before you stop, you MUST call the `submit_verdict` tool exactly once. " +
    "Plain-text / markdown / ```json fenced output is IGNORED — only the tool " +
    "call is read. The tool's schema is strict (Zod-validated); malformed " +
    "payloads return an error and let you call again.\n\n" +
    "**Attribution contract enforced by the tool:**\n" +
    "- `verdict='rejected'` REQUIRES a non-empty `affected_goal_ids`. Pick goal IDs from the `# Goals` section above — you are the attribution authority, downstream code does not second-guess.\n" +
    "- Every `rejection_details[].goal_id` MUST appear in `affected_goal_ids`.\n" +
    "- If a rejection spans multiple goals, list every relevant goal id in `affected_goal_ids` and emit one `rejection_details` entry per (goal, issue) pair.\n" +
    "- A delivery that is merely \"bad overall\" with no specific goal attribution is NOT a valid rejection. If you cannot name the responsible goal, investigate more — your retry budget covers it.\n\n" +
    "If submit_verdict is not called before the step budget runs out, the run is treated as a failed finalize and retried.",
  )

  return sections.join("\n\n")
}

function renderGoalContractDetails(goal: GoalInfo): string {
  const lines: string[] = []
  if (goal.requirement_ids.length > 0) lines.push(`- Requirement IDs: ${goal.requirement_ids.join(", ")}`)
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
        request_contains_url: /\bhttps?:\/\/\S+/i.test(input.task.request ?? ""),
        request_text: input.task.request,
      }
    : undefined
  const resolved = await resolveStageSkills(orchCfg.delivery.skills, "delivery", taskSignals)
  return { prompt: core + resolved.prompt, requiredTools: resolved.requiredTools }
}
