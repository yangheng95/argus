# Cross-platform System Proxy Bootstrap

Date: 2026-07-21
Status: Completed
Owner: Codex

## Recall

### User request

The user reported Task `tsk_f8344de6f001aoVQvAK2tiimoi` as hung, asked for the
root cause, then explicitly requested that OpenCorvus automatically adopt the
operating-system proxy on every supported platform rather than retaining the
historical Windows-only discovery path.

### Runtime evidence

- The projected `source-investigator` read
  `/Users/yangheng/Documents/output/mirror-prism-pipeline/scripts/kanban.sh`.
- `ReadTool` synchronously awaited `LSP.touchFile()`, which tried to provision
  `bash-language-server` through the embedded Bun executable.
- The installer process remained in `SYN_SENT` from `10.9.15.23` to
  `104.16.x.34:443`; direct `curl` to `registry.npmjs.org` also timed out.
- `scutil --proxy` reported enabled HTTP, HTTPS, and SOCKS proxies at
  `127.0.0.1:7890` plus a bypass list.
- The OpenCorvus process and launchd environment contained no standard proxy
  variables.
- Explicit `curl --proxy http://127.0.0.1:7890` returned HTTP 200 immediately.

### Acceptance criteria

- At process bootstrap, OpenCorvus reads the platform's canonical system proxy
  projection and populates standard proxy environment variables before network
  clients and child processes start.
- Windows continues to read Internet Settings; macOS reads System
  Configuration; Linux desktop sessions read the selected GNOME or KDE proxy
  source. Headless Linux keeps the standard environment as its only truthful
  process-wide proxy source because Linux exposes no universal desktop-agnostic
  system proxy registry.
- Explicit `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` values keep
  precedence; system discovery fills only missing values.
- Enabled HTTP and HTTPS proxy rows become normalized proxy URLs. SOCKS becomes
  `ALL_PROXY` only when that variable is missing.
- `ExceptionsList` becomes `NO_PROXY` without losing Classless Inter-Domain
  Routing (CIDR) blocks, wildcard domains, or `<local>` semantics.
- A Proxy Auto-Configuration (PAC) URL without a static proxy produces a visible
  bootstrap warning instead of pretending Bun can evaluate PAC JavaScript.
- Parser tests cover Windows, macOS, GNOME, and KDE enabled, disabled, partial,
  explicit-environment, exceptions, SOCKS, and Proxy Auto-Configuration (PAC)
  cases.
- The relevant typecheck, focused tests, document-health tests, and historical
  documentation-link test pass.

### Hard constraints

- The process bootstrap is the single source. Do not add LSP-specific proxy
  settings, package-manager aliases, fallback registries, or a second active
  proxy field.
- System proxy discovery is configuration projection, not workflow routing or a
  gate.
- Do not restart or interfere with the running OpenCorvus/Overlay processes.
- Preserve unrelated attachment/composer modifications already present in the
  worktree.

### Read records

- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-20-task-research-dispatch-observability-systemic-repair.md`
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`
- `packages/opencorvus/src/runtime/shims.ts`
- `packages/opencorvus/src/util/network-proxy.ts`

### Full-repository grep results

| Surface                   | Call points and disposition                                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process bootstrap         | `src/index.ts` and `src/overlay-server.ts` both call `installProcessShims()`; preserve this single startup boundary.                                                                                                                                |
| Existing system discovery | `runtime/shims.ts::detectSystemProxy()` handles only Windows registry data; replace its Windows-only implementation with one platform adapter selected from process platform and the explicit Linux desktop session.                                |
| Explicit network proxy    | `util/network-proxy.ts` owns opt-in authenticated provider/research proxy configuration; preserve it because explicit product configuration remains higher authority than OS discovery.                                                             |
| Proxy consumers           | Bun fetch and every child process inherit `process.env`; Browser runtime also reads standard proxy variables. No LSP-specific injection is required.                                                                                                |
| LSP provisioning          | `lsp/server.ts` has 12 `Process.spawn(... install ...)` sites and 22 download-disable checks. They inherit bootstrap environment after this repair; their separate cancellation/timeout defect is recorded but is not disguised as proxy discovery. |
| LSP touch callers         | `read`, `write`, `edit`, `apply_patch`, the explicit LSP tool, and debug CLI call `LSP.touchFile()`. No caller-specific proxy implementation will be added.                                                                                         |
| Historical proxy code     | Browser MCP intentionally does not infer browser launch proxy from environment; this repair does not change that separate browser-session contract.                                                                                                 |

### Independent agent feedback

No sub-agent was used because the user did not request delegated or parallel
work. Repository and runtime evidence were inspected directly.

## Implementation plan

1. Extract the operating-system proxy projection into a small runtime module
   with pure Windows, macOS, GNOME, and KDE parsing plus explicit-environment
   precedence.
2. Invoke it from the existing `installProcessShims()` bootstrap after embedded
   environment application and before any network work.
3. Add focused parser/application tests using captured `scutil --proxy` output;
   do not depend on the developer machine's live proxy state.
4. Run focused tests, typecheck, documentation health/link tests, inspect the
   diff, and push the completed commit to `legacy-remote/v0.0.13beta`.

## Validation

- `bun test packages/opencorvus/test/runtime/system-proxy.test.ts`: 11 passed,
  0 failed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- Live macOS projection returned the configured HTTP, HTTPS, SOCKS, and bypass
  settings from `scutil --proxy`.
- A Bun `fetch` executed after `SystemProxy.install()` returned HTTP 200 from
  `https://registry.npmjs.org/bash-language-server`; the same endpoint had
  timed out before system-proxy projection.
- A fresh Bun child process created from `{...process.env}` inherited
  `HTTPS_PROXY=http://127.0.0.1:7890` and returned HTTP 200 from the same npm
  endpoint, matching the LSP installer environment boundary.
- `bun test packages/opencorvus/test/runtime/system-proxy.test.ts packages/opencorvus/test/script/canonical-export-names.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`:
  passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 61 passed,
  0 failed.

## Codex review feedback

The first implementation draft treated the base GNOME schema as if
`gsettings list-recursively` also emitted child HTTP, HTTPS, and SOCKS schemas.
Review rejected that assumption. Discovery now reads the four authoritative
GNOME schemas explicitly and combines their rows before pure parsing. Review
also expanded Linux desktop matching to real `gnome-wayland` and
`plasmawayland` session values and normalized explicit lowercase proxy
variables into uppercase standard variables without overriding their values.
Production-shape child-process inspection then found that Bun exposes
`HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` as non-enumerable accessors. Because
LSP provisioning constructs child environments with `{...process.env}`, a
readable proxy value still disappeared at that boundary. The single projection
writer now preserves each value while making these standard keys enumerable,
and a regression covers that exact spread behavior.
