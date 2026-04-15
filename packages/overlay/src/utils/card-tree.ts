// ── Card Tree ──
// 统一的卡片数据模型，覆盖 goal 组、agent stage 卡、普通消息三类输入。
// 纯函数：把 conversationMessages() 的输出转为递归 CardNode 树，
// 供 <Card> 原语递归渲染。

import { orderedMessageParts, effectiveRole, roleLabel, agentStageLabel } from "./message";
import { toolNameKey } from "./tool";
import { stageAccent } from "./card-color";

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
  "build",
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

const STEP_ORDER = ["planner", "executor", "evaluator"];

function stepIDToStage(stepID: string): string {
  if (stepID === "plan") return "planner";
  if (stepID === "execute") return "executor";
  if (stepID === "eval") return "evaluator";
  return stepID;
}

function stepTitle(stage: string, step?: { label?: string }): string {
  if (step?.label) return step.label;
  return agentStageLabel(stage);
}

// ── Conversion entry points ──

/** Highest per-turn `tokens.input` across a message list. Represents the
 *  high-water mark of context size the LLM had to reason over — summing
 *  would double-count because each turn's input already includes prior
 *  turns. Returns undefined when no message carries a finite token count. */
function maxContextTokens(messages: any[] | undefined): number | undefined {
  if (!Array.isArray(messages)) return undefined;
  let max: number | undefined = undefined;
  for (const m of messages) {
    const t = (m as any)?.info?.tokens?.input;
    if (typeof t === "number" && Number.isFinite(t) && (max === undefined || t > max)) {
      max = t;
    }
  }
  return max;
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
  const accumulate = (value: number | undefined) => {
    if (value === undefined) return;
    if (goalContextTokens === undefined || value > goalContextTokens) goalContextTokens = value;
  };

  if (steps.length > 0) {
    for (const step of steps) {
      const stage = stepIDToStage(step.stepID);
      const internal = internalByStage.get(stage);
      const stepStatus =
        normStatus(internal?.status) ?? normStatus(step.status) ?? "pending";
      const stepContextTokens = maxContextTokens(internal?.messages);
      accumulate(stepContextTokens);
      children.push({
        id: `${cardID}:step:${step.stepID}`,
        kind: "step",
        stage,
        accent: stageAccent(stage),
        status: stepStatus,
        title: stepTitle(stage, step),
        subtitle: step.summary || undefined,
        parts: flattenMessages(internal?.messages || []),
        children: [],
        contextTokens: stepContextTokens,
      });
    }
  } else {
    // No workflow step metadata — sort internal cards into canonical order.
    const sorted = (item.internalCards || []).slice().sort(
      (a: any, b: any) =>
        STEP_ORDER.indexOf(String(a.stage)) -
        STEP_ORDER.indexOf(String(b.stage)),
    );
    for (const c of sorted) {
      const stage = String(c.stage || "");
      const st = normStatus(c.status) ?? "pending";
      const stepContextTokens = maxContextTokens(c.messages);
      accumulate(stepContextTokens);
      children.push({
        id: String(c.id || `${cardID}:step:${stage}`),
        kind: "step",
        stage,
        accent: stageAccent(stage),
        status: st,
        title: agentStageLabel(stage),
        parts: flattenMessages(c.messages || []),
        children: [],
        contextTokens: stepContextTokens,
      });
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
  };
}

function agentCardToNode(item: any): CardNode {
  const stage = String(item.stage || "assistant");
  const cardID = String(item.id || `agent:${stage}`);
  const status = normStatus(item.status) ?? "pending";
  const messages = item.messages || [];
  const contextTokens = maxContextTokens(messages);
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
    children: [],
    time: Number(item.time) || undefined,
    contextTokens,
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
  const tokens = item?.info?.tokens;
  const contextTokens = typeof tokens?.input === "number" && Number.isFinite(tokens.input)
    ? tokens.input
    : undefined;

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
  };
}

/** Build the full card tree from conversation items (the output of
 *  conversationMessages()). The order of `items` is preserved.
 *  Items are either AgentCardData (kind="agent"|"goal") or raw Message. */
export function toCardTree(items: any[]): CardNode[] {
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
