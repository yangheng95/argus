# Chat-to-Mission Surface and Attachment Forwarding

Date: 2026-07-16
Status: Implemented
Owner: Codex

## Recall

### User request

The user reported that a right-sidebar Chat routed into Mission, but the Mission could not dispatch its expert-squad Task because `panel.create_task` failed with `panel tool requires ctx.extra.surface to authorize surface-specific actions`. The user then reported that the same Chat-to-Mission route lost the uploaded attachment, so the Mission could not find the reference HTML.

### Acceptance criteria

- A Mission started by right-sidebar Chat `panel.wake_mission` receives the explicit `panel` surface used by Mission control-plane tools.
- The exact file parts on the caller user message are forwarded into the Mission wake through `SessionWake.parts`.
- Canonical `/attachment/<projectID>/<name>` references remain the single byte source. Forwarding re-materializes those bytes through `AttachmentStore`; it does not create a second store, scan the project, or trust model-supplied filenames as file locations.
- The caller message must be a real user message in the caller session, and every forwarded canonical attachment must belong to that same project namespace.
- The Mission wake persists its ordinary visible user message with regenerated host file context and canonical file part through the existing `SessionPrompt.createUserMessage` path.
- Focused regression coverage proves both `surface: "panel"` and attachment forwarding at the Chat-to-Mission boundary; existing `SessionWake` coverage continues to prove durable attachment persistence.
- No running OpenCorvus or Overlay process is restarted, refreshed, or stopped during the repair.

### Hard constraints

- No fallback, compatibility branch, hidden/synthetic message, host keyword router, state machine, or second active expert-squad source.
- `prompt_profile.active` remains the sole selected expert-squad source; this repair changes only the existing Chat-to-Mission wake transport.
- `PanelTool.resolvePanelSurface` remains fail-fast. The fix supplies the missing dispatcher input rather than weakening authorization in the callee.
- Preserve unrelated dirty worktree changes and stage only this repair.
- Code changes require regression tests, and spec indexes plus documentation-health checks must stay synchronized.
- The current branch uses the required `dsw-33987` commit prefix and pushes only to the git-cc `myhexin` remote.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-chat-default-mission-forwarding-receipt.md`
- `specs/records/2026-07/2026-07-09-mission-composer-attachments.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/prompt/{schema,parts}.ts`
- `packages/opencorvus/src/session/message-store.ts`
- `packages/opencorvus/src/storage/attachment-store.ts`
- `packages/opencorvus/src/chat/session.ts`
- `packages/opencorvus/src/server/routes/{session,mission}.ts`
- `packages/overlay/src/services/chat.ts`
- `packages/opencorvus/test/tool/panel.test.ts`
- `packages/opencorvus/test/session/wake.test.ts`
- `packages/opencorvus/test/mission/wake-route.test.ts`

### Whole-repository grep and runtime evidence

- `rg -n "panel tool requires|ctx\\.extra\\.surface|SessionWake\\.wake|wake_mission|attachments|AttachmentStore" packages/opencorvus/src packages/opencorvus/test packages/overlay/src specs` found one fail-fast authorization owner in `tool/panel.ts`, one generic tool-context projection from the persisted user message `extra` in `session/loop.ts`, and five production `SessionWake.wake` callers.
- Direct `/mission/wake` already passes `surface: "panel"` and converts request attachments into file parts. Scheduler cron/event and Task child-result wakes have their own explicit surface contracts or remain surface-less by design. Only right-sidebar `panel.wake_mission` omitted both `surface` and `parts`.
- Right-sidebar `/session/:id/prompt_async` is overlaid by `applyRightSidebarChatPromptOverlay`, which persists `extra.surface="right-sidebar"`; therefore the initial Chat panel call is authorized correctly.
- `panel.wake_mission` resolves the real caller user message through the assistant tool-call message's `parentID`, but currently stores only that ID for the receipt and never reads its parts.
- `SessionPrompt.createUserMessage` turns uploaded data URLs into canonical `.opencorvus` attachment references and expands text MIME files into visible host file context. `AttachmentStore.dataUrlFromReference` is the existing canonical-reference replay path.
- Read-only inspection of live session `ses_0951ff375ffeWcTahEu3DhKbXK` at the user-provided project directory proved the observable chain:
  - the Mission's first user message contains `extra.wake_reason` only and a single text part;
  - its `panel.create_task` tool part failed at `resolvePanelSurface` with the reported error;
  - Mission metadata identifies caller session `ses_095203accffeKaQp9FD6oN45ep` and caller user message `msg_f6adfc56c001W2Rozb4GDzqc1Y`;
  - that caller message contains `extra.surface="right-sidebar"`, the complete HTML host context, and canonical file part `/attachment/db172da35b7aa7a37fc531f9d9807e6bad8237d6/4d8a6aeb9ff1ac1d26463b6df618c1bbbb19b3654cbc72d2bcb36cabd23e795a.html`.
- This proves the direct trigger is the `panel.wake_mission` construction, not an unavailable expert-squad capability, attachment deletion, or the names/titles of Mission entities.

### Independent agent feedback

No sub-agent was launched. The active collaboration policy forbids spawning sub-agents unless the user explicitly requests them; this request did not.

## Diagnosis

The failure has one shared boundary and two omissions. Right-sidebar Chat correctly receives `surface="right-sidebar"` and persists the uploaded file. When Chat calls `panel.wake_mission`, the implementation creates the Mission and calls `SessionWake.wake` with only `sessionID`, `prompt`, `author`, `agent`, and `reason`. `SessionWake` therefore persists a Mission user message without `extra.surface` and without file parts. `SessionLoop` can only project what that persisted user message contains, so Mission's later `panel.create_task` receives no surface and fails authorization. The Mission also has no file part from which the host file context can be reconstructed.

The Mission's statement that the surface was temporarily unavailable was a misdiagnosis of the final error. The error is deterministic dispatcher input loss. Weakening `resolvePanelSurface` or deriving authorization from `agent="mission"` would hide that loss and violate the explicit-surface contract.

## Call-point disposition

| Call point                                    | Current behavior                                                                           | Disposition                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `server/routes/mission.ts` operator wake      | Passes `surface: "panel"` and request attachment parts                                     | Keep unchanged.                                                                                        |
| `tool/panel.ts` right-sidebar `wake_mission`  | Omits surface and caller file parts                                                        | Replace the incomplete construction with explicit panel surface plus caller-message attachment replay. |
| `task-api/index.ts` Mission child-result wake | Uses its existing child-result contract                                                    | Keep unchanged.                                                                                        |
| `scheduler/cron-service.ts` delayed wake      | Carries its typed persisted surface when supplied                                          | Keep unchanged.                                                                                        |
| `scheduler/event-service.ts` event wake       | Uses its event-specific wake contract                                                      | Keep unchanged.                                                                                        |
| `session/wake.ts`                             | Already accepts typed `surface` and `parts` and persists through the canonical prompt path | Keep unchanged.                                                                                        |
| `tool/panel.ts::resolvePanelSurface`          | Rejects missing/invalid surface                                                            | Keep unchanged; it is the correct data-integrity boundary.                                             |

## Implementation plan

1. In `tool/panel.ts`, load the already-authoritative caller user message returned by the assistant tool-call `parentID`.
2. Extract only real `Message.FilePart` values. Require each stored URL to be a canonical attachment reference owned by the caller session's project, then use `AttachmentStore.dataUrlFromReference` to build fresh `SessionWake` file-part inputs without reusing persisted part IDs.
3. Call `SessionWake.wake` with `surface: "panel"` and the replayed `parts`; keep the existing request, caller receipt metadata, prompt profile, Mission ID, and title behavior unchanged.
4. Extend the existing PanelTool production-boundary test so its caller user message owns a canonical text attachment and assert the wake receives both `surface: "panel"` and the exact data-URL file part.
5. Run focused PanelTool and SessionWake attachment tests, typecheck, historical docs links/document health, scoped diff checks, and a second source review. Do not restart the live process; the already-running binary will not be claimed as fixed until a later explicit update/restart.

## Validation plan

- `bun test packages/opencorvus/test/tool/panel.test.ts -t "right sidebar assistant wake_mission" --timeout 60000`
- `bun test packages/opencorvus/test/session/wake.test.ts -t "wake archives attached data URL files" --timeout 60000`
- `bun run typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `git diff --check -- packages/opencorvus/src/tool/panel.ts packages/opencorvus/test/tool/panel.test.ts specs/records/2026-07/2026-07-16-chat-mission-surface-attachment-forwarding.md specs/records/2026-07/README.md specs/README.md`

