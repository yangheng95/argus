# Spec Consolidation - 2026-06-29

## Objective

Consolidate repository specifications so there is one storage model, no package-local or `new-arch`
parallel trees, and no dated specification file earlier than 2026-06-01 remains on disk.

## Recall

User request: use several independent agents to update and calibrate all specs, delete every spec before June 2026, organize spec storage so it is not scattered, update `AGENTS.md`, and keep iterating until independent agents cannot find new issues.

Acceptance criteria:

- No spec file dated before 2026-06-01 remains on disk.
- Specs use one storage model rooted at `specs/`: current architecture, monthly records, and artifacts.
- Active references and tests stop depending on package-local spec trees, retired ledgers, or the old architecture-history tree.
- `AGENTS.md` preserves the new storage and recall rules for future agents.
- Independent read-only agent review runs after implementation, and any new findings are fixed before completion.

Hard constraints recalled from `AGENTS.md`:

- No fallback, compatibility ledger, gate, or dual-source design.
- Read the on-disk plan and current references before edits.
- Do not use git reset or worktree escape hatches.
- Any spec move/delete/update must be backed by validation tests.
- Context compression must preserve objective, acceptance criteria, hard constraints, and remaining review items.

Evidence already read before implementation:

- Root `AGENTS.md` and `CLAUDE.md`.
- Existing `specs/README.md` and architecture README.
- Whole-repository spec inventory and old-path search results.
- Independent agent findings from James, Arendt, and Curie.

## Inventory Evidence Before Changes

`rg --files -g '*.md' -g '*.txt' -g '*.svg'` with spec-path filters found:

| Class                                | Count | Evidence                                                                                      |
| ------------------------------------ | ----: | --------------------------------------------------------------------------------------------- |
| Total spec-path files                |   859 | `specs/**`, `packages/*/specs/**`, and spec-named files                                       |
| Files dated before 2026-06-01        |    68 | 61 under `specs/new-arch/**`, 6 under `packages/opencorvus/specs/**`, 1 under root `specs/**` |
| Root `specs/*` files                 |    37 | Root mixed historical notes and prompt artifacts                                              |
| `specs/new-arch/**` files            |   814 | Current architecture chapters mixed with dated records                                        |
| `packages/opencorvus/specs/**` files |     8 | Package-local source that creates a second spec tree                                          |

## Storage Model

`specs/README.md` is the only public entry point for specs.

| Path                            | Purpose                                                  | Rule                                                      |
| ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `specs/current/**`              | Current long-lived normative specs                       | Must be kept calibrated with code and AGENTS.md.          |
| `specs/current/architecture/**` | Current architecture chapters and diagrams               | Replaces `specs/new-arch/**`.                             |
| `specs/records/2026-06/**`      | Dated June 2026 implementation and investigation records | Replaces root historical notes and June `new-arch` notes. |
| `specs/artifacts/**`            | Task input artifacts that are not normative specs        | Keeps prompt/reference inputs out of spec indexes.        |

Forbidden storage after this change:

- `specs/new-arch/**`
- `packages/*/specs/**`
- Root-level spec records under `specs/*.md` or `specs/*.txt` except `specs/README.md`
- Any spec markdown or text file with a date before `2026-06-01`

## Migration Plan

| Source                                                                                               | Destination                                                                        | Action                                                                         |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `specs/current/architecture/01-*.md` through `16-*.md`, `99-principles.md`, and current SVG diagrams | `specs/current/architecture/**`                                                    | Move and rewrite local links.                                                  |
| `deleted pre-June record spec-vscode-extension`                                                      | Delete                                                                             | It is a 2026-04-27 draft and fails the before-June deletion rule.              |
| `specs/new-arch/2026-04-*` and `specs/new-arch/2026-05-*`                                            | Delete                                                                             | Explicitly before June.                                                        |
| `specs/records/2026-06/2026-06-*.md` and named `*-2026-06-*.md`                                      | `specs/records/2026-06/**`                                                         | Move and rewrite references.                                                   |
| Root `specs/*-2026-06-*.md` and `specs/2026-06-*.md`                                                 | `specs/records/2026-06/**`                                                         | Move and rewrite references.                                                   |
| `specs/records/2026-06/opencorvus-research-frontend-design-boundary-2026-06-03.md`                   | `specs/records/2026-06/opencorvus-research-frontend-design-boundary-2026-06-03.md` | Move and rewrite references.                                                   |
| `deleted pre-June record *2026-05*`                                                                  | Delete                                                                             | Package-local and before June.                                                 |
| Root prompt/reference artifacts                                                                      | `specs/artifacts/**`                                                               | Move out of spec indexes.                                                      |
| `specs/records/2026-06/2026-06-29-spec-consolidation.md`                                             | Keep                                                                               | This is the current task record and Recall source, not a compatibility ledger. |

## Reference Update Plan

Use whole-repository search for these names and update every live reference:

- `specs/new-arch`
- `packages/*/specs`
- root June spec filenames moved to `specs/records/2026-06`
- pre-June spec filenames that are deleted

References to deleted pre-June specs must not be redirected to a compatibility ledger. They must either cite the
current implementation source/test, cite a current spec, or describe the historical incident without a path.

## Test And Review Plan

