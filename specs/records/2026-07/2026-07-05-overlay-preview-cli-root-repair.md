# Overlay Preview And Coding CLI Root Repair

## Recall

### User Request

The user reported two live overlay regressions in the current Windows desktop
environment:

- browser preview fails with `Native browser preview failed.` and
  `a webview with label 'browser-preview-live-webview' already exists`;
- the workspace coding CLI launcher cannot be used and Windows shows a native
  `\\` not found dialog instead of opening the selected coding CLI.

### Acceptance Criteria

- Explain each failure from real source and runtime evidence instead of guessing.
- Do not add fallback preview ownership, iframe preview, query override, local
  signal override, or double-source browser state.
- Browser preview must reopen and resync without surfacing duplicate-label
  native webview failures.
- The repair must preserve task-scoped browser-preview target and evidence as
  the only preview URL/evidence authority.
- Coding CLI analysis must prove whether the fault is command discovery,
  directory ownership, terminal-profile resolution, or actual Windows launcher
  quoting before any product change is made.
- Every landed code change must add or update focused tests.
- Final verification must include real browser/UI evidence for the preview
  surface and focused CLI verification; desktop browser tests must run through
  Node, not Bun.

### Hard Constraints

- `AGENTS.md` forbids fallback logic, gate-style workarounds, blind patches,
  `git reset`, and disturbing existing user OpenCorvus / overlay processes.
- The repository is already heavily dirty; unrelated user edits must remain
  untouched.
- Tauri child-webview lifecycle and overlay toolbar launchers are single-source
  surfaces; do not add parallel code paths.
- If the coding CLI root cause is not proven, do not ship a speculative fix.

### Disk Records Read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-browser-preview-native-webview-root-repair.md`
- `specs/records/2026-07/2026-07-04-architecture-issue-subagent-investigation.md`

### Whole-Repository Search Evidence

- `rg -n "browser-preview-live-webview|Native browser preview failed|browserPreview\\.sync|browserPreview\\.navigate|browserPreview\\.close|overlay_browser_preview_sync|overlay_browser_preview_close" packages/overlay packages/opencorvus specs`
- `rg -n "coding/cli/profiles|coding/cli/open|WorkspaceCodingCliLaunchers|SystemTerminal|terminalProfileID|openCommand|cmd.exe|powershell.exe" packages/overlay packages/opencorvus`
- `rg -n "default_profile_id|powershell|cmd.exe|git-bash" .opencorvus -g "*.jsonc"`
- `rg -n "pub fn add_child|pub fn get_webview|pub fn hide|pub fn show|pub fn close" C:/Users/chuan/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.1 -g "*.rs"`

### Independent Feedback

No independent sub-agent feedback was used. The current tool policy only allows
sub-agent spawning when the user explicitly asks for it, so this repair uses
local source review plus focused runtime verification.

## Current Evidence

### Browser Preview

| Area | Evidence | Meaning |
| --- | --- | --- |
| User screenshot | Native preview error shows `a webview with label 'browser-preview-live-webview' already exists`. | The failure is inside Tauri child-webview creation, not backend target resolution. |
| Overlay panel lifecycle | `packages/overlay/src/components/BrowserPreviewPanel.tsx` calls `requestNativePreviewClose(false)` on task-scope reset, native-scope changes, candidate changes, cleanup, and sync failure. | The UI frequently tears down and recreates the same native surface label. |
| Tauri sync path | `packages/overlay/src-tauri/src/main.rs` `overlay_browser_preview_sync` first calls `app.get_webview(label)` and otherwise `window.add_child(builder, ...)`. | Reopen relies on re-creating the child webview when the manager lookup returns `None`. |
| Tauri close path | `packages/overlay/src-tauri/src/main.rs` `overlay_browser_preview_close` currently calls `webview.close()`. | The current close path destroys the labeled child webview instead of hiding/reusing it. |
| Tauri internals | `tauri-2.11.1/src/webview/mod.rs` removes the manager entry in `Webview::close()`, while `hide()` / `show()` keep the same webview handle alive. | A fast close-then-resync can race: manager lookup misses while the native runtime still rejects duplicate label creation. |

### Coding CLI

