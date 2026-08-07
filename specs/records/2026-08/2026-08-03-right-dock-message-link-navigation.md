# Right Dock message-link navigation repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Repair the right-side Browser component: it opens incorrectly, clicking a message link leaves the address bar empty, and no page content can be previewed. |
| Acceptance criteria | Clicking an HTTP(S) link rendered in Conversation reveals the existing Right Dock Browser tab, immediately presents the normalized URL in its address field, and navigates the real native child WebView. The native tab remains the only owner of the live URL, title, history, and page. A newly ready Task preview target still reveals and mounts through its existing Task/target/URL lease. |
| Hard constraints | Preserve the native Tauri/WebView browser surface, shared Kobalte Button/TextField controls, Task Preview artifact provenance, multiple Browser-tab identities, and the explicit Task-target automatic reveal. Do not create an iframe, query override, local URL state source, hidden Task, compatibility path, fallback, feature gate, state machine, worktree, or UI automated test. Do not restart, refresh, stop, or close the user's running OpenCorvus/Overlay processes. UI acceptance uses a real isolated page and manually inspected screenshots; any Playwright work runs through Node. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`; `specs/current/architecture/07-panel-reactivity.md`; `2026-07-29-browser-tab-task-preview-separation.md`; `2026-07-29-right-dock-codex-parity-and-browser-tab-instances.md`; `packages/overlay/src/main.tsx`; `BrowserPreviewPanel.tsx`; native Browser service and Tauri host call sites; Git history for message-link preview routing. |
| Whole-repository grep | Searched production, current architecture, historical records, and directly related Overlay tests for `data-browser-preview-url`, `openBrowserPreviewFromMessage`, `BrowserPreviewPanel`, `browserPreview.sync`, native navigation, address controls, Right Dock Browser identities, and automatic ready-target reveal. The search found the obsolete message-link dispatcher plus existing UI/source-string tests tied to the touched Browser/Right Dock surface; those UI tests and their dedicated fixture must be removed without running them. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.29beta-yr-0803` was clean and synchronized with `legacy-remote/work-v0.0.29beta-yr-0803` at `cb968457ea` before this record. The pre-existing checkpoint commit was preserved, retitled with the required `dsw-33987` prefix, and pushed through the normal hook. |

## Causal chain

1. Markdown rendering correctly annotates HTTP(S) anchors with
   `data-browser-preview-url`.
2. The delegated click handler reads that exact URL, but
   `openBrowserPreviewFromMessage` discards it. The function only checks for a
   selected Task, opens the fixed Browser panel, and bumps Task preview
   discovery.
3. No backend target changed, so the refresh cannot produce the clicked URL.
   In ordinary Chat/Work there may be no Task at all; in a Task without a saved
   preview target the opened panel therefore has neither a mount URL nor an
   address value.
4. The July Browser/Task separation already provides the correct native
   `navigateUrl` command and Task-independent operator navigation inside
   `BrowserPreviewPanel`. The missing piece is one real command boundary from
   the message-link dispatcher to that existing tab owner.
5. The repair will expose a narrow imperative Browser-panel controller that
   submits the clicked URL through the same normalization and native navigation
   path as the address field. It is a one-shot command, not a second URL store;
   the native WebView current-page query remains live URL/title authority.

## Implementation and verification plan

1. Register the fixed Browser panel's existing address-navigation command with
   `main.tsx`, and route annotated Conversation links to it before revealing the
   Dock. Remove the unrelated Task-ID condition and fake preview-revision bump.
2. Make external and address-field navigation share one normalized request
   function so the address is populated immediately and native navigation has
   one implementation.
3. Update current Browser ownership documentation and delete the directly
   discovered UI/source-string tests plus dedicated Right Dock fixture without
   running them.
4. Run focused non-UI Browser native/service/transport contracts, Overlay
   typecheck, localization check, production build, documentation health, and
   `git diff --check`.
5. Start an isolated real page without disturbing the running application,
   click a rendered Conversation HTTP(S) link, inspect the populated address
   and rendered Browser page in screenshots, then repeat the interaction and
   exact-diff review as the mandatory second verification.
6. Update this record with evidence, commit with the `dsw-33987` prefix, fetch
   and reconcile the tracked legacy remote branch, then push through the normal hook.

## Progress

- [x] Recall, causal chain, and call-site inventory recorded.
- [x] Product routing and directly related obsolete UI-test cleanup complete.
- [x] Non-UI/static verification and real-page visual acceptance complete.
- [x] Second review, commit preparation, remote convergence checks, and legacy remote delivery complete.

## Delivered behavior

- The fixed Browser panel registers one narrow `navigate(url)` command with the
  Overlay root. Conversation links invoke that existing native-tab command and
  reveal the Browser tab without requiring or mutating a Task.
- Address-field submission and message-link activation share the same URL
  normalization and native navigation request. The normalized in-flight URL is
  visible immediately; the native current-page query resumes authority after
  the WebView reports the loaded page.
- The obsolete Task preview revision bump and Task-ID prerequisite were removed.
  Task Preview target discovery and operator navigation therefore remain
  separate, single-owner contracts.
- UI/source-string tests directly encountered on the touched Right Dock surface
  and their dedicated fixture were deleted without being run, as required by
  the repository's UI automation prohibition. Focused native/service tests were
  retained.

## Verification evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun test packages/overlay/test/browser-preview-native.test.ts packages/overlay/test/browser-preview-service.test.ts packages/transport-protocol/test/contract.test.ts`
  passed with 40 tests, 0 failures, and 1,227 expectations.
- `bun run --cwd packages/overlay check:i18n` passed.
- `bun run --cwd packages/overlay build:vite` completed successfully; only
  third-party directive and chunk-size warnings were emitted.
- `bun test --timeout 60000 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/document-health.test.ts`
  passed with 70 tests, 0 failures, and 1,188 expectations.
- `bun run docs:check` passed with 311 operations across 24 groups.
- A dedicated Tauri instance used an isolated `OPENCORVUS_HOME`, sidecar on
  port 7879, and WebView2 remote-debugging endpoint on port 9333. The existing
  packaged OpenCorvus process was not restarted, refreshed, stopped, or closed.
- In the real isolated conversation, activating
  `http://127.0.0.1:9421/preview` automatically revealed the fixed Browser tab.
  The visible address input contained the complete URL, the native child
  WebView target reported that same URL and the title `Native Browser Link
  Target`, and the rendered page stated that the link reached the real embedded
  WebView.
- Manually inspected evidence:
  `.scratch/right-dock-message-link-runtime/after-link-native-composite.png`
  captures the conversation link, populated address field, and native WebView
  content in one desktop frame;
  `.scratch/right-dock-message-link-runtime/after-link-native-page.png` captures
  the native child page directly. These are one-run acceptance artifacts, not
  screenshot baselines or automated UI tests.

## Second review

The final call-path review traced the rendered anchor through the delegated
document click handler, the registered fixed-panel controller, the shared
normalization request, native `navigateUrl`, and current-page synchronization.
No fallback, Task shadow state, iframe, query override, or second live-URL store
was introduced. The real desktop replay independently confirmed both symptoms
from the request are closed: the Browser opens from the link with a populated
address and renders the target content.
