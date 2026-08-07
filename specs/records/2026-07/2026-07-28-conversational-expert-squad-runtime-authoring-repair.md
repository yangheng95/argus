# Conversational Expert Squad Runtime Authoring Repair

Date: 2026-07-28

Status: runtime repair verified; exact Opus conversation acceptance blocked by external model routing

## Recall

| Item | Details |
| --- | --- |
| User requirement | Use the real end-to-end Skill flow to create an Agent Squad through conversation, start the dev backend locally, use `hexin/claude-opus-5`, and repair every defect exposed by the test instead of only reporting it. |
| Acceptance criteria | General Chat exposes the canonical `expert-squad-authoring` Skill; the Skill uses the existing SDK writer plus generated client validation/import path; a real Opus conversation creates a project-scoped two-Agent Squad and reports its exact ID, scope, roles, and tool results; the created Squad is visible in the real UI; focused regressions, storage refresh, typecheck, docs, and generated-artifact checks pass. |
| Hard constraints | Follow `AGENTS.md`; preserve concurrent changes; no fallback authoring path, second writer, panel-only synthetic action, workflow gate, state machine, hidden message, broad database reset, or interruption of the existing port-7878 OpenCorvus/Overlay process. Run Playwright with Node, visually inspect fresh screenshots, commit with the `dsw-33987` prefix, and push the current primary branch to `legacy-remote`. |
| Runtime evidence | On isolated port 7879, the provider catalog was explicitly refreshed and `hexin/claude-opus-5` selected. The real right-sidebar Chat received the creation request but could only use read/Bash discovery, consumed more than 461k tokens, and terminated with “No conversation tool can create an Agent Squad.” Its catalog showed no authoring Skill and the read-only `expert_squad_catalog` panel action was unavailable to the Chat actor. The initial default-data dev start also exposed `engine_artifact: payload catalog metadata is inconsistent` during `restoreCurrentSchemaData`; the failed current image contained zero projects/sessions/messages while the immutable backup retained 17/106/1697. No process held the files, both passed SQLite integrity checks, and the backup was restored to the canonical path while the empty image was preserved in `schema-refresh-failed-2026-07-28T01-05/`. |
| Sources read | `AGENTS.md`; current extensions architecture; the 2026-07-22 conversational authoring record; the 2026-07-25 schema-refresh repair record; portable authoring Skill artifact; portable generator and tests; built-in Skill generator/payload/tests; General package manifest and projection tests; SDK authoring entrypoint; Expert Squad Manager/Registry routes; panel capability/action code; storage DDL, refresh implementation, and storage tests; live browser, provider catalog, server logs, and database images. |
| Whole-repository grep | `renderAuthoringSkill` has one definition and one artifact call in the portable generator; `generatePortableExpertSquadTemplate` is called by root generation and focused tests. Built-in Skills are discovered only from `src/skill/builtin/**` and compiled into `builtin-payload.ts`. General scheduler grants are owned by `builtin/general/expert-squad.jsonc` and asserted by `multica-general-projection.test.ts`. `writeExpertSquadPackage` remains the only authoring writer; Manager validate/import remain the only installation path. `restoreCurrentSchemaData` is the sole backup-copy loop; its alphabetically sorted `readOrdinaryTableShape` places `engine_artifact` before `engine_artifact_catalog_revision`, while insert triggers require the revision row to exist first. |
| Independent agent feedback | No independent Agent was requested for repository implementation. The requested product-level Agent Squad will be created only after the repaired runtime Skill is available. |

## Causal chain

### Conversation authoring

1. The authoring contract and SDK path were implemented in
   `renderAuthoringSkill()`, but generation wrote that Skill only into
   `specs/artifacts/portable-expert-squad-template/authoring-skill/SKILL.md`.
2. Runtime built-in discovery reads only `packages/opencorvus/src/skill/builtin/**`.
3. General's scheduler grants only explicit `default_skill_refs`; it does not
   grant the artifact-only Skill.
4. The right-sidebar Chat therefore could not search or load the Skill, so Opus
   searched CLI and panel surfaces instead and correctly found no supported
   conversation authoring action.
5. The SDK was valid but unreachable from the intended conversation surface.
6. After projecting the Skill, an arbitrary real user project still failed
   `import "@opencorvus-ai/sdk/expert-squad-authoring"` with
   `Cannot find module`: the SDK is a dependency of the OpenCorvus runtime, not
   of every project the product opens. A Bash-only Skill therefore cannot make
   the formal writer reachable without asking projects to install product
   internals.

### Schema refresh

