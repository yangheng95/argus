# Expert Squad Concrete Prompt Cleanup

## Recall

- User request: "我要你把专家团无意义的sloppy占位都删了，从专家团负责的任务的具体实际情况来组建prompt".
- Acceptance: expert-squad prompts must not rely on vague `anti-slop`, `enterprise polish`, `product-grade`, or similar placeholder quality labels; the active profile and mounted skill prompts must describe concrete task evidence, role outputs, and verification obligations.
- Hard constraints: no fallback or parallel prompt source; prompt-profile remains the single profile overlay path; do not touch unrelated dirty files; add tests for prompt hygiene.
- Disk records read: `specs/records/2026-07/2026-07-01-frontend-replica-requirements-webpage-generation.md`, `specs/records/2026-07/README.md`, and the existing frontend-innovate expert-squad skill.
- Full-repo grep performed: `slop`, `sloppy`, `anti-slop`, `placeholder`, `polish`, `product-grade`, `enterprise`, `quality bar`, `expert squad`, `frontend-innovate`, and prompt-profile call sites.
- Evidence: the main placeholder cluster is in `packages/opencorvus/src/agent/prompt-profile.ts` under `frontend-innovate`, in `packages/opencorvus/src/skill/builtin/frontend-innovate-expert-squad.md`, and in `packages/opencorvus/src/prompt/core/orchestrator-core.txt` expert-squad selection text. Other built-in squads are already mostly grounded in concrete surfaces such as route/schema/storage, proof/benchmark, or browser failure evidence.

## Plan

1. Replace frontend-innovate placeholder quality labels with concrete design-resource, direction-selection, component, interaction, accessibility, data, and rendered-evidence obligations.
2. Update the frontend-innovate Orchestrator skill and core expert-squad selection text so dispatch criteria match those concrete responsibilities.
3. Update tests to assert concrete prompt content and forbid the removed placeholder fragments in built-in profile descriptions and overlays.
4. Run targeted prompt hygiene and profile tests plus docs link validation and typecheck.
