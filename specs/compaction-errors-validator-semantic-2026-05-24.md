# Compaction errorsAndBlockers validator: stop demanding verbatim runtime-token echo (2026-05-24)

> Hand-off brief for codex. CLAUDE.md rules apply. Read fully before
> editing. **Do NOT declare success based on your own fixture tests
> passing.** This brief mandates real-data replay verification.

## 0. Why this brief exists

I previously dispatched codex to fix the compaction validator and
confirmed the path-side fix end-to-end. But on real production data
(G28 V4 of task `tsk_e5894b981001dZJs5p0E2Dt6P1`), even with all of
today's `4efdeb0ec` + `786b02a77` shipped and the server restarted,
**the new validator still rejects** with the same signature:

```
{ "success": false, "error": "Compaction handoff omitted required evidence fields: errorsAndBlockers" }
```

User correctly challenged my "fixed" claim with `证据呢` (where's the
evidence). My empirical verification on real data is documented below
— it is the only acceptable form of proof for this brief.

## 1. What I verified empirically (you must re-run this before editing)

DB readonly fixture: `C:/Users/hengu/.local/share/opencorvus/opencorvus.db`.
G28 V4 build session: `ses_1a65b06e4ffenN44slTAUds19S`.
Failed compaction message: `msg_e59aa9d68001NVVmrF2nPj9mrO`.

Reproduce:

```
bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('C:/Users/hengu/.local/share/opencorvus/opencorvus.db', { readonly: true });
const sid='ses_1a65b06e4ffenN44slTAUds19S';
const compMsg = db.prepare(\"SELECT id FROM message WHERE session_id=? AND json_extract(data,'\$.agent')='compaction' ORDER BY time_created DESC LIMIT 1\").get(sid);
const toolPart = db.prepare(\"SELECT data FROM part WHERE message_id=? AND json_extract(data,'\$.type')='tool'\").get(compMsg.id);
const handoff = JSON.parse(toolPart.data).state.input;
// patch files (stored worktree-relative after the path normalization fix)
const patches = db.prepare(\"SELECT data FROM part WHERE session_id=? AND json_extract(data,'\$.type')='patch'\").all(sid);
const patchFiles = new Set();
for (const p of patches) for (const f of (JSON.parse(p.data).files||[])) patchFiles.add(f);
// canonical error names the OLD validator demands
const toolErrs = db.prepare(\"SELECT distinct json_extract(data,'\$.tool') as t FROM part WHERE session_id=? AND json_extract(data,'\$.type')='tool' AND json_extract(data,'\$.state.status')='error'\").all(sid);
const asstErrs = db.prepare(\"SELECT distinct json_extract(json_extract(data,'\$.error'),'\$.name') as n FROM message WHERE session_id=? AND json_extract(data,'\$.role')='assistant' AND json_extract(data,'\$.error') IS NOT NULL\").all(sid);
const errorNames = new Set();
for (const e of toolErrs) errorNames.add(\`\${e.t} tool error\`);
for (const e of asstErrs) if (e.n) errorNames.add(e.n);

const requirements = {
  sourceUserMessageID: handoff.currentState?.sourceUserMessage?.id || 'unknown',
  instructionPaths: [],
  patchFiles: [...patchFiles],
  errorNames: [...errorNames],
  userMessages: true,
  fileEvidence: patchFiles.size > 0,
  errorsAndBlockers: errorNames.size > 0,
  acceptanceCriteria: true,
};
const mod = await import('./packages/opencorvus/src/session/compaction-handoff.ts');
console.log('verdict:', JSON.stringify(mod.CompactionHandoff.validateMinimumEvidence(handoff, requirements)));
console.log('emitted errorsAndBlockers:', JSON.stringify(handoff.errorsAndBlockers, null, 2));
"
```

Current verdict (HEAD = `69d9dda5b`):

```
verdict: {"success":false,"error":"Compaction handoff omitted required evidence fields: errorsAndBlockers"}
```

What the model actually emitted in `errorsAndBlockers`:

```json
[
  {
    "issue": "Changes are uncommitted - need git add, git commit, merge_back, then report_build_result",
    "evidence": "git status shows 14 modified and 1 untracked file",
    "nextAction": "Run git add -A, git commit, merge_back, then report_build_result with status=passed"
  }
]
```

Compared to canonical `errorNames` requirements:
- `read tool error`
- `bash tool error`
- `StructuredOutput tool error`
- `StructuredOutputPayloadError`

**Zero textual overlap.** Set difference fails the validator. But the
model DID emit a real, evidence-backed, action-bearing blocker entry —
it just didn't echo the host's internally synthesized
`"${tool} tool error"` / Error-class-name strings.

