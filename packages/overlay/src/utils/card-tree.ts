// ── Card Tree — render-side helpers ──
//
// The canonical source of truth for the card tree types (`CardNode`,
// `CardKind`, `CardStatus`, `BoundaryPart`, `StepPayload`) is
// `store/card-tree.ts`. Per CLAUDE.md rule 22 (no dual-source), this file
// re-exports those types so consumers can keep importing from utils
// without forking the type — and holds:
//
//  1. `shouldPromoteTool` — historical render heuristic retained for
//     compatibility with older callers and policy discussions.
//  2. `defaultExpandedForNode` / `collectCardText` — render-side helpers
//     used by Card / CardHeader.
import { cardTreeStore } from "../store/card-tree";
import type { CardNode, CardKind, CardStatus, BoundaryPart, StepPayload } from "../store/card-tree";
import { toolNameKey, displayToolIcon, displayToolDetail } from "./tool";
import { extractTodos } from "./todos";

export type { CardNode, CardKind, CardStatus, StepPayload, BoundaryPart } from "../store/card-tree";

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

// Internal-only tools whose tool name + state carry no operator-visible
// signal. StructuredOutput is the Zod-call wrapper used for decompose /
// architect; surfacing it as preview text produces "⚡ StructuredOutput:
// Structured Output" — pure noise. Suppressed alongside TODO tools.
const PREVIEW_SUPPRESS_TOOLS = new Set([
  "structuredoutput",
  "structured_output",
]);

function toolHitText(part: any): string {
  if (!part || part.type !== "tool") return "";
  const name = String(part.tool || "").trim();
  if (!name) return "";
  const key = toolNameKey(name);
  // Todo tools own a dedicated UI row; surfacing them here would steal
  // attention from the actual work that happened around the plan.
  if (TODO_TOOLS.has(key)) return "";
  if (PREVIEW_SUPPRESS_TOOLS.has(key)) return "";
  const state = part.state || {};
  const icon = displayToolIcon(name);
  const detail = displayToolDetail(name, state.input, state, "");
  const head = icon ? `${icon} ${name}` : name;
  return detail ? `${head}: ${detail}` : head;
}

// Goal step cards (kind="step") want a different preview policy: the
// operator scanning a goal needs the goal context (objective / latest
// reasoning), not "Bash: rg --files". Tool calls are visible inside the
// expanded card body — the collapsed line should answer "what is this
// goal trying to do" rather than "what command is currently running".
function gatherLatest(node: CardNode, hits: LatestHit[], suppressTools: boolean): void {
  if (!node) return;
  const baseTime = typeof node.time === "number" ? node.time : 0;
  if (!suppressTools && node.kind === "tool" && node.toolPart) {
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
    if (suppressTools) continue;
    const toolText = toolHitText(part);
    if (toolText) hits.push({ time: baseTime, index: i, text: toolText });
  }
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid];
    if (child) gatherLatest(child as unknown as CardNode, hits, suppressTools);
  }
  for (const child of node.children || []) {
    gatherLatest(child, hits, suppressTools);
  }
}

export function collectLatestActivityText(node: CardNode): string {
  if (!node) return "";
  const suppressTools = node.kind === "step";
  const hits: LatestHit[] = [];
  gatherLatest(node, hits, suppressTools);
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
  return extractTodos(part.state || {});
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
