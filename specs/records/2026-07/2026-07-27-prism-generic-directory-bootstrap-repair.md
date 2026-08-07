# Prism Generic Directory Bootstrap Repair

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | Fix the Prism Mission that refused to bootstrap `https://www.tradingview.com/spaces/` in `/Users/yangheng/Documents/OpenCorvus-Demos/prism`; the user explicitly states that a configured `origin`, approved scaffold repository, baseline branch, and clean worktree are not requirements. |
| Acceptance | `mirror-prism-generic` creates its one fixed `prism` Task directly in the Mission-selected current directory without asking for a scaffold repository, cloning, requiring a Git remote, or requiring a clean worktree. Existing files and concurrent changes are preserved. `mirror-prism-ainvest` retains its explicit canonical scaffold clone and verification contract. The first Prism worker treats the Host-bound Task directory as authoritative and does not reintroduce the retired generic Git preflight. |
| Hard constraints | Repair prompts and package contracts rather than adding a Host gate, fallback, compatibility alias, hidden bootstrap packet, or second directory source. Preserve all unrelated worktree changes. Regenerate the canonical built-in Mission Skill payload. Commit with `dsw-33987` and push through normal hooks to `myhexin`. |
| Sources read | `AGENTS.md`; the reported Mission transcript for session `ses_05c96997bffeoD7Py9wJU5Iu9y`; `mirror-prism-cluster` Skill and references; Prism selector, README, Orchestrator, general-researcher prompt and role Skill; source-capability contract; package/payload/SDK tests; 2026-07-23 scaffold restoration and 2026-07-26 evidence-boundary records. |
| Whole-repository search | `rg` found the generic scaffold precondition in the Mission Skill description/body, `references/scaffold-bootstrap.md`, stage map, Goal ownership/decomposition, generated payload, Prism selector/README/Orchestrator/researcher contracts, the source-capability artifact, and four focused test surfaces. Historical records remain historical evidence and are not rewritten. |
| Independent-agent feedback | None. The user did not request delegated or parallel agents. |

## Causal chain

1. Observable behavior: the Mission ended with zero Tasks after the user selected the current directory.
2. Direct trigger: `git remote get-url origin` failed and `git status --short` was non-empty, so the Mission-applied `scaffold-bootstrap.md` contract refused `panel.create_task`.
3. Deeper cause: the 2026-07-23 clone-first restoration generalized an AInvest scaffold requirement to `mirror-prism-generic`, even though a generic Prism request already has one explicit execution source: the Mission-selected current directory.
4. Duplicate enforcement then spread into the Prism selector, scheduler, and first researcher, so removing only the Mission preflight would still stop the Task after creation.
5. Repeating “就在这个目录” could not succeed because the prompt treated directory authorization as weaker than its invented Git-remote and cleanliness prerequisites.

## Exhaustive call-point disposition

| Surface | Disposition |
| --- | --- |
| `mirror-prism-cluster/SKILL.md` | Make the selected current directory canonical for generic delivery; retain clone/verification only for the explicit AInvest workflow. |
| `references/scaffold-bootstrap.md` | Replace with `references/repository-boundary.md`; define generic directory binding and AInvest-only scaffold provisioning without a compatibility path. |
| `references/stage-map.md` | Split source Step 2 behavior by exact workflow; remove generic clone/branch/remote/cleanliness prerequisites. |
| `references/goal-ownership.md` and `goal-decomposition.md` | Replace shared bootstrap-evidence ownership with Task-directory ownership; keep AInvest provisioning evidence Mission-owned. |
| Prism `selector.md` and `README.md` | Permit generic delivery in the selected current directory and prohibit invented scaffold/Git preconditions. |
| Prism Orchestrator and general researcher contracts | Use the Host-bound Task directory as authoritative; preserve existing changes; never block generic execution for absent `origin` or a dirty worktree. |
| Source-capability artifact | Describe repository Git as AInvest provisioning plus ordinary delivery Git, not a generic Mission bootstrap requirement. |
| Built-in Mission payload | Regenerate from canonical sources and prove the retired reference/text is absent. |
| SDK, Mission payload, Prism package, and boundary tests | Assert generic direct-directory startup and AInvest-only clone semantics, including negative assertions for remote/clean-worktree gates. |
| Historical 2026-07-23 and 2026-07-26 records | Keep unchanged as dated evidence; add this superseding repair to both current indexes. |

## Validation plan

- Run focused Mission Skill payload, SDK collaboration, Prism package, and directory-boundary tests.
- Regenerate and verify the built-in Mission Skill payload.
- Run source-capability validation, relevant TypeScript checks, document-health tests, and `git diff --check`.
- Re-read the exact staged diff, confirm unrelated files are excluded, commit with the required prefix, and push through normal `myhexin` hooks.
