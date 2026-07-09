# OpenCorvus Architecture HTML Refactor

## Recall

| Field | Content |
| --- | --- |
| User request | "这个页面正中间挤到一起了，重构一下，然后清理手稿" for `file:///C:/Users/chuan/myhexin-local/OpenCorvus架构设计.html`. |
| Acceptance criteria | Opening `C:/Users/chuan/myhexin-local/OpenCorvus架构设计.html` must show a clean standalone architecture page; the center Runtime section must not visually crowd or overlap; the draft diagnostic/manuscript section must be removed from the delivered page; visual verification must include real rendered screenshots. |
| Hard constraints | No fallback or compatibility logic; no blind patching; no git reset; no disturbance to running OpenCorvus/overlay processes; inspect landed specs before edits; frontend visual work needs screenshot review; Playwright runs through Node on Windows. |
| Disk sources read | `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/README.md`; `specs/current/architecture/99-principles.md`; `specs/current/architecture/17-agent-team-infrastructure.html`; target outer file `C:/Users/chuan/myhexin-local/OpenCorvus架构设计.html`; target content file `C:/Users/chuan/myhexin-local/OpenCorvus架构设计_files/saved_resource.html`. |
| Whole-repository search evidence | `rg -n "OpenCorvus架构设计|架构图重设计|让所有 AI 算法|AI 算法轻松|OpenCorvus 架构" . specs -S` found no repository-owned copy of this exact artifact; broad architecture search under `specs/current` and `specs/records/2026-07` confirmed the relevant current source of truth is `specs/current/architecture/**`, especially `17-agent-team-infrastructure.html` and `99-principles.md`. |
| Visual evidence before edits | `C:/Users/chuan/myhexin-local/opecorvus/.scratch/opencorvus-architecture-html/before-content-1440x900.png`; geometry showed `.core-body` visible width `624px` with `scrollWidth` `750px`, proving the middle crowding is caused by the central layout model. |
| Independent agent feedback | Not used: the task is a single static HTML artifact outside the application code path, and no user request asked for independent sub-agents. The evidence loop is direct source inspection plus rendered screenshot review. |

## Root Cause

The delivered file is a saved Claude Artifact shell. The actual design lives inside
`OpenCorvus架构设计_files/saved_resource.html`, while the outer HTML still carries
Claude frame runtime and shell behavior. When served locally over HTTP, that shell
renders a Claude "Page not found" surface instead of the artifact.

The visible crowding is inside the content file: the central OpenCorvus Runtime
card uses a narrow horizontal flex body. It allocates Orchestrator, Agent Harness,
and four pipeline steps inside one row, so the Harness content exceeds the core
body width.

The bottom "原图的问题与对应改法" section is draft/diagnostic manuscript content. It
is useful design rationale but should not remain in the final deliverable page.

## Implementation Plan

1. Replace the outer `OpenCorvus架构设计.html` with a standalone clean artifact
   page so the user-facing file is the single source opened by the `file://` URL.
2. Refactor the middle Runtime layout from a crowded single horizontal pipeline
   into a two-tier runtime card:
   - Orchestrator as the left decision owner.
   - Harness as the right work area.
   - Pipeline steps in a wrapping grid with stable dimensions and explicit flow
     arrows.
3. Keep the left-to-right story: original AI algorithms, one-time expert-squad
   transformation, OpenCorvus Runtime, 7x24 service assets, AI asset feedback,
   and Agent Team Market.
4. Remove the draft diagnostic notes from the final HTML and leave only the
   architecture page content.
5. Delete the obsolete sibling resource directory after the outer HTML becomes
   standalone, because keeping `saved_resource.html` and the frame shell would
   preserve a second stale manuscript source.

## Implementation Notes

- Replaced `C:/Users/chuan/myhexin-local/OpenCorvus架构设计.html` with a clean
  standalone HTML page.
- Deleted `C:/Users/chuan/myhexin-local/OpenCorvus架构设计_files` after verifying
  the resolved absolute path, because it only contained the saved Artifact shell
  script and stale manuscript content.
- Reworked the center Runtime card into a two-column Orchestrator/Harness body
  and changed the Harness flow from a single crowded row to a stable 2x2 step
  grid.
- Removed the draft diagnostic section from the deliverable page.

## Verification Plan

- Render the final page through a temporary local HTTP server limited to the
  target file and resource directory.
- Capture a 1440x900 screenshot and inspect it visually.
- Capture DOM geometry for the center card and assert no center card has
  horizontal overflow.
- Re-open the outer HTML through the same local route and verify it is no longer
  the Claude shell.
- Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  because this record adds a new spec path.

## Verification Evidence

- Before screenshot: `.scratch/opencorvus-architecture-html/before-content-1440x900.png`.
- After screenshot: `.scratch/opencorvus-architecture-html/after-outer-full.png`.
- Cleanup screenshot: `.scratch/opencorvus-architecture-html/after-cleanup-outer-1440x900.png`.
- After geometry: `.core-body` `716/716`, `.pipeline` `470/470`, `.harness`
  `504/502`; no measured overflow.
- Post-cleanup checks: old `_files` directory absent; `rg` found no `Claude`,
  `原图的问题`, `对应改法`, `诊断说明`, `saved_resource`, `frame-content`,
  `iframe`, or `Page not found` in the delivered HTML.
