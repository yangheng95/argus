// ── Message utilities ──
// Canonical agent role classification and message display helpers.

import { t } from "./i18n";

// ── Agent Role ──

/** Canonical set of UI display roles. Single source of truth for all agent identity. */
export type AgentRole =
  | "user"
  | "assistant"
  | "spec"
  | "planner"
  | "goal"
  | "executor"
  | "evaluator"
  | "delivery"
  | "system";

/** Stages that get their own collapsible AgentCard in the conversation view. */
export const AGENT_CARD_STAGES = new Set<AgentRole>(["spec", "planner", "goal", "executor", "evaluator", "delivery"]);

/**
 * Map any backend agent name to a canonical AgentRole.
 * This is the ONLY place where agent name → role mapping happens.
 */
export function normalizeAgentRole(name: string): AgentRole {
  const text = String(name || "").trim().toLowerCase();
  if (!text) return "assistant";
  if (text === "user") return "user";
  if (text === "spec") return "spec";
  if (text === "planner" || text === "plan" || text === "planning" || text === "replan") return "planner";
  if (text === "goal" || text === "goal_gate") return "goal";
  if (text === "executor" || text === "build" || text === "coding" ||
      text === "general" || text === "explore" || text === "execute") return "executor";
  if (text === "judge" || text === "evaluator" || text === "evaluation" ||
      text === "scheduler" || text === "review" || text === "evaluate") return "evaluator";
  if (text === "delivery" || text === "deliver" || text === "files" || text === "publish") return "delivery";
  if (text === "system" || text === "compaction" || text === "title" || text === "summary") return "system";
  return "assistant";
}

/**
 * Map an AgentRole to the inspector panel section phase name.
 * Returns "" for roles without a corresponding section.
 */
export function agentRoleToSectionPhase(role: AgentRole): string {
  if (role === "spec") return "spec";
  if (role === "planner") return "plan";
  if (role === "goal") return "goals";
  if (role === "evaluator") return "evaluation";
  if (role === "delivery") return "files";
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
  if (role === "planner") return t("chat.role.planner");
  if (role === "evaluator") return t("chat.role.evaluator");
  if (role === "delivery") return t("chat.role.delivery");
  if (role === "spec") return t("chat.role.spec");
  if (role === "system") return t("chat.role.system");
  if (role === "goal" || role === "goal_gate") return t("chat.role.goal");
  if (role === "executor") return t("chat.role.executor");
  return t("chat.role.message");
}

// ── Message classification ──

/**
 * Classify which channel a message belongs to.
 * Single classification function — replaces classifyAgentStage and classifyMessage.
 *
 * Returns:
 * - An AgentRole string (e.g. "spec", "planner") → message belongs to that AgentCard
 * - "main" → message belongs to the main conversation
 * - "filtered" → message should be hidden (child session non-card agent, handled by executor events)
 */
export function classifyMessage(msg: any, rootSessionID: string): string {
  // User-role messages always go to main conversation
  if (String(msg?.info?.role || "").trim().toLowerCase() === "user") return "main";
  const agent = String(msg?.info?.agent || "").trim().toLowerCase();
  const role = normalizeAgentRole(agent);
  // Card-stage agents get their own AgentCards
  if (AGENT_CARD_STAGES.has(role)) return role;
  // Child session messages from unknown agents → treat as executor
  const sessionID = typeof msg?.info?.sessionID === "string" ? msg.info.sessionID : "";
  if (rootSessionID && sessionID && sessionID !== rootSessionID) return "executor";
  return "main";
}

// ── Source detection (used by effectiveRole) ──

function detectSource(msg: any): string | undefined {
  const parts = msg.parts || [];
  for (const part of parts) {
    if (part.type !== "text") continue;
    if (part.audience && part.audience.ui === false) continue;
    if (part.kind === "trace" && !part.audience?.ui) continue;
    if (part.source) return part.source;
  }
  return undefined;
}

// ── Agent stage label ──

/** Get the display label for an agent stage used in card headers. */
export function agentStageLabel(stage: string): string {
  const role = normalizeAgentRole(stage);
  if (role === "spec") return t("chat.role.spec");
  if (role === "planner") return t("chat.role.planner");
  if (role === "goal") return t("chat.role.goal");
  if (role === "evaluator") return t("chat.role.evaluator");
  if (role === "delivery") return t("chat.role.delivery");
  if (role === "executor") return t("chat.role.executor");
  return t("chat.role.message");
}

// ── Effective role ──

export function effectiveRole(msg: any, rootSessionID: string, goalSessionIDs?: Set<string>): string {
  const role = msg.info?.role || "assistant";

  if (role !== "user") {
    // Assistant messages from child sessions
    if (role === "assistant" && rootSessionID && !msg._synthetic) {
      const sessionID = typeof msg.info?.sessionID === "string" ? msg.info.sessionID : "";
      if (sessionID && sessionID !== rootSessionID) {
        if (goalSessionIDs && goalSessionIDs.size > 0 && goalSessionIDs.has(sessionID)) {
          return "executor";
        }
        const agent = String(msg.info?.agent || "").trim().toLowerCase();
        if (!agent) return "executor";
        const normalized = normalizeAgentRole(agent);
        return normalized === "assistant" ? "executor" : normalized;
      }
    }
    return role;
  }

  // User messages: check source annotation
  const source = detectSource(msg);
  if (source) return source;

  // Child session user messages
  const sessionID = typeof msg.info?.sessionID === "string" ? msg.info.sessionID : "";
  if (rootSessionID && sessionID && sessionID !== rootSessionID) {
    return normalizeAgentRole(msg.info?.agent || "system");
  }

  // Synthetic user messages from board context
  if (msg._synthetic && msg.info?.agent) {
    return normalizeAgentRole(msg.info.agent);
  }

  return role;
}
