// ── App — Root Solid Component ──
//
// This is the future root component that will coordinate all migrated Solid
// sub-components once the migration from legacy app.js is complete.
//
// CURRENT STATUS (Phase 3):
//   - This file is a planning skeleton only.
//   - main.tsx still mounts only <Conversation> into #chatScroll.
//   - The remaining DOM (sidebar, board sections, interaction alerts, etc.)
//     is still managed by app.js.
//   - Do NOT activate this component by mounting it from main.tsx yet.
//
// ACTIVATION PLAN:
//   When all sections have been migrated and index.html is ready, replace
//   the individual render() calls in main.tsx with a single:
//
//       render(() => <App />, document.getElementById("appRoot")!);
//
//   and remove the legacy app.js <script> tag from index.html.

import { Show, createMemo } from "solid-js";
import { Conversation } from "./components/Conversation";
import { Board } from "./components/Board";
import { ChatComposer } from "./components/ChatComposer";
import { TaskList } from "./components/TaskList";
import { InteractionPanel } from "./components/InteractionPanel";
import { NdjsonLog } from "./components/NdjsonLog";
import { boardStore, loadBoard } from "./store/board";
import { settingsStore } from "./store/settings";
import { apiJson } from "./services/api";

// ── App Component ──

export function App() {
  // ── Derived state ──

  const pendingInteractionCount = createMemo(() => {
    const raw = boardStore.board?.interactions;
    if (!Array.isArray(raw)) return 0;
    return raw.filter((item: any) => item?.status === "pending").length;
  });

  // ── Interaction bridge helpers ──
  // Used by <Board> presentation layer to dispatch API calls.
  // These mirror the logic in InteractionPanel but are exposed as standalone
  // async functions for the Board component's callback props.

  async function resolveInteractionBridge(id: string, action: string): Promise<void> {
    try {
      await apiJson(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: action }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      console.error("[App] resolveInteractionBridge failed", err);
    } finally {
      await loadBoard();
    }
  }

  async function rejectInteractionBridge(id: string): Promise<void> {
    try {
      await apiJson(`interaction/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      console.error("[App] rejectInteractionBridge failed", err);
    } finally {
      await loadBoard();
    }
  }

  // Called by <InteractionPanel> after each successful resolve/reject.
  async function handleInteractionRespond(
    _interactionID: string,
    _response: any,
  ): Promise<void> {
    await loadBoard();
  }

  // ── Render ──
  // NOTE: The layout below is aspirational. The actual DOM structure mirrors
  // index.html which is still rendered by app.js. This component uses the
  // same CSS class names as the legacy HTML so it can be dropped in without
  // stylesheet changes.
  //
  // Sub-sections guarded by Show(when=false) are pre-wired but inactive until
  // their corresponding migration phase is complete. They remain here so that
  // the required imports and prop connections are already validated by the
  // TypeScript compiler.

  return (
    <div class="app-root" data-theme={settingsStore.theme}>
      {/* ── Sidebar / task list rail ── */}
      {/*
        TaskList renders the active / recent task list from boardStore.tasks.
        Guarded until the sidebar HTML is fully migrated out of app.js.
      */}
      <Show when={false /* activate when sidebar migration is complete */}>
        <aside class="sidebar">
          <TaskList
            onSelectTask={(taskID) => {
              (window as any).__solidOverlay?.selectTask?.(taskID);
            }}
            onDeleteTask={(taskID) => {
              // Delegate to legacy handler until task delete is migrated.
              (window as any).__legacyDeleteTask?.(taskID);
            }}
          />
        </aside>
      </Show>

      {/* ── Main workspace ── */}
      <div class="workspace-main">
        {/* ── Chat / conversation pane ── */}
        <section class="chat-pane">
          <div id="chatScroll" class="chat-scroll">
            {/*
              Conversation is already mounted into #chatScroll by main.tsx.
              When App becomes the single root mount point, remove the
              individual render() in main.tsx and include Conversation here
              (passing the #chatScroll element as the container prop).
            */}
            <Conversation container={null as any} />
          </div>

          {/*
            ChatComposer sits below the conversation scroll area.
            Guarded until the composer HTML is fully migrated out of app.js.
          */}
          <Show when={false /* activate when chat migration is complete */}>
            <ChatComposer
              enabled={true}
              busy={false}
              onSubmit={(_text, _attachments) => {
                // Delegate to legacy chat submit handler until migrated.
                (window as any).__legacyChatSubmit?.(_text, _attachments);
              }}
            />
          </Show>
        </section>

        {/* ── Board / sections pane ── */}
        <section class="sections-pane">
          {/*
            Board renders Spec, Plan, Goals, Criteria, Evaluation, Delivery
            and the InteractionsList (presentation-only layer).
            Guarded until the board sections HTML is fully migrated.
          */}
          <Show when={false /* activate when board migration is complete */}>
            <Board
              onResolveInteraction={(id, action) =>
                void resolveInteractionBridge(id, action)
              }
              onRejectInteraction={(id) =>
                void rejectInteractionBridge(id)
              }
            />
          </Show>

          {/* ── Smart interaction panel (auto-resolve + API calls) ── */}
          {/*
            InteractionPanel is intentionally always active: it reads from
            boardStore directly and manages the full auto-resolve lifecycle
            (cooldown, unattended mode, structured question answers).
            This is the canonical handler for pending interaction resolution.
          */}
          <Show when={pendingInteractionCount() > 0}>
            <InteractionPanel onRespond={handleInteractionRespond} />
          </Show>
        </section>
      </div>

      {/* ── NDJSON event log (dialog overlay) ── */}
      {/*
        The legacy log dialog (<dialog id="log-dialog">) will be replaced by
        this component once dialog migration is complete.
      */}
      <Show when={false /* activate when dialog migration is complete */}>
        <dialog id="ndjson-log-dialog" class="log-dialog">
          <div class="log-dialog-body">
            <NdjsonLog />
          </div>
        </dialog>
      </Show>
    </div>
  );
}
