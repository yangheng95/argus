// ── Card Tree Store ──
//
// Single reactive source of truth for the overlay's conversation view.
//
// Shape: flat `cards` dict keyed by stable id + an ordered list of top-level
// ids. Children are referenced by id (`childIDs: string[]`), NOT inlined,
// so adding/removing a child writes only to the parent's `childIDs` array.
// Part lists work the same way — `CardNode.parts` is the canonical array,
// targeted writes update `cardTreeStore.cards[id].parts[idx].<field>`.
//
// ID conventions (deterministic, construction-time):
//   ctx:user-request                                       — task request bubble
//   ctx:user-request:text                                  — the text part of that bubble
//   ctx:user-request:file:<url|idx>                        — an attachment part
//   <stage>:session:<sid>                                  — per-session agent card
//   part:<messageID>:<partID>                              — part inside a session card
//   step:<goalID>:<stepID>                                 — per-goal executor step (top-level)
//   step:<goalID>:<stepID>:phase:<phaseID>                 — phase row inside an executor step
//   interaction:<interactionID>                            — synthetic interaction card
//
// Note: the legacy `goal-group:*` container layer was removed in the
// 2026-04-19 flatten. Each goal now surfaces its single goal-scope step
// directly at the top level, with goal title / decomposition index
// (`#orderIndex+1`) / description stamped onto the step card.
//
// The writer (services/tree-writer.ts) is the only module that mutates
// this store. Components read only. No memos, no derivations — components
// walk `cardTreeStore.cards[id]` through the Solid proxy, and Solid's
// fine-grained reactivity handles the rest.

import { createStore } from "solid-js/store";

export type CardKind =
  | "agent"     // per-session agent card (orchestrator, build worker, planner, ...)
  | "step"      // per-goal executor step card — top-level, carries goal metadata
  | "phase"     // phase row inside a step (plan / build / evaluate inside pipeline.build)
  | "tool"      // promoted tool call (nested card for task/subagent)
  | "message"   // user / system synthetic bubble
  | "fidelity"; // requirements fidelity review verdict

export type CardStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "skipped";

/** Synthetic "part" used by the renderer to emit a role separator between
 *  flattened messages. Carries the effective role and optional timestamp. */
export interface BoundaryPart {
  type: "boundary";
  role: string;
  roleLabel: string;
  time?: number;
}

/** Structured step payload — only populated for kind="step" nodes. Mirrors
 *  `workbench/board.ts GoalStepPayload` since step rows show the same detail
 *  the sidebar Goals panel shows. */
export interface StepPayload {
  planNodes?: Array<{ id: string; title: string; brief: string; orderIndex: number }>;
  buildSessionID?: string;
  workspaceDir?: string;
  changedFiles?: string[];
  diffStats?: { files?: number; additions?: number; deletions?: number };
  checks?: Array<{ name: string; status: string; evidence?: string; family?: string }>;
  evalSummary?: string;
  verdict?: string;
}

/** CardNode is the fundamental unit of the conversation tree. `children` is
 *  ALWAYS an array of ids (not inline objects); the renderer dereferences
 *  through `cardTreeStore.cards[id]`. This indirection is what makes targeted
 *  writes cheap — moving a card between parents is two `setCardTreeStore`
 *  calls (remove from old, add to new) rather than a full tree rebuild. */
export interface CardNode {
  id: string;
  kind: CardKind;
  /** Session kind / stage name (assistant / executor / build / planner / goal / ...). */
  stage?: string;
  /** Resolved accent colour for this card's stage. */
  accent?: string;
  status?: CardStatus;
  role?: string;
  title: string;
  subtitle?: string;
  /** Goal decomposition index + 1; shown as `#N` when > 0. Stamped onto the
   *  executor step card from the backend `goalWorkflow.orderIndex` so the
   *  number matches the numbered breakdown operators see during requirements
   *  planning (and does NOT re-number when a goal is removed). */
  round?: number;
  /** Goal this card belongs to. Set on executor step cards, goal-phase cards,
   *  and any session card that was routed to a goal phase. */
  goalID?: string;
  /** Goal objective prose — rendered at the top of the step card body. Set
   *  only on executor step cards (kind="step"). */
  goalDescription?: string;
  stepPayload?: StepPayload;
  stepID?: string;
  /** Phase identifier for kind="phase" nodes. Matches the phase.id declared
   *  on the backend workflow step (see
   *  packages/opencorvus/src/engine/workflow.ts PIPELINE.build.phases). */
  phaseID?: string;
  /** Session kind this phase claims — the stage value used by
   *  resolveSessionContainerCardID to route incoming session cards. Only
   *  set for kind="phase" nodes. */
  phaseSessionKind?: string;
  /** Inline leaves — text / reasoning / tool / patch / file / subtask / boundary /
   *  interaction-question / interaction-permission. Tool parts that are "promoted"
   *  become their own CardNode instead (with `toolPart` populated). */
  parts: any[];
  /** Child card ids (resolved by the renderer via `cardTreeStore.cards[id]`).
   *  Used by cards that live in `cardTreeStore` — the renderer dereferences
   *  each id through the store proxy, preserving fine-grained reactivity.
   *
   *  Optional: transient cards (tool promotion, legacy old-pipeline nodes)
   *  use the inline `children` field below instead. Store-backed cards
   *  always populate this field (writer guarantees `[]` default). */
  childIDs?: string[];
  /** Inline CardNode children — used only by TRANSIENT cards built on the fly
   *  by the renderer (e.g. `<CardParts>` promotes a tool `part` into its own
   *  card via `toolToCardNode`). Transient cards do not live in the store;
   *  their identity dies with the mount, so they can safely carry inline
   *  object references. Cards in `cardTreeStore` never set this field.
   *
   *  The renderer prefers `childIDs` when present — if a card has both,
   *  the store-backed children win. */
  children?: CardNode[];
  /** Chronological sort key in ms; `undefined` = append at end. */
  time?: number;
  defaultExpanded?: boolean;
  /** Raw tool part for kind="tool" nodes — rendered by <Card> via
   *  InlineToolPart mode="body". Always undefined for non-tool kinds. */
  toolPart?: any;
  contextTokens?: number;
  contextTokensEstimated?: boolean;
  /** Structured fidelity review payload — only populated for kind="fidelity"
   *  nodes. Mirrors `FidelityReviewCompleted` event shape (see
   *  opencorvus/engine/model.ts). Rendered natively by <FidelityCard>; the
   *  raw JSON that the fidelity LLM produces never reaches the UI. */
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

export interface CardTreeStore {
  /** Top-level card ids in display order. */
  order: string[];
  /** Every card by id, flat. Includes cards referenced from any `childIDs`. */
  cards: Record<string, CardNode>;
}

export const [cardTreeStore, setCardTreeStore] = createStore<CardTreeStore>({
  order: [],
  cards: {},
});
