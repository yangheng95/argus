# Scheduled Automation Scope Rearchitecture

## Recall

### User requirements

- “现在的定时器支持会话级，项目级和全局的吗，帮我测试定时器，每过一分钟输出一个歇后语”
- “我他妈的说的是opencorvus的定时器”
- “现在的逻辑完全不健全，读codex的文档，调整设计方案，至少覆盖会话级和全局两个级别”
- “定时器连个删除功能都没有，太离谱了，而且也不是在一个会话内部起作用，反复启动新会话”

### Acceptance criteria

- Scheduling from an existing Chat or Work conversation can bind the exact
  Session. Every due run appends one visible prompt to that Session and returns
  the result to the same conversation. It never creates a replacement Session.
- A global recurring Automation can exist without a selected Project. Every due
  run creates one new global Chat and appears in the global Scheduled inbox.
- Project scope remains available and supports one or more explicit Project
  targets without becoming the persistence owner of all Automations.
- The Scheduled list is global by default and exposes a visible delete action on
  every row. Deletion uses a clear confirmation, removes the definition and its
  run ledger, and does not delete already-created conversation Sessions.
- Natural-language scheduling from a conversation defaults to the exact current
  Session unless the operator explicitly asks for a new Chat, Project run, or
  global standalone run.
- One `AutomationService`, one recurrence parser, one lease protocol, one run
  ledger, and one public route family own all recurring Automations.

### Live evidence

- The live OpenCorvus `0.0.28-beta` instance accepted a project-owned
  `standalone` Automation and naturally fired it.
- With no explicit model, its first due runs failed with
  `MissingModelConfigError` because the selected Project had no Chat model.
- After applying the explicit `openai/gpt-5.6-terra` model, a due run succeeded,
  created a new Session, and persisted the assistant text
  `孔夫子搬家——尽是书`.
- That result proved the timer and visible message path, but it also proved the
  user-visible defect: the created definition was `standalone`, so subsequent
  due executions kept creating Sessions instead of continuing the conversation
  from which the user requested the timer.
- The test Automation `atm_fc29c8019001jVSPidVZnazY1G` was paused through the
  live API after the defect report. The API response and database row both show
  `status = paused`, so it no longer creates Sessions or consumes model usage.
- `DELETE /experimental/automation/:id` and
  `deleteAutomation()` already exist, but the only visible control is inside the
  row drill-in detail header. A delete capability that cannot be discovered from
  the Scheduled list does not satisfy the product requirement.

### Official Codex evidence

