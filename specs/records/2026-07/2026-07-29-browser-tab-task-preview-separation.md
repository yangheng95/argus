# Browser tab and Task Preview separation

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User request               | The right-side Browser still cannot accept a manually typed URL. After comparing Codex's implementation, the user explicitly requested that Browser navigation and Task Preview be split. During implementation the user corrected the mount contract: a Task URL must mount as soon as it appears; it cannot be reduced to an `initialUrl` consumed only when the WebView is first created.                                                                                                                                                                                                                                                                                                                       |
| Acceptance criteria        | An ordinary Work or Chat conversation can open Browser, type an HTTP(S) URL, press Enter, and navigate the real native child WebView without a selected Task. The Browser tab's current URL, title, history, and rendered page come from the native browser surface. A Task `browser_preview_target` remains the canonical Task preview/evidence fact; when its ready URL appears, that Task/target/URL identity must mount or retarget the native surface even when evidence already exists. Repeated bounds synchronization cannot reapply it over subsequent manual browsing. No hidden Task, Session-scoped target, local URL source, iframe, query override, compatibility branch, or fallback is introduced. |
| Hard constraints           | Preserve the Tauri/WebView2 native surface and shared TextField/Button primitives. URL navigation must go through the typed HostTransport command boundary. Task target/evidence persistence remains backend-owned. Do not add, modify, update, or run UI automation tests. Validate UI only through a real desktop page, manual interaction, screenshots, and personal visual review. Playwright is launched only through Node. Preserve the unrelated `packages/opencorvus/src/skill/builtin-payload.ts` worktree edit. Do not create a worktree.                                                                                                                                                                |
| Sources read               | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`; `2026-07-28-browser-preview-manual-address-navigation.md`; `2026-07-28-right-dock-chrome-tabs-and-blank-tab.md`; `BrowserPreviewPanel.tsx`; Overlay Browser preview services and HostTransport; transport protocol; Tauri transport and Rust child-WebView implementation; Browser Preview route/target/evidence sources and focused non-UI protocol tests.                                                                                                                                                                                                                                                                     |
| Whole-repository grep      | Searched production, tests, generated SDK/API, active architecture, and historical records for `BrowserPreviewPanel`, `browser_preview_target`, `/browser-preview/target`, `setTaskBrowserPreviewAddress`, `activeBrowserPreviewTaskID`, `addressSubmissionAvailable`, `browserPreview.sync`, `browserPreview.navigate`, native child-WebView commands, and every target/evidence consumer. The call-site disposition below covers all production owners and direct protocol consumers.                                                                                                                                                                                                                            |
| Independent agent feedback | None. The user did not request sub-agents; the primary agent owns implementation and the required second review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Git baseline               | Current branch `work-v0.0.24beta-yr-0729` and `myhexin/work-v0.0.24beta-yr-0729` were both at `75bf982296`. The only pre-existing worktree edit is `packages/opencorvus/src/skill/builtin-payload.ts`, which is outside this task and remains untouched. The earlier trace commit `2f47c7d525` was already pushed before implementation began.                                                                                                                                                                                                                                                                                                                                                                     |

## Causal chain

1. In an ordinary Work conversation the Browser tab renders, but the address
   field is disabled.
2. `BrowserPreviewPanel.addressSubmissionAvailable` directly requires both
   `taskID` and `directory`; submission calls
   `setTaskBrowserPreviewAddress`, which persists an EngineTask artifact before
   the native WebView can mount.
3. The component therefore conflates two identities: a user-owned browser tab
   and a Task-owned preview/evidence target. The native WebView already has its
   own URL, title, and history, but `browserPreview.sync` continuously receives
   the Task target URL and reasserts it as renderer authority.
4. The earlier manual-address repair fixed only the selected-Task case. It
   could not support ordinary Work/Chat because no Task exists there, and
   inventing a hidden Task or Session target would merely relocate the same
   modeling error.
5. Codex's product boundary confirms the missing separation: the in-app
   browser owns persistent tabs and navigation independently, while a task may
   attach to or control a tab. OpenCorvus already has the mature native surface;
   the root fix is to separate its mount/resize lifecycle from explicit URL
   navigation and keep Task artifacts as optional preview inputs.

## Call-site disposition

| Owner / consumer                                                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                         | Replace the obsolete “Task target owns every Browser URL” rule with the explicit two-authority boundary: native browser tab owns live navigation state; Task artifact owns preview/evidence provenance.                                                                                                                                                                                                                                          |
| `specs/current/architecture/07-panel.md`                            | Record the same current architecture and retire the previous statement that native-only URL navigation cannot exist.                                                                                                                                                                                                                                                                                                                             |
| `packages/transport-protocol/src/index.ts`                          | Give `browserPreview.sync` an explicit HTTP(S) `mountUrl`: it is consumed whenever a new Task/target/URL or operator-tab lease mounts, not only when the singleton WebView is first created. Add one strict `browserPreview.navigateUrl` command for later operator navigation. Keep history back/forward/reload separate.                                                                                                                       |
| `packages/overlay/src/services/browser-preview-native.ts`           | Project the revised sync command, validate/normalize operator addresses once, and expose explicit native URL navigation.                                                                                                                                                                                                                                                                                                                         |
| `packages/overlay/src/services/tauri-transport.ts`                  | Map the typed commands to the corresponding Tauri invocations.                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/overlay/src-tauri/src/main.rs`                            | Create the singleton child WebView at the lease's `mountUrl`. When an existing singleton receives a different lease, navigate it to that lease's `mountUrl`; repeated sync within the same lease only positions/sizes/shows. Validate HTTP(S) URLs at the native boundary.                                                                                                                                                                       |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx`           | Make operator browser navigation Task-independent. Enable the address field whenever the native Browser capability exists. A ready Task URL produces a Task/target/URL-specific mount lease immediately and wins over an existing evidence rendering branch. Manual submit produces an operator-tab lease and navigates directly; later layout sync cannot overwrite it. Keep Task evidence provenance separate from live tab URL/title/history. |
| `packages/overlay/src/services/browser-preview.ts`                  | Remove the Overlay-only manual-address writer; Task target/evidence reads remain unchanged. The backend Task assignment route remains the explicit Task Preview API, not the Browser address bar.                                                                                                                                                                                                                                                |
| `packages/overlay/src/store/board.ts`, `main.tsx`, `TaskDirBar.tsx` | Preserve selected-Task target discovery and Browser reveal behavior. No hidden Task or Session target is added.                                                                                                                                                                                                                                                                                                                                  |
| Non-UI protocol tests                                               | Update transport/native-service and Rust command-contract coverage only. Do not touch or run component, DOM, Playwright, screenshot-baseline, or other UI automation tests.                                                                                                                                                                                                                                                                      |

## Implementation plan

1. Update the current architecture rule and typed native command contract.
2. Model Task URL appearance as a native mount lease, while keeping repeated
   bounds synchronization and later operator navigation separate.
3. Rewire `BrowserPreviewPanel` so native tab lifecycle and address submission
   are independent of Task scope, while Task target discovery remains an
   required mount input whenever it appears.
4. Run focused non-UI protocol tests, TypeScript typechecks, Rust checks, API
   route/docs health, and `git diff --check`.
5. Build and start the real desktop surface, manually open Browser from an
   ordinary Work/Chat conversation, type a URL, navigate, capture a
   task-scoped screenshot, inspect it, and iterate if needed.
6. Perform an exact-diff and call-site second review, then commit and push
   through the normal `myhexin` hooks.

## Codex review feedback

The exact-diff review found one timing hole after the user's mount-contract
correction: when an operator tab was already active inside a Task before that
Task published its first ready target, the operator-tab branch could continue
to win and suppress the newly appearing Task URL. The implementation now tracks
the exact Task/directory/target/URL mount identity. Every new or reappearing
ready identity cancels an in-flight operator navigation, resets the visible
address to the Task URL, and acquires the Task mount lease. Once that lease is
mounted, a later manual navigation changes only the live browser tab and
repeated bounds synchronization cannot reapply the Task URL.

## Verification evidence

- Focused HostTransport, native-service, Task-preview service, capability, and
  transport-protocol contracts: 48 passed, 0 failed.
- Rust native URL contract:
  `browser_preview_url_navigation_accepts_only_http_and_https` passed.
- Overlay TypeScript and transport-protocol typechecks passed; the Vite
  production build completed.
- Document health, historical link health, and product-doc single-source
  contracts: 93 passed, 0 failed. `api:routes-check`, `docs:check`, and Overlay
  locale ownership checks passed.
- Runtime packaging contracts, including the repaired OfficeCLI Windows digest:
  52 passed, 0 failed.
- Real isolated desktop application, ordinary Chat with no Task: Browser opened
  with an enabled address field; keyboard input `example.com` plus Enter
  navigated the native child WebView to `https://example.com/`, whose live title
  was `Example Domain`. Maximizing/resizing the window did not reapply another
  URL. The inspected full-desktop capture is
  `.scratch/browser-tab-task-preview-separation-desktop.png`.

## Progress

- [x] Recall, causal chain, and whole-repository call-site inventory recorded.
- [x] Native Browser tab and Task Preview responsibilities separated.
- [x] Non-UI verification and real-page visual acceptance complete.
- [x] Second review and implementation commit complete; git-cc push is verified
      by the delivery history.
