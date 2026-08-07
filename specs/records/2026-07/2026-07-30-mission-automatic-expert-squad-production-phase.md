# Mission Automatic Expert Squad Production Phase

Status: implemented and accepted through an isolated real dev Mission on
2026-07-30.

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | “给mission模式设计一个在找不到合适专家图的时候自动生产专家团的phase，生产的专家团。” The user confirmed that the intended lifecycle is capability-gap recognition, Expert Squad production, validation and installation, then a new fixed-profile domain Task. The user explicitly requested a very thorough design before implementation and later fixed the automatic package shape at 3–9 domain sub-Agents, optional small Skills, and no private runtime. |
| Acceptance criteria | A Mission with a healthy full recommendation catalog naturally selects an exact suitable installed domain Squad when one exists. When none exists, it creates one visible Mission-owned production Task using `general`, produces and installs one project-scoped, self-contained Squad through the canonical authoring path, reconciles the completed Task with a fresh canonical catalog read, and only then creates a separate domain Task whose `promptProfile` is the exact new manifest ID for its full lifetime. An automatically produced package contains 3–9 necessary domain Agents excluding its Orchestrator, 0–3 prompt-only Skills only when they remove repeated domain instructions, and no private runtime. |
| Hard constraints | No keyword classifier, score threshold, Host gate, phase state enum, workflow engine, fallback profile, hidden message, synthetic Task, second catalog, second package writer, implicit global install, automatic replacement, Task-local profile switching, or direct Mission domain execution. Automatically produced packages have no package tools, package Model Context Protocol servers or refs, executable, library runtime, credential, local process, environment dependency, or runtime asset dependency. `prompt_profile.active`, `PromptProfileResolver`, Registry, Manager, the SDK writer, Mission-owned Tasks, and normal visible tool calls remain the only authorities. |
| Current runtime facts | Mission already owns compact `panel.expert_squad_catalog` recommendations and fixed-profile `panel.create_task`. General already projects `default/skill/expert-squad-authoring` and `expert_squad_author`. The authoring bridge already validates with the SDK, materializes a temporary package, validates it through Registry, and imports it through Manager. Cross-squad delivery already uses one Mission-owned Task per fixed-squad stage. |
| Sources read | `AGENTS.md`; `specs/current/architecture/04-extensions.md`; `specs/current/architecture/99-principles.md`; the 2026-07-21 Mission-owned launch record; the 2026-07-22 conversational authoring and Mission squad-stage records; the 2026-07-23 SDK legality record; the 2026-07-25 compact recommendation record; the 2026-07-28 runtime authoring repair; Mission and Orchestrator core prompts; panel capability/tool code; recommendation catalog schemas and resolver; General package projection; authoring Skill/tool/service; SDK writer; Registry; Manager; focused catalog, panel, and authoring tests. |
| Whole-repository search | `panel.expert_squad_catalog` has one Mission-only implementation and derives from `PromptProfileResolver.recommendationCatalog`. Mission `panel.create_task` requires an exact catalog-selected `promptProfile`. `expert_squad_author` is projected to the General scheduler, while the authoring implementation remains `ExpertSquadConversationAuthoring.author -> writeExpertSquadPackage -> Registry validation -> Manager import`. Mission-visible selected IDs are stored on the Mission session and deliberately restrict catalog output. No existing Mission capability-gap-to-authoring bridge exists. |
| Workspace state | The primary worktree is on `v0.0.26beta` and contains many unrelated deleted screenshots plus `test-preload.ts`. They belong to concurrent work and must remain untouched. No new worktree is authorized. |
| Independent agent feedback | None. The user did not request independent or parallel agents, and current collaboration policy prohibits inferred delegation. The primary agent owns the design and second review. |

## Decision

“Production phase” is an ordinary, visible Mission-owned Task, not a new Host
phase entity.

```text
Mission
  -> read canonical recommendation catalog
  -> choose an exact installed domain Squad
     OR
  -> production Task [promptProfile=general, project scope]
       -> investigate the exact capability gap
       -> author one complete package
       -> SDK write -> Registry validate -> Manager import
  -> wait for terminal acceptance
  -> read the canonical recommendation catalog again
  -> domain Task [promptProfile=<new exact manifest id>]
       -> execute only the new Squad's local workflow and Agents
```

This uses the existing Mission phase ledger and preserves all current ownership:

- Mission decides phase boundaries and owns child Tasks.
- General is the bootstrap producer because it already owns the canonical
  authoring Skill and tool.
- The production Task owns package design and installation evidence.
- Registry and Manager own package validity, identity, scope, and atomic
  publication.
