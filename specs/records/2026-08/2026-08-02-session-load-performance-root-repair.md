# Session Load Performance Root Repair

## Recall

### User requirements

- Diagnose whether repeated Conversation loading failures come from backend restarts or a performance-design defect.
- Systematically repair the defect rather than masking it with retry, timeout, fallback, or a Host gate.
- Because the repair can break working behavior, implement it in a new Git worktree.
- Keep the completed repair on the new worktree branch. Do not merge, switch, or modify the main worktree after verification.
- Preserve all parallel changes in the main worktree and do not restart, refresh, terminate, or otherwise operate on a live Overlay without explicit approval.

### Observed production evidence

The read-only incident inspection used the packaged Overlay process, its structured server log, immutable SQLite reads, process metadata, and current source:

- The Overlay process and `opencorvus serve` kept the same PIDs from 14:03 until at least 17:44, excluding repeated backend restarts as the cause of the earlier failures.
- `GET /expert-squad/catalog` reached 85,902 ms, `GET /skill/mounts` reached 63,079 ms, and `GET /project/current/worktrees` reached 100,386 ms.
- Task Conversation hydration reached 11,383 ms, while exact child-Session reads were normally a few milliseconds when the server was not saturated.
- Several simultaneous same-project catalog and worktree requests completed successfully only after tens of seconds.
- Overlay then recorded `Fetch is aborted`, `extensions load failed`, and `extensions reload failed`: newer load ownership cancelled older requests while expensive backend work was still running.
- The production database was approximately 238 MB with 336 Sessions, 10,150 Messages, and 50,353 Parts. Existing Message/Part session-time indexes were present. This data volume amplified contention but did not explain normally fast exact child-Session reads.
- Near the end of diagnosis, both the desktop parent and server child disappeared together without a new server PID or crash report. That later whole-application exit is separate from the proven pre-exit request-amplification defect.

### Acceptance

- Initial Task/Conversation restoration becomes usable without waiting for Expert Squad, Skill, MCP, or config reconciliation.
- A same-scope burst builds one canonical Expert Squad/Skill projection and shares the same in-flight computation.
- Registry, Resolver, catalog, Skill mounts, Composer references, scheduler, and worker runtime continue to consume one effective project-context catalog.
- Explicit package and Skill mutations invalidate the one canonical cached computation before returning success.
- Conversation hydration resolves the Task Session tree once and batch-loads per-Session activity without an N+1 query loop.
- Same-repository worktree reads share one in-flight Git process and continue to use the canonical supervised `Process.run` lifecycle.
- An isolated real-runtime check demonstrates cold-to-hot catalog reduction and responsive health requests while project capability reads complete.
- No UI automation test is added, modified, updated, or run. UI acceptance uses a real Overlay page, interaction, screenshots, and manual inspection.
- Focused non-UI route, resolver, persistence, process, type, route-generation, documentation, and health checks pass.

### Hard constraints

- `PromptProfileResolver` remains the only runtime projection owner. A cache may retain its exact result; it may not become a second authority.
- `prompt_profile.active` remains the only active Expert Squad selection source.
- Existing Conversation tail/history/SSE protocols remain canonical; do not introduce a second transcript store or paging protocol.
- Do not add retry loops, larger timeouts, stale-data fallbacks, polling, state machines, or request gates.
- Do not convert successful same-scope data into stale cross-scope UI state.
- Use existing `createInstanceState`, catalog mutation locks, Expert Squad install locks, and supervised `Process.run` rather than hand-written infrastructure.
- Tests assert positive current behavior. Delete any UI automation or negative test encountered in task-owned test paths instead of running or updating it.
- Commit subjects start with `dsw-33987`; do not bypass hooks. Commit and push the isolated branch to `legacy-remote`, but do not merge it into the main worktree.

### Records and architecture read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-08/2026-08-01-expert-squad-project-over-global-resolution.md`
- `specs/records/2026-08/2026-08-01-conversation-artifact-event-routing-repair.md`
- `specs/records/2026-08/2026-08-02-conversation-scroll-owner-regression-repair.md`
- `packages/opencorvus/test/AGENTS.md`

### Whole-repository call-point search

