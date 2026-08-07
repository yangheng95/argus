# Streaming Conversation Terminal Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the final waiting item in every independently rendered conversation stream an unambiguous, smooth activity cue while making generic tool payloads readable and scrollable.

**Architecture:** Existing card-part grouping remains the single owner of chronological ordering and the existing trailing-text selection remains the owner of text streaming. `ExecutionDisclosureRun` owns visual running state for its final tool summary only. `InlineToolPart` routes generic JSON/plain payloads to a preformatted data surface, while specialized code, diff, todo, browser-evidence and command views retain their current renderer.

**Tech Stack:** SolidJS, existing OpenCorvus Button/Icon primitives, CSS custom properties, Bun typecheck and real native Overlay visual review.

## Global Constraints

- Do not add, change, or run UI automation tests; verify visual work through a real running client and screenshot review.
- Do not propagate one task or child Agent’s activity state into sibling or historical parts.
- Keep the existing part projection and disclosure state as the only data source; no synthetic activity messages or state machine.
- Preserve user-created root files and do not use Git reset or a worktree.

---

### Task 1: Make terminal text activity an independent final line

**Files:**
- Modify: `packages/overlay/src/components/TextPart.tsx:20-45`
- Modify: `packages/overlay/src/styles/surfaces/messages.css:1-36`

**Consumes:** `StreamingMarkdownPart`’s existing `props.streaming && activeText()` ownership condition.

**Produces:** A block-level `msg-streaming-status` directly following only the active text of a streaming text part.

- [ ] **Step 1: Change the status element to preserve a final standalone line**

```tsx
<Show when={props.streaming && activeText()}>
  <span class="msg-streaming-status" role="status">正在生成</span>
</Show>
```

Keep the condition unchanged; CSS supplies block positioning rather than adding a second status owner.

- [ ] **Step 2: Replace the existing broad wave with the approved narrow, continuous highlighter**

```css
.msg-streaming-status {
  display: block;
  width: max-content;
  margin-top: calc(8px * var(--ui-scale));
  background-size: 360% 100%;
  animation: msg-terminal-activity-wave calc(5.6s * var(--ui-scale)) linear infinite;
}
```

Use a concentrated accent peak with short softened stops and `prefers-reduced-motion` static fallback.

- [ ] **Step 3: Verify non-UI compilation**

Run: `bun run typecheck`

Expected: TypeScript completes without diagnostics.

### Task 2: Make the active tool itself the sole execution feedback

**Files:**
- Modify: `packages/overlay/src/components/CardParts.tsx:148-204`
- Modify: `packages/overlay/src/components/InlineToolPart.tsx:345-367`
- Modify: `packages/overlay/src/styles/surfaces/messages.css:90-128`

**Consumes:** Existing `describeCurrentToolPart` and `InlineToolPart.status()`.

**Produces:** No standalone “正在执行” tool label; only active running/pending tool identity receives the focused wave.

- [ ] **Step 1: Remove the right-side execution text from `ExecutionDisclosureRun`**

Delete the `msg-work-details__status` `Show`. Keep `data-status={currentTool()?.status}` because it binds the existing summary to its own actual tool state.

- [ ] **Step 2: Cover both running and pending tool identities**

Keep `data-status={status()}` on regular tool rows. Extend the existing active selector to target tool icon/name/detail for `running` and `pending`, and disclosure icon/name/detail for the same statuses. Do not target any parent card header or status label.

- [ ] **Step 3: Use the shared narrow wave declaration**

Use the same `msg-terminal-activity-wave` keyframes and gradient token as Task 1, avoiding separate timing or flashing animation.

- [ ] **Step 4: Verify non-UI compilation**

Run: `bun run typecheck`

Expected: TypeScript completes without diagnostics.

### Task 3: Render generic tool payloads as structured bounded data

**Files:**
- Modify: `packages/overlay/src/components/InlineToolPart.tsx:337-435`
- Modify: `packages/overlay/src/styles/surfaces/messages.css:129-145,2176-2204`

**Consumes:** Existing `output()`, `raw()`, status, and specialized body decisions.

**Produces:** Generic tool payloads are raw preformatted text under explicit input/output labels; they never pass through `StaticTextPart`.

- [ ] **Step 1: Add a local generic payload renderer in `InlineToolPart`**

```tsx
function ToolPayload(props: { label: string; value: string; live?: boolean }) {
  return (
    <section class="msg-tool-payload" data-live={props.live ? "true" : undefined}>
      <div class="msg-tool-payload__label">{props.label}</div>
      <pre class="msg-tool-payload__content">{props.value}</pre>
    </section>
  )
}
```

Use it only for generic `raw()` on running/pending tools and `output()` where `showPlainOutput()` is true. Do not replace code, diff, todo, browser evidence, read, command, attachment, or error-specific renderers.

- [ ] **Step 2: Replace generic `StaticTextPart` output**

Replace the `msg-tool-output` + `StaticTextPart` branch with `<ToolPayload label="输出" value={output()} />`. Render live raw tool content as `<ToolPayload label="输入" value={raw()} live />`.

- [ ] **Step 3: Bound and preserve payload layout**

Give `.msg-tool-payload__content` a fixed max-height, `overflow:auto`, `white-space:pre`, and monospace styling. The wrapper owns spacing; remove conflicting generic output Markdown rules when no longer used.

- [ ] **Step 4: Verify non-UI compilation**

Run: `bun run typecheck`

Expected: TypeScript completes without diagnostics.

### Task 4: Visual acceptance and delivery

**Files:**
- Modify: `specs/records/2026-08/2026-08-03-streaming-conversation-terminal-activity-design.md`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Consumes:** Tasks 1–3 and the approved mock.

**Produces:** A buildable Overlay and a factual record of manual visual verification.

- [ ] **Step 1: Run the installed Overlay in a real client state with a streaming text and running tool**

Inspect both normal and expanded tool disclosure. Confirm: exactly one terminal activity cue per owning stream; no standalone “正在执行”; final `正在生成` line; no overlapping payload text; bounded payload scroll; reduced-motion fallback is static.

- [ ] **Step 2: Capture and review a real screenshot**

Use the live application surface, not the mock or an automated visual test. Correct any visual mismatch before continuing.

- [ ] **Step 3: Run repository checks**

Run: `bun run typecheck`

Run: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

Expected: both pass.

- [ ] **Step 4: Update records, commit and push**

Commit subject: `dsw-33987 implement terminal conversation activity feedback`

Push the current branch to `myhexin` without bypassing hooks.

## Self-review

- Spec coverage: Tasks 1–2 implement all user-wait visibility rules; Task 3 addresses the observed JSON overlap directly; Task 4 provides the required real-client visual review.
- Placeholder scan: no TBD/TODO or deferred implementation wording remains.
- Type consistency: implementation uses existing `status()`, `raw()`, `output()`, `describeCurrentToolPart`, and CSS selectors; it introduces only a local `ToolPayload` component.
