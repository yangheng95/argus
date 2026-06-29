# Overlay Workbench PRD Plan

## Scope

Write a complete PRD for the OpenCorvus Overlay main workbench page:

- titlebar and workspace command dock;
- recent-chat task ledger;
- central conversation and composer surface;
- task status, goals strip, agent rail, message cards, and progress;
- workspace diff panel and file editor sidecar;
- right-side Explorer, Files, and Inspector tabs;
- Mission page mode reachable from the same page shell;
- dialogs, logs, notifications, connection diagnostics, and startup/runtime failure visibility.

## Evidence

The PRD is grounded in:

- `packages/overlay/src/index.html` for static page shell and mount points;
- `packages/overlay/src/main.tsx` for mount order, global bridges, task actions, runtime error handling, and page-mode switching;
- `packages/overlay/src/components/*` for component responsibilities;
- `packages/overlay/src/services/*` and `packages/overlay/src/store/*` for data sources and state ownership;
- `packages/opencorvus/src/server/routes/*` for project-scoped and control-plane route contracts;
- existing specs under `specs/new-arch`, especially file explorer/editor, Mission list, UI primitives, diagnostics, and conversation-agent rail specs.

## Deliverable

Create `specs/records/2026-06/2026-06-03-overlay-workbench-page-prd.md`.

Acceptance:

- at least 1000 non-empty PRD lines;
- explicit user personas, goals, non-goals, information architecture, interaction requirements, data contracts, states, error handling, accessibility, performance, security, observability, testing, release, and open questions;
- no fallback or compatibility path as a product requirement;
- no code changes in this task.
