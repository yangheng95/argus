# Overlay origin-only server URL migration

## Problem

When the overlay is served from a public prefix such as:

```text
https://mirror.myhexin.com/opencorvus/ui/
```

the API server URL must be:

```text
https://mirror.myhexin.com/opencorvus
```

The current browser settings migration already computes that default, but it does not migrate the earlier persisted origin-only value:

```text
https://mirror.myhexin.com
```

That stale value sends requests to `https://mirror.myhexin.com/coding/...` instead of `https://mirror.myhexin.com/opencorvus/coding/...`.

## Impact analysis

| Surface | Call points checked | Decision |
| --- | --- | --- |
| Default server URL | `packages/overlay/src/services/default-server.ts` | Keep `serverUrlFromOverlayLocation()` as the source of the current public-prefix default. Add an explicit helper for the previous origin-only browser default so settings migration can identify stale persisted values. |
| Browser settings load | `packages/overlay/src/services/overlay-settings-storage.ts` | Migrate origin-only same-origin values only when `autoServer` is not explicitly false and the current default has a path prefix. |
| Browser settings save | `packages/overlay/src/services/overlay-settings-storage.ts` | No change. Persist the active `settingsStore.serverUrl` after migration. |
| Settings store | `packages/overlay/src/store/settings.ts` | No change. Store sanitization should not know URL-prefix history. |
| API request URL building | `packages/overlay/src/services/api.ts` | No change. `apiUrl()` already appends paths to a prefixed `serverUrl`. |
| Host transport fetch/SSE | `packages/overlay/src/services/tauri-transport.ts` | No change. Requests and streams both use `apiUrlFromState()`. |
| VS Code transport | `packages/overlay/src/services/vscode-transport.ts` | No change. VS Code host settings are not browser localStorage and should not inherit browser origin-prefix migration. |
| Directory injection | `packages/transport-protocol/src/index.ts`, `packages/overlay/test/api-directory-injection.test.ts` | No change. Route policy decides project directory injection only; it is unrelated to public base path. |
| Server routes | `packages/opencorvus/src/server/server.ts`, `packages/opencorvus/src/server/routes/coding.ts` | No change. `/coding/sessions` is present and project-scoped; the observed 404 is caused by the wrong public prefix. |
| Resources | `resolveResourceUrl()` and `fetchResourceAsObjectUrl()` in `packages/overlay/src/services/api.ts` | Covered by the same `serverUrl`; no separate resource prefix patch. |

## Required regressions

1. `serverUrlFromOverlayLocation("/opencorvus/ui/")` returns `https://host/opencorvus`.
2. Browser settings migrate old local default `http://127.0.0.1:7878` to the prefixed public default.
3. Browser settings migrate old same-origin origin-only default `https://host` to `https://host/opencorvus` when `autoServer` is true or absent.
4. Browser settings preserve origin-only `https://host` when `autoServer=false`, because that is an explicit custom server.
5. Browser settings preserve a different explicit custom API origin.
6. After migrated settings are applied to the API client, `apiUrl("coding/sessions")` resolves under the public prefix, not the origin root.

## Non-goals

- Do not add per-route prefix rules.
- Do not add fallback probing between origin-root and prefixed-root.
- Do not alter server route mounting.
- Do not change directory injection policy.
