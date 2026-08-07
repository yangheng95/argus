# Tool Call Single-Line Authority Repair

## Recall

### User requirement

- The user's tool-call design was also discarded during the merge/revert sequence.
- The user-authoritative behavior is that a tool call contracts to one header line; the tool name, duration, and parameter/result summary must not wrap into a second line.
- The composer typography must also be unified because some text inside the input surface is visibly larger than its neighbouring controls.

### Acceptance criteria

- Restore the exact single-line tool-header rules preserved in commit `f111df9f44`: `nowrap` title row, fixed tool name, flexible summary, and ellipsis overflow.
- Apply the same one-line summary contract to collapsed and expanded tool headers; expansion reveals the real tool body but does not turn the header into a multi-line block.
- Preserve the current shared `Card`, `CardHeader`, `CardDurationChip`, Kobalte timing tooltip, and tool body renderer. Do not introduce another tool-call surface.
- A long real tool summary remains on the same visual line as the tool name and duration, has a one-line header height, and reports clipped overflow through the rendered geometry.
- Use one composer-owned font-size token for the editable text/placeholder, Chat intent, model value, `+` menu item labels, parallelism value, and parallelism panel heading. Secondary metadata and explanatory copy retain the existing smaller metadata tier.
- Assert the primary composer text surfaces resolve to the same computed pixel size in the real rendered composer, including the open `+` menu, and inspect a browser screenshot with that menu open.
- Add static regression coverage and a Node-started browser screenshot, then inspect the screenshot personally.
- Run focused tests, Overlay typecheck, i18n/document health, final diff review, commit with `dsw-33987`, merge current `myhexin/v0.0.3beta`, and push.

### Hard constraints

- No fallback, compatibility selector, duplicated renderer, query override, iframe, or restart of the user's running OpenCorvus/Overlay.
- Browser validation uses the isolated existing Vite fixture and Node-started Playwright on Windows.
- Preserve unrelated concurrent backend, spec, and dashboard work in the shared worktree.

### Hard-disk sources read before implementation

- `specs/records/2026-07/2026-07-09-overlay-codex-full-style-parity.md`
- `specs/records/2026-07/2026-07-14-overlay-tool-call-timing-tooltip.md`
- `specs/records/2026-07/2026-07-09-composer-height-font-adjustment.md`
- `packages/overlay/src/components/CardHeader.tsx`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/test/card-header-title.test.ts`
- `packages/overlay/test/browser/message-part-chronology-browser.test.ts`
- `packages/overlay/test/browser/fixtures/message-part-chronology/main.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/styles/tokens/design-language.css`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ExecutorSelector.tsx`
- `packages/overlay/test/workspace-composer-density.test.ts`
- `packages/overlay/test/browser/chat-composer-resize-browser.test.ts`

### Merge evidence

- Commit `f111df9f44` contains the user's explicit regression named `tool headers keep the parameter summary in the title row and ellipsize it`.
- Its CSS uses `flex-wrap: nowrap`, `white-space: nowrap`, `overflow: hidden`, and `text-overflow: ellipsis` for both the normal and expanded tool header.
- Revert `a4dd6e0534` introduced the current `wrap`, `white-space: normal`, `overflow: visible`, and `overflow-wrap: anywhere` rules. `git blame` binds every multi-line override to that revert.
- The current shared component and timing-tooltip ownership are otherwise correct. This repair restores the user-owned CSS contract rather than reverting the component tree.
- Composer source and history inspection found four primary-text tiers in one surface: the textarea/placeholder uses `--ui-font-title` (15px), intent/model and ordinary buttons use `--ui-font-control` (14px), `+` menu labels use `--ui-font-body` (14px), and the parallelism value uses `--ui-font-small` (12px).
- Commit `8a4b3c3b0c` deliberately enlarged only the textarea from the shared 14px body tier to the 15px title tier. The user's newer unification requirement supersedes that local size exception; it does not authorize changing global typography tokens.
- `--ui-font-body` and `--ui-font-control` currently resolve to the same 14px scale, but the composer must reference one semantic composer token rather than depend on two global tokens merely having the same current value.
- The first isolated Tool fixture rerun exposed its fixed 15-second post-navigation selector timeout while Vite was still transforming dependencies. The fixture readiness wait must measure 15 seconds of actual page inactivity, resetting on request/response/failure activity, so a cold transform is not misreported as a product failure.
- The cold transform fan-out came from the Solid export condition serving `lucide-solid`'s source barrel as more than a thousand browser module requests. The package rejects Vite dependency prebundling under that condition, so the fixture resolves the same package's official ESM (ECMAScript Module) entry through `import.meta.resolve`; this keeps the real icon component and produces one bundled dependency module without a hard-coded install path.
- After the assertions, the browser page navigates to `about:blank` before teardown so the Vite document has no live late request when the browser-side error collector closes. The fixture server remains alive until browser cleanup finishes.

