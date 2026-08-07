# WebFetch Inline Attachment E2E Repair

Date: 2026-07-16
Status: Verified
Owner: Codex

## Recall

### User request

The user authorized closing all OpenCorvus backends, deleting
`C:\Users\chuan\.local\share\opencorvus`, and retrying long-orchestration case C
from `specs/artifacts/长程编排测试.md` against the main database.

### Acceptance criteria

- A fresh current-source backend recreates the main database with the current schema.
- Case C is published as one real Mission with explicit model `hexin/gpt-5.5`.
- The Mission creates a real Task, Orchestrator session, and projected research workers.
- HTML or Markdown fetched by `webfetch` never persists inline base64 data URLs in a message Part.
- Valid embedded data URLs become ordinary tool-result attachments that the existing
  `SessionLoop.materializeToolResultAttachments` path writes through `AttachmentStore`.
- The strict `Session.updatePart` inline-base64 rejection remains unchanged.
- Focused tests reproduce the real producer shape, and the real Mission is retried after the fix.

### Hard constraints

- No fallback, compatibility path, persistence relaxation, keyword routing, gate, or second attachment source.
- Do not alter unrelated parallel-agent changes.
- Do not reuse the historical database or an old backend as acceptance evidence.
- Use bounded timer waits, not log tailing or status polling.
- Preserve visible tool errors and verify public messages before read-only database evidence.

### Sources read

- `AGENTS.md`
- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-debug-evidence/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-debug-evidence/references/evidence-surfaces.md`
- `packages/opencorvus/src/tool/webfetch.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/processor.ts`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/storage/attachment-store.ts`
- `packages/opencorvus/src/session/text-mime.ts`
- `packages/opencorvus/test/tool/webfetch.test.ts`
- `packages/opencorvus/test/session/extra-tools.test.ts`
- Public Mission, Task, status, board, trace, and session-message responses from backend
  `http://127.0.0.1:60564`.
- Read-only rows from `C:\Users\chuan\.local\share\opencorvus\opencorvus.db` for Mission
  `659e26788241e309`, Task `tsk_f68536dc8001IqHqz0JFMjGWNk`, root Session
  `ses_097ac922bffe24aBM7fQQOthe6`, Orchestrator Session
  `ses_097ac88e4ffetu0P4vZuKt9o4o`, and research Session
  `ses_097aac67dffeJ1Vz4Vz3v4HF9C`.

### Whole-repository search evidence

- `rg -n "InlineBase64InPartError|inline base64|AttachmentStore\\.write|data:image|webfetch|WebFetch" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07`
  found the strict persistence guard, the `webfetch` producer, central attachment
  materialization, and existing attachment tests.
- `rg -n "normalize.*Tool|attachments|AttachmentStore|webfetchOutputClipped|updatePart\\(" packages/opencorvus/src/session packages/opencorvus/src/tool`
  confirmed tool-result attachments are materialized centrally before Part persistence,
  while embedded data URLs inside the string output are not transformed.
- `git status --short -- packages/opencorvus/src/tool/webfetch.ts packages/opencorvus/test/tool/webfetch.test.ts packages/opencorvus/src/session/loop.ts packages/opencorvus/src/session/processor.ts`
  showed all four owning/adjacent files were clean before this repair.

### Independent agent feedback

No sub-agent was used. The user requested a direct real-backend run, and the failure was
fully observable through public scheduler messages plus authoritative read-only database
records.

## Runtime evidence

- The fresh Mission first omitted a Task model, received visible
  `MissingModelConfigError`, and naturally retried with `hexin/gpt-5.5`.
- Exactly one Task was created. Its root Session persisted model
  `hexin/gpt-5.5`; its Orchestrator dispatched `source-investigator` and then
  `research-investigator`.
- `source-investigator` completed. `research-investigator` called `webfetch` for
  TradingView, CoinMarketCap, CoinGecko, and Dexscreener.
- CoinMarketCap HTML converted to Markdown containing
  `![](data:image/png;base64,...)`.
- `Session.updatePart` rejected the research tool Part, then the parent
  `dispatch_agent` Part. Protocol events persisted terminal errors for both sessions, and
  the Task row persisted `InlineBase64InPartError` while remaining active.

## Root cause

