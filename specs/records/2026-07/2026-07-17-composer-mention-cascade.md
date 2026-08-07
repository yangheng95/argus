# Composer Mention Placeholder and Cascading Menu

## Recall

### User request

- Put `@skill` and `@squad` in the Composer placeholder.
- Make the mention picker an automatically expanded second-level menu instead of requiring Enter to transition from the category list to the entity list.

### Acceptance criteria

- Every enabled default Composer placeholder visibly starts with both `@skill` and `@squad`; rotating task examples remain secondary guidance.
- Typing `@` opens the category list and automatically opens the selected category's current-scope entity list beside it.
- Moving or hovering the selected category immediately changes the open entity list without mutating the textarea.
- Enter or Tab while the category cascade is open selects an entity directly; it never inserts the intermediate `@skill ` or `@squad ` text as a navigation step.
- Direct filtered entry such as `@skill open` and `@squad front` keeps the existing single-list completion behavior.
- The cascade uses the existing Resolver catalog, Kobalte-backed Listbox primitive, mention grammar, exact visible directives, bounded results, atomic editing, Mission routing, and shared Composer visual tokens; no second catalog, hidden state, or remote request is introduced.
- Focused unit/UI tests, Overlay typecheck/build, Node-started headed browser interaction, screenshot inspection, documentation health, `git diff --check`, and second review pass succeed.
- The user's running OpenCorvus/Overlay process is not restarted, refreshed, closed, or used as the test target.

### Hard constraints

- Root `AGENTS.md` applies: fix the root interaction model, preserve one source, add regression tests, use real screenshot review for frontend work, avoid fallback/gates/state machines, and push task commits to `myhexin` with `dsw-33987` subjects.
- Existing unrelated tracked and untracked worktree changes remain untouched and are excluded from this task's commits.
- Playwright is started by Node, never Bun.

### Hard-disk sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-15-composer-skill-squad-mentions.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ComposerMentionMenu.tsx`
- `packages/overlay/src/services/composer-mention.ts`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/i18n/{en-US,zh-CN}.json`
- `packages/overlay/test/{composer-mention,composer-mention-ui}.test.ts`
- `packages/overlay/test/browser/composer-mention-browser.test.ts`

### Whole-repository grep result

- `rg -n "Composer entity mention|composer mention|entity mention|@skill|@squad" specs/records/2026-07 specs/current packages/overlay/src packages/overlay/test`
- The 44 matching call sites are confined to the original mention record, the pure mention service and tests, `ChatComposer`, `ComposerMentionMenu`, Composer CSS/i18n, and the real browser fixture. Runtime directive parsing and Mission/Skill semantics do not need to change.
- `ChatComposer` currently converts category selection into intermediate text through `applyComposerMentionOption`; the parser then interprets that text as a new entity-stage query. This direct trigger explains the Enter-required transition.
- `ComposerMentionMenu` currently renders one Listbox only and reports category selection through the same callback as entity selection. It is the correct visual boundary for the cascading second panel.
- `composerMentionOptions` already returns the exact bounded entity rows needed by an automatically expanded child panel, so it remains the one ranking source.

### Independent-agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids spawning one otherwise.

### Baseline evidence

- `v0.0.8beta` and `myhexin/v0.0.8beta` are aligned (`0 0`) after fetch.
- The worktree contains unrelated in-progress conversation styling, browser tests, frontend-replica fixture files, and packaged artifacts. They are preserved and will not be staged.

## Root design

Keep parsing, ranking, and exact directive serialization unchanged. For a category-stage query, `ChatComposer` derives the selected category from its existing highlight and asks the existing `composerMentionOptions` function for that category's entities. `ComposerMentionMenu` renders those rows as a sibling child Listbox and changes the selected parent on pointer movement. Category selection no longer writes intermediate query text. Keyboard confirmation resolves the selected category to the first visible child entity and inserts the final exact directive in one operation.

The placeholder keeps the existing rotating project examples but prefixes them with one localized, stable `@skill / @squad` hint so both entry points remain visible in every rotation.

## Implementation plan

1. Extend `ChatComposer` with derived cascading entity options and direct child confirmation while preserving direct entity-query behavior.
2. Extend `ComposerMentionMenu` and token-based CSS with an automatically visible child Listbox, pointer-driven parent switching, and accessible list labels.
3. Add bilingual placeholder/cascade copy and focused unit/UI/browser assertions that the intermediate text transition no longer occurs.
4. Run the focused test/build/browser screenshot loop, inspect and correct the rendered desktop cascade, then run docs health and a second diff review.
5. Commit only task-owned files with the required subject prefix and push `v0.0.8beta` to `myhexin` without bypassing hooks.

## Progress

- [x] Read prior design and inventory all call sites.
- [x] Record root cause, design, acceptance, and worktree boundary.
- [x] Implement the placeholder and cascading menu.
- [x] Complete automated and visual verification.
- [x] Complete second review, commit, and git-cc push.

## Verification evidence

- Focused mention service/UI tests: 20 passed, 0 failed, including the query-boundary regression at the left edge of an exact directive.
- Overlay i18n health, package TypeScript check, Vite production build, repository-wide 12-package typecheck, API route inventory, and generated API documentation checks passed.
- Historical documentation links and product-document single-source tests: 25 passed, 0 failed.
- The Node-started headed browser test passed at 1440×900. It proves the placeholder begins with both entry points, `@` exposes both controlled Listboxes, pointer hover and keyboard category movement replace the child rows without changing the textarea, keyboard confirmation writes the final exact Squad directive in one operation, direct filtered completion still works, atomic caret/deletion still works, typing performs no extra catalog/mount requests, and Mission wake receives the exact `frontend-replica` manifest identity.
- Inspected `.scratch/composer-mentions/placeholder-light.png`, `category-light.png`, and `squad-dark.png`. The placeholder prefix is legible before the rotating example; the category and entity panels are visibly adjacent, aligned, unclipped, and use the existing light-theme popover/listbox material; direct filtered completion remains visually coherent in the dark theme.
- Second review found and repaired the caret-boundary collision: at caret position zero, `findComposerMentionQuery` previously treated the `@` at the beginning of a completed directive as an active empty query. That allowed the new cascade Arrow Right handler to preempt atomic directive navigation. The parser now rejects a query unless the caret is after `@`, and a pure regression assertion covers the boundary.
- Commit `70029f288` (`dsw-33987 add cascading composer mentions`) passed the full pre-push typecheck, API route, generated documentation, i18n, and secret-scan hook and was delivered to `myhexin/v0.0.8beta`.
