// ── Card Tree ──
// 统一的卡片数据模型，覆盖 goal 组、agent stage 卡、普通消息三类输入。
// 纯函数：把 conversationMessages() 的输出转为递归 CardNode 树，
// 供 <Card> 原语递归渲染。

import { orderedMessageParts, effectiveRole, roleLabel, agentStageLabel } from "./message";
import { toolNameKey } from "./tool";
import { stageAccent } from "./card-color";
import {
  charsToTokens,
  estimateMessageChars,
  providerContextTokens,
} from "./tokens-estimate";

export type CardKind = "agent" | "goal" | "step" | "tool" | "message" | "compaction";
export type CardStatus = "pending" | "running" | "completed" | "error" | "skipped";

/** A synthetic "part" inserted between messages when flattening multiple
 *  messages into a single card body. Lets <CardParts> emit a role/time
 *  separator without losing message boundaries. */
export interface BoundaryPart {
  type: "boundary";
  role: string;
  roleLabel: string;
  time?: number;
}

/** Structured content for a workflow step node (kind="step").
 *  Mirrors workbench/board.ts GoalStepPayload — see that file for invariants. */
export interface StepPayload {
  // plan
  planNodes?: Array<{ id: string; title: string; brief: string; orderIndex: number }>;
  // execute
  executorSessionID?: string;
  changedFiles?: string[];
  diffStats?: { files?: number; additions?: number; deletions?: number };
  // eval
  checks?: Array<{ name: string; status: string; evidence?: string; family?: string }>;
  evalSummary?: string;
  verdict?: string;
}

export interface CardNode {
  /** Stable folding key. */
  id: string;
  kind: CardKind;
  /** For kind=message: user/system/agent role; for agent cards: stage role. */
  role?: string;
  /** Raw stage name (planner/executor/…) — drives per-stage accents. */
  stage?: string;
  /** Resolved accent colour (CSS value) for this card's stage. Undefined when
   *  the node has no stage (e.g. plain message bubble). Written into an
   *  inline `--card-stage` CSS variable by <Card>, consumed by card.css. */
  accent?: string;
  status?: CardStatus;
  /** Header primary label. */
  title: string;
  /** Header secondary slot (e.g. goal id tail, path, command). */
  subtitle?: string;
  /** Goal index / round number; shown as #N when > 0. */
  round?: number;
  /** Goal description (markdown) — only set on kind=goal. */
  goalDescription?: string;
  contracts?: Array<{ key: string; value: string; reason?: string }>;
  steps?: Array<{ stepID: string; label: string; status: string; summary?: string }>;
  /** Structured per-step content. Only set for kind="step" nodes — drives
   *  the step body render path (changed files, diff stats, plan nodes, eval
   *  checks, etc.) so the main conversation shows the same detail as the
   *  sidebar Goals panel. */
  stepPayload?: StepPayload;
  /** For kind="step" with stepPayload.executorSessionID — exposed so the
   *  Card renderer can wire an "Open session" button without re-reading
   *  board state. */
  stepID?: string;
  /** Flattened leaf parts (text / reasoning / tool / patch / file / subtask / boundary). */
  parts: any[];
  /** Nested child cards. */
  children: CardNode[];
  /** Sort key (ms); undefined = appended at the end. */
  time?: number;
  /** Explicit default for the unified fold store; if omitted falls back to
   *  (status === "running" || kind in {agent,goal}) ? open : closed. */
  defaultExpanded?: boolean;
  /** Raw tool part for kind="tool" nodes — rendered by <Card> via
   *  InlineToolPart mode="body". Always undefined for non-tool kinds. */
  toolPart?: any;
  /**
   * Estimated prompt-context size the LLM saw at this message, in tokens.
   * Populated from Assistant.tokens.input (which already represents the
   * cumulative context sent up to and including this turn — providers bill
   * per turn on the fully-assembled message array, so there is nothing to
   * sum client-side). Left undefined for turns that never hit the model
   * (user bubbles, synthetic system notes). The UI renders it with low
   * contrast and an "est." marker because the number is a provider-reported
   * estimate and can drift slightly against actual billed tokens.
   */
  contextTokens?: number
  /**
   * True when contextTokens came from a local chars/token approximation
   * rather than a provider-reported figure. Drives the "est." label so
   * the operator knows which value they're looking at. When a card
   * aggregates children, the flag is true only if no provider-reported
   * value contributed to the aggregate maximum.
   */
  contextTokensEstimated?: boolean
  /**
   * True when this card represents a conversation-compaction summary
   * (Assistant.summary === true). The summary card replaces the compacted
   * history; surfacing it as a distinct card tells the operator exactly
   * where the window was reset.
   */
  isCompactionSummary?: boolean
}

