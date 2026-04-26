// ── Card Tree — CardNode type + render-side helpers ──
//
// The canonical source of truth for the card tree is `store/card-tree.ts`
// (`cardTreeStore`). This file holds:
//
//  1. `CardNode` — structurally compatible with the store's CardNode so that
//     transient card instances (nested tool cards in CardParts) and store-backed
//     cards render through the same component path.
//  2. `shouldPromoteTool` — historical render heuristic retained for
//     compatibility with older callers and policy discussions.
//  3. `defaultExpandedForNode` / `collectCardText` — render-side helpers
//     used by Card / CardHeader.
import { cardTreeStore } from "../store/card-tree";
import type { StepPayload } from "../store/card-tree";
import { toolNameKey, displayToolIcon, displayToolDetail } from "./tool";

export type { StepPayload } from "../store/card-tree";

export type CardKind = "agent" | "step" | "phase" | "tool" | "message" | "integrity";
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
  /** Goal index / round number; shown as #GN when > 0. */
  round?: number;
  /** Goal attempt / retry number; shown as Vn on goal-scoped step cards. */
  attempt?: number;
  /** Goal this card belongs to — stamped on the executor step card and any
   *  goal-phase / session card routed into it. */
  goalID?: string;
  /** Goal description (markdown) — only set on executor step cards. */
  goalDescription?: string;
  /** Structured per-step content. Only set for kind="step" nodes — drives
   *  the step body render path (changed files, diff stats, plan nodes, eval
   *  checks, etc.) so the main conversation shows the same detail as the
   *  sidebar Goals panel. */
  stepPayload?: StepPayload;
  /** For kind="step" with stepPayload.buildSessionID — exposed so the
   *  Card renderer can wire an "Open build session" button without re-reading
   *  board state. */
  stepID?: string;
  /** Flattened leaf parts (text / reasoning / tool / patch / file / subtask / boundary). */
  parts: any[];
  /** Inline nested cards — only set on transient CardNode instances built on
   *  the fly by the renderer (e.g. CardParts promoting a tool part into its
   *  own card). Store-backed cards reference children by id via `childIDs`. */
  children?: CardNode[];
  /** Store-backed child ids (parity with `store/card-tree.ts` CardNode). The
   *  renderer prefers `childIDs` when present so it can dereference through
   *  the cardTreeStore proxy and preserve fine-grained reactivity. */
  childIDs?: string[];
  /** Sort key (ms). Required for structural parity with the store CardNode
   *  (see `store/card-tree.ts`). Transient tool-promoted cards are always
   *  nested (never top-level), so the value is observation time only —
   *  the rebuildTopLevelOrder sort never sees these. */
  time: number;
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
  /** Structured integrity review payload — only populated for kind="integrity"
   *  nodes (produced by tree-writer on integrity.review.completed). Mirrors
   *  the shape defined in `store/card-tree.ts` so a store CardNode is
   *  assignable to this utils CardNode without casting. */
  integrity?: {
    verdict: "pass" | "concerns" | "needs_correction";
    summary: string;
    dimensions: Array<{
      id: "goal_fidelity" | "technical_feasibility" | "hallucination" | "solution_quality";
      verdict: "pass" | "concerns" | "needs_correction";
      issueCount: number;
      correctionCount: number;
      missingGoalCount: number;
    }>;
    issues: Array<{ type: string; description: string }>;
    corrections: Array<{
      action: "modify" | "split" | "remove";
      goalID: string;
      reason: string;
      updatesTitle?: string;
      updatesObjective?: string;
    }>;
    missingGoals: Array<{ title: string; objective: string; reason?: string }>;
    attempts: number;
  };
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

// ── Tool expansion heuristic ──
// Historical name kept because downstream code already imports it. The
// function answers the historical question: which tool outputs are substantial
// enough to deserve card-style treatment or default expansion policy?
// Current CardParts behavior renders every tool as a card and leaves completed
// tools collapsed by default, but the heuristic is kept as a single policy hook.