| Owner or route                                                   | Current call points and disposition                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadExpertSquadCatalog()`                                       | `overlay/main.tsx` Composer reference reconciliation and `settings/ExpertSquadPanel.tsx`; retain both consumers, share backend canonical computation, keep exact-scope client in-flight ownership.                                                       |
| `PromptProfileResolver.catalog()`                                | Project/session Expert Squad routes and Resolver catalog helpers; retain public projections and consume the Registry-owned Instance inventory snapshot.                                                                                                  |
| `ExpertSquadRegistry.discoverAvailable*()`                       | Resolver, project Instance, route settings/market helpers, Manager lifecycle, capability catalog, and runtime binding; runtime/catalog reads consume one effective snapshot, mutations keep exact direct validation and invalidate after atomic success. |
| `SkillManager.installed()`                                       | Config response, Conversation capability, capability catalog, Skill mounts, and Skill routes; retain one public contract, cache its expensive manifest/risk projection with Skill catalog/config revision ownership.                                     |
| `SkillMount.matrix()`                                            | Skill route and override mutation; retain schema and projection equality, resolve from the same prepared snapshot as catalog.                                                                                                                            |
| `loadExtensions()` / `reloadProjectScope()`                      | Initial connection, workspace switch, settings server refresh, Git initialization; keep project ownership but prevent unrelated extension failure from owning Conversation readiness.                                                                    |
| `loadProjectWorktrees()`                                         | `TaskDirBar.tsx`; retain the single visible worktree surface, coalesce same-directory reads and load only when the surface or an explicit mutation requires it.                                                                                          |
| `Worktree.listRegisteredWorktrees()`                             | Project worktree list plus primary-worktree helpers; use one repository-keyed in-flight owner and canonical process lifecycle. The entry exists only while the process runs, so no stale-result invalidation is needed.                                  |
| `loadConversation()` / `mergeLatestConversationTail()` / history | Task selection, recovery, SSE/event updates, child-session Dock; retain the existing tail/history/SSE protocol and existing same-Task selection/recovery ownership.                                                                                      |
| `loadTaskTranscript()` / `loadTaskProtectedTranscript()`         | Task hydrate/history and internal full transcript readers; reuse one resolved Session tree and batch current tail queries.                                                                                                                               |
| `MessageStore.latestConversationAgentActivityBySession()`        | Task hydrate Agent view; replace per-Session paging loop with a batch window query while returning the same typed map.                                                                                                                                   |
| `Process.run()`                                                  | Canonical supervised subprocess lifecycle shared by Git/glob/runtime operations; retain it rather than adding route-specific process ownership.                                                                                                          |

No independent Agent feedback was collected because the current orchestration instruction prohibits spawning sub-agents unless the user explicitly requests delegation.

## Causal chain

```text
Task/project selection
  -> project reload + Composer references + TaskDirBar react independently
  -> catalog, Skill mounts, capability, Git and Conversation requests overlap
  -> Registry/Skill/package projection and Git processes repeat for the same scope
  -> backend latency expands from milliseconds to tens of seconds
  -> a newer UI owner aborts an older fetch
  -> Overlay reports repeated load failure although many server requests later return 200
```

Increasing timeouts would only delay the visible abort. The root repair must reduce duplicate work and remove non-Conversation resources from Conversation readiness.

## Implemented design

### 1. Canonical Registry and Skill inventories

The existing owners retain Instance-local computed values:

- `ExpertSquadRegistry.discoverAvailable()` retains its exact effective installed-package inventory by normalized project directory. Concurrent Resolver/catalog/capability readers receive the same Promise.
- `SkillManager.installed()` retains manifest, source, trust, risk, recommended-policy, managed, and writable computation. Permission policy remains projected from current global config on every response.

Neither cache persists a new active identity or public transport DTO. Resolver, catalog, Skill mounts, Conversation capability, scheduler, and worker resolution continue to call their existing strict owners.

Invalidation is explicit and shared:

- Skill install/import/update/remove/refresh mutations reset both Skill discovery and installed inventory.
- Expert Squad install/update/uninstall mutations reset the available Registry inventory across active Instances.
- project Instance disposal releases all state automatically.

An invalidation has no stale fallback: the next reader constructs a new canonical snapshot or receives the real construction error.

### 2. Conversation-first startup ownership

- Initial startup awaits Tasks and project metadata, then restores the selected Task/Conversation.
- Extension and config reconciliation starts only after selected Task/Conversation restoration, then completes under the current init generation and exact directory.
- Extension/config failures remain resource-scoped `projectLoadIssues`; they no longer own the success/failure of initial Conversation restoration.
- Existing selection epoch, same-Task guard, replay abort, recovery coalescing, tail/history, and SSE ownership remain unchanged.

### 3. Batched Conversation persistence reads

Resolve one Task Conversation Session set per request:

- Task and root Session ownership;
- one Session-tree ID list;

Reuse it for global and protected transcript windows. Replace per-Session activity queries with a SQLite window query partitioned by `session_id`, ordered by `(time_created DESC, id DESC)`, with bounded batched continuation only for Sessions whose newest candidate Parts do not project to visible activity.

The response schema, order keys, history cursor, rewind behavior, and exact-session ownership remain unchanged.

### 4. Git worktree in-flight ownership

- `listRegisteredWorktrees()` keeps the existing stable porcelain parser.
- Same resolved primary repository path shares one in-flight list Promise and receives independent result objects.
- Success or failure removes the in-flight entry immediately; no result cache or stale payload exists.
- `Process.run` remains the only process owner.

### 5. Isolated runtime evidence

The isolated server's existing request/stage logs provide phase evidence without adding another metrics surface:

- cold project bootstrap plus `GET /expert-squad/catalog`: 1,384 ms;
- hot `GET /expert-squad/catalog` after the Instance snapshot: 15 ms;
- `GET /skill/mounts`: 107 ms;
- `GET /global/health` during and after capability loading: 0–2 ms;
- initial worktree request including project bootstrap: 1,461 ms.

The real built Overlay reached its ready Composer, removed both loading indicators, showed Online on isolated port 4781, opened Installed Agent Squads with three complete built-in entries, and emitted no browser warnings/errors. Screenshots were captured at `/tmp/opencorvus-session-load-qa-home.png` and `/tmp/opencorvus-session-load-qa-installed-squads.png`.

## Verification commands

No UI test is run.

```bash
bun test packages/opencorvus/test/skill/installed-inventory-state.test.ts \
  packages/opencorvus/test/expert-squad/available-inventory-state.test.ts \
  packages/opencorvus/test/session/message-store-keyset.test.ts \
  packages/opencorvus/test/project/worktree-list-coalescing.test.ts
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build:vite
bun run api:routes-check
bun run docs:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
```

The production database and packaged application remained read-only. Runtime evidence used a separate portable database and isolated server/Overlay process.
