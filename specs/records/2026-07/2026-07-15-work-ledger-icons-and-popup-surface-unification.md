# Work Ledger Icons and Popup Surface Unification

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request                     | Replace the Chat, Mission, and Task icons; replace every pin action with the angled pushpin shown in the supplied reference; make popup surfaces use the command-search visual language; make command search dismiss when the user clicks outside it; remove the four exposed outer corners shown around the Environment information popup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Acceptance criteria              | Chat, Mission, and Task rows use three clearer and distinct Lucide glyphs; every project/row pin action uses one angled pin identity; the shared Dialog shell plus the Environment, Executor, and Brand Guide Kobalte popovers consume the existing focused-popup surface tokens; focused popups render without exposed rounded-corner cutouts; clicking outside command search closes it and returns focus to its trigger; real browser screenshots are inspected for the Work Ledger, command search, and Environment popup.                                                                                                                                                                                                                                                                                                                                                                            |
| Hard constraints                 | Use existing Lucide, Kobalte, Button, Icon, Dialog, and focused-popup primitives; do not add a second popup implementation or a hand-drawn icon; no compatibility/fallback path; preserve the natural entity and dialog state owners; do not restart or refresh a running OpenCorvus/overlay process; use Node, not Bun, for Playwright; add regression tests; commit subjects start with `dsw-33987`; push the current delivery branch to the legacy remote URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Sources read                     | `AGENTS.md`; both original icon screenshots and the Environment popup follow-up screenshot; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-08-project-directory-new-chat-icon.md`; `specs/records/2026-07/2026-07-15-codex-sidebar-search-environment-parity.md`; `specs/records/2026-06/2026-06-18-command-palette-dialog-primitive.md`; `ProjectLedgerGroup.tsx`; `WorkLedger.tsx`; `Icon.tsx`; `Dialog.tsx`; `CommandPalette.tsx`; focused surface CSS and browser tests.                                                                                                                                                                                                                                                                                                                                                                                        |
| Whole-repository search evidence | `WorkLedger.kindIcon` is the single Chat/Mission/Task row glyph projection. Pin callers are `ProjectLedgerGroup.tsx` plus two `WorkLedger.tsx` call sites. `Dialog.tsx` is the sole Kobalte Dialog owner and is used by App, Command Palette, Config, Goal, Image Preview, Interaction, Log Viewer, Session, and Channels surfaces. Direct Kobalte Popover content owners are `TaskDirBar.tsx` (`project-runtime-status-panel`), `ExecutorSelector.tsx` (`executor-popover`), and `TitlebarBrandGuide.tsx` (`brand-guide-card`). The command palette already opts into `backdropClose` through the Dialog default but lacked a browser assertion for pointer dismissal. Existing focused-popup tokens are defined only in `styles/tokens/design-language.css`; Command Palette and Interaction Dialog already consumed them while the base Dialog and three Popovers still carried parallel surface values. |
| Independent agent feedback       | None. The user did not request sub-agents, and this task has one shared Icon owner, one shared Dialog owner, three enumerated Popover owners, and focused browser fixtures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Diagnosis

The ugly entity icons are not three independent list implementations: `WorkLedger.kindIcon` selects all three from the shared `Icon` registry. The current selections reuse a plain message square, workflow graph, and checklist, which match the user's screenshot and are visually weak at the rendered 13-pixel size.

Pin identity is split across project groups and Work Ledger surfaces, but every call already goes through the same Icon primitive. A semantic `pin-tilted` registry entry can therefore keep the mature Lucide pin path while applying the reference's angled orientation once.

Popup styling is genuinely multi-source. Command search and the Interaction dialog use `--ui-focused-popup-*`; the base Dialog and each Kobalte Popover repeat separate radius, border, background, and shadow values. The large radius creates the four visible background cutouts in the supplied Environment screenshot. The correct root repair is to make focused-popup tokens authoritative for these shells and set the shared outer radius to zero, not to paint over four individual corners.

Command search already delegates outside interaction to Kobalte through the Dialog primitive. The missing requirement is an observable regression test proving pointer dismissal and focus restoration; no new click listener is needed.

## Implementation plan

1. Extend the Icon registry with compact semantic Chat, Mission, Task, and angled Pin identities, then replace every enumerated Work Ledger/project pin call site.
2. Make the focused-popup tokens the single border/radius/shadow contract for the base Dialog and the Environment, Executor, and Brand Guide popovers; remove their parallel shell values and the Brand Guide arrow that recreates an external corner ornament.
3. Extend source tests for the exact icon and surface projections and extend the Node-run Command Palette browser test for outside-click dismissal plus trigger focus restoration.
4. Run focused unit tests, Overlay typecheck/i18n/build, docs health, Node browser fixtures, inspect the resulting screenshots, correct visual mismatches, and perform a second diff review before commit and push.

## Verification plan

```powershell
bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/flat-redesign-icon-coverage.test.ts packages/overlay/test/dialog-primitive.test.ts packages/overlay/test/command-palette-primitive.test.ts packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/executor-popover-css.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/command-palette.test.ts packages/overlay/test/browser/task-dirbar-keyboard.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build:vite
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation result

