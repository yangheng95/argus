# Mirror Prism Goal-native source alignment

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | Research how to repair the remaining source-alignment gaps and update the `mirror/prism` Expert Squad design around OpenCorvus Goal orchestration. |
| Acceptance | Preserve material-derived route scope and clone-first Mission bootstrap; use one canonical Task RequirementSet and Architect Goal graph; prevent generic workers from seeing AInvest knowledge; restore the active source roles' production contracts through Agent-local Skills and references; validate semantic visibility and workflow topology rather than filename markers. |
| Hard constraints | Keep the fixed `prism` profile for the delivery Task. Do not add a workflow engine, status ledger, host gate, fallback, hidden message, profile switch, process restart, or new worktree. Do not touch unrelated concurrent changes. Route count comes only from acquired material. |
| Source read | All 11 active files in `/Users/yangheng/Documents/output/prism-team`, the active pipeline headings/templates, current Prism manifest/prompts/Agent Skills, Mission launcher and all references, Goal lifecycle/Requirements/Architect code, Goal model documentation, SDK topology validator, package/source-capability tests, and architecture rule 15.1. |
| Proven Goal defect | `requirements-stage.ts` supersedes the Task's active spec on every Requirements dispatch. `architect-stage.ts` reads and upserts the Task-wide Goal graph and creates the active plan. Therefore the existing PRD, Design, and Code Requirements/Architect pairs do not create independent phase-local Goal graphs; they repeatedly reinterpret one Task-wide graph. |
| Proven visibility defect | Generic and AInvest workflows reuse author/reviewer/designer/integration identities while those identities statically receive `prism/shared/ainvest-wiki`. A prompt instruction not to use the Skill does not make it invisible. |
| Proven source-contract defect | Original PRD P1-P14 schema, asset manifest/budget/report rules, competitor selection/output rules, UI/UX audit frameworks, designer production contract, and reviewer report contract are absent from the short Agent-local Skills. Existing tests generally prove ownership/source markers, not these semantics. |
| External source limits | The supplied export does not contain `ainvest-design-system` or `prd-criticizing`. Reconstruct only their observable contracts from the active callers and present AInvest Wiki design references; do not claim byte parity or create a second token authority. |
| Whole-repository grep | Workflow IDs, node IDs and counts are consumed by the Prism manifest/package/source-capability tests, SDK collaboration tests, Mission generic/AInvest definitions and references, architecture section 04, source capability contract, generated payload checks, and historical records. Runtime Goal semantics are owned by Requirements/Architect adapters, `engine_goal`, active spec/plan storage, dispatch work scope, and Goal attempt artifacts. |
| Independent feedback | The previously authorized independent reviewer rechecked the final design read-only. It confirmed the 40/44-node DAG, sole typed planning pair, clone-first Mission, material-derived route scope, Agent-local source contracts, and real resolver visibility isolation. It found two integration gaps: mapper output lacked concrete design-system values, and `partial` Requirements evidence was not explicitly excluded from predecessor success. Both are repaired below and covered by projected-capability tests. |

## Root-cause design

Virtual-workflow nodes are mandatory dispatch contracts, not Goals. A Goal is a durable, independently
accepted product outcome owned by the Task-wide Architect graph. The repaired flow therefore uses:

1. task-scoped source discovery to persist the material-derived system-project contract;
2. exactly one Task-scoped Requirements adapter and one Task-scoped Architect adapter;
3. one immutable Goal graph containing route PRD Goals, route design Goals, shared design integration,
   route implementation Goals, shared code integration, route verification Goals, and system acceptance;
4. Goal-scoped producers/reviewers dispatched only against the matching durable Goal IDs;
5. task-scoped fan-in nodes only for evidence collation and release judgment, never to manufacture a
   second phase Goal graph.

The Architect derives the number of route branches from the accepted material ledger. It registers
dependencies across goal classes, requirement-sourced acceptance specifications, owned paths, shared
contract producers/consumers, and assembly ownership in one pass.

The AInvest mapper is the sole Wiki reader. Its authority artifact is a structured, immutable,
source-path-and-digest-cited projection containing concrete light/dark token values, component
variants/states, exact asset paths, interactions, and compliance rules. It is sufficient for downstream
design without granting Wiki visibility and is not an independently editable token source.

