# Request-language propagation repair

## Recall

### User request

- The operator reports that agents were designed to answer in the request language, but the behavior rarely takes effect.
- After the evidence-backed diagnosis, the operator explicitly requested: `修复问题`.

### Acceptance criteria

1. The current authored request, not the OpenCorvus interface locale, is the single source for user-facing response language.
2. A Chinese Mission request produces a Chinese Mission-authored `create_task.request`; an English Mission request produces an English task request.
3. Orchestrator worker-dispatch briefs and Coding/Chat local-delegation briefs preserve the current request language.
4. Runtime protocol scaffolding, identifiers, code, paths, commands, API names, and quoted source material may retain their required source text without changing the response language.
5. Focused regression tests cover locale/request disagreement and every prompt-owned rewriting boundary.
6. No language detector, keyword classifier, host gate, compatibility branch, fallback, hidden message, or second persisted language field is introduced.

### Input → output contract

| Input | Required output |
| --- | --- |
| Chinese authored request with `locale: en-US` | Chinese user-facing response; no English locale override |
| English authored request with `locale: zh-CN` | English user-facing response; no Chinese locale override |
| Chinese Mission creating a child task | Chinese task title/request narrative, with required source literals preserved |
| Chinese task dispatching or delegating a worker | Chinese worker brief and Chinese user-facing handoff |

### Environment and timeout

- Repository: `C:\Users\chuan\myhexin-local\opecorvus`
- Focused runtime: bundled Bun test runner already used by the repository.
- Existing backend evidence URL: `http://127.0.0.1:7878`; the running process must not be restarted without operator authorization.
- Focused tests are bounded synchronous suites. Any future live-chain benchmark must use the repository's activity-based timeout owner; no process-start wall-clock timeout is added by this repair.

### Hard constraints recalled

- `AGENTS.md`: prompt and root-cause repair over host invariants; no fallback, gate, keyword routing, state machine, hidden messages, or second source.
- `specs/current/architecture/99-principles.md`: Orchestrator remains the sole task scheduler and all sub-agents remain real visible sessions.
- `specs/current/architecture/01-agents.md`: generated worker prompts are dispatcher-owned context boundaries.
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`: the observed Chinese Mission is a real long-chain benchmark, and its child-task chronology must not be replaced by a mock claim.
- `specs/records/2026-07/2026-07-16-platform-legacy-debt-cleanup.md`: remove conflicting legacy ownership rather than retaining compatibility behavior.
- `benchmark-debug-template` skill: preserve the benchmark definition, iterate until executable acceptance passes, then perform a second review.

### Runtime evidence recalled

- Backend: `http://127.0.0.1:7878`; PID `12464`; database path returned by `/global/health`: `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.
- Mission session `ses_08ea47b6dffeTb0mDUbw5eqWIl` received a Chinese operator request and answered in Chinese.
- Mission-created task `tsk_f71c4ff110018RNmV563z7Y3UO` persisted an English narrative followed by the quoted Chinese `Original user input` at character offset 2818.
- Task root `ses_08e3b00e6ffehL7em3QmzN794u` had no persisted locale, while Orchestrator session `ses_08e3afba7ffeeM4UGv4vzBllac` received the English-first request and answered in English.
- `packages/opencorvus/test/session/response-language.test.ts` passed before the repair, proving only locale-to-prompt mapping and not request-language propagation.

### Whole-repository search and call-site disposition

| Surface | Evidence | Disposition |
| --- | --- | --- |
| Global LLM system append | `session/llm.ts` calls `SystemPrompt.responseLanguage(cfg.locale)` | Replace locale ownership with one unconditional request-language contract |
| Locale prompt producer | `session/system.ts::responseLanguage` | Replace locale-specific branches; no language detector or compatibility path |
| Control-plane task authoring | `control/message.ts::systemPrompt` | Require generated `create_task.title/request` narrative to use the user's language |
| Mission task authoring | `prompt/core/mission-core.txt` `panel.create_task` contract | Require task narrative/title to preserve the original operator request language |
| Orchestrator dispatch | `prompt/core/orchestrator-core.txt` `dispatch_agent` contract | Require target-specific worker briefs and user-facing rationale to preserve task-request language |
| Coding/Chat delegation | `agent/prompt/coding.txt`, `tool/delegate-agent.ts` | Require delegated instruction and child handoff to preserve interactive request language |
| Existing specialist prompt clauses | Build, Requirements, Frontend Design, Intent Analysis | Retain; they agree with the new global single source and add role-specific output detail |
| Title generator | `agent/prompt/title.txt` | Retain; it already follows the user message language |
| Tests | `session/response-language.test.ts` and prompt-contract suites | Replace misleading locale assertions and add dispatcher/delegation prompt coverage |

### Independent-agent feedback

- No independent agent was requested by the operator, so none was spawned. The main agent owns the evidence synthesis and second review.

## Root cause

The system had two conflicting language authorities. The LLM layer derived response language from UI `locale`, while several role prompts independently referred to the request language. Mission and Orchestrator were also free to rewrite downstream briefs in English. In the observed benchmark, the Chinese source request was quoted only at the end of an English child-task narrative, so the child correctly treated the immediate English-first request as English. Existing tests validated the obsolete locale policy rather than the full dispatcher chain.

## Implementation plan

1. Replace locale-derived language prompting with a universal request-language instruction at the shared LLM boundary.
2. Strengthen each prompt-owned rewriting boundary so generated narratives preserve the parent request language.
3. Replace the locale-only test with disagreement cases and add prompt-contract tests for Mission, Orchestrator, Control, and Coding/Chat delegation.
4. Run focused tests, relevant prompt/document health suites, and type checking; repair any real failure.
5. Review the resulting diff for double sources, fallback behavior, unrelated changes, and runtime/process boundary compliance.

## Benchmark status

- Baseline: **failed**. The real Chinese Mission produced an English-first child task and English Orchestrator responses.
- Repair verification: **passed**.
  - `bun test packages/opencorvus/test/session/response-language.test.ts packages/opencorvus/test/session/request-language-propagation.test.ts packages/opencorvus/test/mission-prompt-work-ledger.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts` — 16 passed, 0 failed.
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts` — 88 passed, 0 failed.
  - `bun test packages/opencorvus/test/tool/delegate-agent.test.ts -t "creates one visible standalone child using the exact parent identity and model"` — 1 passed, 0 failed; the real child-session path completed in 4.86 seconds.
  - `bun run --cwd packages/opencorvus typecheck` — passed.
- The complete `delegate-agent.test.ts` file retains a pre-existing Windows cold-start sensitivity: its default five-second absolute Bun test timeout can expire while the native process supervisor is publishing readiness. The directly affected child-session test passes in isolation; this repair does not increase that hard timeout or disguise it as language acceptance.
- Live main-database rerun: pending; it requires a newly created task under code loaded after this change, while the currently running OpenCorvus process cannot be restarted without explicit authorization.

## Second review

- Request language is now the only response-language authority in the shared LLM prompt; `locale` no longer selects Chinese or English output.
- Mission, Control, Orchestrator, and Coding/Chat delegation all preserve the parent request language at their authored prompt boundary.
- No language field, language detector, keyword classifier, fallback, gate, state machine, hidden message, or compatibility branch was added.
- The existing specialist clauses remain consistent refinements rather than competing language sources.
- No OpenCorvus/overlay process was restarted, stopped, refreshed, or otherwise disturbed.
- No dead or deprecated module was discovered beyond the replaced locale-owned response-language branches; the function remains live under its request-language ownership, so no separate deletion authorization is required.
