# June 2026 Spec Records

This directory contains June 2026 implementation records, investigations, benchmark notes, and audit results.

The 2026-06-29 consolidation moved June records here from scattered spec locations and deleted pre-June spec files. The migration source of truth for this task is [2026-06-29-spec-consolidation.md](2026-06-29-spec-consolidation.md).

Current incident records:

- [2026-06-29-database-ioerr-runtime-boundary.md](2026-06-29-database-ioerr-runtime-boundary.md) records the SQLite `SQLITE_IOERR_READ` backend crash root cause and runtime-boundary fix plan.
- [2026-06-29-model-image-input-auto-resize.md](2026-06-29-model-image-input-auto-resize.md) records the model-bound image auto-resize plan for oversized screenshot and attachment inputs.

## Rules

1. Every record file in this directory must contain `2026-06` in its filename.
2. Prompt or product-reference artifacts belong in `specs/artifacts/`, not in this records directory.
3. Current architecture belongs in `specs/current/architecture/`, not in this records directory.
