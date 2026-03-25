import { render } from "solid-js/web";
import { Conversation, createConversationBridge } from "./components/Conversation";

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

// Expose bridge for legacy app.js to push data into Solid store
(window as any).__solidConversation = createConversationBridge();
