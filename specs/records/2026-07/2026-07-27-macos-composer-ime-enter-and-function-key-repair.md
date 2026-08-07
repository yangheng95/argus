# macOS Composer IME Enter and Function-Key Repair

## Recall

### User request

On macOS, one Enter press while using Pinyin currently both commits the
composition and starts a session. The first Enter must only commit the input
method text; sending requires a second Enter. When Pinyin has no candidate,
arrow and other function keys must not insert unreadable characters.

### Acceptance criteria

- An Enter event owned by the input method never requests Composer submission,
  including WebKit's out-of-order `compositionend` / `keydown` sequence.
- A subsequent ordinary Enter requests exactly one submission.
- Native function keys no longer pass through the unmerged Wry parent-view
  `interpretKeyEvents` override that can turn AppKit function-key glyphs into
  text.
- The native textarea and canonical scoped draft remain the only text sources;
  no character scrubber, shadow draft, fallback input, or second submission
  path is introduced.
- Focused unit tests, production Vite browser interaction, screenshot review,
  Overlay typecheck/build, native Cargo check, and second diff review pass.

### Hard constraints

- Preserve all concurrent worktree changes and existing merge conflicts.
- Do not restart, reload, close, or otherwise disturb the running OpenCorvus or
  Overlay.
- Playwright runs through Node.js, never Bun.
- Do not filter private-use characters in `ChatComposer`.
- Do not update the conflicted spec indexes until their current owner resolves
  them.
- Delivery commits use the `dsw-33987` prefix and push to `legacy-remote` only when
  the existing merge state permits a safe task-owned commit.

### Disk sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-14-overlay-composer-ime-interruption-root-repair.md`
- `specs/records/2026-07/2026-07-23-overlay-goal-status-settings-macos-keyboard-repair.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ui/AutoGrowTextarea.tsx`
- `packages/overlay/src-tauri/Cargo.toml`
- the resolved Wry `WryWebViewParent::keyDown:` implementation
- focused Composer source and Node browser tests.

### Whole-repository grep evidence

- `ChatComposer.handleKeyDown` is the only Composer Enter-to-send owner. Its
  current `event.isComposing` check is the only input-method keyboard guard.
- `AutoGrowTextarea` is the one native textarea primitive and already avoids
  rewriting equal native composition values.
- `composer-mention-ui.test.ts` is the focused source contract; the production
  Vite IME interaction lives in
  `titlebar-toolbar-toggle-browser.test.ts`.
- `AppDialogHost` and `TitlebarMenubar` have independent Enter/menu semantics
  and remain unchanged.
- `packages/overlay/src-tauri/Cargo.toml` is the only Cargo patch owner. It pins
  Wry pull request 1711 commit
  `bcd149377f2a00ce5edb03729e1c585d79d2f0b0`.
- `macos-keyboard-forwarding.test.ts` is the only source test for that pin and
  already forbids moving private-use glyph repair into Composer.
- No product code intentionally inserts AppKit private-use function-key
  characters.

### External evidence

- WebKit bug 165004 records that macOS sends the Enter `keydown` which accepts
  Input Method Editor (IME) text after `compositionend`, with
  `isComposing=false`, and identifies key code 229 as the reliable processing
  signal for that event.
- Wry pull request 1711 remains unmerged. Its pinned implementation sends
  unhandled events to the parent `NSView.interpretKeyEvents` based on the
  unverified assumption that the parent cannot become a text input client.
- The user's physical macOS result is direct counter-evidence to that
  assumption: function keys under the no-candidate Pinyin path become
  unreadable text after this override was introduced.

### Independent agent feedback

None. The user did not request sub-agents or parallel audits, and the active
delegation policy forbids spawning them for this task.

## Causal chain

1. The user presses Enter to accept Pinyin text.
2. macOS WebKit emits `compositionend` before the corresponding `keydown`.
3. `ChatComposer` sees `isComposing=false`, prevents the native Enter, and
   requests form submission, so the same physical key both commits text and
   starts a session.
