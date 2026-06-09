import { createStore, reconcile } from "solid-js/store"

// Unified card-fold state. The `statusAtSet` field records the card's
// `status` string at the moment the user toggled — any subsequent status
// transition discards the override and the default expansion policy
// (defaultExpandedForNode) resumes.
type CardEntry = { value: boolean; statusAtSet: string }

const [store, setStore] = createStore({
  expandedCards: {} as Record<string, CardEntry>,
})

export { store as conversationUiStore }

// ── localStorage persistence ──
// Card collapse is per-task (cleared on selectTask), but persisting across
// page reloads keeps the operator's review state when they refresh or the
// overlay restarts. Stored under `oc_card_expand:<taskID>`. We cap the
// persisted task list (LRU) so localStorage doesn't grow unbounded across
// hundreds of tasks. Per-task entry count is also capped to keep the JSON
// size sub-100KB.
const STORAGE_PREFIX = "oc_card_expand:"
const STORAGE_INDEX_KEY = "oc_card_expand_index"
const MAX_PERSISTED_TASKS = 50
const MAX_ENTRIES_PER_TASK = 200
let activeTaskID = ""
let saveTimer: any = null
const SAVE_DEBOUNCE_MS = 400

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage
  } catch {
    return false
  }
}

function readIndex(): string[] {
  if (!isStorageAvailable()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function writeIndex(ids: string[]): void {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(ids))
  } catch {
    // storage full / quota — give up silently; persistence is best-effort
  }
}

function bumpIndex(taskID: string): void {
  const idx = readIndex().filter((id) => id !== taskID)
  idx.unshift(taskID)
  while (idx.length > MAX_PERSISTED_TASKS) {
    const evict = idx.pop()!
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + evict)
    } catch {
      // ignore
    }
  }
  writeIndex(idx)
}

function loadFromStorage(taskID: string): Record<string, CardEntry> {
  if (!isStorageAvailable() || !taskID) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + taskID)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, CardEntry> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue
      const value = (v as any).value
      const statusAtSet = (v as any).statusAtSet
      if (typeof value !== "boolean" || typeof statusAtSet !== "string") continue
      out[k] = { value, statusAtSet }
    }
    return out
  } catch {
    return {}
  }
}

// Synchronous flush for the currently-active task. Called both by the
// debounced timer AND by the task-switch path so the previous task's
// in-flight changes never get dropped when the operator switches before
// the 400ms debounce fires. Returns true on a successful write.
function flushActiveTaskNow(): boolean {
  if (!activeTaskID || !isStorageAvailable()) return false
  try {
    const entries = Object.entries(store.expandedCards)
    // Cap entries — if a task touched >200 cards, drop the oldest by
    // iteration order (Object.entries preserves insertion order).
    const trimmed = entries.slice(-MAX_ENTRIES_PER_TASK)
    const payload = Object.fromEntries(trimmed)
    window.localStorage.setItem(STORAGE_PREFIX + activeTaskID, JSON.stringify(payload))
    bumpIndex(activeTaskID)
    return true
  } catch {
    // ignore quota errors
    return false
  }
}

function scheduleSave(): void {
  if (!activeTaskID || !isStorageAvailable()) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushActiveTaskNow()
  }, SAVE_DEBOUNCE_MS)
}

/** Switch the active task — load that task's persisted collapse state into
 *  the in-memory store. Called from store/messages.ts:setSelectedTaskID.
 *  CRITICAL: flushes the previous task's pending debounced save BEFORE
 *  swapping in the new state, so rapid task switches don't drop the
 *  prior task's collapse changes. */
export function loadConversationUiStateForTask(taskID: string): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    // Drain any debounced edits from the previous task synchronously
    // before the activeTaskID flip — otherwise the new taskID would
    // capture the previous task's keys.
    flushActiveTaskNow()
  }
  activeTaskID = taskID
  const persisted = loadFromStorage(taskID)
  setStore("expandedCards", reconcile(persisted, { merge: false }))
}

export function clearConversationUiState(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    // Same race as loadConversationUiStateForTask — flush before clear
    // so explicit "no task selected" doesn't drop the prior task's edits.
    flushActiveTaskNow()
  }
  activeTaskID = ""
  setStore("expandedCards", reconcile({}, { merge: false }))
}

function normStatus(s: string | undefined): string {
  return s == null ? "" : String(s)
}

/** Read the effective expanded state for a card. */
export function cardExpanded(id: string, status?: string, defaultVal = true): boolean {
  if (!id) return defaultVal
  const entry = store.expandedCards[id]
  if (entry && entry.statusAtSet === normStatus(status)) return entry.value
  return defaultVal
}

/** Flip the card's expanded state, stamping the current status so the
 *  override auto-discards on the next status transition. */
export function toggleCard(id: string, status?: string, defaultVal = true): void {
  if (!id) return
  const cur = cardExpanded(id, status, defaultVal)
  setStore("expandedCards", id, { value: !cur, statusAtSet: normStatus(status) })
  scheduleSave()
}

/** Directly set a card's expanded state (used by bulk operations). */
export function setCardExpanded(id: string, value: boolean, status?: string): void {
  if (!id) return
  setStore("expandedCards", id, { value, statusAtSet: normStatus(status) })
  scheduleSave()
}
