// ── Transcript & context utilities ──
// imported from there; nothing is duplicated.
// Exported surface:
// formatConversationTranscript – plain-text conversation export
// boardArtifact – find a named artifact in board.artifacts
// syntheticTextMessage – build a synthetic message object
// specContextText – spec → plain text
// planContextText – plan + goals → plain text
// goalContextText – goals[] → plain text
// evaluationContextText – board evaluation → plain text
// interactionRequestText – interaction request → plain text
// interactionReplyLabel – permission reply enum → label
// interactionAnswerLines – interaction answers → string[]
// interactionResponseText – full interaction response → plain text
// copyChatConversation – copy current conversation to clipboard

import { t, tc, localeTag } from "./i18n";
import { joinBullet, stripAssistantBrief } from "./string";
import { roleLabel } from "./message";
import { displayToolDetail, toolStatusLabel } from "./tool";
import { conversationMessages } from "./conversation";
import { AppLog } from "./log";

// ── Internal helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** FNV-1a 32-bit hash (mirrors app.js hashText). */
function hashText(value: string): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function processStatusLabel(status: string): string {
  if (status === "completed") return t("task.status.completed");
  if (status === "failed") return t("task.status.failed");
  if (status === "blocked") return t("task.status.blocked");
  if (status === "queued") return t("task.status.queued");
  return t("task.status.running");
}

function evaluationVerdictLabel(status: string): string {
  if (status === "accepted") return t("evaluation.verdict.accepted");
  if (status === "rejected") return t("evaluation.verdict.rejected");
  return t("evaluation.verdict.pending");
}

// ── Transcript formatting helpers ──

function transcriptRole(role: string): string {
  return roleLabel(role);
}