A Requirements predecessor is terminal-successful only when the real dispatch result is `persisted`,
contains `spec_snapshot:<id>`, and Task query exposes the same active spec. `partial`, missing snapshot,
or absent active RequirementSet remains a visible blocker and cannot unlock Architect.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `expert-squads/mirror/prism/expert-squad.jsonc` | Replace repeated phase planning with source discovery → one Requirements → one Architect. Rebind later nodes to the appropriate durable Goal class. Keep Wiki on the AInvest-only mapper and remove it from every shared downstream identity. |
| Prism scheduler prompt/Skill | Explain Goal classes, exact Goal selection, terminal evidence, and the difference between manifest nodes and Goals. |
| PRD stage planning agents | Retain the Product Requirements Requirements/Architect adapters as the only canonical planning pair. Their Skills must define the complete Task-wide Goal graph. |
| Design/Code stage planning agents | Retain them as delegated frontier validators and dispatch-brief authors, not typed Requirements/Architect adapters; their former phase acceptance becomes acceptance specs in the canonical Goal graph and Agent-local production/review Skills. |
| MirrorTest planning agents | Keep intent/requirements/test architecture as task-scoped delegated planning artifacts; they must not replace the active Task spec or Goal graph. |
| Watch planning agents | Keep AInvest source planning task-scoped but use delegated-worker adapters, not a preliminary Goal graph. |
| Generic/AInvest role identity | Generic author/reviewer/designer/integration workers receive no AInvest Skill. Only the AInvest mapper receives Wiki and emits a cited product/design authority artifact; shared downstream workers consume that artifact without gaining Wiki visibility. |
| Agent-local Skills | Keep concise entrypoints and add one-level references containing the exact active source production schema, evidence requirements, stopping rules, and output contracts. |
| Mission launcher | Carry the canonical Goal graph contract in the delivery Task request and handoff. Mission still owns bootstrap/Task lifecycle, not local Goals. |
| Source-capability contract/tests | Replace source-marker-only confidence with semantic assertions for P1-P14, assets, competitor/UI/UX research, designer/reviewer contracts, one canonical planning pair, and negative generic AInvest visibility. |
| Architecture/docs | Update stale phase-local Goal and workflow-count claims to describe the single Task-wide Goal graph. |

## Verification plan

- Parse and validate the Prism package through the real Registry and SDK topology validator.
- Assert generic projected Agent closures contain no AInvest Wiki/design-system refs while every
  AInvest-dependent workflow node uses an AInvest-only identity.
- Assert exactly one `requirements` and one `architect` adapter occur in each delivery workflow and
  every Goal-scoped node descends from that pair.
- Assert source-semantic keys and output schemas exist in the owning Agent-local Skill closure.
- Run `skill-creator/scripts/quick_validate.py` for every changed/new Skill.
- Run focused Prism package/source-capability, Mission Skill, SDK collaboration/authoring, payload,
  historical-link, document-health, typecheck, route and docs checks.
- Review the final diff and stage only task-owned files before commit/push to `legacy-remote`.

## Verification evidence

- `bun test packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts packages/opencorvus/test/expert-squad/mirror-prism-source-capability.test.ts packages/sdk/js/test/mirror-prism-authoring.test.ts packages/sdk/js/test/mirror-prism-collaboration.test.ts`: 18 passed, 0 failed, including real Registry and `PromptProfileResolver` projection.
- `bun test packages/opencorvus/test/mission-skill/builtin-payload-generation.test.ts packages/opencorvus/test/mission-skill/catalog.test.ts`: Mission catalog and generated payload passed.
- `bun test --timeout 30000 packages/opencorvus/test/expert-squad/payload-generation.test.ts`: 10 passed, 0 failed. The repository scan exceeds the test file's default five-second timeout in this dirty shared worktree, so the same assertions ran with a 30-second runner timeout.
- All 20 changed Agent-local Skills passed the `skill-creator` validator. The Mission Skill uses its dedicated `required_tools` schema and is validated by the Mission catalog tests rather than the ordinary Skill frontmatter validator.
- `bun run typecheck`, `bun run api:routes-check`, and `bun run docs:check` passed.
- Historical links, document health, and product-doc single-source tests passed after task-owned record staging.
- Independent read-only re-review closed the concrete AInvest design-authority handoff and the scheduler-level `partial` Requirements predecessor risk. It found no DAG cycle, unknown executor, Mission bootstrap gap, route-quota regression, or source-schema loss.
