# Hexin GPT-5.6 Context Profile

## Recall

- User requirement: set every Hexin `gpt-5.6` model to a 232,000-token context window.
- Triggering evidence: `hexin/gpt-5.6-sol` was projected as 128,000 tokens and caused automatic compaction around 100,454 tokens even though the real model supports at least 232,000 tokens.
- Acceptance criteria:
  - every current Hexin `gpt-5.6` model ID (`gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra`) resolves to `context=232000` and `input=232000`;
  - future `gpt-5.6-*` suffix variants use the same single profile instead of the generic 128,000-token GPT fallback;
  - unrelated GPT profiles retain their existing limits;
  - provider profile tests, provider discovery tests, typecheck, and required document-health tests pass.
- Hard constraints: use `hexin-profiles.ts` as the single capability source; do not add runtime fallback, provider-specific route overrides, or compaction gates; preserve unrelated dirty worktree changes; do not restart or refresh the running OpenCorvus process.
- Sources read: `specs/current/architecture/06-provider.md`, `packages/opencorvus/src/provider/hexin-profiles.ts`, `packages/opencorvus/src/provider/hexin-discovery.ts`, `packages/opencorvus/src/provider/models.ts`, `packages/opencorvus/src/session/context-budget.ts`, and `packages/opencorvus/test/provider/hexin-profiles.test.ts`.
- Full-repository search: `profileFor()` is consumed by `models.ts` and `hexin-discovery.ts`; all Hexin catalog construction therefore converges on the same matcher table. Current local discovery lists exactly `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra`. No existing `gpt-5.6` profile exists.
- Independent Agent feedback: none; the user did not request sub-Agent review, and repository policy disallows unsolicited delegation.
- Follow-up requirement: the user rejected hard-coded context limits because Hexin models are automatically refreshed. Root repair must acquire limits from Hexin metadata during the same explicit refresh and retire local limit ownership, including the temporary 232,000-token GPT-5.6 matcher.
- Latest requirement: when Hexin metadata does not report a context length, use one explicit 200,000-token default context instead of `0` or the retired 128,000-token family defaults.
- Follow-up evidence: `GET /v1/models` only returns identities; authenticated repository evidence for `GET /v1/model/info` proves exact `model_info.key`, `max_input_tokens`, and `max_output_tokens` fields. All `/models` identities had metadata rows in the recorded audit, while ten rows intentionally lacked limit fields.
- Follow-up full-repository search: Hexin refresh enters through provider/global routes into `Provider.refreshHexin`, then `refreshHexinCache`, `discoverHexinModels`, and `ModelsDev.refreshHexinProvider`. Normal discovery currently rebuilds models from IDs and therefore also discards persisted limits. Generic registry refresh currently rematerializes Hexin from local profiles and can erase provider-refreshed metadata. Both paths must be corrected together.

## Root Cause

The exact `gpt-5.6-*` IDs do not match the bare-version matcher `^gpt-5\.\d+$`. They fall through to the generic `^gpt-` profile, which projects a conservative 128,000-token context and 16,384-token output limit. `ContextBudget` then treats that incorrect catalog value as authoritative and compacts prematurely.

## Change

Add one explicit family matcher before the mini, nano, bare-version, and generic GPT matchers. It owns all `gpt-5.6` IDs and projects both context and input limits as 232,000 tokens. Keep the existing conservative output and modality values because this task has evidence only for the context/input capacity.

Add a table-driven profile regression test for the three current IDs plus a representative future suffix, retain an assertion that an unrelated unknown GPT suffix still follows the generic profile, and exercise the real catalog-refresh path for all three current IDs.

## Follow-up Root Repair

The temporary matcher above proved the premature-compaction cause but retains the architectural defect. Replace it with one metadata-owned limit path:

1. Explicit Hexin refresh fetches both `/v1/models` and `/v1/model/info` before writing anything.
2. Exact `model_info.key` rows supply `context=input=max_input_tokens` and `output=max_output_tokens`; `max_tokens` is never interpreted as context.
3. Duplicate metadata rows must agree on every reported limit. Conflicts or missing metadata identities fail refresh and preserve the previous catalog.
4. A metadata row with no reported context uses the single `HEXIN_DEFAULT_CONTEXT_LIMIT=200000`; it never inherits a family-specific guess. Reported metadata always remains authoritative.
5. Normal discovery reads the persisted catalog model limits instead of rebuilding from IDs.
6. Generic models.dev refresh preserves the current canonical Hexin provider; only explicit authenticated Hexin refresh may replace it.
7. Remove `context`, `input`, and `output` from `HexinModelProfile`. Profiles retain only behavioral capabilities that `/model/info` is not yet the runtime authority for.

Acceptance requires parser tests for exact, 200,000-token default, duplicate-equal, duplicate-conflicting, and missing-row metadata; real refresh-path tests; preservation of the old catalog on either endpoint failure; and proof that generic registry refresh cannot erase refreshed Hexin limits.

## Verification

- Focused provider suites pass 34 tests / 168 expectations. They cover exact metadata, the single 200,000-token missing-limit default, equal and conflicting duplicates, missing identities, both endpoint failure paths, persisted GPT-5.6 limits, generic-registry preservation, route refresh, and project-config credential ownership.
- The full repository typecheck passes all 9 scheduled package tasks after the metadata parser and catalog ownership replacement.
