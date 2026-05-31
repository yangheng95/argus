// ── Message utilities ──
// Canonical agent role classification and message display helpers.

import { t } from "./i18n";

// ── Agent Role ──

/** Canonical set of UI display roles. Single source of truth for all agent identity. */
export type AgentRole =
  | "user"
  | "assistant"
  | "orchestrator"
  | "mission"
  | "intent-analysis"
  | "spec"
  | "requirements"
  | "frontend-design"
  | "architect"
  | "planner"
  | "goal"
  | "executor"
  | "evaluator"
  | "build"
  | "explore"
  | "integrity"
  | "fact-check"
  | "delivery"
  | "system";

/** Stages that get their own collapsible agent card in the conversation view. */
export const AGENT_CARD_STAGES = new Set<AgentRole>([
  "assistant",
  "orchestrator",
  "mission",
  "intent-analysis",
  "spec",
  "requirements",
  "frontend-design",
  "architect",
  "planner",
  "goal",
  "executor",
  "evaluator",
  "build",
  "explore",
  "integrity",
  "fact-check",
  "delivery",
  "system",
]);

/**
 * Map any backend agent name to a canonical AgentRole.
 * This is the ONLY place where agent name → role mapping happens.
 */
export function normalizeAgentRole(name: string): AgentRole {
  const text = String(name || "").trim().toLowerCase();
  if (!text) return "assistant";
  if (text === "user") return "user";
  if (text === "orchestrator") return "orchestrator";
  if (text === "mission") return "mission";
  if (text === "intent-analysis" || text === "intent_analysis" || text === "analyze-intent" || text === "analyze_intent" || text === "intent") return "intent-analysis";
  if (text === "spec") return "spec";
  if (text === "requirements") return "requirements";
  if (text === "frontend-design" || text === "frontend_design" || text === "frontend-design" || text === "frontend_design") return "frontend-design";
  if (text === "architect" || text === "architecture" || text === "coordination") return "architect";
  if (text === "planner" || text === "plan" || text === "planning" || text === "replan") return "planner";
  if (text === "goal" || text === "goal_gate") return "goal";
  // "coding" is the post-rename name of the build worker (commit 2bda4d8a22
  // build→coding). It must share the build lane/icon, not collapse into the
  // generic executor bucket — otherwise the code-writing agent is not split.
  if (text === "build" || text === "coding") return "build";
  // Read-only repository-investigation subagent. Its own lane/icon so explore
  // dispatches are split out of the executor bucket (matches SessionKind
  // "explore" on the backend).
  if (text === "explore" || text === "explorer") return "explore";
  if (text === "executor" ||
      text === "general" || text === "execute" ||
      text === "opencorvus" || text === "codex" || text === "claude-code") return "executor";
  if (text === "judge" || text === "evaluator" || text === "evaluation" || text === "eval" ||
      text === "scheduler" || text === "review" || text === "evaluate") return "evaluator";
  if (text === "delivery" || text === "deliver" || text === "publish" || text === "refine") return "delivery";
  if (text === "files") return "assistant";
  if (text === "integrity") return "integrity";
  if (text === "fact-check" || text === "fact_check" || text === "factcheck") return "fact-check";
  if (text === "system" || text === "compaction" || text === "title" || text === "summary") return "system";
  return "assistant";
}

/**
 * Map an AgentRole to the inspector panel section phase name.
 * Returns "" for roles without a corresponding section.
 */
export function agentRoleToSectionPhase(role: AgentRole): string {
  if (role === "spec") return "spec";
  if (role === "requirements") return "requirements";
  if (role === "intent-analysis") return "intent";
  if (role === "frontend-design") return "design";
  if (role === "architect") return "architect";
  if (role === "planner") return "plan";
  if (role === "goal") return "goals";
  if (role === "executor") return "executor";
  if (role === "evaluator") return "evaluation";
  if (role === "delivery") return "delivery";
  return "";
}

// ── Pending placeholder detection ──

/**
 * Returns true if the given message part is a transient "thinking" placeholder
 * inserted while the assistant response is still streaming.
 */
export function isPendingPlaceholderPart(part: any): boolean {
  return (
    part?.type === "text" &&
    !part.id &&
    ["……", "...", t("chat.thinking")].includes(part.text)
  );
}

// ── Part ordering ──

export function orderedMessageParts(message: any): any[] {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  if (parts.length < 2) return parts;
  const reasoning: any[] = [];
  const rest: any[] = [];
  for (const part of parts) {
    if (part?.type === "reasoning") reasoning.push(part);
    else rest.push(part);
  }
  return [...reasoning, ...rest];
}

// ── Role labels ──