- `PromptProfileResolver` owns discovery and runtime projection.
- The later domain Task owns delivery and never changes Squad to represent a
  Mission transition.

No dedicated built-in “Squad factory Squad” is introduced. Such a package would
need another bootstrap path, duplicate General's existing authority, and still
depend on the same SDK/Registry/Manager chain.

## What “no suitable Expert Squad” means

The Mission makes this decision from the compact, canonical recommendation
catalog. It does not compute a Host score.

A specialized Squad is suitable when its selector guidance positively owns the
domain stage and either:

- its direct-dispatch contract can own the complete requested stage; or
- exactly one declared workflow is applicable with all mandatory inputs
  available.

The comparison covers the requested outcome, domain, deliverable types,
required mature tools or evidence sources, acceptance boundary, and ownership
of implementation/review work. Label similarity is not evidence.

General remains available as the bootstrap producer and emergency generic
runtime, but its broad availability does not prove that an appropriate reusable
domain Squad exists. Otherwise the proposed feature could never trigger because
`general` is always present.

### Conditions that are not capability gaps

The Mission must not produce another Squad when the observed problem is:

- catalog discovery, Registry, or recommendation projection failure;
- a corrupt, stale, or invalid package that already owns the exact domain;
- missing model access, credentials, permissions, executable dependencies, or
  network availability;
- a failed Task whose existing Squad contract was appropriate;
- one missing workflow input;
- an operator-selected Squad subset that intentionally excludes other profiles.

These are infrastructure, package repair, prerequisite, execution, or operator
scope problems. Generating a competing identity would be a fallback and a
second source.

### Explicit launcher selection

An empty launcher selection exposes the full canonical catalog and permits
automatic production.

A non-empty launcher selection is an explicit operator scope. Mission may use
only those exact Squads and must not silently widen the selection by installing
a new one. Automatic production is permitted in that case only when the
operator's original request expressly authorizes creation of a missing Squad.
This preserves explicit user choice without inventing another visibility field.

## Production Task contract

Mission creates the production Task with:

- `promptProfile: "general"`;
- project execution directory equal to the owning Mission project;
- a short semantic title that the existing ledger renders as a normal
  `Phase xx: ...` row;
- the relevant original user input verbatim;
- a positive capability brief describing the domain owner that is needed;
- the catalog evidence considered and the exact uncovered responsibility;
- one proposed semantic manifest ID that is absent from the observed catalog;
- `installation_scope: "project"`;
- `replace: false`;
- an explicit Goal-mode choice.

The existing authoring contract makes non-Goal mode the default unless the
operator explicitly opted into durable Goal ownership. Mission must preserve
that rule. It cannot infer Goal mode merely because the original Mission is
long-running.

The production Task may dispatch General investigation or design Agents when
the package requires repository facts, current external documentation, tool
selection, or a real capability graph. It then builds one complete
`ExpertSquadPackageDefinition` and invokes `expert_squad_author`. It must not
write directly into `.opencorvus/expert-squads`, ask the project to install the
SDK, or create a second package materializer.

The Task request fixes the intended manifest ID before authoring. The production
Task cannot silently choose another ID after a collision because Mission needs
a stable recovery identity. A real collision is reconciled by Mission against a
fresh catalog and becomes either reuse of the already suitable identity or a
new explicitly planned production Task.

## Generated package contract

The generated package must be:

- project-scoped by default;
- semantically narrow enough to have meaningful selector guidance;
- composed of 3–9 necessary, non-overlapping projected domain Agents excluding
  its Orchestrator;
- limited to 0–3 small prompt-only package Skills, and only when a Skill removes
  repeated domain instructions across those Agents;
- self-contained without a private runtime;
- identified only by manifest `id`;
- explicit about every Agent, prompt, optional prompt-only Skill, and workflow
  it projects;
- limited to its manifest, README, selector, Agent prompts, optional
  prompt-only Skill directories, and platform `default` capabilities;
- free of package tools, package Model Context Protocol servers or refs,
  executables, libraries, credentials, local processes, environment
  dependencies, and runtime asset dependencies;
- free of runtime dependencies on another private Squad;
- free of cross-squad routing instructions;
- free of active/default workflow state;
- complete enough that `PromptProfileResolver` can project its full declared
  closure without General inheritance.

Manual package authoring retains the general package protocol, including
legitimate package tools or Model Context Protocol resources. The lightweight
restriction belongs to the Mission production brief and canonical authoring
Skill rather than a Registry gate, so it does not create a second package
format or reject valid manually provisioned packages.

