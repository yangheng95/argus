# macOS Child-WebView Arrow Input Repair

## Recall

### User request

The input box has again started inserting unreadable characters when an arrow
key is pressed.

### Acceptance criteria

- In the packaged macOS application, Left, Right, Up, and Down never enter the
  AppKit function-key text insertion path in an input or textarea.
- Arrow keys continue to move the native WebKit caret and selection normally,
  including at the start and end of text and while the macOS input method is
  active.
- The existing Input Method Editor (IME) Enter ownership remains intact: an
  IME-owned Enter does not submit, and a later ordinary Enter does.
- The repair applies to the shared native WebView owner instead of filtering
  characters in Composer or adding a second draft/input source.
- Positive Rust contract tests, Overlay typecheck/build, locked Cargo checks,
  an isolated packaged native application run with physical keyboard input,
  screenshot review, second diff review, task-owned commit, and `legacy-remote` push
  pass.

### Hard constraints

- Preserve every staged and unstaged concurrent change; do not stash, reset,
  restore, broadly format, or broadly stage.
- Do not stop, reload, focus, type into, or otherwise modify the currently
  running OpenCorvus process.
- Do not add, modify, update, or run User Interface (UI) automated tests.
- Delete the encountered obsolete source-string UI test
  `packages/overlay/test/macos-keyboard-forwarding.test.ts`; do not replace it
  with another UI/source assertion.
- Keep Tauri's `unstable` feature because the real Browser tab depends on native
  child WebViews.
- Do not add a JavaScript private-use/control-character scrubber, `beforeinput`
  fallback, Composer boundary gate, or a second keyboard path.
- Playwright, if needed for isolated page preparation, must run under Node.js.
- Delivery commits use the `dsw-33987` prefix.

### Disk sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-23-overlay-goal-status-settings-macos-keyboard-repair.md`
- `specs/records/2026-07/2026-07-27-macos-composer-ime-enter-and-function-key-repair.md`
- `packages/overlay/src-tauri/Cargo.toml`
- `packages/overlay/src-tauri/Cargo.lock`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/composer-keyboard.ts`
- the resolved Wry 0.55.1 macOS `WryWebView` and
  `WryWebViewParent` implementations
- the current macOS ARM64 package record and built bundle.

### Whole-repository grep evidence

| Owner / call point | Evidence and disposition |
| --- | --- |
| Tauri feature selection | `packages/overlay/src-tauri/Cargo.toml` is the sole native manifest and enables `tauri/unstable`; preserve it because `main.rs` creates native Browser child WebViews. |
| Native application composition | `packages/overlay/src-tauri/src/main.rs::main` is the sole `tauri::Builder` and `.setup` owner; obtain the already-created main WebView there and install the macOS parent-responder repair once before interactive use. |
| Browser child WebView creation | `main.rs::overlay_browser_preview_sync` is the native child-WebView owner; preserve its URL, history, and layout semantics. |
| Composer keyboard handling | `ChatComposer.handleKeyDown` remains the one Enter/mention/atomic-navigation owner and already returns for `isComposerImeKeyboardEvent`; preserve it. |
| IME event classification | `services/composer-keyboard.ts` remains the one WebKit `isComposing` / key code 229 semantic; preserve it. |
| Native Wry dependency | `Cargo.toml` and `Cargo.lock` resolve released Wry 0.55.1. Its parent `keyDown:` sends every key to the menu, while the `unstable` child-WebView path can still route boundary arrows through `interpretKeyEvents:` and `insertText:`. |
| Existing native keyboard test | `packages/overlay/test/macos-keyboard-forwarding.test.ts` only reads source files and asserts absent strings; it is prohibited UI/source automation and failed to exercise the native responder chain. Delete it. |
| Native Rust tests | `main.rs` owns the existing platform-independent unit-test module. Add only a positive pure contract for the four macOS arrow virtual key codes; native interaction remains manual. |

### External evidence

- Tauri issue `#10194` reports that enabling `unstable` makes Left and Right
  insert invalid characters in macOS inputs.
- Wry issue `#1175` remains open for macOS arrow delivery.
- Wry pull request `#769` previously fixed this exact defect by stopping macOS
  virtual key codes 123 through 126 from reaching the default AppKit text
  interpretation path.
- Wry pull request `#798` later removed the key-down overrides; downstream
  reports confirm the regression persists through Wry 0.55.1 for child
  WebViews.
