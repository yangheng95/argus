# OpenCorvus package specs index

This directory stores package-local design and incident notes for `packages/opencorvus`. These files are historical evidence unless they explicitly identify themselves as the current source for a runtime contract.

## Notes

| File                                              | Status                 | Notes                                                                                                                         |
| ------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `acceptance-spec-scope-discipline-2026-05-23.md`  | Implemented history    | AcceptanceSpec scope discipline and integrity feedback loop; current source is requirements/integrity prompt code plus tests. |
| `build-agent-review-uptake-2026-05-23.md`         | Implemented history    | Build agent review uptake and retry discipline; current source is integrity build-feedback/root-history code plus tests.      |
| `integrity-severity-discipline-2026-05-23.md`     | Implemented history    | Integrity severity classification and bounded maturity evidence; current source is integrity team prompt code plus tests.     |
| `integrity-team-replay-aware-2026-05-23.md`       | Implemented history    | Replay-aware integrity team behavior; current source is replay-context/shared-prompt/team-agent code plus tests.              |
| `orchestrator-stuck-integrity-loop-2026-05-23.md` | Implemented history    | Orchestrator stuck-integrity loop investigation; current source is root-history/build-feedback/orchestrator code plus tests.  |
| `research-frontend-design-boundary-2026-06-03.md` | Historical design note | Boundary between research and frontend design for webpage PRD work.                                                           |
| `short-path-segments-2026-05-24.md`               | Historical design note | Short path segment display behavior.                                                                                          |

## Maintenance

- Keep package-local implementation notes here when the evidence is specific to `packages/opencorvus`.
- Put cross-package architecture decisions under `specs/new-arch/**`.
- Update this index whenever a package-local spec is added, removed, renamed, or superseded.
