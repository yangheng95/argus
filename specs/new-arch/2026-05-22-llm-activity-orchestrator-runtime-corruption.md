# 2026-05-22 LLM Activity / Orchestrator Runtime Corruption Repair

## Incidents

- `tsk_e4ae50f95001ZxQpLiHbfeHG5d` failed with
  `LLMActivity total deadline 3600000ms exceeded`.
- `tsk_e4ae55aa1001CxnNsyBH2x4m2L` repeatedly loaded
  `register-component-recall` before any requirements / architect / build
  dispatch.

These are separate failures. They share one theme: generic session machinery
crossed a role boundary and changed the meaning of a task-level orchestrator
wake.

## Evidence

### KeyStatistics

- Parent orchestrator called child work (`explore` / `analyze_intent`) inside
  a `SessionProcessor` turn.
- `SessionProcessor` pauses the idle gate on `tool-call`, because long tools
  do not emit provider chunks while the SDK awaits `execute`.
- The total deadline in `withLLMActivity` is still a wall-clock timer started
  once at activity creation.
- A long but live child tool can therefore exhaust `totalMs` while the
  orchestrator is deliberately paused for tool execution.

### IndustryCardList

- Trace showed the root orchestrator request had both:
  - the orchestrator core instruction that it must not load/run skills itself;
  - the generic `## Skill Policy` telling the agent to load matching skills
    before planning.
- The trace also exposed `skill` in the orchestrator tool surface and recorded
  new `skill({"name":"register-component-recall"})` tool calls on repeated
  turns.
- The repeated tool calls had distinct `toolCallId` values, so the evidence
  does not support a DB duplicate-write theory. The corrupt part is the runtime
  role boundary: the root scheduler was run through generic agent skill
  machinery.

## Root Causes

1. `LLMActivity.totalMs` measures wall-clock time even while
   `LLMActivityRun.pause()` is active. For session turns, pause means the
   provider stream is waiting for a tool/sub-agent and no LLM inactivity has
   occurred. Counting that period violates the inactivity-timeout requirement.
2. The orchestrator prompt is sent with `systemMode="complete"`, but
   `SessionLoop` still appends generic dynamic prompt sections and registry
   tools from the agent definition. When the orchestrator registry ever
   includes `skill`, the runtime contract no longer protects the root
   scheduler from the generic Skill Policy.
3. `SystemPrompt.skills()` currently decides from agent metadata alone. It
   does not check the actual tool set resolved for the current turn, so prompt
   policy can diverge from executable tools.

## Repair Contract

### A. Pause-aware LLMActivity total deadline

- `withLLMActivity` must count only active LLM time toward `totalMs`.
- `run.pause(reason)` pauses both idle and total deadline accounting.
- `run.resume(reason)` resumes both idle and total deadline accounting.
- Nested pause/resume pairs must not double-count paused time.
- Backoff/retry wait time remains counted; it is not a stream/tool pause.
- External abort remains immediate during pause.
- If an attempt throws while paused, the paused interval is closed before
  retry/failure accounting.

### B. Orchestrator runtime-contract isolation

- When the active agent is `orchestrator` and a session runtime contract is
  installed, the provider tool surface must be exactly the contract tools,
  including the valid empty-tool case.
  Registry and MCP tools must not leak into that wake.
- Generic Skill Policy may render only if the actual resolved tool set for the
  current turn contains `skill`.
- Per-turn tool switches must be applied to the provider tool surface before
  prompt policy is derived. `tool:false` removes that tool; `"*": false`
  removes all tools for text-only turns.
- Specialist agents keep normal registry tools and skill access.
- Build sessions keep `skill` availability through the normal SessionLoop
  policy when their resolved tool surface includes `skill`.

## Callpoints

| Area                   | Files / functions                                                                      | Decision                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| LLM activity timers    | `packages/opencorvus/src/llm/activity.ts::withLLMActivity`                             | Replace single wall-clock total timer with pause-aware active-time accounting.                       |
| Tool-call pause        | `packages/opencorvus/src/session/processor.ts`                                         | Existing `run.pause("tool-call")` / `run.resume("tool-call")` becomes sufficient after activity fix. |
| Orchestrator tools     | `packages/opencorvus/src/session/loop.ts::resolveTools`                                | Exact-contract mode for orchestrator wakes with runtime contract tools.                              |
| Skill Policy           | `packages/opencorvus/src/session/system.ts::skills` and `session/loop.ts::processTurn` | Gate policy on actual current-turn tool names.                                                       |
| Per-turn tool switches | `packages/opencorvus/src/session/loop.ts::resolveTools`                                | Apply false switches before returning provider tools.                                                |
| Agent registry         | `packages/opencorvus/src/agent/agent.ts`                                               | Keep current orchestrator whitelist without `skill`; tests preserve this.                            |

## Acceptance

- Unit tests prove `LLMActivity.totalMs` does not fire while paused and does
  fire after resume once active time is exhausted.
- Existing total-timeout retry tests still pass.
- Tests prove Skill Policy is suppressed when the current resolved tools do
  not include `skill`, even for an agent that can normally use skills.
- Tests prove specialist agents still receive Skill Policy when `skill` is in
  the resolved tool set.
- Tests prove an orchestrator runtime-contract wake cannot inherit registry
  `skill` even if the agent registry were to expose it.
- Tests use `resolveTools()` directly for the orchestrator contract case; a
  predicate-only test is not sufficient evidence.
- Tests prove `tool:false` and `"*": false` remove tools from the current turn
  provider surface.
- Targeted tests for `llm/activity`, `agent`, and `session` pass.
