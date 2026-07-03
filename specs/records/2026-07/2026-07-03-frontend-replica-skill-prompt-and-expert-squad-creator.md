# Frontend Replica Skill Prompt and Expert Squad Creator

Date: 2026-07-03

## Recall

User request:

- Do not work on the Frontend Replica Task Packet yet.
- First update the frontend-replica expert-squad skill and prompt overlays.
- Then write a Codex skill for adding new expert squads to OpenCorvus because expert-squad work has many integration points and agents easily miss critical content.
- The user specifically called out missing depth around frontend replica acceptance, including the rule that acceptance can be attempted at most three times and must fail honestly if still not accepted.

Acceptance criteria:

- `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md` must describe frontend replica as a source-evidence workflow with durable surface tracking, failure taxonomy, Visual Quality Assurance (QA) / Integrity feedback consumption, and a maximum of three evidence-backed non-pass acceptance attempts before Orchestrator marks the task as not accepted.
- `PromptProfile.builtIns["frontend-replica"]` must carry role-scoped prompt overlays for the same discipline without turning it into a host-side gate, fallback path, state machine, or broad wrapper text copied into every role.
- Existing source-row, comparison-guidance, desktop-only, browser-preview ownership, and blank-filler geometry prompt repairs must remain intact.
- Add a Codex skill under the user skill directory that guides future agents through adding an OpenCorvus expert squad without missing prompt profile, mounted skill, skill registry, tests, specification record, and validation steps.
- Add or update focused tests and run validation for the changed prompt/skill/document surfaces.

Hard constraints:

- No fallback, compatibility path, or host-side hard gate.
- No Frontend Replica Task Packet implementation in this turn.
- Do not create a git worktree, do not use `git reset`, and do not restart or refresh running OpenCorvus / overlay processes.
- Preserve unrelated dirty worktree changes.
- New specification records stay under `specs/records/2026-07/` and must update this monthly `README.md`.
- Manual file edits use `apply_patch`.
- Prompt changes must respect the existing overlay pressure test: no workflow-wrapper boilerplate, no `host-side`, no `state machine`, no fallback wording, no duplicated overlays, and each overlay must stay within its length budget.

Sources read:

- `C:/Users/chuan/.codex/skills/.system/skill-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/.system/skill-creator/scripts`
- `AGENTS.md` instructions supplied in the current prompt.
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-07/2026-07-02-frontend-replica-workflow-goal-discipline.md`
- `specs/records/2026-07/2026-07-03-no-diff-source-row-goal-repair.md`
- `specs/records/2026-07/2026-07-02-visual-qa-annotated-repair-consumption.md`
- `specs/records/2026-06/2026-06-25-visual-evidence-no-hard-gate-root-repair.md`
- `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/skill/skill.ts`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/test/agent/prompt-profile.test.ts`
- `packages/opencorvus/test/skill/skill.test.ts`

Whole-repository search evidence:

- `rg -n "frontend-replica|expert-squad|builtIn|builtin" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 specs/current/architecture`
- Existing records identify `PromptProfile.builtIns` and `packages/opencorvus/src/skill/builtin/*-expert-squad.md` as the two required OpenCorvus expert-squad prompt surfaces.
- `packages/opencorvus/src/skill/skill.ts` imports built-in expert-squad markdown and materializes mounted built-in skills.
- `packages/opencorvus/test/skill/skill.test.ts` and `packages/opencorvus/test/tool/skill.test.ts` pin mounted expert-squad discovery and loading behavior.
- `packages/opencorvus/test/agent/prompt-profile.test.ts` pins built-in profile target matrices, overlay hygiene, and role-scoped overlay length.

Independent agent feedback:

- Not spawned. The user asked this agent to update the skill/prompt and create a Codex skill, not to run a parallel sub-agent review.

## Findings

Frontend replica failures are not only a missing checklist problem. The durable behavior must distinguish:

- source evidence from implementation surfaces;
- visible component or region goals from source rows, visual-source rows, style-profile rows, Document Object Model (DOM) records, and evidence-table rows;
- repairable rendered mismatches from structural acceptance failure;
- toolchain or evidence blockers from actual rendered non-pass attempts;
- Visual QA / Integrity diagnostics from formal rendered acceptance proof.

