# Composer Expert-Squad Direct Task Activation

> Superseded on 2026-07-21 by `2026-07-21-expert-squad-mission-owned-task-launch.md`. The direct-Task ownership decision below contradicted the confirmed product boundary: selecting an expert squad launches a profile-bound Mission, and only Mission creates and manages child Tasks.

## Recall

- User request: after selecting Mirror Watch directly, OpenCorvus unexpectedly discussed missing Multica configuration and retained `legacy-remote`; the user challenged the hidden Mission inheritance explanation, requested an independent Mission-activation audit, then asked to repair the problem and push the whole repository.
- Acceptance: choosing an expert squad or submitting an exact `@squad` directive creates one Task directly with that exact manifest `id` in `promptProfile`; no generic Mission is created, no host-hidden Mission-to-Task profile inheritance is involved, and no Multica catalog is consulted. The dedicated Work Ledger Multica import remains an explicit `general` Mission workflow. The visible Composer layout remains stable and the created Task becomes the selected conversation.
- Hard constraints: `prompt_profile.active` remains the only active expert-squad field; `PromptProfileResolver` remains the only runtime projection; no gate, keyword router, fallback, alias, hidden message, shadow state, or compatibility branch; preserve unrelated Hexin work and finish it before the requested whole-repository push; do not restart the user's running OpenCorvus/Overlay; use a real browser and screenshot for frontend acceptance.
- Sources read: `AGENTS.md`; `specs/current/architecture/04-extensions.md`; the superseded `2026-07-20-mission-selected-expert-squad-prompt-boundary.md`; `2026-07-15-composer-skill-squad-mentions.md`; `2026-07-15-multica-mission-multi-squad-parallel-import.md`; `ChatComposer.tsx`; Overlay `main.tsx`; direct Task and Mission services; Mission wake route; panel `create_task`; Mission core prompt; focused Overlay and OpenCorvus tests.
- Full-repository search: `ChatComposer` changes the current intent to `"mission"` for every expert-squad option and sends the selected manifest ID only in that mode. Overlay `main.tsx` routes either that mode or an exact `@squad` directive to its sole ordinary `wakeMission` call, while the Work Ledger Multica action owns the other production `wakeMission` call and explicitly passes `general`. The direct `createTask` API already accepts attachments, model, metadata, and `promptProfile`, returns Task/project/directory identity, and is otherwise covered by Task-service tests. Work Ledger Task selection and Mission selection are separate existing paths. Mission wake/service tests must remain for Multica and explicit Mission lifecycle; Composer routing, launcher, mention, session-source, settings, work-ledger, and browser tests that assert expert-squad-to-Mission routing must be replaced with direct-Task assertions. Current architecture and the earlier prompt record describe hidden inheritance and must be corrected.
- Independent agent feedback: `mission_activation_audit` confirmed that Composer currently selects Mission, `/mission/wake` persists the profile on the Mission session, Mission never resolves or sees the exact active expert-squad identity, and `panel.create_task` silently injects the caller profile after the model tool call. Because Mission still sees `multica_catalog`, the model can take the Multica path without being told the active identity. The audit recommends direct Task creation for ordinary expert-squad selection and reserving Mission for explicit coordination workflows.

## Causal Chain

Observable behavior: selecting Mirror Watch can produce a Mission message about missing Multica configuration even though the user did not request Multica and did not install it.

Direct trigger: the Composer maps an expert-squad selection to `composerMode="mission"` and calls `/mission/wake`. The Mission model sees a generic coordination prompt and a visible Multica catalog action, but not the exact active expert-squad identity that the route stored in session configuration.

Deep cause: one user intent is split across two runtime identities. The selected expert squad belongs to the child Task scheduler, while a generic Mission is inserted as an unnecessary decision-making intermediary. The host then silently supplies `params.promptProfile ?? callerConfig.prompt_profile.active` during Task creation. This makes the effective activation correct only after the model has already made an uninformed routing decision.

Why the previous prompt repair was insufficient: it narrated the hidden inheritance rule to Mission but preserved the accidental intermediary and the invisible host mutation. It could discourage one observed mistake, but it could not make the selected expert squad the actor that receives the user's request.

## Call-Point Decisions

