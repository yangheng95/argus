# Compaction handoff validator ↔ prompt misalignment (2026-05-24)

> Hand-off brief for codex. Read every section before proposing edits.
> Follow CLAUDE.md strictly. Rules cited inline.

## 0. Symptom that triggered this investigation

Today's smoke test: real compaction on G2 build session
`ses_1aac55945ffe5hUxu5oHnHivLi` (task `tsk_e54fd9b93001TrVXWDz5L4KdzM`)
via `POST /session/.../summarize` with `glm51/glm51`.

- POST returned `false`.
- A `msg_e58f4f26f0010VzNFWcOIW4kK8` row was persisted with
  `finish="error"`, error name `StructuredOutputPayloadError`, reason
  `Compaction handoff omitted required evidence fields: files, errorsAndBlockers`.
- The model actually emitted a well-formed handoff (8 file entries, 2
  errorsAndBlockers entries, 16 evidence entries) — the validator
  rejected it on **string-equality grounds**, not structural ones.

## 1. Empirical impact (DB scan over user runtime DB)

DB: `C:\Users\hengu\.local\share\opencorvus\opencorvus.db`

- 13 compaction messages total in the DB
- **10/13 = 77 % failed**
- **7/10 failures share the exact same signature** `"omitted required evidence fields: files, errorsAndBlockers"`
- 2/10 are `ContextOverflowError` (different bug — out of scope)
- 1/10 is just `"omitted required evidence fields: files"`
- Build sessions: **9/10 compactions failed**
- Explore sessions: 3/3 compactions succeeded (smaller patch/error surface)
- Session `ses_1aa86210affeNo0Ow1u8Kv4b8D` fired compaction **7 times
  in 2.6 hours**, each with identical validator error — there is no
  self-correction loop
- **All 13 compaction messages have `data.model.providerID/modelID = null`.**
  Even today's POST that explicitly passed `glm51/glm51` ends up null on
  disk. Separate bug, see §4.

This is not a one-off. It is systemic for build sessions, which are the
ones that most need compaction.

## 2. Root cause #1 — Path triple source (violates CLAUDE.md rule 8)

Path of the same file lives in **three forms** with no normalization
layer:

1. **Git relative**: `git diff --name-only` emits `server/db/schema.ts`.
2. **Absolute (worktree-joined)**: `snapshot/index.ts:160-168` does
   `path.join(Instance.worktree, x).replaceAll("\\", "/")`. The patch
   part stored in `part(data)` is now
   `D:/myhexin-local/.../worktree/server/db/schema.ts`.
3. **LLM echo**: the model receives `<patch-evidence>files=…</patch-evidence>`
   text rendered from those absolute paths, but its `files[].path`
   answers in worktree-relative form (`server/db/schema.ts`) — a
   reasonable guess given the prompt says only `"exact path"`.

Validator (`session/compaction-handoff.ts:178-184`) does set-difference
on raw strings → all required paths "missing".

Concrete pointers (all in `packages/opencorvus/src`):

- `snapshot/index.ts:160-168` — path absolutization point.
- `snapshot/index.ts:464` — `toWorktreeRelative()` helper that already
  exists but is **only used by `revert()`**, never by the evidence chain.
- `session/compaction.ts:145-147` — `selectedHeadEvidenceRequirements`
  consumes the absolute paths verbatim into `requirements.patchFiles`.
- `session/compaction.ts:~115-128` — `formatPatchEvidence` /
  `<patch-evidence>` block construction; injects the absolute paths
  into the prompt as prose.
- `session/compaction-handoff.ts:178-184` — exact-match set difference.

## 3. Root cause #2 — Canonical errorNames are invented host-side, never shown to the model (violates CLAUDE.md rule 6.1 prompt-over-host)

`session/compaction.ts:142,149` builds the canonical set:

```
errorNames.add(msg.info.error.name)             // e.g. "StructuredOutputPayloadError"
errorNames.add(`${part.tool} tool error`)        // e.g. "StructuredOutput tool error"
```

These strings exist **only in the validator's expectation**. They are
never written into the prompt, never enumerated for the model.
`MODEL_OUTPUT_INSTRUCTIONS` (`compaction-handoff.ts:125-136`) says
*"include that exact error name in error evidence or errorsAndBlockers.evidence"*
but "that exact error name" has no antecedent the model can see.

glm51's perfectly sensible response: write natural-language `issue`
text like `"better-sqlite3 native bindings not built…"`. Set difference
vs `{"read tool error","edit tool error","StructuredOutput tool error","StructuredOutputPayloadError"}`
is the entire set → "errorsAndBlockers" flagged missing.

This is the canonical rule 6.1 reverse case: validator demands a
contract that the prompt never communicates.

## 4. Root cause #3 — Compaction message `model` field persisted as null

Even though today's POST passed `{providerID:"glm51", modelID:"glm51"}`,
the resulting compaction message row has `data.model.providerID = null`
and `data.model.modelID = null`. All 13 compaction rows in the DB
share this. Separate but related — without per-model attribution it is
impossible to track which model fails compaction.

Investigate where the compaction assistant message is constructed (very
likely in `session/compaction.ts::create` / `process`, and/or the
`processor.message = …` assignment in the routes path) and route the
`source.model` through.

## 5. Root cause #4 — Failure behavior bifurcates

When validation fails:

- `session/compaction.ts` writes `processor.message.error = new Message.StructuredOutputPayloadError(...)`, sets
  `finish = "error"`, and returns `"stop"` from the loop (no retry).
- BUT downstream session behavior split: G2's session
  (`ses_1aac55945ffe...`) **terminated** right after the failed
  compaction. Session `ses_1aa86210affe...` kept running normal build
  turns after each of 7 failures.

