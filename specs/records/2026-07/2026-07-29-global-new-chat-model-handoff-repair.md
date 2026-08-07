# Global New Chat Model Handoff Repair

## Recall

### User requirement

- The user reported that sending the first message from New Chat returns
  `No model configured for agent "chat"` even though a model was selected.
- The user confirmed that the missing New Chat model handoff is the cause.

### Acceptance criteria

- A model selected in the directory-free New Chat Composer is sent with the
  first `POST /global/chat` or `POST /global/work` request.
- The atomically created root Conversation Session persists that exact model in
  its canonical session config overlay before the first prompt is submitted.
- The first and every later `prompt_async` request resolve the persisted model
  through `EffectiveConfig`; the client does not need to resend it.
- Omitting a launcher model preserves inheritance from global or project
  configuration.
- Invalid or unavailable explicit model references fail without leaving the
  temporary Project or Session behind.
- Focused non-UI transport and server contract tests pass. The real
  directory-free page is interacted with and visually reviewed without adding,
  changing, or running UI automation tests.

### Hard constraints

- Keep `opencorvus.jsonc` and the root Session config overlay as the only model
  configuration sources. Do not restore recent-model or provider-default
  fallback behavior.
- Keep `/global/chat` and `/global/work` as the atomic first-submit persistence
  boundary introduced by the lazy New Chat design.
- Do not write the one-shot launcher choice into global configuration or a
  newly generated project file. It is a Conversation Session override.
- Reuse `Config.ModelId`, `Config.Overlay`,
  `Session.mergeConfigOverlayInProject`, and `EffectiveConfig`; do not add a
  parallel model parser or resolver.
- Preserve unrelated worktree changes. Do not restart, refresh, terminate, or
  mutate the user's running packaged Overlay.
- Do not add, change, or run UI automated tests. Manual browser interaction
  must use Node.js.

### Sources read

- `AGENTS.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-29-global-new-chat-lazy-project-persistence.md`.
- `packages/overlay/src/components/ComposerModelSelector.tsx`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/services/{chat,conversation-session,task,workspace}.ts`.
- `packages/opencorvus/src/agent/model.ts`.
- `packages/opencorvus/src/chat/{global-chat-service,session}.ts`.
- `packages/opencorvus/src/config/{config,effective,model-reference-validation}.ts`.
- `packages/opencorvus/src/session/index.ts`.
- `packages/opencorvus/src/server/routes/{global,session}.ts`.
- Focused Overlay Conversation-service and OpenCorvus coding-route tests.
- Live read-only `/global/config`, `/global/agents`, `/global/providers`,
  project `/config`, and project `/agent` responses.

### Whole-repository search

Repository-wide searches enumerated every
`createGlobalConversationSession`, `GlobalConversationService.create`,
`createRightSidebarConversationSession`, `/global/chat`, `/global/work`,
`newTaskModel`, `configOverlay`, and `validateConfigModelReferences` reference.

| Owner / call site                                      | Current evidence                                                                              | Decision                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComposerModelSelector` directory-free selection       | Stores the selected value only in `appStore.newTaskModel`.                                    | Keep this draft owner; submit it through the global create call.                                                                              |
| `main` global Chat/Work submit                         | Calls `createGlobalConversationSession({ experience })`, then submits through `panelMessage`. | Pass the exact `newTaskModel` into global creation before the first prompt.                                                                   |
| `conversation-session.createGlobalConversationSession` | Posts to `/global/chat` or `/global/work` without a body.                                     | Add one optional `model` field and send a strict JSON body.                                                                                   |
| `GlobalRoutes` Chat and Work routes                    | Accept no body and call `GlobalConversationService.create(experience)`.                       | Reuse one shared optional-model request schema for both routes.                                                                               |
| `GlobalConversationService.create`                     | Atomically creates an anonymous Project and root Session.                                     | Validate the resulting effective config and persist the explicit model on the root Session overlay before returning. Keep discard-on-failure. |
| `createRightSidebarConversationSession`                | Creates root Chat/Work metadata only.                                                         | Keep all project-scoped and handoff callers unchanged; global creation applies its overlay through the canonical Session API.                 |
| Project-scoped Conversation route                      | Creates a Session in an existing Project.                                                     | Keep unchanged; the project Composer already writes the project/session configuration source directly.                                        |
| Work handoff and Panel callers                         | Create Work Sessions inside existing ownership.                                               | Keep unchanged; they do not consume the global launcher draft.                                                                                |
| Standalone automation wake                             | Creates a right-sidebar Chat through `SessionWake`.                                           | Keep unchanged; automation owns its model through its existing persisted configuration.                                                       |
| `promptSessionMessage`                                 | Sends no model and relies on canonical resolution.                                            | Keep unchanged; the root Session overlay must make every prompt deterministic.                                                                |
| `resolveAgentModelRef`                                 | Resolves session overlay before base config and throws when both are empty.                   | Keep unchanged; this is the model-resolution single source.                                                                                   |

