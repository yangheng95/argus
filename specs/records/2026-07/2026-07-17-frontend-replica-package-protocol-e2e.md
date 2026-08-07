# Frontend Replica Package Protocol and Real E2E Convergence

Date: 2026-07-17

Status: investigation complete; implementation and real end-to-end acceptance pending.

## Recall

### User Request

Integrate Frontend replica through the latest OpenCorvus expert-squad/project-package protocol, preserve one source of truth with no fallback or compatibility path, collaborate in parallel without conflicting writes, and complete real end-to-end execution, observable message flow, artifact review, and 1:1 parity between the source algorithm's output and the external expert-squad execution. The primary Agent should publish bounded work, inspect scheduler-visible failures on a timer, investigate the full impact before repairs, stop on substantive parallel conflicts, and ignore occasional network failures unless reproducible.

### Acceptance Criteria

- `prompt_profile.active` remains the only active expert-squad identity and `PromptProfileResolver` remains the only runtime projection surface.
- The namespaced Frontend replica project package is generated into the bundled payload and installed through the normal Registry/Manager path; there is no built-in profile facade, alias, fallback, or second loader.
- Ordinary source-replica scheduling actually consumes the host source-project generator and produces provenance-backed deliverables before implementation, visual review, and integrity review.
- Projected workers receive only the Browser Model Context Protocol tools their package contracts require; inactive and sibling packages receive none.
- A real chain covers package install/discovery, active selection, scheduler dispatch, streamed worker session/tool messages, task-scoped preview evidence, Node/Playwright screenshots, terminal/yield/error presentation, and artifact review. Mocked contracts remain regression tests and are not called real E2E.
- Reference and target screenshots are viewed and corrected in a desktop-only loop. Network flakiness is recorded as environmental evidence, not repaired with fallback logic.
- Every code change has focused regression coverage, documentation health passes, and a second independent review.

### Hard Constraints

