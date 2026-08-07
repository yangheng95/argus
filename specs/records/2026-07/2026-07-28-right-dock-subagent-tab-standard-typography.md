# Right Dock Sub-Agent Tab Standard Typography

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Change the right Dock child-Agent tab text from its visibly undersized typography to the standard font size. |
| Acceptance criteria | Child-Agent tab labels render at the canonical control size, 14px at the default scale; the existing tab geometry, selection, status, overflow, and session routing remain unchanged; a real Vite screenshot is inspected. |
| Hard constraints | Preserve all concurrent work; use the existing Tabs primitive and typography tokens; introduce no duplicate source, fallback, local override, new workflow, or running Overlay process intervention; launch Playwright through Node. |
| Sources read | `AGENTS.md`; Browser skill; `SubagentConversationPanel.tsx`; `inspector.css`; `tabs.css`; `design-language.css`; the existing sub-Agent source and Node browser tests; the prior Right Dock memory record. |
| Whole-repository grep | `rg` enumerated every `subagent-conversation-panel__agent-tab`, `subagent-conversation-panel__agent-label`, Right Dock tab, and font-size owner. `SubagentConversationPanel.tsx` is the sole markup owner; `inspector.css` contains the only child-Agent tab typography override; `tabs.css` and `design-language.css` define the canonical 14px control typography. |
| Independent agent feedback | None. The user did not request sub-agents; this is one coupled CSS owner and its focused verification. |

## Cause and disposition

The child-Agent selector uses the standard `Tab` primitive, but
`.subagent-conversation-panel__agent-tab.oc-tab` locally replaces the primitive's
canonical `--ui-font-control` size with `--ui-font-small`. At the default scale
that changes the label from 14px to 12px. The root repair is to make this sole
override consume `--ui-font-control`; markup, tab size, avatar, status, overflow,
selection, and session routing stay unchanged.

## Verification plan

1. Add a focused source contract that requires the standard control token and rejects the small token.
2. Update the single Inspector surface owner.
3. Run focused tests, Overlay typecheck, and the existing Node-launched Vite sub-Agent fixture.
4. Compare the computed child-Agent tab size with a standard control in the same rendered header and inspect the screenshot.
5. Review the scoped diff, commit only task-owned paths, and push through normal hooks.

## Verification

- Focused source coverage passed: 4 tests, 0 failures, 35 assertions.
- Overlay TypeScript and the production Vite build passed; Vite transformed 7,052 modules.
- The existing Node-launched Vite browser fixture passed. Both the selected child-Agent tab and the standard menu control computed to 14px.
- The fresh `.scratch/subagent-conversation-without-redundant-header.png` screenshot was inspected at its original size. Labels now have the standard readable weight and size without disturbing tab density, truncation, status dots, or the transcript boundary.
- Historical links and product-document single-source tests passed. Document health passed 92 of 93 checks; its only failure listed this new untracked record plus three unrelated concurrently untracked records referenced by the July index. No content, link-resolution, or product contract check failed.