- Wry pull request `#1711` remains open and calls `interpretKeyEvents:` on the
  parent view; direct physical-input evidence shows that is not safe when the
  input method routes function keys through `insertText:`.

### Independent agent feedback

None. The user did not request sub-agents, and the active delegation policy
forbids spawning them.

## Causal chain

1. OpenCorvus enables Tauri `unstable` to host the real Browser tab as a native
   child WebView.
2. Wry 0.55.1 no longer contains the 2022 parent-view `keyDown:` arrow guard.
3. At a text boundary or through an input-method function-key path, WebKit does
   not consume the physical arrow completely.
4. AppKit's responder chain interprets virtual key codes 123 through 126 as
   function-key text and calls `insertText:`.
5. The resulting U+F700-family or C0 control value reaches the textarea outside
   the ordinary DOM input pipeline and is rendered as unreadable text.
6. The July 27 repair removed a different unsafe parent-view implementation but
   did not restore the lost parent-responder arrow guard. Its synthetic browser
   validation could not exercise the native AppKit responder chain, so it
   incorrectly declared the physical-key defect closed.

## Implementation plan

1. Add one macOS-only native module that repairs the actual parent responder of
   the instantiated Wry WebView: WebKit retains ordinary caret movement, arrow
   virtual key codes that reach the parent stop before AppKit text
   interpretation, and every other parent key preserves Wry's original
   implementation.
2. Install that owner exactly once from the existing Tauri setup composition,
   deriving the runtime class from the already-created native WebView instance
   instead of guessing Objective-C class-registration timing.
3. Add the direct macOS Objective-C runtime dependency and regenerate the
   locked Cargo graph with Cargo tooling.
4. Delete the encountered obsolete source-string UI test. Add a positive Rust
   contract covering the complete four-key native arrow set.
5. Run focused Rust tests, locked Cargo check, Overlay typecheck/build, relevant
   non-UI document health, and diff checks.
6. Build and launch an isolated native bundle without touching the user's
   running instance. Use physical keyboard input to inspect all four boundary
   arrows, ordinary caret movement, and IME entry; capture and personally
   review the current task-scoped screenshot.
7. Re-read every task-owned diff and the running/built dependency evidence,
   then commit only task-owned paths and push the current main beta branch to
   `legacy-remote`.

## Progress

- [x] Prior repair, current source, running package, Wry source, upstream
  history, open regressions, and all repository call points inspected.
- [x] Native parent-responder repair and positive non-UI contract implemented.
- [x] Build and isolated physical-key visual validation completed.
- [x] Second review completed; task-owned commit and legacy remote push prepared.

## Validation evidence

- `cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml -- --check`
  passed.
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml --locked appkit_arrow_virtual_key_codes_share_the_native_repair`
  passed: 1 positive contract, 58 filtered.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml --locked`
  passed.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay build:vite` passed with 7,056 modules.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed: 22 tests.
- The isolated `OpenCorvus Arrow QA.app` bundle built and launched beside the
  untouched user instance. The first runtime attempt proved that setup-time
  class-name lookup was too early; the second visual attempt proved that
  intercepting `WryWebView::keyDown:` itself swallowed normal caret movement.
  Both rejected approaches were removed.
- In the final isolated native run, physical Left moved the caret in `abcd` and
  the marker produced `abXcd`; repeated Left beyond the start followed by a
  marker produced `LabXcd`; repeated Right beyond the end produced `LabXcdR`;
  repeated Up and Down left the exact value `LabXcdR`. No function-key glyph,
  control character, replacement box, or duplicate titlebar appeared in the
  task-scoped screenshot reviewed at 11:04 Asia/Singapore.
- The QA application and its sidecar processes were closed after validation.
  The user's packaged OpenCorvus application was never targeted, focused,
  typed into, stopped, or restarted by this task.

## Second review

- The repair is installed from the concrete native WebView instance, so it
  cannot race Objective-C class registration.
- The replacement is limited to the Wry parent responder. WebKit remains the
  single owner of caret movement and selection; Wry's original parent
  `keyDown:` implementation remains the owner of every non-arrow key.
- The existing Composer IME Enter classifier and submission ownership were not
  changed.
- No JavaScript character scrubber, input fallback, second draft source,
  Composer boundary gate, Wry fork, or UI automation was introduced.
- The encountered source-string UI test was deleted, and the task did not run
  any UI automation tests.
