# Session First Message Title - 2026-06-25

## Requirement

Coding Assistant and Mission records must use the first user message text as
their session title instead of keeping the product placeholder titles
`Coding assistant` and `Mission Control`.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-06-11-coding-assistant-session-history.md` | Coding Assistant history is backed by canonical `Session` rows; title updates must use `Session.setTitle`. |
| `2026-06-01-mission-panel-mission-list.md` | Mission records are `kind="mission"` sessions; Mission list titles come from the session row. |
| `session/prompt/title.ts` | LLM-generated titles only apply to generic `New session - ...` defaults, not product placeholder titles. |
| `engine/helpers.ts::deriveTitle` | Generic task title derivation already defines the first-message/request title display rule. |

## Call-Point Sweep

Command:

```powershell
rg -n "Coding assistant|Mission Control|deriveTitle|SessionWake\.wake|prompt_async|SessionPrompt\.prompt|Session\.setTitle|createUserMessage" packages/opencorvus/src packages/opencorvus/test specs/new-arch -S -g "*.ts" -g "*.md"
```

| Surface | Evidence | Decision |
| --- | --- | --- |
| Coding session creation | `server/routes/coding.ts` creates right-sidebar sessions with title `Coding assistant`. | Keep this as the pre-message placeholder only. |
| Coding first user message | `/session/:sessionID/prompt_async` persists the visible user message through `SessionPrompt.createUserMessage`. | After the first user message is persisted, replace the placeholder title with that text. |
| Mission session creation | `mission/session.ts::ensureMissionSession` creates `kind="mission"` sessions with title `Mission Control`. | Keep this as the pre-message placeholder only. |
| Mission first user message | `SessionWake.wake` persists the Mission operator text as a normal user message. | After the first wake message is persisted, replace the placeholder title with that text. |
| Manual rename | `/coding/session/:id` and `/mission/:id/title` already call `Session.setTitle`. | Do not overwrite any non-placeholder title. |
| Task title mechanism | `EngineService.createTask` resolves generic task titles with `deriveTitle(request)` when no explicit `input.title` exists. Mission-created tasks still require `create_task.title` and get a host `Phase xx:` prefix. | Reuse the same `deriveTitle` implementation for Coding Assistant and Mission Control session titles once their first user message is persisted. Lifecycle differs, title derivation must not. |

## Contract

- Only sessions still titled with the known product placeholders are eligible.
- The title source is the first persisted user text part passed through the
  same `deriveTitle` function used by generic task creation: first non-empty
  line, 80-character display cap, `Untitled task` for blank text.
- Later messages do not rename the session.
- User-renamed sessions do not get overwritten.
- Non-text first messages do not synthesize a title.

## Acceptance

- A new right-sidebar Coding Assistant session becomes titled from its first
  `prompt_async` text.
- A manually renamed right-sidebar Coding Assistant session keeps the manual
  title after its first prompt.
- A new Mission session becomes titled from its first `SessionWake` operator
  text.
- A Mission session keeps that first-message title after later wakes.