4. Separately, the pinned unmerged Wry override receives function keys which
   the WebView did not consume and calls `interpretKeyEvents` on its parent
   view.
5. Under the reported no-candidate Pinyin path, that native interpretation
   reaches the text system as AppKit private-use function-key glyphs, producing
   unreadable Composer input.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `ChatComposer.handleKeyDown` | Replace the incomplete `isComposing` check with one shared event-semantic helper; preserve mention and ordinary Enter behavior. |
| Composer keyboard helper | Treat standards-based `isComposing` and WebKit's process key code 229 as the same IME-owned event. |
| `AutoGrowTextarea` / scoped draft | Preserve unchanged as the single native text and draft projection. |
| Wry Cargo patch | Remove the unmerged parent-view override and resolve the released Wry crate as the single native dependency source. |
| Composer private-use text | Keep absent; do not hide native corruption with a character scrubber. |
| Focused tests | Add executable helper cases and production-bundle browser evidence for one ignored IME Enter followed by one ordinary Enter submission request. |

## Implementation plan

1. Add the shared Composer keyboard semantic and focused unit coverage.
2. Use it in the one `ChatComposer.handleKeyDown` submission owner.
3. Extend the existing production Vite IME browser scenario to observe
   `requestSubmit`: key code 229 requests zero submissions, then ordinary Enter
   requests exactly one.
4. Remove the Wry Git patch and regenerate Cargo lock resolution with Cargo.
5. Run focused tests, Node-launched browser interaction with screenshot review,
   Overlay typecheck/build, native Cargo check, and diff checks.
6. Re-read every task-owned diff. Commit and push only if the pre-existing merge
   conflicts no longer prevent safe delivery.

## Progress

- [x] Recall, prior decisions, call sites, native dependency source, and
  external WebKit/Wry evidence inspected.
- [x] Implementation and regression tests.
- [x] Vite browser and native build verification.
- [x] Second review.
- [x] Delivery commit and legacy remote push.

## Verification result

- Focused Composer/macOS tests passed: 13 tests, 130 assertions, 0 failures.
- Overlay TypeScript typecheck and localization checks passed.
- The production Vite build passed after transforming 7,047 modules.
- The Node-launched production browser fixture passed both scenarios. Its IME
  projection recorded zero programmatic textarea writes, value `你好`, zero
  submission requests for the WebKit process-key Enter, and exactly one request
  for the following ordinary Enter.
- The production browser screenshot
  `.scratch/composer-ime-complete.png` was reviewed at original resolution. It
  shows the intact Chinese value in the normal Composer layout with no
  duplicated or corrupted text.
- The first browser attempt exposed stale fixture inputs after concurrent
  Work Ledger and Chat-capability contract changes. The fixture now uses a
  schema-valid hyphenated Mission ID, complete strict row fields, and the
  required read-only Chat capability response; product validation was not
  weakened.
- Native `cargo check --locked` initially reached the build script and reported
  the missing embedded Overlay Server payload. The canonical
  `bun run --cwd packages/opencorvus build --overlay-server --single` command
  produced the stamped Darwin ARM64 payload; the unchanged Cargo check then
  passed with released Wry 0.55.1.
- Historical documentation health passed 22 tests, and task-owned
  `git diff --check` passed.
- Product and test changes were committed as `af9779d391` and pushed to
  `legacy-remote/v0.0.20beta`; the normal pre-push SDK, AI runtime, package
  typecheck, route, API documentation, localization, and secret-scan hooks all
  passed.

## Second review

The final implementation keeps one Composer submission owner and one native
textarea. The keyboard helper classifies only the standards composition signal
and WebKit's documented process key code; it does not retain mutable
composition state or delay submission. The Wry Git override is deleted rather
than supplemented, so Cargo resolves one released source. No AppKit private-use
character filter, synthetic key remapping, fallback text path, second draft, or
process restart was introduced.
