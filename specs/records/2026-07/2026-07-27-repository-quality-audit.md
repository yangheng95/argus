# Repository Quality Audit — 2026-07-27

## Status

This is a read-only, evidence-driven audit of the repository at
`ec79321f83694daa995f3b38262f91a63de8bc57` on branch `v0.0.20beta`.
No product source was changed. Four findings remain open: one high-severity
test-coverage gap, one high-severity supply-chain remediation backlog, and two
medium/low maintenance and test-portability findings. The dashboard-compatible
data companion is
[`2026-07-27-repository-quality-audit.json`](2026-07-27-repository-quality-audit.json).

## Recall

### User request

- Independently audit the current repository with real checks, evidence-backed
  findings, a durable report, and interactive-dashboard-readable data.
- Do not modify product source to conceal findings; commit and push the audit
  delivery only.

### Acceptance criteria

- Run applicable quality, test, build, static, documentation, dead-code, and
  dependency-security checks rather than only reading code.
- Give every confirmed finding an ID, severity, exact location, impact, causal
  chain, and actionable recommendation.
- Record unexecuted scope and blockers honestly; update the `specs/` indexes
  and validate the documentation health contracts.

### Hard constraints

- Do not modify product source, create a worktree, or interfere with a running
  OpenCorvus or Overlay process.
- Do not present conditional external guidance as a repository defect.
- Preserve the current worktree and use `myhexin` for the required push.

### Materials read

- `AGENTS.md`, task request, root/package manifests, CI workflow, Turbo graph,
  current architecture data/control documents, shared-package tests, MCP
  transport/runtime code, dead-code locations, and documentation-health tests.
- Durable investigation, external-research, and fact-check artifacts supplied
  with this task. The external MCP HTTP authorization requirements were treated
  as conditional; the local HTTP transport was inspected before reaching any
  conclusion.

### Whole-repository search

| Search subject                    | Result                                                                                                                                                               | Audit use                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `bun test` / CI test graph        | CI runs OpenCorvus, Channel Runtime, Overlay unit/browser, GUI smoke, and project-open; it does not invoke SDK, plugin, transport-protocol, or util behavior suites. | AUD-001                  |
| Shared-package imports            | Core engine, task API, server, worktree, and tool paths import SDK, plugin, transport-protocol, or util contracts.                                                   | AUD-001 impact           |
| `packagedNodeRuntimePaths`        | The only production caller derives the platform from the host; the test injects `win32` while running host `node:path`.                                              | AUD-002 scope            |
| Knip findings                     | TerminalPanel/terminal have test references but no production import; Channel Runtime declares util without a source import; process supervisor invokes `ps`.        | AUD-003                  |
| MCP server/transport construction | Browser HTTP creates a new MCP server and Streamable HTTP transport for each request and closes both.                                                                | Security triage boundary |
| Vulnerable direct dependencies    | Lockfile pins direct, affected versions of MCP SDK, Hono, minimatch, linkify-it, sharp, and other audit-reported packages.                                           | AUD-004                  |

### Independent-agent feedback

- The supplied repository investigation identified the shared-package CI gap;
  its fact-check review corrected the incomplete enumeration of CI test-like
  jobs without changing that conclusion.
- The supplied external research states that MCP HTTP authorization obligations
  apply only if that transport/authorization mode is in use. This audit found
  Streamable HTTP code but did not claim an authorization vulnerability from
  that fact alone.

## Scope and method

The audit covered repository topology and writer/control boundaries, CI/test
selection, shared packages, build and generated-output freshness, production
dead-code analysis, lockfile vulnerability analysis, and MCP transport use.
It used source inspection only for code paths and real local commands for
checks. No UI finding was asserted, so no browser preview was started or
existing process was disturbed.

## Executed verification