function transcriptTime(value: number | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString(localeTag(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTranscriptText(part: any, role: string): string {
  let text: string = part?.text || "";
  if (!text.trim()) return "";
  if (part.audience && part.audience.ui === false) return "";
  if (part.kind === "trace" && !part.audience?.ui) return "";
  const orchestratorRoles = ["user", "planner", "evaluator", "system"];
  if (orchestratorRoles.includes(role) && text.includes("<assistant-brief>")) {
    text = stripAssistantBrief(text);
  }
  return text.trim();
}

function formatTranscriptTool(part: any): string {
  const toolName: string = part?.tool || "unknown";
  const hiddenTools = ["planner", "todowrite", "todoupdate", "task_report"];
  if (hiddenTools.includes(toolName.toLowerCase())) return "";
  const st = part?.state || {};
  const detail = displayToolDetail(toolName, st.input || {}, st);
  const status: string = st.status || "pending";
  return [t("transcript.tool", { status: toolStatusLabel(status), tool: toolName }), detail]
    .filter(Boolean)
    .join(" ");
}

function formatTranscriptExecutorProcess(part: any): string {
  const process = record(part?.process) ? part.process : {};
  const title = String(process.title || process.id || "").trim();
  const detail = String(process.detail || "").trim();
  const note = String(process.note || "").trim();
  const output = String(process.output || "").trim();
  const header = [processStatusLabel(String(process.status || "running")), title]
    .filter(Boolean)
    .join(" ");
  return [header, detail, note, output].filter(Boolean).join("\n");
}

function formatTranscriptPart(part: any, role: string): string {
  if (!part || typeof part !== "object") return "";
  if (part.type === "text") return formatTranscriptText(part, role);
  if (part.type === "reasoning") {
    return part.text?.trim()
      ? `${t("transcript.reasoning")}\n${part.text.trim()}`
      : "";
  }
  if (part.type === "tool") return formatTranscriptTool(part);
  if (part.type === "executor_process") return formatTranscriptExecutorProcess(part);
  if (part.type === "file") {
    return part.filename || part.url
      ? t("transcript.file", { value: part.filename || part.url })
      : "";
  }
  if (part.type === "subtask") {
    const text: string = part.description || part.prompt || "";
    return text ? t("transcript.subtask", { value: text }) : "";
  }
  if (part.type === "patch") {
    const files: string[] = Array.isArray(part.files) ? part.files.filter(Boolean) : [];
    return files.length
      ? t("transcript.patch", { value: files.join(", ") })
      : t("transcript.patch_empty");
  }
  if (part.type === "compaction") return t("transcript.compaction");
  return "";
}

// ── Clipboard helpers (

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* clipboard API not available, fall back to execCommand */
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

/** Bridge to app.js nativeMessage — only available when app.js is loaded. */
async function nativeMessage(message: string, options: { title?: string; kind?: string }): Promise<void> {
  const fn = (window as any).nativeMessage;
  if (typeof fn === "function") {
    await fn(message, options);
  }
}

function errorText(key: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || "");
  return `${t(key)}: ${detail}`;
}

// ── Public exports ──

/** Find a named artifact in board.artifacts. */
export function boardArtifact(board: any, label: string): any {
  const list: any[] = board?.artifacts || [];
  return list.find((item) => item.label === label);
}

/**
 * Build a synthetic message object.
 * Returns null if text is empty.
 * Results are cached by ID to maintain referential stability for Solid's
 * `<For>`, which tracks items by reference.
 */
const _syntheticCache = new Map<string, any>();

export function syntheticTextMessage(
  role: string,
  time: number,
  text: string,
): any | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const created = Number.isFinite(time) ? time : Date.now();
  const id = `synthetic:${role}:${created}:${hashText(text)}`;
  const cached = _syntheticCache.get(id);
  if (cached) return cached;
  const msg = {
    _synthetic: true,
    info: { id, role, time: { created } },
    parts: [{ type: "text", text }],
  };
  _syntheticCache.set(id, msg);
  return msg;
}

/**
 * Format an array of conversation messages as a plain-text transcript
 * (
 */
export function formatConversationTranscript(messages: any[]): string {
  return (Array.isArray(messages) ? messages : [])
    .map((item) => {
      const role: string = item?.info?.role || "assistant";
      const header = joinBullet([
        transcriptRole(role),
        transcriptTime(item?.info?.time?.created),
      ]);
      const body = (Array.isArray(item?.parts) ? item.parts : [])
        .map((part: any) => formatTranscriptPart(part, role))
        .filter(Boolean)
        .join("\n\n")
        .trim();
      if (!body) return "";
      return `${header}\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** Extract spec content as plain text (mirrors app.js specContextText). */
export function specContextText(spec: any): string {
  const text =
    typeof spec?.content === "string" ? spec.content.trim() : "";
  return text;
}

/**
 * Build plain-text plan context (
 * @param plan Board plan object
 * @param goals Goals cards array from the board lanes
 */
export function planContextText(plan: any, goals: any[]): string {
  const planner = plan.metadata?.planner || {};
  const steps: any[] = Array.isArray(plan.metadata?.steps)
    ? plan.metadata.steps
    : [];
  const milestones: any[] = Array.isArray(plan.metadata?.milestones)
    ? plan.metadata.milestones
    : [];
  const risks: any[] = Array.isArray(plan.metadata?.risks)
    ? plan.metadata.risks
    : [];
  const warnings: string[] = Object.values(
    plan.metadata?.stage_sources || {},
  )
    .flatMap((stage: any) =>
      stage &&
      typeof stage === "object" &&
      typeof stage.warning === "string" &&
      stage.warning.trim()
        ? [stage.warning.trim()]
        : [],
    )
    .filter(
      (value: string, index: number, list: string[]) =>
        list.indexOf(value) === index,
    );
  const clarification = plan.metadata?.clarification;
  const spec = plan.metadata?.spec_analysis;
  const assumptions: any[] = Array.isArray(spec?.assumptions)
    ? spec.assumptions
    : [];

  const lines: string[] = [t("plan.context.title", { version: plan.version })];
  if (plan.summary)
    lines.push("", t("plan.context.summary", { value: plan.summary }));
  if (planner.role || planner.quality || planner.source) {
    lines.push(
      "",
      t("plan.context.planner", {
        value: [planner.role, planner.quality, planner.source]
          .filter(Boolean)
          .join(" / "),
      }),
    );
  }
  if (warnings.length > 0) {
    lines.push("", t("plan.context.warnings"));
    lines.push(...warnings.map((warning) => `- ${warning}`));
  }
  if (steps.length > 0) {
    lines.push("", t("plan.context.execution"));
    lines.push(
      ...steps.slice(0, 8).map((step, index) => `${index + 1}. ${step}`),
    );
  }
  if (milestones.length > 0) {
    lines.push("", t("plan.context.milestones"));
    lines.push(
      ...milestones.map((item, index) => `- ${index + 1}. ${item.title}`),
    );
  }
  if (goals.length > 0)
    lines.push(
      "",
      t("plan.context.goal_count", { count: goals.length }),
    );
  if (risks.length > 0) {
    lines.push("", t("plan.context.risks"));
    lines.push(...risks.slice(0, 5).map((risk) => `- ${risk}`));
  }
  if (assumptions.length > 0) {
    lines.push("", t("plan.context.assumptions"));
    lines.push(
      ...assumptions.slice(0, 5).map((item) => {
        const question =
          typeof item?.question === "string" ? item.question.trim() : "";
        const assumption =
          typeof item?.assumption === "string"
            ? item.assumption.trim()
            : "";
        if (question && assumption) return `- ${question}: ${assumption}`;
        return `- ${question || assumption}`;
      }),
    );
  }
  if (clarification?.questions?.length) {
    lines.push(
      "",
      tc("plan.context.clarification", clarification.questions.length, {
        count: clarification.questions.length,
      }),
    );
  }
  return lines.join("\n");
}

/**
 * Build plain-text goal list context (
 * @param goals Goals cards array from the board lanes
 */
export function goalContextText(goals: any[]): string {
  const passed = goals.filter((goal) => goal.status === "passed").length;
  const failed = goals.filter((goal) => goal.status === "failed").length;
  const pending = goals.filter(
    (goal) => goal.status !== "passed" && goal.status !== "failed",
  ).length;
  const header =
    passed + failed > 0
      ? t("goal.context.results", {
          passed,
          total: goals.length,
          failed,
          pending,
        })
      : t("goal.context.list", { total: goals.length });
  const lines = [header, ""];
  for (const goal of goals) {
    const icon =
      goal.status === "passed"
        ? "\u2705"
        : goal.status === "failed"
          ? "\u274C"
          : "\u23F3";
    lines.push(`${icon} **${goal.title}**`);
    if (goal.detail)
      lines.push(t("goal.context.criteria", { value: goal.detail }));
    if (goal.metadata?.origin)
      lines.push(t("goal.context.origin", { value: goal.metadata.origin }));
  }
  return lines.join("\n");
}

/**
 * Build plain-text evaluation context (
 * @param board Board object (must have board.evaluation)
 * @param goals Goals cards array from the board lanes
 */
export function evaluationContextText(board: any, goals: any[]): string {
  const evaluation = board.evaluation;
  const analysis =
    boardArtifact(board, "evaluator-agent-analysis")?.payload || {};
  const error =
    boardArtifact(board, "evaluator-agent-error")?.payload || {};
  const verdictIcon =
    evaluation.verdict === "accepted"
      ? "\u2705"
      : evaluation.verdict === "rejected"
        ? "\u274C"
        : "\u26A0";
  const lines: string[] = [
    `${verdictIcon} ${t("evaluation.context.title", { verdict: evaluationVerdictLabel(evaluation.verdict) })}`,
  ];
  if (analysis.classification)
    lines.push(
      "",
      t("evaluation.context.classification", {
        value: analysis.classification,
      }),
    );
  if (evaluation.summary) lines.push("", evaluation.summary);
  if (error.error)
    lines.push(
      "",
      t("evaluation.context.error", { value: error.error }),
    );

  const checks: any[] = evaluation.checks || [];
  if (checks.length > 0) {
    lines.push("", t("evaluation.context.checks"));
    for (const check of checks) {
      const icon =
        check.status === "passed"
          ? "\u2713"
          : check.status === "failed"
            ? "\u2717"
            : "\u2014";
      lines.push(`- ${icon} ${check.name}: ${check.evidence || check.status}`);
    }
  }

  const goalStatuses: any[] = Array.isArray(analysis.goal_statuses)
    ? analysis.goal_statuses
    : [];
  if (goalStatuses.length > 0) {
    lines.push("", t("evaluation.context.goal_assessments"));
    for (const item of goalStatuses) {
      const goal = goals[item.goal_index];
      const icon =
        item.status === "passed"
          ? "\u2705"
          : item.status === "failed"
            ? "\u274C"
            : "\u23F3";
      const label =
        goal?.title ||
        t("evaluation.context.goal_fallback", { index: item.goal_index + 1 });
      lines.push(`- ${icon} ${label}: ${item.evidence || item.status}`);
    }
  }

  if (
    analysis.replan_guidance?.root_cause ||
    analysis.replan_guidance?.suggested_strategy
  ) {
    lines.push("", t("evaluation.context.replan"));
    if (analysis.replan_guidance.root_cause)
      lines.push(
        t("evaluation.context.root_cause", {
          value: analysis.replan_guidance.root_cause,
        }),
      );
    if (analysis.replan_guidance.suggested_strategy)
      lines.push(
        t("evaluation.context.strategy", {
          value: analysis.replan_guidance.suggested_strategy,
        }),
      );
  }

  return lines.join("\n");
}

/** Build interaction request prompt text (mirrors app.js interactionRequestText). */
export function interactionRequestText(interaction: any): string {
  const title =
    typeof interaction?.title === "string" && interaction.title.trim()
      ? interaction.title.trim()
      : t("detail.pending_interactions");
  const body =
    typeof interaction?.body === "string" ? interaction.body.trim() : "";
  return [title, body].filter(Boolean).join("\n\n");
}

/** Label for a permission reply value (mirrors app.js interactionReplyLabel). */
export function interactionReplyLabel(reply: string): string {
  if (reply === "always") return t("interaction.always_allow");
  if (reply === "reject") return t("interaction.reject");
  return t("interaction.allow_once");
}

/** Build answer lines for an interaction (mirrors app.js interactionAnswerLines). */
export function interactionAnswerLines(interaction: any): string[] {
  const response = record(interaction?.response) ? interaction.response : null;
  const payload = record(interaction?.payload) ? interaction.payload : null;
  const questions: any[] = Array.isArray(payload?.questions)
    ? payload.questions
    : [];
  if (Array.isArray(response?.answers)) {
    return response.answers.flatMap((answer: any, index: number) => {
      const value = Array.isArray(answer)
        ? answer
            .filter(
              (item: any) => typeof item === "string" && item.trim(),
            )
            .join(", ")
        : "";
      if (!value) return [];
      const question = record(questions[index]) ? questions[index] : null;
      const label =
        typeof question?.header === "string" && question.header.trim()
          ? question.header.trim()
          : typeof question?.question === "string" &&
              question.question.trim()
            ? question.question.trim()
            : "";
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }
  if (record(response?.answers)) {
    return Object.entries(response.answers).flatMap(
      ([key, item]: [string, any], index: number) => {
        const answer = record(item) ? item : null;
        const value = Array.isArray(answer?.answers)
          ? answer.answers
              .filter(
                (entry: any) => typeof entry === "string" && entry.trim(),
              )
              .join(", ")
          : "";
        if (!value) return [];
        const question = record(questions[index]) ? questions[index] : null;
        const label =
          typeof question?.header === "string" && question.header.trim()
            ? question.header.trim()
            : typeof question?.question === "string" &&
                question.question.trim()
              ? question.question.trim()
              : key;
        return [label ? `- **${label}**: ${value}` : `- ${value}`];
      },
    );
  }
  const message =
    typeof response?.message === "string" ? response.message.trim() : "";
  return message ? [message] : [];
}

/** Check if an interaction was auto-replied by the orchestrator. */
export function isAutoReplied(interaction: any): boolean {
  const response = record(interaction?.response) ? interaction.response : null;
  return response?.auto_reply === true;
}

/** Build full interaction response text (mirrors app.js interactionResponseText). */
export function interactionResponseText(interaction: any): string {
  const auto = isAutoReplied(interaction);
  const prefix = auto ? `[${t("interaction.auto_reply")}] ` : "";
  if (interaction?.type === "permission") {
    if (interaction.status === "rejected") return prefix + t("interaction.reject");
    const response = record(interaction?.response)
      ? interaction.response
      : null;
    return prefix + interactionReplyLabel(
      typeof response?.reply === "string" ? response.reply : "once",
    );
  }
  if (interaction?.status === "rejected") return prefix + t("interaction.skip");
  const answers = interactionAnswerLines(interaction);
  if (answers.length > 0) return prefix + answers.join("\n");
  return prefix + t("interaction.answer");
}

/**
 * Copy the current chat conversation transcript to the clipboard.
 * Shows a native error dialog on failure.
 */
export async function copyChatConversation(): Promise<void> {
  try {
    const transcript = formatConversationTranscript(conversationMessages());
    if (!transcript) return;
    const ok = await copyText(transcript);
    if (!ok) throw new Error(t("chat.copy_failed"));
  } catch (e) {
    AppLog.error("ui", "Failed to copy chat conversation", {
      error: String(e),
    });
    await nativeMessage(errorText("chat.copy_failed", e), {
      title: t("chat.copy_title"),
      kind: "error",
    });
  }
}
