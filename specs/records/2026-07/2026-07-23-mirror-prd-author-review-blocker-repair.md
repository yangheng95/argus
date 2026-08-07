# Mirror PRD Author and Reviewer Blocker Repair

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | Explain why an apparent old-session condition became a blocker, repair the failed Mirror PRD conversation completely, generalize the investigation to sibling agents, re-check after the session failed, and obtain an independent Agent review. |
| Failed execution evidence | Task `tsk_f8c9f46ac001MkNyix3Bjt434s` reached the Mirror PRD author and reviewer path. `mirror-prd-author` ran through the Requirements adapter, registered requirements and finalized a new active spec snapshot, but did not create the assigned `.mirror/prd/home-page.md`. The following Integrity dispatch stopped before creating a reviewer session with `The active spec snapshot has no goal contracts to review.` |
| Causal boundary | A terminal or old Session is an observed lifecycle state, not causal proof. The direct trigger was an empty Goal selection after the Integrity runner filtered architect-owned Goals by the newer Requirements-owned active snapshot. The deeper causes were a wrong Author runtime projection and task-active-snapshot lookup where the dispatch already carried an exact Goal scope. A one-Goal architect graph legitimately has no cross-Goal contracts; contract count is not a valid proxy for Goal existence. |
| Predecessor evidence | Accepted Mirror Watch artifacts existed in an earlier Prism commit, while the later task started after those paths were already absent. `EngineGit.prepare` commits the dirty startup tree through `git add -A`, so it persisted that pre-existing absence but is not evidence that EngineGit deleted the files. No observed tool/session event identifies the original deletion owner. The repair must therefore make missing predecessor evidence a visible coordination blocker without attributing an unproved deletion or rewriting Git checkpoint semantics. |
| Browser evidence | The browser MCP captures page diagnostics and then `assertNoBrowserDiagnostics` converts third-party console/network findings into failures for navigation, screenshots, observe, and waits. This is a host gate: the requested screenshot bytes may exist while unrelated page diagnostics prevent evidence delivery. Diagnostics already have a dedicated readable surface and must remain evidence rather than action success criteria. |
| Package-tool evidence | Mirror PRD labels `visual-research` optional, but its three manifest configuration fields are required and the tool makes a non-streaming external LLM call. Three research agents project it although browser/extraction is already the package evidence source. This is a conflicting second source and violates the repository's streaming-only LLM boundary. |
| Hard constraints | No fallback, host workflow gate, state machine, keyword routing, hidden/synthetic messages, compatibility path, process restart, new worktree, or edit to the active Prism task. Preserve unrelated dirty files. Regenerate bundled Expert Squad payload from source. Every code/config change needs a regression. Commit subjects start with `dsw-33987` and delivery is pushed to `myhexin/v0.0.16beta`. |
| Read records | `2026-07-22-mirror-prism-full-workflow-distillation.md`, `2026-07-22-mission-squad-stage-task-orchestration.md`, `2026-07-23-mirror-prd-initial-architect-dispatch-repair.md`, and the current architecture principles governing projected adapters, binding workflows, evidence handoff, and prompt-over-host repair. |
| Independent review | An independent read-only Agent is auditing the diagnosis, all sibling projections/call sites, the proposed changes, and final diff. Its findings will be recorded before completion. |

## Root-cause chain

1. The workflow assigned `mirror-prd-author` document ownership, but its manifest projected `base_role: requirements`.
2. The Requirements adapter only exposes structured requirement registration and `submit_requirements`; it does not give that projected role the delegated document-writing terminal contract.
3. The author therefore produced a valid Requirements result instead of the required PRD file. Requirements persistence superseded the architect snapshot and created a newer task-active spec.
4. The Goal remained bound to the architect snapshot. The goal-scoped Integrity dispatch already carried the exact Goal identity, but `createIntegrityReviewRunner` ignored `workScope`, selected the task-active spec, and filtered every Goal out.
5. Its text called the empty result “no goal contracts,” encouraging structural Architect re-entry even though a single-Goal graph requires no cross-Goal contract and the missing PRD was the actual defect.
6. Structural re-entry created another valid single-Goal snapshot but could not manufacture the missing document. Treating the final failed/old Session state as the cause would therefore repeat the same failure.

