# Compaction must preserve the dispatcher's first user message (2026-05-24)

> Hand-off brief for codex. CLAUDE.md rules apply. Read fully before editing.

## 0. The rule (asserted by user 2026-05-24, durable)

The dispatcher's **first user message** in any opencorvus session is the
mission anchor and **must NEVER be compressed or elided by compaction**.

- In a `build` / `integrity` / `architect` sub-session the first user
  message is the orchestrator-injected goal contract.
- In a `root` / `orchestrator` session the first user message is the
  original human-user prompt.
- In every case it carries the load-bearing intent the agent must remain
  faithful to. A model-produced `userMessages[]` summary inside a
  CompactionHandoff is a reformulation, not the anchor.

This is a hard rule (rule 1 / 6.1 / 8). The post-compaction LLM-visible
message stream must always be:

```
[dispatch anchor]  +  [compaction marker w/ summary of middle]  +  [preserved tail turns]
```

…not the current behavior of:

```
[compaction marker w/ summary of (head incl. dispatch)]  +  [preserved tail turns]
```

## 1. Current behavior (verified 2026-05-24)

### 1.1 `selectCompactionInput` — `packages/opencorvus/src/session/compaction.ts:319-359`

```ts
const limit = input.config.compaction?.tail_turns ?? ContextBudget.DEFAULT_TAIL_TURNS // = 2
...
const all = turns(input.messages)
if (!all.length) return { head: input.messages, tail_start_id: undefined }
const recent = all.slice(-limit)
...
if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
return { head: input.messages.slice(0, keep.start), tail_start_id: keep.id }
```

- `turns()` (line 296-312) groups messages by user-message boundaries.
- For a build sub-session with **1 dispatch + N assistant turns**,
  `turns().length === 1`. `recent = [the only turn]`. `keep.start === 0`
  → degenerate early-return: `head = ALL`, `tail_start_id = undefined`.
  Compaction LLM is still invoked, summarizes everything, but
  `filterCompacted` finds no tail_start_id and breaks → nothing dropped
  → run wasted glm51 tokens for no context reduction.
- For sessions with **≥3 user messages**, `keep.start > 0`, the dispatch
  (index 0) is in `head` → fed to compaction LLM as material to
  summarize, then dropped from LLM visibility by `filterCompacted`.

### 1.2 `Message.filterCompacted` — `packages/opencorvus/src/session/message.ts:1104-1135`

Iterates newest→oldest. When it finds a successful compaction marker
with `tail_start_id`, it sets a retain pointer, keeps everything newer
than the marker, then walks back until it hits `tail_start_id`, and
splices off everything strictly between `tail_start_id` and the marker.
**Nothing in the function preserves the session's first user message
as a special anchor.**

### 1.3 Net behavior today

- Build session (1 user msg): compaction is a no-op for context size,
  but spends LLM tokens on a discarded summary. The dispatch survives
  only because `tail_start_id` is undefined (accidentally correct).
- Multi-user-msg session: dispatch IS lost (summarized into handoff
  `userMessages[]` / `objective`, then row hidden by `filterCompacted`).
  This is the bug.

### 1.4 Carry-over fields that already preserve dispatch metadata

`SessionCompaction.create` (`compaction.ts:629-639`) copies the source
user message's `system`, `systemMode`, `agent`, `format`, `tools`,
`variant`, `extra` onto the new compaction marker. So system/tool
constraints survive; only the dispatch CONTENT is lost. The new rule
demands the content survives too.

## 2. The fix (three zones, not two)

Introduce an explicit anchor zone:

```
anchor (== messages[firstUserIdx])
   |
   v
head = messages.slice(firstUserIdx + 1, keep.start)  // to summarize
   |
   v
tail = messages.slice(keep.start)                    // preserved verbatim
```

The compaction marker carries `tail_start_id` AS BEFORE. The loader
(`filterCompacted`) is changed to also always yield the anchor.

### 2.1 `selectCompactionInput` changes

- Find `firstUserIdx = messages.findIndex(m => m.info.role === "user" && !m.parts.some(p => p.type === "compaction"))`. Skip prior compaction
  markers when locating the anchor.
- If `firstUserIdx < 0` → no anchor exists yet → return early (no
  compaction); rule 1: do not invent state for empty inputs.
- If `keep.start <= firstUserIdx + 1` → head is empty (nothing
  compactable between anchor and tail) → return early; **do not call
  the compaction LLM** (saves tokens for build-sub-session case).
- Otherwise return `{ anchorID: messages[firstUserIdx].info.id, head: messages.slice(firstUserIdx + 1, keep.start), tail_start_id: keep.id }`.

### 2.2 Compaction marker payload — `Message.CompactionPart`

Add a new optional field `anchor_id?: string` alongside `tail_start_id?: string`
in `packages/opencorvus/src/session/message.ts` (search `CompactionPart` /
`tail_start_id`). The compaction-creation path writes the anchor's
message id into this field at the same time it writes `tail_start_id`.

### 2.3 `Message.filterCompacted` changes

When a compaction marker is encountered:

- Continue current behavior of retaining via `tail_start_id`.
- Additionally: if `part.anchor_id` is set, after the splice, ensure
  the anchor message ends up at position 0 of the final reversed
  result. Practical implementation: while iterating, set a second
  retain pointer that ALWAYS keeps the message whose id matches
  `anchor_id`; do not splice it off even if it falls between marker
  and tail_start_id.