1. Update `packages/opencorvus/test/script/historical-docs-links.test.ts` so it enforces the new single spec tree.
2. Update `packages/opencorvus/test/script/document-health.test.ts` and `product-docs-single-source.test.ts` references.
3. Run targeted document tests:
   - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
   - `bun test packages/opencorvus/test/script/document-health.test.ts`
   - `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
4. Run `git diff --check` on changed docs/tests.
5. Run independent read-only agent review after migration. If reviewers find new issues, fix and rerun review.

## 2026-06-29 Review Addendum 1

Independent review after the initial document calibration found one remaining
class of spec drift: active source/test comments and June records still cited
deleted pre-June spec filenames without paths. Those references were rewritten
to current behavior descriptions or current source/test ownership, not to a
compatibility ledger.

The guard was extended so bare deleted pre-June spec filenames are rejected
outside this migration evidence record and the historical document-health guard.

## 2026-06-29 Review Addendum 2

Independent review after the first review addendum found active overlay script,
test, and dev-error comments still cited deleted overlay flat-redesign and
implementation-progress spec paths. Those references were rewritten to current
contract descriptions (`flat redesign migration contract` and `historical
implementation progress repair note`) without restoring the deleted specs.

Validation after this addendum:

- HEAD-level retired spec path grep returned no active hits outside the
  migration evidence record and negative guard tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## 2026-06-29 Later Independent Review Addenda

Later independent review rounds found and fixed these remaining drift classes:

1. GitHub Action direct-token compatibility still existed in `github/action.yml`
   and `packages/opencorvus/src/cli/cmd/github.ts`. The action input/env and
   CLI `GITHUB_TOKEN` branch were deleted; local test mode now requires both
   `--token` and `--event` and still exchanges the PAT for an App token.
2. `.scratch` retained stale deleted spec-tree references in text extensions
   that the scanner did not cover, plus ignored backup copies of old
   root-level `specs/*.md` / `specs/*.txt` records. The scanner now includes
   `.tsx`, `.tmp`, `.tsv`, `.diff`, `.log`, JavaScript, and YAML text
   artifacts, rejects `.scratch/**/specs/*.md` / `.scratch/**/specs/*.txt`,
   and stale scratch snapshots matching retired spec trees or root-level spec
   backups were deleted.
3. MCP runtime timeout drift existed after config/doc updates. Runtime MCP
   requests, selected prompt/resource fetches, connect, and startup tool
   discovery now route through one `effectiveTimeout(...)` /
   `mcpRequestOptions(...)` contract, including global
   `experimental.mcp_timeout`.
4. The shared `withTimeout` helper only cleared its timer on inner resolve. It
   now clears in `finally` and `unref`s supported timers so rejected or fast
   operations cannot leave active timeout handles behind.
5. `.env.example` still published retired GitHub Action token-mode variables.
   Those direct-token examples were removed, and the document-health guard now
   rejects their return.
6. June records could still publish retired root-level spec file paths. June
   records outside this migration record now reject root-level `specs/*.md` /
   `specs/*.txt` references.
7. The public GitHub Action README still told external users to call the
   repository-private `.github/actions/setup-bun` action. The example now relies
   on the published composite action's own Bun setup, and the document-health
   guard rejects the private setup step in that README.
8. `MCP.startAuth(...)` could leak the OAuth probe client and transport on
   already-authenticated success or non-auth connection failure. The OAuth
   path now records only the pending flow key and closes both probe and
   token-exchange transports after their short-lived work completes.
9. `.scratch` still retained ignored text snapshots with deleted pre-June spec
   filename references. The stale scratch files were deleted, and
   `historical-docs-links.test.ts` now scans scratch text for the same deleted
   filename contract.
10. The GitHub Action README workflow example became invalid YAML after the
    private setup-bun step was removed. The example indentation was repaired,
    and document-health now parses the README workflow block with Bun's YAML
    parser before accepting it.
11. The GitHub installer outro still linked to retired `/docs/github/` docs.
    It now points to `/docs/operations/github-action/`, and document-health
    rejects the retired URL.
12. MCP OAuth pending auth still held probe transports and the CLI debug path
    still used the SDK default connect behavior. Pending OAuth state is now a
    flow key instead of a transport handle; start, finish, and debug probes use
    explicit MCP timeout options and close their short-lived resources.
13. `.scratch` still had CSS and text snapshots with retired overlay/root spec
    paths. The stale ignored files were deleted, `.css` is scanned, and scratch
    text now reuses the retired spec path pattern checks.
14. Public GitHub Action docs still published the PAT local debug path and only
    listed comment triggers. The public docs now describe the OIDC App-token
    runtime, list all supported GitHub event names, and document repository
    tests instead of personal-token local runs.
15. MCP OAuth finish/remove/debug still had lifecycle drift. Token exchange now
    creates the finish transport with a timeout AbortSignal from the same MCP
    timeout source, remove-auth always clears ephemeral pending flow/callback
    state in `finally`, debug's basic HTTP probe uses the same timeout signal,
    and MCP SDK `connect(...)` relies on SDK request options instead of an
    outer fixed elapsed wrapper.
16. `.scratch` scanning still missed text-like snapshot extensions such as
    `.mjs`, `.html`, `.lock`, `.ps1`, `.snap`, `.astro`, shell, TOML, NDJSON,
    XML, and SVG artifacts. The guard now scans those text extensions too.
17. `specs/records/README.md` still existed as a second records index outside
    the selected storage model. It was deleted; `historical-docs-links.test.ts`
    now rejects that file, asserts every `specs/**` file belongs under
    `specs/README.md`, `specs/current/**`, `specs/records/2026-06/**`, or
    `specs/artifacts/**`, and verifies `AGENTS.md` keeps the Recall/storage
    governance rules.
18. A later GitHub Action public-doc review found `github/README.md` still
    omitted the full six-event runtime contract after the website docs were
    repaired. The README now lists `issue_comment`,
    `pull_request_review_comment`, `issues`, `pull_request`, `schedule`, and
    `workflow_dispatch`; `document-health.test.ts` checks the same event list
    in the website docs and the published Action README.
19. A later MCP timeout review found normal remote connect and `startAuth`
    probes still created transports without the timeout `AbortSignal` used by
    `finishAuth`, and CLI debug hard-coded the streamable HTTP transport. The
    runtime now passes `mcpFetchRequestInit(...)` into remote connect,
    `startAuth`, and `finishAuth`; CLI debug reuses the exported remote
    transport selector so SSE and streamable HTTP debug the same configured
    path as runtime connections.
20. A later `.scratch` review found more text-like snapshot extensions and
    extensionless UTF-8 files outside the fixed scan list. The scratch guard now
    keeps the known text-extension list but also samples unknown extensions as
    UTF-8 text, while known binary extensions are skipped before content scans.
21. A later storage-guard review found package-local spec checks still named
    only `packages/opencorvus/specs` even though the storage contract forbids
    `packages/*/specs`. `historical-docs-links.test.ts` now detects any
    package-local `specs` directory and rejects generic
    `packages/<package>/specs` references in repository and scratch scans.
22. A later SDK/OpenAPI review found the MCP OAuth callback server route had
    moved to `{ code, state }` with `MCPOAuthStateError`, while generated
    OpenAPI and TypeScript SDK artifacts still exposed only `{ code }` and
    `BadRequestError`. The SDK/OpenAPI artifacts were regenerated from the
    route source, API docs were rerendered, and
    `sdk-build-format-contract.test.ts` now checks the callback body and 400
    error union.
23. A later GitHub/MCP review found the HTTP OAuth callback route still bypassed
    the state validation path used by browser authentication, public MCP docs
    still showed a GitHub personal-token remote example, the GitHub event test
    duplicated the runtime event list, and per-server MCP timeout override lacked
    behavior coverage. The route now requires callback `state` and calls the
    same state-validating finish path, public MCP docs use an OAuth remote
    example, document health derives GitHub events from the runtime constants,
    and MCP tests cover per-server timeout precedence.
24. Validation found the same-name MCP OAuth route test cleaned project auth
    storage directly, leaving the second project's pending callback flow for the
    global test hook to tear down. The test now cleans each project through
    `MCP.removeAuth("oauth")`, so the regression coverage exercises the same
    pending-flow cancellation contract as production code.
25. A later independent docs review found the public GitHub Action page/README
    description still narrowed the trigger surface to PR/Issue comments. The
    English and Chinese frontmatter/lead text now describe all supported
    GitHub event classes, and document health rejects the old comment-only
    description.
26. A later storage-guard review found the pre-June dated spec guard rejected
    `.md` filenames but not `.txt` filenames in live specs or scratch
    snapshots. `historical-docs-links.test.ts` now uses one `.md` / `.txt`
    dated-spec filename helper for live spec files and scratch snapshot files.
27. A later MCP/API review found public MCP docs still showed Bearer-token
    remote examples, API reference generation omitted request/error contracts,
    and `createRemoteTransport(...)` still treated non-`sse` remote transports
    as streamable HTTP. Public MCP docs now present the default OAuth remote
    path without Bearer-token examples, API reference generation includes
    OpenAPI body fields and named errors in route summaries, and remote
    transport construction only accepts explicit `sse` or `streamable-http`.
28. The final independent review found `github/README.md` still had a
    comment-only lead, the repository workflow still used the private
    `.github/actions/setup-bun` helper before invoking the composite Action,
    and the overlay MCP add helper still silently filled remote transport as
    `streamable-http`. The README now describes comment, issue or PR, schedule,
    and manual workflow triggers; the workflow relies on the composite Action's
    own Bun setup; overlay remote MCP add input must carry an explicit
    transport; and the MCP add form exposes a transport selector instead of a
    hidden streamable-HTTP default.
29. A follow-up independent review found the GitHub Action docs and workflow
    body were correct, but `document-health.test.ts` still only rejected the
    old website description and only counted repository workflow steps. The
    test now positively locks the English and Chinese frontmatter/lead trigger
    classes and asserts the repository workflow's second step directly uses the
    published composite Action with no `run` command.
30. A final follow-up review found two remaining evidence gaps: the untracked
    `packages/overlay/src-tauri/target-codex-repaired/` build output could be
    captured by broad staging, and `document-health.test.ts` still kept a
    second hard-coded GitHub workflow event list. The build output path is now
    ignored and guarded by document-health, GitHub runtime owns a single
    `COMMENT_EVENTS` source reused by `USER_EVENTS`, and document-health
    derives comment and prompt-required workflow event sets from runtime
    constants. During this pass, MCP callback validation also exposed that Hono
    validator 400 bodies used `error` while manual bad-request bodies used
    `errors`; the server helper, documented `BadRequestError` schema, tests, and
    generated SDK now use the single `error` field.
31. A later independent contract review found `document-health.test.ts` still
    inferred prompt-required GitHub events as every non-comment event, which
    incorrectly included `pull_request` even though runtime uses the default
    "Review this pull request" prompt there. Runtime now publishes
    `PROMPT_REQUIRED_EVENTS` as the single source, document-health separates
    non-comment workflow examples from truly prompt-required events, and the
    public README/docs continue to state that only `issues`, `schedule`, and
    `workflow_dispatch` require a prompt.
32. The same review found current architecture chapter 07 still described
    `messages` / `agentEvents` proxy as a temporary current observation surface
    while later forbidding compatibility read-only proxies. Chapter 07 now marks
    P1/P2 as migration sequence records only and states that the active contract
    is the P3/P4 post-migration state with no `messages` / `agentEvents` proxy.
33. A later MCP contract review found overlay browser fixtures and the Chinese
    MCP server docs still expressed remote MCP entries without the required
    explicit `transport` field. Browser fixtures now include
    `transport: "streamable-http"`, the Chinese field table lists
    `transport`, and document-health rejects remote browser fixtures that place
    `url` immediately after `type: "remote"` without an explicit transport.
34. Browser validation then found `controls.test.ts` still used older fixture
    contracts for `/skill/mounts`, conversation hydrate payloads, interaction
    ordering, and the file changes surface. The fixture now returns the current
    skill mount matrix source (`skills` from the installed skill data), supplies
    strict conversation `view` / `agentView` / `history` / `messageWatermark`
    fields with message IDs and order keys, gives pending interactions their
    required `orderKey`, and opens the Diff activity before asserting file
    change rows.
35. A later current-architecture review found the overview SVG diagrams still
    presented the deleted Gateway Agent / `channel_key` /
    `session_gateway_singleton_idx` model as current. The agent/control/data
    diagrams now show `ControlMessage`, `PanelCapabilityRegistry`, current
    session ownership, and the workspace route proxy instead; document-health
    rejects those retired Gateway/session tokens in the SVG diagrams. The
    edited SVGs were XML-parsed and rendered with Node-driven Playwright into
    `.scratch/architecture-svg-render/` for visual review, including a follow-up
    pass that shortened overflowing data-plane labels.
36. A follow-up architecture SVG review found `01-agents.svg` still showed the
    migrated execution chain as current: deleted service/task-loop/build-dispatch
    paths, `GoalPool`, pipeline executor wording, and old Planner/Acceptance
    agent boxes. The diagram now mirrors the current architecture chapter with
    `task-api/index.ts`, `orchestrator/loop.ts`, direct build workflow dispatch,
    `orchestrator/tools.ts`, `goal/runner.ts`, `executor/registry.ts`, and the
    current frontend-research, workload-analysis, integrity, and visual QA
    review surfaces. `03-control.svg` also names `task-api/index.ts` as the
    EngineService entry. Document-health rejects those stale SVG execution-path
    tokens and asserts the current paths remain present.
37. The next historical-doc validation found the new browser-preview reference
    regions record still described a deleted root-level tv2ainvest spec record
    as a repository path. The record now keeps that as a natural-language
    missing-source fact instead of publishing a retired root `specs/*.md` path.
38. The broader document-health run then found current architecture chapter 10
    still included the destructive hard-reset command string while describing
    worktree lifecycle validation. The validation item now describes the
    prohibited destructive history-reset behavior without publishing the exact
    command as current architecture text.
39. A later independent Visual QA review found accepted reference-parity reports
    could cite non-formal or unreadable evidence refs while downstream workflow
    projection still treated the self-reported report as accepted. Visual QA now
    records both the submitted report and an effective acceptance record, invalid
    or incomplete reference-comparison refs become blockers, orchestrator
    decision-log rows persist the combined record, and workflow projection reads
    that effective acceptance record instead of recomputing from report text.
40. A later current-architecture review found `02-data.svg` still showed the old
    process-table data model, `09-verification-evidence.md` still carried a
    superseded implementation plan, several current architecture chapters still
    used dated progress/status headings, and markdown current chapters still
    published deleted execution-path filenames. The data diagram now shows the
    current engine/artifact-centric model, verification evidence is documented
    as a current `engine_artifact` contract, dated progress headings were
    rewritten as current-state boundaries, deleted execution-path filenames were
    replaced with natural-language deleted-module references, and
    document-health rejects those drift patterns.
41. A fresh Visual QA review found the first effective-acceptance repair still
    let host-required reference parity pass through supporting evidence fields,
    allowed missing authoritative required regions as advisory-only, let
    corrupt browser-preview artifacts abort report submission, and projected
    workflow status from both report fields and the acceptance record. Visual QA
    now treats only `reference_parity.reference_comparison_evidence_refs` as
    formal comparison refs, converts host-required parity contract violations
    and unreadable evidence into blockers, records corrupt evidence as an
    effective failure, and workflow projection reads only the persisted
    effective acceptance record.
42. A fresh current-architecture/overlay review found `07-panel-reactivity.md`
    still read as a migration plan, future-only agent/card/runtime plans were
    indexed as current source of truth, pre-June dated current-state banners
    remained, and verification evidence described `acceptance/arbiter.ts` as a
    workflow gate. Current architecture chapters 07/11/12/14 were rewritten as
    current runtime contracts, the dated banner and gate wording were removed,
    and document-health rejects these future-plan and stale-overlay patterns.
43. The same review found Recall governance only checked a fixed three-record
    allowlist and the MCP transport selector lacked a browser regression.
    Historical-docs now enumerates all `2026-06-29*.md` records for `## Recall`,
    missing current-day records were backfilled, and
    `skill-mcp-panel-browser.test.ts` opens Add MCP, verifies the visible
    transport selector/options, selects SSE, and asserts the config patch
    persists the selected transport before connecting the server.
44. A follow-up prompt calibration found the current architecture had removed
    workflow gate wording while live workflow and core prompts still described
    integrity as a final gate. The prompt text now describes integrity as the
    final review boundary / acceptance authority, keeping the same post-build
    evidence requirement without publishing a gate mechanism.
45. Document validation exposed a tooling-scale bug in the `.scratch` retired
    spec scan: JS walked about 25k local scratch files and read text contents
    directly, timing out before it could report real offenders. The scanner now
    keeps JS traversal for path/name violations and uses `rg --pcre2
--files-with-matches` as the single content search engine, excluding only
    generated dependency/build cache directories.
46. The next independent current-architecture review found chapter 16 still
    carried a dated pre-June implementation plan and chapter 10 still described
    destructive reset / gate-era lifecycle language as current. Chapters 10 and
    16 were rewritten as current contracts, and document-health now rejects
    those retired reset, gate, dated-plan, and per-stage commit/tag tokens in
    current architecture chapters.
47. The final overlay fixture/protocol review found old `/skill/mounts`
    grouped payloads, retired conversation hydrate shapes, missing selected
    task `time.started`, message-card fixtures that asserted render targets
    before displayable message parts, and task-list/browser races masked by
    old fixture assumptions. Browser and unit fixtures now use the current
    skill mount matrix and `TaskConversationView` shape, active task boards
    carry `time.started`, visible message parts precede rendered-card
    assertions, task-list projection invalidates correctly without starving
    in-flight first-page loads, task queue decisions wait for the real POST,
    and queued task fixtures include backend priority/order.
48. MCP validation exposed a cross-file test isolation bug: `headers.test.ts`
    loaded MCP with transport mocks that were not OAuth-route compatible and did
    not dispose project instances, so `mcp-routes.test.ts` reused a poisoned MCP
    module when both files ran in one Bun process. The header transport mock now
    supports the same OAuth redirect/finish contract as route tests and cleans
    OAuth callback state and project instances after each test.
49. Mission route validation exposed a test-data lifecycle violation: route
    projection tests directly inserted orphan active Mission tasks before
    request bootstrap, so engine liveness correctly woke background task loops
    and the next database reset hit a locked SQLite WAL file. The route tests
    now use queued/completed Mission rows for projection/status coverage and
    queued child rows for abort cancellation coverage, leaving active-task
    recovery behavior owned by the engine restart tests.
50. A fresh independent documentation/fixture audit found current architecture
    still had broken June-record links, an obsolete Agent Tool Adapter chapter,
    a future-protocol communication matrix, stale TaskBoard field shapes, and
    overlay browser fixtures that mutated retired board lanes instead of
    `goalWorkflows`. The architecture links now target the month record tree,
    chapter 08 is the current `AgentToolPool` contract, chapter 13 is a
    current-only communication matrix, chapter 07 matches the active
    `TaskBoard` schema, `controls.test.ts` exercises `goalWorkflows` and the
    current `/skill/mounts` pool rows, and document-health / historical-docs
    tests guard those contracts. The same audit found browser MCP node
    launcher secondary termination paths; the launcher now uses exactly one
    platform-specific termination strategy and no `child.kill` secondary path.
51. The next independent architecture/index review found current config docs
    still published retired `assistant.acceptance{}` / `max_retries`, chapter
    07 still used redesign-plan headings inside current architecture, and the
    architecture README still described chapter 08 as an include/exclude
    adapter. Chapter 05 now lists only current `assistant` config keys and
    marks `assistant.acceptance{}` as deleted, chapter 07 uses current surface
    ownership/configuration headings and the current Acceptance Visual
    threshold row, the architecture index names the `AgentToolPool` contract,
    and document-health rejects the stale config/index/plan wording.
52. A follow-up overlay/schema review found the backend emitted
    `goalRunID` and `acceptanceSpecs` on `goalWorkflows` while the
    `TaskBoardGoalWorkflow` schema omitted both, the browser controls fixture
    still used stale timeline ranks and a message-domain interaction order key,
    and chapter 07 still documented old `workflow`, `planNodes`, and
    `goalRuns` shapes. The schema now includes the overlay-consumed fields,
    overlay contract tests parse those fields, the fixture uses the production
    session/board/interaction order-key domains and ranks, chapter 07 matches
    the active `TaskBoard` schema, and document-health guards these contracts.
53. A later prompt/docs review found gate-era wording still exposed through
    prompt tests and active docs: benchmark docs called quality evidence checks
    "quality gates", current architecture assigned visible-tool ownership to
    generic tool adapters instead of `AgentToolPool`, config/panel docs called
    `acceptance_visual` hard-threshold gates, and the orchestrator prompt still
    listed `git reset --hard` / `git reset --merge` as merge-repair commands.
    The prompt now forbids `git reset` in the merge repair surface, frontend
    evidence tools are documented as bounded lifecycle stages rather than
    gates, current architecture and public docs use the active ownership and
    evidence-threshold wording, and prompt/document-health tests reject these
    retired phrases.
54. A fresh independent review found current architecture still carried
    migration phrasing (`Phase 2`, `Phase 5`, and "本方案执行后"), chapter 07
    still omitted current `TaskBoard` schema fields, card-tree docs/source
    comments still described retired per-attempt step-card ids, the benchmark
    quality checker still used quality-gate names in active code/docs/tests, the
    Chinese LSP docs described silent fallback behavior, and
    `product-docs-single-source.test.ts` asserted a brittle one-line schema
    declaration. Current architecture now uses current-state wording, chapter
    07 lists the active workflow/goal workflow/payload fields, card identity is
    documented as attempt-invariant `step:<goalID>:<stepID>`, the benchmark
    module/test/docs use `quality-checks` / `evaluateQualityChecks`, Chinese LSP
    docs state that missing servers produce no semantic diagnostics, and the
    product-docs test verifies the `TaskMessageInput` schema behavior instead of
    source formatting.
55. A final GitHub/overlay fixture review found the GitHub Action PR path still
    had fallback behavior around remote commit detection and PR creation, and
    overlay browser fixtures still drifted from the current conversation/SSE
    contracts. GitHub Action PR creation now uses the GitHub compare API as the
    single ahead-commit source, propagates PR list/create failures, and rejects
    zero-ahead branches before PR creation. The compact, rewind, and screenshot
    browser fixtures now use the current `TaskConversationView` and order-key
    shapes, selected tasks carry `time.started`, `/skill/mounts` returns the
    current mount matrix payload, SSE replay uses real event sequence cursors,
    compact visual stress validates the legal `1120px` minimum overlay shell
    instead of the retired 390px raw viewport assertion, and the test-side
    browser error collector allows only the exact SSE close failures produced
    by those long-lived event streams.
56. The next final-readiness agent round found three remaining validation
    gaps: Recall governance was present in `AGENTS.md` but not mirrored in the
    spec READMEs, GitHub Action tests still lacked compare/create API failure
    coverage, and compact/rewind browser fixtures could project zero-time
    sessions for hidden messages. The three spec README rule sections now
    carry the same Recall governance, `historical-docs-links.test.ts` asserts
    it across all governance files, GitHub Action tests cover PR list, compare,
    zero-ahead, and create failure surfaces with visible comments and failed
    action status, and compact/rewind conversation fixtures project sessions
    only from visible message evidence. `document-health.test.ts` rejects the
    retired zero-time session fallback patterns.
57. The next repeat audit found one current-day June record missing from the
    month README index. `specs/records/2026-06/README.md` now links
    `2026-06-29-frontend-design-visual-evidence-capture-mode.md`, keeping the
    month index aligned with `historical-docs-links.test.ts`.
58. The overlay repeat audit then found compact/rewind fixtures still derived
    `topLevelSessionIDs` from parentlessness instead of the production
    `placement === "top_level" && messageIDs.length > 0` rule. Both fixtures
    now match `projectConversationView`, and document-health rejects the
    retired parentless derivation pattern.

Validation after addenda 56-58 includes:

- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- `bun test packages/opencorvus/test/cli/github-action-run.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts packages/opencorvus/test/mcp/remote-transport-config.test.ts packages/overlay/test/mcp-service.test.ts packages/overlay/test/project-directory-request-loop.test.ts`
- `bun test packages/opencorvus/test/mcp/headers.test.ts ./packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts packages/opencorvus/test/mcp/remote-transport-config.test.ts packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/util/timeout.test.ts`
- `bun test packages/opencorvus/test/server/mission-routes.test.ts packages/opencorvus/test/server/session-routes.test.ts`
- `bun test packages/overlay/test/sse-active-elapsed.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts`
- `bun test packages/opencorvus/test/provider/models-snapshot.test.ts packages/opencorvus/test/provider/transform.test.ts`
- `bun test packages/opencorvus/test/session/model-image-input.test.ts packages/opencorvus/test/session/message.test.ts packages/opencorvus/test/mcp/browser-tools-resource.test.ts`
- `bun run --cwd packages/overlay test:browser test/browser/task-status-header-missing-completion-browser.test.ts`
- `bun run --cwd packages/overlay test:browser test/browser/skill-mcp-panel-browser.test.ts test/browser/controls.test.ts test/browser/command-palette.test.ts`
- `bun run docs:check`
- `bun run api:routes-check`
- `bun run typecheck`
- `bun run overlay:i18n-check`
- `git diff --check`
- Visual QA effective acceptance focused tests:
  `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts`
  and `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t visual_qa`
- Static/visual architecture SVG checks: `rg` confirmed the retired Gateway and
  migrated execution-path diagram tokens are absent, PowerShell XML parsing
  accepted `01-agents.svg` / `02-data.svg` / `03-control.svg`, and Node
  Playwright rendered the diagrams to PNG for direct visual inspection.
- Visual QA: Vite preview on `127.0.0.1:5178` with an isolated mock backend on
  `127.0.0.1:7878`; MCP Servers panel Add MCP form screenshot confirmed visible
  `Transport` selector, `Streamable HTTP` selected option, `SSE` option in DOM,
  and no literal `<em>*</em>` label text.
59. The next independent agent round found four current drift classes.
    Ampere found the INFORMATION MISSING debug toggle still injected host-side
    prompt text, detected stream markers, exposed overlay controls, and
    persisted `assistant.debug.fail_on_information_missing`; that host
    prompt-injection/stream-marker mechanism is now deleted from runner,
    orchestrator, config schema, overlay UI/i18n, and old positive tests, with
    an absence guard covering active source and tests. Rawls found MCP browser
    sessions still used `BROWSER_PROXY` as an env fallback and active benchmark
    scripts still published gate-era comments; MCP browser proxy is now only
    the explicit session `proxy` input, shared BrowserRuntime ignores the
    private browser proxy env name, and active benchmark scripts/document-health
    use visual/check wording. Dewey and Linnaeus found chapter 07, controls
    fixtures, `board.ts`, and `tree-writer.ts` still described old
    Plan/Execute/Eval or per-attempt step-card identities; chapter 07 now lists
    current TaskBoard top-level fields, the controls fixture uses
    `goalLoopStepIDs: ["build"]` plus `stepID: "build"` / `label: "Executor"`,
    and source comments describe attempt-invariant `step:<goalID>:<stepID>`
    cards with `goalRunID` as board/diff context.

Validation after addendum 59:

- `bun test packages/opencorvus/test/agent/information-missing-removed.test.ts packages/opencorvus/test/browser/runtime.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/benchmark/quality-checks.test.ts`
- `bun test packages/opencorvus/test/server/config-routes.test.ts`
- `bun test test/general-panel-notification-single-source.test.ts` from `packages/overlay`
- `node test/browser-runner.mjs test/browser/controls.test.ts test/browser/general-panel-fail-fast-browser.test.ts` from `packages/overlay`
- `bun run api:routes-check`
- `bun run docs:check`
- `bun run typecheck`
- `bun run overlay:i18n-check`
- `git diff --check`

60. The post-addendum readiness pass found two residual validation issues after
    the INFORMATION MISSING removal: mission and overlay benchmark config
    writers still emitted the deleted `assistant.debug.fail_on_information_missing`
    surface, and document-health's goal-phase/top-level-session scanner crossed
    into the next `sessionID`, creating a false positive against current
    conversation fixtures. The benchmark config writers now emit no debug
    block, the INFORMATION MISSING absence test scans benchmark scripts, and
    document-health scopes goal-phase session detection to one session object.

Validation after addendum 60:

- `bun test packages/opencorvus/test/agent/information-missing-removed.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/benchmark/quality-checks.test.ts packages/opencorvus/test/server/config-routes.test.ts`
- `bun test test/general-panel-notification-single-source.test.ts` from `packages/overlay`
- `node test/browser-runner.mjs test/browser/controls.test.ts test/browser/general-panel-fail-fast-browser.test.ts` from `packages/overlay`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- `bun run api:routes-check`
- `bun run docs:check`
- `bun run typecheck`
- `bun run overlay:i18n-check`
- `git diff --check`

61. The next final confirmation round had two agents report no blockers and one
    overlay fixture blocker. `screenshot-browser-panel-browser.test.ts` still
    put a `placement: "goal_phase"` build session into `topLevelSessionIDs`,
    unlike the production `placement === "top_level" &&
    messageIDs.length > 0` projection used by both conversation views. The
    fixture now derives `topLevelSessionIDs` from the same production
    predicate, and document-health now rejects goal-phase session IDs listed in
    top-level literal arrays, the screenshot fixture's retired hard-coded
    session ID, and removal of the agent-compact browser error collector
    assertion.

Validation after addendum 61:

- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/overlay test:browser test/browser/screenshot-browser-panel-browser.test.ts`

62. The next specs/governance audit found chapter 07 still listed retired
    Appearance controls (`Opacity`, `Always on Top`), described
    `workflow.step.updated` as covering an `acceptance` stage, and used
    `goal.*` as a vague current event family. Chapter 07 now lists only the
    current Appearance controls, names workflow step examples as
    requirements / architect / build / visual_qa / integrity, and says
    `GoalWorkflowGroup` refreshes through `goal.workflow.progress`,
    `workflow.step.updated`, and task board rebuild events. Document-health now
    rejects the retired controls, old acceptance-stage wording, and `goal.*`
    event shorthand in the current panel architecture chapter.

Validation after addendum 62:

- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

63. The main-agent recall pass found this task record had inserted the
    specs/governance audit inside the previous validation list and reused
    addendum number 60 for later entries. The record now keeps later addenda in
    chronological order, and `historical-docs-links.test.ts` asserts the
    numbered addenda in this migration record remain unique and contiguous.

Validation after addendum 63:

- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

64. The follow-up document-health run exposed two overlay fixture drift classes
    while validating the addendum numbering guard: tree-writer message/perf
    helpers still converted missing message creation times to `0`, and the
    conversation-view top-level scanner treated variable-backed session arrays
    and identifier-backed `messageIDs` as literal empty sessions. The overlay
    helpers now require finite `time.created` evidence before projecting view
    messages, and the document-health scanner validates top-level session IDs
    only inside literal `sessions: [...]` view objects while counting
    identifier entries such as `messageIDs: [messageID]`.

Validation after addendum 64:

- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

65. The next independent confirmation round found three blocker classes.
    Popper found lifecycle-only and goal-phase conversation fixtures still
    listed sessions in `topLevelSessionIDs` without the production
    `placement === "top_level" && messageIDs.length > 0` evidence, and found
    one hydrate helper still converting missing message time to zero. Those
    fixtures now leave lifecycle-only / goal-phase scoped views out of
    `topLevelSessionIDs`, `conversation-view-hydrate.test.ts` requires a
    positive `info.time.created`, and document-health structurally rejects
    literal conversation views whose top-level session IDs point to missing,
    non-top-level, or empty-message sessions. Hilbert found the spec storage
    model was still June-only in README text and tests despite the `YYYY-MM`
    rule. The root and architecture READMEs now describe monthly records as
    `specs/records/YYYY-MM/`, and `historical-docs-links.test.ts` allows and
    verifies monthly record paths while still keeping the June index checks for
    the current migration batch. Raman found MCP browser sessions still let
    BrowserRuntime read standard proxy env vars at launch when the session did
    not provide `proxy`. MCP browser launch now uses env-independent shared
    launch args, with session proxy remaining only on the explicit Playwright
    context proxy input, and browser-session lifecycle tests lock that contract.

Validation after addendum 65:

- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/conversation-view-hydrate.test.ts`
- `bun test packages/opencorvus/test/mcp/browser-session-lifecycle.test.ts packages/opencorvus/test/browser/runtime.test.ts`

66. The next independent confirmation round found three remaining guard gaps.
    Einstein found the previous record repair had produced a malformed `$165:`
    heading, current architecture text and the Enterprise Architecture Explorer
    still treated `specs/records/2026-06/**` as a category rather than a
    concrete historical path, and the addendum guard did not reject malformed
    headings or dangling validation labels. The task record now restores
    addendum 65, current-category prose uses `specs/records/YYYY-MM/**`, and
    `historical-docs-links.test.ts` rejects malformed `$<number>:` headings and
    validation labels that do not point at an existing addendum number.
    Lovelace found the MCP browser proxy regression only covered the explicit
    proxy path. `browser-session-lifecycle.test.ts` now separately proves that
    `HTTPS_PROXY` is ignored by MCP browser launch and context creation when
    `session_create.proxy` is omitted, while the explicit proxy path remains
    context-only.

Validation after addendum 66:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- `bun test packages/opencorvus/test/mcp/browser-session-lifecycle.test.ts packages/opencorvus/test/browser/runtime.test.ts`

67. The Pascal/Dirac/Halley independent audit round found three drift groups.
    Pascal's retired TaskBoard lanes/cards, per-run step card id, and
    per-attempt `goalRunID` findings are now covered by active grep evidence
    and document-health guards; no active overlay source keeps those retired
    shapes. Dirac's exact gate-era symbols (`goal_gate`,
    `AcceptanceGateVerdict`, `finalGate`, `arbitrateAcceptanceGate`) no longer
    appear in active source, tests, SDK, OpenAPI, web docs, or current specs.
    Halley's current-architecture blocker was still active: chapter 01,
    chapter 04, chapter 13, and the architecture SVGs still assigned executor
    ownership to `goal/runner.ts` or listed `opencode` as a current executor.
    Current architecture now names `build/agent.ts` plus
    `executor/registry.ts` as the build/executor path, keeps
    `goal/runner.ts` only as `cleanupGoalWorkspace`, aligns executor docs with
    the `opencorvus` / `codex` / `claude-code` contract, and
    document-health rejects the retired chains.

Validation after addendum 67:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/conversation-view-hydrate.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/fixtures/goal-phase-events.ts`
- `bun test packages/opencorvus/test/mcp/browser-session-lifecycle.test.ts packages/opencorvus/test/browser/runtime.test.ts`

68. The overlay fixture confirmation round found one remaining exact-projection
    drift and additional zero-time fixture helpers. `conversation-hydrate-replay`
    now lists `ses_root` in `topLevelSessionIDs` when the same literal view has
    a visible top-level `ses_root` session, `conversation-agent-rail-records`
    and `goal-phase-events` require positive fixture timestamps instead of
    converting missing time to zero, the canonical goal-phase replay fixture
    keeps the current single build phase with explicit part `time.created`
    evidence, and document-health compares literal
    `topLevelSessionIDs` against the exact production projection. The same
    validation pass exposed Enterprise Architecture Explorer artifact drift;
    its `currentEngineArtifactKinds` list now includes
    `design_resource_manifest` from the engine artifact source.

Validation after addendum 68:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/conversation-view-hydrate.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/fixtures/goal-phase-events.ts`
- `bun test packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/board-projection-sync.test.ts`

69. Revalidation after addendum 68 exposed the deeper source of the retired
    planner phase drift: overlay `goalStagePhaseID()` still mapped `planner`
    to `build.plan`, while the backend pipeline declares only one build phase.
    The overlay mapping now recognizes only the current build phase, production
    projection fixtures and stats tests no longer manufacture a per-goal plan
    phase, backend `projectPhases()` mirrors the current single-phase build
    status instead of the retired plan/build/evaluate cascade, and
    document-health rejects the old planner-phase mapping and wording. The
    same validation pass found Windows `EBUSY` cleanup in acceptance isolated
    check workspaces because the inactivity runner returned on child `exit`
    before process handles fully closed. The runner now resolves on `close`,
    waits for process handles after inactivity kills, and its test verifies the
    working directory can be removed immediately after return.

Validation after addendum 69:

- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts`
- `bun test test/board-projection-sync.test.ts test/tree-writer-hierarchy.test.ts test/conversation-view-hydrate.test.ts test/conversation-agent-rail-records.test.ts test/tree-writer-stats-cache.test.ts test/build-phase-promotion.test.ts` from `packages/overlay`
- `bun test packages/opencorvus/test/acceptance/inactivity-timeout-process.test.ts`
- `bun test packages/opencorvus/test/acceptance/project-assessment.test.ts -t "functional assessment keeps readiness primary"`
- `bun test packages/opencorvus/test/acceptance/arbiter.test.ts packages/opencorvus/test/acceptance/project-assessment.test.ts packages/opencorvus/test/acceptance/test-integration-review.test.ts packages/opencorvus/test/orchestrator/build-feedback-context.test.ts packages/opencorvus/test/orchestrator/tools.test.ts -t acceptance`
- `bun run docs:check`
- `bun run api:routes-check`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run overlay:i18n-check`
- `git diff --check`

70. The Goodall/Planck/Singer independent audit round found no remaining spec
    storage blocker from Goodall, but exposed two active drift classes. Planck
    found overlay board fixture stampers still synthesized order evidence from
    defaults or parent objects. The shared fixture stampers now fail loudly
    unless task, workflow step, goal, goal step, phase, interaction, message,
    and part records either carry their own backend orderKey or an explicit
    positive time field; affected fixtures now provide those exact order/time
    facts. Singer found chapter 01 and the control SVG still presented retired
    typed task-loop triggers, `workspace-server` proxy/adaptor paths, and
    `Trace.event()` as current. The current architecture docs now describe the
    task-loop input as free-form task events, the workspace/control surface as
    `workspace/` metadata plus `server/routes/*` and `util/sse.ts`, and tracing
    as `AgentTrace.record*` sinks. Document-health now rejects the retired
    trigger, proxy, trace, and fixture time fallback strings.

Validation after addendum 70:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/conversation-view-hydrate.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/fixtures/goal-phase-events.ts packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/board-projection-sync.test.ts`
- `bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/tree-writer-delta-order-stability.test.ts packages/overlay/test/tree-writer-message-tokens.test.ts packages/overlay/test/tree-writer-perf.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/status-labels.test.ts`

71. The Mendel/Euler/Socrates independent audit round found four remaining
    drift classes. Mendel found chapter 01, the agents SVG, provider docs, and
    GitLab Auth plugin docs/source still exposed old dispatch/opencode names.
    The current architecture now uses `host-side dispatch branch`, names the
    executor set as `opencorvus` / `codex` / `claude-code`, removes the
    provider "opencode same-source" claim, and the plugin source/public docs
    import the internal package as `@gitlab/opencorvus-gitlab-auth`. The
    registry has no real `@gitlab/opencorvus-gitlab-auth` package on
    2026-06-29, so `packages/opencorvus/package.json` uses an npm alias while
    `bun.lock` records the real upstream tarball; guards cover source and
    public docs rather than the package-manager resolution fact. Euler found
    retired plan/build/evaluate phase wording and fixture guard gaps. The
    remaining comments/fixtures now describe the current single `build` phase,
    `tree-writer-hierarchy.test.ts` is covered by document-health, and regex
    guards reject the spaced and line-broken retired phase forms. Socrates
    found `ReviewStreamPhase` still exposed `"acceptance"`, acceptance/export
    tests still used gate-era wording, `review-verdict.ts` described legacy
    re-exports, and `html-skeleton-workflow-check.ts` had default numeric
    threshold/timeouts. Review-stream schema, helpers, SDK, and OpenAPI are now
    integrity-only; artifact export feedback no longer uses publish-gate names;
    acceptance project assessment comments/tests use evidence-decision wording;
    and the HTML skeleton workflow CLI now requires explicit `--threshold`,
    `--worst-threshold`, and `--browser-launch-timeout-ms`.

Validation after addendum 71:

- `bun install --lockfile-only`
- `bun test packages/opencorvus/test/plugin/defaults.test.ts packages/opencorvus/test/acceptance/arbiter.test.ts packages/opencorvus/test/benchmark/html-skeleton-workflow-check.test.ts packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts`
- `bun test packages/opencorvus/test/acceptance/project-assessment.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/acceptance/project-assessment.test.ts -t "skips discovered lint|source snapshot" --timeout 30000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "artifact export"`
- `bun test packages/opencorvus/test/script/routes-check-openapi.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/sdk-build-transaction.test.ts packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts`

72. The Leibniz/Darwin/Tesla/Gauss confirmation round found no new spec or
    plugin-doc blockers from Leibniz and Darwin, but Tesla found two active
    acceptance files still describing the current evidence arbiter as legacy,
    and Gauss found two overlay message-token helpers still synthesizing time
    evidence plus one panel-reactivity paragraph still implying board-workflow
    ordering for top-level step cards. Acceptance type comments and arbiter
    test names now use current evidence-decision wording. The live
    conversation-agent test helper requires explicit positive
    `info.time.created`, the message-token part helper requires explicit
    message and part times, and the message-token board fixture now carries an
    explicit task `orderKey` before the shared fixture stamper accepts it. The
    panel-reactivity chapter now states that all participating top-level card
    families share the backend `orderKey` axis, with goal-phase claimed
    sessions excluded from that stream. Document-health rejects the retired
    legacy wording, message-time defaults, and old board-workflow ordering
    sentence.

Validation after addendum 72:

- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/acceptance/arbiter.test.ts`
- `bun test test/conversation-agent-rail-records.test.ts test/tree-writer-message-tokens.test.ts` from `packages/overlay`

73. The broader post-addendum validation exposed two remaining generated-doc
    and fixture-evidence gaps. The overlay hierarchy and stats-cache tests had
    board snapshots where specific goal, step, phase, and interaction records
    still lacked explicit backend order keys even though the shared fixture
    stampers now correctly reject synthesized order. Those records now carry
    `board` or `interaction` domain order keys based on their own evidence
    timestamps. `docs:check` also showed the generated API reference markdown
    had drifted from the current route renderer; the English and Chinese API
    reference pages were regenerated through
    `packages/opencorvus/script/docs/render-api-md.ts` as the single source.

Validation after addendum 73:

- `bun test test/board-projection-sync.test.ts test/tree-writer-hierarchy.test.ts test/conversation-view-hydrate.test.ts test/conversation-agent-rail-records.test.ts test/tree-writer-stats-cache.test.ts test/build-phase-promotion.test.ts test/tree-writer-message-tokens.test.ts` from `packages/overlay`
- `bun run docs:check`
- `bun run api:routes-check`
- `bun run overlay:i18n-check`
- `bun run typecheck`
- `git diff --check`

74. The Curie/Aquinas/Avicenna/Lagrange audit round found four remaining
    calibration groups after addendum 73. Curie found gate-era naming still in
    publish/export tests, compaction evidence text, and the inactivity config
    description. Those tests and generated docs now use artifact export,
    evidence-decision, and inactivity-threshold wording, with SDK/OpenAPI/API
    markdown regenerated from the current sources. Aquinas found public
    benchmark docs that omitted the required verify/reference-image inputs,
    GitLab Auth docs that failed to explain the npm alias boundary, and the
    HTML skeleton benchmark script lacking a visible required-flag contract;
    public docs and document-health now cover those requirements. Avicenna
    found the active executor discovery/settings path still accepting
    `opencode`; executor discovery, overlay settings, and tests now accept only
    `opencorvus`, `codex`, and `claude-code`. Lagrange found overlay owner
    drift and fixture synthesis: message/part route owners, goal workflow
    `orderIndex` / `retryCount`, phase definitions, build phase session
    ownership, prune card times, and panel identity docs are now explicit and
    fail-loud. The phase owner updater also now advances
    `phaseSessionOrderKey` for newer messages from the same phase session so
    older replacement sessions cannot retarget an attempt-invariant phase card.

Validation after addendum 74:

- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/sdk-build-transaction.test.ts packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts packages/opencorvus/test/benchmark/html-skeleton-workflow-check.test.ts packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts packages/opencorvus/test/plugin/defaults.test.ts packages/opencorvus/test/server/conversation-view.test.ts`
- `bun test test/tree-writer-hierarchy.test.ts test/tree-writer-stats-cache.test.ts test/board-projection-sync.test.ts test/conversation-view-hydrate.test.ts test/store-card-tree-prune.test.ts test/conversation-agent-rail-records.test.ts test/tree-writer-message-tokens.test.ts test/executor-settings.test.ts` from `packages/overlay`
- `bun test packages/opencorvus/test/acceptance/arbiter.test.ts packages/opencorvus/test/acceptance/project-assessment.test.ts packages/opencorvus/test/acceptance/test-integration-review.test.ts packages/opencorvus/test/engine/publisher-acceptance-export.test.ts packages/opencorvus/test/orchestrator/loop-prepare-baseline.test.ts packages/opencorvus/test/session/compaction.test.ts packages/opencorvus/test/orchestrator/tools.test.ts -t "artifact export|acceptance|compaction|baseline"`
- `bun run docs:check`
- `bun run api:routes-check`
- `bun run overlay:i18n-check`
- `bun run typecheck`
- `git diff --check`

75. The Plato/Archimedes/Dirac audit round found remaining active-contract
    drift after addendum 74. Plato found benchmark comments still publishing
    gate-era and no-auto-verify wording; overlay benchmark comments and public
    docs now describe explicit verification inputs, document-health checks the
    benchmark scripts directly, and the reference-image auto verify path
    requires `--threshold`, `--worst-threshold`, and
    `--browser-launch-timeout-ms`. Dirac found the benchmark executor cast,
    mission benchmark default verify command, visual-diff default thresholds,
    visual metric `gates` API field, and current OpenCode test names/fixture
    paths. The benchmark CLI now validates the three executor names, mission
    benchmark fails without `--acceptance-verify-cmd`, visual-diff requires all
    numeric thresholds, visual metric results expose `checks`, and current
    tests/source comments use OpenCorvus/project wording. Archimedes found
    overlay phase cards and part-first message times were still synthesized
    from local event order or board-missing stubs. Tree-writer now derives
    part-first time from the backend message `orderKey`, requires backend
    board phase projection and build session ownership before a goal build
    message can claim a phase card, treats unknown goal-owned stages as
    bridge/workflow drift, and keeps `executor` as the explicit non-rendering
    goal container. Related rail and hierarchy fixtures now provide board
    phase/session ownership before goal build messages.

Validation after addendum 75:

- `bun test test/tree-writer-hierarchy.test.ts test/tree-writer-stats-cache.test.ts test/conversation-agent-rail-records.test.ts` from `packages/overlay`
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts packages/opencorvus/test/benchmark/mission-benchmark.test.ts packages/opencorvus/test/acceptance/visual-metric.test.ts packages/opencorvus/test/engine/lkg-isolated-eval.test.ts`

76. The Descartes/Mencius/Linnaeus audit round found no docs/spec/API
    blockers from Descartes, but found two remaining active-contract groups.
    Mencius found `renderedConversationCardTargetForGoalPhase()` still using
    explicit `stepID` / `phaseID` as a second source when `stage` was also
    present. Goal-phase target projection now resolves the workflow phase from
    `stage` first, treats explicit phase fields only as consistency evidence,
    rejects partial or conflicting explicit phase inputs, and rail hydration
    passes the session stage into the same check. Linnaeus found active
    benchmark/acceptance/executor/docs drift: `capture-gate` naming in active
    reference capture imports, old host deterministic field names in
    acceptance contract comments, optional programmatic browser-launch timeout
    in the HTML skeleton workflow check, default web-clone E2E visual
    thresholds, the overlay benchmark default task brief, arbitrary executor
    strings in runtime model env helpers, and public SDK OpenCode wording.
    Active reference capture moved to `frontend-design/reference-capture`,
    acceptance comments no longer publish removed field names, HTML skeleton
    workflow programmatic and CLI paths require explicit positive thresholds
    and browser timeout, web-clone E2E visual inputs require explicit env
    values, overlay benchmark requires `--request-file` or
    `--request-attachment` and rejects empty request files, executor model env
    helpers reuse the `ExecutorName` enum boundary, and SDK docs use
    legacy-prefix wording without naming retired OpenCode exports.
    Document-health and focused tests now guard these contracts.

Validation after addendum 76:

- `bun test test/conversation-agent-rail-records.test.ts` from `packages/overlay`
- `bun test packages/opencorvus/test/benchmark/html-skeleton-workflow-check.test.ts packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/executor/runtime-env.test.ts packages/opencorvus/test/frontend-design/reference-capture.test.ts packages/opencorvus/test/frontend-design/webpage-default-viewport.test.ts packages/opencorvus/test/e2e/web-clone-source-project-e2e.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/server/executor-routes.test.ts --timeout 30000`

77. The Cicero/Nietzsche/Pascal audit round found no docs/spec/API blocker
    from Cicero, but found two remaining active-contract groups. Nietzsche
    found that overlay goal-phase projection still normalized raw backend
    stage aliases before validating phase targets, so raw `coding` could
    silently claim the `build` workflow phase as a second source. Rail records
    now carry `rawStage`, hydrated and live goal-phase target projection pass
    that raw stage into the same tree-writer projection check, and the
    tree-writer keeps only explicit `executor` as the non-rendering goal
    container. Pascal found benchmark and runtime defaults plus gate-era
    active naming: mission benchmark still carried a default task request,
    visual diff and content-fingerprint programmatic inputs still defaulted
    thresholds, and JSON-RPC / LLM / build activity monitoring still exposed
    `Gate` terminology. Mission benchmark now requires a non-empty
    `--request-file`, visual diff and content fingerprint require explicit
    numeric thresholds, and the shared stream inactivity primitive plus
    SessionStatus, JSON-RPC, LLM activity, build activity, event queue, and
    tests use activity monitor wording. Document-health guards these exact
    contracts so the retired defaults and gate names cannot re-enter active
    code.

Validation after addendum 77:

- `bun test test/conversation-agent-rail-records.test.ts test/tree-writer-hierarchy.test.ts` from `packages/overlay`
- `bun test packages/opencorvus/test/benchmark/mission-benchmark.test.ts packages/opencorvus/test/runtime/visual-launch.test.ts packages/opencorvus/test/acceptance/content-fingerprint.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/util/stream-activity.test.ts packages/opencorvus/test/llm/activity.test.ts packages/opencorvus/test/session/extra-tools.test.ts --timeout 120000`

78. The Zeno/Carson/Pauli audit round found no docs/spec/API blocker from
    Zeno, but found two final active-contract groups. Carson found live
    goal-phase lifecycle-only rail updates could still retarget a rendered
    phase card without proving the backend phase session owner. Goal-phase
    target projection now requires the incoming session ID, rejects missing
    phase ownership, rejects stale session owners, and both hydrated and live
    rail paths pass the same owner evidence into tree-writer. Pauli found
    visual benchmark/runtime drift: overlay benchmark still invented an
    auto-reply for free-text interactions, `renderPage`/`runVisualDiff` still
    had optional navigation/settle defaults, and `VisualDiffReport` still used
    gate-era report wording. The benchmark now fails on free-text interactions
    that require invented input, reference-image verification requires explicit
    `--threshold`, `--worst-threshold`, `--browser-launch-timeout-ms`,
    `--navigation-timeout-ms`, and `--settle-ms`, and visual reports expose
    `checks` rather than `gate`. Public benchmark docs and document-health
    guards now lock the same explicit render-timeout contract.

Validation after addendum 78:

- `bun test test/conversation-agent-rail-records.test.ts test/tree-writer-hierarchy.test.ts` from `packages/overlay`
- `bun test packages/opencorvus/test/runtime/visual-launch.test.ts packages/opencorvus/test/benchmark/html-skeleton-workflow-check.test.ts packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`
