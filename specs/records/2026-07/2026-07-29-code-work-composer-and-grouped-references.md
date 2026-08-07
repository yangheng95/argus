# Code / Work Composer and Grouped References

## Recall

### User requirements

- Replace the Composer's Chat / Mission / Work dropdown with one unified `Code | Work` pill control.
- `Code` uses the existing Chat conversation route by default. The small project-bound Chat agent remains the semantic router: ordinary concrete work stays in Chat, while work that clearly needs durable orchestration may call the existing `panel.wake_mission` handoff.
- Visible `@mission("<exact-name>")` and `@squad("<manifest-id>")` objects route directly to Mission. A plain Skill remains a Skill reference.
- Typing `@` shows every currently available reference object in one popup. Rows are grouped by their real object type, with visible dividers between Skill, Mission Skill, and Agent Squad groups.
- Mission accepts Composer attachments. Both direct Mission wake and Chat-to-Mission handoff must preserve canonical attachment references and replay them into the Mission wake.
- Implement and deliver only on `v0.0.23beta`.

### Acceptance criteria

- The Composer renders the shared Kobalte-backed `SegmentedControl` with exactly two visible choices, `Code` and `Work`; the retired intent dropdown and its manual Squad multi-select are absent.
- The default signal remains the Chat route. Selecting Code always returns a Work or explicit Mission launcher to Chat, while selecting Work uses the persisted Work conversation experience.
- A normal Code submission creates a Chat conversation. The existing Chat prompt handles ordinary coding, debugging, explanation, and repository edits itself and recommends Mission only for durable orchestration using the real `panel.wake_mission` tool.
- `@mission` and `@squad` are selectable in Code. Their exact atomic directives continue to call `POST /mission/wake` before any Chat session is created.
- Bare `@` renders every available entity from the one scope-keyed catalog snapshot. The popup uses one keyboard-navigable Listbox, preserves exact directive insertion and atomic editing, and visually separates non-empty type groups.
- Direct Mission wake still sends `attachments`; conversational `panel.wake_mission` still materializes the caller's canonical file parts and passes them to `SessionWake.wake`.
- Focused service/UI/backend tests, Overlay typecheck/build, internationalization and document-health checks, a Node-started real Vite browser interaction, inspected screenshots, `git diff --check`, and a second review pass succeed.
- The user's running OpenCorvus / Overlay process is not restarted, refreshed, closed, or used as the browser target.

### Hard constraints

- Root `AGENTS.md` applies. No fallback, compatibility alias, client-only route gate, synthetic message, duplicate catalog, duplicate attachment source, or new Mission state machine is introduced.
- Reuse `SegmentedControl`, Kobalte-backed `Listbox`, the existing scope-keyed reference snapshot, Chat's existing `panel.wake_mission` tool contract, and the existing Mission attachment pipeline.
- Playwright is started by Node.js, never Bun.
- The user explicitly authorized an isolated worktree after the original worktree was found to be on the wrong branch. The authorized worktree is `/tmp/opencorvus-v0023-code-work.xWEE8h`, checked out at `v0.0.23beta`.
- Commit subjects begin with `dsw-33987`; push only the completed `v0.0.23beta` result to `myhexin`.

### Hard-disk sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-17-composer-mention-cascade.md`
- `specs/records/2026-07/2026-07-25-mission-directive-syntax.md`
- `specs/records/2026-07/2026-07-16-mission-attachment-and-composer-intent-preservation.md`
- `specs/records/2026-07/2026-07-25-left-dock-direct-launch-and-alignment.md`
- `specs/records/2026-07/2026-07-28-work-conversation-experience.md`
- `packages/overlay/src/components/{ChatComposer,ComposerMentionMenu}.tsx`
- `packages/overlay/src/components/ui/{Listbox,SegmentedControl}.tsx`
- `packages/overlay/src/services/composer-mention.ts`
- `packages/overlay/src/main.tsx`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/tool/panel.ts`
- Focused Overlay and OpenCorvus source/browser tests found by the searches below.

### Whole-repository search result

The plan was written after repository-wide inventories of `ComposerMode`, `composer-intent-*`,
`selectedExpertSquadIDs`, `ComposerMentionMenu`, `composerMentionOptions`,
`COMPOSER_MENTION_RESULT_LIMIT`, `wake_mission`, `replayMissionCallerFileParts`, `wakeMission`,
and attachment handoff calls.

| Owner / call sites                                                   | Finding                                                                                                                                                                                                                                                                                                                             | Disposition                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatComposer.tsx`, `main.tsx`                                       | One Composer owns the current three-way dropdown. `main.tsx` owns default Chat, explicit Mission launch, Work, current-session projection, and direct directive routing.                                                                                                                                                            | Replace only the visible selector with Code / Work. Preserve the internal explicit Mission/session source needed by Dock and existing Mission records; activating Code maps it back to Chat. Remove manual Squad selection props/state because visible `@squad` becomes the sole exact Squad selector.    |
| `primary-assistant-registry.ts`, `panel.ts`, panel tests             | The project-bound Chat agent already is the requested semantic router. Its prompt keeps ordinary concrete work in Chat and calls `panel.wake_mission` for durable orchestration. The tool asks for confirmation, creates the Mission, records caller lineage, replays caller attachments, wakes Mission, and publishes the handoff. | Reuse and test this implementation. Do not create another routing service or host keyword classifier.                                                                                                                                                                                                     |
| `composer-mention.ts`, `ComposerMentionMenu.tsx`, `ChatComposer.tsx` | The existing two-level picker first returns category pseudo-options, caps entity results at eight, and disables Squad in Chat. Exact `@mission` / `@squad` directive parsing and atomic editing are already canonical.                                                                                                              | Retire category pseudo-options and the result cap. Return real entity options from all three catalogs for bare `@`, retain exact-kind filtering for `@skill`, `@mission`, and `@squad`, and render one grouped Listbox with separators. Enable Squad in Code so its exact directive can route to Mission. |
| Composer CSS and i18n                                                | Cascade geometry and dropdown-specific recipes are local to the retired surfaces. Shared SegmentedControl/Listbox primitives already own selection, focus, density, and pressed state.                                                                                                                                              | Delete retired surface CSS/copy, add only Composer placement/group-divider CSS, and add exact Code/group labels and accessible descriptions.                                                                                                                                                              |
| Overlay source/browser tests                                         | Selector assumptions occur in the Composer, Mission launcher, settings, default-Chat, command-palette, project-new-chat, provider-error, expert-squad, and mention suites.                                                                                                                                                          | Update every affected assertion/interaction to the two-button segmented contract or grouped reference contract; retain unrelated launcher/session coverage.                                                                                                                                               |
| Mission service/route/session tests                                  | Direct `wakeMission` already sends canonical attachment references. `panel.wake_mission` already replays stored caller files into `SessionWake.wake(parts)`.                                                                                                                                                                        | No duplicate backend implementation. Run the focused attachment/handoff tests as acceptance evidence.                                                                                                                                                                                                     |