## Exhaustive call-point disposition

| Surface | Disposition |
| --- | --- |
| `expert-squads/mirror/mirror-prd/expert-squad.jsonc` Author projection | Replace the Author's Requirements base role with `delegated-worker`; keep the stage requirements analyst as the only Mirror PRD Requirements adapter. Bump package version and regenerate the payload. |
| `agents/mirror-prd-author/system.md` | State exact artifact ownership, require rereading the final bytes, and use the delegated-worker terminal result. Missing accepted predecessor artifacts must be returned through the existing coordination decision tool instead of fabricating a PRD. |
| Mirror PRD sibling roles | Preserve stage requirements/architect/research/asset/reviewer roles. Audit assertions prove only the actual page author uses the delegated document-writing adapter. |
| Standalone Mirror PRD workflows | The independent review proved their Task-scoped Integrity reviewer could never run without an active spec and bound Goals. Keep direct URL/brief support, but make both direct graphs execute the same real Task-scoped Requirements → Architect lineage before page-disjoint Goal-scoped evidence, authoring, and review. Do not retain a second Task-artifact reviewer. |
| Mirror Design and Mirror Code sibling workflows | Full-package grep found the same fresh-Task defect in both direct workflows: their Task-scoped final reviewers had no Requirements snapshot or Goals. It also found the inverse stage defect: final cross-page/repository reviewers were Goal-scoped and only appeared to see every Goal because the old Integrity runner ignored `workScope`. Give both direct workflows the canonical Task Requirements → Architect lineage and Goal-scoped producers, then run the final cross-page/repository reviewer once at Task scope after every Goal reviewer. |
| Mirror PRD `visual-research` package tool and configuration | Delete the non-streaming duplicate provider tool, its required configuration, all three projections, and tests that institutionalized it. Browser and webpage extraction remain the single evidence path. |
| `createIntegrityReviewRunner` | Consume the projected execution `workScope`. For Goal scope, resolve the exact Goal first and then its persisted `spec_snapshot_id`; review only that Goal. For Task scope, continue to use the active spec and all Goals bound to it. Resolve a spec by ID through the existing store function. |
| Integrity blocked output | Name the actual missing entity: missing scoped Goal, missing Goal snapshot binding, missing persisted snapshot, or no Goals bound to a task-active snapshot. Never call an empty Goal list “no contracts.” |
| `createIntegrityReviewStage` | Preserve its evidence collection and streaming reviewer Session. It receives the selected snapshot and selected Goal rows from the runner unchanged. |
| Requirements/Architect snapshot writers | Preserve their new-snapshot and supersede semantics. Correct projection prevents the Author from accidentally invoking Requirements; Goal-scoped consumers no longer substitute a newer task epoch for their exact Goal epoch. |
| Browser MCP action tools | Remove `assertNoBrowserDiagnostics` from successful browser actions. Keep diagnostics collection/query intact. Browser transport/capture/selector/load failures still fail their own actions. |
| `EngineGit.prepare` | No code change. Current evidence proves it checkpointed an already dirty tree, not that it originated artifact deletion. Changing checkpoint ancestry from this incident would be an unsupported causal leap. |
| Mirror PRD stage input prompt | Require the existing coordination decision terminal path when accepted predecessor artifacts named by the stage contract are absent. This is visible model-owned escalation, not a host gate. |
| Generated payload and package tests | Regenerate from tracked source and assert role, tool/config removal, workflow topology, prompt ownership, and payload parity. |
| Integrity tests | Add task-scope and Goal-scope cases, including a newer active Requirements snapshot superseding the Goal's architect snapshot. Assert the reviewer still receives the exact Goal snapshot and never requests structural re-entry from zero cross-Goal contracts. |
| Browser tests | Replace source-string gate assertions with runtime/source assertions that diagnostics remain readable and do not block screenshot/observe/action completion. |

## Acceptance

