# Codebase Text Inline-Payload Normalization

## Recall

### User request

- Explain and repair the reported `ProcessorUnsafeRetryError` whose nested cause is
  `InlineBase64InPartError`.
- Fix the producer that emitted inline image data into a persisted Part; do not weaken
  the strict persistence boundary or hide the failure with retries.

### Acceptance criteria

- The exact reported `search_code` invocation can return a source line containing an
  inline base64 data URL without terminating the assistant message.
- Persisted text-tool output and metadata contain no inline data URL or raw binary
  payload.
- The readable source line, file, line number, media type, and omitted payload length
  remain available as safe diagnostic context.
- Registry and workflow codebase read/search tools use one canonical redactor.
- `Session.updatePart` rejection and `SessionProcessor` unsafe-retry protection remain
  unchanged.
- Focused regressions, package typecheck, and required document-health checks pass.

### Hard constraints

- No fallback, compatibility branch, retry loop, state machine, route bypass, or weakened
  schema.
- A source-code literal is text evidence, not an attachment. It must be normalized at the
  codebase-text producer boundary rather than written as a fake image attachment.
- Real image/PDF tool results continue to use the existing typed attachment surface and
  `AttachmentStore`.
- Existing unrelated worktree changes and the running OpenCorvus/Overlay processes remain
  untouched.
- Commit subjects start with `dsw-33987`; pushes use `legacy-remote` and do not bypass hooks.

### Evidence read

- `specs/records/2026-07/2026-07-16-webfetch-inline-attachment-e2e.md`
- `specs/records/2026-07/2026-07-20-inline-base64-retry-evidence-poison.md`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/session/processor.ts`
- `packages/opencorvus/src/util/inline-base64.ts`
- `packages/opencorvus/src/tool/grep.ts`
- `packages/opencorvus/src/tool/read.ts`
- `packages/opencorvus/src/engine/codebase-tools.ts`
- `packages/opencorvus/test/tool/grep.test.ts`
- Read-only public session-message responses from the running backend at
  `http://127.0.0.1:7878`.

### Runtime evidence

- Session `ses_06e006059ffe0CK2qQ5TqylOJg`, assistant message
  `msg_f9201a12e001mPUyhm2D4SSLwM`, and tool Part
  `prt_f9202065b001D28aWw6E2MtYDY` reproduce the user's exact error.
- The failing Part is `search_code`, not an image or Browser tool. Its pattern was
  `sessionPromptParts|presentation.*attachment-index|user_message|type.*file` under
  `packages/overlay/test`.
- The matching source line is
  `packages/overlay/test/screenshot-browser-panel.test.ts:93`, whose test fixture contains
  the literal `data:image/png;base64,AAAA`.
- The nested diagnostic reports `media=image/png payload_chars=4`, which exactly matches
  that fixture literal.
- Tool execution had already started and sibling Parts existed, so
  `SessionProcessor` correctly refused an in-message retry.

### Whole-repository search

The investigation searched the repository for `ProcessorUnsafeRetryError`,
`InlineBase64InPartError`, `AttachmentStore.write`, `search_code`,
`sanitizeInlineDataUrisForPrompt`, `redactInlinePayloads`, tool-result attachments, and
inline data URL fixtures.

| Call site or sibling | Decision |
| --- | --- |
| `src/util/inline-base64.ts::redactInlinePayloads` | Keep as the canonical text normalizer. |
| `src/session/index.ts::assertPartDataHasNoInlineBase64` | Keep unchanged as the strict persistence-integrity boundary. |
| `src/session/processor.ts::ProcessorUnsafeRetryError` | Keep unchanged; it prevents duplicate tool side effects. |
| `src/tool/grep.ts::SearchCodeTool` | Normalize assembled textual search output before returning it. |
| `src/tool/read.ts::ReadTool` text branch | Normalize persisted output and preview metadata; preserve typed image/PDF attachments. |
| `src/engine/codebase-tools.ts` private regular expression and sanitizer | Delete the duplicate implementation and call the canonical normalizer for workflow read/search. |
| `src/tool/webfetch.ts` embedded image extraction | Keep unchanged; web content owns real embedded attachments rather than source-code literals. |
| `src/session/loop.ts::materializeToolResultAttachments` | Keep unchanged; it materializes declared real attachments. |
| `test/tool/grep.test.ts` | Add registry search/read and workflow search/read regressions using the exact four-character fixture. |
| Strict persistence tests | Keep unchanged; the guard must continue rejecting unnormalized producers. |

### Independent agent feedback

No sub-agent was used. The user did not request multiple agents or parallel audit, and the
runtime Part plus exact repository fixture provided a complete causal chain.

## Causal chain

1. `search_code` read a source line containing a base64 data URL test fixture.
2. The registry search tool returned that line verbatim in `result.output`.
3. Session tool-result persistence attempted to write the completed Tool Part.
4. The strict Part guard detected the inline data URL and raised
   `InlineBase64InPartError`.
5. Because tool execution and sibling Part creation had already started, an in-message
   retry could duplicate side effects, so the processor raised `ProcessorUnsafeRetryError`.

The deep defect is inconsistent codebase-text normalization: workflow read/search already
redacted inline data URLs with a private regular expression, while registry read/search
returned the same source text raw. The persistence guard and retry policy are downstream
symptoms and are behaving correctly.

## Implementation plan

1. Replace the workflow-only regular expression with
   `redactInlinePayloads` from the canonical utility.
2. Normalize registry `search_code` output after match assembly.
3. Normalize registry `read` text output and preview metadata without touching the
   image/PDF attachment branch.
4. Add production-shaped regressions for all four codebase text surfaces.
5. Run focused tests, package typecheck, historical-document links, document health, and
   final diff review.

## Verification

- `bun test packages/opencorvus/test/tool/grep.test.ts packages/opencorvus/test/session/inline-base64-rejected.test.ts --timeout 180000`
  passed 20 tests and 68 assertions.
- The persistence regression executes registry `search_code`, writes its completed Tool
  Part through strict `Session.updatePart`, reads the durable row back, and proves the
  output contains the safe marker but no inline data URL.
- `bun run typecheck` in `packages/opencorvus` passed.
- `historical-docs-links.test.ts` passed all 22 tests in the combined documentation run.
- The combined document-health run passed 77 tests and failed 5 because concurrent
  architecture work currently deletes tracked files before replacements are staged,
  changes current panel wording, and leaves multiple July records untracked. The failures
  name `mirror-code/expert-squad.jsonc`, `15-agent-context-packet.md`, current panel
  assertions, and untracked monthly-record targets. None is in this repair's code path;
  the repository-wide document-health suite is therefore not claimed as passing.

## Codex second review

- Re-grep found no remaining `sanitizeInlineDataUrisForPrompt` private implementation.
- Registry and workflow read/search all call `redactInlinePayloads`; real image/PDF read
  results still use declared attachments and central `AttachmentStore` materialization.
- The exact `AAAA` fixture no longer appears in persisted output, while media type and
  payload length remain visible through `inline_binary_omitted`.
- `Session.updatePart`, `ProcessorUnsafeRetryError`, webfetch attachment extraction, and
  central tool attachment materialization have no diff.
- No running OpenCorvus/Overlay process was restarted, refreshed, or terminated.
