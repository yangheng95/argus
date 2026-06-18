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

| Site                                                                                    | Justification                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vscode-extension/src/transport/bridge.ts:586` `res.text().catch(() => "")`             | Recovering an HTTP error body that itself failed to read — the response status is already conveyed; an empty body is the best signal we have. NOT a fallback for a missing main path.               |
| `vscode-extension/src/sidecar/manager.ts:210` `fetch(/shutdown).catch(() => undefined)` | Pre-kill graceful nudge: even if the HTTP attempt fails (server unresponsive), the sidecar manager escalates to process termination in the next step. The catch silences a redundant shutdown hint. |

Current overlay service scan is clean:

```sh
rg "\.catch\(\(\)\s*=>" packages/overlay/src/services
# 0 matches
```

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

Historical comments are allowed only when they describe behavior that has been
removed or rejected. A comment that says a pre-M3 / legacy path is still kept
for later cleanup is not allowed in live source or release-review docs.

## 3. Releases

Run `bun run script/audit-bundle.ts` after every `bun run build --production`. CI invokes the audit through `bun test` (see test/audit-bundle.test.ts) so the gate is enforced on every push.

Last source-level checklist refresh: 2026-06-17. Overlay services have 0
silent `.catch(() => ...)` matches; the only source matches are the two
audited VS Code extension release/diagnostic cases listed above.
