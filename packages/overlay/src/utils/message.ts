// ── Message utilities ──
// agentStageRole, phaseFromAgent, phaseFromMessage, detectSource

import { t } from "./i18n";

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

// ── HTML escaping ──

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  if (role === "scheduler") return t("chat.role.scheduler");
  if (role === "delivery") return t("chat.role.delivery");
  if (role === "spec") return t("chat.role.spec");
  if (role === "system") return t("chat.role.system");
  if (role === "goal_gate") return t("chat.role.goal");
  if (role === "executor") return t("chat.role.executor");
  return t("chat.role.message");
}

// ── Agent stage helpers ──

export function agentStageRole(stage: string): string {
  const text = String(stage || "").trim().toLowerCase();
  if (text === "planner" || text === "plan") return "planner";
  if (text === "spec") return "spec";
  if (text === "judge" || text === "evaluation" || text === "scheduler") return "scheduler";
  if (text === "delivery" || text === "files") return "delivery";
  if (text === "executor" || text === "execute" || text === "coding") return "assistant";
  return "system";
}

export function phaseFromAgent(value: any): string {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.includes("goal_gate") || text.includes("goal")) return "goals";
  if (
    text.includes("scheduler") ||
    text.includes("evaluator") ||
    text.includes("evaluation") ||
    text.includes("evaluate") ||
    text.includes("review")
  )
    return "evaluation";
  if (
    text.includes("planner") ||
    text.includes("planning") ||
    text.includes("replan") ||
    text === "plan"
  )
    return "plan";
  if (text.includes("spec")) return "spec";
  if (text.includes("deliver") || text.includes("delivery") || text.includes("publish"))
    return "files";
  return "";
}

export function phaseFromMessage(message: any): string {
  if (!message || typeof message !== "object") return "";
  const info =
    message.info && typeof message.info === "object" ? message.info : {};
  const direct = phaseFromAgent(info.agent) || phaseFromAgent(info.role);
  if (direct) return direct;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part || typeof part !== "object") continue;
    if (part.type === "subtask") {
      const mapped =
        phaseFromAgent(part.agent) ||
        phaseFromAgent(part.description) ||
        phaseFromAgent(part.prompt);
      if (mapped) return mapped;
      continue;
    }
    if (part.type === "agent") {
      const mapped = phaseFromAgent(part.name);
      if (mapped) return mapped;
      continue;
    }
    if (part.type !== "tool") continue;
    const state =
      part.state && typeof part.state === "object" ? part.state : {};
    const input =
      state.input && typeof state.input === "object" ? state.input : {};
    const mapped =
      phaseFromAgent(input.agent) ||
      phaseFromAgent(input.name) ||
      phaseFromAgent(input.description) ||
      phaseFromAgent(state.title) ||
      phaseFromAgent(part.tool);
    if (mapped) return mapped;
  }
  return "";
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
  if (stage === "spec") return t("chat.role.spec");
  if (stage === "planner") return t("chat.role.planner");
  if (stage === "goal") return t("chat.role.goal");
  if (stage === "judge" || stage === "scheduler") return t("chat.role.scheduler");
  if (stage === "delivery") return t("chat.role.delivery");
  return t("chat.role.message");
}

// ── Effective role ──
// rootSessionID: pass boardStore.board?.task?.sessionID (or "" if unknown)

export function effectiveRole(msg: any, rootSessionID: string, goalSessionIDs?: Set<string>): string {
  const role = msg.info?.role || "assistant";
  if (role !== "user") {
    // Detect assistant messages from executor goal sessions.
    // If goalSessionIDs is provided, use it as the authoritative set of
    // executor sessions — this avoids hardcoding agent names.
    // Fallback: any child-session assistant message whose sessionID is NOT
    // the root is treated as executor when no goal sessions map is available.
    if (role === "assistant" && rootSessionID && !msg._synthetic) {
      const sessionID =
        typeof msg.info?.sessionID === "string" ? msg.info.sessionID : "";
      if (sessionID && sessionID !== rootSessionID) {
        // Check explicit goal session mapping first
        if (goalSessionIDs && goalSessionIDs.size > 0 && goalSessionIDs.has(sessionID)) {
          return "executor";
        }
        // Resolve from agent name — covers both pipeline stages and executor
        const agent = String(msg.info?.agent || "").trim().toLowerCase();
        if (!agent) return "executor";
        const stageRole = agentStageRole(agent);
        // agentStageRole maps executor/build/coding → "assistant", remap to "executor"
        return stageRole === "assistant" ? "executor" : stageRole;
      }
    }
    return role;
  }
  const source = detectSource(msg);
  if (source) return source;
  const sessionID =
    typeof msg.info?.sessionID === "string" ? msg.info.sessionID : "";
  if (rootSessionID && sessionID && sessionID !== rootSessionID) {
    return agentStageRole(phaseFromMessage(msg) || msg.info?.agent || "system");
  }
  // Synthetic user messages from the board context (not typed by the real user)
  // are operator actions — avoid impersonating the user role.
  if (msg._synthetic && msg.info?.agent) {
    return agentStageRole(msg.info.agent);
  }
  return role;
}
