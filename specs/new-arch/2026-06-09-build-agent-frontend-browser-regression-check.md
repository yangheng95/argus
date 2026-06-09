# Build Agent Frontend Browser Regression Check (2026-06-09)

## Problem

The Build agent already required observed runtime verification for frontend design, UI implementation, webpage, and visual tasks. That wording was task-shape based. It still left a gap for ordinary frontend project edits whose request sounds like a code change: the agent could modify source, run static checks, and miss a surrounding layout/style regression.

The fix belongs in the Build agent prompt contract. It should not become a host-side gate or route bypass; the model must be instructed to verify the actual rendered frontend surface after edits and cite real task-scoped browser evidence.

## Call Point Inventory

| Surface | Grep evidence | Change |
| --- | --- | --- |
| Build core prompt | `packages/opencorvus/src/prompt/core/build-core.txt` | Expand observed frontend verification from task-type wording to any frontend project, and require post-edit browser/preview inspection of changed and surrounding layout/style context. |
| External coding executor contract | `packages/opencorvus/src/build/agent.ts` `externalBuildSystemContract` | Mirror the same requirement for Codex and Claude Code external Build executors. |
| Build prompt regression tests | `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts` | Assert frontend projects require per file-changing pass browser/preview evidence and surrounding layout/style inspection. |
| External executor regression tests | `packages/opencorvus/test/build-agent/external-system.test.ts` | Assert external Build executors receive the same frontend browser regression instruction. |

## Acceptance

- Any Build agent working inside a frontend project is told to open the task preview or task-scoped browser evidence route after edits.
- The browser check must inspect both the changed region and surrounding visual context: parent container, adjacent components, spacing, typography, color, responsive framing, and local visual style.
- Static file inspection alone is explicitly insufficient for frontend project changes.
- Windows Playwright startup remains Node Package Manager (`npm`) only, not `bun`.
- No host-side gate, fallback, compatibility path, or duplicate preview source is added.
