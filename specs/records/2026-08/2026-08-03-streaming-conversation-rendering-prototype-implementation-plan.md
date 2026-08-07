# Streaming Conversation Rendering Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a standalone dark/light HTML mock that covers the approved right-side streaming-conversation rendering scenarios.

**Architecture:** A single HTML document owns semantic theme tokens, mock event data, DOM generation, and prototype-only interactions. It is isolated in `specs/artifacts/`, so it neither imports nor duplicates the production Overlay runtime.

**Tech Stack:** Semantic CSS custom properties, vanilla browser JavaScript, inline SVG symbols, and local static HTML.

## Global Constraints

- Desktop-only; do not add responsive/mobile behavior.
- Preserve protocol facts and chronological visual order from the approved design.
- Do not modify production Overlay, transport, tests, or runtime files.
- Do not create, modify, or run UI automated tests; manually inspect the real HTML page in both themes.
- Do not commit screenshots, fixtures, or repeatable UI assertions.
- Use `specs/artifacts/` as the sole mock prototype location and preserve unrelated worktree changes.

---

## Recall

| Item | Evidence |
| --- | --- |
| Approved design | `2026-08-03-streaming-conversation-rendering-prototype-design.md` defines 13 visible scenarios, a single chronological transcript, collapsed execution details, and light/dark semantic tokens. |
| User acceptance | The user explicitly confirmed the design record before this plan. |
| Source boundary | `CardParts` is the typed visible dispatcher; `ChatBubble` owns message identity; `Card`/`InlineToolPart` own revealed Tool rows/body variants; hidden reasoning and boundary controls do not gain rendered content. |
| Verification | Manual real-page interaction must cover both themes, disclosure/detail toggles, question/permission buttons, and visual review. `git diff --check` validates the artifact and index. |

### Task 1: Build the standalone review prototype

**Files:**

- Create: `specs/artifacts/streaming-conversation-rendering-prototype.html`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**

- Consumes: the 13 approved scenarios in `2026-08-03-streaming-conversation-rendering-prototype-design.md`.
- Produces: one browser-openable artifact with `data-theme`, `data-open`, and mock record identifiers used only for semantic display and local interaction.

- [ ] **Step 1: Define one mock timeline with explicit display facts**

Create an in-page `timeline` array that includes these concrete records in chronological order: a human prompt with image attachment; Agent streaming narrative with a separate muted `正在生成` left-to-right wave; collapsed Tool/Patch execution run; shell success; file-read result; file-write diff; TODO update; browser evidence with screenshot placeholder; generic Tool attachment; failed Tool; patch; agent conclusion; interaction question; permission request; interactive artifact; delegated context; child Agent update; review stream; and `part-error`. Do not render a blinking cursor. Running, waiting, and failed status lights use distinct semantic breathing rhythms; completed status is steady.

- [ ] **Step 2: Build semantic light/dark presentation tokens**

Define `:root[data-theme="dark"]` and `:root[data-theme="light"]` custom-property maps for canvas, surface, raised surface, text, muted text, border, focus, accent, success, warning, and error. Use only these semantic tokens in all component selectors.

- [ ] **Step 3: Implement message and execution renderers**

Render user and Agent message frames from the mock timeline. Render Tool/Patch records as one collapsed execution group with a summary count/state. Reveal Tool rows in chronology and render specialized detail blocks for command output, code/read body, diff, TODOs, browser evidence, generic attachment, and failure.

- [ ] **Step 4: Implement remaining message-part specimens**

Render file/media rows, image preview placeholder, `part-error`, question choices, permission actions, artifact preview, delegated-context disclosure, compact child Agent item, and review progress. Keep hidden reasoning and boundaries absent from visible output.

- [ ] **Step 5: Add prototype-only interactions**

Implement accessible click/keyboard handlers for the theme switch, execution summary, individual Tool details, question selection, permission buttons, and artifact-open feedback. State is local to the page and never serializes or imitates runtime protocol state.

- [ ] **Step 6: Verify manually and update indexes**

Open the HTML in a real browser. Inspect dark and light modes, expanded and collapsed execution details, all specialized Tool blocks, and interaction controls. Capture ephemeral screenshots for personal visual review. Update both spec indexes to link the artifact; run `git diff --check` and the targeted documentation health check after staging the new artifact.

- [ ] **Step 7: Commit and push the task-owned artifacts**

Stage only the new HTML, this plan, and the two indexes. Commit with subject `dsw-33987 add streaming conversation rendering prototype`, push to `myhexin`, and verify that unrelated modifications remain unstaged.

## Plan Self-Review

The plan has one independently reviewable deliverable. It names the exact artifact, its data/rendering boundary, every approved scenario family, manual visual acceptance, and the required documentation/index/git checks. UI-test prohibition overrides generic TDD guidance because every asserted output is visual.