// ── Status normalisation ──

function normStatus(raw: any): CardStatus | undefined {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "pending" || s === "running" || s === "completed" || s === "error" || s === "skipped") {
    return s as CardStatus;
  }
  if (s === "failed" || s === "fail") return "error";
  if (s === "done" || s === "ok" || s === "passed") return "completed";
  return undefined;
}

function normGoalStatus(raw: any): CardStatus | undefined {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "passed") return "completed";
  if (s === "failed") return "error";
  return normStatus(raw);
}

// ── Tool promotion rules ──
// Whether a tool part should be elevated to its own <Card> rather than
// rendered inline. Called by downstream renderers in S2; exported pure
// so it can be unit-tested independently.

const ALWAYS_PROMOTE_TOOLS = new Set([
  "task", "agent", "spawnagent", "subagent",
]);
const CODE_WRITE_TOOLS = new Set([
  "write", "writefile", "edit", "editfile", "applypatch",
]);

const PROMOTE_OUTPUT_CHARS = 500;
const PROMOTE_READ_LINES = 20;
const PROMOTE_BASH_LINES = 10;

function countLines(s: string): number {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

export function shouldPromoteTool(part: any): boolean {
  if (!part || part.type !== "tool") return false;
  const key = toolNameKey(part.tool || "");
  if (ALWAYS_PROMOTE_TOOLS.has(key)) return true;
  const state = part.state || {};
  const status = state.status;
  const input = state.input || {};
  const output = String(state.output || "");
  const error = String(state.error || "");
  if (status === "error" && (error || output)) return true;
  if (CODE_WRITE_TOOLS.has(key)) {
    // Promoting write/edit even while running gives users a container to
    // watch the diff accumulate.
    if (input && (input.content || input.new_string || input.text)) return true;
  }
  if (key === "read" || key === "readfile") {
    if (countLines(output) > PROMOTE_READ_LINES) return true;
  }
  if (key === "bash" || key === "shellcommand" || key === "runcommand") {
    if (countLines(output) > PROMOTE_BASH_LINES) return true;
  }
  if (output.length > PROMOTE_OUTPUT_CHARS) return true;
  return false;
}

// ── Part flattening ──

/** Flatten an array of messages into a single parts list with role/time
 *  boundaries preserved as synthetic "boundary" parts. Skips user messages
 *  inside agent cards (they are request echoes, not agent output). */
function flattenMessages(messages: any[], opts: { dropUser?: boolean } = {}): any[] {
  const out: any[] = [];
  for (const msg of messages || []) {
    const role = String(msg?.info?.role || "").toLowerCase();
    if (opts.dropUser !== false && role === "user") continue;
    const parts = orderedMessageParts(msg);
    if (parts.length === 0) continue;
    const effRole = String(effectiveRole(msg) || role || "assistant");
    const boundary: BoundaryPart = {
      type: "boundary",
      role: effRole,
      roleLabel: roleLabel(effRole),
      time: Number(msg?.info?.time?.created) || undefined,
    };
    out.push(boundary);
    for (const p of parts) out.push(p);
  }
  return out;
}

// ── Goal steps ──

// Stage order used when a goal has internal cards but no explicit
// goalSteps metadata. Reflects the per-goal session tree: build is the
// container, planner + executor are its children. evaluator is a separate
// sibling when the legacy judge path runs.
const STEP_ORDER = ["build", "planner", "executor", "evaluator"];

function stepIDToStage(stepID: string): string {
  // Pipeline workflow has ONE goal-scope step: `build`. The build step maps
  // to the `build` stage (session.kind="build") which hosts planner + executor
  // as nested sub-sessions. Any other stepID passes through unchanged — the
  // workflow registry is the source of truth for legal IDs.
  return stepID;
}

function stepTitle(stage: string, step?: { label?: string }): string {
  if (step?.label) return step.label;
  return agentStageLabel(stage);
}

/** Fall-back subtitle when the backend hasn't emitted `step.summary` yet —
 *  which happens during the entire runtime of a step because summaries are
 *  derived from committed DB rows (plan nodes / delivery / evaluation) that
 *  only land once the step finishes. Without this, long-running Build rows
 *  render completely empty. */
function deriveStepSubtitle(
  stepID: string,
  status: CardStatus,
  payload: StepPayload | undefined,
): string | undefined {
  // The `build` step folds plan + execute + eval into one payload.
  if (stepID !== "build") return undefined;
  if (payload?.diffStats?.files !== undefined && payload.diffStats.files > 0) {
    return `${payload.diffStats.files} files`;
  }
  if (payload?.changedFiles?.length) {
    return `${payload.changedFiles.length} files`;
  }
  if (payload?.checks?.length) {
    const passed = payload.checks.filter((c) => c.status === "passed").length;
    return `${passed}/${payload.checks.length} checks`;
  }
  if (payload?.verdict) return payload.verdict;
  if (payload?.planNodes?.length) return `${payload.planNodes.length} steps`;
  if (payload?.executorSessionID && status === "running") return "running…";
  return undefined;
}

// ── Conversion entry points ──

/** Highest per-turn `tokens.input` across a message list. Represents the
 *  high-water mark of context size the LLM had to reason over — summing
 *  would double-count because each turn's input already includes prior
 *  turns.
 *
 *  For turns that didn't hit the model (or haven't yet), fall back to a
 *  running chars/token estimate computed cumulatively within this message
 *  list. This keeps the card token hint populated on user bubbles,
 *  in-flight streams and stages that haven't returned token accounting
 *  yet, which is why callers also receive a `estimated` flag so the UI
 *  can tag approximated values. */
function maxContextTokens(messages: any[] | undefined): {
  value?: number;
  estimated: boolean;
} {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { value: undefined, estimated: false };
  }
  let max: number | undefined = undefined;
  let maxFromProvider = false;
  let runningChars = 0;
  for (const m of messages) {
    runningChars += estimateMessageChars(m);
    const provided = providerContextTokens(m);
    if (provided !== undefined) {
      if (max === undefined || provided > max) {
        max = provided;
        maxFromProvider = true;
      }
      continue;
    }
    const est = charsToTokens(runningChars);
    if (est > 0 && (max === undefined || est > max)) {
      max = est;
      maxFromProvider = false;
    }
  }
  return { value: max, estimated: max !== undefined && !maxFromProvider };
}