## Validation record

- Live read-only evidence bound the failure to the exact Chat caller, caller user message, Mission session, Mission user message, and failed `panel.create_task` tool part before implementation.
- `bun test packages/opencorvus/test/tool/panel.test.ts -t "wake_mission" --timeout 60000`: 3 passed. The positive case proves `surface: "panel"`, exact canonical attachment-byte replay, Mission caller provenance, and no parallel Task. Negative cases prove noncanonical and cross-project attachment references fail before Mission creation. The existing non-right-sidebar authorization case also passes.
- `bun test packages/opencorvus/test/session/wake.test.ts -t "wake archives attached data URL files" --timeout 60000`: 1 passed with 10 assertions, proving the replayed part is durably materialized under `.opencorvus`, retains its filename, regenerates text host context, and remains readable from the canonical reference.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bunx prettier --check packages/opencorvus/src/tool/panel.ts packages/opencorvus/test/tool/panel.test.ts`: passed. The record was formatted with the repository Prettier configuration.
- `git diff --check` for the implementation, tests, record, and monthly index: passed.
- The full `packages/opencorvus/test/tool/panel.test.ts` run reached 12 passing tests and two pre-existing queue-fixture failures: `delete_session deletes every linked task` seeds an assistant session as an active Task root and now fails `invalid_root_lineage`; `right sidebar assistant create_task writes server-derived provenance` starts queue advancement without a configured task-loop runner. Neither failure executes the Chat-to-Mission path.
- Historical docs links passed 21/21. The combined document-health rerun passed 73 checks and failed only `monthly record README links target tracked record files` because three concurrently edited July records are linked but remain untracked in the shared worktree: cross-platform window controls, Overlay five-surface polish, and Mission attachment/composer intent preservation. This repair's record is tracked and indexed.
- No process or window was restarted. The live session supplied evidence for the old binary only; runtime behavior after this source repair requires the user's normal later update/restart and a fresh Chat-to-Mission request, so this record does not claim a post-restart live end-to-end result.