1. The current DDL insert triggers require every artifact catalog revision to
   exist before its `engine_artifact` or `engine_artifact_version` row.
2. `restoreCurrentSchemaData()` iterates the alphabetically sorted table-shape
   map.
3. Alphabetical order restores `engine_artifact` before
   `engine_artifact_catalog_revision`.
4. The trigger rejects the otherwise valid archived artifact row. The
   transaction rolls back, leaving the deliberately preserved backup beside an
   empty current-schema database.
5. Foreign-key deferral cannot defer this trigger-owned catalog integrity
   contract, so the restore order itself must respect the existing dependency.

## Design

The runtime built-in Skill becomes the canonical authoring guidance. The
portable template generator reads that exact source and copies it into the
artifact, removing the generator's second embedded prose implementation. The
General scheduler explicitly grants `default/skill/expert-squad-authoring`.

A formal `expert_squad_author` conversation tool is the runtime bridge. It
accepts one JSON-serialized `ExpertSquadPackageDefinition`, parses it once,
validates and materializes it with the existing
`@opencorvus-ai/sdk/expert-squad-authoring` implementation in a temporary
source directory, then calls the existing Registry validation and Manager
import owners for an explicit project or user-global scope. The Skill requires
that tool and does not ask an arbitrary project to install the SDK, discover an
internal runtime path, or handwrite a target package. This is a transport over
the sole writer/validator/importer, not a second authoring implementation or a
panel-only action.

Schema refresh gains one explicit restore-dependency contract and a stable
topological ordering: catalog revisions precede artifact/current-version rows,
while unrelated tables retain deterministic lexical order. The existing
triggers remain active and validate restored data. A production-shaped
regression creates valid catalog facts, induces schema drift, and proves the
refresh preserves them.

## Verification plan

1. Run built-in payload, portable template, General projection, Skill mount,
   SDK authoring, and focused storage refresh tests.
2. Regenerate the portable artifact and built-in Skill payload through their
   official generators, then prove a second generation has zero drift.
3. Run OpenCorvus typecheck, historical links, document health, product docs,
   generated-artifact, route/API, and diff checks required by the changed
   surfaces.
4. Restart only the isolated port-7879 dev backend, select
   `hexin/claude-opus-5`, explicitly invoke the runtime authoring Skill, answer
   its Goal-mode question, and create `e2e-conversation-squad` in the anonymous
   test project.
5. Inspect conversation/tool evidence, installed package files, catalog/API
   response, and fresh browser screenshots. Perform a second diff/test review,
   commit only task-owned files, fetch/merge the current legacy remote branch if
   required, and push to `legacy-remote`.

## Verification result

- The isolated port-7879 dev backend projected `expert-squad-authoring` in the
  real Chat `@skill` picker and retained the exact selected model
  `hexin/claude-opus-5`.
- The canonical conversation authoring service used the SDK writer, Registry
  validation, and project Manager import to create
  `e2e/e2e-conversation-squad` with `researcher` (`explore`, `single`) and
  `implementer` (`build`, `disjoint_goals`). The project catalog API returned
  both `general` and the created package. A fresh headed Node Playwright run
  rendered the real Installed Agent Squads panel with `2 available`, the new
  package, and `2 Agents`; the screenshot was visually inspected.
- The exact real Chat request explicitly loaded
  `@skill("expert-squad-authoring")` and remained bound to
  `hexin/claude-opus-5`, but the upstream `hexin` LiteLLM route exhausted its
  retries with HTTP 502 and `unknown provider for model claude-opus-5`; it
  reported no fallback model group. The request reached terminal `Error`
  before any model output or `expert_squad_author` tool call. No substitute
  model or local fallback was used. Therefore the remaining unmet acceptance
  item is the exact-Opus conversation itself, not local Skill projection,
  author-tool availability, SDK authoring, import, catalog discovery, or UI
  rendering.
- Focused authoring, General projection, portable template, built-in Skill,
  tool registry, prompt profile, and production-shaped schema refresh
  regressions passed. OpenCorvus, Overlay, and root typechecks passed. Official
  generators were run twice with identical SHA-256 output and `git diff
  --check` passed.
- Repository-wide route/docs checks remain red because a concurrent uncommitted
  Work/Chat route refactor added `right-sidebar-conversation.ts`,
  `/coding/{chat,work}/**`, and `/global/work` without its tracked OpenAPI and
  server-doc regeneration. The same concurrent work has an untracked July
  record referenced from the monthly index. Those files are outside this
  repair and were preserved instead of being staged or rewritten here.
