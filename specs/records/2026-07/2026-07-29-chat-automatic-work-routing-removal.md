# Chat Automatic Work-Routing Removal

## Recall

### User requirement

- Chat must not automatically publish or route a request to Work.
- This is not a request to retire Work or dismantle the Chat-to-Work protocol.

### Acceptance criteria

1. The Chat runtime prompt no longer instructs the model to recommend or call
   `panel.wake_work` based on its own classification.
2. The model-facing `wake_work` Tool description permits the action only after
   an explicit user request and forbids inferred Work recommendations.
3. Chat retains its ordinary interactive responsibilities and Mission
   recommendation behavior.
4. The existing `wake_work` Panel action, confirmation, conversation handoff,
   and Work Ledger transition remain available for an explicit future caller.
5. Composer `Code | Work`, direct project/global Work creation, Work lifecycle,
   Work capability settings, and Work-to-Mission behavior remain unchanged.
6. Focused non-User Interface (UI) prompt and type checks pass. UI automated
   tests are not modified or run.

### Hard constraints

- Change model-facing prompt and Tool-description behavior only. Do not delete
  the Panel action, event protocol, transport schema, Overlay handoff consumer,
  Work routes, or Work Session identity.
- Do not add a host-side routing rule or keyword classifier.
- Preserve all unrelated Prism and documentation changes in the shared
  worktree.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/chat/handoff.ts`
- `packages/opencorvus/src/server/routes/work-ledger.ts`
- `packages/overlay/src/services/conversation-session.ts`
- `packages/overlay/src/main.tsx`

### Whole-repository search

The search covered `wake_work`, `ConversationHandoffEvent`,
`WorkLedgerConversationHandoffEvent`, `activeConversationHandoff`,
`conversation.handoff`, and every direct Work creation route. It proved:

- proactive classification is expressed by both the Chat runtime prompt and
  the current model-facing `wake_work` Tool description;
- `wake_work` itself asks a visible Yes/No question and creates Work only after
  confirmation;
- the Composer's direct Work route does not consume the Chat prompt;
- Work-to-Mission uses `wake_mission`, not `wake_work`.

### Independent Agent Feedback

No independent Agent was requested or used.

## Decision

Delete the Chat prompt paragraph that tells the model to classify longer
research/production requests as Work and call `panel.wake_work`. Rewrite the
Tool description to permit that call only when the user explicitly asks to
continue the current request in Work, and explicitly prohibit inferred
recommendations.

Do not replace it with another routing rule. Chat handles its request or
recommends Mission under the existing durable-orchestration rule. Work remains
an explicit product choice in the Composer. The dormant explicit handoff
protocol is retained because the user did not ask to remove that capability.

## Verification

- Assert the Chat runtime prompt contains `wake_mission` and no
  `wake_work` instruction.
- Assert the Panel capability and implementation still expose `wake_work`.
- Run focused non-UI primary-assistant and Panel contracts, core typecheck,
  document health, and `git diff --check`.
- Do not modify or run UI automated tests.
