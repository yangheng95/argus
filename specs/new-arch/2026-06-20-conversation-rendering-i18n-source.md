# Conversation Rendering i18n Source

Date: 2026-06-20

i18n means internationalization. UI means User Interface. ARIA means
Accessible Rich Internet Applications.

## Problem

Independent GUI review and local sweep found conversation/tool rendering still
contains user-visible and accessible English literals:

- `CardParts.tsx` renders the subtask chip label as `Subtask`.
- `InlineToolPart.tsx` renders the read-reminder label as `Loaded
  instructions`.
- `InlineToolPart.tsx` passes browser evidence screenshot alt text as `Browser
  observation`.
- `ConversationAgentRail.tsx` exposes the rail landmark as
  `aria-label="Agent workflow"`.
- `ConversationAgentRail.tsx` generates notification titles/messages/details
  and rail button accessible names from hardcoded English and raw status
  enums.
- `InlineToolPart.tsx` formats tool-diff file counts with a local
  `file/files` ternary while `files.changed` already exists.
- `tool-card-node.ts` promotes todo/updateplan tool cards with `Todos` and
  `Plan` titles instead of translatable title keys.
- Browser evidence thumbnails all share the same generic alt text, so multiple
  screenshots have indistinguishable preview button accessible names.

These strings bypass the overlay locale files, so the Chinese panel keeps
English labels in visible text and screen-reader output.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | User-visible strings must follow the project i18n state; no fake locale plumbing. |
| `2026-06-20-conversation-render-error-i18n.md` | Conversation render-path messages should use locale keys instead of hardcoded English. |
| `inline-tool-output-summary.test.ts` | Existing test pins the browser evidence alt literal, so tests currently preserve the i18n bug. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "Subtask|Loaded instructions|Browser observation|Agent workflow" packages/overlay/src/components packages/overlay/test` | The first literals are owned by `CardParts.tsx`, `InlineToolPart.tsx`, `ConversationAgentRail.tsx`, and one source test. | Replace them with `t()` keys and update the test to reject the literals. |
| Heisenberg independent review | Found the same render path still leaks notification copy, raw rail statuses, `file/files`, `Todos/Plan`, and generic browser screenshot alt text. | Expand this same fix instead of committing a partial i18n cleanup. |
| `rg -n "browser_preview|card\\.|common.loaded|activity.left" packages/overlay/src/i18n` | Locale files already define nearby namespaces for card labels, browser-preview strings, and activity landmarks. | Add focused keys to the existing locale files; do not create a parallel locale file or dynamic key builder. |
| `check-panel-i18n.ts` review | The i18n checker extracts literal `t("...")` calls and validates locale parity. | Use literal keys so the existing checker protects them. |

## Fix Plan

1. Import `t` in `CardParts.tsx` and render `card.subtask`.
2. Import `t` and `tc` in `InlineToolPart.tsx`; render
   `tool.loaded_instructions`, contextual browser evidence alt text, and
   `tc("files.changed", count)`.
3. Import `t` in `ConversationAgentRail.tsx`; render
   `agent_rail.workflow_label`, localized status/attempt labels, and localized
   notification copy/details.
4. Return `tool.card.todos` / `tool.card.plan` title keys from
   `tool-card-node.ts` so `CardHeader` translates the promoted title through
   its existing title-key path.
5. Add matching `en-US` and `zh-CN` locale keys.
6. Add static tests that reject the old literals in source and require the new
   literal `t()` keys.

## Acceptance

- The English literals no longer appear in the component sources.
- Rail status/attempt labels, warning copy, tool diff counts, promoted todo/plan
  card titles, and browser evidence alt text use locale keys.
- Both locale files contain the new keys.
- `check:i18n` passes with the existing scanner.
- Source tests guard against reintroducing hardcoded visible/ARIA/alt text.
