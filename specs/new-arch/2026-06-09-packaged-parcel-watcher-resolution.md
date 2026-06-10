# Packaged Parcel Watcher Resolution

## Incident

Tauri overlay reported a health probe failure for `http://127.0.0.1:7878`. The sidecar log showed the server first listening, then later emitting:

```text
Cannot find module '@parcel/watcher-win32-x64' from 'C:\Users\hengu\AppData\Local\ai.opencorvus.overlay\embedded\sidecar-4128-ac2423db43caf29c\package.json'
```

Manual probe after the error returned connection refused and PID 33152 was gone.

## Evidence

The extracted embedded sidecar from the failing build contained the package:

```text
node_modules/@parcel/watcher/node_modules/@parcel/watcher-win32-x64/package.json
```

It does not contain:

```text
node_modules/@parcel/watcher-win32-x64/package.json
```

That shape works only when resolution starts from `@parcel/watcher`'s package context. `FileWatcher` and `Capability` bypassed that context by calling `requireRuntimePackage("@parcel/watcher-${platform}-${arch}")`, which creates a require rooted at the embedded executable directory.

The runtime package copier now emits package dependencies into the packaged `node_modules` root:

```text
node_modules/@parcel/watcher-win32-x64/package.json
```

That root-level copy shape matches Node package resolution for multiple shared runtime graphs instead of preserving a package-owner-specific nested tree.

## Call Point Inventory

| Call point                                                               | Existing behavior                                                                                                   | Decision                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/file/watcher.ts`                                | Loads `@parcel/watcher/wrapper`, then loads the native package name from the packaged root require.                 | Replace with `requireRuntimePackage("@parcel/watcher")` so the package entrypoint resolves its own optional native dependency. |
| `packages/opencorvus/src/platform/capability.ts`                         | Probes the native package name from the packaged root require.                                                      | Probe `@parcel/watcher` entrypoint and keep the native package name only as diagnostic detail.                                 |
| `packages/opencorvus/script/build-artifact.ts`                           | Externalizes and copies `@parcel/watcher` plus the platform native optional package into packaged runtime modules.  | Keep the package set.                                                                                                          |
| `packages/opencorvus/script/build-runtime-node-modules.ts`               | Copies package owner dependencies nested under their owner.                                                         | Flatten dependencies into the packaged runtime `node_modules` root.                                                            |
| `packages/opencorvus/test/script/build-artifact.test.ts`                 | Asserts nested copy shape but not runtime package entrypoint loading.                                               | Assert root-level dependency copy shape and current-platform package entrypoint loading.                                       |
| `packages/opencorvus/test/script/packaged-overlay-server-health.test.ts` | Verifies packaged server health only; it does not force file watcher init.                                          | Keep as broad smoke coverage.                                                                                                  |

## Design

Use the upstream package entrypoint as the single source for binding resolution. The package already knows the platform naming convention, Linux libc suffix, and local build behavior. OpenCorvus should ensure the package graph is present in the packaged runtime `node_modules` root and require the package through the packaged-root resolver.

No compatibility path is added. If the native optional dependency is missing, `@parcel/watcher` throws the authoritative package error and capability reporting surfaces it.

## Validation

- Targeted unit test for copied runtime node modules resolving `@parcel/watcher` from the package entrypoint.
- Existing build artifact tests for root-level package copy shape.
- Rebuild or package smoke can validate sidecar health after the code fix.