### Independent-agent feedback

- No sub-agent was requested or used.

### Git baseline

- Branch: `v0.0.23beta`.
- Starting baseline: `21cafc7c12576c42658868cf846eb3c1b9b759f2`.
- Before delivery, the branch advanced through the concurrent Work artifact records to
  `2bd84c07f28af3befb0e07c7c4c04d5ef94f413a`; after fetch, `HEAD` and
  `myhexin/v0.0.23beta` were aligned (`0 0`).
- The original shared worktree's unrelated and wrong-branch local changes remain untouched and are excluded from this branch.

## Root design

`Code` is a user-facing ingress, not a new backend experience. It projects to the existing persisted
`chat` experience and therefore starts the small Chat agent. That agent makes the semantic decision through
its prompt and real tool call: it completes ordinary concrete requests in Chat and recommends a Mission for
durable orchestration. Explicit visible Mission objects bypass that recommendation because they are already
unambiguous operator intent and continue to use the direct Mission wake path.

The reference popup contains only real selectable entities. `composerMentionOptions` remains the sole local
ranking source, but a category-stage query searches the union of the three catalogs instead of manufacturing
selectable category rows. `ComposerMentionMenu` derives non-empty ordered groups from those options and
renders them inside one Kobalte Listbox, so Arrow navigation and selection still operate over one flat value
set while visual headers and dividers communicate type.

## Implementation plan

1. Replace the intent dropdown with the shared small `SegmentedControl`; remove manual Squad selection state and retired dropdown CSS/copy.
2. Flatten mention candidates into all available real entities, enable Squad in Code, and render one grouped Listbox with true type labels and dividers.
3. Update focused source/unit/browser tests, preserving direct Mission, semantic handoff, exact directive, attachment, IME, focus, and atomic-edit behavior.
4. Build and run an isolated Vite page through Node-started Playwright, inspect Code/Work and grouped-mention screenshots, correct visual issues, then rerun.
5. Run document health and second review, commit only task-owned paths, push `v0.0.23beta` to `myhexin`, and verify remote divergence is `0 0`.

## Progress

- [x] Confirm the authorized `v0.0.23beta` worktree and remote baseline.
- [x] Read current architecture, prior decisions, runtime owners, and exhaustive call sites.
- [x] Implement Code / Work and grouped all-object references.
- [x] Complete automated and real-browser visual acceptance.
- [x] Complete second review, commit, push, and remote verification.

## Verification

- Final Overlay focused source and service rerun: 100 passed, 0 failed.
- Primary Chat agent and Mission wake route tests: 32 passed, 0 failed.
- `panel.wake_mission` attachment, handoff, decline, wake-failure, and project-ownership tests: 5 passed, 0 failed.
- Overlay TypeScript typecheck and i18n single-source check passed.
- Historical documentation health: 22 passed, 0 failed.
- Node-started real Vite browser test passed. The inspected screenshots prove the resting Code / Work pill and a fully visible grouped popup with all five available objects, three typed headings, and visible dividers.
- Node-started browser fixtures for the shared Composer button primitive, resize behavior, light-theme rail, neutral hover wash, and Select popup contrast passed individually.
- The first screenshot inspection exposed a clipped popup header at the titlebar boundary. The popup density and viewport assertion were corrected, then the browser test and screenshot inspection passed.