### Full-repository grep and call-site decisions

Searches covered `ToolPart`, `InlineToolPart`, `Card`, `CardHeader`, tool timing, collapsed cards, tool title/subtitle rules, and browser screenshots across `packages/overlay/src`, `packages/overlay/test`, and July records.

| Surface | Decision |
| --- | --- |
| `CardHeader.tsx` | Keep unchanged; it already renders tool name, duration, and summary in one canonical title row. |
| `card.css` | Restore the exact user-owned one-line geometry for tool title rows and summaries. |
| `card-header-title.test.ts` | Restore the deleted static regression that rejects wrapping. |
| Message chronology fixture | Use a deliberately long real tool output summary so browser geometry proves ellipsis instead of relying on source text alone. |
| Message chronology browser test | Assert title, duration, and summary share one vertical center line; assert one-line height and horizontal clipping; capture the collapsed tool row. |
| Message chronology fixture readiness | Replace the fixed selector deadline with a real no-activity timeout driven by browser request/response activity. |
| Message chronology Vite config | Resolve `lucide-solid` to its official ESM bundle for this isolated fixture; do not stub, duplicate, or replace the real icon component. |
| Tool timing tooltip | Preserve unchanged; hover/focus remains attached to the same single header button. |
| `.chat-composer-stack` | Add the single primary composer font-size source, routed to the existing control tier. |
| Textarea and floating placeholder | Replace the title-tier exception with the composer font-size source. |
| Intent and model values | Route their existing 14px control size through the same composer source. |
| `+` menu labels and parallelism panel heading/value | Replace body/small divergence with the same composer source; retain metadata sizing for loader counts and explanatory paragraphs. |
| Composer browser test | Read computed font sizes from the real textarea, selectors, open menu, and parallelism value; require equality and save an open-menu screenshot. |

### Independent-agent feedback

- No sub-agent was started because the user did not request delegation and current collaboration policy forbids unrequested sub-agents.

## Implementation plan

1. Restore the exact CSS and static regression from the preserved user lineage.
2. Strengthen the existing real component fixture with a long summary and geometric single-line assertions.
3. Introduce one composer primary-font token and route every primary text surface through it, without changing secondary metadata hierarchy.
4. Add computed-style browser coverage and an open-menu screenshot for composer typography.
5. Run focused unit/browser tests, inspect the screenshots, run typecheck and document checks, review the diff, then commit and push.

## Verification

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed.
- Focused Tool/composer unit coverage passed: 42 tests and 394 assertions across the six selected files.
- The Node-started composer browser test passed and proved the textarea, Chat intent, model value, `+` menu item, parallelism value, and parallelism heading resolve to one computed font size.
- The Node-started message chronology browser test passed after the fixture tool repair; the Tool row is one line, its summary has real clipped overflow, its title/duration/summary centers align, and timing tooltip behavior remains valid.
- Personally inspected `.scratch/composer-plus-runtime-menu.png`, `.scratch/composer-parallelism-slider.png`, and `.scratch/tool-call-single-line.png`. The composer primary copy is visually coherent and the Tool call occupies exactly one ellipsized row.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed.
- The focused monthly README tracking check passed after the concurrent message-transcript record was committed independently. This task's staged snapshot adds only the Tool record and its matching README link on top of that new HEAD.
