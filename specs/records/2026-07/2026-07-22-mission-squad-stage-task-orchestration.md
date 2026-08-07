# Mission-Owned Squad Stage Task Orchestration

## Recall

| Item                    | Requirement or evidence                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement        | Fix the active Mirror Prism failure. Mission must naturally divide a cross-squad delivery by logically independent squad stages. A selected virtual workflow is binding and cannot omit, skip, substitute, or reorder nodes. MirrorTest is post-delivery test audit, not product debugging.                                                                                                                                                   |
| Live failure evidence   | Task `tsk_f893544930016tTFCPsi7w8xcA` remains active with zero Goals. Its root profile changed `mirror-prd -> mirror-watch -> mirror-prd -> mirror-watch -> research-studio -> mirror-prd`; all observed child sessions have no `goal_id`. Mission state still records the Task as failed while the Task later resumed, and a task-scoped `universal-build` was dispatched to repair missing PRD Goal-plan artifacts.                       |
| Package evidence        | The project installs Mirror Watch `2026.07.22.2`, Mirror PRD `2026.07.22.5`, Mirror Design/Code `2026.07.22.4`, and MirrorTest `2026.07.22.3`, all older than the repository contracts. The installed cluster Skill advances five stages by mutating one Task root profile.                                                                                                                                                                   |
| Design correction       | A cross-squad Mission materializes one dependent Mission-owned Task per squad stage. Each stage Task has one fixed `promptProfile`, creates only local delivery Goals, and executes one binding package workflow. Mission passes visible accepted evidence to the next Task and never uses `select_expert_squad` as a stage-transition mechanism.                                                                                           |
| Entity boundary         | Mission owns the final multi-stage outcome and stage Task ledger. A stage Task owns one squad and its local Goals. A Goal owns an independently accepted delivery surface inside that squad. Agents are binding workflow nodes inside the Task/Goal boundary.                                                                                                                                                                               |
| Hard constraints        | No host workflow engine, state machine, route gate, hidden message, synthetic progress, fallback squad, profile alias, or second active-squad field. `prompt_profile.active` remains the sole active squad value for each Task root. Dependent stages dispatch only after predecessor Task terminal acceptance. Do not restart or modify the running OpenCorvus/Overlay process or the live Prism task.                                     |
| Sources read            | `mission-core.txt`, `orchestrator-core.txt`, `panel.create_task`, `select_expert_squad`, Mission wake/session code, all five manifests and stage prompts, Mirror Prism cluster Skill/references, SDK collaboration validator/tests, scheduler traversal tests, current architecture/public docs, and the live SQLite/session/Mission/package evidence.                                                                                      |
| Whole-repository search | `mirror-prism-cluster` is owned and projected only by Mirror PRD; five special `mirror-prism-*-stage` workflows are referenced by manifests, scheduler tests, SDK tests, docs, and records. `select_expert_squad` is a general Task-root tool and is explicitly described in core prompt as reconsidering later phases. Mission currently defaults to bundling related work into one Task and inherits/overrides one child `promptProfile`. |
| Independent feedback    | None. The user did not request sub-agents and current collaboration policy prohibits inferred delegation. The primary agent owns implementation and second review.                                                                                                                                                                                                                                                                          |

## Target architecture

```text
Mission
  -> source-observation Task [promptProfile=mirror-watch]
       -> local Goal(s) -> mirror-prism-source-observation
  -> product-requirements Task [promptProfile=mirror-prd]
       -> local Goal(s) -> mirror-prism-prd-stage
  -> design Task [promptProfile=mirror-design]
       -> local Goal(s) -> mirror-prism-design-stage
  -> implementation Task [promptProfile=mirror-code]
       -> local Goal(s) -> mirror-prism-code-stage
  -> acceptance Task [promptProfile=opentest]
       -> local Goal(s) -> mirror-prism-acceptance-stage
```

The Mission dispatches only the first ready stage. After terminal acceptance it writes the accepted Task ID, exact artifact references, limitations, next squad ID, and next workflow ID into Mission state and the next Task request. A failed stage remains owned by that Task/squad. Product repair discovered by MirrorTest becomes a new Mirror Code repair Task followed by a new MirrorTest retest Task; MirrorTest never changes profile or edits product source.

## Exhaustive call-point disposition

| Surface                                                 | Disposition                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission core prompt                                     | Add the cross-squad exception to batch-first granularity: exact different squad stages are separate dependent Tasks, created serially with explicit fixed `promptProfile`. Require reconciliation before advancing and prohibit one Task from changing squad for stage progression. |
| `panel.create_task` schema/description                  | Document that `promptProfile` fixes the owning squad for a Mission stage Task; cross-squad collaboration supplies an explicit override for every stage. No host enforcement or new field.                                                                                           |
| Orchestrator core and `select_expert_squad` description | Limit profile switching to pre-work correction or a new operator scope before domain dispatch. It is not a cross-squad phase transition. Keep implementation and rollback behavior unchanged.                                                                                       |
| Mirror Prism cluster Skill/references                   | Rewrite as a Mission launcher contract. It tells the invoking Chat/Mission to create five dependent Tasks and contains no `select_expert_squad` stage route. Handoffs name predecessor/next Task IDs rather than one Task's completed/next Goal IDs.                                |
| Five special stage workflows                            | Retain goal-scoped workflows, but redefine them as local workflows of fixed-profile stage Tasks. Each scheduler creates exact local Goal(s) from the Mission handoff before the first dispatch. Remove claims that one cluster Task pre-created all five Goals.                     |
| SDK collaboration validator                             | Define collaboration stages as Mission-owned fixed-squad Tasks whose selected workflow remains entirely goal-scoped. Preserve exact manifest/workflow/dependency/evidence/repair validation and non-execution/non-persistence.                                                      |
| Scheduler traversal test                                | Delete the five-profile mutation traversal as a success model. Replace it with assertions that the Mission contract creates fixed-profile stage Tasks and the cluster Skill contains no stage `select_expert_squad` route.                                                          |
| Package/SDK/public/current docs                         | Replace one-Task/five-stage-Goal wording with Mission/stage-Task/local-Goal ownership. Mark the earlier Goal-switching design superseded.                                                                                                                                           |
| Generated payload/template                              | Regenerate from staged package sources and update the portable authoring template so future squad integrations use the same boundary.                                                                                                                                               |

## Verification plan

1. Mission prompt and panel capability tests prove cross-squad stages are separate dependent fixed-profile Tasks and cannot advance before terminal predecessor acceptance.
2. Real Registry/Resolver package tests prove every special stage workflow is goal-scoped, cluster routing is absent from domain scheduler prompts, and the launcher contract contains no `select_expert_squad` transition.
3. SDK tests validate the five-stage static contract and reject unknown squads/workflows, disconnected evidence, non-goal-scoped stage workflows, and invalid repair owners.
4. Run Mission, scheduler, package, SDK, payload, portable-template, historical/document-health, typecheck, API route, docs, and push-hook checks.
5. Primary-agent review checks for remaining one-Task cross-squad wording, domain-profile substitution, MirrorTest product repair, generated payload drift, and live-process interference.
