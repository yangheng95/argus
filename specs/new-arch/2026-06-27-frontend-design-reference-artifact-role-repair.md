# Frontend Design Reference Artifact Role Repair - 2026-06-27

## Incident Evidence

- Task `tsk_f078b27df001eflBfYa6W04uKG` (`Economy Heatmap`) targets
  `https://www.tradingview.com/markets/world-economy/` in
  `/workspace/markets-world-economy`.
- The task's materialized frontend-design report showed the intended structured
  role split, but its rendered screenshot path was still a temporary local
  browser output that is not durable enough for the final contract:
  - `source_reference_artifact:
    .opencorvus/r/t/kV/Gdd9uf/fd/web-clone-source/reference.png`
  - `screenshot_artifact:
    /tmp/opencorvus-capture/1782540923070-jbqnrq/screenshot.png`
- The same report also places the local rendered skeleton screenshot in generic
  `source_refs`, `frontend_project.entrypoints`, and `Reference Artifacts`
  sections. That makes a task-local render look like the source reference
  screenshot in downstream UI and handoff readers.
- Two system artifacts named `url-www_tradingview_com-*.png` were captured as
  URL screenshot visual references; those are source URL screenshots. They are
  separate from the rendered skeleton screenshot under `/tmp/opencorvus-capture`.

## Call-Site Audit

Command:

```powershell
rg -n "reference_artifacts|update_frontend_reference|source_refs|entrypoints|visual_validation_evidence|screenshot_artifact|renderVisualValidationEvidence|renderNamedItems|Evidence artifacts cited by frontend_design" packages/opencorvus/src/frontend-design packages/opencorvus/src/orchestrator packages/opencorvus/test/frontend-design -S
```

Findings:

| Surface | Current behavior | Repair decision |
| --- | --- | --- |
| `update_frontend_visual_evidence` | Has structured `screenshot_artifact` and `source_reference_artifact`. Recent schema rejects source references outside `web-clone-source/reference*.png`, while submit-time artifact verification already expects rendered screenshots under the task artifact root. | Keep this as the only place where rendered screenshot artifacts are registered, but require the rendered screenshot/diff to be materialized under task-scoped `visual-html-skeleton/...` rather than `/tmp/opencorvus-capture` or localhost preview URLs. |
| `update_frontend_reference` / `reference_artifacts` | Accepts arbitrary strings, including `/tmp/opencorvus-capture/.../screenshot.png`, so rendered previews can become "reference artifacts". | Reject rendered screenshot / preview / temporary capture paths here. Source reference images remain allowed only as `web-clone-source/reference*.png`; source evidence files remain allowed. |
| Compact `source_refs` fields | Generic source/evidence anchors can currently include rendered preview screenshots. | Keep source evidence paths, but reject local rendered capture screenshots in compact source refs. Rendered screenshots belong to `visual_validation_evidence`. |
| `frontend_project.entrypoints` | Prompt/schema described screenshots and diff outputs as acceptable visual-baseline entrypoints, so task-local preview artifacts could be listed beside editable skeleton files. | Entry points name source-editable files such as `visual-html-skeleton/index.html` and CSS/assets. Rendered screenshots/diffs are rejected and must be registered through `visual_validation_evidence`. |
| Frontend-design prompt | The Visual HTML Skeleton Contract told the agent to name screenshots and diff/evaluation artifacts as project entrypoints and record skeleton evidence broadly in `reference_artifacts`. | Prompt now states rendered screenshots, preview captures, and diffs must first be materialized under `visual-html-skeleton/...`, then recorded only in `update_frontend_visual_evidence`; `reference_artifacts` carries source/reference evidence paths only. |
| Report rendering | `renderVisualValidationEvidence()` separates rendered preview and source reference, but `Reference Artifacts` and source-ref renderers are role-agnostic. | The report should not receive rendered previews through source/reference lists; validation should stop the invalid input before rendering. |
| Existing Economy task | Already has stale frontend-design report with mixed lists and a temporary `/tmp/opencorvus-capture/...` rendered screenshot path. | New code prevents future reports from repeating the role confusion and requires rendered evidence to be task-scoped before finalization; existing persisted report explains why the UI showed a local screenshot. |

## Acceptance

- `update_frontend_reference({ value: "/tmp/opencorvus-capture/.../screenshot.png" })` is rejected.
- Compact `source_refs` reject rendered local capture screenshots such as
  `/tmp/opencorvus-capture/.../screenshot.png`.
- Compact `source_refs`, `reference_artifacts`, and
  `frontend_project.entrypoints` reject local preview URLs with or without a
  URL scheme, including `http://127.0.0.1:...`,
  `localhost:...`, and `127.0.0.1:...`.
- `frontend_project.entrypoints` rejects rendered local capture screenshots and
  visual diff outputs.
- Structured `visual_validation_evidence.screenshot_artifact` accepts a
  task-scoped rendered skeleton preview artifact under `visual-html-skeleton/...`
  and rejects `/tmp/opencorvus-capture/...` or localhost preview output.
- `visual_validation_evidence.diff_artifact` rejects temporary/local preview
  output and accepts task-scoped visual diff artifacts.
- `source_reference_artifact` remains constrained to
  `web-clone-source/reference*.png`.
- The frontend-design report's `Reference Artifacts` section cannot contain
  local rendered skeleton screenshots.