## 2. Root cause (CLAUDE.md rule 1)

The validator demands the model **echo runtime-synthesized internal
strings verbatim**. Two problems:

1. **No semantic relationship.** `"read tool error"` is a host-side
   synthesized label (`${part.tool} tool error` at
   `compaction.ts:149`). The model has no way to know if its real
   business issue ("Changes are uncommitted") corresponds to that
   synthetic label.

2. **Wrong contract.** What the user *needs* to know post-compaction
   is "did errors happen and did the agent acknowledge them"; that is
   a **semantic** check, not a string-set-equality check. The current
   strict-echo contract treats `errorsAndBlockers` like a foreign-key
   column.

This is the classic rule 6.1 reverse case: host-side enforcement of
something the prompt can't reliably teach. glm51 in real G28 data
empirically refuses to comply (looked at the prompt block, chose to
write business-level issue instead). Forcing harder via prompt won't
fix it — the contract itself is wrong.

For `patchFiles` the strict contract IS reasonable — paths are exact
identifiers the model receives verbatim in `<patch-evidence>` and can
echo without paraphrase. **Do not loosen the files side.** Empirical
G28 V4 shows the files side passes today.

## 3. Required change

### 3.1 Validator: `compaction-handoff.ts::validateMinimumEvidence`

Replace the current `errorsAndBlockers` check (lines ~186-193, the
set-difference on `errorNames` ↔ `reportedErrorNames`) with a
semantic check:

- Pass when **all** of these hold:
  - `handoff.errorsAndBlockers.length >= 1` (at least one acknowledgment)
  - Every entry has non-empty `issue` AND non-empty `evidence` AND non-empty `nextAction`
    (the Zod schema already requires this; assert defense-in-depth)
  - `handoff.errorsAndBlockers.length` plus
    `handoff.evidence.filter(e => e.kind === "error").length` together
    is `>= min(requirements.errorNames.length, 3)` — i.e. at most we
    require three documented blocker entries regardless of how many
    runtime errors fired (a single root-cause failure often produces a
    cluster of tool errors). The 3 ceiling prevents the validator
    from over-demanding when the model has correctly identified the
    single underlying issue behind many symptom tool errors.
- Fail otherwise with a clear message that distinguishes
  "no entries at all" vs "too few entries" vs "empty issue/evidence
  fields".

Keep the **files** check unchanged. Keep the
`requirements.errorsAndBlockers` gate unchanged (only validate when
`errorNames.size > 0` in the source session).

### 3.2 Prompt: keep `<required-error-evidence>` block but rewrite intent

The block in `compaction.ts::runtimeContext` and the
`MODEL_OUTPUT_INSTRUCTIONS` line for required-error-evidence should
shift from "MUST appear verbatim" to "informs you which runtime
errors occurred — write one entry in errorsAndBlockers per distinct
root cause, in your own words". Specifically:

- Rename the rendered block from `<required-error-evidence>` to
  `<runtime-error-context>` (the OLD name implied "echo this", new
  name says "here's what happened").
- Update `MODEL_OUTPUT_INSTRUCTIONS` line about that block: replace
  the "MUST appear verbatim" sentence with: `"The
  <runtime-error-context> block lists internal error tokens collected
  during this session. For each distinct root cause, write at least
  one errorsAndBlockers entry in your own words with concrete issue,
  evidence, and nextAction. Verbatim echo of the internal tokens is
  not required."`
- Keep the file-evidence block + instruction line UNCHANGED — that
  one IS strict-echo and the empirical data shows the model complies.

### 3.3 Requirements assembly: minimal-surface change

Inside `selectedHeadEvidenceRequirements`
(`compaction.ts:130-162`), keep the existing `errorNames` collection
(it still feeds the prompt context). No structural change there.

### 3.4 Backwards compat (rule 16, no double source)

- Old `<required-error-evidence>` tag name is removed; no need for a
  rename shim — handoffs in flight when the rename lands will at
  worst see the new tag and the new instruction, which is a strict
  superset of correct behavior.
- The validator change is monotonic: anything that passed the OLD
  validator passes the new one too (old required strict superset). So
  no test fixtures need updating except those that intentionally
  asserted the strict-echo rejection.

## 4. Mandatory verification (do not skip)

This is the part I want different from last time.

### 4.1 Real-data replay (required gate before commit)

