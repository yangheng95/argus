# review-grep — M8.C audit checklist

Manual companion to `script/audit-bundle.ts` (which automates the
release-bundle side). Run before each VSIX release and after any
new `apiJson` / `host.native` / `host.openStream` call site lands.

Goal: catch silent-fallback patterns that the type system does NOT
catch (CLAUDE.md §一-7, §二-7, §二-8).

The greps are listed in the order of decreasing strictness — start
with the easy automatable ones, then walk the human-judgement ones.

## 1. Automated (audit-bundle.ts)

These are enforced as unit tests in `test/audit-bundle.test.ts`; a
break here fails the test suite.

```sh
# Live process.env.OPENCORVUS_DEV_* read in the production extension
# bundle. esbuild's `define` should rewrite to undefined and DCE the
# branch (plan §17). Object-key writes (manager.ts spawn env strip)
# are intentional and excluded.
rg "process\s*\.\s*env\s*(?:\.\s*OPENCORVUS_DEV_|\[\s*[\"']OPENCORVUS_DEV_)" packages/vscode-extension/dist

# Hard-coded sidecar address in the extension bundle. Webview never
# talks to 127.0.0.1 directly (plan §19.2.1).
rg "127\.0\.0\.1" packages/vscode-extension/dist

# Fallback / 兜底 / 降级 markers in the EXTENSION bundle (overlay
# bundle is allowed to carry these — different profile, see
# audit-bundle.ts MEDIA_UI_PATTERNS).
rg "\b(fallback|FALLBACK|Fallback)\b|兜底|降级" packages/vscode-extension/dist
```

## 2. Source-level (human review)

### 2.1 Silent error swallowing (`.catch(() => …)`)

```sh
rg "\.catch\(\(\)\s*=>" packages/vscode-extension/src packages/overlay/src/services
```

Each match must fall into one of these legitimate categories:

| Site                                                                                               | Justification                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vscode-extension/src/transport/bridge.ts:418` `res.text().catch(() => "")`                        | Recovering an HTTP error body that itself failed to read — the response status is already conveyed; an empty body is the best signal we have. NOT a fallback for a missing main path.                                                    |
| `vscode-extension/src/sidecar/manager.ts:189` `fetch(/shutdown).catch(() => undefined)`            | Pre-kill graceful nudge: even if the HTTP attempt fails (server unresponsive), we escalate to TerminateProcess in the next step. The catch silences a _redundant_ attempt, not a primary code path.                                      |
| `overlay/src/services/connection.ts:119` `host.native({server.restart}).catch(() => undefined)`    | Host-capability absent (vscode webview has no managed local server). Returning null is the documented "this host doesn't own a local server" signal — the caller already gates on `hostOwnsLocalServer()`. NOT a runtime-error fallback. |
| `overlay/src/services/init.ts:211` `apiJson("config/prompt").catch(() => [])`                      | Pre-existing pre-M3 path. plan §5.4 lists this for cleanup; not introduced by this work.                                                                                                                                                 |
| `overlay/src/services/mcp.ts:12, 19` `apiJson(disconnect).catch(() => undefined)`                  | Pre-existing. Same §5.4 followup.                                                                                                                                                                                                        |
| `overlay/src/services/workspace.ts:570` `host.native({createDir}).catch(() => undefined)`          | Same as connection.ts — translates host-capability absence into a `null` that the caller surfaces as a clear i18n error message ("cwd.create_unavailable"). NOT swallowing a real error silently.                                        |
| `overlay/src/services/events.ts:468` `loadConfigInfo().catch(() => {})`                            | Pre-existing pre-M3 path. plan §5.4 followup.                                                                                                                                                                                            |
| `overlay/src/services/extensions.ts:58` `apiJson("skill/installed").catch(() => apiJson("skill"))` | Pre-existing dual-route behaviour from before host capability negotiation. plan §5.4 cleanup item.                                                                                                                                       |

**Rule of thumb**: if the catch maps to "host doesn't support this capability" or "second redundant attempt failed", it is OK and must include a comment justifying it. Anything that catches a _primary_ network / business error and substitutes a synthetic value is a §一-7 violation.

### 2.2 Default empty array bias (`?? []`)

```sh
rg "\?\?\s*\[\]" packages/vscode-extension/src packages/overlay/src/services
```

(Currently 0 matches — empty-array defaulting tends to mask 4xx / 5xx as "no data", so we keep the file clean.)

### 2.3 Direct fetch / EventSource outside transport implementations

```sh
rg "\bfetch\(|new EventSource" packages/overlay/src/services packages/overlay/src/store packages/overlay/src/components packages/overlay/src/utils packages/overlay/src/main.tsx
```

Allowed call sites (verified after each invocation):

- `services/api.ts` `fetchResourceAsObjectUrl()` — `fetch(raw)` for `data:` / `blob:` / `http(s):` URLs that the transport cannot proxy.
- `services/tauri-transport.ts` — implementation of HostTransport for the Tauri host. The ONLY place native `fetch` and `EventSource` should live.
- `utils/i18n.ts` `fetch("i18n/<locale>.json")` — static asset under the webview origin / Tauri origin; legitimately served by the webview resource server, NOT proxied through HostTransport.

Any new direct `fetch()` outside these three sites is a §二-8 violation; refactor through `apiJson` / `apiRequest` / `host.openStream`.

### 2.4 fallback / 兜底 / 降级 markers in source

```sh
rg "\b(fallback|FALLBACK|Fallback)\b|兜底|降级|默认值" packages/vscode-extension/src packages/overlay/src
```

Comments mentioning these words for _historical context_ (e.g. "pre-M3 used to fall back to …, now goes through transport") are allowed. Code that _implements_ a fallback is not.

## 3. Releases

Run `bun run script/audit-bundle.ts` after every `bun run build --production`. CI invokes the audit through `bun test` (see test/audit-bundle.test.ts) so the gate is enforced on every push.

Last clean scan: 2026-04-29 against `dist/extension.cjs` 17.4 KB + 6 webview asset files — 0 violations.