// Todo tools render a structured checklist; inline chips would hide the list,
// and a collapsed completed card would hide the plan itself — so they stay
// both promoted and expanded regardless of completion status.
const TODO_TOOLS = new Set([
  "todowrite", "todoread", "todoupdate", "updateplan",
]);
const ALWAYS_PROMOTE_TOOLS = new Set([
  "task", "agent", "spawnagent", "subagent",
  ...TODO_TOOLS,
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

// ── Default fold policy ──
// Used by <Card> and the folding store (S3) to decide what to show when no
// explicit user override is present.

export function defaultExpandedForNode(node: CardNode): boolean {
  if (typeof node.defaultExpanded === "boolean") return node.defaultExpanded;
  if (node.status === "running") return true;
  if (node.kind === "agent") return true;
  if (node.kind === "message") return true;
  // Integrity verdicts: always expand. The entire point of the card is to
  // surface the structured verdict; a collapsed badge would be weaker than
  // the previous raw-JSON render it replaces.
  if (node.kind === "integrity") return true;
  // Executor step cards carry goal description + phase children — the
  // operator almost always wants those visible when the goal is alive.
  // A completed executor collapses to save space.
  if (node.kind === "step") return node.status !== "completed";
  // Todo checklists must stay expanded — the card's whole value is the list
  // of remaining items; a collapsed completed card hides the plan itself.
  if (node.kind === "tool" && TODO_TOOLS.has(toolNameKey(node.toolPart?.tool || ""))) return true;
  // tool defaults: collapsed when completed, open when running.
  return node.status !== "completed";
}

// ── Text collection (for copy-to-clipboard) ──
// Walks a card node and its descendants, emitting the human-readable prose
// parts: text / reasoning, plus goal description on executor
// step cards. Tool input/output and binary parts (patch/file) are skipped —
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
  if (node.kind === "step" && node.goalDescription) {
    chunks.push(String(node.goalDescription).trim());
  }
  for (const part of node.parts || []) {
    const text = partText(part);
    if (text) chunks.push(text);
  }
  // Store-backed cards reference children by id — dereference via the store.
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid];
    if (!child) continue;
    const sub = collectCardText(child);
    if (sub) chunks.push(sub);
  }
  // Transient cards (tool promotion in CardParts) carry inline children.
  for (const child of node.children || []) {
    const sub = collectCardText(child);
    if (sub) chunks.push(sub);
  }
  return chunks.filter(Boolean).join("\n\n");
}

// ── Latest-activity preview (collapsed header) ──
// Walks the subtree and keeps only the single most recent activity by
// (card.time, part-index). An activity is either:
//   - a text/reasoning part (assistant prose / chain-of-thought), or
//   - a tool part (formatted as "<icon> <ToolName>: <detail>" so the
//     operator can see "what is this card actually doing right now").
// This is the canonical preview source — text and tool calls compete
// for the same line so the operator always sees the actual latest
// signal, not whichever channel happened to be picked.

interface LatestHit { time: number; index: number; text: string }

function toolHitText(part: any): string {
  if (!part || part.type !== "tool") return "";
  const name = String(part.tool || "").trim();
  if (!name) return "";
  const key = toolNameKey(name);
  // Todo tools own a dedicated UI row; surfacing them here would steal
  // attention from the actual work that happened around the plan.
  if (TODO_TOOLS.has(key)) return "";
  const state = part.state || {};
  const icon = displayToolIcon(name);
  const detail = displayToolDetail(name, state.input, state, "");
  const head = icon ? `${icon} ${name}` : name;
  return detail ? `${head}: ${detail}` : head;
}

function gatherLatest(node: CardNode, hits: LatestHit[]): void {
  if (!node) return;
  const baseTime = typeof node.time === "number" ? node.time : 0;
  if (node.kind === "tool" && node.toolPart) {
    const toolText = toolHitText(node.toolPart);
    if (toolText) hits.push({ time: baseTime, index: 0, text: toolText });
  }
  const parts = node.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const text = partText(part);
    if (text) {
      hits.push({ time: baseTime, index: i, text });
      continue;
    }
    const toolText = toolHitText(part);
    if (toolText) hits.push({ time: baseTime, index: i, text: toolText });
  }
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid];
    if (child) gatherLatest(child as unknown as CardNode, hits);
  }
  for (const child of node.children || []) {
    gatherLatest(child, hits);
  }
}

export function collectLatestActivityText(node: CardNode): string {
  if (!node) return "";
  const hits: LatestHit[] = [];
  gatherLatest(node, hits);
  if (hits.length === 0) {
    if (node.kind === "step" && node.goalDescription) {
      return String(node.goalDescription).trim();
    }
    return "";
  }
  let best = hits[0];
  for (let i = 1; i < hits.length; i++) {
    const h = hits[i];
    if (h.time > best.time || (h.time === best.time && h.index > best.index)) {
      best = h;
    }
  }
  return best.text;
}

// ── Activity counts (collapsed header) ──
// Tally the work that has happened inside a card subtree so the collapsed
// header can show "🤖 2  🛠 14  🎯 1  💬 5" and the operator gets a sense
// of activity volume without expanding the card.

export interface ActivityCounts {
  messages: number;
  tools: number;
  agents: number;
  skills: number;
}

const AGENT_SPAWN_TOOLS = new Set([
  "task", "agent", "spawnagent", "subagent",
]);

function isSkillTool(key: string): boolean {
  // Claude-Code-style Skill tool, plus any tool whose key contains "skill"
  // (covers "skill", "invokeskill", "useskill", etc).
  return key === "skill" || /skill/.test(key);
}

