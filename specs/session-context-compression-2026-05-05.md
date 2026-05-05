# Session Context Compression Plan - 2026-05-05

## Goal

Make session context compression deterministic and provider-safe:

- automatic compaction must not enter a repeated compaction loop;
- common providers must not fail on media, oversized tool output, or known context-window errors;
- custom providers, especially the Hexin provider path, must have an explicit overflow contract instead of relying on accidental provider text;
- conversation continuity must preserve real user / assistant messages only, with no synthetic or hidden continuation messages.

## Evidence From Current Code

Local implementation:

- `packages/opencorvus/src/session/loop.ts`
  - `Message.filterCompacted(Message.stream(sessionID))` is the only prompt-history entry point inside the loop.
  - `collectLoopState` scans the compacted history and queues `compaction` / `subtask` parts before the last finished assistant message.
  - predictive compaction estimates prompt size before the model call and creates a `compaction` user part when the next request looks too large.
  - reactive compaction creates another `compaction` user part after a finished assistant turn reports usage over budget.

- `packages/opencorvus/src/session/compaction.ts`
  - `isOverflow` uses `limit.input` when present, otherwise `limit.context - maxOutputTokens`.
  - `process` currently summarizes the selected history, strips media, truncates tool output to 2,000 chars, and hard-stops if the compaction request itself returns `compact`.
  - `create` stores only `{ type: "compaction", auto }`.
  - there is no previous-summary anchor, no explicit retained tail, no `overflow` reason, and no durable pointer for where full recent history resumes.

- `packages/opencorvus/src/session/message.ts`
  - `CompactionPart` has no `tail_start_id` or `overflow` field.
  - `filterCompacted` keeps the latest completed compaction summary plus newer messages, then drops everything older.
  - `toModelMessages` already has the correct projection hook for compression: `stripMedia` and `toolOutputMaxChars`.

- `packages/opencorvus/src/provider/error.ts`
  - context overflow is classified from structured stream codes plus provider error text.
  - this protects many common provider messages, but the global text matcher is not a mature provider contract.

- `packages/opencorvus/src/server/routes/session.ts`
  - `/session/{sessionID}/summarize` is only a trigger; it creates a compaction part and re-enters the same loop.

- `packages/opencorvus/src/memory/flush.ts`
  - memory flush reads the latest assistant summary message and should continue to work if summary message shape remains unchanged.

Upstream opencode `sst/opencode` at `03544a26cde8c8671c9b3e0adde72b60ddb22520`:

- `packages/opencode/src/session/compaction.ts`
  - uses a strict Markdown summary template.
  - finds completed compactions and feeds the previous summary back as an anchor.
  - selects a recent tail by turn count and token budget.
  - stores `tail_start_id` on the compaction part.
  - strips media and caps tool output at 2,000 chars during compaction.
  - hard-stops when the compaction request also overflows.

- `packages/opencode/src/session/message-v2.ts`
  - `CompactionPart` includes `overflow?: boolean` and `tail_start_id?: MessageID`.
  - `filterCompacted` keeps the completed summary and, when `tail_start_id` exists, retains full recent messages starting at that message.

- `packages/opencode/src/session/overflow.ts`
  - centralizes usable-context math.

Non-portable upstream behavior:

- upstream has `MessageV2`, Effect services, V2 session events, and a different package path, so direct cherry-pick creates conflicts and dual architecture.
- upstream auto-continuation can create `synthetic: true` text. That violates this project rule that all conversation messages must be real participant messages.

## Root Cause

The current local design treats a completed compaction summary as a replacement for all older history, but it has no durable boundary for preserving recent uncompressed turns. When a session is too large because of recent heavy context, compaction can still receive too much input. If the provider reports the failure with wording outside the current classifier, the loop may treat it as a retryable API failure or keep creating compaction parts.

The problem is therefore systemic, not provider-specific:

