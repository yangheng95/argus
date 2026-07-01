# Frontend Replica Requirements Webpage Generation Prompt

## Recall

- User request: "网页项目生成除了响应式还有那些需求，写到网页复刻专家团的req的专属prompt中".
- Acceptance: the `frontend-replica` expert squad Requirements role must explicitly require webpage-generation coverage beyond responsive behavior, and that text must be part of the prompt profile path consumed by Requirements sessions.
- Hard constraints: no fallback or parallel prompt source; preserve the desktop-only replica default unless the current operator explicitly authorizes responsive / multi-end work; add tests for code changes; do not touch unrelated dirty files.
- Disk records read: `specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md`, `specs/records/2026-07/2026-07-01-visual-qa-multi-viewport-alignment.md`, and `specs/records/2026-07/README.md`.
- Full-repo grep performed: `prompt-profile`, `frontend-replica`, `requirements`, `expert squad`, and Requirements prompt composition call sites.
- Evidence: `packages/opencorvus/src/agent/prompt-profile.ts` owns built-in profile overlays; `PromptProfile.composeAgentPrompt()` appends active profile text after the base core; `packages/opencorvus/src/agent/runner.ts` composes every agent core through that single prompt profile path.

## Plan

1. Extend only the built-in `frontend-replica` Requirements overlay with concrete webpage-generation requirement categories.
2. Keep responsive / multi-viewport as explicit-scope-only, not a default replica requirement.
3. Add a prompt-profile test that composes the Requirements prompt and asserts the new categories are present.
4. Run targeted prompt-profile tests plus historical docs link validation.