function bumpCountsForPart(part: any, counts: ActivityCounts): void {
  if (!part) return;
  if (part.type === "text" || part.type === "reasoning") {
    if (String(part.text || "").trim()) counts.messages++;
    return;
  }
  if (part.type !== "tool") return;
  const key = toolNameKey(part.tool || "");
  if (!key) return;
  if (AGENT_SPAWN_TOOLS.has(key)) {
    counts.agents++;
    return;
  }
  if (isSkillTool(key)) {
    counts.skills++;
    return;
  }
  counts.tools++;
}

function gatherCounts(node: CardNode, counts: ActivityCounts): void {
  if (!node) return;
  if (node.kind === "tool" && node.toolPart) {
    bumpCountsForPart(node.toolPart, counts);
  }
  for (const part of node.parts || []) {
    bumpCountsForPart(part, counts);
  }
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid];
    if (child) gatherCounts(child as unknown as CardNode, counts);
  }
  for (const child of node.children || []) {
    gatherCounts(child, counts);
  }
}

export function collectActivityCounts(node: CardNode): ActivityCounts {
  const counts: ActivityCounts = { messages: 0, tools: 0, agents: 0, skills: 0 };
  gatherCounts(node, counts);
  return counts;
}

// ── Todo summary (collapsed header) ──
// Walks the subtree to find the most recent TodoWrite/UpdatePlan tool part
// and reports counts + the in-progress (or last completed) item title.
// Returns null when no todo tool calls exist anywhere in the subtree —
// the header then skips the third row entirely.

export interface TodoSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  /** Title of the in_progress item, else last completed, else first pending. */
  current: string;
}

function todoTitle(item: any): string {
  if (!item || typeof item !== "object") return "";
  const af = typeof item.activeForm === "string" ? item.activeForm.trim() : "";
  const c = typeof item.content === "string" ? item.content.trim() : "";
  return af || c;
}

function extractTodoList(part: any): any[] | null {
  if (!part || part.type !== "tool") return null;
  const key = toolNameKey(part.tool || "");
  if (!TODO_TOOLS.has(key)) return null;
  const state = part.state || {};
  const inputTodos = state.input && Array.isArray(state.input.todos) ? state.input.todos : null;
  if (inputTodos) return inputTodos;
  const metaTodos = state.metadata && Array.isArray(state.metadata.todos) ? state.metadata.todos : null;
  if (metaTodos) return metaTodos;
  const out = typeof state.output === "string" ? state.output.trim() : "";
  if (out.startsWith("[")) {
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // streaming / truncated — ignore
    }
  }
  return null;
}

interface TodoHit { time: number; index: number; todos: any[] }

function gatherTodos(node: CardNode, hits: TodoHit[]): void {
  if (!node) return;
  const baseTime = typeof node.time === "number" ? node.time : 0;
  // kind="tool" cards carry the tool part on `toolPart` (parts[] is empty
  // because the tool was promoted into its own card).
  if (node.kind === "tool" && node.toolPart) {
    const todos = extractTodoList(node.toolPart);
    if (todos && todos.length > 0) hits.push({ time: baseTime, index: 0, todos });
  }
  const parts = node.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const todos = extractTodoList(parts[i]);
    if (todos && todos.length > 0) hits.push({ time: baseTime, index: i, todos });
  }
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid];
    if (child) gatherTodos(child as unknown as CardNode, hits);
  }
  for (const child of node.children || []) {
    gatherTodos(child, hits);
  }
}

export function collectTodoSummary(node: CardNode): TodoSummary | null {
  if (!node) return null;
  const hits: TodoHit[] = [];
  gatherTodos(node, hits);
  if (hits.length === 0) return null;
  let best = hits[0];
  for (let i = 1; i < hits.length; i++) {
    const h = hits[i];
    if (h.time > best.time || (h.time === best.time && h.index > best.index)) {
      best = h;
    }
  }
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let inProgressTitle = "";
  let lastCompletedTitle = "";
  let firstPendingTitle = "";
  for (const item of best.todos) {
    const status = String((item as any)?.status || "").toLowerCase().trim();
    const title = todoTitle(item);
    if (status === "completed") {
      completed++;
      if (title) lastCompletedTitle = title;
    } else if (status === "in_progress") {
      inProgress++;
      if (title && !inProgressTitle) inProgressTitle = title;
    } else if (status === "cancelled") {
      // Cancelled items don't contribute to progress, but still count toward total.
    } else {
      pending++;
      if (title && !firstPendingTitle) firstPendingTitle = title;
    }
  }
  const current = inProgressTitle || firstPendingTitle || lastCompletedTitle;
  return {
    total: best.todos.length,
    completed,
    inProgress,
    pending,
    current,
  };
}