### Independent agent feedback

- None. The user did not request sub-agents. The frontend transport and backend
  creation changes are one tightly coupled protocol repair.

## Causal chain

The directory-free model selector records `appStore.newTaskModel` -> first
submission calls `createGlobalConversationSession` without that value ->
`POST /global/chat` creates an anonymous Project and root Chat Session without
a config overlay -> `panelMessage` sends the first message through
`prompt_async` without an explicit model -> `resolveAgentModelRef("chat")`
finds neither a session model nor a base model -> the server returns HTTP 400.

Provider connectivity is not the cause. The live instance exposes the connected
Provider and model catalog, while both global and generated-project effective
configs have no default model. A different anonymous Project contains the
previous explicit model, proving that the selection was scoped elsewhere rather
than inherited by this fresh New Chat.

## Implementation plan

1. Export the existing `Config.ModelId` schema and define one strict optional
   model request shared by `/global/chat` and `/global/work`.
2. Send `appStore.newTaskModel` through
   `createGlobalConversationSession` on first Chat/Work submission.
3. Inside `GlobalConversationService.create`, preview and validate the selected
   model against the created Project's effective Provider catalog, create the
   root Session, and persist `{ model }` through
   `Session.mergeConfigOverlayInProject` before returning.
4. Extend focused non-UI transport and route tests for exact request bodies,
   persisted overlay resolution, inheritance when omitted, rejection, and
   temporary-Project cleanup.
5. Regenerate OpenAPI and SDK outputs using repository commands, run focused
   tests and typechecks, perform real isolated-page interaction and screenshot
   review, then complete a second diff review.

## Verification record

- `bun test --timeout=0 test/server/coding-routes.test.ts`
  (`packages/opencorvus`): 25 passed.
- `bun test --timeout=0 test/coding-assistant-service.test.ts`
  (`packages/overlay`): 17 passed.
- `bun ./script/build.ts` (`packages/sdk/js`): OpenAPI and JavaScript SDK
  regenerated successfully.
- `bun run api:routes-check`: route inventory clean across 33 files.
- `bun run docs:check`: 308 operations and 24 groups match generated API
  documentation.
- `bun test --timeout=0 test/script/historical-docs-links.test.ts
test/script/product-docs-single-source.test.ts
test/script/document-health.test.ts`: 93 passed.
- `bun run typecheck`: all 10 workspace typecheck tasks passed.
- `bun run build:vite`: production Overlay build completed.
- Real browser acceptance used the isolated source server at
  `http://127.0.0.1:8791/ui/`. New Chat reached the directory-free launcher,
  its connected Provider catalog exposed 35 models, selecting
  `hexin/gpt-5.6-sol` visibly updated the Composer model control, and the page
  emitted no console errors. The reviewed screenshot is
  `.scratch/visual-new-chat-model-handoff-2026-07-29.png`. No prompt was sent
  and the isolated server shut down with zero owned prompts or tool parts.
