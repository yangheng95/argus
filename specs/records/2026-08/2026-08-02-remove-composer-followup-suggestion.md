# Remove Composer Follow-up Suggestion

## Recall

### User request

- Delete the behavior that automatically puts a suggested next instruction into the Composer after a Task finishes.
- The supplied screenshot shows an automatically generated sentence occupying the textarea; an empty Composer is the required resting result.

### Acceptance

- A Task busy-to-idle transition does not request or generate a follow-up suggestion.
- The Composer textarea is not written by a parent-owned suggestion signal.
- The private backend helper, HTTP route, OpenAPI operation, and generated SDK method are removed together; there is no dormant second implementation.
- Existing user-authored draft persistence and ordinary localized placeholder hints remain unchanged.
- The real Overlay page is opened and inspected manually; the final empty Composer screenshot is tied to this change.

### Hard constraints

- Preserve all concurrent worktree changes and stage only task-owned paths.
- Do not add, update, or run UI automation tests.
- Delete obsolete UI/source-string assertions and follow-up fixture branches encountered in the touched feature path while preserving valid non-UI service contracts.
- Regenerate OpenAPI and SDK artifacts from the runtime route source instead of hand-editing generated files.
- Playwright, if used for interactive inspection, runs with Node rather than Bun and is not saved as a repeatable test.

### Read records

- `specs/README.md`
- `specs/records/2026-08/README.md`
- Repository `AGENTS.md` instructions supplied for this Task.
- Memory registry entry for shared-infrastructure root fixes; the current feature was then verified directly in the worktree.

### Whole-repository grep

Commands:

- `rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!build' "请开始修复T1、T2、T3三项缺陷，并提交|请开始修复|T1、T2、T3|三项缺陷" .`
- `rg -n "generateFollowup|follow-up suggestion|followup|suggestion" packages --glob '*.{ts,tsx,js,jsx}'`
- `rg -n "pendingComposerSuggestion|pendingSuggestion|onSuggestionApplied|requestFollowupSuggestion|/followup|generateFollowup" packages --glob '*.{ts,tsx}'`
- `rg -n "task\\.followup|/task/\\{taskID\\}/followup|followup" packages/sdk packages/opencorvus packages/transport-protocol --glob '*.{ts,json,md}'`

Findings:

- The screenshot sentence is not a source literal; it is generated at runtime.
- `packages/overlay/src/main.tsx` owns the busy-to-idle edge, calls `POST /task/:taskID/followup`, stores the result, and passes it to the Composer.
- `packages/overlay/src/components/ChatComposer.tsx` owns the `pendingSuggestion` input and writes that text into the persisted draft.
- `packages/opencorvus/src/server/routes/orchestrator.ts` exposes the only HTTP route.
- `packages/opencorvus/src/task-api/index.ts` owns the only language-model generation implementation.
- `packages/opencorvus/src/config/prompt-catalog.ts` documents the summary helper only in relation to this generator.
- `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/{sdk.gen.ts,types.gen.ts}` are generated public copies of the route.
- `packages/transport-protocol/test/contract.test.ts` lists the public path and must lose that obsolete member from its positive route catalog.
- `packages/opencorvus/test/task-api/followup-provider-options.test.ts` exists only for the retired helper and must be deleted.
- `packages/overlay/test/api-directory-injection.test.ts` contains one prohibited frontend source-string assertion block plus valid non-UI service contracts. The prohibited block and obsolete follow-up members must be deleted while the valid contracts remain.
- `packages/overlay/test/browser/work-ledger-fixture.ts` contains the retired route fixture among a broader UI fixture. The obsolete branch must be removed; the broader fixture is not feature-owned and remains only until its owning UI test suite is separately retired.

### Independent agent feedback

- No independent agents were requested by the user, so none were started.

## Call-site disposition

| Call site | Disposition |
| --- | --- |
| Overlay busy-to-idle effect and `pendingSuggestion` signal | Delete |
| `ChatComposer` suggestion props and draft injection effect | Delete |
| `EngineService.generateFollowup` | Delete |
| `POST /task/:taskID/followup` | Delete |
| Prompt catalog follow-up comment | Replace with the remaining registry ownership description |
| OpenAPI and generated JavaScript SDK operation | Regenerate away |
| Transport route catalog member | Delete |
| Follow-up-only backend test | Delete |
| Frontend source-string API injection assertion block | Delete as prohibited UI automation; preserve the file's valid service contracts |
| Work Ledger browser fixture branch | Delete |
| Localized rotating textarea placeholder | Preserve; it is a visual hint, not injected user text |
| User draft persistence | Preserve |

## Verification

- Targeted non-UI contract tests for route/OpenAPI coherence.
- Overlay and OpenCorvus typechecks/build checks.
- Documentation health checks required by the spec index update.
- Real Overlay launch, manual interaction, screenshot inspection, and a second human-style review of the final visible state.