Automatic production never installs user-global content. User-global scope
requires an explicit operator request because it changes the catalog of every
registered project and must pass the existing cross-project manifest-ID
conflict checks.

## Publication, idempotency, and recovery

The existing authoring call is atomic but is not retry-idempotent after a
successful install: a second `replace: false` call currently reports that the
same ID already exists. A Task can therefore install successfully and still
lose its final narration before Mission observes completion.

Implementation must close that recovery hole at the canonical Manager/Registry
boundary:

1. Validate and materialize the requested definition exactly once through the
   SDK writer.
2. Registry computes one `package_digest` over the complete validated package
   tree: canonical project-relative path, byte length, and exact bytes for every
   regular package file in canonical path order.
3. Under the existing manifest-ID installation lock, compare the validated
   staged package with an installed package at the same project scope through
   that exact digest.
4. If they are identical, return the existing installed identity without
   rewriting it.
5. If the same ID differs, return the existing explicit identity-conflict error.
6. Keep `replace: true` outside the automatic production path.

This is data-integrity idempotency, not a scheduling gate or fallback.

The existing catalog `declaration_hash` is not reused for this purpose. It
identifies the catalog declaration and selected README/selector facts, but it
does not cover every package Skill, tool, Model Context Protocol definition,
asset, and prompt byte. Treating it as the package identity would permit
different executable packages to compare equal.

The authoring result must expose the exact manifest ID, version, installation
scope, projected Agent identities, file count, canonical package digest, and
target identity. The Task's visible completion summary must repeat the exact ID,
scope, and digest.

Mission acceptance requires both:

1. `panel.query_task` reports terminal success for the production Task; and
2. a fresh `panel.expert_squad_catalog` call returns the proposed exact ID with
   the expected version, `package_digest`, selector guidance, and workflow
   summary.

Task narration alone is insufficient, and catalog appearance alone cannot prove
that the Mission-owned production phase succeeded. The two facts reconcile the
Task lifecycle with the canonical installed-package source.

Only after that reconciliation may Mission create the domain Task. The domain
Task does not need a copied package body or installation path. Its explicit
`promptProfile` lets the existing Resolver load the complete package.

## Failure ownership

| Observation | Owner and next action |
| --- | --- |
| Catalog call fails or reports discovery issues affecting the decision | Mission records the infrastructure blocker and routes repair/escalation. It does not produce a Squad. |
| A specialized Squad exactly owns the stage | Mission creates the domain Task directly with that exact ID. |
| Only General or partial domain matches exist in a healthy full catalog | Mission creates one General production Task for the uncovered stage. |
| Production Task needs ordinary project-scoped authoring | Continue automatically through visible Task/tool calls. |
| Production Task requests user-global installation | Stop and request explicit operator authority; automatic production is project-only. |
| Same ID already contains the byte-identical validated package | Canonical authoring returns the existing identity and Mission reconciles it through the catalog. |
| Same ID contains different content | Production Task fails with an identity conflict; Mission must not replace it automatically. |
| SDK, Registry, or Manager rejects the package | The General production Task repairs the same definition and retries within its Task; it does not publish an alternate hand-written package. |
| Production Task terminates without catalog publication | Mission records the failed phase and does not create the domain Task. |
| Catalog publishes the ID but the production Task does not terminally succeed | Mission reconciles the Task before continuing; it does not treat installation side effect alone as phase acceptance. |
| New domain Task reveals a package-design defect | Finish or fail that Task honestly, then create a separate General package-repair Task and a fresh domain Task. Do not mutate the running Task's Squad or disguise repair as another domain Agent. |
| Domain execution fails for credentials, model, network, or project-tool reasons | Repair the actual prerequisite or execution path. Do not generate another Squad. |

## Multi-domain Missions

Mission evaluates suitability per independently accepted domain stage, not once
for the entire Mission.

- Existing suitable stages keep their installed Squad.
- Only uncovered stages receive a production Task.
- Independent production Tasks may run in parallel when their package IDs,
  source requirements, and later domain stages are independent.
- A dependent domain Task waits for its own production Task's terminal
  acceptance and catalog reconciliation.
- Mission does not generate one oversized “do everything” Squad merely because
  several stages are missing.

This extends the existing fixed-squad stage architecture rather than replacing
it.

## Call-point disposition