Pick one semantics (hard fail the goal, OR persist the failed
compaction marker and continue from un-compacted context) and make it
deterministic. The current behavior is accidental.

## 6. CLAUDE.md rules at play

- **Rule 1**: 看本质 — the symptom is "glm51 missed required fields";
  the actual bug is double-source paths + missing prompt contract.
- **Rule 6**: 利用 LLM 智能简化 — but only if the model can SEE what
  it must produce.
- **Rule 6.1** prompt-over-host-invariant: when "model chose wrong
  string", the default fix is prompt, not host validator widening.
  Path normalization is data-correctness (legitimate host fix). Error-
  name visibility is the prompt fix.
- **Rule 8** 禁止双源: paths in 3 forms is a textbook violation.
- **Rule 13** 禁状态机 — don't add a status-machine retry layer to
  paper over this. Fix the contract, not the recovery.
- **Rule 16/17** 禁兼容补丁: any normalize helper should be the
  single source thereafter; do not leave the old path in place "for
  legacy callers".
- **Rule 28/36** 测试要求: every fix needs a test that pins the new
  contract (a glm-class structured-output blob with relative paths
  must now PASS validation; the absolute-path requirement that used to
  trip it must FAIL if the new normalization regresses).
- **Rule 35** 穷举调用点: before changing
  `selectedHeadEvidenceRequirements` or `formatPatchEvidence` or
  `validateMinimumEvidence`, grep every caller and decide each.

## 7. What I'm asking codex to do

### 7.1 Independent review (rule 24 二次审查)

Read §§2-5 with fresh eyes. Verify each pointer with grep / file
reads. **Do not trust my synthesis** — if my line citations are off,
correct them; if my root-cause taxonomy missed a dimension, add it.
Quote real code in your review notes.

### 7.2 Implementation

Two coordinated edits, mandatory in the same PR (rule 8: no parallel
worlds):

**A. Path single source.** Pick one normalized form (recommend
worktree-relative with forward slashes). Apply it at exactly one
chokepoint and have BOTH the validator's `requirements.patchFiles`
AND the prompt's `<patch-evidence>` block consume that single form.
The model now sees relative, validator demands relative — same space.
Delete the absolute-path version from the evidence chain (rule 16: no
compat shim).

**B. Canonical error/path injection.** Add explicit prompt blocks
that enumerate the canonical token sets the validator will check,
e.g.:

```
<required-file-evidence>
server/db/schema.ts
server/db/connection.ts
…
</required-file-evidence>

<required-error-evidence>
StructuredOutput tool error
StructuredOutputPayloadError
…
</required-error-evidence>
```

…and update `MODEL_OUTPUT_INSTRUCTIONS` to say "every token inside
`<required-…>` MUST appear verbatim in `files[].path` /
`errorsAndBlockers[].{issue,evidence}` / `evidence[].value`."

This is the rule 6.1 fix: teach the model via prompt, do not add a
host-side fuzzy matcher.

### 7.3 Secondary fix (model field null)

Route `source.model` (providerID/modelID) into the persisted
compaction assistant message. Single source — wherever the existing
`Message.Assistant` is constructed in the compaction path. Add a test
that runs `SessionCompaction.create({model:{providerID:"x",modelID:"y"}})`
and asserts the persisted message has the same pair.

### 7.4 Failure-behavior unification (lowest priority)

Decide whether a failed structured-output handoff:
(a) hard-fails the goal/task, OR
(b) is recorded as a structured-output error message but the session
    continues from un-compacted history (this would also mean the
    compaction was a no-op for context-budget purposes, which has to
    be honored by the next isOverflow check).

Whichever you pick, write a regression test that proves the OTHER
sessions in this DB behave the same way.

### 7.5 Tests required (rule 36)

- Validator unit test: a handoff with worktree-relative paths passes
  the new normalized comparator.
- Validator unit test: a handoff that genuinely omits a known patch
  file still fails.
- Prompt construction test: `<required-file-evidence>` /
  `<required-error-evidence>` blocks list every token from
  `requirements.patchFiles` / `requirements.errorNames`.
- Integration: replay G2's stored handoff (`msg_e58f4f26f0010VzNFWcOIW4kK8`
  input payload — read it from the user's DB read-only) and assert it
  now passes with the new validator + normalization. Treat it as a
  golden fixture.
- Persistence test for §7.3.

### 7.6 Process discipline (rule 33)

Commit + push when each coherent edit lands; do not bundle the four
fixes into one giant commit. Pre-push hook runs typecheck + api:routes
+ docs; if it fails, fix the root cause (no `--no-verify`).

## 8. Out of scope

- The `ContextOverflowError` failures (2/10). Separate session-size
  problem.
- Any UI changes. Overlay was just rebuilt — leave it alone.
- The notify-error persistence work that landed earlier today — also
  done.

## 9. Where to look first (suggested grep order)

```
packages/opencorvus/src/session/compaction.ts
packages/opencorvus/src/session/compaction-handoff.ts
packages/opencorvus/src/snapshot/index.ts        # path absolutization + toWorktreeRelative
packages/opencorvus/src/snapshot/types.ts        # patchEvidenceSummary / formatPatchEvidence
packages/opencorvus/src/agent/prompt/compaction.txt
packages/opencorvus/src/server/routes/session.ts # /summarize route
packages/opencorvus/test/session/compaction.test.ts
packages/opencorvus/test/session/predictive-compaction-decision.test.ts
```

When done, report back with: the diff summary, the test names that now
pin the new contract, and any deviations from this brief (rule 35:
flag deviations explicitly, do not silently rewrite).
