# 2026-05-21 Orchestrator Skill Loop / Provider Error Fuse

## Evidence

- Reproduced task: `tsk_e4ae55aa1001CxnNsyBH2x4m2L`.
- Board/progress stayed `active` with `Goals(0)`, no requirements, no goal workflows, no deliveries, and no visible fatal artifact.
- Conversation showed repeated root orchestrator tool calls:
  - `Loaded skill: register-component-recall` repeated 51 times.
  - `Loaded skill: csharp-react-rewrite-workflow` repeated 2 times.
  - No requirements / architect / build dispatch occurred.
- Session errors repeated with provider-compatible but AI-SDK-invalid response shape:
  - `AI_TypeValidationError`
  - response body had `object=chat.completion`, `status_code=66049`, `status_msg=引擎结果格式错误:{'error': {'message': "'NoneType' object is not iterable", ...}}`
  - validation failed because neither `choices` nor top-level `error` existed.

## Root Cause

Two independent defects combined:

1. The orchestrator agent's registry whitelist included `skill`, so the generic Skill Policy told the root scheduler to load skills before planning. That contradicts the orchestrator contract: the root scheduler dispatches specialist workflow tools (`requirements`, `architect`, `build`, etc.); specialist agents own task-specific skill loading.
2. When `SessionPrompt.prompt` throws a non-`AgentRunError` provider/AI-SDK error, the orchestrator catch path only writes `task.error`. It does not persist `engine_artifact.kind='orchestrator-stream-error'`, block the active run, or invoke the existing stream-error fuse. The UI can therefore remain `active` with no goals and no durable artifact explaining the stall.

## Repair Contract

- Remove `skill` from the orchestrator tool surface.
- Do not render the generic Skill Policy when the current agent cannot call `skill`.
- Preserve skill availability for specialist agents that explicitly include `skill`.
- When the orchestrator prompt call itself throws a non-`AgentRunError`, record the same durable `orchestrator-stream-error` artifact and run block used for hard stream errors.
- Let the existing fuse fail the task after the configured consecutive-error threshold; no fallback retries, no silent retry loop.

## Acceptance

- Agent/tool tests prove orchestrator does not receive `skill` and does not receive Skill Policy, while requirements still does.
- Orchestrator session-hard-error tests prove raw provider validation errors from `SessionPrompt.prompt` create one `orchestrator-stream-error` artifact and block the active run.
- Existing stream-error fuse tests continue to pass.
