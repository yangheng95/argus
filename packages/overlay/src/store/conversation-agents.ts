import { createStore } from "solid-js/store";
import type { AgentWorkflowRecord } from "../utils/agent-workflow";
import { normalizeAgentRole } from "../utils/message";

export interface ConversationAgentSessionView {
  sessionID: string;
  stage: string;
  parentSessionID?: string;
  goalID?: string;
  firstMessageTime: number;
  lastMessageTime: number;
  placement?: string;
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

function agentRecordFromSession(session: ConversationAgentSessionView): AgentWorkflowRecord | null {
  const sessionID = String(session?.sessionID || "");
  const rawStage = String(session?.stage || "");
  const stage = normalizeAgentRole(rawStage);
  const startedAt = Number(session?.firstMessageTime || 0);
  if (!sessionID || !stage || stage === "user" || rawStage === "filtered" || !(startedAt > 0)) return null;
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
    goalID: session?.goalID,
    stepID: session?.phase?.stepID,
    phaseID: session?.phase?.phaseID,
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
