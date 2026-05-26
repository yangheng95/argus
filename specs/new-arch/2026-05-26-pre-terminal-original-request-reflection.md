# Pre-terminal Original-request Reflection

> 2026-05-26 / 用户要求：在 requirements、architect、build 等 agent 结束前注入一次对原始用户需求的反思，检查实现或结构化产出是否违背、遗漏、缩水。

## Diagnosis

`StructuredOutput` 不是所有 agent 的统一终止点。Pipeline worker agent 的主要终止合同是 stage-specific terminal tool：

- Requirements: `submit_requirements`
- Architect: `submit_architect`
- Build: `report_build_result`
- Design Analyst: `submit_design_prd_spec`
- Intent Analysis: `StructuredOutput`

因此把反思只挂在 StructuredOutput recovery 前会漏掉 requirements / architect / build，并且会把行为误做成 host-side recovery 分支。

## Decision

在 `runAgentSession` 的系统 prompt 组合末尾追加一个通用 pre-terminal reflection fragment。它只说明终止工具调用前的模型自检义务，不改变 tool choice、collector readiness、StructuredOutput recovery 或 terminal recovery。

Fragment single source: `src/prompt/fragments/pre-terminal-reflection.ts`.
`runAgentSession` 使用完整 fragment；`SessionLoop.terminalToolSystemPrompt`
在 terminal-only scoped turn 使用同一文件导出的短提醒，避免双源文案漂移。

The fragment must require the agent to:

1. Re-check the prompt-visible original user request and system-provided authoritative request bundle from task context.
2. Re-check upstream requirements, architect contracts, retry / integrity / delivery feedback when present.
3. Fix omissions or contradictions before finalization.
4. Avoid adding a prose checklist unless the terminal schema explicitly asks for it.

`SessionLoop.terminalToolSystemPrompt` keeps a shorter last-turn reminder for terminal-only scoped turns.

## Non-goals

- No new state machine or host-side gate.
- No second terminal tool.
- No schema changes to existing terminal payloads.
- No per-agent duplicated prompt block unless a later stage needs stronger role-specific wording.

## Tests

- Unit-test the prompt fragment content and conditional rendering.
- Unit-test `runAgentSession` appends the fragment for terminal-tool agents and StructuredOutput agents.
- Unit-test the terminal-tool scoped reminder still names the tool and includes the pre-terminal reflection expectation.
