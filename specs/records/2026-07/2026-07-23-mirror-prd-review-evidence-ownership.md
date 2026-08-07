# Mirror PRD Review Evidence Ownership

Date: 2026-07-23
Status: Implemented; live-task convergence pending
Owner: Codex

## Recall

### User request

The user reported that the resumed Mirror Prism clone Mission had stalled
again. The affected runtime remains:

- Mission: `69ddd1553a755e35`
- Task: `tsk_f8d50b623001TIy1vATb7zc56T`
- Goal: `gol_f8d560d340011fQphq0PquOyBQ`
- Orchestrator Session: `ses_072af44bcffe4Sgs6TNE7nvhC9`
- second Reviewer Session: `ses_072379d08ffe5A4GHCQOcMi0QM`

### Acceptance criteria

- Mirror PRD Requirements and Goal contracts identify the canonical
  `integrity_attempt` artifact produced by `submit_integrity_consensus` as the
  independent review evidence.
- They do not require an Integrity reviewer to write a project file or require
  an Author to copy, impersonate, or certify a Reviewer result.
- A page PRD describes its review-ready state and review inputs without
  predicting a future verdict. The independent review artifact and visible
  Orchestrator handoff own the final verdict and exact review identity.
- A non-pass review routes actual PRD repairs to the Author. The absence of a
  second project-file copy of the review report is not itself a repair.
- The installed Mirror PRD package used by the affected project receives the
  same corrected package contract, then the Task resumes from its existing
  Author and Reviewer artifacts without repeating research.

### Hard constraints

- Preserve Integrity's read-only mutation boundary and its existing
  `submit_integrity_consensus` terminal tool.
- Do not add a generic arbitrary-path file writer, shadow review record,
  compatibility path, fallback, gate, state machine, or hidden message.
- Do not restart or refresh the running OpenCorvus/Overlay process without
  explicit user authorization.
- Preserve the unrelated modification in
  `2026-07-22-mirror-prism-full-workflow-distillation.md` and the untracked
  `expert-squads/.DS_Store`.
- Commit subjects use `dsw-33987`; push the OpenCorvus source repair to
  `myhexin/v0.0.16beta`.

### Sources read

- `AGENTS.md`
- the live Mission, Task, Goal, Session, transcript, tool-part, and sidecar-log
  evidence for the identities above
- `packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- `packages/opencorvus/src/integrity/team-agent.ts`
- `packages/opencorvus/src/integrity/render-markdown.ts`
- `packages/opencorvus/src/integrity/root-history.ts`
- `packages/opencorvus/src/agent/dispatch-adapter-contract.ts`
- `expert-squads/mirror/mirror-prd/expert-squad.jsonc`
- every Mirror PRD agent system prompt
- `expert-squads/mirror/mirror-prd/skills/workflow/SKILL.md`
- `expert-squads/mirror/mirror-prd/skills/workflow/references/source-parity.md`
- `packages/opencorvus/test/expert-squad/mirror-squads-package.test.ts`
- the installed project package under
  `/Users/yangheng/Documents/OpenCorvus-Demos/prism/.opencorvus/expert-squads/mirror/mirror-prd/`

### Whole-repository search evidence

- `rg -n "mirror-prd-reviewer|mirror-prism-prd-stage|independent-review|submit_integrity_consensus|teamReportMarkdown" expert-squads packages/opencorvus/src packages/opencorvus/test`
- `rg -n "review.*persist|persist.*review|review.*tmp|independent review.*artifact|审查记录|独立审查.*持久|reviewer.*file" expert-squads packages/opencorvus/src packages/opencorvus/test specs`
- `rg -n "run_command|write|modify|artifact|test-owned|source" packages/opencorvus/src/integrity packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- `rg -n "replace_goal_contract|modify_goal|manage_task" packages/opencorvus/src/orchestrator packages/opencorvus/src/engine packages/opencorvus/test/orchestrator`

### Independent agent feedback

No sub-agent was used because the user did not request delegation or parallel
agents.

## Causal diagnosis

