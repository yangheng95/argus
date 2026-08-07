# Inline Base64 Retry-Evidence Poison Repair

## Recall

### User request

- Continue the unattended crypto-trading Task C benchmark and repair every exposed OpenCorvus infrastructure defect without task-specific gates, compatibility paths, retry loops, a second dispatcher, or a workflow state machine.
- Classify faults precisely: infrastructure owns stable scheduling and durable dispatch; the squad owns product functionality and its own execution mistakes.
- Mailbox inactivity must not be hidden by silent infrastructure fallback. A scheduler decision turn must use a real tool, wait non-blockingly, or finish the task explicitly.
- The benchmark-owned backend may be restarted after a verified fix; user-owned Overlay/Vite processes must not be touched.

### Acceptance criteria

- Strict persisted-part and `AgentContextPacket` rejection of inline binary data remains intact.
- Rejection diagnostics never reproduce an inline data URL header or any base64 payload bytes.
- Retry decision evidence normalizes unsafe historical error text before it is projected into a worker context packet.
- An already-persisted unsafe same-key retry entry is superseded by a safe canonical entry; no direct database edit or compatibility reader is introduced.
- A regression test proves poisoned historical retry evidence becomes a renderable strict context packet.
- Focused tests, documentation health checks, and TypeScript typecheck pass before the benchmark-owned backend is restarted.

### Hard constraints

- No weakening of the write-boundary or context-packet validators.
- No fallback, legacy alias, migration, direct formal-database rewrite, task-specific special case, gate, scheduler, retry loop, or state machine.
- The canonical utility owns binary diagnostic normalization; persistence consumes that single source.
- Only the benchmark-owned backend on port 7878 may be restarted under the user's standing authorization.

### Evidence read

- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`
- `specs/records/2026-07/2026-07-20-orchestrator-tool-call-decision-epoch.md`
- `specs/records/2026-07/2026-07-16-webfetch-inline-attachment-e2e.md`
- Formal durable evidence for failed G6 Task `tsk_f7b4031c5001gQpaD2gTpJNCAO`, including terminal event `pev_f7bae4505001vJiozG08FLwfKz`, showed `goal_run.error` and retry decision-log values containing `window.playwrightReportBase64 = \"data:application/zip;base64,UEsDB...`.
- `packages/opencorvus/src/session/index.ts` correctly rejects inline data at the persistence boundary but embeds the utility-provided diagnostic in `InlineBase64InPartError`.
- `packages/opencorvus/src/orchestrator/build-tool.ts` correctly projects persisted retry decision entries through strict `textContextPacket`; it must not sanitize or bypass them locally.
- `packages/opencorvus/src/agent/context-packet.ts` correctly rejects inline binary data and remains unchanged.

### Whole-repository search

The pre-change search covered `inlineBase64DataUrlSnippet`, `inlineRawBase64PayloadSnippet`, `assertNoInlineBase64*`, `appendRetryEvidenceOnce`, `retryEvidenceValueFromGoalRun`, `ensureBuildRetryEvidenceForGoal`, `textContextPacket`, and `renderAgentContextPackets` across source, tests, and July records.

| Call site / sibling | Decision |
| --- | --- |
| `src/util/inline-base64.ts` | Replace payload-bearing snippets with safe metadata descriptors and add the one canonical text redactor. |
| `src/session/index.ts` | Preserve strict rejection and existing error ownership; it automatically receives safe diagnostics from the utility. |
| `src/expert-squad/prompt-profile-resolver.ts` | Preserve strict rejection; it automatically receives safe diagnostics from the utility. |
| `src/engine/persist.ts::retryEvidenceValueFromGoalRun` | Preserve evidence assembly; normalize at the shared append boundary so every retry source is covered. |
| `src/engine/persist.ts::appendRetryEvidenceOnce` | Normalize `value` and `reason`; supersede a same-key unsafe historical entry instead of treating it as authoritative precise detail. |
| `src/engine/persist.ts` explicit feedback retry call | No parallel repair; it is covered by the same append boundary. |
| `src/orchestrator/build-tool.ts` | No change; strict packet construction remains the consumer that proves evidence safety. |
| Session and start-new-attempt tests | Strengthen rejection secrecy and add unsafe-history supersession plus strict packet-render proof. |

### Independent feedback

- Independent read-only review from `liveness_audit` agreed with the write-boundary design and identified three missing systemic surfaces:
  - prove redaction is exhaustive, terminating, and idempotent across multiple data URLs, raw binary tokens, and JSON quoting;
  - retire the second base64 heuristic in `agent/context-packet.ts` in favor of the canonical utility while preserving the separate all-data-URL rejection rule;
  - redact historical unsafe rows at every decision-log prompt/file projection, because latest-wins retry consumption alone does not protect `toPromptSection()` or `toFullDocument()`.
- The implementation and regression matrix below incorporate this feedback. Strict packet validation remains a rejection boundary, never a sanitizer.

## Causal chain

1. A worker produced an inline Playwright report data URL.
2. The persistence guard correctly rejected it, but its exception copied a prefix of the forbidden value into the diagnostic.
3. The diagnostic became durable `goal_run.error` and retry decision evidence.
4. The next build dispatch projected that evidence through the strict context-packet validator.
5. The validator correctly rejected the poisoned evidence before a worker could start, so every retry repeated the same infrastructure failure.

The deep defect is therefore diagnostic-data ownership, not worker scheduling, goal routing, PostgreSQL, or the validator.

## Design

The inline-payload utility will expose only structural diagnostic metadata: offset, media type when available, payload character count, reason, and an explicit omission marker. A canonical redactor will replace all data URLs and detectable raw binary base64 tokens in arbitrary diagnostic text. `AgentContextPacket` will consume the same detection primitives while continuing to reject input; it will not sanitize packets.

`appendRetryEvidenceOnce` is the durable retry-evidence write boundary. It will normalize both fields before comparison and persistence. If the current same-key entry itself changes under normalization, that entry is unsafe; the function will append one safe superseding entry. Normal safe precise evidence keeps the existing preservation behavior.

The general decision-log append boundary will prevent new unsafe rows. Prompt and generated-file renderers will also redact while projecting so pre-fix durable history cannot re-poison a model, architect prompt, `read_context`, or the regenerated bundle. Raw database reads remain faithful append-only evidence.

This is not compatibility behavior: unsafe evidence is invalid under the current single contract, and the new latest decision entry is the canonical replacement event.

## Verification

- Session rejection test asserts diagnostics omit both the `data:` header and payload token.
- Utility/packet tests prove multiple URL and raw-token detection is exhaustive and redaction is idempotent.
- Engine retry test seeds unsafe historical error and same-key decision evidence, invokes the normal evidence writer twice, and proves the latest entry is safe, stable, and renderable by the strict context-packet path.
- Decision-log tests insert a pre-fix unsafe row directly and prove both prompt and complete generated-file projections omit it.
- Run focused test files, documentation health tests required by the record/index change, and package/root typecheck.
