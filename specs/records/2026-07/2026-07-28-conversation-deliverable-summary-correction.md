# Conversation Deliverable Summary Correction

Status: Complete
Date: 2026-07-28
Owner: Codex

## Recall

### User request

The terminal conversation card currently calls every Task Artifact Catalog row
a produced Artifact. The supplied screenshot proves that an already-consumed
`queued_operator_wake` and an `orchestrator-stream-error` are presented as the
Task's two outputs. The user expects the card to show what the Task actually
delivered, not the Engine's internal ledger.

### Acceptance criteria

1. The terminal Task card displays only Artifact Catalog entries explicitly
   selected by the Task's canonical completion decision as deliverable
   Artifacts.
2. Engine queue, lifecycle, coordination, and transient stream-error facts are
   never presented as deliverables merely because they exist in the catalog.
3. Generated or modified files remain in the distinct Files changed section
   and continue to open the existing Files review surface.
4. A terminal Task with no selected deliverable Artifact explicitly says that
   no deliverables were produced instead of hiding the card or reporting the
   raw catalog count.
5. Failed and cancelled Tasks display the canonical Task error or cancellation
   reason in a separate outcome section. Internal Artifact labels are not used
   as a substitute for the actual reason.
6. Catalog incompleteness and provider errors remain visible and are not
   mistaken for an empty successful delivery.
7. Standalone Chat preserves its existing persisted file-change summary because
   it has no Task completion-decision or Task Artifact Catalog authority.
8. Focused tests, Overlay typecheck, localization, document health, and a real
   isolated Vite/browser screenshot review pass.

### Hard constraints

- Preserve all concurrent worktree changes and stage only repair-owned files.
- Do not restart, refresh, close, or otherwise interfere with the user's
  running OpenCorvus or Overlay process.
- Keep the current Task Artifact Catalog as the sole Artifact inventory.
- Add one explicit deliverable Artifact locator list to the canonical Task
  completion decision. Keep it semantically distinct from
  `evidence_locators`, which records facts used to justify completion.
- Use `task.completionDecision.deliverableArtifactLocators` as the sole final
  Artifact selection authority. Do not add an Artifact-kind denylist, label
  matching, fallback inventory, local signal, query override, or second index.
- Keep the Files workbench as the sole full diff-review owner.
- Use Node, not Bun, for Playwright-backed browser execution.
- Desktop-only scope; no mobile or tablet work is authorized.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-27-conversation-artifact-file-summary.md`
- `specs/records/2026-07/2026-07-28-conversation-terminal-artifact-overview-repair.md`
- `packages/opencorvus/src/engine/completion-decision.ts`
- `packages/opencorvus/src/orchestrator/task-lifecycle-tools.ts`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/artifact-catalog/index.ts`
- `packages/opencorvus/src/engine/artifact-catalog-metadata.ts`
- `packages/plugin/src/artifact-catalog.ts`
- `packages/plugin/src/task-artifact.ts`
- `packages/overlay/src/components/ConversationArtifactSummary.tsx`
- `packages/overlay/src/services/conversation-artifacts.ts`
- `packages/overlay/src/store/board.ts`
- `packages/overlay/test/conversation-artifact-overview-service.test.ts`
- `packages/overlay/test/conversation-artifact-summary.test.ts`
- `packages/overlay/test/browser/fixtures/conversation-artifact-summary/main.tsx`
- the user-supplied terminal Artifact screenshot

### Full-repository grep result

Repository-wide searches covered `ConversationArtifactSummary`,
`loadConversationArtifactOverview`, `ArtifactCatalogEntry`,
`artifact_type`, `task_completion_decision`, `completionDecision`,
`evidenceLocators`, `queued_operator_wake`, `orchestrator-stream-error`,
`terminalReason`, `cancellation`, every `recordEngineArtifact` /
`insertEngineArtifact` writer, and the focused route/service/component/browser
tests.

| Call-point family | Current owner | Disposition |
| --- | --- | --- |
| Terminal summary mount | `Conversation.tsx` | Preserve its single post-timeline mount. |
| Full Artifact inventory | `artifact-catalog/index.ts` and `GET /task/:taskID/artifacts` | Preserve unchanged as the canonical inventory and continue consuming every cursor page. |
| Final Task judgment evidence | `recordTaskCompletionDecision.payload.evidence_locators` | Preserve as the exact facts used to justify completion; do not relabel it as user delivery. |
| Final Task deliverables | `CompleteTaskInputSchema` and `recordTaskCompletionDecision` | Add one explicit exact Artifact-read-locator list, validate Task ownership, persist it in the same immutable completion decision, and project it through `viewTask()`. |
| Orchestrator completion instruction | `prompt/core/orchestrator-core.txt` and `CompleteTaskInputSchema` descriptions | Explicitly separate decision evidence from user-consumable deliverables; internal facts are not delivery unless the user requested that exact fact as output. |
| Engine Artifact identity | `EngineArtifactLocatorSchema` | Match exact Artifact ID, catalog revision, and SHA-256 digest. |
| Task Artifact identity | `TaskArtifactSnapshotIdentitySchema` and resource locators | Match the exact snapshot identity; a selected resource selects its owning snapshot row for summary display. |
| Internal runtime facts | Engine queue, error, coordination, Goal-attempt, and lifecycle Artifact writers | Keep in the catalog for agents, audit, and diagnostics; do not show them unless the completion decision explicitly selected their exact locator. |
| Failed Task reason | `viewTask().error`, `terminalReason`, and `cancellation.reason` | Render separately as the canonical user-facing outcome. |
| File changes | `currentConversationAgentChangeGroups`, persisted changes, and Files workbench | Preserve as a separate auxiliary section and existing Review action. |
| Standalone Chat | persisted `SessionSummary.diff` | Preserve the current file-only summary; it has no Task completion-decision authority. |

