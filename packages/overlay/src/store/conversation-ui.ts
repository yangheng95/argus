import { createStore, reconcile } from "solid-js/store";

// Unified card-fold state. The `statusAtSet` field records the card's
// `status` string at the moment the user toggled — any subsequent status
// transition discards the override and the default expansion policy
// (defaultExpandedForNode) resumes.
type CardEntry = { value: boolean; statusAtSet: string };

const [store, setStore] = createStore({
  expandedCards: {} as Record<string, CardEntry>,
});

export { store as conversationUiStore };

export function clearConversationUiState(): void {
  setStore("expandedCards", reconcile({}, { merge: false }));
}

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