| Surface | Decision |
| --- | --- |
| `ChatComposer` intent type, selection, and submit projection | Rename the user intent from `mission` to `expert-squad`; submit the exact selected manifest ID only for that intent. |
| Overlay `main.tsx` expert-squad/mention submit path | Replace `wakeMission` with direct `createTask({ promptProfile })`, then select the returned Task using its authoritative directory. |
| Overlay Mission service and `openMissionSession` | Retain for real Mission rows and the dedicated Multica import workflow; it is no longer the ordinary expert-squad launcher. |
| Work Ledger Multica import | Retain explicit `wakeMission(..., promptProfile: "general")`; this is the sole Composer-adjacent Multica coordination contract. |
| Mission core and panel tool descriptions | Remove the ordinary Composer-selected inheritance story. Keep child-profile omission as generic caller-config inheritance and keep Multica instructions scoped to explicit Multica workflows. |
| Current expert-squad architecture | Replace Composer-to-Mission inheritance with direct Task activation and document Mission as an explicit coordinator only. |
| Source and browser tests | Replace assertions for `/mission/wake` and Mission selection with `/task`, exact `promptProfile`, and selected Task evidence; retain dedicated Mission/Multica coverage. |

## Verification Plan

1. Focused Overlay source and service tests for Composer intent, exact `@squad`, direct Task request body, Task selection, Mission sessions, and Multica import.
2. Focused OpenCorvus prompt/panel/profile tests proving no inaccurate Composer inheritance contract remains and explicit Mission child inheritance still uses one active field.
3. Overlay and OpenCorvus typechecks plus spec link/document-health suites.
4. A Node-driven real browser run against an isolated Overlay fixture: select Mirror Watch, submit once, observe a Task POST containing the exact profile and no Mission wake, verify the resulting Task is selected, capture and inspect the desktop screenshot.
5. Independent diff review, fetch/merge the latest `legacy-remote` branch, run hooks, commit every completed workspace change with the required `dsw-33987` prefix, and push the current main delivery branch.

## Implementation and Verification

- Composer intent is now `chat | expert-squad`; selecting a catalog squad no longer creates an internal `mission` intent. An exact `@squad` directive and an empty-launcher expert-squad selection both call the existing direct Task API with the exact manifest ID in top-level `promptProfile`, `queue=false`, the selected model, attachments, and ordinary request metadata.
- The returned Task/project/directory identity is validated by the existing Task service and the Task is selected through the canonical `selectTask` path. The selected Task catalog then projects the same expert squad visibly in the Composer. The dedicated Work Ledger Multica action remains the explicit `general` `wakeMission` caller.
- Generic Mission prompt/tool text no longer claims that a Composer-launched Mission knows a selected profile. It documents only ordinary caller-session inheritance for an omitted child override, while Multica remains an explicit Mission-only catalog workflow.
- The current architecture, Composer mode names, launcher translation keys, mention error copy, and browser fixtures no longer describe ordinary expert-squad selection as Mission activation. The superseded prompt-only record is marked accordingly.
- Focused Overlay source and i18n suites pass 176 tests / 1,083 expectations; focused Mission prompt/panel suites pass 9 tests / 63 expectations.
- Node-launched real browser suites pass 2/2. Both record zero `/mission/wake` calls, assert the exact direct `/task` body and project directory, hydrate/select the returned Task, and retain the active expert squad. Original-resolution screenshots were inspected at `packages/overlay/.scratch/composer-mentions/expert-squad-direct-task.png` and `packages/overlay/.scratch/project-directory-watch-task-ownership.png`; both show the Task title and matching expert-squad selector with no Mission surface or layout regression.
- Codex independent review found no P0/P1 route defect and confirmed that ordinary selection and `@squad` both create exact-profile Tasks while Multica remains an explicit `general` Mission. It identified one P2 evidence gap: the browser test uses a fixture backend, while the existing real route test stopped at the stored root-session overlay. The route test now also proves that no Mission session is created and feeds the effective Task configuration through the real `PromptProfileResolver`, asserting that both scheduler capability and skill projection resolve to the same exact expert-squad ID. Its 20 route tests pass with 94 expectations. The review's P3 naming observation is intentionally not expanded into another state source: `expert-squad` remains a Composer intent, while selected Task/Mission identity continues to come from the existing canonical active IDs.
- The official root generator synchronized OpenAPI, the JavaScript SDK, and API docs. `api:routes-check`, `docs:check`, 87 documentation-health tests / 1,409 expectations, and the repository typecheck all pass. A final Node browser rerun passed 2/2 and the regenerated light/dark screenshots were inspected again.
