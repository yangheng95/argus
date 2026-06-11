# Overlay public prefix server URL

## Request

When the overlay is served from `https://myhexin.com/opencorvus/ui/`, the effective server URL must be `https://myhexin.com/opencorvus`, not `https://myhexin.com`.

## Call sites checked

| Surface | Current behavior | Required behavior |
| --- | --- | --- |
| `packages/overlay/src/services/default-server.ts` `serverUrlFromOverlayLocation` | Detects `/ui` but returns only `location.origin` | Preserve path segments before `/ui` as the API base prefix |
| `packages/overlay/src/services/overlay-settings-storage.ts` `loadBrowserOverlaySettings` | Uses `currentDefaultServer()` and migrates stale local defaults | Automatically migrates `127.0.0.1` to the prefixed public default |
| `packages/overlay/src/services/api.ts` `apiUrl` | Correctly appends API paths to a `serverUrl` that may include a prefix | No change |
| `packages/overlay/test/default-server-public-prefix.test.ts` | Locks the origin-only behavior | Update to assert prefix preservation |

## Decision

The URL prefix before `/ui` is part of the public backend base. Stripping it breaks reverse-proxy deployments where both UI and API are mounted below the same prefix.

No backend route change is needed; the frontend was computing the wrong base URL.