| Command                                                                                                             | Exit | Preconditions / key result                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ---: | --------------------------------------------------------------------------------------------- |
| `bun run --cwd packages/sdk/js test`                                                                                |    0 | Bun 1.3.13 installed after the initial shell lacked `bun`; 55 pass, 0 fail, 815 expectations. |
| `bun test packages/plugin/test/artifact-catalog.test.ts`                                                            |    0 | 23 pass, 0 fail, 185 expectations.                                                            |
| `bun test packages/transport-protocol/test/contract.test.ts`                                                        |    0 | 20 pass, 0 fail, 1,198 expectations.                                                          |
| `bun test packages/util/test/error.test.ts packages/util/test/lazy.test.ts packages/util/test/node-runtime.test.ts` |    1 | 9 pass, 1 fail: a synthetic Windows path is parsed by macOS `node:path` as relative.          |
| `bun run typecheck`                                                                                                 |    0 | SDK/AI-runtime checks pass; all 8 invoked Turbo package typechecks succeed (cached).          |
| `bun run --cwd packages/sdk/js build`                                                                               |    0 | SDK OpenAPI generation and build complete with no tracked source diff.                        |
| `bun run --cwd packages/opencorvus build --single --skip-install`                                                   |    0 | Darwin ARM64 executable and runtime payload build complete.                                   |
| `bun run api:routes-check`                                                                                          |    0 | 6 rules and route inventory clean across 32 files.                                            |
| `bun run docs:check`                                                                                                |    0 | 294 operations across 24 groups match generated API documentation.                            |
| `bun test packages/opencorvus/test/script/db-write-boundary.test.ts`                                                |    0 | 17 pass, 0 fail, 51 expectations.                                                             |
| `bun run check:dead-code`                                                                                           |    1 | Knip reports 2 unused files, 1 unused dependency, and 1 unlisted binary.                      |
| `bun audit`                                                                                                         |    1 | 87 vulnerabilities: 1 critical, 29 high, 45 moderate, 12 low.                                 |
| `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`                                            |    0 | 22 pass, 0 fail, 71 expectations.                                                             |
| `bun test packages/opencorvus/test/script/document-health.test.ts`                                                  |    0 | 63 pass, 0 fail, 1,313 expectations.                                                          |
| `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`                                       |    0 | 8 pass, 0 fail, 63 expectations.                                                              |

Initial attempted shared-package commands exited 127 because Bun was absent
from the shell. The local prerequisite was repaired by installing the exact
repository-pinned `bun@1.3.13`, then the original commands above were rerun.

## Confirmed findings

### AUD-001 — High — CI omits existing shared-package behavioral tests

- **Location:** `.github/workflows/test.yml:54-161,227-258`, `turbo.json:5-14`,
  `packages/sdk/js/package.json:7-12`, `packages/plugin/test/artifact-catalog.test.ts`,
  `packages/transport-protocol/test/contract.test.ts`, and `packages/util/test/*.test.ts`.
- **Evidence:** CI's required aggregate depends on selected OpenCorvus, Channel
  Runtime, Overlay, GUI-smoke, build, and benchmark jobs. It has no jobs for
  the four named shared-package suites. The real local run proves the suites
  exist and are executable (and exposed AUD-002).
- **Impact:** A behavioral regression in public SDK lifecycle code, plugin
  artifact contracts, transport contracts, or utility code can pass current CI
  and first fail in the core runtime or a released consumer.
- **Causal chain:** Turbo defines only `opencorvus#test`; CI explicitly selects
  jobs; three test-owning packages expose no package `test` script and SDK is
  not selected. Therefore their test files have no canonical CI edge.
- **Recommendation:** Define one workspace-wide test graph or explicit CI jobs
  for every test-owning package. Add package scripts for plugin,
  transport-protocol, and util; include SDK; make the required aggregate depend
  on them. Add a regression test that enumerates test-owning package paths and
  their CI/test-graph ownership.

### AUD-002 — Medium — Shared util test suite is not host-portable

- **Location:** `packages/util/test/node-runtime.test.ts:18-23` and
  `packages/util/src/node-runtime.ts:27-40`.
- **Evidence:** The actual macOS run fails one assertion: the expected
  `C:\\app/browser-mcp-node` becomes `browser-mcp-node`. The test injects
  `platform: "win32"` and a Windows `execPath`, but both production and test
  use the host-selected `node:path` implementation.
- **Impact:** The suite cannot be run consistently on macOS/Linux despite
  containing a synthetic Windows case, so the shared-package coverage required
  by AUD-001 is not portable. The inspected production call derives platform
  from the actual host, so this evidence does **not** prove a Windows product
  path failure.
- **Causal chain:** Platform is injectable but path semantics are not; `path`
  remains POSIX on the macOS runner; `path.dirname("C:\\app\\opencorvus.exe")`
  is `"."`; the asserted Windows absolute path cannot result.
- **Recommendation:** Either inject/select `path.win32` when testing a win32
  target, or split native-host path behavior from target naming behavior. Add
  CI coverage that runs the same suite on Windows and a non-Windows host.

### AUD-003 — Low — Production dead-code analysis reports stale files and declarations

- **Location:** `packages/overlay/src/components/TerminalPanel.tsx`,
  `packages/overlay/src/services/terminal.ts`,
  `packages/channel-runtime/package.json:6-14`, and
  `packages/opencorvus/src/shell/process-supervisor.ts`.
- **Evidence:** `bun run check:dead-code` exits 1 and names both Overlay files
  as unused, `@opencorvus-ai/util` as unused in Channel Runtime, and `ps` as an
  unlisted binary. Repository search finds the two Overlay files referenced by
  tests but no production mount/import, and no Channel Runtime source import of
  util.
