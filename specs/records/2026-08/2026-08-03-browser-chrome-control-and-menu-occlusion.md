# Browser chrome control and menu occlusion repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | In the Right Dock Browser component, remove the page-preview border/inset; keep the right-arrow background inside the address input; preserve Enter as navigation inside the right-side Browser component while making only the right-arrow open the typed address in the computer's default browser desktop application when input is present; make the vertical-ellipsis menu readable instead of letting the browser layer cover it; add an in-page right-click menu with a `标注节点` action equivalent to the existing annotation action; and show `右键标注节点` beside a pointer that remains over one position for more than three seconds. |
| Acceptance criteria | The native page meets the Browser stage without a decorative frame or inset. Pressing Enter in the address field normalizes and navigates the embedded WebView. The adjacent right-arrow has the same compact height as its owning field, is disabled for blank input, and separately routes a normalized nonblank HTTP(S) URL through the existing host `open-url` command to the operating system's default browser application without retargeting the embedded WebView. Opening the Browser ellipsis menu first occludes the operating-system child WebView, presents the complete Kobalte menu above the host surface, and restores the same native Browser tab after dismissal. The live guest page owns an accessible custom context menu whose annotation action opens the existing guest node-comment panel for the right-clicked node. A stationary pointer produces the localized annotation hint after three seconds and moving/dismissing clears it. The real desktop page is interacted with, screenshotted, and personally reviewed. |
| Hard constraints | Preserve the native Tauri child WebView as the only live URL/title/history/page source; reuse the shared Button, TextField, DropdownMenu, and owner-aware native-surface occlusion primitives. Do not introduce an iframe, local/query URL source, duplicate menu, literal z-index workaround, fallback, feature gate, state machine, worktree, or UI automated test. Do not run existing UI automated tests. Playwright/browser interaction must use Node. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `2026-07-21-settings-extension-runtime-repairs.md`; `2026-08-03-right-dock-message-link-navigation.md`; `BrowserPreviewPanel.tsx`; `inspector.css`; Button/TextField/DropdownMenu primitives; native Browser service and Tauri WebView lifecycle; native-surface occlusion service. |
| Whole-repository grep | Searched the Browser panel, Right Dock, Overlay styles, native host commands, transport contracts, current architecture, records, and focused tests for address controls, ellipsis/context menus, guest selection, pointer handling, WebView bounds/layering, `z-index`, and native occlusion. The address field is `24px` while its submit button is overridden to `28px`. The live page retains `7px + 3px + border` frame decoration. The ellipsis menu portals into host HTML above an operating-system child WebView, and only Settings/app dialogs currently acquire the existing occlusion owner. The existing guest selection runtime already owns real Document Object Model (DOM) hit-testing and its comment panel, so the right-click action must reuse that owner. Directly encountered Rust tests that assert guest UI script strings are prohibited UI/source-string tests and must be deleted without running; focused native/service/transport data contracts remain eligible. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.29beta-yr-0803` was clean, synchronized with `myhexin/work-v0.0.29beta-yr-0803`, and pushed through the normal pre-push hook at `52360a9570` before implementation. |

## Causal chain

1. The shared small TextField resolves to the `24px` chip density.
2. `inspector.css` overrides both the address submit and ellipsis actions to
   `28px`. The address submit is absolutely centered over the `24px` field, so
   its hover/focus background necessarily extends two pixels beyond each edge.
3. The ellipsis content uses the shared Kobalte portal and the canonical overlay
   elevation token. That stacking order is correct among host HTML elements,
   but cannot cover a Tauri/WebView2 operating-system child surface.
4. The project already has one owner-aware native-surface occlusion lifecycle
   for exactly this host/native boundary. The Browser menu does not acquire an
   owner, so the child WebView stays visible above the menu.
5. The repair should align only the address action to the TextField density and
   make menu open/dismiss acquire/release the existing occlusion owner. Raising
   `z-index` or replacing the native page renderer would not address the actual
   platform layering boundary.
6. The native page is visually inset by three separate host recipes: live-stage
   padding, frame padding/border/radius, and child-surface radius. None carries
   page ownership, so these decorations should be removed at their source.
7. The injected guest selection runtime already performs real DOM hit-testing
   and renders the comment panel inside WebView2. Extending that same runtime
   with a localized context menu and stationary-pointer hint preserves the only
   viable native-layer interaction owner and avoids a second selector.

## Implementation and verification plan

1. Separate the address-submit sizing recipe from the Browser chrome action
   sizing recipe and bind its height/width to `--oc-density-chip-height`.
2. Control the Browser ellipsis menu through one local open signal. Acquire a
   tab-specific owner from the shared native-surface occlusion service before
   exposing the menu, and release it on dismissal or panel cleanup. Surface
   occlusion failures visibly rather than opening an unreadable menu.
3. Remove the Browser live/frame/surface decoration so the native page fills
   the stage. Preserve form submission (Enter) as embedded WebView navigation,
   while making the adjacent non-submit arrow independently use the host
   `open-url` command and its nonblank disabled condition.
4. Extend the existing injected guest selection runtime with one context menu,
   a three-second stationary-pointer hint, and localized labels supplied by the
   existing native selection-label contract. A right-click annotation request
   is observed through the existing current-page poll and starts the existing
   host selection/comment drain; no second annotation pipeline is added.
5. Update the current Browser ownership architecture to state that host menus
   overlapping the native child use the same owner-aware occlusion lifecycle.
6. Delete the directly encountered guest-runtime UI/source-string Rust tests
   without running them. Run focused non-UI native-surface/service contracts,
   Rust compilation,
   localization validation, production build, documentation health, and
   `git diff --check`; do not run UI automation.
7. Launch or reuse an isolated real desktop page, inspect the borderless page,
   address action at rest/hover/focus/blank input, host ellipsis menu, guest
   right-click annotation flow, three-second pointer hint, and native surface
   restoration in screenshots, then repeat the diff and visual review.
8. Record evidence here, commit with the `dsw-33987` prefix, fetch/reconcile the
   tracked git-cc branch, and push through the normal hook.

## Progress

- [x] Recall, causal chain, and call-site inventory recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification and real-page visual acceptance complete.
- [x] Second review complete; commit and git-cc push follow this recorded evidence.

## Delivered behavior and evidence

- Enter changed the isolated native child from
  `http://127.0.0.1:9421/preview/` to
  `http://127.0.0.1:9421/preview/?via=enter`. Clicking the adjacent arrow with
  `?via=external` opened Chrome (the registered default HTTP application) with
  the window title `Browser Interaction Validation - Google Chrome`, while the
  embedded child remained on `?via=enter`. Clearing the field disabled the
  arrow.