1. selection is too coarse: summary plus all-newer messages, no controlled head/tail split;
2. summary is not anchored: repeated compactions summarize summaries loosely and can drift;
3. overflow reason is not persisted: manual compaction and provider-overflow compaction are indistinguishable;
4. provider overflow handling is text-oriented instead of a provider contract;
5. upstream's useful tail retention cannot be merged directly because its synthetic continuation conflicts with local rules.

## Target Architecture

There must be one compression implementation:

`SessionLoop -> SessionCompaction.create -> SessionCompaction.process -> Message.filterCompacted`

No separate summarizer, no CLI-only path, no provider-specific compaction path, and no synthetic continuation message.

### 1. Compaction Part Contract

Extend the existing `Message.CompactionPart` schema:

```ts
{
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}
```

Meaning:

- `auto`: created by automatic loop logic rather than user summarization.
- `overflow`: created because the previous real model request exceeded provider context, not just predictive threshold.
- `tail_start_id`: first message id in the retained recent tail.

The part is stored in the existing JSON part table, so no database migration is required.

### 2. Central Context Budget

Create a single local budget helper in `packages/opencorvus/src/session/context-budget.ts`:

```ts
usableContext({ config, model }): number
isUsageOverflow({ config, tokens, model }): boolean
```

Move the duplicated budget math out of `compaction.ts` and make predictive compaction call the same helper for the base usable budget. Keep current config fields:

- `compaction.auto`
- `compaction.prune`
- `compaction.reserved`
- `compaction.threshold`

Add only the two upstream-equivalent config fields that are required for deterministic tail selection:

- `compaction.tail_turns?: number` default `2`
- `compaction.preserve_recent_tokens?: number` default `min(8000, max(2000, floor(usableContext * 0.25)))`

### 3. Head/Tail Selection

Before calling the compaction model:

1. remove prior completed compaction user+assistant pairs from the candidate history;
2. extract the previous completed summary text as the summary anchor;
3. split the remaining messages into turns by real user message;
4. retain the most recent turns within `preserve_recent_tokens`;
5. send only the head to the compaction model;
6. write `tail_start_id` to the compaction part after successful selection.

The resulting future prompt history becomes:

```text
[compaction user part]
[assistant summary]
[full recent tail starting at tail_start_id]
[new real user/assistant messages]
```

This preserves exact recent tool calls and user intent while keeping older context summarized.

### 4. Anchored Summary Prompt

Replace the loose compaction prompt with a strict template based on upstream opencode:

- Goal
- Constraints & Preferences
- Progress
  - Done
  - In Progress
  - Blocked
- Key Decisions
- Next Steps
- Critical Context
- Relevant Files

When a previous summary exists, the prompt must say to update the anchored summary, preserve still-true facts, remove stale facts, and merge new facts.

This keeps repeated compactions stable instead of recursively summarizing summaries.

### 5. Provider Overflow Contract

Keep `Message.ContextOverflowError` as the single local error type.

Provider classification must become explicit:

- OpenAI-compatible providers: parse structured body fields first: `error.code`, `error.type`, `error.param`, and HTTP status `400` / `413` when paired with a known provider overflow code.
- Anthropic / Bedrock / Google / Groq / xAI / DeepSeek / Mistral adapters: add provider fixture tests for the exact `APICallError` body shape emitted by the adapter used in this repo.
- Hexin provider: require a normalized overflow signal in its gateway response, for example `error.code = "context_length_exceeded"` or `error.type = "context_overflow"`. The Hexin adapter must map that to `ContextOverflowError` before retry logic sees it.

The global text matcher should be reduced to a tested compatibility surface only where the upstream SDK exposes no structured field. New provider support must add a fixture test; it must not add an unverified broad keyword rule.

### 6. Overflow Recovery Without Synthetic Messages

When a real model request overflows:

1. classify it as `ContextOverflowError`;
2. create a compaction part with `auto: true, overflow: true`;
3. run compaction on history before the overflowing real user message when needed;
4. after successful compaction, the loop naturally sees the original real user message in the retained tail or the next user message.

Do not create any `synthetic` continuation message.

If the overflowing request contained media that cannot be retained, the assistant summary may record that the attachment was omitted from compressed context, but it must not impersonate a user follow-up.

