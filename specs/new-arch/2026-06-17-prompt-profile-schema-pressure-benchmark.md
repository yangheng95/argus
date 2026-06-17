# Prompt Profile Schema Pressure Benchmark

Date: 2026-06-17

## Request

Stress-test the OpenCorvus expert-squad prompt-profile schema and harden it
into an enterprise-grade expert-team system. The test target is the
`PromptProfile` schema, registry, and prompt compiler surfaces. If a real
runtime launch is needed, use port `7278`.

## Recall

Existing design source:

- `specs/new-arch/2026-06-16-prompt-profile-expert-squad-switching.md`
  defines Prompt Profiles as a single config source that changes prompt context
  only. It forbids workflow changes, tool changes, retry logic changes,
  fallback profile selection, keyword classifiers, per-agent prompt mutation,
  and user-defined overlays for built-in-only targets.
- `specs/tc_clone_prompt.md` is the active high-pressure frontend-clone
  workload that motivated the frontend expert squad. It requires the squad to
  preserve information architecture, module structure, layout density,
  interaction semantics, mature component use, and visual evidence.

## Call-Site Inventory

| Surface | Current role | Required benchmark coverage |
| --- | --- | --- |
| `packages/opencorvus/src/agent/prompt-profile.ts` | Single source for built-in profiles, target catalog, schema, active id, overlay lookup, and prompt composition. | Schema rejects ambiguous ids/labels/overlays; registry has exact built-in ids; built-ins cover required target matrices; overlays stay role-scoped and concrete. |
| `packages/opencorvus/src/config/config.ts` | `Config.Info` and `Config.Overlay` parse project/session prompt-profile config. | Project config rejects unknown active ids, built-in override ids, unknown targets, built-in-only targets, empty labels, bad ids, and ambiguous overlay prose. Session overlay accepts only `active`. |
| `packages/opencorvus/src/agent/runner.ts` | Worker agents compose base + active profile + user append. | Compiler ordering remains base, profile overlay, user append. |
| `packages/opencorvus/src/session/llm.ts` | Direct session agents receive profile overlay outside complete-system mode. | Complete-system semantics are unchanged. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Orchestrator appends built-in-only profile overlay through the same compiler. | Orchestrator receives only built-in registry text, not user-defined text. |
| `packages/opencorvus/src/config/prompt-catalog.ts` | Displays editable prompt, active profile, profile contribution, and effective prompt. | Profile prompt remains preview-only and is not persisted as user append. |
| `packages/opencorvus/src/server/routes/config.ts` | Exposes `/config/prompt-profile`. | Catalog returns full targets/profiles and active ids. |
| `packages/opencorvus/src/server/routes/session.ts` | Validates session overlay patches. | Unknown profile patches fail before writing. |
| `packages/overlay/src/services/config.ts` and Prompt Catalog UI | Creates/edits/deletes custom profiles and switches project/session active id. | UI helpers write only `prompt_profile`, not per-agent prompt fields. |

## Pressure Cases

The benchmark must cover:

- Invalid active ids: missing, whitespace, unknown, reserved built-in collision,
  and ids with characters that cannot be stable config keys.
- Invalid custom definitions: empty labels, unknown agent targets,
  built-in-only targets, and blank overlays for otherwise populated profiles.
- Registry integrity: built-ins are only `general`, `frontend`, `backend`, and
  `algorithm`; target metadata has one entry per target; no built-in references
  non-canonical target ids.
- Scene completeness: frontend/backend/algorithm include the required target
  matrices from the 2026-06-16 design and do not change tools, models, workflow,
  retry behavior, gates, dispatch rosters, or hidden state.
- Prompt quality: each built-in overlay is short enough to avoid prompt bloat,
  specific enough to tell the target what to inspect or produce, and tied to
  concrete evidence nouns. It must avoid vague filler, duplicated role text,
  dispatch mechanics, retry-loop language, and tool-list prose.
- Compiler behavior: base prompt, profile overlay, and user append remain
  distinct; the `general` profile preserves behavior.

## Benchmark Definition

Input:

- Project config snippets and session overlay snippets containing adversarial
  prompt-profile definitions.
- Built-in prompt-profile registry entries.
- Prompt compiler inputs for representative worker/direct/orchestrator targets.

Output:

- Schema parse success only for unambiguous, known, role-scoped definitions.
- Hard parse errors for malformed definitions. No fallback, coercion, or silent
  profile substitution.
- Built-in overlays that are role-scoped, concrete, and checkable.

Timeout:

- Do not add test-level total-duration timeouts for this benchmark. The tests
  are deterministic unit tests. Any future long-running runtime benchmark must
  use an idle/no-activity timeout, not a timer counted from process start.

Acceptance:

- Targeted prompt-profile tests pass.
- Config/session route tests that exercise prompt-profile boundaries still pass.
- The overlay config helper tests still prove profile selection writes one
  profile field rather than per-agent prompt fields.
- A manual review confirms the registry text is not a fallback, workflow gate,
  dispatch roster, or vague reusable slogan pack.
