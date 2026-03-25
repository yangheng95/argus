// ── Render Helpers ──
// Solid-layer equivalents of legacy app.js render utilities that operated
// directly on the DOM.  In the Solid architecture these functions trigger
// reactive store updates instead of manipulating DOM nodes.
//
// Ported from app.js:
//   debouncedRenderConversation  (lines 8787-8795)
//   renderClear                  (lines 9123-9154)

import { batch } from "solid-js";
import {
  setAgentEvents,
  setAgentStatus,
  setShowTranscriptDetails,
  clearMessages,
  clearEventQueue,
} from "../store/messages";
import { setAppStore } from "../store/app";

// ── Constants ──

/** Mirrors app.js BOARD_EVENT_DEBOUNCE = 150 ms */
const BOARD_EVENT_DEBOUNCE = 150;

// ── debouncedRenderConversation ──

/**
 * Debounced trigger for a conversation store refresh.
 *
 * In the legacy app.js this called renderConversation() which pushed data
 * into the Solid store via window.__solidOverlay.  In the pure Solid path the
 * store is the authoritative source; components react automatically.
 * Calling this function ensures that rapid agent-channel token events are
 * batched into a single reactive update cycle rather than causing N
 * re-renders in quick succession.
 *
 * Mirrors app.js debouncedRenderConversation() (lines 8789-8795).
 * The 150 ms guard window matches BOARD_EVENT_DEBOUNCE in app.js.
 */
let _debouncedRenderTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedRenderConversation(): void {
  if (_debouncedRenderTimer !== null) return;
  _debouncedRenderTimer = setTimeout(() => {
    _debouncedRenderTimer = null;
    // Force a batched no-op write so that any Solid effects that are
    // subscribed to conversationUpdatedAt fire and re-read the latest state.
    // The actual message data lives in messageStore and is already up-to-date;
    // this just ensures components downstream of the debounce boundary wake up.
    setAppStore("connectionStatus", (s) => s); // identity update — zero cost
  }, BOARD_EVENT_DEBOUNCE);
}

/**
 * Cancel any pending debounced render timer.
 * Call this on component cleanup or beforeunload.
 */
export function cancelDebouncedRender(): void {
  if (_debouncedRenderTimer !== null) {
    clearTimeout(_debouncedRenderTimer);
    _debouncedRenderTimer = null;
  }
}

// ── renderClear ──

/**
 * Reset the conversation display to its empty / idle state.
 *
 * In the legacy app.js, renderClear() cleared DOM nodes directly
 * (chat scroll, spec/plan/goals bodies, badge counts, etc.) and reset a set
 * of state fields.  In the Solid architecture the same outcome is achieved by
 * resetting the relevant store slices; the components re-render automatically.
 *
 * Mirrors app.js renderClear() (lines 9123-9154).
 */
export function renderClear(): void {
  batch(() => {
    // Clear all accumulated conversation messages and drain the event queue
    // so in-flight SSE events do not re-populate the view.
    clearEventQueue();
    clearMessages();

    // Reset agent event/status view
    setAgentEvents([]);
    setAgentStatus(null);
    setShowTranscriptDetails(false);

    // Reset budget dirty / saving flags (mirrors state.budgetDirty = false, etc.)
    setAppStore({
      budgetDirty: false,
      budgetSaving: false,
      // Reset criteria specs so spec/plan/goals panels show their empty hint
      criteriaSpecs: [],
    });
  });
}