Write a script (it can live under `script/` and be deleted before
commit, OR persist under `packages/opencorvus/script/` if you think
it's worth keeping) that:

1. Opens the user's runtime DB at
   `C:/Users/hengu/.local/share/opencorvus/opencorvus.db` readonly.
2. Loads the real G28 V4 failed handoff (recipe in §1 above).
3. Builds the EvidenceRequirements exactly as the live code does (use
   the SAME helper from `compaction.ts` — `selectedHeadEvidenceRequirements`
   — if you can; if not exported, expose it under
   `SessionCompaction.TestHooks` like the dispatch-anchor work did).
4. Runs `validateMinimumEvidence(handoff, requirements)` against the
   NEW validator from the working tree.
5. Asserts the verdict is `{ success: true }`.

**Run this script and paste its output in your final report.** If the
verdict is still `success: false`, the fix is incomplete — go back
and iterate, do not commit.

### 4.2 Negative test (required)

Write a unit test in `compaction-evidence-contract.test.ts` (or a
sibling) that constructs a handoff with **empty errorsAndBlockers**
when `requirements.errorsAndBlockers=true` and asserts validation
fails with a clear message. This pins that the loosened check still
catches the genuinely-missing case — we are NOT eliminating the
check, just softening it.

### 4.3 Boundary test (required)

Write a unit test where `requirements.errorNames.length === 5` and the
handoff has exactly 3 errorsAndBlockers entries (each properly
populated). Asserts `success: true` — because the ceiling is 3 (§3.1).
This pins the "single root cause → multiple symptom tool errors"
collapse behavior.

### 4.4 Empty-fields test (required)

A handoff with one errorsAndBlockers entry whose `evidence` is empty
string. Asserts the Zod schema rejects it OR the validator catches
the empty `evidence` and emits a clear error. Pins that we still
demand SOMETHING in each entry; we are not letting through blank
acknowledgments.

### 4.5 Files-side regression check (required)

Re-run the OLD `compaction-evidence-contract.test.ts` and confirm
all of its files-side assertions still pass unchanged. The files
contract is intentionally strict — if any files test breaks, that's a
regression, fix it.

## 5. CLAUDE.md rules to obey

- **rule 1**: this is the real root cause (wrong contract), not
  another prompt-side patch.
- **rule 3**: do NOT trust your own fixture tests as proof. The real
  proof is §4.1's replay against the live failed handoff. The
  previous run only passed fixture tests and I declared "fixed"
  prematurely; user called it out.
- **rule 6.1**: this fix MOVES the contract from host-strict to
  prompt-advisory + host-semantic. Correct direction for "what the
  model should produce" problems.
- **rule 8**: rename the prompt tag; do not keep both
  `<required-error-evidence>` and `<runtime-error-context>` in
  parallel.
- **rule 16/17**: no compat shims. Old failed handoffs (G15/G28) will
  remain failed in the DB — that's correct, they are terminal. We do
  not retroactively pass them.
- **rule 24**: independently verify my line citations and §1
  reproduction before editing. If the live verdict differs from what
  I report (e.g. you see `success: true` against current HEAD on the
  G28 V4 fixture), STOP and report — that would mean the situation
  changed since I wrote this brief.
- **rule 33**: one coherent commit, push without `--no-verify`. The
  changes here ARE one atomic concern (loosen the errorsAndBlockers
  contract end-to-end: validator + prompt + tests).
- **rule 35**: grep callers of `validateMinimumEvidence`,
  `MODEL_OUTPUT_INSTRUCTIONS`, `renderRequiredEvidence`,
  `<required-error-evidence>` tag literal — update every site.
- **rule 36**: every test in §4.

## 6. Files to read first

```
packages/opencorvus/src/session/compaction-handoff.ts   # validator + instructions + render
packages/opencorvus/src/session/compaction.ts           # selectedHeadEvidenceRequirements + runtimeContext (prompt assembly)
packages/opencorvus/test/session/compaction-evidence-contract.test.ts  # existing pinned contracts
packages/opencorvus/test/session/compaction-dispatch-anchor.test.ts    # already-landed sibling, do NOT regress
```

## 7. Out of scope

- The pre-existing `ContextOverflowError` failures (separate problem).
- Any change to `files` / `patchFiles` validation — the files side is
  empirically working; do not touch it.
- Any change to dispatch-anchor preservation
  (`anchor_id`/`tail_start_id`) — that landed in `786b02a77`, leave
  it alone.
- Reverting any of today's earlier fixes.

## 8. Report back with

- §4.1 script's exact stdout (the live G28 V4 replay must show
  `success: true`).
- Single commit hash + diff stat.
- Test names that pin §4.2 / §4.3 / §4.4.
- Pre-push hook output (typecheck + api:routes-check + docs:check
  must pass without `--no-verify`).
- Any deviation from this brief with concrete reasoning (rule 35).
