# Overlay Browser MCP Self-Contained Runtime

## Problem

Packaged overlay starts the embedded `opencorvus-overlay-server` executable and
the panel cold-start calls `/mcp`. Since 2026-06-01 the default config
materializes the built-in `browser` MCP. In packaged mode that command is:

```text
opencorvus.exe mcp browser
```

`mcp browser` then runs `BrowserMCPNodeLauncher.serveStdio()`, which resolves the
browser MCP JavaScript bundle but spawns `node.exe` from the host PATH. A clean
Windows machine without Node therefore cannot initialize browser MCP during
overlay startup.

## Callpoint Audit

`rg -n "browser-mcp-node|node.exe|OPENCORVUS_BROWSER_MCP_NODE|OPENCORVUS_EMBED_PATH|embedded_sidecar|include_bytes|sidecar|bundle.resources|build-overlay|build-docker|OPENCORVUS_BUN_RUNTIME_DIR|runtimeName|setup-node|node-version" packages/opencorvus packages/overlay .github package.json bun.lock`

Relevant callpoints:

| Surface | Path | Decision |
| --- | --- | --- |
| Built-in MCP command | `packages/opencorvus/src/mcp/browser/builtin.ts` | Keep packaged command as `opencorvus mcp browser`; fix the runtime it uses. |
| Browser MCP launcher | `packages/opencorvus/src/mcp/browser/node-launcher.ts` | Replace host PATH Node lookup with packaged Node runtime resolution. |
| MCP command dispatch | `packages/opencorvus/src/cli/cmd/mcp.ts` | Keep dispatch to launcher; no front-end or route skip. |
| Opencorvus artifact build | `packages/opencorvus/script/build.ts`, `build.local.ts`, `build-artifact.ts` | Build `browser-mcp-node/stdio.mjs` and copy a packaged Node runtime into the same directory. |
| Overlay embedded sidecar | `packages/overlay/src-tauri/build.rs`, `src-tauri/src/main.rs` | Change from embedding one exe to embedding a sidecar payload manifest: `opencorvus` plus `browser-mcp-node/*`. |
| Overlay build scripts | `packages/overlay/script/build.ts`, `build-overlay.ts`, `build-docker.ts` | Pass the server artifact directory to Tauri via `OPENCORVUS_EMBED_PATH`, not a single exe. |
| CI Node availability | `.github/actions/setup-bun/action.yml` | CI already installs Node 22; build scripts can require a target-local Node executable when packaging browser MCP. |

## Final Design

1. `browser-mcp-node` is the single source for packaged browser MCP runtime.
   It contains both `stdio.mjs` and a Node executable named `node.exe` on
   Windows or `node` on POSIX.
2. `BrowserMCPNodeLauncher` resolves Node only from
   `path.dirname(process.execPath)/browser-mcp-node/<nodeName>`. It does not
   fall back to `PATH` and does not read `OPENCORVUS_BROWSER_MCP_NODE` in
   packaged mode.
3. Source/dev Bun execution can still use `bun src/mcp/browser/node-stdio.ts`;
   that is the source-development path, not a packaged fallback.
4. Overlay embeds the server artifact directory and extracts files into a
   stamped directory under app-local-data. `server_path()` points at the
   extracted `opencorvus` file. The extracted sibling `browser-mcp-node`
   directory is therefore discoverable through `process.execPath`.
5. Restore packaged overlay-server browser MCP default to enabled after the
   runtime is self-contained.

## Rejected Designs

| Design | Rejection |
| --- | --- |
| Permanently disable browser MCP in overlay-server | Gate over the real packaging defect. |
| Try packaged Node, then system `node.exe` | Fallback; hides missing artifact bugs. |
| Keep `OPENCORVUS_BROWSER_MCP_NODE` as packaged override | Double source for production runtime. |
| Frontend skips `/mcp` or hides browser MCP failure | UI gate; backend remains broken. |
| Force `OPENCORVUS_BROWSER_MCP_DIRECT_BUN=1` | Already tested: compiled overlay-server closes the MCP connection. |

## Tests

- Build artifact unit test: overlay-server default browser MCP enabled.
- Browser launcher unit test: packaged runtime resolves `browser-mcp-node/node.exe`
  and never uses PATH.
- Config test: remove temporary packaged overlay-server default-disabled test.
- Overlay Rust tests: embedded payload file names include server and
  `browser-mcp-node` entries.
- Packaged runtime verification on Windows: clear `OPENCORVUS_BROWSER_MCP_NODE`
  to an invalid path and use a PATH without Node; `/mcp` must connect browser
  instead of returning disabled or Node-not-found.

## Independent Review Feedback

Codex independent review on 2026-06-02 found three follow-up gaps:

| Finding | Decision |
| --- | --- |
| Linux musl build copies no Node runtime because the host/target check only accepted targets with no `abi`. | Add a host runtime check that distinguishes glibc and musl. A target may use PATH Node only when OS, CPU arch, and Linux libc match; otherwise the build must receive `OPENCORVUS_BROWSER_MCP_NODE_BUILD_PATH`. |
| Docker overlay build still mounted `dist/opencorvus-linux-*` instead of the overlay-server artifact directory. | Move overlay artifact naming into one helper and use it from every overlay build script, including Docker. |
| Tests did not cover musl host matching, Docker artifact naming, or embedded browser MCP sidecar entries. | Add unit coverage for host runtime matching and overlay artifact names, and strengthen the Rust payload test to assert server, `stdio.mjs`, and Node executable entries when a payload is embedded. |

The same review noted that Cargo reports macOS as `macos` while opencorvus
artifacts use `darwin`; the build script default path must map `macos` to
`darwin` so direct Tauri builds do not look in a second artifact directory.