1. A real projected `mirror-prd-author` resolves as `delegated-worker`, owns the assigned PRD path, and cannot create a Requirements snapshot through its adapter.
2. A Goal-scoped Integrity review selects the exact Goal and its spec snapshot even when another snapshot is task-active; the reviewer Session receives one Goal and the correct requirements/evidence epoch.
3. Task-scoped Integrity continues to review all Goals attached to the current active snapshot and emits precise missing-data errors.
4. A one-Goal architect graph with zero cross-Goal contracts is reviewable.
5. Browser console/network diagnostics remain queryable evidence but do not turn a successful screenshot, observation, navigation, or wait into a failure.
6. Mirror PRD contains no non-streaming external visual-research LLM tool, required provider configuration, projection, generated payload entry, or stale test expectation.
7. Missing canonical predecessor artifacts cause a visible coordination decision request before downstream research/authoring rather than a false PASS or fabricated artifact.
8. Direct non-AInvest and AInvest workflows both create canonical Requirements and Architect lineage before every Goal-scoped producer and reviewer; no fresh standalone review can require a nonexistent task-active Goal graph.
9. Focused unit, projected package, message-flow, generated payload, document-health, typecheck, API route, and docs checks pass.
10. Independent read-only review finds no unresolved correctness issue; any finding is incorporated or explicitly disproved with evidence.
11. Mirror Design and Mirror Code direct workflows cannot reach their final reviewer without a persisted Task snapshot and bound Goals; their direct and Mission final reviewers run at Task scope and receive all Goals rather than one arbitrarily selected Goal.

## Verification commands

- `bun test packages/opencorvus/test/orchestrator/domain-tool-modules.test.ts packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test packages/opencorvus/test/expert-squad/mirror-squads-package.test.ts packages/opencorvus/test/expert-squad/repository-dynamic-agent-packages.test.ts packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/mcp/browser-stdio.test.ts packages/opencorvus/test/mcp/browser-tools-resource.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun run typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

## Verification ledger

- `mirror-squads-package`, `repository-dynamic-agent-packages`: 15 passed; validates all three Mirror package projections, direct/stage workflow scope, prompt ownership, and dynamic resolver behavior.
- `payload-generation`, `virtual-workflow-protocol`, `expert-squad-routes`: passed; validates generated payload parity, canonical planning lineage, runtime package loading, and configuration redaction through real route cases.
- `domain-tool-modules`: 9 passed; validates Goal snapshot ownership, Task snapshot selection, precise empty binding output, and Goal-specific singleflight identity.
- `tools` real dispatch case: 1 passed; starts an actual goal-scoped Integrity reviewer Session after task snapshot supersession and proves the exact Goal snapshot reaches the reviewer.
- Browser diagnostic runtime case: 1 passed; a page console error and failed network request remain readable while navigation, observation, and screenshot succeed. Browser source contract suite: 8 passed.
- Historical-document and document-health suites: 82 passed.
- `bun run typecheck`, `bun run api:routes-check`, and `bun run docs:check`: passed.
- Independent review round one rejected the first patch because browser listeners still converted `requestfailed`/`pageerror` into action failure and the runtime test read the wrong structured-result level. Both findings were corrected and re-tested.
- Independent review round two rejected stale provider text and fresh direct PRD workflows that lacked planning lineage. Both direct PRD workflows were rebuilt around Requirements → Architect → Goal-scoped production/review and the payload was regenerated.
- Independent review round three found two remaining direct/Mission wording contradictions and this still-pending ledger. The prompts/descriptions and ledger were corrected. The same scope audit was then applied to Mirror Design and Mirror Code, where direct final review lacked Goals and stage final review incorrectly depended on the old runner ignoring Goal scope; both packages now use Task planning, Goal production, and one Task-scoped aggregate review.
- Independent review round four found that the Design and Code Requirements prompts/workflows supported direct requests but their model-visible manifest catalog descriptions remained Mission-only. Both descriptions were corrected and one cross-package assertion now prevents any of the three Requirements projections from drifting back to Mission-only wording.
- Final independent acceptance: `ACCEPT`; the reviewer independently reran the Mirror package, payload, and Integrity suites (24 passed, 0 failed), confirmed generated-payload parity and staged-diff hygiene, and found no remaining correctness blocker.
