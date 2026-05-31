# Pre-terminal Original-request Reflection

> 2026-05-26 / 用户要求：在 requirements、architect、build 等 agent 结束前注入一次对原始用户需求的反思，检查实现或结构化产出是否违背、遗漏、缩水。

## Diagnosis

`StructuredOutput` 不是所有 agent 的统一终止点。Pipeline worker agent 的主要终止合同是 stage-specific terminal tool：

- Requirements: `submit_requirements`
- Architect: `submit_architect`
- Build: `report_build_result`
- Frontend Design: `submit_frontend_template`
- Intent Analysis: `StructuredOutput`

因此把反思只挂在 StructuredOutput recovery 前会漏掉 requirements / architect / build，并且会把行为误做成 host-side recovery 分支。

## Decision

在 terminal finalizer 执行边界追加一个通用 pre-terminal reflection hook。它只说明终止工具调用前的模型自检义务，不改变 tool choice、collector readiness、StructuredOutput recovery 或 terminal recovery。

This must fire when the model first attempts the terminal finalizer, not at the
start of the agent. To avoid wasting tokens on a full terminal payload that will
be rejected, the primary hook runs at `tool-input-start`: as soon as the stream
names the terminal tool, the session records a visible tool result titled
`Pre-terminal Reflection Required`, closes that provider stream, and continues
the session. The terminal payload has not been generated yet. After the model
checks and fixes any mismatch, the next call to the same finalizer executes
normally. The terminal tool `execute` hook remains as a fallback for providers
that do not emit `tool-input-start`.

Fragment single source: `src/prompt/fragments/pre-terminal-reflection.ts`.
`SessionLoop` 使用完整 fragment 生成 terminal hook tool result；`terminalToolSystemPrompt`
在 terminal-only scoped turn 使用同一文件导出的短提醒，避免双源文案漂移。

The fragment must require the agent to:

1. Re-check the prompt-visible original user request and system-provided authoritative request bundle from task context.
2. Re-check upstream requirements, architect contracts, retry / integrity / delivery feedback when present.
3. Fix omissions or contradictions before finalization.
4. Avoid adding a prose checklist unless the terminal schema explicitly asks for it.

`SessionLoop.terminalToolSystemPrompt` keeps a shorter last-turn reminder for terminal-only scoped turns.

## Completion Invariant

The reflection hook result is deliberately a tool result paired to the model's
first terminal tool call ID, but it is not the terminal submission. Therefore
`runAgentSession` must never mark a terminal-tool agent completed unless the
agent's collector satisfies that terminal contract after `SessionPrompt.prompt`
returns. If the collector is still unsatisfied, the runner raises
`TerminalToolMissingError` before `SessionStatus` is set to `completed`; callers
then treat it as the same missing-terminal-report failure used for normal
prose stops.

## Non-goals

- No new state machine or host-side routing decision.
- No second terminal tool.
- No schema changes to existing terminal payloads.
- No per-agent duplicated prompt block unless a later stage needs stronger role-specific wording.

## Tests

- Unit-test the prompt fragment content and conditional rendering.
- Unit-test the terminal finalizer hook returns the visible reflection result exactly once per finalizer marker.
- Unit-test the processor closes the stream at `tool-input-start` and does not consume terminal payload deltas.
- Unit-test `StructuredOutput` does not capture the payload on the first reflected fallback finalizer call, and captures on the second.
- Unit-test the terminal-tool scoped reminder still names the tool and includes the pre-terminal reflection expectation.
- Unit-test `runAgentSession` rejects a completed-looking assistant turn when the terminal collector is still unsatisfied.