### Independent agent feedback

No independent Agent was requested. Secondary root-agent review rejected the
first implementation draft because completion evidence answers “why may the
Task complete,” not “what did the Task deliver.” Reusing it would have renamed
review and verification evidence as deliverables. The corrected design stores
an explicit deliverable Artifact locator list in the same immutable completion
decision.

## Root cause

`ConversationArtifactSummary` renders every catalog entry and uses
`catalog_total` as its headline count. The catalog is intentionally broader
than user delivery: it includes domain outputs, Host observations, queue wakes,
coordination facts, errors, and lifecycle decisions. The component ignored the
terminal decision boundary, and that decision did not yet distinguish evidence
used to justify completion from Artifacts intentionally delivered to the user.
Consequently, neither the whole Catalog nor `evidence_locators` can truthfully
drive the delivery card.

## Implementation plan

1. Extend the immutable Task completion decision and `complete_task` input with
   one exact deliverable Artifact locator list, validate Task ownership, and
   project it through the existing Task board response.
2. Add one exact-locator projection in the Overlay Artifact service that maps
   completion-decision deliverables to current catalog entries, including Task
   Artifact resource-to-snapshot ownership.
3. Refactor the terminal card to count and render only that projection, always
   show a terminal Task delivery outcome, and render failure/cancellation
   reasons separately.
4. Update localized copy and the isolated browser fixture to cover a completed
   Task with selected deliverables plus unselected internal facts, and add a
   failed no-deliverable state.
5. Extend focused engine/tool/service/component tests, run verification, then inspect both
   states in the real Vite fixture and correct any visual issues.

## Verification log

- `bun test packages/opencorvus/test/engine/completion-decision.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts packages/opencorvus/test/orchestrator/terminal-task-completion.test.ts packages/overlay/test/conversation-artifact-overview-service.test.ts packages/overlay/test/conversation-artifact-summary.test.ts packages/overlay/test/agent-file-changes.test.ts`
  - 32 passed, 0 failed.
- `bun run --cwd packages/plugin typecheck`
  - passed, including type tests.
- `bun run --cwd packages/opencorvus typecheck`
  - passed.
- `bun run --cwd packages/overlay typecheck`
  - passed.
- `bun run --cwd packages/overlay check:i18n`
  - passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 22 passed, 0 failed.
- `bun run docs:check`
  - passed; 307 operations and 24 groups.
- `git diff --check`
  - passed.

### Real Vite/browser acceptance

An isolated Vite fixture was started with Node on port 4187. The user's running
OpenCorvus and Overlay processes were not touched. The in-app browser inspected
the real component at a 900 x 700 desktop viewport.

- The completed card measured 804 px wide and reported `5 deliverables`, even
  though the canonical fixture catalog contained seven rows.
- The two additional rows were exact reproductions of
  `queued_operator_wake / drained` and `orchestrator-stream-error`. Neither
  appeared in the collapsed or expanded delivery list.
- Expanding the card showed exactly five selected Artifact rows and six file
  rows with `aria-expanded="true"`.
- Review changed the fixture's observable result from `Review closed` to
  `Review opened`, proving reuse of the existing Files workbench event.
- The failed path rendered `No deliverables`, the separate `Task failed`
  outcome, and the canonical Task error reason. It did not render either
  internal catalog row as output or as the failure explanation.
- Browser console error/warning collection was empty.
- Current-goal screenshots were saved as
  `.scratch/conversation-deliverable-summary-completed.png` and
  `.scratch/conversation-deliverable-summary-failed.png`.

### Secondary review

The final source was reread against the single-source and no-gate constraints.
The Artifact route and catalog pagination remain unchanged. `complete_task`
persists completion evidence and deliverable Artifacts as separate fields in
the same immutable decision; Task ownership validation applies to both.
Presentation selection compares the complete exact Engine Artifact locator or
Task Artifact snapshot identity from the explicit deliverable list; a selected
resource projects its owning snapshot once. Non-deliverable evidence is never
consulted by the card. There is no Artifact-kind allowlist/denylist, second
inventory, workspace scan, local signal, query override, compatibility path,
or Host scheduling behavior.
