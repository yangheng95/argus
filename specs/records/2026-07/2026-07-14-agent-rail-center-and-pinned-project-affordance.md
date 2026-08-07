# Agent Rail Vertical Center and Pinned Project Affordance

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 把 agent rail 放在消息区域左侧中心留白位置并垂直居中；Pinned 项目的图标必须区别于普通 Projects 项目，并且可以直接 unpin。 |
| Acceptance criteria | The existing single Conversation rail owner remains in the centered five-column message geometry; a short rail is vertically centered, while an overflowing rail remains scrollable; Pinned project rows use a pin glyph rather than the normal folder glyph; every pinned row exposes a visible keyboard-focusable unpin button backed by the existing canonical Project pin writer; real desktop screenshots are reviewed. |
| Hard constraints | No fallback, second rail owner, duplicate pin state, local shadow state, gate, mobile/tablet scope, handwritten interaction primitive, process restart/refresh, broad Git restore/reset, or new worktree. Preserve unrelated dirty work. Use Node for Playwright. Commit subjects start with `dsw-33987`; push only to `legacy-remote`. |
| Sources read | `AGENTS.md`; `specs/current/architecture/99-principles.md`; `2026-06-23-agent-rail-visibility-regression.md`; `2026-06-25-agent-rail-execution-ledger-source.md`; `2026-07-08-conversation-agent-history-left-rail.md`; `2026-07-13-overlay-shell-icon-and-message-axis-root-repair.md`; `2026-07-13-project-pin-unpin-and-icon-repair.md`; current `App.tsx`, `ConversationAgentRail.tsx`, `conversation.css`, `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `work-ledger.css`, services, i18n, and focused tests. |
| Whole-repository search evidence | `ConversationAgentRail` has one mounted owner in `App.tsx`; rail selectors are owned by `conversation.css`; production records come only from `conversationAgentStore`; Project pin writes flow through `setWorkLedgerProjectPinned` to canonical `project.time_pinned`; Pinned rows are derived only from `groups().filter(group.project?.pinned)`; normal project icons are `folder`/`folder-open`; the Pinned shortcut currently repeats `folder-open` and hides its unpin button until hover. |
| Independent agent feedback | None. The user did not request sub-agents and the active policy forbids spawning them otherwise. |

## Root cause and design

The rail host already occupies the correct left-center column of the accepted
five-column message geometry. The vertical-centering failure is inside the
scroll owner: `.conversation-agent-rail__lanes` grows to the rail height but
does not distribute spare block-axis space, so its stacks start at the top and
the outer rail's `justify-content: center` cannot move them. The lanes remain
the only scroll owner and use safe block-axis centering so overflow stays
reachable.

Project unpin persistence and mutation already exist. The remaining defect is
the affordance: the Pinned row repeats the normal expanded-folder glyph and
hides the unpin action until hover. Replace only the Pinned row's leading glyph
with the registry-owned pin icon and keep the existing `Button`-based unpin
action persistently visible. No second state or writer is introduced.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `components/App.tsx` | Keep the only rail mount and the accepted five-column DOM order unchanged. |
| `components/ConversationAgentRail.tsx` | Keep store projection, locate behavior, and the single lanes scroll owner unchanged. |
| `styles/surfaces/conversation.css` | Center short lane content on the block axis without breaking overflow scrolling. |
| `components/WorkLedger.tsx` | Use the central `pin` glyph for Pinned project identity; keep the existing canonical unpin callback. |
| `styles/surfaces/work-ledger.css` | Make the existing unpin button persistently visible and reserve its row space. |
| focused unit/browser tests | Pin exact rail centering, distinct icon identity, persistent unpin semantics, real interaction, and screenshot geometry. |

## Benchmark

- Input: an isolated desktop Overlay fixture with a short agent execution rail,
  one pinned Project, and one normal Project.
- Output: rail ticks centered vertically in the conversation viewport; the
  pinned item is visually distinct and unpins through the canonical Project
  request/reload path.
- Environment: current Windows host source, repository-pinned Vite/TypeScript,
  Node-driven Playwright on an isolated fixture port.
- Timeout: the browser runner's activity-reset inactivity timeout; no absolute
  timeout measured from process start.
- Pass criteria: focused unit tests, Overlay typecheck/build, real browser
  interaction, rail/pinned-row geometry assertions, task-scoped screenshots,
  manual visual review, spec health, diff review, selective commit, and
  `legacy-remote` push all pass.

## Progress

- [x] Recall current architecture and historical decisions.
- [x] Enumerate rail and Project pin/unpin call sites.
- [x] Implement focused layout and affordance repair.
- [x] Run focused and rendered benchmark.
- [x] Inspect screenshots and complete second review.
- [x] Selectively commit the verified task-owned hunks.
- [ ] Push the current branch to `legacy-remote` (blocked by the unrelated incomplete
  source-snapshot contract migration in the dirty worktree).

## Verification result

- PASS: 18 focused Conversation rail and Work Ledger unit tests.
- PASS: Overlay `tsc --noEmit`.
- PASS: production Vite build through the Node browser runner.
- PASS: `ledger-scrollbar-browser.test.ts`; the pinned glyph is a
  Lucide pin, unpin is visible before hover, and the canonical Project request
  sequence is `[false, true]`.
- PASS: `agent-compact-visual-stress.test.ts`; the short rail has no overflow,
  computed `justify-content: safe center`, and its content center differs from
  the lanes center by at most 1.5px. A first combined run detected one aborted
  `/log` request during browser close and failed correctly; an unchanged
  isolated rerun passed, followed by a second passing run after adding the
  exact centering assertion.
- PASS: `historical-docs-links.test.ts` and `git diff --check`.
- Visual review PASS:
  `packages/overlay/.scratch/agent-compact-visual-stress/00-agent-rail-focus.png`
  shows the tick cluster centered vertically in the full-height rail;
  `.scratch/work-ledger-scrollbar-visible.png` and
  `.scratch/work-ledger-project-unpin-hover.png` show the blue pin identity,
  ordinary folder identity, and persistent unpin control without clipping.
- `document-health.test.ts`: 71/73 passed. The two failures are pre-existing
  dirty-worktree conflicts outside this repair: the runtime model-schema test
  expects a removed `status` field, and the July index links seven other
  untracked records. This task's record will be selectively staged; unrelated
  records and model work are not claimed or modified.

## Second review

- The five-column rail/message/mirror geometry and single rail mount remain
  unchanged.
- `conversationAgentStore` remains the only execution-record source and the
  lanes remain the only rail scroll owner; no fallback scan or second DOM owner
  was introduced.
- Project pin state still comes only from `project.time_pinned` through
  `setWorkLedgerProjectPinned`; the UI adds no local pin state.
- Overflow behavior remains covered by the long-rail browser fixture, while
  the short-rail fixture now proves centering quantitatively.
- No dead or obsolete code was discovered in the touched scope.

## Agent hover surface/content separation — Recall

| Item | Detail |
| --- | --- |
| User requirement | hover 背景区域必须明显大于消息内容区域，或消息内容必须内收，不能让背景边界和消息卡片边界完全重合。 |
| Acceptance criteria | Agent bubble hover/focus 背景在 identity、正文和工具栏四周形成可见但紧凑的内边距；消息内容不再贴背景边；头像状态环完整；用户消息气泡与 transcript 宽度契约不改变；真实桌面截图经人工复核。 |
| Hard constraints | 复用已有 `--ui-card-padding-x/y` 设计 token，不新增手写 spacing 来源；保留 bubble 作为唯一 hover/focus surface，不增加 wrapper 或第二背景；不得改变 `.chat-scroll` ownership、CardNode、用户消息布局或运行中 Overlay；Node 浏览器验证。 |
| Sources recalled | 本记录全部 agent grouping/avatar addendum；用户 03:28:49 Mission 截图；当前 `ChatBubble.tsx`、`chat-bubble.css`、`conversation.css`、`chat-bubble.test.ts`、`agent-summary-card-browser.test.ts`。 |
| Whole-repository search evidence | Agent 顶层 identity、hover actions 与 body 都是 `.chat-bubble` 的直接子 surface；hover/focus 背景只由 `.chat-bubble` 绘制；基础 bubble 的 `padding: 0` 是背景与内容边界重合的直接原因；`--ui-card-padding-y`/`--ui-card-padding-x` 已是共享卡片内边距来源；用户消息另由 `.chat-bubble__body` 自己拥有 padding。 |
| Independent agent feedback | None. The user did not request sub-agents and the active policy forbids spawning them otherwise. |

### Surface separation root cause and design

当前 hover 背景虽然属于 bubble 外层，但 bubble 本身是零 padding，identity、
正文和 hover toolbar 因此与背景边界共线。问题不是背景颜色或圆角，而是
surface 与 content 没有空间层级。

保持 DOM 和宽度不变，只让 agent bubble 使用共享 card padding token。
背景继续由唯一的 `.chat-bubble` 绘制，内部消息内容自然内收；user bubble
继续由现有 body surface 控制，不受该规则影响。

### Surface separation verification result

- PASS: 7 focused ChatBubble/grouping tests, including the token-owned agent
  padding contract.
- PASS: Overlay TypeScript check completed without diagnostics.
- PASS: production Vite build and the Node
  `agent-summary-card-browser.test.ts` fixture.
- Visual review PASS:
  `packages/overlay/.scratch/agent-summary-card/agent-latest-tool-work-details.png`
  shows the hovered/focused background extending beyond the identity, body,
  disclosure, and nested tool content on every side; the toolbar stays inside
  the same outer surface and the avatar ring remains complete.
- The in-app browser rejected direct navigation to the local PNG under its URL
  security policy. No alternate URL or control mechanism was used to bypass
  that policy; the screenshot was inspected from the task-owned browser
  artifact on disk.

### Surface separation second review

- The background remains the existing `.chat-bubble`; no wrapper, pseudo
  background, duplicate hover owner, or width override was added.
- Padding uses the existing `--ui-card-padding-y/x` tokens, preserving the
  shared density system and scale behavior.
- The rule is agent-scoped. User message body padding and transcript width,
  scroll, virtualization, identity, and action ownership are unchanged.
- No dead or obsolete code was discovered in the touched scope.

## Push result

- Local commit: `e2d044e1cf` before this record-only amend; the amended commit
  retains the same `dsw-33987 center agent rail and clarify pinned projects`
  subject.
- Remote comparison before push: `legacy-remote/v0.0.3beta` was 0 commits ahead of
  local and local was 9 commits ahead of remote.
- Mandatory pre-push hook failed in the repository-wide `opencorvus:typecheck`
  before route/docs checks. The dirty source-snapshot migration has removed
  `sourcePackageAbsolute`, `sourcePackageRelative`,
  `webpageEvidenceAbsolute`, `webpageEvidenceRelative`, and
  `primaryWebpageEvidenceArtifacts` while consumers in browser-preview,
  frontend-design, orchestrator, project, and tool modules still require the
  retired contract; `LiveWebpageEvidenceResult` consumers also retain the old
  `worktreeDir` / `artifacts` / `url` / `evidenceDir` shape.
- Restoring the deleted fields would create the forbidden compatibility path.
  Completing that cross-cutting migration would overwrite unrelated user work
  outside this UI task. No hook bypass, GitHub push, reset, restore, stash, or
  extra worktree was used. The legacy remote remains unchanged.

## Agent message grouping follow-up — Recall

| Item | Detail |
| --- | --- |
| User requirement | 修复 agent 消息头像被裁剪；只在相邻的不同 agent 消息卡片之间增加低对比度细线；消息卡片 hover 时显示低对比度、简约的背景框。 |
| Acceptance criteria | A running avatar's complete outer status ring is visible; an adjacent agent-owner change renders exactly one divider while same-agent adjacency and user/agent adjacency do not; hovering or focusing an agent message reveals a theme-token-backed low-contrast surface without lift or shadow; a real desktop fixture containing user, repeated same-agent messages, and a different agent is inspected by screenshot. |
| Hard constraints | `CardNode.agentID` is the only agent identity source; do not infer identity from title, stage, role, card ID, or DOM text. Do not add a second transcript owner, fallback, compatibility selector, gate, mobile scope, handwritten color token, process restart/refresh, broad Git operation, or worktree. Preserve unrelated dirty edits and run Playwright through Node. |
| Sources read | `AGENTS.md`; this record; `2026-07-13-overlay-shell-icon-and-message-axis-root-repair.md`; current `Conversation.tsx`, `ChatBubble.tsx`, `Avatar.tsx`, `card-tree.ts`, `chat-bubble.css`, `conversation.css`, and the real `agent-compact-visual-stress` browser fixture. |
| Whole-repository search evidence | Top-level transcript rows are rendered only by `VirtualizedConversationItem`; bubble identity is rendered only by `ChatBubbleIdentity` through `Avatar`; the outer running ring is `.chat-avatar::after`; `.chat-bubble__identity-meta` is its clipping ancestor; `CardNode.agentID` is explicitly documented as the exact projected worker identity; existing row hover is deliberately transparent; `.conversation-virtual-item` is the single adjacency surface used by the virtualized transcript. |
| Independent agent feedback | None. The user did not request sub-agents and the active policy forbids spawning them otherwise. |

### Root cause and design

The icon glyph is not undersized or malformed. The running ring deliberately
extends two scaled pixels outside `.chat-avatar`, but its identity-row parent
clips all overflow. The title, status, duration, and timestamp already own
their individual nowrap/ellipsis behavior, so parent clipping is redundant and
is removed rather than compensated with a smaller icon.

The virtual transcript already owns adjacency. It will derive a set of
boundary card IDs from consecutive top-level `CardNode` records and mark only
the later row when both records are agent cards with non-empty, unequal
`agentID` values. CSS paints one divider from that semantic marker. The bubble
itself reuses the existing hover surface token and remains flat: no transform,
lift, or shadow.

### Call-site disposition

| Surface | Disposition |
| --- | --- |
| `Conversation.tsx` / `VirtualizedConversationItem` | Add the exact adjacent-agent predicate and project its result onto the later virtual row. Preserve Virtua as the only transcript renderer. |
| `chat-bubble.css` | Stop clipping the avatar's outer ring; add the flat hover/focus surface. |
| `conversation.css` | Draw one low-contrast divider only for the semantic boundary marker. |
| Focused unit test | Prove different exact `agentID` values create a boundary and missing IDs, same IDs, and non-agent neighbors do not. |
| `agent-compact-visual-stress.test.ts` | Measure the outer ring against the clipping ancestor, verify the sole agent transition marker, hover the target bubble, verify computed surface/radius/no-shadow, and capture task-scoped evidence. |

### Verification result

- PASS: focused grouping, ChatBubble, animation, role, and virtualization unit
  tests. The exact-identity test proves only `orchestrator -> researcher`
  creates a boundary; user adjacency, repeated orchestrator identity, and
  missing agent identity do not.
- PASS: Overlay `tsc --noEmit` after the concurrently edited stream lifecycle
  contract finished writing; no task file has a type error.
- PASS: production Vite build and the full Node browser
  `agent-compact-visual-stress` fixture. The browser observed exactly one
  boundary card ID, `overflow: visible` on the identity parent, the avatar
  ring's `-2px` inset, a non-transparent hover background/outline, non-zero
  radius, and `box-shadow: none` / `transform: none`.
- PASS: `historical-docs-links.test.ts` (20/20) and task-scope
  `git diff --check`.
- Visual review PASS:
  `packages/overlay/.scratch/agent-compact-visual-stress/01-agent-message-grouping-hover.png`
  shows a single low-contrast divider before the solution architect, its full
  circular avatar/status ring, and a restrained flat hover surface.
- The repository-wide architecture guard has 118 passing and 9 failing tests.
  The failures are existing concurrent App/inspector/composer/token work (for
  example, the guard still requires the already removed
  `solidFileChangesMount`); none touches the agent-message selectors or files.
  Both modified guard assertions for token-only idle/hover chrome pass.

### Second review

- Agent ownership is compared only from `CardNode.agentID`; there is no title,
  role, stage, DOM-text, or card-ID inference path.
- The boundary is projected by the existing virtual transcript owner and
  painted once on the later row; no second list, overlay, or message state was
  introduced.
- Removing parent overflow does not weaken truncation: title, duration, status,
  and timestamp retain their existing local nowrap/ellipsis ownership.
- Hover remains theme-driven and flat. No literal color, motion lift, shadow,
  fallback, compatibility selector, dead code, or process intervention was
  added.

## Agent avatar scroll-edge correction — Recall

| Item | Detail |
| --- | --- |
| User requirement | 用户用真实 Mission 卡片截图证明运行中 agent 头像仍被裁剪，要求继续根治。 |
| Acceptance criteria | Mission 头像贴近消息卡片左边缘时，完整的运行状态圆环仍位于滚动视口内；头像、标题和卡片保持现有紧凑对齐；真实桌面页面截图经人工复核无裁剪。 |
| Hard constraints | 保留 `.chat-scroll` 作为唯一 transcript 滚动 owner；不得把滚动容器改成可见溢出、缩小圆环或增加第二套头像样式；圆环外扩量和布局预留必须来自同一 CSS 变量；不刷新或重启用户正在运行的 Overlay；Playwright 只通过 Node 运行。 |
| Sources recalled | 本记录前述 Recall、root-cause、verification 和 second-review 区块；用户 14:45:53 Mission 截图；当前 `chat-bubble.css`、`conversation.css`、`ChatBubble.tsx`、`Avatar.tsx` 与 Node browser fixture。 |
| Whole-repository search evidence | `.chat-avatar::after` 是唯一 agent 状态圆环；`.chat-bubble__identity-meta` 已允许可见溢出；`.chat-scroll` 是唯一纵向滚动视口且纵向滚动会建立横向裁剪边界；所有 agent 顶层消息均经过 `.chat-bubble-row[data-kind="agent"]`，因此该行是唯一能够在不改变滚动 ownership 的前提下分配圆环外扩空间的布局 owner。 |
| Independent agent feedback | None. The user did not request sub-agents and the active policy forbids spawning them otherwise. |

### Corrected root cause and design

上一次修复只移除了头像与状态圆环之间的中间裁剪层。真实 Mission
卡片把头像放在 agent 行的最左侧，圆环仍会向该行之外扩展两个缩放像素，
最终撞上 `.chat-scroll` 的滚动裁剪边界。测试 fixture 的头像离左边界更远，
因此此前的视觉结论不完整。

保留滚动视口和圆环尺寸不变：在 agent 行上定义唯一的圆环外扩变量，
同时用它控制 `::after` 的负 inset 和行内起始 padding。这样圆环的绘制范围
被纳入真实布局空间，不依赖扩大 overflow，也不会产生第二套几何来源。

### Correction verification result

- PASS: focused unit test proves the agent row reserves the exact variable used
  by the status-ring inset.
- PASS: Overlay TypeScript check completed without diagnostics.
- PASS: production Vite build and the Node
  `agent-compact-visual-stress.test.ts` browser fixture; the rendered running
  avatar circle is complete and no horizontal page overflow was reported.
- Visual review PASS:
  `packages/overlay/.scratch/agent-compact-visual-stress/01-hydrated-compact.png`
  shows the full running avatar ring after the final CSS subtraction form was
  built. The in-app browser rejected a separate `data:` stress document under
  its URL security policy, so no attempt was made to bypass that policy; the
  repository-owned Node browser fixture remains the rendered evidence source.

### Correction second review

- `.chat-scroll` remains the only transcript scroll owner and retains its
  overflow behavior.
- The ring is neither reduced nor translated. The agent row now owns the two
  scaled pixels that the existing ring already paints outside the avatar.
- `--chat-avatar-ring-outset` is the sole value used by both layout padding and
  paint inset; no fallback, compatibility selector, literal color, or second
  avatar implementation was added.
- No dead or obsolete code was discovered in the touched scope.

## Agent rail hover-only reveal — Recall

| Item | Detail |
| --- | --- |
| User requirement | Agent rail 不要一直显示；只有 hover 到 rail 区域时才显示。 |
| Acceptance criteria | 左侧 agent rail 的布局列和命中区保留；tick line 默认视觉不可见；鼠标 hover rail 或键盘 focus 进入 rail 时 tick line 显示并保持现有 stepped proximity 宽度、status color、Kobalte tooltip input/output、click-to-locate；真实桌面 fixture 截图经人工复核。 |
| Hard constraints | `ConversationAgentRail` 仍是唯一 rail owner；不新增第二条 rail、tooltip、shadow state、DOM scan、fallback、gate、运行中 Overlay refresh/restart、mobile/tablet scope 或新 worktree；Playwright 继续由 Node 启动；保留 unrelated dirty work。 |
| Sources recalled | 本记录前述 rail centering、hover input context、avatar correction 区块；当前 `ConversationAgentRail.tsx`、`conversation.css`、`conversation-agent-rail.test.ts`、`conversation-agent-rail-hover-context-browser.test.ts`、`overlay-architecture-guards.test.ts`、`owner-surface-consistency.test.ts`。 |
| Whole-repository search evidence | `rg` confirmed rail DOM is mounted once from `App.tsx`; tick visuals are owned by `.conversation-agent-rail__tick-line`; hover/focus detail is the existing Kobalte Tooltip in `ConversationAgentRail.tsx`; browser fixtures target the same `data-ui="conversation-agent-rail-locate"` buttons; no separate rail report/run surface exists. |
| Independent agent feedback | None. The user did not request sub-agents and active policy forbids spawning them otherwise. |

### Hover-only reveal root cause and design

The rail host already owns the correct left whitespace and hit area. The
visible defect is that the tick line itself has a default visible opacity,
while status/proximity rules adjust width and color on top of that always-on
paint.

Keep the DOM, hit area, tooltip, and locate behavior unchanged. The rail owns
one CSS variable, `--conversation-agent-rail-tick-opacity`, defaulting to `0`.
`:hover` and `:focus-within` on `.conversation-agent-rail` set that variable to
full opacity. Tick status and proximity rules consume the same variable, so they
cannot accidentally make the rail visible before interaction.

### Hover-only reveal verification result

- PASS: `conversation-agent-rail.test.ts` and `owner-surface-consistency.test.ts`
  prove the rail keeps one owner, no expanded surface, a default opacity `0`,
  and a hover/focus-within owned reveal variable.
- PASS: Overlay `tsc --noEmit`.
- PASS: production Vite build and Node
  `conversation-agent-rail-hover-context-browser.test.ts`; the browser observed
  tick opacity `0` before hover, opacity `1` on hover/focus, retained
  input/output tooltip content, and no transcript overlap.
- Visual review PASS:
  `packages/overlay/.scratch/conversation-agent-rail-hover-context/input-output-tooltip.png`
  shows the rail appearing only while active and the tooltip staying in the
  left whitespace.
- PASS: `historical-docs-links.test.ts` and task-scope `git diff --check`.

### Hover-only reveal second review

- The rail's layout column, hit area, Kobalte Tooltip, and locate button remain
  unchanged.
- Visibility is not inferred from status, proximity, title text, DOM text, or
  rendered card content. One rail-owned CSS variable controls the paint.
- Running, skipped, idle, and active proximity rules consume the same opacity
  variable, so none can reintroduce an always-visible rail line.
- No dead or obsolete code was discovered in the touched scope.
