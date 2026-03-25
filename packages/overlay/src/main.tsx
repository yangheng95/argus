import { render } from "solid-js/web";
import { Conversation } from "./components/Conversation";
import { startSSE, stopSSE } from "./services/sse";
import {
  syncTask,
  clearMessages,
  setSelectedTaskID,
  setAgentEvents,
  setAgentStatus,
  setShowTranscriptDetails,
  messageStore,
} from "./store/messages";
import { configure as configureApi } from "./services/api";

// Mount Solid conversation component into the chat scroll container.
// Legacy app.js loads before this module (classic <script> vs type="module"),
// so the DOM element and legacy globals are already available.
const container = document.getElementById("chatScroll");
if (container) {
  // Clear any existing content from legacy rendering
  container.innerHTML = "";
  // Pass the container as a prop so Conversation can manage scroll
  // without creating a duplicate wrapper div.
  render(() => <Conversation container={container} />, container);
}

// Expose minimal API for legacy app.js (will be removed in final phase).
// Legacy code calls these instead of managing SSE/messages directly.
(window as any).__solidOverlay = {
  // Called by legacy selectTask
  selectTask: async (taskID: string) => {
    setSelectedTaskID(taskID);
    if (!taskID) {
      clearMessages();
      return;
    }
    await syncTask(taskID);
    // routeSSEEvent() inside startSSE already forwards unknown events to
    // window.__legacyHandleNonMessageEvent, so no callback is needed here.
    startSSE(taskID);
  },
  stopSSE,
  setAgentEvents,
  setAgentStatus,
  setShowTranscriptDetails,
  configureApi,
  clearMessages,
  // Read-only access to store for legacy code that needs message count etc.
  get messageStore() {
    return messageStore;
  },
};