| Surface | Required disposition |
| --- | --- |
| `packages/opencorvus/src/prompt/core/mission-core.txt` | Add the natural capability-gap decision, General production Task contract, explicit-selection boundary, terminal/catalog reconciliation, and prohibition on treating infrastructure failure as absence. Do not add Host matching logic. |
| `packages/opencorvus/src/panel/capability.ts` | Keep the two existing actions. Clarify that `expert_squad_catalog` is reread after production and that `create_task(promptProfile="general")` is the ordinary production-phase edge. No new phase action or schema field. |
| `packages/opencorvus/src/tool/panel.ts` | Preserve the one Mission-only catalog and one Mission-owned Task creation path. No authoring mutation is added to Panel. |
| `packages/opencorvus/src/mission/session.ts` and `/mission/wake` | Preserve launcher-selected visibility as operator scope. Do not add a second mutable Mission catalog or active Squad field. |
| `packages/opencorvus/src/expert-squad/catalog.ts` and `prompt-profile-resolver.ts` | Preserve compact recommendations from the canonical validated inventory and add the Registry-owned `package_digest` as the one post-production byte-identity fact. Do not expose full Settings payloads. |
| General `expert-squad.jsonc` | Preserve General as the sole bootstrap projection with `expert_squad_author` and `expert-squad-authoring`; do not introduce a factory built-in. |
| General scheduler prompt | Explain that a Mission production Task owns one exact project-scoped package and must finish the canonical authoring/validation/import contract. It cannot turn every ordinary General Task into authoring work. |
| `expert-squad-authoring/SKILL.md` | Add the Mission production brief, fixed expected ID, project-only automatic scope, visible receipt, and retry-idempotency semantics. Preserve the canonical SDK writer requirement. |
| `tool/expert-squad-author.ts` | Return the Registry-owned `package_digest` with the existing exact identity. Keep project/global explicit and keep automatic calls at `replace: false`. |
| `expert-squad/conversation-authoring.ts` | Reconcile byte-identical retry results through the Manager/Registry owner rather than adding another filesystem comparison. |
| `expert-squad/manager.ts`, Registry, and install lock | Registry defines the full canonical package-tree digest. Manager compares it under the existing ID lock and owns same-ID/same-scope identical-package reuse atomically; different-content identity collisions stay explicit. |
| SDK `expert-squad-authoring.ts` | Remain the sole definition validator and source materializer. Reuse its canonical validation; do not move installation or Mission policy into the SDK. |
| Task API / effective config / Resolver projection | Preserve exact `promptProfile` persistence and full-lifetime Task ownership unchanged. |
| Work Ledger and Settings UI | No new UI state or component. Existing Mission child Task rows visibly show the production and domain phases; the existing installed-Squad surface shows the package. Implementation acceptance still visually inspects both real surfaces. |
| Current architecture and product docs | After implementation, document General bootstrap production, project-only automatic scope, and the two-Task boundary. This dated record remains the design history. |

## Positive verification contract

Implementation tests must verify current positive outcomes rather than the
absence of old behavior:

1. Mission prompt contract maps a healthy catalog capability gap to a visible
   General production Task and then to a fresh exact-profile domain Task.
2. Mission catalog projection returns the canonical newly installed package
   identity after project-scoped authoring.
3. General scheduler projection includes the one canonical authoring Skill and
   tool needed by the production Task.
4. A complete package definition is written by the SDK, validated by Registry,
   imported by Manager, and resolved by `PromptProfileResolver`.
5. Repeating the exact same definition and scope returns the same canonical
   installed identity without rewriting package content.
6. A same-ID/different-definition input maps to the existing typed identity
   conflict contract.
7. Mission creates the later Task with the exact new manifest ID and the
   Resolver projects the package's complete declared scheduler, Agent, Skill,
   tool, Model Context Protocol, and workflow sets.
8. Multi-stage coverage proves an existing suitable stage and one generated
   missing stage become separate fixed-profile Mission Tasks with the declared
   dependency.
9. Real OpenCorvus interaction shows the production Task and later domain Task
   as Mission children, and the project Settings catalog shows the installed
   Squad. Visual review uses a headed real page and fresh screenshots; no UI
   automation test, fixture, or screenshot baseline is added or run.

Relevant focused non-UI suites include the Mission prompt contract, Panel tool
contract, recommendation resolver, conversation authoring, package Manager,
Registry, General projection, prompt-profile resolver, and Task
profile-inheritance suites. Any existing negative or UI automation assertions
encountered in touched test paths must be removed rather than updated.

## Implementation order

1. Add canonical identical-package retry semantics and focused positive
   authoring/Manager/Registry coverage.
2. Return the canonical package digest through the authoring result.
3. Update the authoring Skill and General scheduler guidance.
4. Update Mission reasoning and Panel descriptions without adding a Host
   decision branch.