- After `result.reverse()`, the anchor must appear before the
  compaction marker.

### 2.4 Compaction LLM prompt changes — `packages/opencorvus/src/session/compaction.ts`

In `buildPrompt` and the `<handoff-runtime-state>` / `<patch-evidence>`
assembly:

- The anchor message must be passed to the model in a dedicated
  `<dispatch-anchor>...</dispatch-anchor>` block at the TOP of the
  prompt, with a one-sentence directive that this content is preserved
  verbatim post-compaction and the summary should NOT re-summarize it
  in `userMessages[]` (or, equivalently, instruct the model that
  `userMessages[]` should cover only the post-anchor user turns).
- Do NOT include the anchor in the conversation messages being
  summarized (the `head` slice already excludes it per §2.1, so this
  is automatic for that surface; just be explicit in the prompt).

### 2.5 `validateMinimumEvidence` interaction

Two-line check:

- `requirements.sourceUserMessageID` currently equals the source user
  message id passed to `compaction.create`. Verify this still maps to
  the right message. In the new design, source is still the most-recent
  user message (current behavior at `server/routes/session.ts:589-598`),
  which is fine — the anchor is a SEPARATE concept and doesn't change
  the source.
- `requirements.userMessages` becomes "true if any user message
  POST-anchor has non-empty text content". The anchor's own text is
  not counted (it's preserved verbatim, no need to require its
  summarization).

### 2.6 Tests required (rule 36)

- Unit: `selectCompactionInput` with 1 user msg + 5 assistant turns →
  returns `{ head: [], tail_start_id: undefined }` (skip compaction).
- Unit: `selectCompactionInput` with 3 user msgs → returns `head` that
  excludes index 0, `anchor_id = messages[0].id`, `tail_start_id =`
  some later turn.
- Unit: `filterCompacted` with a successful marker that carries
  `anchor_id` → final stream begins with the anchor message, then the
  marker, then the tail.
- Unit: `filterCompacted` backward compatibility: a marker WITHOUT
  `anchor_id` (legacy from before this change) still works exactly as
  today (`tail_start_id`-only semantics). Use a fixture with no
  anchor_id field.
- Integration: end-to-end `SessionCompaction.create` →
  `Session.messages` → `filterCompacted`: assert the dispatch text
  remains visible verbatim post-compaction.
- Prompt construction test: when the new `<dispatch-anchor>` block is
  in the prompt, the anchor's text appears verbatim; the head slice
  fed to the model does NOT contain the anchor's content.

### 2.7 Backwards compatibility (rule 16 / 17)

- Legacy `Message.CompactionPart` rows in the DB will not have
  `anchor_id` → `filterCompacted` must still work (covered by §2.6
  test). No data migration needed; the field is optional.
- New compaction markers always set `anchor_id` when an anchor exists.

## 3. CLAUDE.md rules at play

- **Rule 1** — fix the real issue (dispatch content lost), not just the
  symptom (model summary is lossy).
- **Rule 6 / 6.1** — solve via prompt + data model, no fuzzy matching.
- **Rule 8** — single source for "what is the anchor": `anchor_id` on
  the compaction part. Do not parallel-derive it in the loader.
- **Rule 13** — no status-machine retries; one-shot compaction is fine.
- **Rule 17** — when adding `anchor_id`, also remove the degenerate
  "head = ALL, tail_start_id = undefined" early return that wastes
  glm51 tokens on a no-op (it's dead code under the new design).
- **Rule 33** — commit + push per coherent change; pre-push hook
  (typecheck / api:routes / docs) must pass without `--no-verify`.
- **Rule 35** — grep every caller of `selectCompactionInput`,
  `filterCompacted`, `CompactionPart.tail_start_id`,
  `CompactionPart.anchor_id` (after you add it) and update all sites.
- **Rule 36** — see §2.6.

## 4. Files to read first

```
packages/opencorvus/src/session/compaction.ts         # selectCompactionInput, create, process, prompt
packages/opencorvus/src/session/message.ts            # filterCompacted, CompactionPart schema
packages/opencorvus/src/session/compaction-handoff.ts # validator + render
packages/opencorvus/src/server/routes/session.ts      # /summarize source-picking logic
packages/opencorvus/test/session/compaction.test.ts
packages/opencorvus/test/session/compaction-continue-inherit.test.ts
packages/opencorvus/test/session/compaction-evidence-contract.test.ts  # just landed today
```

## 5. Out of scope

- The `ContextOverflowError` handling. Separate.
- Changing `tail_turns` default. Independent tuning.
- Failure-behavior unification (already decided not to touch).
- Today's compaction-evidence-contract fix is already on
  `codex/task-session-runtime-isolation` (commits `4efdeb0ec` /
  `19eb27ad3`); build on top of it.

## 6. Report back with

- Per-commit diff stats.
- Test names that now pin the dispatch-anchor preservation contract.
- Any deviations from this brief with reasoning (rule 35: flag, don't
  silently rewrite).
- Whether the build-sub-session "compaction-is-noop, skip the LLM
  call" optimization landed (it's required by §2.1).
