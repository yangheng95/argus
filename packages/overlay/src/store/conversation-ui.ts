import { createStore, reconcile } from "solid-js/store";

const [store, setStore] = createStore({
  expandedAgentCards: {} as Record<string, boolean>,
  expandedToolOutputs: {} as Record<string, boolean>,
});

export { store as conversationUiStore };

export function clearConversationUiState(): void {
  setStore("expandedAgentCards", reconcile({}, { merge: false }));
  setStore("expandedToolOutputs", reconcile({}, { merge: false }));
}

export function agentCardExpanded(cardID: string, running?: boolean): boolean {
  if (!cardID) return false;
  const explicit = store.expandedAgentCards[cardID];
  if (typeof explicit === "boolean") return explicit;
  // Default: expanded while running, collapsed when done
  return running === true;
}

export function toggleAgentCardExpanded(cardID: string, running: boolean): void {
  if (!cardID) return;
  const next = !agentCardExpanded(cardID, running);
  setStore("expandedAgentCards", cardID, next);
}

export function toolOutputExpanded(partID: string): boolean {
  if (!partID) return false;
  return store.expandedToolOutputs[partID] === true;
}

export function toggleToolOutputExpanded(partID: string): void {
  if (!partID) return;
  setStore("expandedToolOutputs", partID, (value) => value !== true);
}
