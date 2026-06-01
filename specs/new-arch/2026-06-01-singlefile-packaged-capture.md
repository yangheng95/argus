# SingleFile packaged capture fix

## Problem

`webpage_extract` writes `singlefile.html` through `captureSingleFileHtml`.
The current implementation resolves `single-file-cli` from `node_modules/.bin`
and spawns it as an external process. Local development works because the
workspace has `packages/opencorvus/node_modules/.bin/single-file.exe`, but the
Bun-compiled release artifact only contains `opencorvus`, the Windows process
supervisor, and the browser MCP node bundle. The packaged runtime therefore
cannot resolve the external SingleFile executable.

## Call sites

| Symbol | Path | Decision |
| --- | --- | --- |
| `captureSingleFileHtml` | `packages/opencorvus/src/mirror/tools/webpage-extract.ts` | Keep API and return contract. |
| `resolveSingleFileExecutable` | `packages/opencorvus/src/web-clone/singlefile-capture.ts` | Delete; external CLI lookup is the broken runtime dependency. |
| `single-file-cli` dependency | `packages/opencorvus/package.json` | Keep as the single source dependency, but call its API in-process. |
| `artifactExternalModules` | `packages/opencorvus/script/build-artifact.ts` | Leave unchanged unless build proves SingleFile needs an external. |

## Implementation

Call `single-file-cli/single-file-cli-api.js` directly from
`captureSingleFileHtml`. Preserve existing capture options, output file
validation, abort behavior, and the `command` evidence shape as a synthetic
API descriptor instead of an executable path.

This avoids a parallel packaged helper and keeps SingleFile code in the
compiled dependency graph.

## Verification

- Unit test that the capture module no longer contains `node_modules/.bin` or
  `Bun.spawn` for SingleFile.
- Unit test that `single-file-cli` exposes the API entrypoint used by the
  capture module.
- Typecheck the package.