5. Add positive Mission-to-production-to-domain contract coverage.
6. Update current architecture and public docs, regenerate official payloads
   and API artifacts through repository commands, and run document health.
7. Exercise a real isolated Mission with a healthy catalog containing no
   matching specialized Squad, visually inspect the Work Ledger and installed
   Squad surfaces, then run a real domain Task with the new exact profile.
8. Perform a second source/diff/runtime review before committing and pushing the
   implementation.

## Implementation and real dev acceptance

The implementation kept the designed ownership boundaries:

- Registry computes the full canonical validated package-tree digest.
- Manager reuses an exact same-ID, same-scope, byte-identical package for a
  `replace: false` retry and keeps different content as an explicit identity
  conflict.
- The authoring receipt and compact recommendation catalog expose the same
  canonical digest.
- Mission, General, and the canonical authoring Skill carry the 3–9 Agent,
  0–3 prompt-only Skill, and no-private-runtime production contract.
- No new Host phase, state field, route, catalog, package writer, or matching
  gate was introduced.

The isolated real dev run used:

- Mission `d3d10e74339835dd`;
- General production Task `tsk_fb3ac4c97001TUMBEPV6h4gBQr`;
- fixed-profile domain Task `tsk_fb3b45987001jwyBVPxVTzBR47`;
- generated package `lunar-tea-release-audit-v2` version `2026.07.30.1`;
- canonical package digest
  `b807a6abbdf02668a198eb4e5ac5a4a93129aab4e47ddbb3d28180d43b40bce4`.

The production Task reached terminal success before Mission reread the canonical
catalog. The fresh catalog returned the exact same ID, version, and digest, and
only then did Mission create the independent domain Task with
`promptProfile: "lunar-tea-release-audit-v2"`.

The installed package contains four domain Agents:

- `ceremony-sequence-auditor`;
- `lunar-safety-auditor`;
- `migration-compatibility-auditor`;
- `release-verdict-editor`.

It contains zero package Skills and exactly seven files: manifest, README,
selector, and four Agent prompts. Every package tool and package Model Context
Protocol ref is empty; no executable, library, credential, local process, or
runtime asset exists.

The domain Task read the real `lunar-tea-release-notes.md`, produced and
committed `ceremony-review.md`, published an immutable Task Artifact snapshot,
and terminally succeeded. The Mission status endpoint reported two successful
Tasks, zero failures, and 100 percent completion. The delivery contains exactly
three numbered audit rules and the byte-exact final line
`RELEASE AUDIT: PASS`.

Fresh headed-page screenshots were personally inspected:

- `specs/artifacts/2026-07-30-mission-auto-squad-e2e/04-production-terminal-and-catalog-recheck.png`;
- `specs/artifacts/2026-07-30-mission-auto-squad-e2e/05-fixed-profile-three-domain-agents.png`;
- `specs/artifacts/2026-07-30-mission-auto-squad-e2e/06-mission-success-two-of-two.png`;
- `specs/artifacts/2026-07-30-mission-auto-squad-e2e/07-installed-squad-four-agents-zero-skills.png`;
- `specs/artifacts/2026-07-30-mission-auto-squad-e2e/08-installed-squad-agent-roster.png`.

During the long streamed `expert_squad_author` input, opening the production
Task once showed the existing `signal timed out` conversation-load error. The
same real page recovered after the tool completed and subsequently rendered the
production terminal state, catalog reconciliation, fixed-profile domain Task,
live sub-Agent cards, installed Squad roster, and final 2/2 Mission result.

## Second review

The design was challenged against the principal failure modes:

- Using General directly for delivery would make the requested production phase
  unreachable and would not create reusable domain capability.
- Giving Mission `expert_squad_author` would mix coordination with executable
  extension production and bypass the existing fixed-profile Task boundary.
- Creating a dedicated factory Squad would duplicate the General bootstrap
  authority and create a bootstrap cycle.
- A Host “no match” classifier would become a keyword/score gate and drift from
  package selector guidance.
- Automatically replacing an existing ID would destroy identity safety.
- Treating successful installation as completed phase evidence would ignore
  Task lifecycle; treating Task narration as sufficient would ignore canonical
  catalog publication.
- Appending generated IDs to a second Mission visibility list would create a
  parallel catalog authority. Empty selection already exposes the live full
  catalog; explicit non-empty selection remains an operator boundary.
- Generating one Mission-wide mega-Squad would erase the existing cross-squad
  stage ownership model.

The retained design uses the smallest complete extension of current
architecture: one additional natural Mission decision and one ordinary General
production Task, followed by the already canonical fixed-profile domain Task.
