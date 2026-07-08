# 2026-07-08 Collapsed Card Dynamic Latest Activity

## Recall

User request:

- Make collapsed cards dynamically show the last message or tool call instead of static content.

Acceptance criteria:

- Collapsed card preview content comes from the card tree's latest text-or-tool activity, not from terminal agent summary text or goal description prose.
- Tool calls are eligible latest activity for every collapsed card type, including goal step cards.
- The latest activity order is derived from timeline order keys already present on message parts, tool parts, or review stream events.
- Running cards stay expanded by the existing fold policy; user-authored cards still stay expanded by default.
- No fallback, compatibility branch, second rendered tree, or DOM scraping is added.
- Focused unit/cache/browser tests prove the collapsed preview updates from latest text or tool data, and visual review uses a Node-launched browser runner.

Hard constraints:

- Follow `AGENTS.md`.
- Preserve existing dirty worktree changes and do not git reset.
- Do not restart, refresh, kill, or otherwise interfere with a user's running OpenCorvus / overlay process.
- Use Node, not Bun, for Playwright browser execution on Windows.
- Any code change must have matching tests.

Sources read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`
- `specs/records/2026-07/2026-07-08-subagent-terminal-summary-cards.md`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/src/components/CardHeader.tsx`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/store/card-tree.ts`
- `packages/overlay/src/store/card-tree-stats.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/overlay/src/utils/card-tree.ts`
- `packages/overlay/src/utils/timeline-order.ts`
- `packages/overlay/test/card-collapsed-preview.test.ts`
- `packages/overlay/test/chat-bubble.test.ts`
- `packages/overlay/test/tree-writer-stats-cache.test.ts`
- `packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`
- `packages/overlay/test/browser/agent-summary-card-browser.test.ts`

Whole-repository search evidence:

- `rg -n "collapsed|collapse|preview|summary|lastMessage|lastTool|toolCall|tool" packages/overlay/src/components packages/overlay/src/store packages/overlay/src/utils packages/overlay/test/card-collapsed-preview.test.ts`
- `rg -n "collectLatestActivityText|collapsedActivityPreviewText|CardHeader|card__collapsed-preview|card__preview-row|defaultExpandedForNode" packages/overlay/src packages/overlay/test specs/records/2026-07 specs/current/architecture specs/README.md`
- `rg -n "AgentSummaryBlock|agent-summary|card__agent-summary|agentSummary|latest activity|collapsed preview" packages/overlay/test/browser/agent-summary-card-browser.test.ts packages/overlay/src/styles/surfaces/card.css packages/overlay/src/styles/surfaces/chat-bubble.css packages/overlay/test -S`
- `rg -n "function .*OrderKeyTime|export function .*OrderKeyTime|orderKeyTime|timelineOrderKey|parse.*orderKey|requireTimelineOrderKeyDomain|messageOrderKeyTime" packages/overlay/src packages/opencorvus/src packages/overlay/test -S`
- `rg -n "goalDescription|suppressTools|agentSummaryText|AgentSummaryBlock|step cards prefer text|falls back to goalDescription|summaryBeforePreview|data-ui=\"agent-summary\"" packages/overlay/src packages/overlay/test specs/records/2026-07 -S`
- `rg -n "part\\.orderKey|orderKey.*part|message\\.part|partOrderKey|time\\.created|state\\.time|subtreeLatestHit|markCardStatsDirty" packages/overlay/src/services/tree-writer.ts packages/overlay/src/store/card-tree-stats.ts packages/overlay/src/utils/card-tree.ts packages/overlay/test -S`

Independent agent feedback:

- Not spawned. The current request is a focused overlay card rendering/data-flow repair, and the relevant owner files plus tests identify a single implementation path.

Diagnosis:

- `collectLatestActivityText` already exists as the intended collapsed-preview source, and `card-tree-stats.ts` maintains `subtreeLatestHit` so collapsed cards can read it without recursive scanning.
- The current renderers also show `agentSummary` in collapsed headers. That terminal summary is static and currently appears before the latest-activity preview, so the collapsed card visually emphasizes static content.
- Goal step cards suppress tool hits and can return `goalDescription` when no prose exists. Both behaviors make collapsed step cards show static goal context instead of the last message/tool activity.
- Latest-hit ordering currently uses card time plus part index. Message/tool parts already carry timeline order keys, so the preview should derive activity time from those keys instead of the parent card timestamp.
- Review stream reasoning chunks are not ordinary `message.part` events; their event order key must be stamped into the reasoning part so they can participate in the same latest-activity ordering.

Implementation plan:

1. Change `collectLatestActivityText` and the stats kernel so text, reasoning, and tool hits use the activity part's timeline order key time.
2. Remove goal-step tool suppression from both the recursive collector and cached stats path.
3. Remove goal description as collapsed-preview content; goal description remains in the expanded card body.
4. Stop rendering `AgentSummaryBlock` in collapsed `ChatBubble` and `CardHeader` headers so the visible collapsed content is the dynamic latest-activity preview.
5. Stamp review stream reasoning parts and task request text with their existing event/task order keys.
6. Update focused unit/cache/static/browser tests, then run targeted tests, typecheck/i18n/build, Node browser screenshot verification, docs link health for the new spec, and a second diff review.