### 7. Hard Stop Conditions

The loop must stop, not retry, when:

- compaction itself returns `compact`;
- compaction assistant message has any provider error;
- predictive decision says tool schema or non-compressible system prompt already exceeds budget;
- the selected recent tail alone exceeds the preserved tail budget and cannot be split without losing the active real user turn.

The user-facing error should include the measured cause: model id, usable budget, estimated history/tool/schema/media size, and whether the failure happened during normal generation or compaction.

## Implementation Steps

Status as of 2026-05-05:

1. [done] Add `context-budget.ts` and move budget calculation into it.
2. [done] Extend `CompactionPart` schema with `overflow` and `tail_start_id`.
3. [done] Add `completedCompactions`, `summaryText`, `turns`, `splitTurn`, and `selectCompactionInput` helpers in `session/compaction.ts`.
4. [done] Replace the compaction prompt with the strict anchored template.
5. [done] Update `SessionCompaction.process` to:
   - ignore previous completed compaction pairs;
   - anchor from the latest completed summary;
   - compact only selected head;
   - persist `tail_start_id`;
   - keep existing media stripping and tool-output cap;
   - hard-stop on compaction overflow.
6. [done] Update `Message.filterCompacted` to retain the full recent tail when `tail_start_id` is present.
7. [done] Update `SessionCompaction.create` and all callers to pass `overflow` where the trigger came from provider context overflow.
8. [partial] Add provider overflow fixture coverage for OpenAI-compatible, Mistral-style, and Hexin-normalized structured bodies. Full provider-directory tests still have environment/model-discovery failures outside the compression path.
9. [partial] Add regression tests for:
   - first compaction writes summary and `tail_start_id`;
   - [done] `filterCompacted` returns summary plus retained tail;
   - [done] compaction overflow produces one assistant error and no new compaction task;
   - [done] no exposed continuation builder or synthetic continuation path;
   - [covered by implementation, not isolated] second compaction uses previous summary as anchor.

## Merge Policy For Upstream Opencode

Do not merge upstream opencode wholesale.

Manually port these concepts:

- strict summary template;
- previous-summary anchor;
- completed-compaction hiding;
- recent tail selection;
- `tail_start_id`;
- compaction projection with media stripping and tool-output cap;
- hard stop on compaction overflow.

Do not port:

- `MessageV2` / Effect service architecture;
- V2-only session event plumbing;
- synthetic auto-continuation messages;
- upstream path/package layout changes.

This keeps the local architecture single-source while taking the mature parts of upstream's compression design.

## Acceptance Criteria

Unit tests:

- `packages/opencorvus/test/session/message.test.ts`
- `packages/opencorvus/test/session/compaction.test.ts`
- `packages/opencorvus/test/session/predictive-compaction-decision.test.ts`
- new provider overflow fixture tests for common providers and Hexin.

Required behavioral checks:

- repeated automatic compaction never creates an infinite compaction loop;
- compaction request does not include binary media;
- completed tool output in compaction request is capped;
- recent tail remains exact, not summarized;
- previous summary is updated, not recursively summarized;
- provider context overflow becomes `ContextOverflowError`;
- non-context provider errors remain normal API errors;
- no synthetic message is written.

Commands:

```powershell
bun test packages/opencorvus/test/session/message.test.ts packages/opencorvus/test/session/compaction.test.ts packages/opencorvus/test/session/predictive-compaction-decision.test.ts
bun test packages/opencorvus/test/provider
cd packages/opencorvus; bun run typecheck
```

Pre-push hook must pass without `--no-verify`.

## Current Maturity Assessment

The already-landed targeted fix is mature for stopping the most direct compaction overflow loop:

- compaction strips media;
- compaction caps tool output at 2,000 chars;
- compaction overflow hard-stops instead of recursively compacting;
- common overflow messages have broader coverage.

It is not yet the complete mature architecture described above. The missing production-grade pieces are durable tail retention, anchored repeated summaries, fixture-backed provider contracts, and Hexin's explicit overflow signal.
