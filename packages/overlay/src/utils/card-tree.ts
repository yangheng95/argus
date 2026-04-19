// ── Card Tree — CardNode type + render-side helpers ──
//
// The canonical source of truth for the card tree is `store/card-tree.ts`
// (`cardTreeStore`). This file holds:
//
//  1. `CardNode` — structurally compatible with the store's CardNode so that
//     transient card instances (tool promotion in CardParts) and store-backed
//     cards render through the same component path.
//  2. `shouldPromoteTool` — pure tool-promotion policy consumed by CardParts.
//  3. `defaultExpandedForNode` / `collectCardText` — render-side helpers
//     used by Card / CardHeader.
import { cardTreeStore } from "../store/card-tree";
import type { StepPayload } from "../store/card-tree";
import { toolNameKey } from "./tool";

export type { StepPayload } from "../store/card-tree";

export type CardKind = "agent" | "step" | "phase" | "tool" | "message" | "fidelity";
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
  /** Goal this card belongs to — stamped on the executor step card and any
   *  goal-phase / session card routed into it. */
  goalID?: string;
  /** Goal description (markdown) — only set on executor step cards. */
  goalDescription?: string;
  contracts?: Array<{ key: string; value: string; reason?: string }>;
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
  /** Structured fidelity review payload — only populated for kind="fidelity"
   *  nodes (produced by tree-writer on fidelity.review.completed). Mirrors
   *  the shape defined in `store/card-tree.ts` so a store CardNode is
   *  assignable to this utils CardNode without casting. */
  fidelity?: {
    verdict: "faithful" | "needs_correction";
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

// ── Tool promotion rules ──
// Whether a tool part should be elevated to its own <Card> rather than
// rendered inline. Called by downstream renderers in S2; exported pure
// so it can be unit-tested independently.

const ALWAYS_PROMOTE_TOOLS = new Set([
  "task", "agent", "spawnagent", "subagent",
  // Todo tools render a structured checklist; inline chips would hide the list.
  "todowrite", "todoread", "todoupdate", "updateplan",
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
  // Fidelity verdicts: always expand. The entire point of the card is to
  // surface the structured verdict; a collapsed badge would be weaker than
  // the previous raw-JSON render it replaces.
  if (node.kind === "fidelity") return true;
  // Executor step cards carry goal description + phase children — the
  // operator almost always wants those visible when the goal is alive.
  // A completed executor collapses to save space.
  if (node.kind === "step") return node.status !== "completed";
  // tool defaults: collapsed when completed, open when running.
  return node.status !== "completed";
}

// ── Text collection (for copy-to-clipboard) ──
// Walks a card node and its descendants, emitting the human-readable prose
// parts: text / reasoning, plus goal description and contracts on executor
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
  if (node.kind === "step" && node.contracts?.length) {
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