`webfetch` already represents direct image responses through `attachments[]`, but its
HTML-to-Markdown path returns embedded base64 data URLs inside the string `output`.
`SessionLoop.materializeToolResultAttachments` correctly externalizes only declared
attachments. The strict Part guard therefore sees megabytes of inline bytes in the tool
output and rejects persistence. The owning repair is to make `webfetch` externalize valid
embedded data URLs into its declared attachment list before returning the text result.

## Design

1. Extract and de-duplicate valid embedded base64 data URLs from every textual webfetch
   format.
2. Replace each textual occurrence with a stable `attachment:webfetch-embedded-N`
   marker and return the original data URL as a typed file attachment.
3. Preserve existing clipping after extraction so image bytes do not consume the useful
   textual context budget.
4. Keep central AttachmentStore materialization and the persistence guard unchanged.
5. Add a production-shaped HTML-to-Markdown regression that verifies one de-duplicated
   attachment, no inline base64 in output, preserved remote image URLs, and successful
   AttachmentStore materialization with byte equality.

## Validation note

The first strict persistence regression run failed before reaching the base64 guard because
its user-message fixtures omitted the now-required visible `author`. The fixture is updated
with `author: "user"`; no production message schema or persistence behavior is relaxed.

## Implementation

- `packages/opencorvus/src/tool/webfetch.ts` now extracts and de-duplicates valid
  embedded base64 data URLs before textual normalization and clipping. Each occurrence
  becomes `attachment:webfetch-embedded-N`, and the original bytes are returned through
  the existing typed `attachments[]` result surface.
- `packages/opencorvus/test/tool/webfetch.test.ts` covers a production-shaped HTML page
  containing a duplicated inline PNG and a remote image. It verifies textual replacement,
  de-duplication, preservation of the remote URL, central AttachmentStore materialization,
  and exact byte recovery.
- `packages/opencorvus/test/session/inline-base64-rejected.test.ts` keeps the strict
  persistence regression executable under the current visible-message schema by supplying
  the required user author.

## Fresh main-database retest

- All prior backends were stopped, the exact resolved directory
  `C:\Users\chuan\.local\share\opencorvus` was deleted, and a repaired current-source
  backend recreated `opencorvus.db` on `http://127.0.0.1:51122`.
- Long Mission case C was published into the fresh target repository
  `C:\Users\chuan\myhexin-local\demos\economy\crypto-e2e-20260716-retry` as Mission
  `442d4aa9c6c901dc`. It created Task `tsk_f68632aad001J2wuRQSqwlzSx5`, root Session
  `ses_0979cd546ffeUURzhMLr3hwbU1`, and Orchestrator Session
  `ses_0979cc91fffeD3uUopt3saP1z0`.
- The first research Session `ses_0979bf4ceffe1HObOz8VeDABev` and second research
  Session `ses_097987592ffeFDgct9O6E66WLz` both reached terminal `completed`; the
  Orchestrator continued dispatching further source research rather than terminating with
  the former Part-persistence error.
- A separate minimal real user prompt on the same isolated backend forced the exact
  CoinMarketCap producer path without modifying files or dispatching another agent:
  Chat Session `ses_097969958ffelH0jg85CpncvOk`, async prompt Task
  `tsk_f68696773001pFQO0meaxxBuRl`, tool Part
  `prt_f68697b7c001OQERpXiJQH9eaq`.
- The prompt reached `completed` with no error. Public messages showed
  `webfetchEmbeddedAttachmentCount: 2`, output markers
  `attachment:webfetch-embedded-1` and `attachment:webfetch-embedded-2`, two canonical
  `/attachment/<project>/<digest>.png` references, and a normal final assistant response.
- Authoritative read-only SQLite inspection of the same Part returned
  `status = completed`, `embedded_count = 2`, `instr(data, 'data:image') = 0`, and the two
  canonical attachment URLs. This proves the original failure boundary is repaired in the
  real model-to-tool-to-Part-to-database chain.

## Verification commands

- `bun test packages/opencorvus/test/tool/webfetch.test.ts packages/opencorvus/test/session/inline-base64-rejected.test.ts --timeout 180000`
  passed 14 tests and 45 assertions.
- Focused extra-tool materialization tests passed 2 tests and 7 assertions.
- `bun run typecheck` in `packages/opencorvus` passed.

The full long Mission remains intentionally running beyond this repair verification; this
record does not claim that the multi-phase cryptocurrency product has completed. The
verified scope is backend/database reset, real Mission re-entry, healthy research dispatch,
and the exact CoinMarketCap webfetch persistence boundary that previously terminated the
task.
