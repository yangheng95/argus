# Empty-home layout state ownership repair

## Recall

### User requirement

- Repair the intermittent empty-home layout shown in `codex-clipboard-a4972615-9973-4901-aad0-b22260dcab9d.png`.
- The visible failure shows the ordinary `New Chat` header while the empty-home title, composer, context notice, and three suggestion cards are simultaneously rendered below the full-height conversation frame, clipping the cards at the window bottom.

### Acceptance criteria

- Empty-home content and its centered layout activate from one Solid-owned boolean in the same render tree; there is no frame where home content renders while its home layout selector is false.
- The home title, real composer, context notice, and three existing suggestion cards remain one centered composition and stay within the desktop workspace at 1440×900 and the supplied approximately 1920×1050 window geometry.
- The normal Chat header is hidden exactly when the empty-home composition is rendered and visible for populated conversation/task states.
- Existing three-card visuals, composer instance, translations, project/session context, suggestion actions, and mission launcher behavior remain unchanged.
- Node-launched browser interaction and screenshot evidence cover the reported hybrid state, viewport containment, state exit, and state re-entry without touching the user's running Overlay.

### Hard constraints

- Desktop-only repair; no responsive/mobile expansion.
- Do not add a ResizeObserver, timer, DOM-derived layout signal, fallback layout, duplicate composer, duplicate home state, or host gate.
- Preserve unrelated dirty backend session/protocol changes in the shared worktree.
- Do not restart, refresh, close, or otherwise intervene in the user's running OpenCorvus/Overlay process.
- New commits use the `dsw-33987` prefix and push to the configured legacy remote.

### Sources read

- `packages/overlay/src/{main.tsx,components/App.tsx,components/Conversation.tsx}`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/test/{conversation-empty-state-source,mission-launcher-component,connection-badge-primitive}.test.ts`
- `packages/overlay/test/browser/{command-palette,project-directory-new-chat-browser}.test.ts`
- `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`, especially Rounds 22 and 31
- `specs/records/2026-07/2026-07-15-composer-budget-hover-and-home-cards-authority.md`

### Whole-repository search evidence

| Owner / call site                                                                  | Decision                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx` `launcherHomeActive()`                                                  | Keep as the sole content-state projection: Chat/Mission primary surface, no active task, and no top-level conversation card.                                         |
| `main.tsx` effect writing `document.body.dataset.emptyChatHome`                    | Delete. It is a post-render imperative projection that can lag the same reactive update that makes `Conversation` portal home content.                               |
| `App.tsx` `.chat` and `#chatHomeComposition`                                       | Add a reactive `homeActive` prop and bind the existing `data-empty-chat-home` selector directly to the owning Chat section. Do not add another mount or component.   |
| `Conversation.tsx` `!hasItems() && !taskContextID()` home Portal conditions        | Replace with the same `homeActive` prop used by App layout. Retain `hasItems()` for conversation/task/scroll behavior.                                               |
| `conversation.css` four `body[data-empty-chat-home]` selectors                     | Scope them to `.chat[data-empty-chat-home]`, the component that owns both the header and home mounts. Remove the global body dependency completely.                  |
| `command-palette.test.ts` body dataset assertions and geometry                     | Read the scoped Chat attribute, assert header/home mutual exclusion and composition containment, and exercise an exit/re-entry transition before screenshot capture. |
| `project-directory-new-chat-browser.test.ts` body dataset assertion                | Read the scoped Chat attribute while retaining the existing workspace/composition containment checks.                                                                |
| `conversation-empty-state-source.test.ts` and `mission-launcher-component.test.ts` | Replace imperative-body assertions with the single reactive prop/selector ownership contract.                                                                        |
| `connection-badge-primitive.test.ts`                                               | Update only its negative selector guard from the retired global body form to the scoped Chat form.                                                                   |

### Independent agent feedback

- None. The user did not request sub-agents; the affected state/layout path has one shared owner and one primary browser fixture.

## Root cause

