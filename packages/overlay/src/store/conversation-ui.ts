import { createStore, reconcile } from "solid-js/store";

// Each explicit override stores the value AND the running-state when it was set.
// An override is only honoured when the card is still in the same running-state;
// it is silently discarded on the next running-state transition, allowing
// auto-expand / auto-collapse to take over again.
type ExplicitEntry = { value: boolean; running: boolean };

// New unified card-fold state. The `statusAtSet` field records the card's
// `status` string at the moment the user toggled — any subsequent status
// transition discards the override (same stale-override protocol as the old
// agent-card store, generalised across kinds).
type CardEntry = { value: boolean; statusAtSet: string };

const [store, setStore] = createStore({
  expandedAgentCards: {} as Record<string, ExplicitEntry>,
  expandedToolOutputs: {} as Record<string, boolean>,
  expandedCards: {} as Record<string, CardEntry>,
});

export { store as conversationUiStore };

export function clearConversationUiState(): void {
  setStore("expandedAgentCards", reconcile({}, { merge: false }));
  setStore("expandedToolOutputs", reconcile({}, { merge: false }));
  setStore("expandedCards", reconcile({}, { merge: false }));
}

export function agentCardExpanded(cardID: string, running?: boolean): boolean {
  if (!cardID) return false;
  const explicit = store.expandedAgentCards[cardID];
  // Only honour the explicit override if it was set while the card was in the
  // same running-state.  When the state changes the override is stale and the
  // default protocol (always open) resumes automatically.
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

// ── Unified card fold store ──
// Used by the new <Card> primitive. Caller supplies the card's current
// `status` + a `defaultVal` derived from CardNode kind/status via
// defaultExpandedForNode(). The status argument is normalised to "" when
// absent so entries with no status still follow the stale-override rule.

function normStatus(s: string | undefined): string {
  return s == null ? "" : String(s);
}

/** Read the effective expanded state for a card. */
export function cardExpanded(id: string, status?: string, defaultVal = true): boolean {
  if (!id) return defaultVal;
  const entry = store.expandedCards[id];
  if (entry && entry.statusAtSet === normStatus(status)) return entry.value;
  return defaultVal;
}

/** Flip the card's expanded state, stamping the current status so the
 *  override auto-discards on the next status transition. */
export function toggleCard(id: string, status?: string, defaultVal = true): void {
  if (!id) return;
  const cur = cardExpanded(id, status, defaultVal);
  setStore("expandedCards", id, { value: !cur, statusAtSet: normStatus(status) });
}

/** Directly set a card's expanded state (used by bulk operations). */
export function setCardExpanded(id: string, value: boolean, status?: string): void {
  if (!id) return;
  setStore("expandedCards", id, { value, statusAtSet: normStatus(status) });
}