/** Estimate a single message's contribution as a cumulative figure when no
 *  provider value is available. Used for plain message bubbles (user /
 *  synthetic) where there is no surrounding conversation context to sum. */
function singleMessageContext(message: any): { value?: number; estimated: boolean } {
  const provided = providerContextTokens(message);
  if (provided !== undefined) return { value: provided, estimated: false };
  const est = charsToTokens(estimateMessageChars(message));
  return est > 0 ? { value: est, estimated: true } : { value: undefined, estimated: false };
}

function goalToNode(item: any): CardNode {
  const cardID = String(item.id || "goal");
  const status = normStatus(item.status) ?? "pending";
  const goalStatus = normGoalStatus(item.goalStatus);
  const steps = Array.isArray(item.goalSteps) ? item.goalSteps : [];

  const internalByStage = new Map<string, any>();
  for (const c of item.internalCards || []) {
    if (c?.stage) internalByStage.set(String(c.stage), c);
  }

  const children: CardNode[] = [];
  let goalContextTokens: number | undefined = undefined;
  let goalFromProvider = false;
  const accumulate = (ctx: { value?: number; estimated: boolean }) => {
    if (ctx.value === undefined) return;
    if (goalContextTokens === undefined || ctx.value > goalContextTokens) {
      goalContextTokens = ctx.value;
      goalFromProvider = !ctx.estimated;
    }
  };

  if (steps.length > 0) {
    for (const step of steps) {
      const stage = stepIDToStage(step.stepID);
      const internal = internalByStage.get(stage);
      const stepStatus =
        normStatus(internal?.status) ?? normStatus(step.status) ?? "pending";
      const stepCtx = maxContextTokens(internal?.messages);
      accumulate(stepCtx);
      const payload: StepPayload | undefined =
        step.payload && typeof step.payload === "object" ? step.payload : undefined;
      // Derive a subtitle: prefer backend-computed summary; otherwise synthesise
      // a running-state hint from the payload so the operator isn't staring at
      // a blank row while the step is in-flight.
      const subtitle =
        step.summary ||
        deriveStepSubtitle(step.stepID, stepStatus, payload) ||
        undefined;
      // Nested sub-agent cards (e.g. a build session spawned by executor)
      // surface as children of this step. Session-tree nesting is computed
      // in computeAgentCards() — here we just recurse into the pre-built
      // `children` array.
      const stepChildren: CardNode[] = Array.isArray(internal?.children)
        ? internal.children.map((c: any) => agentCardToNode(c))
        : [];
      children.push({
        id: `${cardID}:step:${step.stepID}`,
        kind: "step",
        stage,
        accent: stageAccent(stage),
        status: stepStatus,
        title: stepTitle(stage, step),
        subtitle,
        parts: flattenMessages(internal?.messages || []),
        children: stepChildren,
        contextTokens: stepCtx.value,
        contextTokensEstimated: stepCtx.estimated,
        stepPayload: payload,
        stepID: step.stepID,
      });
    }
  } else {
    // No workflow step metadata — sort internal cards into canonical order
    // and render each as its own agent card (with its own subtree).
    const sorted = (item.internalCards || []).slice().sort(
      (a: any, b: any) =>
        STEP_ORDER.indexOf(String(a.stage)) -
        STEP_ORDER.indexOf(String(b.stage)),
    );
    for (const c of sorted) {
      const stepCtx = maxContextTokens(c.messages);
      accumulate(stepCtx);
      children.push(agentCardToNode(c));
    }
  }

  return {
    id: cardID,
    kind: "goal",
    stage: "goal",
    accent: stageAccent("goal"),
    status: goalStatus ?? status,
    title: String(item.goalTitle || "Goal"),
    subtitle: cardID.length > 8 ? cardID.slice(-8) : undefined,
    round: Number(item.round) || 0,
    goalDescription: item.goalDescription || undefined,
    contracts: Array.isArray(item.contracts) ? item.contracts : undefined,
    steps: steps.length > 0 ? steps : undefined,
    parts: [],
    children,
    time: Number(item.time) || undefined,
    contextTokens: goalContextTokens,
    contextTokensEstimated: goalContextTokens !== undefined && !goalFromProvider,
  };
}