- `WorkLedger.kindIcon` now maps Chat to `MessageCircleMore`, Mission to `FlagTriangleRight`, and Task to `CircleCheckBig`. The shared Icon registry owns those semantic names.
- Project, Mission/Chat row, and pinned-project actions use one `pin-tilted` icon identity. The Lucide pin is rotated and geometry-scaled once in shared CSS, preserving the existing 12-pixel action footprint.
- Base Dialog, Command Search, Environment information, Executor selection, Interaction, and Brand Guide shells consume the existing focused-popup border, background, radius, and shadow authority. The authoritative outer radius is `0px`, and the Brand Guide's detached arrow ornament is gone.
- The full-viewport Dialog content, not each feature surface, now owns background pointer dismissal. It respects `backdropClose=false`, ignores non-primary and child-target pointer events, prevents the background click from stealing focus, closes through the existing dialog callback, and lets Kobalte restore focus.

## Verification results

| Check | Result |
| --- | --- |
| Focused Overlay source tests | Pass: 52 tests, 0 failures, 2715 expectations. |
| Overlay TypeScript and i18n | Pass. |
| Command Palette Node browser fixture | Pass, including real outside pointer dismissal, focus restoration, Escape dismissal, keyboard shortcuts, and screenshot generation. One earlier rerun observed a non-repeatable aborted work-ledger refresh during fixture teardown; the immediate identical rerun passed without adding an error whitelist. |
| TaskDirBar Node browser fixture | Pass: Environment popup layout, zero outer radius, outside/Escape dismissal, focus path, Right Dock coexistence, and worktree action/error paths. |
| Vite production build | Pass as part of the Node browser runner; only the existing large-chunk warning remains. |
| Historical docs links and product docs single source | Pass: 24 tests, 0 failures. |
| `git diff --check` | Pass. |

## Visual review

- `.scratch/overlay-sidebar-project-actions.png` shows the new speech-circle Chat mark, circled-check Task mark, flag Mission mark, and a compact angled project pin aligned inside the existing 18-pixel action rail.
- `.scratch/command-palette-dialog-primitive.png` shows Command Search using the cornerless focused-popup frame without exposed outer corner regions.
- `.scratch/task-dirbar-runtime-status-panel-merged.png` shows Environment information using the same border/background/shadow contract and a square outer edge; the four exposed corner cutouts from the supplied screenshot are absent.

## Second review

The diff keeps entity identity in `kindIcon`, glyph rendering in `Icon`, dialog behavior in `Dialog`, and surface styling in the existing focused-popup tokens. It does not introduce a second dialog, popover, click-listener service, or hand-authored SVG. The browser failures found during implementation were corrected at the shared geometry and Dialog ownership boundaries, then rerun through the original checkers.

## 2026-07-16 user-directed rounded-corner update

### Recall

| Item | Detail |
| --- | --- |
| User request | “所有的弹框需要添加下圆角”，并提供了当前 Command Palette 方角截图。 |
| Acceptance criteria | 所有共享 focused-popup shell 使用现有设计系统圆角；Command Palette、普通 Dialog、Interaction Dialog、Executor popover、conversation popup 与 titlebar popup 不再呈现方角；弹层内容仍由各自现有 overflow/background 边界裁切；桌面真实页面截图通过人工视觉检查。 |
| Hard constraints | 只修改共享弹层设计 token，不逐组件复制圆角；复用现有 `--oc-radius-large`；不引入 fallback、兼容路径或第二套 popup 样式；不创建移动端范围；不重启、刷新或关闭用户正在运行的 OpenCorvus/overlay；Playwright 只能由 Node 启动；保留现有未提交改动。 |
| Sources read | `AGENTS.md`; Browser control skill; supplied screenshot; this record; `styles/tokens/design-language.css`; `styles/surfaces/{dialog,cmdk,card,composer,conversation,titlebar}.css`; `components/primitives/Dialog.tsx`; `components/CommandPalette.tsx`; `test/focused-popup-surface.test.ts`; specs indexes. |
| Whole-repository grep evidence | `--ui-focused-popup-radius` has one definition in `design-language.css`. Its six CSS consumers are base Dialog (`dialog.css`), Command Palette (`cmdk.css`), Interaction Dialog (`card.css`), Executor popover (`composer.css`), conversation popup (`conversation.css`), and titlebar popup (`titlebar.css`). Direct Dialog callers remain App, Command Palette, Config, Goal, Image Preview, Interaction, Log Viewer, Session, and Channels. |
| Independent agent feedback | Not requested; no sub-agent was spawned. Main-agent source review, focused tests, production build, in-app browser screenshots, and final diff review were used. |

The user request supersedes this record's earlier square-corner visual decision without changing the single-source architecture. `--ui-focused-popup-radius` now resolves to the existing `--oc-radius-large` token; no consumer carries a component-local radius. The regression now enumerates all six CSS consumers instead of sampling four.

Focused popup/Dialog tests passed 30/30, Overlay TypeScript passed, production Vite build passed, and panel i18n passed. The global radius-discipline test still reports 15 unrelated existing callsites in the dirty worktree, while this change's shared-radius regression passes. The existing Command Palette browser fixture is also blocked before popup interaction by an unrelated current home-layout expectation (`noticePresent=false`).

An isolated Node-served production preview was opened in the in-app browser without refreshing the user's running Overlay. Command Palette rendered with computed `border-radius: 8px`, `overflow: hidden`, an opaque background, and continuous four-corner clipping; the titlebar File menu independently rendered with `border-radius: 8px`. Both full screenshots were personally inspected, including the lower corners, with no background leakage, clipping, or broken border/shadow. The isolated preview was then stopped.
