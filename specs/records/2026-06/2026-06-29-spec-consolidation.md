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

| Class | Count | Evidence |
| --- | ---: | --- |
| Total spec-path files | 859 | `specs/**`, `packages/*/specs/**`, and spec-named files |
| Files dated before 2026-06-01 | 68 | 61 under `specs/new-arch/**`, 6 under `packages/opencorvus/specs/**`, 1 under root `specs/**` |
| Root `specs/*` files | 37 | Root mixed historical notes and prompt artifacts |
| `specs/new-arch/**` files | 814 | Current architecture chapters mixed with dated records |
| `packages/opencorvus/specs/**` files | 8 | Package-local source that creates a second spec tree |

## Storage Model

`specs/README.md` is the only public entry point for specs.

| Path | Purpose | Rule |
| --- | --- | --- |
| `specs/current/**` | Current long-lived normative specs | Must be kept calibrated with code and AGENTS.md. |
| `specs/current/architecture/**` | Current architecture chapters and diagrams | Replaces `specs/new-arch/**`. |
| `specs/records/2026-06/**` | Dated June 2026 implementation and investigation records | Replaces root historical notes and June `new-arch` notes. |
| `specs/artifacts/**` | Task input artifacts that are not normative specs | Keeps prompt/reference inputs out of spec indexes. |

Forbidden storage after this change:

- `specs/new-arch/**`
- `packages/*/specs/**`
- Root-level spec records under `specs/*.md` except `specs/README.md`
- Any spec markdown file with a date before `2026-06-01`

## Migration Plan

| Source | Destination | Action |
| --- | --- | --- |
| `specs/current/architecture/01-*.md` through `16-*.md`, `99-principles.md`, and current SVG diagrams | `specs/current/architecture/**` | Move and rewrite local links. |
| `deleted pre-June record spec-vscode-extension` | Delete | It is a 2026-04-27 draft and fails the before-June deletion rule. |
| `specs/new-arch/2026-04-*` and `specs/new-arch/2026-05-*` | Delete | Explicitly before June. |
| `specs/records/2026-06/2026-06-*.md` and named `*-2026-06-*.md` | `specs/records/2026-06/**` | Move and rewrite references. |
| Root `specs/*-2026-06-*.md` and `specs/2026-06-*.md` | `specs/records/2026-06/**` | Move and rewrite references. |
| `specs/records/2026-06/opencorvus-research-frontend-design-boundary-2026-06-03.md` | `specs/records/2026-06/opencorvus-research-frontend-design-boundary-2026-06-03.md` | Move and rewrite references. |
| `deleted pre-June record *2026-05*` | Delete | Package-local and before June. |
| Root prompt/reference artifacts | `specs/artifacts/**` | Move out of spec indexes. |
| `specs/records/2026-06/2026-06-29-spec-consolidation.md` | Keep | This is the current task record and Recall source, not a compatibility ledger. |

## Reference Update Plan

Use whole-repository search for these names and update every live reference:

- `specs/new-arch`
- `packages/opencorvus/specs`
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

## 2026-06-29 Final Review Addendum

Independent review after the initial document calibration found one remaining
class of spec drift: active source/test comments and June records still cited
deleted pre-June spec filenames without paths. Those references were rewritten
to current behavior descriptions or current source/test ownership, not to a
compatibility ledger.

The guard was extended so bare deleted pre-June spec filenames are rejected
outside this migration evidence record and the historical document-health guard.

## 2026-06-29 Second Final Review Addendum

Independent review after the first final addendum found active overlay script,
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

Validation after these addenda includes:

- `bun test packages/opencorvus/test/cli/github-action-run.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts packages/opencorvus/test/mcp/remote-transport-config.test.ts packages/overlay/test/mcp-service.test.ts`
- `bun test packages/opencorvus/test/mcp/headers.test.ts ./packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts packages/opencorvus/test/mcp/remote-transport-config.test.ts packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/util/timeout.test.ts`
- `bun test packages/overlay/test/sse-active-elapsed.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts`
- `bun test packages/opencorvus/test/provider/models-snapshot.test.ts packages/opencorvus/test/provider/transform.test.ts`
- `bun test packages/opencorvus/test/session/model-image-input.test.ts packages/opencorvus/test/session/message.test.ts packages/opencorvus/test/mcp/browser-tools-resource.test.ts`
- `bun run --cwd packages/overlay test:browser test/browser/task-status-header-missing-completion-browser.test.ts`
- `bun run docs:check`
- `bun run api:routes-check`
- `bun run typecheck`
- `bun run overlay:i18n-check`
- `git diff --check`