| Area | Evidence | Meaning |
| --- | --- | --- |
| Project terminal config | `.opencorvus/opencorvus.jsonc` declares absolute `powershell`, `cmd`, and `git-bash` terminal profiles with `default_profile_id = "powershell"`. | The checked-in project config is not obviously malformed. |
| Current environment | `ComSpec=C:\WINDOWS\system32\cmd.exe`; no overriding `OPENCORVUS_SYSTEM_TERMINAL_BIN` is set in the current shell. | The default terminal-app resolution path is normal in this shell. |
| Installed coding CLIs | `bun -e "import { CodingCli } ... CodingCli.list()"` returns `claude-code`, `codex`, and `copilot`. | Discovery itself works in the repository runtime. |
| Windows command build | `SystemTerminal.buildCommand(...)` for the current PowerShell + codex path produces `cmd.exe /d /s /c start "" /D "<cwd>" "powershell.exe" "-NoLogo" "-NoExit" "-Command" "& '<codex.cmd>'"`. | The repository's command builder appears syntactically correct for the checked shell/profile inputs. |
| Actual executable | `codex --version` succeeds in the current shell and `which('codex')` resolves to `%APPDATA%\\npm\\codex.CMD`. | The obvious "wrong executable chosen" failure is not yet proven in the current environment. |
| Direct shell control | Running `powershell.exe -NoLogo -Command "& '<marker.cmd>'"` directly from the current shell writes the marker files. | PowerShell itself can run the `.cmd` wrapper when launched from a normal interactive shell. |
| Detached launcher reproduction | A temporary marker `.cmd` launched through `child_process.spawn(..., { detached: true, stdio: "ignore" })` reproduces the failure for `cmd.exe /d /s /c start ...`, direct `powershell.exe -Command`, direct `powershell.exe -File`, and `cmd.exe /c` wrappers that in turn invoke PowerShell. | The live failure is in the Windows detached launcher strategy, not in coding CLI discovery, project cwd, or the codex binary itself. |
| Detached cmd control | The same detached `child_process.spawn(...)` does write the marker when it launches `cmd.exe /d /s /c <marker.cmd>` directly with no PowerShell hop and no `start`. | The failure surface narrows to the current Windows shell-window launch path rather than all detached child processes. |
| Windows quote proof | Direct `cmd.exe /d /s /k` launches fail when Node/libuv escapes the command string normally (`'\"...\"' is not recognized`), but the same command succeeds once `windowsVerbatimArguments: true` is enabled. | The broken branch is not just "detached"; libuv's default Windows escaping corrupts the command string that `cmd.exe` expects to parse. |
| PowerShell quote proof | Direct `powershell.exe -Command "& '<marker.cmd>'"` also succeeds once launched with `windowsVerbatimArguments: true`, while the current wrapped `start ... -NoExit -Command ...` shape stays broken. | PowerShell can execute the CLI wrapper correctly when it receives the intended argv directly instead of a doubly wrapped shell string. |
| `-NoExit` proof | `powershell.exe -NoExit -Command ...` remained unreliable in the Node launcher experiments, while plain `-Command ...` ran the marker consistently. | For coding CLI launch, the CLI process itself must own the session; relying on wrapper-shell keep-open is the wrong abstraction for the Windows PowerShell path. |

## Root Cause Hypothesis

### Browser Preview

The duplicate-label error is a lifecycle race caused by destroying and
recreating a single labeled child webview too aggressively. The overlay calls
its "close" command in ordinary scope transitions and on sync errors. Tauri's
`Webview::close()` removes the manager entry immediately, but the native
runtime can still reject a same-label `add_child(...)` before destruction fully
settles. That matches the observed state: `get_webview(label)` returns `None`,
then `add_child(...)` fails because the label still exists natively.

The correct root repair direction is to keep one child webview instance per
overlay window and hide/show/navigate/resize it instead of repeatedly closing
and re-adding the same label.

### Coding CLI

The checked project config, CLI discovery, current `which('codex')`
resolution, and request payload flow are all sane. The real break is the
Windows launcher shape inside `SystemTerminal`: coding CLI launch used
`cmd.exe /c start ...` to wrap either a nested `cmd.exe /k ...` command string
or a nested `powershell.exe -NoExit -Command ...` command string, and then let
Node/libuv apply its default Windows argument escaping again. That produces two
layers of shell parsing and quote mutation before the target CLI wrapper ever
runs.

The marker experiments prove the causal chain:

- the old `start ...` wrapper path fails under `child_process.spawn(...)`;
- direct `cmd.exe /k ...` and direct `powershell.exe -Command ...` launches
  work once `windowsVerbatimArguments: true` is enabled;
- PowerShell `-NoExit` remains unreliable for this launch shape, so the coding
  CLI itself must be the foreground session owner on the PowerShell branch.

The landed repair is therefore single-source and direct: Windows coding CLI
launch no longer goes through `start`; `cmd` profiles receive one direct `/k`
command string with verbatim argv, PowerShell profiles receive one direct
`-Command` invocation with verbatim argv, and the existing shell-window
launcher remains untouched for ordinary "open terminal" behavior.

## Callpoint Inventory

| File | Current Role | Required Action |
| --- | --- | --- |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Browser preview panel lifecycle and native close requests. | Keep existing task/evidence authority; verify the Rust hide/reuse contract still matches the panel lifecycle. |
| `packages/overlay/src-tauri/src/main.rs` | Native child-webview sync / navigate / close commands. | Replace destructive close semantics with hide/reuse semantics and document the race reason. |
| `packages/overlay/test/browser-preview-panel.test.ts` | Source contract guard for the preview stack. | Update to assert hide/reuse semantics instead of destructive close. |
| `packages/opencorvus/src/system-terminal/index.ts` | Windows system-terminal command builder and launcher selection. | Replace the coding CLI `start ...` wrapper with direct shell launch specs that preserve Windows argv verbatim. |
| `packages/opencorvus/src/coding-cli/index.ts` | Coding CLI discovery and launch bridge. | Keep the bridge unchanged; it should continue to rely on `SystemTerminal.openCommand(...)` as the single launch entry. |
| `packages/opencorvus/test/system-terminal/external-launch.test.ts` | Windows build-command coverage for external launch. | Update expectations to the direct verbatim-launch contract and keep non-Windows launch behavior unchanged. |
| `packages/opencorvus/test/coding-cli/external-launch.test.ts` | Coding CLI launch contract coverage. | Update the Windows command-shape expectation to the direct verbatim-launch contract. |

## Verification

- `bun test packages/overlay/test/browser-preview-panel.test.ts --timeout 60000`
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml browser_preview -- --nocapture`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- `bun test packages/opencorvus/test/system-terminal/external-launch.test.ts packages/opencorvus/test/coding-cli/external-launch.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/workspace-terminal-open.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`

If a new spec record lands, update `specs/records/2026-07/README.md` and keep
`specs/README.md` consistent with the records index before final verification.