- No fallback, compatibility alias, ambient MCP exposure, workflow state machine, gate, hidden/synthetic message, or duplicate active/profile/package source.
- `capability_projection.virtual_workflows` stays immutable scheduler guidance; the Orchestrator still makes natural decisions through real tool calls.
- Non-`general` bundled squads remain clear-text project packages released from the generated payload. Generated `payload.ts` is never hand-edited.
- Frontend acceptance is desktop-only and must use a real page, task-scoped preview/evidence, Node-launched Playwright, headed visual evidence, and human screenshot inspection.
- Existing untracked macOS build artifacts are user-owned and must not be changed or committed. Running OpenCorvus/Overlay processes must not be restarted, refreshed, or killed without explicit permission.
- Work stays in the current main worktree; commits use the `dsw-33987` prefix and push to `myhexin` without bypassing hooks.

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-06-self-contained-expert-squad-runtime.md`
- `specs/records/2026-07/2026-07-08-expert-squad-project-open-payload-release.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/{expert-squad.jsonc,README.md,selector.md,agents/**/system.md}`
- Registry, Manager, Resolver, prompt-profile, scheduler/dispatch, browser-preview, web-clone, message-bridge, Overlay card-tree/tree-writer, and their focused tests.

### Whole-Repository Search Evidence

The investigation used repository-wide searches for `frontend[-_ ]?replica`, `expert[-_ ]?squad`, `capability_projection`, `virtual_workflows`, `PromptProfileResolver`, payload release/install routes, `web_clone_generate_source_project`, Browser MCP refs, `artifact_missing`, preview evidence, terminal/yield, and source-project provenance. Confirmed call sites:

| Surface | Current authority | Required disposition |
| --- | --- | --- |
| Active identity | `src/agent/prompt-profile.ts`; `src/orchestrator/tools.ts` | Preserve; no second active field. |
| Package discovery/install | `src/expert-squad/{locations,registry,manager}.ts`; `src/server/routes/expert-squad.ts` | Preserve strict namespaced Registry/Manager path. |
| Runtime projection | `src/expert-squad/prompt-profile-resolver.ts`; `src/orchestrator/dispatch-agent-tool.ts` | Preserve exact agent IDs; add only manifest-owned grants. |
| Bundled source/payload | `.opencorvus/expert-squads/builtin/frontend-replica/**`; generated `src/expert-squad/payload.ts` | Edit clear-text package, regenerate payload, verify byte parity. |
| Source algorithm | `src/web-clone/{context,source-skeleton,source-project-generator}.ts`; `src/orchestrator/webpage-evidence.ts` | Make ordinary package topology consume it and make provenance truthful. |
| Browser tools | `src/mcp/browser/tools.ts`; Resolver `projectWorkerTools` | Declare exact package grants; never enable ambient MCP. |
| Terminal protocol | `src/session/status.ts`; Overlay `store/card-tree.ts`, `services/tree-writer.ts`, `store/conversation-agents.ts` | Project the backend terminal reason once and render `artifact_missing` consistently as error. |
| E2E | `test/e2e/web-clone-source-project-e2e.test.ts`; browser-preview verification; Overlay browser fixtures | Replace the bypassed proof with a real package/scheduler/worker/preview/message-flow acceptance chain. |

### Independent Agent Feedback

- Protocol audit: Registry, Manager, Resolver, routes, Overlay settings, and generated payload already follow the latest single-source package protocol. The reproducible capability break is that implementer and visual reviewer prompts require Browser MCP operations while their manifest MCP refs are empty and ambient MCP is deliberately disabled. Focused protocol validation passed 165 tests with one intentional skip.
- Parity audit: the ordinary `source-replica` guidance omits `frontend-replica-interface-modeler`, the only projected worker that owns `web_clone_generate_source_project`; the optional `interface-modeling` graph explicitly says it is not the ordinary route. Current E2E directly resolves the old interface-modeler path, is headless/environment-gated, and does not prove ordinary dispatch parity. The generator's `generatedFrom` claims a style-profile input it does not read, fixed collection caps lack large-page regression coverage, and a generic host research prompt duplicates package-owned desktop/frontend policy.
- E2E/observability audit: no test joins install/select/resolver/real streamed dispatch/preview/screenshot/Overlay terminal flow. Backend terminal reason `artifact_missing` is legal, but Overlay card-tree/tree-writer rejects it while conversation-agents maps it to error, creating an observable protocol split. A focused suite exposed a stale Frontend replica selector-string assertion and an unrelated mirror-watch forbidden-word failure. Startup failure before child-session persistence remains unknown and must be verified rather than assumed broken.
- All agents were read-only, spawned no children, and observed no tracked concurrent edits. The only worktree changes were pre-existing untracked Overlay macOS artifacts.

## Diagnosis

The package is structurally installed but behaviorally incomplete. The normal guidance graph cannot prove use of the source generator, the workers responsible for implementation and visual comparison cannot receive the Browser MCP tools their own prompts require, and Overlay cannot render one backend terminal reason. Existing tests validate isolated contracts or an obsolete direct interface-modeler path, so they cannot establish output parity or observable delivery.

This is not a reason to copy host algorithms into the package. The protocol deliberately allows a package to project host-owned default tools. The correct single-source repair is to make the package explicitly project and schedule the existing host algorithm, then prove that projection through real execution and artifact provenance.

## Implementation Plan

1. Package authority: add the interface modeler to ordinary source-replica guidance and selector ownership, declare the exact Browser MCP grants required by implementer/visual reviewer, bump the package version, regenerate the payload, and add active/inactive/sibling isolation tests.
2. Terminal authority: make Overlay card terminal reasons derive from the backend protocol type and render `artifact_missing` as the existing error semantic; add tree-writer and browser-visible regression coverage without compatibility branches.
3. Algorithm truth: correct source-project provenance to the actual read set, add over-cap parity tests or remove unjustified truncation at the source model boundary, and move duplicated Frontend replica domain policy out of generic host research prompts into package-owned prompts.
4. Real E2E: repair the local dependency/runtime prerequisite, install the generated package into an isolated real project, activate it, run a stable local HTTP reference through the real streamed scheduler/worker path, capture task-scoped preview evidence with Node/Playwright, and assert visible tool results, yields, session terminal states, artifacts, source-project provenance, keyboard/focus/state diagnostics, and visual/integrity review.
5. Visual and independent acceptance: inspect reference/target desktop screenshots, correct mismatches, rerun focused and document/API/type checks, and request independent read-only code/evidence review before the final commit and git-cc push.

## Conflict Stop Rule

Before every implementation dispatch and commit, compare `git status`, `git diff`, branch ancestry, and the scoped files. If another Agent has tracked changes in the same authority surface or presents a conflicting design, stop all local writes, preserve exact diff/commit evidence, and report the conflict instead of merging assumptions or creating a second implementation.

## Validation Commands

```bash
bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts
bun test packages/opencorvus/test/expert-squad/repository-dynamic-agent-packages.test.ts
bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts
bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts
bun test packages/opencorvus/test/agent/prompt-profile.test.ts
bun test packages/opencorvus/test/browser-preview/verification.test.ts
bun test packages/overlay/test/tree-writer-hierarchy.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
bun run --cwd packages/opencorvus typecheck
bun run api:routes-check
bun run docs:check
git diff --check
```

The final E2E command and screenshot paths will be recorded after the real runner is implemented; no mocked or fixture-only run will be labeled complete.
