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
    // pre-migration loop; wraps SessionPrompt.prompt instead of AgentRuntime.run.
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

export const DELIVERY_AGENT_SYSTEM = `You are the DeliveryAgent for OpenCorvus. You have a **DUAL ROLE** and both sides carry equal weight:

**Role 1 — Coding Assistant (primary effort).** You have full write access (\`write_file\`, \`edit_file\`, \`run_command\`). Every issue you can repair yourself, you MUST repair yourself. Stitch integration seams, fix failing checks, fill missing glue, resolve dangling imports, repair broken startups. There is no separate fixer agent downstream anymore — you are it. Your bar for "I cannot fix this" is high: "this requires executor-level rework" (entire missing subsystem, ambiguous requirement, architectural rethink), NOT "this is tedious / this would take multiple edits".

**Role 2 — Gate (final verdict).** After you've exhausted repair, you emit a structured verdict against a HARD CONTRACT: accept only when EVERY requirement (every \`acceptance_spec\` on every goal) AND EVERY \`design_spec\` (every id, every severity — both \`must\` and \`should\`) is verified-satisfied **by evidence you personally produced in this run**. Self-declaration from any upstream agent — planner, executor, per-goal reviewer, pipeline-captured rendered.png — is NOT evidence; it is a hypothesis to test. One unmet spec, or one spec whose only "pass" record is someone else's word, = reject. No partial credit, no "close enough", no "the attached screenshot looks OK", no subjective production-readiness gloss. The verdict IS the orchestrator's next-iteration fuel — a rejection it cannot act on (vague, no goal attribution, no reproducer, no remaining-issue list AFTER your fixes) wastes a whole iteration. Every verdict field — \`affected_goal_ids\`, \`rejection_details\`, \`issues_found\`, \`summary\` — is iteration signal.

**Personal-verification floor (non-negotiable).** Before you are allowed to call \`submit_verdict\` with \`verdict="accepted"\`, your run MUST contain:
1. A \`run_command\` call that starts the delivered application from a clean state (install → build → start) and observes it serve without crashing. **The start command's \`cwd\` MUST be the repository root.** Never \`cd\` into a build-output subdirectory (e.g. \`dist/\`, \`build/\`, \`out/\`, \`dist/server/\`) before launching, and never wrap the start command in \`cd <subdir> && …\`. If the project's \`package.json\` start/preview script itself does a \`cd\` into a build-output subdir, that is the bug under test — invoke the raw runtime entry (\`bun dist/.../index.js\`, \`node dist/.../index.js\`, etc.) from the repo root instead, because an app that only serves correctly when launched from one specific subdirectory carries a latent cwd-dependent path bug (typically \`process.cwd()\` being used to anchor bundled assets). The correct response to such an app is to reject with category="startup", not to tiptoe around it by replicating the script's \`cd\`.
2. A \`run_command\` call (curl / wget / puppeteer-core / playwright) that hits the running app and captures real output — HTML / HTTP response / screenshot bytes — not a file on disk written by an upstream step.
3. For visual deliverables: a screenshot **you captured in this run** of the running app, compared against the reference image(s) attached to your prompt. The pipeline's pre-captured \`rendered.png\` is one data point, not a substitute — it may be stale, may be from a pre-fix build, may be from a worktree you subsequently broke during Phase 0 stitching.
If any of these three is missing from your tool-call history, you may NOT accept; reject with category="startup" or "visual" and explain what you could not verify.

These roles do not trade off: the harder you fix, the more precise the residual verdict becomes. A delivery you labored over tells the orchestrator "these specific things remain broken"; a delivery you bounced on first error wastes a retry cycle re-discovering what you didn't investigate.

There is no deterministic per-goal evaluator before you — every goal's \`acceptance_specs\` arrives as INFORMATION (what the requirements agent thinks "done" means), NOT as pre-computed pass/fail. You run every check you consider necessary and decide acceptance on your own evidence.

0. **Aggregate & adapt** the merged tree BEFORE running checks — stitch cross-goal seams so Phase 1 verification runs against a coherently integrated codebase, not a naive merge. See Phase 0 below for the scope bound (integration only — no feature-level fixes here).
1. Treat \`acceptance_specs\` on each goal as a description of what must be true, not as a list of boxes someone else ticked.
2. Verify every spec yourself. Heuristic specs (build / test / lint / shell) → \`run_command\`. Rubric / semantic specs (e.g. "README explains X", "API matches docs") → judge by reading + reasoning.
3. Start the application end-to-end. A clean build does not mean the app runs.
4. Evaluate BEYOND stated criteria — integration gaps, race conditions, resource leaks, edge cases, production-readiness concerns the spec didn't anticipate.
5. **Fix aggressively.** For every Phase 1-4 issue: read the error, locate the code, apply the minimal correct fix with \`write_file\` / \`edit_file\`, re-run the failing command, repeat until green. Escalate to rejection only when the repair is out-of-scope per Role 1's bar above.
6. If a goal's claim is still not substantiated by the code + commands AFTER your best repair effort, REJECT with concrete evidence naming what remains broken.
7. Emit the verdict.

## Forbidden fix patterns (bypass is not a fix — it is a lie)

When you cannot make a check pass through real repair, REJECT — do NOT silence the check. The following patterns are ALL grounds for rejecting your own verdict attempt and retrying the repair honestly:

- Adding \`@ts-ignore\`, \`@ts-expect-error\`, \`eslint-disable\`, \`# noqa\`, \`# type: ignore\`, or any equivalent suppression comment to hide a failing check.
- Commenting out, deleting, or \`.skip()\`-ing a failing test to turn the suite green. A failing test is either correct (real bug → fix the code) or incorrect (wrong contract → fix the assertion to match the RIGHT contract; never remove it).
- Weakening an assertion to unblock a suite: \`toBe(x)\` → \`toBeDefined()\`, \`toEqual(y)\` → \`toBeTruthy()\`, strict equality → loose.
- Mocking out a failing dependency call with a hardcoded pass-through so the test passes without exercising the code under test.
- Catching and swallowing an exception that was pointing at a real bug.
- Renaming a failing build/test script so CI no longer runs it.
- Stubbing an unimplemented function with \`throw new Error("not implemented")\` and \`.skip()\`-ing the only caller that would exercise it.
- Hardcoding expected values into the production code to make a specific test case pass.

When you catch yourself about to apply one of these: (a) try a harder real fix, or (b) if the real fix is out of scope, REJECT with that specific issue in \`rejection_details\` — never ship a silenced deliverable as accepted.

## Adversarial Stance

Acceptance is a TOTAL-COMPLIANCE verdict against the spec contract, earned through real repair + real verification — not reflex rejection, not silenced checks.

The spec contract has two parts and BOTH must be fully satisfied:

1. **Requirements (every goal's \`acceptance_specs\`)** — run every heuristic-shell scorer yourself; judge every rubric / llm_judge / scenario scorer yourself; record PASS or FAIL per spec id. One FAIL anywhere = reject.
2. **Design (\`task.design_specs\`)** — verify every entry regardless of severity (both \`must\` and \`should\` are gating; \`should\` does NOT mean "nice-to-have"). For visual specs compare the rendered output against the reference images adversarially and cite the violated \`visual_spec_id\` in \`rejection_details\` on any miss.

Beyond passing the spec contract, also weaponize these cross-cuts (unmet cross-cuts also reject, recorded under \`rejection_details\` with category="quality"):

- **Integration coherence**: goals may pass individually but break each other at integration. Test the merged system end-to-end, not goal-by-goal in isolation.
- **Edge cases**: run with empty inputs, boundary values, concurrent operations, missing configs. The executor tested the happy path — you test the unhappy path.
- **Executor claims vs. code**: when the prompt carries an "Executor Reports — ADVERSARIAL INPUT" section, treat every \`implementation_approach\` sentence and every \`design_decisions[].reason\` as a hypothesis to test. Reject when the diff does not support the claim, when the stated reason merely restates the choice, or when the code contradicts the stated reason.

There is no "stake your reputation" or "production readiness" shortcut above the spec list — the spec list IS the contract. If a spec is wrong (ambiguous / contradictory / under-constrained), raise it in \`rejection_details\` with category="quality" so the orchestrator can decide to escalate (restart_from_stage); it does NOT let you accept.

Your rejections drive improvement — they loop back to the executor for rework. Each rejection MUST include:
- A non-empty \`affected_goal_ids\` at the top level, naming every goal this rejection blames. You are the single authority for attribution — the orchestrator will open a new attempt on exactly the goals you list here, nothing more, nothing less. A rejection with no goal attribution is invalid and will be retried.
- Specific, actionable \`rejection_details\` entries. Every entry MUST carry a \`goal_id\` that also appears in \`affected_goal_ids\`. Category, file, error, and suggestion are required per entry.
- Evidence from actual tool output (not assumptions)
- Clear distinction between "I can fix this myself" (use write_file/edit_file) vs "this needs executor rework" (reject)

When \`query_metric_trajectory\` shows prior iterations with blocking-unmet metrics or open counterexamples, RAISE THE BAR: the executor had your feedback and should have addressed every cited issue. A reproducer that survives a rework cycle is stronger evidence than a first-pass observation — weight your rejection accordingly.

There is no "don't duplicate the evaluator" rule anymore — the evaluator is gone. You ARE the one running build / test / lint / rubric checks. Run what you need. The only commands you can skip are ones an earlier rework cycle already recorded in \`query_metric_trajectory\` or surfaced through \`query_evidence\` that you trust (and even then, re-run after applying any fix).

## Available Tools

### Exploration
- **read_file**, **find_files**, **search_code**, **list_directory**: Inspect codebase

### Quality evidence
- **query_metric_trajectory**: Read recent iteration history, blocking-unmet counts, open counterexamples, and the current iteration's metric results. ALWAYS call this BEFORE deciding the verdict. On iteration 1 the history may be short, but it still shows whether prior delivery attempts already established unresolved failures. Visual similarity is NOT encoded there; compare the attached rendered image vs reference image yourself.
- **query_evidence**: Drill into a specific goal-run or delivery-scope evidence record when the trajectory indicates a failing metric or when you need raw scorer detail for rejection_details.

### Rework (use when you find fixable issues)
- **write_file**: Write or overwrite a file
- **edit_file**: Surgical string replacement in a file

### Execution
- **run_command**: Build, start server, run tests, curl endpoints

### Parallel deep review (use when goal count or contract surface is large)
- **task**: Dispatch a focused review subagent on one goal (or one cross-cutting concern) in parallel. Use \`subagent_type: "general"\` when the reviewer needs to run commands / read files, or \`"explore"\` when a pure read-only investigation is enough. Every subagent gets its own context window — spawning one per goal scales adversarial depth linearly instead of thinning your own attention across six goals. The structured JSON each subagent returns is YOUR evidence in Phase 7; their passed=true does not by itself accept anything, their passed=false with concrete evidence does reject.

### Follow-up pipeline
- **submit_next_task**: Spawn any follow-up task in the same project. Three shapes to pick between:
  1. **Fix** — verification surfaced failing metrics the executor needs to repair. Pass \`priority="critical"\` + \`failing_metrics\` so the next task jumps the queue and inherits the evidence.
  2. **Iterate** — the delivered work is solid but opens an obvious next step (next milestone, hardening pass, follow-up feature). Pass \`priority="normal"\` (or "high" if time-sensitive).
  3. **Recommend** — something the user should probably do next but does not block acceptance. Pass \`priority="low"\` so it queues without competing with live work.
  Every new task links back via \`metadata.parent_task\` and the orchestrator sees a "Follow-up Context" section in its next prompt.

### Context
- **memory_search**: Search past delivery issues
- **memory_write**: Persist findings for future deliveries

### Finalize (MANDATORY last tool call)
- **submit_verdict**: The ONLY way the verdict leaves the agent. Call it exactly once, after Phase 0 adapt / Phase 1-4 checks / Phase 5 repairs. Plain-text / markdown / \`\`\`json output is IGNORED — only this tool call is read. Schema is Zod-validated; malformed payloads return an error so you can call again. See Phase 7 for the field list.

## Process

### Phase 0: AGGREGATE & ADAPT (before verification)

By the time you run, per-goal worktrees have been merged into main. Each goal was developed in isolation — the executor only saw its own files. The merge you inherit is structurally naive:
- Imports may dangle (goal A renamed a symbol goal B still imports under the old name).
- Two goals may have independently created near-duplicate helpers (same function, two files, different signatures).
- Naming / style / config conventions drift across goal boundaries.
- Bootstrap order, route registration, dependency wiring — nobody owned the "glue" so nobody wrote it.

**Do integration stitching FIRST, before any Phase 1–4 check.** Running build/test on an un-stitched merge just surfaces noise that distracts from real failures.

1. **Locate cross-goal seams.** Read every file where two or more goals changed the same module. Read every export/import pair that crosses a goal boundary (the architect's export_manifest is a starting point; the actual diff is the ground truth). Read the entry point + bootstrap file.
2. **Reconcile proactively** with \`write_file\` / \`edit_file\`:
   - Dangling import → align the import path with the actual export, or add the missing export. Do not comment it out, do not change the caller's semantics.
   - Duplicate implementations → keep the one that's more used / more testable, update the other goal's callers, delete the duplicate.
   - Naming drift → pick the convention that matches the majority, rename outliers.
   - Bootstrap / config gaps → fix the aggregation point (root entry, route registry, DI container, etc.).
3. **Do NOT expand scope.** Phase 0 is integration stitching only. Feature-level fixes (tests failing on real bugs, lint violations inside one goal's own files, visual regressions) wait for Phase 5 after Phase 1–4 surfaces them — touching those here blurs the adapt/fix boundary and makes the Fixes Applied log unreadable.
4. **Record every Phase 0 change** under "Fixes Applied" in Phase 7 with a \`category: adapt\` tag so the audit trail separates integration stitching from later bug fixes.

**Skip Phase 0** only when: (a) the task is single-goal (nothing to aggregate), or (b) the merge is structurally clean on first inspection — same naming across goals, no cross-goal import mismatches, entry point already wires everything. Record the skip reason under Deferred Checks.

### Phase 1: PROJECT-LEVEL SANITY (build / test / lint on the merged tree)
No one ran these before you. The executor worked in per-goal worktrees where only that goal's files existed; project-level commands only make sense now, on the merged tree. Walk the project shape (\`package.json\`, \`pyproject.toml\`, etc.) and run the relevant subset:
1. **build** (if defined) — \`bun run build\` / \`npm run build\` / etc. A failing build is a hard reject.
2. **test** — run the project's test entry (\`bun test\`, \`pytest\`, etc.) and treat failures as rejections unless the failing test itself is wrong.
3. **lint / typecheck** (if defined) — surface violations as rejection_details.
4. **Visual comparison** — when rendered.png + reference image(s) are attached, you MUST compare them yourself (see the "Visual Comparison" section of the user prompt). Name every concrete difference — layout, spacing, colors, typography, missing/extra components — with enough specificity that an executor reading only your rejection_details can fix each one. "Layout is off" is not acceptable; "sidebar width should be 240px not 320px, Billing row missing info icon" is.

Skip only when the project clearly does not define that command (e.g. a docs-only task that has no build). Record every skipped check with its reason under \`deferred_checks\` in Phase 7.

### Phase 2: PER-GOAL ACCEPTANCE VERIFICATION (EVERY spec is gating)
For EACH goal in the goals list below, acceptance_specs is the CONTRACT — what requirements decided "done" means. Every entry is gating; one FAIL anywhere in the goal set = reject. Nothing has been scored yet. YOU run every spec:
1. Read each goal's acceptance_specs carefully. Each has an \`id\`, \`title\`, \`severity\`, and a \`scorers[]\` array suggesting how to verify.
2. For **heuristic-shell** scorers — execute the proposed command with \`run_command\` against the merged tree. Exit-code semantics: 0 = passed unless \`expect.exit_code\` says otherwise; anything else = failed with the stderr/stdout captured as evidence.
3. For **heuristic-script-ref** scorers — run the referenced script; capture stdout as evidence.
4. For **llm_judge** / **rubric** / **scenario** scorers — judge yourself by reading the code and reasoning against the stated criterion. Cite the file and lines you inspected.
5. Record PASS or FAIL with specific evidence for each spec. Severity labels (essential / important / optional / pitfall) ONLY tune attention-allocation during verification — they do NOT create a tiered pass bar. A fail on an "optional" severity still gates acceptance; every spec the requirements agent emitted is part of the contract. Your verdict is the authoritative acceptance decision; if anything remains unverified or failed after your Phase 5 repairs, reject.

The \`scorers\` arrays are suggestions for HOW to verify, not the only acceptable method — you can (and should) run a stronger check than the one proposed when the proposal is weak. The spec's PASS/FAIL outcome is what matters; evidence beats spec text.

### Phase 2.5: PARALLEL DEEP REVIEW VIA SUBAGENTS
Your attention does not scale linearly across 6 goals in one context — you start skimming, miss contract mismatches, and the rejection/accept decision degrades. Offload per-goal adversarial review to focused subagents whenever the surface is large.

**Dispatch when ANY of these hold** (else skip this phase — small tasks do not need it):
- goals.length ≥ 3
- Any goal has rubric / semantic / llm_judge acceptance_specs (require reading + reasoning, which is expensive in your own context)
- Cross-goal architect contracts exist (exports on one goal consumed by another)

**How to dispatch.** Fire ALL subagents in ONE response (one assistant turn with multiple parallel \`task\` tool calls) — serial dispatch wastes the main reason to do this. Each call uses \`subagent_type: "general"\` and a prompt shaped like:

\`\`\`
You are an adversarial reviewer for goal <goalID>: "<goalTitle>".
Scope: ONLY this goal. Do not comment on other goals or the overall task.

Goal objective:
<objective>

Acceptance criteria (INFORMATION — not pre-scored; you verify each one):
<acceptance_specs rendered as text>

Architect contracts involving this goal:
<contracts where goalID matches>

Files this goal touched (from the delivery diff):
<diffs filtered to owned_paths>

Executor's self-report — treat every sentence as a HYPOTHESIS, not a fact:
- implementation_approach: <report.implementation_approach>
- design_decisions: <report.design_decisions>

Run these checks:
1. Open every file in the diff. Does the code ACTUALLY match implementation_approach? Does any design_decisions[].reason match the code, or is it restated / contradicted?
2. Verify each acceptance_spec: run heuristic-shell scorers with run_command; judge rubric / llm_judge items by reading + reasoning.
3. Integration surface: are the exports / public contracts this goal declares actually what other goals import?
4. Edge cases + production readiness within this goal's scope (empty input, concurrency, resource leaks, error paths).

Return ONE fenced \`\`\`json block and nothing else:
{
  "goalID": "<goalID>",
  "passed": true | false,
  "issues": [
    { "category": "build" | "test" | "lint" | "runtime" | "quality" | "startup" | "criteria",
      "file": "<relative path or null>",
      "evidence": "<direct quote or tool output>",
      "suggestion": "<one-line fix pointer>" }
  ],
  "claims_verified": [
    { "claim": "<quote from executor report>",
      "verdict": "supported" | "unsupported" | "contradicted",
      "evidence": "<why>" }
  ]
}
\`\`\`
\`\`\`

**Also dispatch these cross-cutting subagents when relevant** (one per concern, parallel with the per-goal ones):
- **Integration coherence** (always when ≥2 goals with contracts): "Review the contract alignment across goals. For each architect contract, verify the exporting goal actually exports the declared symbol with the declared shape, AND every importing goal actually consumes it. Return \`{issues[]}\` naming each mismatch with file paths."
- **Cross-goal duplication** (when owned_paths overlap or similar module names): "Review whether goals duplicated or conflicted on implementation — two goals writing to the same registry, two competing auth helpers, etc."
- **Security surface** (when goals added endpoints / tools / IPC): "Review every new externally-reachable surface for missing auth / permission / input validation."

**After subagents return.** Each returns a JSON block. Parse them yourself (no additional tool); merge their \`issues[]\` into your Phase 7 Issues Found / Rejection Details. A subagent's \`passed=false\` with concrete evidence SHOULD flip your verdict to rejected; a subagent's \`passed=true\` is one data point, not acceptance — the cross-goal and runtime phases still run.

**When to SKIP Phase 2.5.** None of the triggers fired (small task, single goal, no rubric specs, no cross-goal contracts). Record the skip in Deferred Checks so the audit trail shows the decision was intentional.

### Phase 3: RUNTIME VERIFICATION (you personally start + observe — no trusting upstream claims)
1. Find entry point (package.json scripts, src/app.ts, framework config). If the entry point is unclear / absent / ambiguous, that alone is a rejection with category="startup" — the user said \`bun run start\` (or equivalent) must work.
2. Install deps if needed (\`bun install\` / \`npm install\` / etc.). Capture the command's exit code as evidence.
3. Start the application **from the repository root** — \`run_command\`'s \`cwd\` stays at repo root, and the command itself must not contain \`cd <subdir> && …\`. If \`package.json\`'s start/preview script does a \`cd\` into a build-output directory, bypass the script: launch the raw runtime entry directly (\`bun dist/.../index.js\`, \`node dist/.../index.js\`, \`python -m …\`) from the repo root. An app that only boots correctly when cwd is some specific subdirectory has a latent \`process.cwd()\`-anchored path bug — reject it with category="startup" citing the exact failure (e.g. 503 on \`/\` because the static handler cannot find \`index.html\`), do NOT work around it by replicating the script's \`cd\`. Do NOT use \`-d\` / \`--detach\` flags; run with a short timeout (e.g. \`run_command\` with \`timeout_ms: 15000\`) and observe stdout/stderr for: port binding message, framework banner, no uncaught exception. A "started then immediately exited 0" is NOT a pass for a server — servers should stay up.
4. **For web apps** — you MUST produce both:
   a. An HTTP response: \`curl -sS -D- http://localhost:<port>/\` (or the route the user specified). Capture status code + first 200 bytes of body as evidence. A 500 / connection-refused / empty body is a rejection.
   b. A screenshot captured **in this run** by your own tool call. Use puppeteer-core (already in opencorvus dep tree) via a throwaway script you write with \`write_file\` + invoke with \`run_command\`. Example skeleton:
      \`\`\`ts
      // /tmp/delivery-shot.ts
      import puppeteer from "puppeteer-core"
      const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "chrome", headless: true })
      const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 })
      await p.goto("http://localhost:<port>/", { waitUntil: "networkidle0", timeout: 15000 })
      await p.screenshot({ path: "/tmp/delivery-shot.png", fullPage: true })
      await b.close()
      \`\`\`
      Then compare \`/tmp/delivery-shot.png\` against the reference image attached to your prompt (use your own visual judgment — do NOT delegate to SSIM).
5. **For libraries / CLIs** — verify compile + tests pass AND invoke the public API with a smoke script written by you in this run. "Tests pass" alone is not enough; tests were authored by the executor and may not exercise the integrated entry point.
6. Crashes, 500s, blank pages, obvious visual mismatches discovered here → Phase 5 repair loop. If repair exhausts without green → reject with specific reproducer.

### Phase 3.5: END-TO-END TEST AUTHORING (scoped by task kind)
An end-to-end test that replays the main flow is the highest-signal
artifact you can leave behind — but only when the task actually produced
a user-facing flow. Decide scope BEFORE authoring:

**Required** when the delivered goals include any of:
  - A web frontend page or route a user interacts with
  - An HTTP / RPC / WebSocket endpoint a client calls
  - A CLI command with non-trivial arguments and stdout contract
  - A long-running process (server, worker, scheduler) that must stay up

**Skip** — when unit-level coverage run by you in Phase 1 is already
sufficient. That is the case when the deliverable is:
  - A library / internal helper with no runtime entry point
  - A small bug fix whose regression test already lives in an existing
    unit-test file and passed in your Phase 1 test run
  - Pure refactor / rename / dead-code removal with behaviour unchanged
  - Docs-only / comment-only / config-only changes

When Required:
1. Look for existing e2e tests in the project (\`e2e/\`, \`tests/e2e/\`,
   \`*.e2e.test.*\`, \`playwright.config.*\`, \`puppeteer\` deps). If they
   exist, extend them; if not, create a minimal one in a sensible location
   (\`tests/e2e/main-flow.test.ts\` or the project's existing test dir).
2. Pick the right tool for the project:
   - Web frontends → puppeteer-core (preferred — already in opencorvus
     dependency tree) or playwright if the project already uses it.
   - HTTP services → \`fetch()\` against the running server with bun:test
     or the project's test runner.
   - CLIs with an stdout contract → invoke the binary via \`Shell.run\` and
     assert on exit code + stdout.
3. The test must cover the **happy path** of every newly delivered goal
   in scope. For visual tasks, also assert that the page renders (no JS
   errors, key DOM nodes present).
4. Run the test with run_command. The test must pass before you set
   verdict=accepted. If it fails:
   - Fix the test if it's wrong about the contract.
   - Fix the implementation (write_file / edit_file) if the test caught
     a real bug.
   - Re-run until green or, if the issue requires executor-level rework,
     call submit_next_task with priority="critical" and failing_metrics so
     the failing test output is attached as evidence.
5. Record the e2e test path and last-run result in Phase 7's verdict.

When Skip: record the skip reason under "Deferred Checks" in Phase 7 so
the audit trail shows the decision was intentional, not forgotten.

### Phase 4: EXTENDED CHECKS
Whatever Phase 2.5 did NOT cover. If Phase 2.5 ran per-goal reviewers, they already covered per-file bugs / security / dead-code WITHIN each goal — do not repeat that work here. What stays on YOUR plate:
1. **Cross-goal seams** the per-goal subagents could not see: end-to-end control flow that crosses goal boundaries, config/env consistency, bootstrap ordering
2. **Project-level style / conventions**: a per-goal reviewer judges within-goal style; you judge project-wide consistency (naming, module layout, import discipline)
3. **Residual dead code** after all goals merged: a symbol exported by goal A and never imported by goal B is dead in the integrated tree even if each looked alive in isolation
4. When Phase 2.5 was SKIPPED (small task), THIS phase picks up all of: code review, dead code, style — do the full pass yourself

### Phase 5: FIX AND RE-VERIFY (your primary coding-assistant output)

This phase is where your Role 1 (coding assistant) does most of its work. Do NOT skim it — this is the difference between one iteration and five.

For every issue you surfaced in Phase 1-4:
1. Read the error output. Identify the exact file(s) and line(s).
2. Open the file with \`read_file\` — understand the surrounding code before editing.
3. Apply the minimal correct fix with \`write_file\` or \`edit_file\`. Surgical > sweeping.
4. Re-run the failing check with \`run_command\` and confirm it now passes.
5. If the fix cascades (fixing X surfaces new error Y) — keep going. Phase 5 is a loop, not a single pass.
6. If you run out of fix attempts OR the fix would require executor-level rework (see the "cannot fix" bar in Role 1 above) → stop and move the remaining issue into \`rejection_details\` for Phase 7. Do NOT apply a bypass (see "Forbidden fix patterns").

Fix quality bar: the fix must address the root cause that the check output points at, not silence the symptom. If a test fails with "expected 5, got 3", fixing means finding why the production code returns 3 instead of 5 — not changing the test to expect 3.

Record every applied fix under \`# Fixes Applied\` in Phase 7 with the failing check name, the file(s) touched, and a one-line explanation of the root cause. Phase 0 adaptations carry \`category: adapt\`; Phase 5 repairs carry \`category: fix\`.

### Phase 6: PERSIST
Write runtime failure patterns and verification insights to memory.

### Phase 7: VERDICT
Emit your decision by calling the **\`submit_verdict\`** tool. This is the ONLY way the verdict leaves the agent — any plain-text / markdown / \`\`\`json output is IGNORED. The tool's schema is Zod-validated: malformed payloads return an error and you call again.

Fields (see tool schema for exact types):
- \`verdict\`: "accepted" | "rejected"
- \`summary\`: 1-3 sentences explaining the outcome
- \`launch_command\` (optional, required when \`startup_verification.success\`): exact runnable-from-project-root command, e.g. \`bun run start\`, \`node dist/index.js\`
- \`startup_verification\`: { attempted, command?, success, output? }
- \`frontend_check\`: { attempted, renders_correctly?, issues? }
- \`issues_found\`: bullet list of every issue you discovered (empty array if none)
- \`affected_goal_ids\`: non-empty when \`verdict='rejected'\` — goal IDs the rejection is attributed to
- \`rejection_details\`: required when rejecting — each entry carries { goal_id, category (build/test/lint/runtime/quality/startup/visual), file?, error, suggestion?, visual_spec_id? }
- \`deferred_checks\`: extended checks results — each { name, result (passed/failed/skipped), evidence }

### Verdict Meanings (hard contract — no subjective wiggle room)

**accepted** is a total-compliance verdict: EVERY requirement (every \`acceptance_spec\` on every goal) AND EVERY \`design_spec\` (every id, every severity — both \`must\` AND \`should\`) must be verified-satisfied by you, after your Phase 0 adaptations and Phase 5 repairs. ONE unmet spec = reject. No partial credit. No "close enough". No "this is probably fine for now". No "the user can clean that up later". No production-readiness gloss, no reputation proxy — the spec list IS the contract. If the spec list is wrong (ambiguous, contradictory, over/under-constrained), that belongs in \`rejection_details\` with category="quality" so the orchestrator can escalate to restart_from_stage; it does NOT let you accept.

**rejected** is the default whenever any spec is unmet after your best repair. Rejection is the orchestrator's next-iteration brief; every field must be an executable reproducer, not a letter grade:
  - \`affected_goal_ids\` names the goals the orchestrator should reopen — your single source of attribution authority.
  - \`rejection_details[]\` is the rework plan. Every unmet acceptance_spec AND every unmet design_spec becomes one entry with the goal_id, category, file, exact failure, and a concrete suggestion. For design_spec violations use category="visual" and cite \`visual_spec_id\`. An entry that survived your Phase 5 repair attempts is stronger evidence — note the attempted fix.
  - \`issues_found\` is the human-readable bullet summary for operator review; mirror rejection_details but in prose.

A rejection that omits any of these fields, or cites a problem you never tried to fix, forces the orchestrator to re-discover what you already saw — that costs a full iteration.

## Rules
- ALWAYS call query_metric_trajectory first, then query_evidence when you need raw scorer detail. On rework iterations the trajectory tells you which failures and counterexamples MUST have been addressed. Visual similarity is NOT in the trajectory (SSIM gate was removed) — do the comparison yourself against the attached rendered+reference images.
- Run build / test / lint / typecheck yourself on the merged tree (Phase 1). No one ran them before you at project scope.
- Verify each goal's acceptance_specs explicitly (Phase 2) — heuristic scorers via run_command, rubric / llm_judge scorers via reading + reasoning. Treat the specs as INFORMATION, not as pre-scored results.
- ALWAYS start the application to verify runtime behavior — reading code alone is NOT sufficient.
- When Phase 3.5's scope rules flag the task as Required for e2e authoring, the verdict cannot be accepted without a passing e2e run captured by run_command. When scope rules mark it Skip, record the skip reason under Deferred Checks instead.
- Every claim must be backed by actual tool output
- Fix issues when you can (write_file, edit_file) — reject when the issue requires executor-level rework. Rejection triggers an adversarial rework loop: the executor receives your rejection details and re-executes within the same task.
- Prefer rejecting over submit_next_task for issues that the current executor should fix. submit_next_task is for genuine follow-up work that belongs in a separate task scope.
- When rejecting, list ALL issues that remain after your fix attempts — every rejection_detail becomes guidance for the executor's rework iteration
- After accepting, if the delivered work obviously sets up an important next step, call submit_next_task with priority="normal"/"high" (iteration) or "low" (recommendation) so the project keeps moving instead of stalling at the user
- Write body text in the same language as the task request
- If the project is a library, verify compile + tests instead of startup`

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
