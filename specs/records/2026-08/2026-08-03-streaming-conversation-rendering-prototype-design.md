# Streaming Conversation Rendering Prototype Design

Date: 2026-08-03
Status: Approved design; awaiting prototype review

## Recall

| Item | Evidence |
| --- | --- |
| User request | Scan the right-side streaming conversation parsing logic, identify every rendering scenario, create representative mock data, and first present a simple Codex-inspired HTML UI for approval. |
| User decisions | The prototype must include both dark and light themes. The user approved the single chronological transcript with collapsed execution-detail design. |
| Acceptance criteria | One standalone desktop-only HTML prototype renders every currently visible message and Tool scenario from mock data; the user can switch light/dark themes and expand Tool detail without changing production Overlay code. |
| Hard constraints | Preserve existing protocol, chronological ordering, component ownership, theme-token direction, and real-message identity. Do not add a fallback renderer, duplicate runtime source, state-machine code, compatibility behavior, UI automated test, fixture, screenshot baseline, or responsive/mobile scope. The prototype is review material only, not a product renderer. |
| Sources read | Root `AGENTS.md`; `specs/README.md`; `specs/current/architecture/12-overlay-card-system.md`; 2026-07 Tool/disclosure/conversation/UI-test records; current `CardParts.tsx`, `ChatBubble.tsx`, `Card.tsx`, `InlineToolPart.tsx`, `InteractionCard.tsx`, `FilePart.tsx`, `ReviewStreamSection.tsx`, `message-part.ts`, `tool-card-node.ts`, and transport protocol definitions. |
| Whole-repository grep | Enumerated every production reference to `CardParts`, `ChatBubble`, `InlineToolPart`, `CONVERSATION_DISPLAY_MESSAGE_PART_TYPES`, and `partitionMessagePartRenderRuns`. `CardParts` is the visible part dispatcher; `ChatBubble` is the shared main/exact-session surface; `Card` is the revealed Tool card; `InlineToolPart` owns Tool body variants. |
| Independent-agent feedback | None. The user did not request delegation. |
| Workspace preservation | Pre-existing `packages/overlay/src-tauri/src/main.rs` and untracked root documentation changes remain untouched, unstaged, and uncommitted. |

## Current Rendering Inventory

The protocol declares ten display part types plus the `boundary` separator:
`text`, `part-error`, `reasoning`, `tool`, `patch`, `file`,
`interactive-artifact`, `interaction-question`, `interaction-permission`, and
`subtask`.

`CardParts` uses this list as a strict renderability boundary, but the visible
conversation surface is intentionally smaller:

| Runtime part or surface | Current visible treatment | Prototype treatment |
| --- | --- | --- |
| User / Agent message | `ChatBubble` identity and narrative body | Two aligned, restrained transcript treatments. |
| Text | `TextPart`; may stream | Narrative, code, list, and a muted loading-status wave. |
| Reasoning / boundary | Evidence or run separator only | No private text or standalone output. |
| Tool / Patch sequence | Adjacent runs collapse through `ExecutionDisclosureRun`; revealed rows reuse `Card` | One expandable chronological disclosure and changed-files event. |
| Tool lifecycle | `toolToCardNode` maps pending/running/completed/error | Pending, running, completed, and failed specimens. |
| Tool body | `InlineToolPart` specializes shell, file, TODO, diff, browser, attachment, and ordinary output | Expandable examples for every specialization. |
| File | `FilePart` branches image, video, audio, PDF, and generic download | Image thumbnail and media/document/file rows. |
| `part-error` | Alert-style error message | Compact failure block. |
| Question / permission | `InteractionCard` form or permission actions | One multi-option question and one approval request. |
| Interactive artifact | Owned artifact renderer | Compact artifact preview with open action. |
| Child Agent / delegated context | Child `ChatBubble`; `subtask` has no direct `CardParts` branch | Nested agent update and collapsed context marker. |
| Review stream | `ReviewStreamSection` summary | Quiet in-progress review row. |

This yields **13 visible prototype scenarios**: message identity, narrative and
streaming text, Tool lifecycle, Tool bodies, execution disclosure, patch, file,
error, question, permission, artifact, child/delegated context, and review
stream. The prototype does not invent a second transcript or expose hidden
reasoning.

## Approved Design

### Reading surface

The page is a desktop right-dock simulation with one vertical chronological
column on a neutral canvas. Agent content is left anchored with a small identity
row; human content is right anchored with a quiet raised surface. Narrative
text remains dominant: no decorative panels compete with it.

### Execution detail

Tools are compact event rows between narrative sections. Every row carries a
semantic icon, plain-language label, short target, and lifecycle indicator. A
contiguous Tool/Patch run has one expandable summary. Expansion reveals only
the relevant chronological details: command/output, file diff, TODO list,
browser evidence, or attachment.

### Theme system

Light and dark palettes are semantic CSS custom-property sets selected by one
`data-theme` attribute. Both share the same canvas, user surface, Tool,
metadata, focus, success, warning, and error hierarchy. The switch changes
token values only; it never branches markup or mock data.

### Mock data and interaction

A single in-page data model supplies every specimen. Streaming is represented
by a separate muted `正在生成` status with a left-to-right low-contrast color
wave. Running, waiting, and failed status lights use their semantic colors for
different breathing rhythms, while completed status stays still. The earlier
simulated blinking cursor is removed. Theme selection, Tool
disclosure/detail expansion, and interaction choices are lightweight prototype
controls; they demonstrate presentation semantics and do not imitate backend
state or create another runtime protocol.

The companion `streaming-conversation-current-ui-comparison.html` deliberately
uses the identical mock timeline facts but projects them through the current
Overlay's message-card gradient, contained user card, and compact Tool
disclosure hierarchy. It is a visual comparison artifact, not a second runtime
renderer or a proposal to preserve the current style.

## Delivery and Verification

1. Create one HTML file under `specs/artifacts/` with embedded CSS and JavaScript mock data.
2. Open it as a real page, toggle both themes, expand Tool disclosure/details, and exercise question/permission controls.
3. Capture scoped screenshots for personal review only; do not commit baselines or UI assertions.
4. Run documentation health and `git diff --check`; do not create, modify, or run UI automated tests.

## Spec Self-Review

No placeholders remain. The inventory distinguishes protocol controls from
visible renderers, retains the existing single dispatcher/Tool-card ownership,
and limits delivery to a desktop mock-only prototype.