export function roleLabel(role: string): string {
  if (role === "user") return t("chat.role.user");
  if (role === "assistant") return t("chat.role.assistant");
  if (role === "orchestrator") return t("chat.role.orchestrator");
  if (role === "mission") return t("chat.role.mission");
  if (role === "intent-analysis") return t("chat.role.intent-analysis");
  if (role === "requirements") return t("chat.role.requirements");
  if (role === "frontend-design" || role === "frontend_design") return t("chat.role.frontend-design");
  if (role === "architect") return t("chat.role.architect");
  if (role === "planner") return t("chat.role.planner");
  if (role === "evaluator") return t("chat.role.evaluator");
  if (role === "spec") return t("chat.role.spec");
  if (role === "system") return t("chat.role.system");
  if (role === "goal" || role === "goal_gate") return t("chat.role.goal");
  if (role === "executor") return t("chat.role.executor");
  if (role === "build") return t("chat.role.build");
  if (role === "explore") return t("chat.role.explore");
  if (role === "delivery") return t("chat.role.delivery");
  if (role === "integrity") return t("chat.role.integrity");
  if (role === "fact-check") return t("chat.role.fact-check");
  return t("chat.role.assistant");
}

// ── Message classification ──

/**
 * Classify which channel a message belongs to.
 * Single classification function — replaces classifyAgentStage and classifyMessage.
 *
 * Returns:
 * - An AgentRole string (e.g. "spec", "planner") → message belongs to that agent card
 * - "main" → message belongs to the main conversation
 */
export function classifyMessage(msg: any, rootSessionID: string): string {
  // Prefer backend-resolved channel (set by task-message-protocol-bridge).
  // This is authoritative — it knows the session tree and agent identity.
  const backendChannel = String(msg?.info?.channel || "").trim().toLowerCase();
  if (backendChannel && backendChannel !== "main") {
    // "filtered" means the backend intentionally hid this message
    if (backendChannel === "filtered") return "filtered";
    const normalizedChannel = normalizeAgentRole(backendChannel);
    if (AGENT_CARD_STAGES.has(normalizedChannel)) return normalizedChannel;
  }

  // User-role messages without a backend channel go to main conversation
  if (String(msg?.info?.role || "").trim().toLowerCase() === "user") return "main";

  // Use resolvedRole directly — backend is authoritative
  const resolved = String(msg?.info?.resolvedRole || "").trim().toLowerCase();
  if (AGENT_CARD_STAGES.has(resolved as AgentRole)) return resolved;

  // The store may receive direct message objects before overlay stamping
  // (tests or partial reloads). The agent field is still
  // first-party message metadata, so classify it canonically here.
  const agent = String(msg?.info?.agent || "").trim().toLowerCase();
  const normalized = normalizeAgentRole(agent);
  if (AGENT_CARD_STAGES.has(normalized)) return normalized;

  return "main";
}

// ── Agent stage label ──

/** Get the display label for an agent stage used in card headers. */
export function agentStageLabel(stage: string): string {
  const role = normalizeAgentRole(stage);
  if (role === "spec") return t("chat.role.spec");
  if (role === "mission") return t("chat.role.mission");
  if (role === "intent-analysis") return t("chat.role.intent-analysis");
  if (role === "requirements") return t("chat.role.requirements");
  if (role === "frontend-design") return t("chat.role.frontend-design");
  if (role === "architect") return t("chat.role.architect");
  if (role === "planner") return t("chat.role.planner");
  if (role === "goal") return t("chat.role.goal");
  if (role === "evaluator") return t("chat.role.evaluator");
  if (role === "executor") return t("chat.role.executor");
  if (role === "build") return t("chat.role.build");
  if (role === "explore") return t("chat.role.explore");
  if (role === "delivery") return t("chat.role.delivery");
  if (role === "integrity") return t("chat.role.integrity");
  if (role === "fact-check") return t("chat.role.fact-check");
  return t("chat.role.assistant");
}

// ── Effective role ──

/**
 * Determine the display role for a message.
 * Priority: resolvedRole > agent (normalized) > role > "assistant".
 * This ensures executor messages always display as "executor" even if
 * the backend only stamped agent="executor" without resolvedRole.
 */
export function effectiveRole(msg: any, _rootSessionID?: string): string {
  const resolved = msg.info?.resolvedRole;
  if (resolved) return resolved;
  const agent = String(msg.info?.agent || "").trim().toLowerCase();
  if (agent) {
    const normalized = normalizeAgentRole(agent);
    if (AGENT_CARD_STAGES.has(normalized)) return normalized;
  }
  // No assistant-fallback (一个萝卜一个坑). If we got here, the message has
  // no resolvedRole AND no recognised agent AND no role — that's a server
  // bridge bug; throw so it surfaces immediately.
  const fallback = msg.info?.role;
  if (typeof fallback !== "string" || fallback.length === 0) {
    throw new Error(`effectiveRole: message ${msg.info?.id ?? "<unknown>"} has no resolvedRole/agent/role; bridge must enrich`);
  }
  return fallback;
}
