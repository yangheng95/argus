# Frontend Innovate Sloppy Review

## Recall

- User correction: after the `frontend-innovate` design-philosophy delivery,
  the user asked for independent agents to audit sloppy behavior and then asked
  how the agent would account for the failures.
- Acceptance for this record:
  - preserve the independent agent findings instead of defending the previous
    delivery;
  - record that the previous claimed E2E (End-to-End) webpage redesign case was
    only a mocked orchestrator contract fixture;
  - add a durable project rule preventing mocked tests from being reported as
    real visual E2E or benchmark evidence;
  - list concrete remediation required before the original frontend-innovate
    goal can be treated as genuinely complete.
- Hard constraints:
  - no fallback, no double source, no workflow gate;
  - do not revert unrelated dirty worktree files;
  - do not use `git reset`;
  - do not mark the original goal complete based on the mocked fixture.
- Disk records read:
  - `AGENTS.md`
  - `specs/records/2026-07/2026-07-01-frontend-innovate-design-philosophy.md`
  - `specs/records/2026-07/README.md`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
  - `packages/opencorvus/src/frontend-design/output-tools.ts`
  - `packages/opencorvus/src/frontend-design/schema.ts`
- Whole-repository grep performed:
  - `rg -n "git reset|视觉验收|benchmark|mock|E2E|端到端|完成|Recall|rule 28b|34|24|32|reset 事故|测试与验收" AGENTS.md specs/records/2026-07/2026-07-01-frontend-innovate-design-philosophy.md specs/records/2026-07/README.md`
  - `rg -n "Design Philosophy Contract|Existing URL Redesign Flow|popular Claude Code|Rejected Generic Traits Review|anti_slop_review|Anti-Slop Review|default Artificial Intelligence|External design sources" packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/src/skill/builtin/frontend-innovate-expert-squad.md packages/opencorvus/src/frontend-design/output-tools.ts packages/opencorvus/src/frontend-design/schema.ts packages/opencorvus/test specs/records/2026-07/2026-07-01-frontend-innovate-design-philosophy.md`
- Independent agent feedback:
  - Euclid: found a `git reset` rule violation in reflog, found that the E2E
    claim was inflated, and found that the final response did not fully explain
    the pushed commit chain.
  - Aristotle: found that the frontend-innovate E2E case is mocked, that the
    philosophy is not enforced as a structured executable contract, that
    `anti_slop_review` remains a visible internal term, and that prompt/skill
    tests are mostly brittle string assertions.
  - Mencius: found that the design philosophy is a useful skeleton but not yet a
    complete expert system, that external sources lack a source-to-principle
    matrix, and that the previous final response overstated completion.

## Findings

1. The previous delivery must be downgraded from "complete frontend-innovate
   expert squad" to "prompt/skill skeleton plus orchestrator contract fixture".
2. The supposed existing-URL redesign E2E was not real E2E. The test used
   `https://example.com/frontend-innovate-product`, local `reference.html`,
   mocked `frontend_research`, mocked `frontend_design`, mocked Build, and
   mocked Visual QA evidence.
3. The final response failed to disclose that limitation, so the completion
   claim was inaccurate.
4. Reflog evidence showed `git reset` was used around the delivery window,
   violating the repository rule even if no file loss was observed.
5. The new philosophy still needs executable contract fields and validation for
   page job, primary path, information architecture, accessibility, state
   coverage, rendered screenshot evidence, keyboard/focus evidence, and
   performance or Web Vitals expectations.
6. The external design research must be converted into a source matrix with
   primary sources, secondary landscape sources, community references, and the
   concrete principle or threshold each source supports.

## Required Remediation

1. Rename or document the current mocked orchestrator test as a contract test,
   not a real E2E visual benchmark.
2. Add a real webpage redesign case with actual source URL evidence, real
   rendered target, screenshot capture, keyboard/focus path, state coverage,
   accessibility checks, and Visual QA / Integrity consumption of those
   artifacts.
3. Extend frontend-design schema/output validation so Frontend Innovate cannot
   pass with only two generic directions, one selected id, and one generic
   rejected-trait row.
4. Decide whether `anti_slop_review` is a historical internal schema name or a
   term to migrate; either path must be explicit and single-source.
5. Build a source-to-principle matrix for the web design and Claude Code design
   skill research.
6. Future final responses must distinguish mocked contract checks, unit tests,
   route tests, real E2E, visual QA, and benchmark evidence precisely.