function agentCardToNode(item: any): CardNode {
  const stage = String(item.stage || "assistant");
  const cardID = String(item.id || `agent:${stage}`);
  const status = normStatus(item.status) ?? "pending";
  const messages = item.messages || [];
  const ctx = maxContextTokens(messages);
  // Recurse into nested sub-agent cards built by computeAgentCards().
  const children: CardNode[] = Array.isArray(item.children)
    ? item.children.map((c: any) => agentCardToNode(c))
    : [];
  return {
    id: cardID,
    kind: "agent",
    role: stage,
    stage,
    accent: stageAccent(stage),
    status,
    title: agentStageLabel(stage),
    round: Number(item.round) || 0,
    parts: flattenMessages(messages),
    children,
    time: Number(item.time) || undefined,
    contextTokens: ctx.value,
    contextTokensEstimated: ctx.estimated,
  };
}

function messageToNode(item: any): CardNode {
  const id = String(item?.info?.id || `msg:${Math.random().toString(36).slice(2)}`);
  const role = String(effectiveRole(item) || item?.info?.role || "assistant");
  // For a plain message card we do NOT drop user role — the whole point is
  // that this IS a user / synthetic bubble.
  const parts = orderedMessageParts(item);
  const isCompactionSummary = item?.info?.summary === true;
  const hasCompactionPart = Array.isArray(parts) && parts.some((p: any) => p?.type === "compaction");
  const ctx = singleMessageContext(item);
  const contextTokens = ctx.value;
  const contextTokensEstimated = ctx.estimated;

  // A user-side `compaction` part (the trigger) and an assistant-side
  // summary=true message (the result) are both rendered as their own
  // distinct card so operators can see where context was reset.
  if (hasCompactionPart || isCompactionSummary) {
    return {
      id,
      kind: "compaction",
      role,
      status: "completed",
      title: isCompactionSummary ? "Compaction summary" : "Context compaction",
      parts,
      children: [],
      time: Number(item?.info?.time?.created) || undefined,
      defaultExpanded: isCompactionSummary,
      contextTokens,
      contextTokensEstimated,
      isCompactionSummary,
    };
  }

  return {
    id,
    kind: "message",
    role,
    status: undefined,
    title: roleLabel(role),
    parts,
    children: [],
    time: Number(item?.info?.time?.created) || undefined,
    // User / synthetic bubbles: always "expanded"; the header is the bubble
    // itself, not a fold trigger (<Card> CSS handles visual in S2).
    defaultExpanded: true,
    contextTokens,
    contextTokensEstimated,
  };
}

