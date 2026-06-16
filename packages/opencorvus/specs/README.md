# OpenCorvus package specs index

This directory stores package-local design and incident notes for `packages/opencorvus`. These files are historical evidence unless they explicitly identify themselves as the current source for a runtime contract.

## Notes

| File | Status | Notes |
| --- | --- | --- |
| `acceptance-spec-scope-discipline-2026-05-23.md` | Historical design note | AcceptanceSpec scope discipline and integrity feedback loop. |
| `build-agent-review-uptake-2026-05-23.md` | Historical design note | Build agent review uptake and retry discipline. |
| `integrity-severity-discipline-2026-05-23.md` | Historical design note | Integrity severity classification and bounded maturity evidence. |
| `integrity-team-replay-aware-2026-05-23.md` | Historical design note | Replay-aware integrity team behavior. |
| `orchestrator-stuck-integrity-loop-2026-05-23.md` | Historical incident note | Orchestrator stuck-integrity loop investigation. |
| `research-frontend-design-boundary-2026-06-03.md` | Historical design note | Boundary between research and frontend design for webpage PRD work. |
| `short-path-segments-2026-05-24.md` | Historical design note | Short path segment display behavior. |

## Maintenance

- Keep package-local implementation notes here when the evidence is specific to `packages/opencorvus`.
- Put cross-package architecture decisions under `specs/new-arch/**`.
- Update this index whenever a package-local spec is added, removed, renamed, or superseded.
