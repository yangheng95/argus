# Mission Selected Expert-Squad Prompt Boundary

> Superseded on 2026-07-20 by `2026-07-20-composer-expert-squad-direct-task-activation.md`. The prompt-only repair below documented a hidden Composer → Mission → Task inheritance path that has now been removed; ordinary expert-squad selection creates the exact-profile Task directly.

## Recall

- User request: “为什么使用mirror watch会提示multica的问题？我没有提到multica，也没有安装，我直接选择mirrorwatch的专家组” followed by “修复提示词问题”.
- Acceptance: launching a Mission with the already selected `mirror-watch` profile must lead Mission to create inheriting Tasks without consulting `multica_catalog`, requiring local Multica configuration, scanning manifests to reconstruct the profile, or inventing another identity source.
- Hard constraints: `prompt_profile.active` remains the only active expert-squad source; `PromptProfileResolver` remains the only runtime projection; fix prompt/tool semantics rather than adding a host gate, keyword route, fallback, alias, or second profile field; preserve the explicit Work Ledger Multica-import flow; do not touch the running OpenCorvus process; preserve unrelated working-tree changes.
- Sources read: `AGENTS.md`; `specs/current/architecture/04-extensions.md`; `2026-07-14-mirror-watch-latest-protocol-e2e.md`; `2026-07-15-composer-skill-squad-mentions.md`; `2026-07-15-multica-mission-multi-squad-parallel-import.md`; Overlay composer Mission launch; `POST /mission/wake`; Mission core prompt; panel capability and `create_task` execution; Orchestrator selector prompt and tools; MirrorWatch selector and Orchestrator overlay.
- Full-repository search: Mission launch passes the selected manifest ID as `promptProfile`; the Mission route validates it and writes `configOverlay.prompt_profile.active`; `panel.create_task` resolves the caller's effective config and already uses `params.promptProfile ?? callerConfig.prompt_profile.active`; only the dedicated Multica Import launcher requests `promptProfile: "general"` and tells Mission to call `panel.multica_catalog`; ordinary Mission core text does not explain either inheritance or the Multica-only boundary. Tests covering these call points live in Mission prompt hygiene, panel capability, panel execution, Mission wake, and Multica launcher suites.
- Independent agent feedback: none; the user did not request sub-agent work and repository policy disallows unsolicited delegation.

## Causal Chain

Observable behavior: after the user directly selects MirrorWatch, Mission reports that local Multica catalog configuration is missing and tries to recover the selected profile from a repository manifest.

Direct trigger: Mission sees the optional `panel.create_task.promptProfile` field and the Mission-visible `multica_catalog` action but has no prompt statement that an already selected launcher profile is validated, stored on the Mission session, and inherited by `create_task` when the field is omitted.

Deep cause: the data path is already single-source and correct, but the Mission decision contract fails to distinguish active-profile inheritance from Multica provisioning. The model therefore constructs an unnecessary discovery step and treats a provisioning catalog as a general expert-squad catalog.

Why earlier work did not root-fix it: Orchestrator core separates `expert_squad_selector` from production Skills, and prior Mission work repaired model inheritance, but Mission's own task-dispatch contract never received the analogous expert-squad inheritance rule. Multica's dedicated launcher contract correctly uses the catalog, which made the generic Mission-visible action appear applicable without an explicit negative boundary.

## Implementation

1. Amend Mission core's `panel.create_task` instructions: the Mission launcher-selected `prompt_profile.active` is already validated; ordinary child Tasks inherit it when `promptProfile` is omitted; Mission must not query Multica, scan manifests, or reconstruct namespace/id to validate an existing selection.
2. Define the only exception: set an explicit child `promptProfile` when the operator/launcher request intentionally requires a different exact profile, including the dedicated Multica import flow's explicit `general` Tasks.
3. State that `panel.multica_catalog` is exclusively a Multica-import source and is never expert-squad selection, validation, activation, or fallback.
4. Mirror those semantics in the `create_task.promptProfile` schema description so the current tool surface reinforces the prompt.
5. Add prompt/tool-description regressions and retain existing Mission wake, panel inheritance, and Multica import tests.

## Verification

- Prompt/tool schema: `mission-prompt-work-ledger.test.ts` and `panel-capability.test.ts` passed 9 tests / 63 expectations.
- Mission persistence: `mission/wake-route.test.ts` passed 23 tests / 94 expectations, including selected-profile validation and persistence before wake.
- Task inheritance: `panel-session-config-projection.test.ts` passed 2 tests / 4 expectations and proves omitted `promptProfile` inherits the Mission's effective active profile.
- Dedicated Multica path: the two focused `panel.test.ts` cases passed and prove the exact-project catalog remains callable by a real Mission session while selected import Tasks still use an explicit `general` override.
- Prompt hygiene and request-language suites passed 14 tests / 152 expectations.
- Historical-link and document-health suites passed 82 tests / 1,356 expectations.
- Full OpenCorvus typecheck and legacy remote push remain pending because unrelated user-owned Hexin limit edits currently remove `HexinModelProfile.context/input/output` before their `hexin-discovery.ts` consumers are updated. This task does not overwrite that concurrent work.