The second Reviewer was not deadlocked. Its corrected
`submit_integrity_consensus` call ran for about 99 seconds and completed with a
durable `needs_correction` report. The Session then published
`terminal/completed`.

The repeated workflow is caused by a contract contradiction:

1. Integrity's core contract is intentionally read-only. It says that Integrity
   does not edit or write project files and that the registered final report is
   its only output.
2. The generated Mirror PRD Task and Goal required the independent Reviewer
   record to be written under `.mirror/prd/tmp/`.
3. The Orchestrator therefore dispatched the Author to materialize the first
   Reviewer conclusion. The Author correctly labeled that file as an Author
   persistence record rather than a new independent review.
4. The next independent Reviewer correctly rejected the Author-authored file
   as not being independent Reviewer evidence and requested another
   Reviewer-written project file, which its own runtime is forbidden to write.

The Integrity engine artifact already contains the canonical report,
check-items, reviewers, findings, repairs, coverage, and provenance. Requiring
a project-file copy creates a second source and makes the declared workflow
impossible to satisfy. This is a Mirror PRD package modeling defect, not an
Integrity execution failure and not a reason to weaken Integrity's mutation
boundary.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| Integrity core and `submit_integrity_consensus` | Preserve unchanged as the single canonical review artifact writer. |
| Mirror PRD Requirements Analyst | Require canonical engine review evidence; forbid a Reviewer project-file obligation. |
| Mirror PRD Architect | Build Goal acceptance around the engine artifact and visible handoff, not a shadow file. |
| Mirror PRD Author | Produce only the page PRD and a review-ready state; never copy or certify review results. |
| Mirror PRD Reviewer | Treat its submitted artifact as the independent report and do not find a defect merely because no project-file copy exists. |
| Mirror PRD Orchestrator | Route real findings to the Author and consume the canonical review artifact directly. |
| Workflow Skill and source-parity reference | State the same single-source ownership and directory contract. |
| Package tests | Assert the review-artifact ownership language across all generic and AInvest workflows. |
| Installed project package | Apply the same package correction so newly dispatched repair/review Sessions use it. |

## Implementation plan

1. Correct the Mirror PRD workflow Skill, source-parity reference, and four
   relevant agent prompts.
2. Add package-contract regressions that reject Reviewer project-file
   ownership and Author review impersonation.
3. Apply the same source-controlled package bytes to the affected project's
   installed Mirror PRD package.
4. Run package, SDK legality, document-health, and typecheck checks.
5. Commit and push the OpenCorvus source repair, commit the project package
   update, then wake the existing Task with the exact contract correction and
   verify its next real dispatch.

## Verification commands

- `bun test packages/opencorvus/test/expert-squad/mirror-squads-package.test.ts`
- `bun test packages/opencorvus/test/expert-squad/mirror-prism-source-capability.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Implementation

- Mirror PRD package version advanced to `2026.07.23.8`.
- The workflow Skill and source-parity reference now identify the engine
  `integrity_attempt` as the sole independent-review report.
- Requirements, Architect, Author, Reviewer, and Orchestrator prompts preserve
  the same ownership boundary:
  - Requirements and Goals must not demand a Reviewer-written project file.
  - Author writes only the page PRD and cannot copy or certify review output.
  - Reviewer submits its canonical report and does not reject the absence of a
    shadow file.
  - Orchestrator routes real content findings to Author and consumes the exact
    review artifact directly.
- The affected project's installed package was updated to the same version and
  contract. The running sidecar catalog resolved `mirror-prd` version
  `2026.07.23.8` with the Task session override, without a process restart.

## Verification result

Passed:

- Mirror package and Mirror Prism source-capability suites: 9 tests
- historical document links: 21 tests
- `bun run --cwd packages/opencorvus typecheck`
- source and installed-project `git diff --check`

The first document-health attempt found an unrelated untracked
`specs/records/.DS_Store`. It was moved recoverably to
`/Users/yangheng/.Trash/opencorvus-specs-records-DS_Store-2026-07-23-1517`;
the unchanged `expert-squads/.DS_Store` remains outside this change.
