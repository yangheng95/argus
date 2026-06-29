# Orchestrator Tool-Only Trace Summary Repair

Date: 2026-06-21

## Problem

The world-economy task surfaced:

```text
Orchestrator error: agent report summary is empty
```

The current service state showed the task as `active/running`, with
`task.error` carrying that trace-report error. This made the scheduler look like
it was wasting tokens by waking itself, while the immediate host-side failure
was not a model decision loop. The trace writer rejected a valid orchestrator
wake that had no final prose text.

## Root Cause

`packages/opencorvus/src/orchestrator/agent.ts` records an
`orchestrator_wake` trace after `SessionPrompt.prompt` completes:

```ts
const finalText = finalTextFromMessage(finalMessage)
report: {
  summary: paragraphSummary(finalText ?? "orchestrator completed without final text"),
  detail: finalText ?? "orchestrator completed without final text",
}
```

`finalTextFromMessage` returns an empty string for a tool-only assistant message
or an assistant message with no text parts. Empty string is not nullish, so the
fallback text is not used. `paragraphSummary("")` then throws
`agent report summary is empty`. That exception is caught by the outer
orchestrator error handler and stamped on `task.error`.

This is a host trace-report bug. A tool-only orchestrator wake can be a valid
workflow decision when the wake's tool parts have
`orchestratorDecisionEffect=decision`.

## Call-Point Audit

Commands:

```powershell
rg -n "agent report summary is empty|agent report summary|agent_report|recordOrchestratorTraceReportForSession|paragraphSummary\(" packages/opencorvus/src packages/opencorvus/test specs
rg -n "OrchestratorNoDecisionStop|classifyOrchestratorDecisionStop|no-decision recovery|orchestrator_wake" packages/opencorvus/src packages/opencorvus/test specs
```

Relevant surfaces:

| Surface                                                          | Evidence                                                            | Repair decision                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `agent/report.ts::paragraphSummary`                              | Correctly throws on empty report summaries.                         | Keep; the caller must pass a real report.                                                                     |
| `orchestrator/agent.ts::recordOrchestratorTraceReportForSession` | Writes whatever report it is given.                                 | Keep; validation belongs at report construction.                                                              |
| `orchestrator/agent.ts::processTask` success trace branch        | Builds summary only from final text, and treats `""` as real text.  | Replace with an explicit wake-report builder that summarizes either final text or actual wake tool decisions. |
| `orchestrator/agent.ts::classifyOrchestratorDecisionStop`        | Already accepts a wake with decision-effect tool calls.             | Keep; do not change no-decision semantics.                                                                    |
| `orchestrator/agent.ts::recordOrchestratorSessionErrorEnvelope`  | Only no-decision envelopes self-wake.                               | Keep; do not add any self-wake for report construction failures.                                              |
| `test/orchestrator/no-decision-stop-process.test.ts`             | Has process-level mock coverage for no-decision and queue re-entry. | Add a tool-only decision wake regression here.                                                                |

## Acceptance

- A valid tool-only orchestrator decision wake records an `orchestrator_wake`
  trace with a non-empty summary.
- The same wake does not stamp `task.error`.
- The same wake does not create an `orchestrator-stream-error` artifact.
- The same wake does not dispatch a no-decision self-wake.
- Existing no-decision self-wake behavior remains unchanged and bounded by the
  stream-error fuse.
