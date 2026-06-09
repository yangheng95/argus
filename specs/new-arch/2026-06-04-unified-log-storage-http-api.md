# Unified Log Storage HTTP API

Date: 2026-06-04

## Problem

The server already writes structured Pino JSONL logs through `packages/opencorvus/src/util/log.ts`, and `GET /log/tail` reads the current process log file. The storage and read semantics are still split across call sites:

| Surface                                 | Current source                               | Decision                                                                                                          |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Log.init`                              | writes under `Global.Path.log` directly      | Replace direct route/file consumers with `Log.directory()` and `Log.read()` as the log module API.                |
| `Log.file()`                            | exposes current process log path             | Keep as current-file metadata, backed by the same directory.                                                      |
| `GET /log/tail`                         | reads `Log.file()` inline in `routes/app.ts` | Keep route behavior but delegate to `Log.read()` so it is not a second implementation.                            |
| `POST /log`                             | writes through `Log.create`                  | Keep unchanged.                                                                                                   |
| `Server.PROJECT_DIRECTORY_BYPASS_PATHS` | lists `/log` and `/log/tail`                 | Replace per-log-route listing with `/log` plus `/log/` prefix so new log read routes remain control-plane routes. |
| SDK/OpenAPI                             | generated from runtime routes                | Regenerate after route addition.                                                                                  |

## Implementation

1. Add `Log.directory()`, `Log.files()`, and `Log.read()` to make the log module the single API for log storage and retrieval.
2. Add `GET /log` for reading the current or named log file with `n` line limit.
3. Add `GET /log/files` for enumerating log files in the unified log directory.
4. Keep `GET /log/tail` as a wrapper over `Log.read()` because it already exists, but do not keep inline file-reading logic there.
5. Add tests for unified directory metadata, HTTP log retrieval, file listing, and OpenAPI directory-query exclusion.
