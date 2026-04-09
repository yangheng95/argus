import { createStore, reconcile } from "solid-js/store";

// Each explicit override stores the value AND the running-state when it was set.
// An override is only honoured when the card is still in the same running-state;
// it is silently discarded on the next running-state transition, allowing
// auto-expand / auto-collapse to take over again.
type ExplicitEntry = { value: boolean; running: boolean };

const [store, setStore] = createStore({
  expandedAgentCards: {} as Record<string, ExplicitEntry>,
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
  // Only honour the explicit override if it was set while the card was in the
  // same running-state.  When the state changes the override is stale and the
  // default protocol (running → open, done → closed) resumes automatically.
  if (explicit !== undefined && explicit.running === (running === true)) {
    return explicit.value;
  }
  return true;
}

export function toggleAgentCardExpanded(cardID: string, running: boolean): void {
  if (!cardID) return;
  const next = !agentCardExpanded(cardID, running);
  setStore("expandedAgentCards", cardID, { value: next, running });
}

export function toolOutputExpanded(partID: string): boolean {
  if (!partID) return false;
  return store.expandedToolOutputs[partID] === true;
}

export function toggleToolOutputExpanded(partID: string): void {
  if (!partID) return;
  setStore("expandedToolOutputs", partID, (value) => value !== true);
}
