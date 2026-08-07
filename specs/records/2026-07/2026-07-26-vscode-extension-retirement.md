# VS Code Extension Retirement — 2026-07-26

## Status

Implementation planned. This record destructively retires the VS Code Extension
product direction; no disabled package, compatibility transport, release
workflow, or dormant protocol path remains.

## Recall

### User request

- Pause the ongoing quality audit.
- Completely remove the VS Code Extension because this product direction will
  not continue.

### Acceptance criteria

- `packages/vscode-extension` and its VSIX build workflow no longer exist.
- The Overlay has only Tauri desktop and standalone browser hosts. It does not
  detect `acquireVsCodeApi`, select a VS Code transport, subscribe to
  extension-driven UI commands, or consume a VS Code host-theme handshake.
- The shared transport protocol no longer contains Extension/Webview
  `postMessage` envelopes, protocol-version negotiation, host-theme messages,
  or the `composer.attach` extension command payload.
- The `opencorvus sidecar` command and its extension-only tests are removed;
  the Tauri embedded server/sidecar packaging remains untouched.
- Version sync, release workflows, docs health, lockfile workspaces, dead-code
  checks, and tests contain no live extension package reference.
- External-editor launch support for Visual Studio Code and the optional
  `vscode-dark` visual theme remain. They are independent desktop features,
  not the retired Extension host.
- Historical records may describe the retired implementation as history, but
  active architecture cannot present it as a supported host.

### Hard constraints

- Preserve all unrelated staged, unstaged, untracked, and concurrent work.
- The current `cli/cmd/sidecar.ts` file has parallel edits; delete the complete
  extension-only command rather than attempting to merge it into another host.
- Do not remove generic ACP editor integration, Visual Studio Code external
  launcher detection, CodeMirror language support, the `vscode-dark` palette,
  Tauri's embedded server, or the shared transport protocol package itself.
- Do not keep a feature flag, alias, fallback, compatibility reader, ignored
  build job, or tombstone implementation.
- Do not restart or interfere with the running OpenCorvus/Overlay process.

### Materials read

- `AGENTS.md`
- root workspace, lockfile, version synchronization, release workflow, package
  and document-health contracts
- the complete tracked file inventory under `packages/vscode-extension`
- Overlay host transport/runtime, host theme, Composer attachment command,
  initialization, settings/theme, connection and focused tests
- shared transport protocol and its contract tests
- OpenCorvus CLI registration, extension-only sidecar command/tests, server
  comments, and active architecture configuration record
- full-repository searches listed below

### Whole-repository grep

| Surface | Call points | Retirement decision |
| --- | --- | --- |
| `packages/vscode-extension` | 47 tracked package, source, script, E2E, test and docs files | Delete the package directory. |
| VSIX workflow | `.github/workflows/build-vscode-extension.yml`, release/document-health tests | Delete workflow and its positive assertions. |
| Extension Overlay transport | `vscode-transport.ts`, `host-transport-runtime.ts`, host transport comments/types, four transport-focused tests | Delete implementation/tests; runtime selects Tauri or browser only; `HostKind` drops `vscode`. |
| VS Code host theme | `host-theme.ts`, `host-theme-handshake.ts`, settings/theme branches, init subscription, focused tests | Delete handshake and host branch. Keep `vscode-dark` as an ordinary user-selected palette. |
| `composer.attach` UI command | `composer-attach.ts`, validator, init subscription, protocol payload, integration tests, `subscribeUiCommand` interface and Tauri no-op | Delete the extension-driven command path. Keep manual file/folder/image attachment UI and its shared capacity/acceptance helpers. |
| postMessage envelopes | `PROTOCOL_VERSION`, Webview/Extension message types and validators in `transport-protocol`, contract tests | Delete extension-only protocol region and tests; keep shared route, attachment, settings, stream-lifecycle, native-command, and presentation contracts. |
| CLI sidecar | `src/cli/cmd/sidecar.ts`, CLI registration, sidecar smoke/chaos/contention/handshake helpers, shutdown source assertions | Delete extension-only command/tests. Preserve `serve`, `ManagedServerOwnership`, and Tauri embedded-server packaging. |
| version/release/docs | `script/sync-version.ts`, sync-version tests, release-overlay tests, document-health tests, inactivity acceptance fixture, lockfile workspace entry | Remove Extension entries and regenerate `bun.lock`. |
| active architecture | `specs/current/architecture/05-config.md` | Remove VS Code host persistence/loading claims; Browser and Tauri remain. |
| editor/theme lookalikes | IDE detection, workspace launcher, ACP docs, `vscode-dark.css`, VS Code-style UI historical records | Preserve: these are not the Extension product. |

### Independent-agent feedback

The independent quality-audit agents were deliberately paused when the user
changed priority. The primary agent performed the destructive target resolution
and call-point sweep. No implementation task was delegated.

## Causal boundary

Deleting only the extension package would leave a dormant second host in the
Overlay, an extension-only CLI lifecycle, unused message envelopes, and release
checks that continue to define the retired direction. That is not complete
retirement; it is dead compatibility code.

The root cut is the host boundary:

```
Tauri desktop ─┐
               ├─ HostTransport ─ Overlay product behavior
Browser/Vite ──┘
```

The VS Code Extension host, its `postMessage` bridge, host-theme channel,
extension-driven Composer command and managed CLI sidecar are removed together.
Shared contracts that are still consumed by Tauri/browser stay in
`@opencorvus-ai/transport-protocol`.

## Implementation plan

1. Delete the complete tracked Extension package and VSIX workflow.
2. Remove the Overlay VS Code transport, theme handshake and extension-driven
   Composer command; reduce the host runtime/interface to Tauri/browser.
3. Delete extension-only protocol types/validators and their focused tests.
4. Delete the extension-only CLI sidecar command/tests and unregister it.
5. Remove version/release/document-health/acceptance references, update active
   architecture, and regenerate the lockfile.
6. Run a second full-repository scan that distinguishes retained editor/theme
   terminology from forbidden live Extension-host references.
7. Run focused transport, Overlay, CLI, document, typecheck, build, dead-code,
   API, version and hook checks.
8. Commit only retirement-owned paths and push to `legacy-remote` through normal
   hooks.
