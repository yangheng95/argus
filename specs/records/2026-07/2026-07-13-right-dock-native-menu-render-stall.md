# Right-Dock Native Menu Render-Stall Repair

## Recall

- User request: fix the desktop OpenCorvus page becoming blank after the new native right-dock menu is opened.
- Acceptance criteria:
  - opening the right-dock add or overflow menu must not stall the main WebView or replace the rendered application with a blank surface;
  - the menu remains a real operating-system popup above the native Browser Preview child WebView;
  - selecting an item still opens or selects the requested right-dock panel;
  - dismissing the popup leaves the application responsive;
  - focused contract, unit, Rust, and real rendered visual checks pass.
- Hard constraints:
  - preserve the task-scoped backend Browser Preview target/evidence as the preview source;
  - do not introduce an HTML fallback, iframe, local query override, gate, or second menu implementation;
  - route host interaction through `HostTransport`;
  - use Node, not Bun, for Playwright;
  - do not restart, reload, close, or otherwise disturb the user's running OpenCorvus window;
  - preserve unrelated dirty-worktree changes and do not create a worktree.
- Sources read:
  - `AGENTS.md` and `specs/README.md`;
  - `specs/records/2026-07/README.md`;
  - `packages/overlay/src-tauri/src/main.rs`;
  - `packages/overlay/src/components/RightDock.tsx`;
  - `packages/overlay/src/services/{right-dock-native,host-transport,tauri-transport}.ts`;
  - `packages/transport-protocol/src/index.ts` and its contract tests;
  - local primary dependency sources for Tauri `2.11.1` and Muda `0.19.1`, especially Tauri command response dispatch, `ContextMenu::popup`, and Windows `TrackPopupMenu` / `MenuEvent::send`.
- Whole-repository search evidence:
  - `rightDock.menu` has one protocol declaration/validator, one Tauri capability entry, one Tauri invoke mapping, one service caller, two `RightDock` click call sites, one Rust command, and focused protocol tests;
  - `overlay_right_dock_menu` is registered in both generated invoke-handler branches and nowhere else;
  - the only production menu-selection listener for this popup is the main window's `on_menu_event` handler;
  - no existing Tauri host-to-WebView UI-command subscription is available; `subscribeUiCommand` is intentionally a no-op for Tauri today.
- Independent agent feedback: none. The user did not request sub-agents or a parallel audit, so the repository's no-delegation boundary applies.

## Evidence and Causal Chain

User-observed behavior: after adopting the native right-dock menu, the desktop content becomes blank/unresponsive while the outer window remains visible.

Verified direct trigger in the native-menu path: `overlay_right_dock_menu` was a synchronous Tauri command. After `Menu::popup` returned, it called `std::sync::mpsc::Receiver::recv_timeout` for up to 30 seconds. The first repair made the command asynchronous, but dismissal still emitted no Muda `MenuEvent`; the command and frontend invoke then raced their 30-second/default transport deadlines and produced an unhandled `TimeoutError: signal timed out`.

Deep cause: selection and cancellation had different event semantics but were modeled as the same delayed receive. Tauri executes a synchronous command inline while resolving the WebView invoke. On Windows, Muda's `TrackPopupMenu` queues a `MenuEvent` only for a selection; cancellation returns from the popup without an event. Blocking that dispatch path starved selection delivery, while relying on a timeout for cancellation left the invoke unresolved and surfaced a global rejection.

Why the previous implementation did not work: the timeout bounded the stall but did not decouple command completion from menu-event delivery and did not represent popup dismissal. It therefore treated two deterministic native outcomes as a slow response instead of completing both through the event-loop ordering already guaranteed by Muda/Tauri.

Additional desktop evidence: an isolated Tauri launch also showed a blank center before this menu could be opened and logged a separate `/provider/hexin/budget` request that completed after the frontend request deadline. The same Vite page rendered the complete launcher in a normal browser. That startup failure is not attributed to the menu by naming or timing alone; it is recorded as a separate, unresolved desktop-initialization issue rather than folded into this menu causal chain.

## Call-Site Inventory and Disposition

| Surface | Current role | Disposition |
| --- | --- | --- |
| `packages/transport-protocol/src/index.ts` | Defines and validates `rightDock.menu` item payloads. | Preserve; the payload contract is correct. |
| `packages/transport-protocol/test/contract.test.ts` | Covers valid and invalid serialized menu payloads. | Preserve and extend only if the command shape changes. |
| `packages/overlay/src/services/host-transport.ts` | Declares Tauri-only menu capability. | Preserve. |
| `packages/overlay/src/services/tauri-transport.ts` | Maps `rightDock.menu` to `overlay_right_dock_menu`. | Preserve; the same promise may resolve asynchronously. |
| `packages/overlay/src/services/right-dock-native.ts` | Converts the native result into a selected identifier. | Preserve. |
| `packages/overlay/src/components/RightDock.tsx` | Opens the overflow/add native menu and applies selection. | Preserve; add focused behavior tests if missing. |
| `packages/overlay/src-tauri/src/main.rs::overlay_right_dock_menu` | Builds the native menu, opens it, and waits for selection or dismissal. | Use Tauri's asynchronous command lifecycle, keep the receiver on the blocking pool, and queue explicit cancellation after popup return. |
| `packages/overlay/src-tauri/src/main.rs::resolve_right_dock_menu` | Delivers the selected native identifier to the pending command. | Preserve as the single selection source. |
| `packages/overlay/src-tauri/src/main.rs` main-window `on_menu_event` | Routes native popup selection to the resolver. | Preserve. |
| Rust generated invoke handlers | Register the command for both runtime modes. | Preserve. |

## Implementation

1. Make `overlay_right_dock_menu` an asynchronous Tauri command. Tauri then runs the command future on its asynchronous runtime instead of inline on the WebView/main event-dispatch path.
2. Move the receiver wait onto Tauri's blocking-task pool. The native popup continues to run through Tauri's main-thread menu primitive, while selection delivery and invoke completion no longer occupy the renderer event loop.
3. After `Menu::popup` returns, enqueue `cancel_right_dock_menu` on the same main loop. A selected item's already-queued `MenuEvent` resolves first; a dismissed popup has no event, so the cancellation resolver completes the pending command with `None`. No polling or arbitrary timeout is involved.
4. Keep exactly one pending native-menu sender and the existing menu-event prefix routing. Do not add an HTML fallback menu or second selection store.
5. Catch native invocation failures at the `RightDock` action boundary and surface them through the notification center, so a host error cannot escape as `window.unhandledrejection`.
6. Add regression coverage for selection, dismissal, and rejected invokes, plus a source contract proving the command remains asynchronous and contains no receiver timeout.

## Verification

- Focused protocol and overlay unit tests for the menu path.
- Overlay TypeScript typecheck.
- Rust format/check and focused Rust tests for the Tauri host.
- Isolated desktop/runtime launch and screenshot without touching the user's existing window. The launch reproduced a separate startup blank state before the right dock was available, so native-popup visual selection/dismissal acceptance remains unverified in that environment and must not be claimed as passed.
- Second diff review against every call site above.
