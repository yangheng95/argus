# Mirror Prism Scaffold Bootstrap Restoration

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | The Mirror Prism flow must clone the git-cc scaffold before starting the delivery collaboration. The prior unified-squad audit must distinguish the complete cluster contract from the narrower 29-agent successful-delivery graph. |
| Acceptance | An explicitly loaded `mirror-prism-cluster` Mission Skill requires a credential-free, verified scaffold clone before the first delivery Task; AInvest uses the canonical git-cc scaffold `master` branch, another named team supplies its approved scaffold contract, and an explicitly authorized existing-scaffold run is the only no-clone variant. Every stage receives the exact cloned repository path, baseline commit, branch, and remote evidence. The unified squad rejects fresh-mirror dispatch without that bootstrap evidence. |
| Hard constraints | Use Mission's existing Bash execution surface and ordinary Git commands; do not add a host gate, project-provisioning API, fallback URL, embedded credential, hidden state, second repository identity, retry state machine, or automatic existing-project override. Preserve existing squads and running OpenCorvus/Overlay processes. |
| Source evidence read | `/Users/yangheng/Documents/output/mirror-prism-pipeline/SKILL.md` v2.21.4 lines 101–110 and 227–264; current Mission Skill and all references; Mission tool projection; `panel.create_task`; unified package selector/scheduler/tests; source-capability contract and both SDK/OpenCorvus validation suites. |
| Whole-repository grep | `fresh-project-provisioning` was declared unavailable only because the earlier Mission surface was treated as panel-only. Mission now owns Bash, but the cluster Skill still requires only `panel`, contains no clone instruction, rewrites source Step 2 to reuse the selected repository, and the unified selector explicitly refuses to load the Mission Skill. `panel.create_task` has no directory parameter and creates work in the Mission project, so a fresh scaffold must be cloned into one project-owned child directory and that exact path must be carried in every Task request. |
| Live repository evidence | `git ls-remote --heads https://git-cc.myhexin.com:6443/10jqka/llm/ainvest-02/vibe-7x24-scaffolding.git master` resolved `fbe2159c00b73f0480663fa51129fbdb2a473edc`; no credential-bearing URL was required. |
| Independent-agent feedback | None. The user did not request sub-agents or parallel agents. |

## Causal chain

1. Observable behavior: loading the cluster Skill does not clone git-cc before dispatch.
2. Direct trigger: the installed Skill has no clone contract and maps source Step 2 to reuse of the current repository.
3. Deeper cause: the source-capability port marked fresh project provisioning unavailable based on the old panel-only Mission model.
4. Current contradiction: Mission now has the canonical Bash execution surface, so it can safely perform the source-owned Git bootstrap itself.
5. Why the previous tests passed: they validated payload completeness, delivery-stage topology, and 29-agent package closure, but did not assert clone-before-first-Task evidence.

## Exhaustive call-point disposition

| Surface | Disposition |
| --- | --- |
| Cluster `SKILL.md` | Require `bash`; load the scaffold reference; execute bootstrap before any Task; propagate immutable repository evidence. |
| `references/scaffold-bootstrap.md` | Add the single credential-free AInvest source, clone/branch/verification commands, generic-team input contract, existing-scaffold exception, and failure behavior. |
| `references/stage-map.md` | Restore source Step 2 as Mission-owned clone-first behavior. |
| Goal ownership and handoff references | Make bootstrap evidence a prerequisite shared by every stage Task. |
| Unified selector, scheduler, and README | Require accepted scaffold evidence for fresh mirror work; keep direct use valid only for an already prepared repository. |
| Source-capability contract | Project fresh provisioning to Mission Bash plus repository Git and remove the false unavailable classification. |
| Built-in Mission payload | Regenerate from the canonical Skill source. |
| Mission Skill, unified-package, SDK collaboration, and source-capability tests | Assert the safe URL, Bash requirement, clone ordering, repository handoff, and removal of the false unavailable marker. |

## Validation

- Focused Mission Skill payload and runtime tests.
- Focused unified package, collaboration, and source-capability tests.
- SDK collaboration and authoring tests.
- Historical documentation links and document health.
- Relevant typechecks and `git diff --check`.
- Second exact-diff and credential scan before commit and git-cc push.

## Validation evidence

- The credential-free `git ls-remote` and real single-branch clone both resolved AInvest scaffold `master` to `fbe2159c00b73f0480663fa51129fbdb2a473edc`; the local clone had the same commit, sanitized origin, created run branch, and clean worktree.
- Mission Skill payload/runtime and SessionLoop loading passed 7 focused tests. Adding `bash` to `required_tools` initially exposed a stale runtime fixture that advertised only `mission_skill` and `panel`; the fixture now exercises the real Mission Bash-visible surface.
- Unified package, source capability, collaboration, Review & Debug, and document suites passed 102 tests with 1,796 assertions.
- Expert Squad payload reproducibility/build passed all 10 payload tests. Package Manager passed 58 ordinary cases; its cleanup-failure subprocess was terminated with exit 143 only during the combined run, then passed the unchanged original checker in isolation.
- Software Development Kit and OpenCorvus TypeScript checks both passed. Staged diff whitespace and credential-bearing URL scans passed.

## Second review

- The installed contract now restores source Step 2 without restoring its embedded username/password placeholder, fixed home directory, external Kanban claim, provider wrapper, retry counter, or polling loop.
- Bootstrap is Mission-owned because Mission is the only actor that both loads this Skill and has the ordinary Bash surface before Task creation. The unified Task consumes immutable repository evidence and does not clone independently, avoiding two repository sources.
- `panel.create_task` has no directory override. Cloning into one new child of the Mission project keeps every fixed-profile Task in the same project scope while the handoff identifies the nested working repository exactly.
- Existing-scaffold continuation remains an operator-explicit variant. It is not an automatic no-clone path.