- **Impact:** Unowned terminal code and stale dependency declarations increase
  maintenance and supply-chain surface; the unlisted binary prevents the
  production dead-code check from being a clean release signal.
- **Causal chain:** The feature was decoupled from the production mounting path
  while files and manifest declarations remained; Knip's production analysis
  has no allowlist ownership for the intentional `ps` execution.
- **Recommendation:** Confirm product intent. If retired, delete the files and
  dependency with focused regression coverage; if retained, reconnect through
  the canonical terminal surface and add an execution test. Declare `ps` in
  Knip only after documenting its platform/runtime ownership.

### AUD-004 — High — Lockfile retains known-vulnerable direct and transitive dependencies

- **Location:** `package.json:101`, `packages/opencorvus/package.json:77-123`,
  `bun.lock:375,987,2503,2663,2845,3259`; command `bun audit`.
- **Evidence:** `bun audit` exits 1 with 87 advisories (1 critical, 29 high,
  45 moderate, 12 low). Direct pins include `@modelcontextprotocol/sdk@1.25.2`
  (audit reports a high cross-client data-leak advisory for `<=1.25.3`),
  `hono@4.10.7`, `minimatch@10.0.3`, `linkify-it@5.0.0`, and `sharp@0.34.5`.
  Production code instantiates MCP HTTP/client transports, Hono server routes,
  minimatch through project file-ignore patterns, and Overlay markdown URL
  linkification.
- **Impact:** The project ships or executes packages with published security
  advisories, including denial-of-service and one critical deserialization
  advisory in the resolved tree. This is a confirmed dependency hygiene and
  release-risk defect; exploitability of each advisory requires separate
  input-to-sink and deployment-boundary validation.
- **Causal chain:** The lockfile freezes versions within vulnerable audit
  ranges; no passing dependency-security policy/test prevents that state from
  merging; `bun audit` therefore fails on the locked tree.
- **Recommendation:** Triage advisories by direct reachability and exposed
  input, update direct pins/overrides to remediated releases, regenerate the
  lockfile, then run focused MCP, routing, glob, and markdown regressions plus
  `bun audit`. Keep a committed exception only for a demonstrated false
  positive with expiry and owner; do not suppress the aggregate audit.

## Architecture and integration observations

- The inspected data/control architecture has explicit single-writer and
  capability-routing boundaries. The focused database write-boundary test
  passes, so no writer-boundary defect is asserted.
- Browser MCP HTTP creates and closes a separate server/transport per request
  (`src/mcp/browser/index.ts:42-75`). Consequently the SDK advisory about a
  _shared_ server/transport is a remediation priority under AUD-004, not proof
  that this implementation leaks data across clients.
- `docs:check`, route inventory, SDK generation, and the critical application
  build are currently consistent for this working tree.

## Uncovered or blocked scope

| Priority | Scope                                                      | Reason and next action                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Full exploitable-path review for all 87 audit advisories   | This audit verified affected locked versions and selected local call sites, not every advisory's attacker-controlled input and deployment exposure. Triage direct runtime dependencies first.                          |
| P1       | Windows runtime verification of `packagedNodeRuntimePaths` | Current host is macOS; AUD-002 proves a non-Windows test failure but not a Windows product failure. Run the repaired suite on Windows.                                                                                 |
| P2       | Full UI/visual audit                                       | No UI-specific defect was identified in this bounded source/quality audit. No page was opened to avoid disturbing existing processes; visual acceptance requires a separately scoped isolated preview and screenshots. |
| P2       | Clean-install parity with CI `--ignore-scripts`            | External research identifies this as a meaningful supply-chain reliability question, but a clean CI-shaped install was not performed because it would mutate dependency state. Verify in an isolated CI runner.        |
| P3       | Dynamic and native platform matrices                       | Local critical build covered Darwin ARM64 only; Linux/Windows packaging and GUI/browser matrix execution remain CI scope.                                                                                              |

## Priority plan

1. **P1:** Repair AUD-001 and AUD-002 together so CI runs a portable shared
   test graph on its intended platform matrix.
2. **P1:** Triage and update AUD-004 by direct reachability; fail release
   policy on unowned high/critical advisories.
3. **P2:** Resolve AUD-003 only after confirming whether the terminal feature
   is intentionally retired or disconnected.
4. **P2:** Run the explicitly deferred clean-install and visual audits in
   isolated environments, preserving the no-running-process constraint.

## Self-review

Every finding above is tied to a real command result and exact repository
locations. The report distinguishes affected dependency versions from proven
runtime exploitation, and distinguishes the util test's cross-host failure
from a Windows product failure. No source change was made to convert a finding
into a passing result.