/** Build the full card tree from conversation items (the output of
 *  conversationMessages()). The order of `items` is preserved.
 *  Items are either AgentCardData (kind="agent"|"goal") or raw Message. */
export function toCardTree(items: any[]): CardNode[] {
  const _t0 = performance.now();
  const tree: CardNode[] = [];
  for (const item of items || []) {
    if (!item) continue;
    if (item.kind === "goal") {
      tree.push(goalToNode(item));
    } else if (item.kind === "agent" && (item.messages || []).length > 0) {
      tree.push(agentCardToNode(item));
    } else {
      tree.push(messageToNode(item));
    }
  }
  const _dt = performance.now() - _t0;
  if (_dt > 5) {
    console.warn(`[perf] toCardTree: ${_dt.toFixed(1)}ms, ${tree.length} nodes`);
  }
  return tree;
}

// ── Default fold policy ──
// Used by <Card> and the folding store (S3) to decide what to show when no
// explicit user override is present.

export function defaultExpandedForNode(node: CardNode): boolean {
  if (typeof node.defaultExpanded === "boolean") return node.defaultExpanded;
  if (node.status === "running") return true;
  if (node.kind === "agent" || node.kind === "goal") return true;
  if (node.kind === "message") return true;
  // step / tool defaults: collapsed when completed, open when running.
  return node.status !== "completed";
}

// ── Text collection (for copy-to-clipboard) ──
// Walks a card node and its descendants, emitting the human-readable prose
// parts: text / reasoning, plus goal description and contracts for goal
// cards. Tool input/output and binary parts (patch/file) are skipped —
// they rarely belong in a pasted transcript.

function partText(part: any): string {
  if (!part) return "";
  if (part.type === "text" || part.type === "reasoning") {
    return String(part.text || "").trim();
  }
  return "";
}

export function collectCardText(node: CardNode): string {
  if (!node) return "";
  const chunks: string[] = [];
  if (node.kind === "goal" && node.goalDescription) {
    chunks.push(String(node.goalDescription).trim());
  }
  if (node.kind === "goal" && node.contracts?.length) {
    for (const c of node.contracts) {
      const key = String(c.key || "").trim();
      const value = String(c.value || "").trim();
      if (key || value) chunks.push(key ? `${key}: ${value}` : value);
    }
  }
  for (const part of node.parts || []) {
    const text = partText(part);
    if (text) chunks.push(text);
  }
  for (const child of node.children || []) {
    const sub = collectCardText(child);
    if (sub) chunks.push(sub);
  }
  return chunks.filter(Boolean).join("\n\n");
}