- The address input and arrow both measured `24px` high. Manual review of
  `.scratch/browser-chrome-interactions/arrow-hover-host.png` confirmed the
  hover background remains inside that height.
- `.scratch/browser-chrome-interactions/native-page-dpi.png` shows the native
  page filling the Browser stage without the old host inset, border, rounded
  frame, or shadow.
- `.scratch/browser-chrome-interactions/ellipsis-menu-enabled.png` shows the
  complete host menu above an occluded child WebView; its zoom controls and
  selection action remain enabled while the menu owns occlusion. Dismissal
  restored the same native page.
- `.scratch/browser-chrome-interactions/hover-hint.png` shows the localized
  annotation hint after a stationary pointer remained over the guest card for
  more than three seconds. `.scratch/browser-chrome-interactions/context-menu.png`
  and `comment-panel.png` show the native-page right-click action and the same
  node-comment panel used by toolbar selection.
- The first real comment submission exposed a deeper shared-contract defect:
  optional node metadata crossed guest and Rust boundaries as explicit `null`
  values, although the canonical transport models absence by omission. The
  guest publisher now omits absent metadata and Rust omits `Option::None` when
  serializing the validated result. A deliberately fast right-click submission
  then populated the main composer with the comment, page, URL, node path,
  region, color, font, and JavaScript path without an alert; this is visible in
  `.scratch/browser-chrome-interactions/annotation-composer.png`.

## Verification

- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml`
- Focused positive Rust contracts for canonical guest comments and page info
- Overlay and transport-protocol TypeScript typechecks
- Overlay localization projection check
- Focused positive native selection, current-page, and transport command
  contracts
- `bun run --cwd packages/overlay build:vite`
- Historical links, product documentation single-source, document-health, and
  `bun run docs:check`
- `git diff --check`

No UI automated test was added, modified, or run. The UI acceptance used an
isolated Tauri desktop application, a real WebView2 child, Node-driven
Playwright interaction, operating-system window capture, and manual image
inspection. A second visual review confirmed the borderless stage, bounded
arrow hover, readable enabled host menu, timed hint, right-click menu, guest
comment panel, and composer handoff.
