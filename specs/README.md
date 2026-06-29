# Specs Storage Index

This directory is the single source for OpenCorvus specs and spec-adjacent task artifacts.

## Current Sources

| Surface | Source |
| --- | --- |
| Current architecture | `specs/current/architecture/README.md` |
| June 2026 task records | `specs/records/2026-06/` |
| 2026-06-29 database I/O incident | `specs/records/2026-06/2026-06-29-database-ioerr-runtime-boundary.md` |
| 2026-06-29 model image auto resize | `specs/records/2026-06/2026-06-29-model-image-input-auto-resize.md` |
| 2026-06-29 project delete unhandled rejection | `specs/records/2026-06/2026-06-29-project-delete-unhandled-rejection.md` |
| Prompt and product-reference artifacts | `specs/artifacts/` |
| Public product docs | `packages/web/src/content/docs/**` |
| API reference docs | `packages/web/src/content/docs/{reference/api,zh-cn/reference/api}.mdx` |

## Storage Model

| Location | Contents | Authority |
| --- | --- | --- |
| `specs/current/architecture/**` | Living architecture chapters and diagrams. | Current architecture source of truth. |
| `specs/records/2026-06/**` | Dated June 2026 plans, investigations, benchmarks, and audit records. | Historical evidence unless the file explicitly declares current authority. |
| `specs/artifacts/**` | Input artifacts such as prompts and product-reference notes. | Task input only, not architecture authority. |

## Hard Rules

1. No spec file dated before 2026-06-01 is retained in the repository.
2. New dated spec records must live under the matching month directory in `specs/records/YYYY-MM/`.
3. New current architecture work must update `specs/current/architecture/**`; dated investigation notes go to `specs/records/YYYY-MM/**`.
4. Package-local spec trees are not allowed. OpenCorvus package decisions use this root `specs/` tree.
5. Root-level files in `specs/` are limited to this index plus the `current/`, `records/`, and `artifacts/` directories.
6. If a deleted pre-June record must be discussed, use prose such as `deleted pre-June record <name>` rather than recreating a file or link.

## Verification

Run these after adding, deleting, or moving specs:

```bash
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```