The empty-home content and empty-home layout are driven by two different update mechanisms. `Conversation` reacts directly during Solid rendering and portals home content when the card tree is empty, while `main.tsx` writes a global body dataset from a later reactive effect. During a selection or hydration transition, the content can therefore render before the body attribute changes. In that hybrid frame, `.chat-home-composition` falls back to `display: contents`, so its nodes enter normal flow after the full-height conversation frame; the ordinary header remains visible and the lower cards are clipped exactly as shown. The screenshot's simultaneous `New Chat` header and home composition is direct evidence of this state split.

## Implementation plan

1. Pass `launcherHomeActive()` through `App` and `Conversation`, binding the scoped Chat attribute and Portal conditions to that one value.
2. Retire the global body write and rescope the existing CSS without changing card/composer geometry.
3. Update source and real-browser regressions, reproduce rapid exit/re-entry, inspect desktop screenshots, and run focused build/document checks before commit and push.

## Result

- `launcherHomeActive()` now drives both the `.chat[data-empty-chat-home]` layout selector and the two home content Portals through reactive props. The imperative global body projection was removed.
- The existing composition geometry and three suggestion cards were retained; only state ownership and selector scope changed.
- Source regressions cover the shared prop contract and reject reintroduction of the body dataset. Browser regressions read the scoped Chat attribute, assert header/home mutual exclusion and composition containment, and exercise Chat/expert-squad/theme/Chat transitions.
- Node-launched Playwright passed at 1440 x 900 and 1920 x 1050. Visual review of `.scratch/overlay-empty-home-composer-1440.png`, `.scratch/overlay-empty-home-composer-1920x1050.png`, and `.scratch/overlay-expert-squad-home-dark.png` confirmed centered content, hidden ordinary header, three fully visible cards, and no bottom clipping.
- The independent project-directory new-Chat browser path also passed with the composition bounded by the workspace.

## Follow-up: remove the ordinary Chat context notice

### Recall

- User requirement: remove the complete context-notice row highlighted beneath the composer in the supplied ordinary Chat home screenshot.
- Acceptance criteria: the ordinary Chat home renders the existing title, composer, and three suggestion cards without the context notice; the expert-squad Mission launcher retains its distinct context notice; both locale catalogs contain no dead ordinary-Chat notice keys; a Node-launched browser screenshot confirms the final desktop composition.
- Hard constraints: preserve the existing single-owner home layout, do not alter the three cards or Mission semantics, do not touch the user's running Overlay, and do not include unrelated dirty PTY/session/dialog changes in this delivery.
- Sources read: `Conversation.tsx`, both overlay locale catalogs, `conversation-empty-state-source.test.ts`, `mission-launcher-component.test.ts`, and this record's existing layout investigation.
- Whole-repository search: `chat.home_notice_*` has one render owner in `Conversation.tsx`, four locale entries per catalog, and two source-test assertions; `mission.launcher.home_notice_*` has the same render owner plus locale integrity assertions and must remain.
- Independent agent feedback: none; the user did not request sub-agents.

### Implementation plan

1. Render the existing notice only for `launcherMode === "mission"` and remove the unreachable ordinary-Chat notice branches.
2. Delete the four dead `chat.home_notice_*` keys from both locale catalogs and update source regressions to assert their absence while preserving Mission coverage.
3. Run focused unit/type checks, launch the isolated Node browser fixture, inspect a desktop screenshot, then commit and attempt the required legacy remote push.

### Result

- Ordinary Chat now omits the complete context-notice row; its four locale keys were removed from both catalogs rather than left as dead copy.
- The Mission launcher remains the sole owner of `.chat-home-notice` and retains its project/global context wording.
- Focused source/locale regressions pass, and the Node-launched `command-palette` browser test passes with explicit ordinary-Chat absence and Mission-presence assertions.
- Visual review of `.scratch/overlay-empty-home-composer-1440.png` confirms the three cards move directly beneath the composer with the highlighted sentence gone; `.scratch/overlay-expert-squad-home-light.png` confirms the Mission notice remains intact.