The current official
[Scheduled tasks documentation](https://learn.chatgpt.com/docs/automations)
establishes these product semantics:

- A scheduled task inside an existing chat returns to that chat and reuses its
  existing context.
- A standalone scheduled task creates a new chat for each run and reports its
  result in Scheduled.
- A standalone scheduled task can run across one or more Projects.
- Users can ask ChatGPT or Codex to create or update a schedule and specify
  whether each run returns to the current chat or starts a new chat.
- The first runs should be reviewed, and scheduled tasks retain explicit model,
  reasoning, sandbox, and execution-location controls.

The current Codex app Automation contract independently exposes the same split:
a `heartbeat` targets a thread, while a standalone `cron` may target a Project
or use a null Project identity for projectless global work. OpenCorvus should
match these observable semantics, not copy Codex's internal names.

### Hard constraints

- Preserve unrelated work. Do not stash, reset, restore, broadly format, create
  a worktree, or touch the running Overlay process.
- Do not add a second timer, a compatibility route, a fallback Project, a
  synthesized Session, a hidden message, a state machine, or a host gate.
- Reset the unreleased database schema to the new contract; do not add a
  migration or preserve the old project-owned schema.
- Keep RFC 5545 recurrence parsing, due-time calculation, leases, retries,
  ownership renewal, manual-run semantics, and run-history facts in the existing
  Automation service.
- UI acceptance must use a real page, real interactions, current screenshots,
  and manual visual inspection. Do not add, modify, or run UI automation tests.
- Non-UI contracts use positive results. Do not add or retain negative tests.
- Any implementation commit uses the `dsw-33987` prefix and is pushed to
  `legacy-remote` through normal hooks.

### Acronyms

- API: Application Programming Interface, the server contract consumed by the
  Overlay and generated clients.
- CRUD: Create, Read, Update, and Delete lifecycle operations.
- IANA: Internet Assigned Numbers Authority, whose time-zone identifiers anchor
  local recurrence rules.
- RFC: Request for Comments; RFC 5545 defines the iCalendar recurrence format.
- RRULE: Recurrence Rule, the RFC 5545 expression that defines repeated times.
- SDK: Software Development Kit, the generated client contract.
- UI: User Interface, the rendered Scheduled surface.

### Read records and sources

- `AGENTS.md`
- `specs/records/2026-07/2026-07-26-codex-parity-scheduled-automations.md`
- `specs/records/2026-07/2026-07-27-scheduled-automation-usability-repair.md`
- `specs/records/2026-07/2026-07-28-scheduled-real-project-e2e-repair.md`
- `specs/records/2026-07/2026-07-30-scheduled-reference-parity-and-project-catalog.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/17-code-work-agent-platform.md`
- official Codex Scheduled tasks documentation
- current Codex Automation tool schema
- live OpenCorvus health, Automation API, run ledger, Session messages, and
  SQLite rows

### Whole-repository grep

The audit searched `AutomationService`, `AutomationTable`,
`AutomationRunTable`, `CreateAutomation`, `UpdateAutomation`,
`experimental/automation`, `schedule`, `standalone`, `heartbeat`, `project_id`,
`session_id`, `GlobalConversationService`, `InstanceBootstrap`, global Scheduler
scope, and every Overlay Automation adapter/component/test reference across
source, tests, generated OpenAPI/SDK, docs, and specs.

### Independent-agent feedback

The user explicitly requested parallel-agent coordination. A read-only
independent audit found that a second Project catalog route would duplicate the
existing discovery source, that catalog/provider failures could hide global and
Session definitions, that Project creation implicitly selected the first
Project, and that explicit models were validated only in the first selected
Project. The implementation therefore keeps `/global/projects/discover` as the
only picker catalog, preserves registered Project IDs in that response, loads
the global Automation collection independently of optional picker/provider
metadata, requires explicit Project selection, and validates an explicit model
inside every selected Project.

## Root cause

The timer executor is not the root defect. The public ownership model is.

### Observable behavior

1. Scheduled opens with a Project selector rather than a global collection.
2. New definitions default to `standalone`.
3. `standalone` always creates a new Project-owned Chat Session.
4. `heartbeat` exists, but it can only be saved after the user manually aligns
   the Scheduled Project selector with a separately inferred active Session.
5. Delete is only visible after opening the row detail.
6. Every public route and Tool call requires the ambient
   `Instance.project.id`.

### Direct trigger

The user request “every minute output one xiehouyu” was persisted as
`kind = standalone`. `AutomationService.executeJobWake()` therefore passed no
Session ID and requested `newConversationExperience = chat`, which made
`SessionWake.wake()` create a new Session for every run.

### Design cause

`automation.project_id` is required and the public API is mounted under a
Project-scoped route. The implementation then overloads:

- `project_id` as persistence owner, execution directory, list filter, model
  source, permission source, and run-history namespace;
- `kind` as both result destination and Session creation policy;
- `session_id` as an optional modifier rather than a first-class target.

These are three independent questions:

1. Where does the result go?
2. Which Project resources, if any, may the run use?
3. Which configuration and execution environment does the run use?

Because they are collapsed into one Project row, the current design cannot
represent a projectless global schedule, makes conversation continuity
secondary, and forces the Scheduled UI to hide global data behind a Project
picker.

### Why the previous design did not root-correct it

The July implementation correctly replaced the custom cron parser, added
leases, run history, RFC 5545 recurrence, `standalone`/`heartbeat`, and a delete
route. It retained Project ownership to get the first real backend integration
working. Later UI work improved Project selection and drill-in presentation,
but it reinforced the same ownership boundary. It did not establish a global
definition owner, a global poller, a projectless execution path, or a
conversation-first creation entry.

This record supersedes the July records only for Automation scope, route
ownership, creation defaults, and deletion discoverability. Their recurrence,
lease, retry, run-history, worktree, and real-page acceptance decisions remain
valid.

## Single-source scope model

### Public target union

Replace public `kind` plus ambient Project ownership with one explicit,
discriminated target:

```ts
type AutomationTarget =
  | {
      scope: "session"
      sessionId: string
    }
  | {
      scope: "project"
      projectIds: string[]
    }
  | {
      scope: "global"
    }
```

`scope` is the user-visible product contract. It is not inferred from nullable
columns at execution time.

| Scope     | Required identity                  | Due-run behavior                                                                                                  | Configuration owner                                                   |
| --------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `session` | One exact existing Session         | Append one visible prompt and assistant response to that same Session; never create another Session.              | Effective configuration already bound to the exact Session.           |
| `project` | One or more exact registered IDs   | Create one new visible Chat per target Project for each scheduled occurrence; local/worktree is chosen per target. | Explicit Automation model, otherwise that Project's effective config. |
| `global`  | No Session or Project target       | Create one new global Chat per occurrence and report it in Scheduled.                                              | Explicit Automation model, otherwise global configuration.            |

Changing scope is an explicit replacement of the target union. It is allowed
only while the definition is not leased by a run. No old Session or Project
identity survives a scope change.

### Natural-language creation

The `schedule` Tool receives the caller Session as real execution context:

- From a Chat or Work conversation, “remind/check/continue every …” defaults to
  `{ scope: "session", sessionId: ctx.sessionID }`.
- “Start a new chat each time” selects global scope unless the user names one or
  more Projects.
- “Run this in project X” selects project scope with exact resolved Project IDs.
- The Tool prompt must ask the model to choose the target from user language. No
  host-side keyword classifier or scope gate is added.
- The Tool result always echoes the exact target and next run so the user can
  correct it immediately.

### Persistence

Reset the unreleased schema to:

#### `automation`

- global definition identity and user-visible fields;
- `scope = session | project | global`;
- recurrence, model, reasoning, status, next run, failure summary, lease owner,
  and timestamps;
- nullable `session_id`, required only when `scope = session`;
- no required `project_id`.

#### `automation_project_target`

- exact `(automation_id, project_id)` rows for `scope = project`;
- one or more rows are required for project scope;
- no rows are permitted for session or global scope;
- target order is stable for presentation only and does not define execution
  order.

#### `automation_run`

- global run identity, Automation ID, `fire_id`, scheduled time, exact target
  scope, optional target Project ID, resulting Session ID, owner, outcome,
  started/completed times, and error;
- one `fire_id` groups all Project-target runs from the same recurrence
  occurrence;
- each Project target has its own lease-finalized run result so one failure does
  not erase other target facts.

Internal Task/Session delayed wakes remain private Automation records owned by
the same service. Their `purpose = delay` discriminator and exact Task/Session
target are not exposed as public scopes, list rows, or API inputs.

Database constraints and service validation enforce the target union as data
integrity:

- session scope has one Session and zero Project targets;
- project scope has no Session and at least one Project target;
- global scope has neither;
- delayed wakes retain their current exact Task/Session identity.

These are shape constraints, not workflow gates.

## Runtime ownership

### One global poller

Move the public recurring poller registration out of
`InstanceBootstrap`. Register it once with Scheduler global scope during server
runtime initialization. The server lifecycle supplies the existing
`InstanceLifecycleCapabilities` owner to Scheduler's global entry explicitly;
the poller must not capture the first Project runtime merely because that
Project happened to initialize first. It queries every due public Automation
regardless of which Projects happen to be open.

Do not create one poller per scope or Project.

### Target execution

- Session scope resolves the exact Session row and its Project, then uses
  `runWithInitializedIndependentProject()` to re-enter that Project and calls
  `SessionWake.wake()` with the exact Session ID.
- Project scope resolves each registered target, re-enters its initialized
  runtime, and creates a new Chat through the existing right-sidebar
  conversation path. A multi-Project occurrence runs independent target claims
  under the existing bounded Automation concurrency.
- Global scope reuses `GlobalConversationService` to allocate the canonical
  temporary carrying Project and create a global Chat, then sends the visible
  scheduled prompt through the same Session message path.
- Projectless global runs never borrow the last active Project and never create
  their definition under an anonymous Project.
- Session busy handling remains a delayed retry of the same exact Session. It
  must not convert to a standalone run.

### Model resolution

- Session scope uses the exact Session's effective configuration unless the
  Automation explicitly pins a model.
- Project scope resolves per-target Project configuration unless explicitly
  pinned.
- Global scope uses `Config.getGlobal()` unless explicitly pinned.
- Creation validates the exact configuration owner before persistence, so the
  first due run cannot discover a missing default model that the create form
  could have reported.

## Global lifecycle API

Replace the Project-scoped experimental route family with one global owner:

- `GET /global/automations`
- `POST /global/automations`
- `PATCH /global/automations/:id`
- `POST /global/automations/:id/run`
- `GET /global/automations/:id/runs`
- `DELETE /global/automations/:id`

The list route returns all scopes and accepts presentation filters, not an
ownership-defining directory query. Exact target summaries are part of every
view.

Delete semantics:

1. Resolve the exact Automation ID.
2. Reject with the existing typed running conflict if its lease is active.
3. Delete the definition, Project targets, and Automation run ledger in one
   transaction.
4. Preserve Sessions previously created or continued by the Automation.
5. Return a positive deletion receipt with the exact ID and name.

Delete has no compatibility alias under `/experimental/automation`; the old
route is removed when the new route ships.

The generated OpenAPI, JavaScript SDK, API docs, and Overlay adapter are
regenerated from this route family.

## Scheduled product surface

### Global inbox

Scheduled opens as one global list. The Project selector is removed from the
page header because it currently acts as a false persistence boundary.

Each row shows:

- name and recurrence;
- scope badge: Current conversation, Project(s), or Global;
- exact Session title or Project target summary where applicable;
- status and next run;
- always-visible pause/resume and delete controls.

Search and status filters operate over the global collection. A scope filter
adds All / Conversation / Projects / Global without replacing status filters.

### Visible deletion

Every list row exposes an always-visible mature danger IconButton with tooltip
text “Delete scheduled task”. The first activation arms the action with an
explicit second-click instruction on the still-visible named row; the second
activation commits deletion. The detail view retains the same action, but it is
no longer the only place where deletion can be discovered.

After confirmation:

- the row enters a visible deleting state;
- the global API commits deletion;
- the list refreshes without the row;
- failure leaves the row present and shows the typed error adjacent to it.

### Creation entry points

- Opening create from an active conversation preselects Current conversation
  and displays the exact Session title.
- Opening create from the global Scheduled page preselects Global.
- Selecting Projects reveals the mature multi-select Project control and
  local/worktree choice per selected Git Project.
- Scope, recurrence, prompt, model, reasoning, execution location, and stop
  guidance are visible before save.
- The form never defaults an active conversation request to a new Chat.

### Run history

- Session runs link back to the same Session.
- Project runs identify their exact target Project and resulting Chat.
- Global runs link to their global Chat.
- Multi-Project runs group by scheduled occurrence and show one factual row per
  Project target.

## Exhaustive call-site disposition

| Call site / surface | Current responsibility | Required disposition |
| --- | --- | --- |
| `scheduler/automation.sql.ts` | Required Project-owned definition and run rows | Reset to global definitions, explicit scope union, Project target rows, and globally addressable run facts. |
| `scheduler/automation-service.ts` public types and CRUD | Every method requires `projectId` | Replace with global IDs and explicit targets; retain recurrence, lease, retry, manual run, and finalization owners. |
| `AutomationService.init/poll/runDueNow` | One poller per initialized Project | Register one public global poller; keep private delayed-wake re-entry under the same service. |
| `assertSessionInProject` and due validation | Validates optional Session inside ambient Project | Resolve session target as the source of its exact Project; validate the explicit target union. |
| `executeJobWake` | `standalone` omits Session and `heartbeat` passes it | Dispatch by explicit scope; session always passes exact Session, project/global always create new Chat. |
| `project/bootstrap.ts` | Initializes Automation poller per Project | Stop registering the public poller here; retain any private Project event subscriptions required by delayed wakes. |
| `scheduler/index.ts` | Already supports global scheduler ownership but currently acquires runtime capabilities from an ambient Project initialization | Reuse its global scope and bind its runtime owner explicitly from server lifecycle; do not add another timer owner. |
| `chat/global-chat-service.ts` | Canonical global Chat with temporary carrying Project | Reuse for global due runs and explicit global model validation. |
| `project/independent-project-owner.ts` | Re-enters initialized Project runtime | Reuse for Session and Project targets when the Project is not currently open. |
| `server/routes/experimental.ts` | Project-scoped Automation CRUD | Delete the Automation route family after adding global routes. Event schedules remain separate. |
| `server/routes/global.ts` | Directory-free global control plane and Chat creation | Add the sole public Automation route family here or in a mounted global Automation route module. |
| `tool/schedule.ts` | Always binds CRUD to `Instance.project.id` | Replace inputs with explicit target union, default conversation requests to exact caller Session, and list global definitions. |
| `tool/wait.ts` | Private delayed Session/Task wake | Keep private and project-exact; adapt only to the reset internal-purpose schema. |
| `overlay/services/automations.ts` | Directory-scoped HTTP adapter | Replace with directory-free global adapter and target union types. |
| `ScheduledAutomationsPanel.tsx` | Project selector, standalone default, hidden detail-only delete | Replace with global inbox, explicit scope filter/form, conversation-aware default, multi-Project targets, and row-level delete. |
| `ConfigDialogHost` / Scheduled launcher | Opens a Settings destination without origin metadata | Pass the current conversation target when Scheduled is opened from a conversation; omit it for global Scheduled navigation. |
| `main.tsx` Automation run navigation | Opens the run Session using stored directory | Preserve exact run target navigation for all scopes, including global carrying Projects. |
| i18n and Automation CSS | `kind` terminology and drill-in-only actions | Replace with scope language and visible row actions; retain the established Settings design system. |
| generated OpenAPI/SDK/API docs | Project-scoped experimental contracts | Regenerate from global target-union contracts; do not hand-edit generated output. |
| `automation-service.test.ts` | Project-owned service behavior | Rewrite positive contracts for same-Session continuity, global runs, multi-Project grouping, deletion receipt, model ownership, leases, and retries. |
| `experimental-schedule-*.test.ts` | Old route contracts | Replace with positive global route contracts and generated-schema equality. |
| `tool/schedule.test.ts` | Ambient Project Tool behavior | Prove exact Session target, explicit global target, Project target set, and lifecycle receipts. |
| `overlay/test/scheduled-automations.test.ts` | Mixed adapter/recurrence and historical UI assertions | Retain only positive non-UI recurrence and transport contracts; delete UI/source-string and negative assertions. |
| `overlay/test/browser/automation-lifecycle-browser.test.ts` and `automation-list-overflow-browser.test.ts` | Prohibited repeatable UI automation discovered during this design audit | Deleted without running; future acceptance uses interactive real-page review without persisting a test or fixture. |
| `specs/current/architecture/02-data.md` | Scheduler table ownership | Update after implementation to document global Automation ownership and Project-target relation. |
| `specs/current/architecture/17-code-work-agent-platform.md` | Describes Project-bootstrap Automation owner | Update after implementation to distinguish the global recurring poller from exact Project runtime re-entry. |

## Implementation order

1. Reset the scheduler schema and positive storage/service contracts around the
   explicit target union.
2. Move public polling to one global Scheduler registration and implement exact
   Session, one-or-more-Project, and global execution adapters.
3. Replace Project-scoped CRUD with the global route family; regenerate
   OpenAPI, SDK, and API docs.
4. Replace the `schedule` Tool input and prompt contract. Prove that natural
   conversation scheduling persists the exact caller Session.
5. Replace the Overlay adapter and Scheduled page with the global inbox,
   scope-aware form, visible row deletion, and grouped run history.
6. Keep the encountered prohibited Automation UI tests deleted, remove obsolete
   Project-owned tests, and add only positive non-UI contracts.
7. Start an isolated real backend and real Vite page. Create and naturally fire
   one Session Automation, one global Automation, and one Project Automation.
8. Inspect persisted run/session facts, interact with the global list, delete
   from a row, capture current screenshots, and manually review every state.
9. Re-read this Recall section, the full diff, and the generated contracts;
   run document health, package typechecks, API/docs checks, and focused
   positive non-UI tests.
10. Commit task-owned paths with `dsw-33987`, fetch `legacy-remote`, preserve unrelated
    work, and push the main delivery branch through normal hooks.

## Required positive verification

### Service and persistence

- Creating session scope returns the exact Session target.
- Two naturally due runs append two new visible prompt/assistant exchanges to
  the same Session ID.
- Creating global scope succeeds without a Project and produces a new global
  Chat on a naturally due run.
- Creating Project scope with two targets produces two target run facts under
  one `fire_id`.
- Deleting an inactive definition returns its exact deletion receipt and the
  next global list is the complete remaining collection.
- Sessions from deleted Automations remain navigable.
- Pause, resume, run now, lease renewal, busy Session delay, retry, restart
  reconciliation, and recurrence advancement produce their documented positive
  states.

### Tool and API

- A scheduling request from a real Chat streams a `schedule` call whose target
  is that exact caller Session.
- An explicit global request persists global scope and resolves its model from
  global config.
- Global list/update/run/history/delete routes and generated SDK methods return
  the full target union.

### Interactive UI acceptance

- From an active Chat, opening the scheduling form shows Current conversation
  with the exact title and saves without a Project picker.
- From global Scheduled, create defaults to Global.
- The global list simultaneously displays Session, Project, and Global rows.
- Delete is visible without opening detail; its armed confirmation remains on
  the named row; the committed row disappears while its existing run Session
  remains navigable.
- The first naturally due Session run visibly appears in the same conversation.
- The first naturally due global run appears as a new global Chat.
- Current screenshots for list, create scopes, delete confirmation, same-Session
  result, and global run are opened and manually inspected.
- No UI automation file, fixture, baseline, source-string assertion, or visual
  pass/fail script is created, modified, or run.

## 2026-08-03 implementation acceptance

An isolated backend and real Vite page were connected without restarting or
mutating the production process on port 7878.

- One Session definition, one global definition, and one two-Project definition
  used `FREQ=MINUTELY;INTERVAL=1` and fired naturally for four occurrences.
- Every Session occurrence targeted
  `ses_03c776c44ffeLZcvTWVN3PV9FW`; the first three completed assistant messages
  in that same visible conversation were `泥菩萨过河——自身难保。`,
  `哑巴吃黄连——有苦说不出。`, and `竹篮打水——一场空。`.
- Every global occurrence created a distinct visible global Chat. Every Project
  occurrence produced two run rows, one for each exact selected Project.
- All three recurring definitions were deleted through the global API. The
  original Session still contained its prior messages and completed assistant
  results.
- A separate future-dated global definition was then deleted from the real
  Scheduled page through the row-level armed confirmation. The rendered list
  showed no scheduled tasks and the API returned an empty collection.
- The real page was manually inspected for the global list, Global default
  creation, two-Project multi-selection, exact Session target, row deletion,
  and same-Session results. The page connection was restored to port 7878 after
  acceptance, and the isolated runtime was shut down and moved to Trash.

## Non-goals

- No database migration or compatibility alias.
- No mobile/tablet scope.
- No event-trigger redesign; `EventService` remains separate from time
  scheduling.
- No daemon replacement in this slice. The running OpenCorvus host owns the
  global poller; unattended execution with the entire desktop process closed
  remains the separate host-lifecycle milestone already described in current
  architecture.
- No keyword-based scope inference, host state machine, or fallback Project.
