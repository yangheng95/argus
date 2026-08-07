# Prism Bootstrap Evidence Boundary Repair

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | Continue a real end-to-end Prism run on port 7777 against the canonical database; immediately repair evidence, path, persistence, tool, duplicate-lineage, and deadlock defects while allowing non-material omissions. Keep domain policy inside the Expert Squad rather than the global core prompt. |
| Acceptance | A real `mirror-prism-cluster` Mission bootstraps one fresh repository and creates one `prism` Task. The Task accepts its Host-bound execution directory as the Mission handoff, independently inspects the repository from its first repository-capable worker, and begins source discovery without demanding an impossible bootstrap Artifact import or copied verification prose. Invalid, missing, escaping, or dirty repository facts remain visible blockers. |
| Hard constraints | No core-prompt change, Host gate, fallback, compatibility route, hidden context packet, synthetic message, repeated Mission, or automatic retry. Preserve all concurrent worktree changes. |
| Sources read | `AGENTS.md`; `mirror-prism-cluster/SKILL.md`; `references/scaffold-bootstrap.md`; `references/task-request-contract.md`; Prism selector, README, Orchestrator prompt, general-researcher prompt, manifest, and package tests; canonical SQLite evidence for Mission `2cee2d45672b76f6` and Task `tsk_f9eda6e29001yx5qhyFPzgCM83`. |
| Whole-repository search | `rg` found the contradictory bootstrap wording only in the Prism selector, README, Orchestrator prompt, generated payload, the 2026-07-23 historical record, and its package tests. The canonical Mission contract says the first Task has no predecessor import, bootstrap facts stay only in Mission state, and `panel.create_task.directory` is the sole handoff. |
| Independent-agent feedback | None. The user did not request delegated or parallel agents. |

## Incident evidence

- Port 7777 backend PID `98144` opened the canonical database; `/global/health` returned `healthy=true` and `PRAGMA quick_check` returned `ok`.
- Mission `2cee2d45672b76f6` created fresh repository `/Users/yangheng/Documents/OpenCorvus-Demos/prism/runs/tradingview-spaces-20260726-fresh-20` at baseline `d1982dc60d3da2a22e659c49eb88e41e350679a0` and created Task `tsk_f9eda6e29001yx5qhyFPzgCM83` exactly once through part `prt_f9eda1aed001gcouV6Y2A1Ep5V`.
- Task root Session `ses_061258f86ffemMJo1qs73pDjmG` and Orchestrator Session `ses_06125878fffeDI2FOpSFc3waQ7` both used the exact fresh repository directory.
- Orchestrator ended before the first dispatch with part `prt_f9edb13ce001CHXjQyVZ8AZBZU`, claiming bootstrap evidence was absent from the Task Artifact Catalog. The catalog correctly contained no predecessor import because the first Prism Task has no predecessor Task.

## Causal chain

1. The real Mission and Host-bound Task directory satisfied the canonical bootstrap handoff.
2. The Prism Orchestrator prompt instead required the same Mission-only facts to appear as accepted Task evidence before the first dispatch.
3. The first Task cannot receive those facts through `artifact_imports`, because that protocol only imports exact Artifacts from an existing source Task; Mission state is not a source Task.
4. The Mission contract also explicitly forbids copying bootstrap commands, paths, and verification results into request prose or metadata.
5. The scheduler therefore required an impossible second evidence channel and stopped a correctly bootstrapped Task.

## Exhaustive call-point disposition

| Surface | Disposition |
| --- | --- |
| `mirror-prism-cluster/SKILL.md` and scaffold/task-request references | Keep unchanged as the single Mission bootstrap and handoff authority. |
| Prism `selector.md` | Replace the contradictory “evidence in Task request” requirement with the real Mission + Host-bound directory boundary. |
| Prism `README.md` | Document that the first Task has no predecessor Artifact import or copied bootstrap packet. |
| Prism Orchestrator prompt | Remove the impossible pre-dispatch Artifact requirement; dispatch source discovery from the real Task directory and keep invalid repository facts as blockers. |
| General researcher prompt and role Skill | Inspect Git repository identity, branch, HEAD, and cleanliness in the current Task directory before writes; report invalid repository facts rather than escaping or cloning. |
| Generated built-in Expert Squad payload | Regenerate from the canonical package source without hand-editing. |
| Prism package regression | Assert the Mission/Task evidence boundary and reject the retired request-copy/catalog precondition. |

## Validation plan

- Run focused Prism package and Mission Skill payload tests.
- Regenerate and verify the built-in Expert Squad payload.
- Re-import the canonical Prism package through the real project package manager.
- Start a new unpolluted real Mission only after the current failed Task is formally settled; verify first source dispatch, exact directories, repository inspection, and current-run Artifact production.
- Run document-health checks, relevant typecheck, `git diff --check`, focused commit, and push to `legacy-remote`.

