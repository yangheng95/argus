// ── Composer Attach Subscription ──
// Bridges host-driven `composer.attach` ui-commands (plan
// §19.2.6) into the overlay's existing chat-attachments store. Called
// once during overlay init; the subscription lives for the lifetime
// of the webview.
//
// CLAUDE.md §一-15: this code path NEVER sends a user message. The
// payload becomes a pending attachment in the composer; the user
// must press send for it to leave the client.

import { messageStore, setChatAttachments } from "../store/messages"
import { getHostTransport } from "./host-transport"
import { isComposerAttachPayload } from "./composer-attach-validate"

let installed = false

export function installComposerAttachSubscription(): void {
  if (installed) return
  installed = true
  getHostTransport().subscribeUiCommand("composer.attach", (raw) => {
    if (!isComposerAttachPayload(raw)) {
      console.warn("[composer.attach] invalid payload, ignoring", raw)
      return
    }
    // Reuse the existing attachment shape used by services/chat.ts —
    // adding sourcePath / selection as optional metadata so the host
    // origin is traceable in the message stream once submitted.
    const next = [
      ...messageStore.chatAttachments,
      {
        mime: raw.mime,
        url: raw.dataUrl,
        filename: raw.filename,
        sourcePath: raw.sourcePath,
        selection: raw.selection,
      },
    ]
    setChatAttachments(next)
  })
}
