# Agent Retry Final Trace Session Owner

Date: 2026-06-22

## Problem

Some agent tasks fail with:

`Trace session mismatch: context=<ambient-session> input=<agent-session>`

The visible failure happens after a child agent retry path, not while opening
the overlay trace panel.

## Recall

- `AgentTrace.recordAgentReport()` uses `sessionBucket(input.sessionID)`.
- `sessionBucket()` intentionally rejects a mismatch between ambient
  `SessionContext` and explicit `input.sessionID`; this protects trace writes
  from being stored under the wrong session.
- Normal `runAgentSession()` completion/failure writes reports via
  `recordAgentTraceReportForSession(session, input)`, which binds the child
  session context before calling `AgentTrace`.
- `runAgentSessionWithRetry()` success writes `agent_report_retry_final` through
  the same helper.
- The exhausted-retry tail path still called `AgentTrace.recordAgentReport()`
  directly and used `"no-session"` when no attempt produced a session.

## Root Cause

The retry-exhausted trace write bypassed the child-session context binding.
When a retrying child agent ran inside a parent orchestrator session context,
the trace writer saw `context=<parent>` and `input=<child>`, then correctly
rejected the write. The task then failed because a diagnostic trace write threw.

## Decision

- In the retry-exhausted tail, write `agent_report_retry_final` only when a real
  `lastOutput.session` exists.
- Bind that real child session with `recordAgentTraceReportForSession()` before
  recording the report.
- Do not fabricate `"no-session"` for a session-scoped trace event.

## Acceptance

- Exhausting retries inside a parent `SessionContext` does not throw
  `Trace session mismatch`.
- The final retry report is written to the child session trace.
- No retry-final report is written to the parent session trace.