The “at most three acceptance attempts” rule belongs in Orchestrator-visible prompt/skill semantics, not in a host-side gate. The June 25 no-hard-gate record keeps visual evidence as required work evidence and honest review feedback, while forbidding hidden host vetoes that rewrite model terminal state. Therefore this turn will encode the budget as an explicit Orchestrator lifecycle decision: after three evidence-backed non-pass Visual QA / Integrity rounds against the same requested surface, the task must be reported as not accepted with blockers, evidence, and failed requirements instead of being silently retried or called basically complete.

The new Codex skill should not be an OpenCorvus built-in expert squad itself. It is a personal Codex authoring skill for future repository work: when a user asks to add or update an OpenCorvus expert squad, the skill forces the agent to inspect the existing prompt-profile catalog, built-in skill registry, mounted skill tests, route/tool tests, and specification records before editing.

## Implementation Plan

1. Extend the frontend-replica expert-squad skill with:
   - source authority vocabulary;
   - replica surface model;
   - acceptance attempt budget;
   - failure taxonomy;
   - Visual QA / Integrity feedback consumption;
   - stronger source-row and no-diff goal boundaries.
2. Update `PromptProfile.builtIns["frontend-replica"]` with role-scoped overlays:
   - Orchestrator owns attempt ledger and final not-accepted decision after three evidence-backed non-pass rounds;
   - Requirements and Architect own source-backed surface decomposition;
   - Build owns scoped implementation and consumption of diagnostics before passing;
   - Visual QA and Integrity own evidence-backed non-pass reporting and stale-blocker handling.
3. Add or adjust tests that assert the new skill/prompt contract while preserving overlay hygiene.
4. Create a new Codex skill under `C:/Users/chuan/.codex/skills/` for adding OpenCorvus expert squads.
5. Validate the Codex skill with `quick_validate.py`, run focused Bun tests, run documentation link validation, run typecheck and `git diff --check`, then self-review.

## Implementation Notes

- Updated `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md` with:
  - vocabulary for DOM / CSS / QA / URL;
  - source authority;
  - replica surface model;
  - acceptance attempt budget;
  - failure taxonomy;
  - Visual QA / Integrity feedback consumption;
  - no-diff / documentation-only / screenshot-only non-delivery guidance.
- Updated `PromptProfile.builtIns["frontend-replica"]` in `packages/opencorvus/src/agent/prompt-profile.ts` with role-scoped guidance for:
  - source-backed requirements;
  - Architect rejection of source rows and `no_project_diff` / docs-only goals;
  - Build consumption of Visual QA / Integrity diagnostics before pass;
  - Visual QA repeated-blocker accounting;
  - Integrity and Orchestrator third evidence-backed non-pass not-accepted decisions.
- Created the personal Codex skill:
  - `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
  - `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
  - `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/agents/openai.yaml`
- Typecheck exposed an existing `packages/opencorvus/src/cli/cmd/github.ts` type defect: the code used `Awaited<ReturnType<typeof Session.create>>`, whose static type lacks `projectID`, then passed `session.projectID` into `SessionPrompt.prompt`.
- Fixed the CLI defect by using `Session.createNext({ directory: Instance.directory, ... })`, which returns full `Session.Info`, and added a regression assertion in `packages/opencorvus/test/cli/github-action.test.ts`.

## Validation Results

- PASS: `python C:/Users/chuan/.codex/skills/.system/skill-creator/scripts/quick_validate.py C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator`
- PASS: `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts` through `runProcessWithInactivityTimeout`: 25 pass, 0 fail.
- PASS: `bun test packages/opencorvus/test/skill/skill.test.ts packages/opencorvus/test/tool/skill.test.ts` through `runProcessWithInactivityTimeout`: 35 pass, 0 fail.
- PASS: `bun test packages/opencorvus/test/cli/github-action.test.ts` through `runProcessWithInactivityTimeout`: 21 pass, 0 fail.
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` through `runProcessWithInactivityTimeout`: 19 pass, 0 fail.
- PASS: `bun run --cwd packages/opencorvus typecheck` through `runProcessWithInactivityTimeout`.
- PASS: `git diff --check`; Git reported only an existing CRLF normalization warning for `packages/opencorvus/test/browser-preview/region-comparison.test.ts`.

## Self-Review

- The Frontend Replica Task Packet was not implemented in this turn.
- The acceptance budget is prompt-visible lifecycle guidance, not a hidden hard gate.
- Existing desktop-only, browser-preview ownership, source-row, comparison-guidance, and blank-filler prompt protections remain covered by tests.
- The new Codex skill is personal authoring guidance for future OpenCorvus expert-squad work; it is not an OpenCorvus built-in runtime squad.
- No running OpenCorvus / overlay process was restarted or refreshed.
