## Problem

Long report-style Build goals can push the model into a single oversized `write`
tool call. When the provider stops at `finish=length`, the JSON tool input is
truncated, the write tool reports invalid input, and the session later surfaces
as `TerminalToolMissingError` because `report_build_result` was never reached.

Observed call sites:

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/prompt/core/build-core.txt` | Add Build-agent execution guidance: long deliverables must be written in section-sized tool calls. |
| `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` | Add prompt hygiene regression test for the chunked-write guidance. |
| `packages/opencorvus/src/build/agent.ts` | No runtime change; it already composes `build-core.txt` as the single Build prompt core. |
| `packages/opencorvus/src/session/loop.ts` | No runtime change; terminal tool detection remains the correct contract failure surface. |

## Implementation

Prompt-only fix:

- For long Markdown, HTML, report, PRD, or documentation deliverables, Build
  must not put the whole artifact into one tool payload.
- Build should write an outline or first section, then append or patch later
  sections in separate tool calls keyed by headings.
- Build should verify the file after section writes before commit, merge, and
  `report_build_result`.

This is not a host fallback or gate. The model still owns the workflow and the
terminal report contract remains unchanged.
