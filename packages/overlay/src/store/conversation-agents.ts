import { createStore } from "solid-js/store";
import type { AgentWorkflowRecord } from "../utils/agent-workflow";
import { normalizeAgentRole } from "../utils/message";

export interface ConversationAgentSessionView {
  sessionID: string;
  stage: string;
  parentSessionID?: string;
  goalID?: string;
  messageIDs?: string[];
  lastDisplayMessageID?: string;
  firstMessageTime: number;
  lastMessageTime: number;
  placement?: "top_level" | "goal_phase" | "hidden" | "filtered" | string;
  phase?: {
    stepID: string;
    phaseID: string;
  };
}

export interface ConversationAgentView {
  sessions?: ConversationAgentSessionView[];
}

export interface ConversationAgentStore {
  taskID: string;
  records: AgentWorkflowRecord[];
}

export const [conversationAgentStore, setConversationAgentStore] = createStore<ConversationAgentStore>({
  taskID: "",
  records: [],
});

function fallbackLastMessageID(session: ConversationAgentSessionView): string {
  if (!Array.isArray(session?.messageIDs)) return "";
  return String(session.messageIDs[session.messageIDs.length - 1] || "");
}

function targetMessageID(session: ConversationAgentSessionView): string {
  return String(session?.lastDisplayMessageID || "") || fallbackLastMessageID(session);
}

function renderedTargetForSession(
  session: ConversationAgentSessionView,
  stage: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID"> {
  const goalID = String(session?.goalID || "");
  const stepID = String(session?.phase?.stepID || "");
  const phaseID = String(session?.phase?.phaseID || "");
  if (goalID && stepID && phaseID) {
    const renderedCardID = `step:${goalID}:${stepID}`;
    return {
      cardID: `${renderedCardID}:phase:${phaseID}`,
      renderedCardID,
    };
  }
  const messageID = targetMessageID(session);
  if (stage === "integrity") {
    return { renderedCardID: `integrity:session:${session.sessionID}` };
  }
  return messageID
    ? { renderedCardID: `${stage}:session:${session.sessionID}:message:${messageID}` }
    : {};
}

function agentRecordFromSession(session: ConversationAgentSessionView): AgentWorkflowRecord | null {
  const sessionID = String(session?.sessionID || "");
  const rawStage = String(session?.stage || "");
  const stage = normalizeAgentRole(rawStage);
  const startedAt = Number(session?.firstMessageTime || 0);
  if (
    !sessionID ||
    !stage ||
    stage === "user" ||
    session?.placement === "hidden" ||
    session?.placement === "filtered" ||
    rawStage === "filtered" ||
    !(startedAt > 0)
  ) {
    return null;
  }
  const lastObservedAt = Math.max(startedAt, Number(session?.lastMessageTime || 0));
  return {
    id: sessionID,
    sessionID,
    parentSessionID: String(session?.parentSessionID || ""),
    agentName: stage,
    stage,
    status: "completed",
    startedAt,
    lastObservedAt,
    completedAt: lastObservedAt,
    attempts: 1,
    depth: 0,
    targetMessageID: targetMessageID(session),
    goalID: session?.goalID,
    stepID: session?.phase?.stepID,
    phaseID: session?.phase?.phaseID,
    ...renderedTargetForSession(session, stage),
  };
}

function applyDepth(records: AgentWorkflowRecord[]): AgentWorkflowRecord[] {
  const byID = new Map(records.map((record) => [record.sessionID, record]));
  const visiting = new Set<string>();
  const memo = new Map<string, number>();
  const depthOf = (sessionID: string): number => {
    if (memo.has(sessionID)) return memo.get(sessionID)!;
    if (visiting.has(sessionID)) return 0;
    visiting.add(sessionID);
    const parent = byID.get(sessionID)?.parentSessionID || "";
    const depth = parent && byID.has(parent) ? depthOf(parent) + 1 : 0;
    visiting.delete(sessionID);
    memo.set(sessionID, depth);
    return depth;
  };
  return records.map((record) => ({ ...record, depth: depthOf(record.sessionID) }));
}

export function resetConversationAgentView(): void {
  setConversationAgentStore({ taskID: "", records: [] });
}

export function hydrateConversationAgentView(taskID: string, view: ConversationAgentView): void {
  const records = (Array.isArray(view?.sessions) ? view.sessions : [])
    .map(agentRecordFromSession)
    .filter((record): record is AgentWorkflowRecord => !!record)
    .sort((left, right) => left.startedAt - right.startedAt);
  setConversationAgentStore({
    taskID,
    records: applyDepth(records),
  });
}
