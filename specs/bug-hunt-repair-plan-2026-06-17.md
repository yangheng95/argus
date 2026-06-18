# Bug Hunt Repair Plan - 2026-06-17

## Objective

Repair the substantive findings recorded in `specs/bug-hunt-2026-06-17.md` by priority. This plan is append-only by batch: each batch records the disk evidence, call-point inventory, fix shape, and regression tests before code changes.

Glossary: TLS means Transport Layer Security. API means Application Programming Interface. HMAC means Hash-based Message Authentication Code. STT means Speech To Text. UI means User Interface. URL means Uniform Resource Locator. DOM means Document Object Model. PNG means Portable Network Graphics. JSON means JavaScript Object Notation. SDK means Software Development Kit.

## Batch P0-A: channel runtime fail-closed inbound security

### Findings

- BH-087: `packages/channel-runtime/src/vision.ts` disables TLS certificate verification on Windows when `SSL_CERT_FILE` is absent.
- BH-089: `packages/channel-runtime/src/adapters/feishu.ts` only rejects a wrong verification token; a missing token reaches dispatch.
- BH-091: `packages/channel-runtime/src/adapters/line.ts` verifies `x-line-signature` only when a secret is configured, while `packages/channel-config/src/index.ts` treats `LINE_CHANNEL_SECRET` as optional.

### Call-point Inventory

Vision:

- `packages/channel-runtime/src/main.ts` constructs `VisionPipeline` from runtime env.
- `packages/opencorvus/src/channel/supervisor.ts` constructs `VisionPipeline` for managed runtime.
- `packages/channel-runtime/src/core.ts` stores the pipeline and calls `vision.analyze`.
- `packages/channel-runtime/src/vision.ts` owns the fetch request options and the unsafe TLS branch.

Feishu:

- `packages/channel-config/src/index.ts` defines `FEISHU_VERIFICATION_TOKEN`.
- `packages/channel-runtime/src/registry.ts` passes `verificationToken` into `FeishuAdapter`.
- `packages/channel-runtime/src/main.ts` registers `FeishuAdapter`.
- `packages/channel-runtime/src/adapters/feishu.ts` parses challenge/event bodies and dispatches messages.
- `packages/channel-runtime/test/feishu-adapter.test.ts` covers normal event mapping and outbound reply behavior.
- `packages/channel-runtime/test/registry.test.ts` covers forwarding the optional Feishu token.
- `packages/web/src/content/docs/channels/feishu.mdx` and `packages/web/src/content/docs/zh-cn/channels/feishu.mdx` already document the token as configured by users.

LINE:

- `packages/channel-config/src/index.ts` defines `LINE_CHANNEL_ACCESS_TOKEN`; before this batch it defined `LINE_CHANNEL_SECRET` as optional.
- `packages/channel-runtime/src/registry.ts` passes `secret` into `LineAdapter`.
- `packages/channel-runtime/src/main.ts` registers `LineAdapter`.
- `packages/channel-runtime/src/adapters/line.ts` owns HMAC verification and message dispatch.
- `packages/channel-runtime/test/mainstream-adapters.test.ts` covers LINE inbound/outbound behavior.
- `packages/channel-runtime/test/registry.test.ts` covers channel registration.
- `packages/web/src/content/docs/channels/line.mdx` and `packages/web/src/content/docs/zh-cn/channels/line.mdx` already tell users to set `LINE_CHANNEL_SECRET`.

### Fix Shape

- Remove the Windows `tls.rejectUnauthorized=false` branch from vision requests. Certificate failures must surface as normal request failures instead of sending bearer keys and screenshots over an unverifiable TLS connection.
- For Feishu, when `verificationToken` is configured, require the inbound token field to exist and match exactly before URL verification or event dispatch. Missing and wrong token are both unauthorized.
- For LINE, make the channel secret required in channel config and registry registration. `LineAdapter` also fails closed on POST when constructed without a secret, so direct adapter usage cannot silently accept unsigned webhooks.
- Keep existing outbound behavior untouched except where tests need signatures on inbound requests.

### Regression Tests

- Add `packages/channel-runtime/test/vision.test.ts`: stub `fetch`, call `VisionPipeline.analyze`, and assert request init never carries a `tls.rejectUnauthorized=false` override.
- Extend `packages/channel-runtime/test/feishu-adapter.test.ts`: missing token and wrong token return 401 and do not invoke the handler; valid token dispatches.
- Extend `packages/channel-runtime/test/mainstream-adapters.test.ts`: LINE missing secret rejects POST, missing/wrong `x-line-signature` returns 401, and valid HMAC dispatches.
- Extend `packages/channel-runtime/test/registry.test.ts`: token-only LINE env is partial and skipped; token plus secret registers and forwards the secret.

### Verification

- Focused test command: `bun test packages/channel-runtime/test/vision.test.ts packages/channel-runtime/test/feishu-adapter.test.ts packages/channel-runtime/test/mainstream-adapters.test.ts packages/channel-runtime/test/registry.test.ts`
- Review command: `git diff -- packages/channel-runtime/src packages/channel-config/src packages/channel-runtime/test specs/bug-hunt-repair-plan-2026-06-17.md`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/channel-runtime/test/vision.test.ts packages/channel-runtime/test/feishu-adapter.test.ts packages/channel-runtime/test/mainstream-adapters.test.ts packages/channel-runtime/test/registry.test.ts`.
- Typecheck passed: `bun run --cwd packages/channel-runtime typecheck`.
- Remaining risk: Feishu adapter/test files contain pre-existing uncommitted outbound-reply behavior changes; stage only the token-verification hunks for this batch.

## Deferred Higher-Priority Channel Findings

- BH-088 MS Teams activity authentication and `serviceUrl` trust requires a platform-auth implementation or a mature Bot Framework verification path; it must not be patched with a synthetic local gate.
- BH-090 DingTalk, WhatsApp, Google Chat, Mattermost, and WeCom inbound auth require per-platform verification contracts and signed fixtures.
- BH-092, BH-093, BH-095, and BH-108 remain P1 repair targets after the P0-A batch is verified and committed.

## Batch P0-B: ripgrep command execution

### Findings

- BH-002: `packages/opencorvus/src/file/ripgrep.ts` builds a raw shell command for `Ripgrep.search`; `/find` forwards user-controlled `pattern` from `packages/opencorvus/src/server/routes/file.ts`.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/file.ts` uses `Ripgrep.search` for `GET /find`.
- `packages/opencorvus/src/cli/cmd/debug/ripgrep.ts` uses `Ripgrep.search` for debug search.
- `packages/opencorvus/src/engine/codebase-tools.ts` uses codebase search tooling backed by ripgrep behavior.
- `packages/opencorvus/src/tool/grep.ts`, `glob.ts`, `ls.ts`, and `skill.ts` use other `Ripgrep` helpers, which already use argv-style process spawning and are not the vulnerable raw-shell path.
- `packages/opencorvus/test/file/ripgrep.test.ts` currently covers hidden-file defaults but not shell metacharacters.

### Fix Shape

- Replace the Bun raw-shell execution in `Ripgrep.search` with `Process.run(args, { cwd, nothrow: true })`, matching the argv-based pattern already used by `Ripgrep.files`.
- Preserve ripgrep's regex semantics and `--` pattern separator; do not add shell-metacharacter filters or fallback paths.
- Keep nonzero ripgrep exits returning `[]`, matching existing search behavior for no matches and invalid regex.

### Regression Tests

- Extend `packages/opencorvus/test/file/ripgrep.test.ts` with a pattern containing shell metacharacters (`;`, `>`) that also exists literally in a file.
- Assert `Ripgrep.search` returns the literal match and no injected side-effect file is created.

### Verification

- Focused test command: `bun test packages/opencorvus/test/file/ripgrep.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/file/ripgrep.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P0-C: auth well-known command execution

### Findings

- BH-001: `packages/opencorvus/src/cli/cmd/auth.ts` fetches `${url}/.well-known/opencorvus` and executes remote `wellknown.auth.command` locally through `Process.spawn`.

### Call-point Inventory

- `packages/opencorvus/src/cli/cmd/auth.ts` is the only caller that executes `wellknown.auth.command`.
- `packages/opencorvus/src/auth/index.ts` defines the stored `wellknown` auth record shape used later by config loading.
- `packages/opencorvus/src/config/config.ts` reads stored well-known credentials to fetch remote organization config; it does not execute commands.
- `packages/web/src/content/docs/cli.mdx` and `packages/web/src/content/docs/reference/cli.mdx` mention `opencorvus auth login [url]`.
- `packages/opencorvus/test/cli/auth-models-refresh-source.test.ts` is the only existing auth CLI test and is source-level only.

### Fix Shape

- Remove command execution from URL-based auth login. If the remote well-known document asks for `auth.command`, reject visibly before spawning or saving credentials.
- Do not add command allowlists, prompts, or fallback command paths; remote JSON is not a trusted local executable source.
- Keep non-URL `opencorvus auth login` unchanged.

### Regression Tests

- Add a CLI auth test that stubs `fetch` to return an `auth.command`, spies on `Process.spawn` and `Auth.set`, calls `AuthLoginCommand.handler`, and asserts the handler rejects before either side effect.

### Verification

- Focused test command: `bun test packages/opencorvus/test/cli/auth-wellknown.test.ts packages/opencorvus/test/cli/auth-models-refresh-source.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/cli/auth-wellknown.test.ts packages/opencorvus/test/cli/auth-models-refresh-source.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P0-D: provider discover saved-key exfiltration

### Findings

- BH-004: `POST /provider/discover-models` accepts arbitrary `api` while reusing a saved provider auth key selected by `providerID`, which can send stored credentials to a caller-controlled URL.
- BH-005 was checked during this batch and is already fixed in HEAD: `/provider/hexin/budget` no longer returns upstream error bodies and `provider-hexin-budget.test.ts` covers reflected Authorization redaction.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/provider.ts` owns `/provider/discover-models` and currently combines `body.api`, optional explicit `apiKey`, and optional saved `providerID` auth.
- `packages/opencorvus/test/server/provider-discover-models.test.ts` covers explicit API-key discovery and upstream failures.
- `packages/overlay/src/components/settings/ProvidersPanel.tsx` calls `apiJson("provider/discover-models", ...)` from the provider settings UI.
- `packages/sdk/js/src/gen/sdk.gen.ts` and `packages/sdk/js/src/gen/types.gen.ts` expose the generated route contract from OpenAPI.
- `packages/opencorvus/src/provider/provider.ts` exposes configured provider model `api.url` values through `Provider.getProvider`.

### Fix Shape

- Continue allowing explicit `apiKey` to be sent to the explicit `api` URL supplied in the same request.
- When no explicit `apiKey` is present and `providerID` selects saved auth, require `body.api` to match one of that provider's configured model API base URLs after URL normalization.
- Reject mismatch with 400 before network fetch and before adding `Authorization`.
- Do not add allowlists or fallback URL guesses; the provider catalog is the single source of allowed saved-key destinations.

### Regression Tests

- Extend `packages/opencorvus/test/server/provider-discover-models.test.ts` with a saved-key exfiltration case: seed saved OpenAI key, request discovery against a local attacker URL with `providerID: "openai"`, and assert 400, no upstream request, and no Authorization leak.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/provider-discover-models.test.ts packages/opencorvus/test/server/provider-hexin-budget.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/server/provider-discover-models.test.ts packages/opencorvus/test/server/provider-hexin-budget.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P0-E: Windows system terminal command injection

### Findings

- BH-003: `packages/opencorvus/src/system-terminal/index.ts` builds Windows launches as `cmd.exe /d /s /c start "" /D <cwd> ...`, so `cmd.exe` parses `cwd`, terminal profile command, and coding CLI command arguments as a shell command line. `&`, `|`, `%`, and related metacharacters in project paths or configured command paths can change command semantics before the intended terminal process starts.

### Call-point Inventory

- `packages/opencorvus/src/system-terminal/index.ts` owns `SystemTerminal.buildCommand`, `open`, `openCommand`, and the `launch` process seam.
- `packages/opencorvus/src/server/routes/terminal.ts` calls `SystemTerminal.open` for `/terminal/open`.
- `packages/opencorvus/src/coding-cli/index.ts` calls `SystemTerminal.openCommand` for external coding CLI launch.
- `packages/opencorvus/src/server/routes/coding.ts` exposes the coding CLI open route and maps `SystemTerminal.ConfigError`.
- `packages/opencorvus/test/system-terminal/external-launch.test.ts` owns command-shape coverage for Windows, macOS, and Linux.
- `packages/opencorvus/test/coding-cli/external-launch.test.ts` asserts the coding CLI command is handed to `SystemTerminal.buildCommand`.
- `specs/new-arch/right-sidebar-opencode-tui-copy-implementation-plan-2026-06-04.md` preserves external terminal launch only as an explicit standalone action, not as the right-sidebar TUI path.

### Fix Shape

- Remove the Windows `cmd.exe /c start` launcher path. Build a direct detached Windows launch command whose executable is the selected terminal profile command, or `cmd.exe /k` when no profile is selected.
- Keep `cwd` in the process spawn option instead of serializing it into a shell command line.
- For command-prompt profiles that must run a target command through `cmd.exe /k`, render one cmd-safe command string for the target executable and arguments instead of appending raw argv after `/k`.
- Use direct native child-process detachment for Windows launch; do not add path allowlists, fallback launchers, or compatibility branches that keep the old `start` path alive.

### Regression Tests

- Update Windows system-terminal tests to assert `buildCommand` no longer returns `cmd.exe /c start`, and that metacharacter-bearing cwd values are not present in launcher args.
- Add a Windows command-prompt CLI case with `&`, `|`, and `%` in command path/args, asserting they are contained in a single quoted/escaped cmd command line rather than raw argv after `/k`.
- Update coding CLI external-launch expectations to the direct Windows launch shape.

### Verification

- Focused test command: `bun test packages/opencorvus/test/system-terminal/external-launch.test.ts packages/opencorvus/test/coding-cli/external-launch.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/system-terminal/external-launch.test.ts packages/opencorvus/test/coding-cli/external-launch.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P0-F: project-scoped task/goal/interaction ownership

### Findings

- BH-012: project-scoped task, goal, and interaction service entrypoints resolve resources by global IDs. Existing checks reject `project_id = "global"` but do not compare concrete task ownership against the current `Instance.project.id`, so a request running under project A can read or mutate a task, goal, or interaction belonging to project B if it knows the ID.
- `specs/new-arch/2026-06-12-deleted-project-task-record-routes.md` intentionally allows selected task record routes without physical project bootstrap. This batch must not reintroduce directory middleware for those record routes; it should enforce ownership only when a current project context exists.

### Call-point Inventory

- `packages/opencorvus/src/task-api/index.ts` owns shared `EngineService` task/goal/interaction read and write entrypoints used by HTTP routes, panel/tool callers, and channel ingress callers.
- `packages/opencorvus/src/engine/store.ts` exposes `requireTask`, `requireInteraction`, `listGoals`, `listInteractions`, `viewGoal`, and `viewInteraction`; those helpers currently resolve by global ID or task ID only.
- `packages/opencorvus/src/server/routes/orchestrator.ts` exposes `GET /task/:taskID`, task status/progress/trace/interactions, task mutation routes, `PATCH/DELETE /goal/:goalID`, and `POST /interaction/:interactionID/reply|reject`.
- `packages/opencorvus/test/engine/task-global-project-forbidden.test.ts` already covers legacy `global` task rejection and channel binding concrete-project conflicts, but not direct foreign concrete task/goal/interaction IDs.
- `specs/new-arch/2026-06-12-deleted-project-task-record-routes.md` documents record routes that bypass project directory bootstrap; ownership validation must preserve those route-policy semantics.

### Fix Shape

- Add project-aware resource resolvers inside `task-api/index.ts`: `requireTaskInCurrentProject`, `requireGoalInCurrentProject`, and `requireInteractionInCurrentProject`.
- `requireTaskInCurrentProject` keeps the existing `TaskGlobalProjectBindingError` for `global` task rows. When `Instance.current()` exists and the task belongs to a different concrete project, throw `NotFoundError` so foreign IDs are not disclosed.
- `requireGoalInCurrentProject` and `requireInteractionInCurrentProject` validate through the owning `task_id` before returning the resource, so side effects such as permission/question replies cannot occur before ownership is checked.
- Use these resolvers at shared `EngineService` task/goal/interaction read/write entrypoints instead of adding route-specific middleware or directory gates.

### Regression Tests

- Extend `packages/opencorvus/test/engine/task-global-project-forbidden.test.ts` with two concrete git projects: create a task/goal/interaction under project A, switch to project B, and assert task read/write, goal update/delete, and interaction reply/reject fail before mutating A-owned rows or invoking external side effects.

### Verification

- Focused test command: `bun test packages/opencorvus/test/engine/task-global-project-forbidden.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/engine/task-global-project-forbidden.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Isolated verification from a clean checkout found two pre-existing typecheck blockers in current HEAD: `ProviderRoutes` calls `Provider.resolveHexinApiKey` while the provider namespace still exported only a local `hexinApiKey`, and `AcceptanceSpec.trigger` has retired `on_acceptance` while architect visual-evidence ownership still compared that value. The commit includes only the minimal export/rename and trigger comparison correction needed for the clean checkout to typecheck; coverage comes from the existing `provider-hexin-budget`, `architect-fidelity-gate`, and `acceptance/types` tests.

## Batch P0-G: published package bin contract

### Findings

- BH-068: `packages/opencorvus/package.json` declares `bin.opencorvus = "./bin/opencorvus"`, but `packages/opencorvus/bin` does not exist.
- `packages/opencorvus/script/publish.ts` copies `./bin` into the wrapper package, so publish fails before npm packaging when the source directory is absent.
- The deeper package contract is inconsistent: build artifacts write the native executable at each binary package root (`dist/<binary-package>/opencorvus(.exe)`), while `postinstall.mjs` looks under `<binary-package>/bin/opencorvus(.exe)`.
- The wrapper package currently writes `scripts.postinstall = "bun ./postinstall.mjs || node ./postinstall.mjs"`, which is a runtime fallback and hides the intended postinstall runtime.

### Call-point Inventory

- `packages/opencorvus/package.json` is the source package manifest with the `bin` target.
- `packages/opencorvus/script/build.ts` writes binary package manifests and places the executable at the binary package root.
- `packages/opencorvus/script/publish.ts` builds the npm wrapper package from `./bin`, `postinstall.mjs`, and discovered binary package optional dependencies.
- `packages/opencorvus/script/postinstall.mjs` resolves the platform optional dependency and prepares the wrapper package bin directory.
- `packages/opencorvus/test/script/build-artifact.test.ts`, `package-binary-matrix.test.ts`, and `package-linux-binary.test.ts` cover build/package script contracts but do not smoke-test the wrapper npm package layout.

### Fix Shape

- Add a real `packages/opencorvus/bin/opencorvus` Node launcher. It should execute one installed platform binary from `bin/.opencorvus` or `bin/.opencorvus.exe` with argv passthrough and no shell.
- Add a shared published-package helper under `packages/opencorvus/script/` that defines the platform package name, source binary filename, installed binary filename, and install target path. Use it from both the launcher and postinstall so the layout is single-source.
- Change postinstall to resolve the optional dependency package root and copy the root executable into the wrapper bin install target. Do not probe multiple candidate paths or silently skip Windows.
- Change publish to copy the script helper together with postinstall under `dist/<pkg>/script/`, keep the launcher under `dist/<pkg>/bin/`, and run postinstall with `node ./script/postinstall.mjs` only.
- Filter published optional dependencies to CLI binary package names only, so overlay-server artifacts cannot be pulled into the npm wrapper package.
- Keep binary package build output unchanged because `build.ts` already has a single root executable layout used by other release scripts.

### Regression Tests

- Add `packages/opencorvus/test/script/published-package-bin.test.ts`.
- Build a temporary wrapper package layout with copied `bin/` and `script/` sources plus a fake platform optional dependency whose executable is the current test runtime.
- Run `node script/postinstall.mjs`, assert the wrapper install target exists, then run `node bin/opencorvus --version` and assert it exits successfully.
- Assert `publish.ts` copies `./bin`, copies `script/postinstall.mjs`, copies the shared helper, and does not contain a Bun-to-Node fallback command.
- Assert the binary package filter accepts CLI packages and rejects overlay-server packages.
- Add the smoke test to the package default test script via `package-test-entry.test.ts`.

### Verification

- Focused test command: `bun test packages/opencorvus/test/script/published-package-bin.test.ts packages/opencorvus/test/script/package-test-entry.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/script/published-package-bin.test.ts packages/opencorvus/test/script/package-test-entry.test.ts`.
- Staged diff check passed: `git diff --cached --check`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-A: request Origin enforcement before side effects

### Findings

- BH-006: `packages/opencorvus/src/server/cors.ts` already has two concepts: `isAllowedCorsOrigin` for response headers and `isAllowedRequestOrigin` for request-side validation against `Origin` plus `Host`.
- `packages/opencorvus/src/server/server.ts` only wires `isAllowedCorsOrigin` into Hono's response CORS middleware. A hostile browser can still send actual side-effect requests with a disallowed `Origin`; the browser may hide the response, but the handler can already have mutated state.

### Call-point Inventory

- `packages/opencorvus/src/server/cors.ts` owns configured origins, built-in opencorvus/localhost/Tauri origins, and same-host request validation.
- `packages/opencorvus/src/server/server.ts` owns global middleware ordering: auth, request logging, CORS response headers, control-plane routes, project-directory middleware, and project route dispatch.
- `packages/opencorvus/src/cli/network.ts` resolves `--cors` and config `server.cors` into `Server.listen({ cors })`.
- `packages/opencorvus/test/server/task-create-route.test.ts` covers a real state-mutating `POST /task` through `Server.App()`.
- `packages/opencorvus/test/server/directory-required.test.ts` covers middleware ordering for control-plane and project-scoped routes, but not hostile `Origin`.

### Fix Shape

- Add a request-origin middleware in `Server.App()` after request logging and before response CORS/routes.
- Requests without `Origin` remain valid for local SDK/CLI callers.
- Requests with `Origin` must satisfy `isAllowedRequestOrigin(origin, host)`, so same-host UI, localhost/Tauri/opencorvus origins, and configured `server.cors` entries use the same allow rules as response CORS.
- Reject disallowed origins with a structured `RequestOriginForbiddenError` and HTTP 403 before project bootstrap or route handlers run.
- Do not add route allowlists, per-method bypasses, or browser-only heuristics; the presence of a disallowed `Origin` is the boundary violation.

### Regression Tests

- Add `packages/opencorvus/test/server/request-origin.test.ts`.
- Send `POST /task` with a hostile `Origin`, valid project directory, and complete body; assert 403, no task row, and `runTaskLoop` is not called.
- Send the same route with same-host `Origin`/`Host`; assert it reaches the handler.
- Configure an explicit allowed origin and assert that origin reaches a side-effect route.
- Update `packages/opencorvus/test/server/onerror-mapping.test.ts` for the new named error status mapping.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/request-origin.test.ts packages/opencorvus/test/server/onerror-mapping.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/server/request-origin.test.ts packages/opencorvus/test/server/onerror-mapping.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-B: SVG attachments served as non-executable downloads

### Findings

- BH-007: `AttachmentStore.write` accepts `image/svg+xml` and stores it as `<sha>.svg`, then `GET /attachment/:projectID/:name` derives `Content-Type: image/svg+xml` from the extension.
- Opening a same-origin `/attachment/...svg` URL as a top-level document can execute active SVG script in the server origin.
- Existing non-HTTP consumers still need the raw bytes: `AttachmentStore.read`, `dataUrlFromReference`, staging, and read tools all work from the stored blob path. Rejecting SVG at write time would remove a useful asset/reference format for agent workflows.

### Call-point Inventory

- `packages/opencorvus/src/storage/attachment-store.ts` is the single writer/reader for content-addressed task attachments and maps `image/svg+xml` to `svg`.
- `packages/opencorvus/src/server/routes/attachment.ts` is the HTTP serving surface that currently turns `.svg` into `image/svg+xml`.
- `packages/opencorvus/src/tool/read.ts` and `packages/opencorvus/src/tool/webfetch.ts` already avoid treating SVG as a normal image render path.
- `packages/overlay/src/components/ChatComposer.tsx` can still produce `image/svg+xml` attachments from user-selected files.
- `packages/opencorvus/test/storage/*` covers store naming/staging/read behavior but not the HTTP serving headers.

### Fix Shape

- Keep `AttachmentStore` storage unchanged so raw SVG bytes remain available to tools and LLM attachment materialization.
- Change only the HTTP response policy in `AttachmentRoutes`: when the stored filename resolves to SVG, serve bytes as `application/octet-stream`, add `Content-Disposition: attachment; filename="<stored-name>"`, and set `X-Content-Type-Options: nosniff`.
- Add `X-Content-Type-Options: nosniff` to all attachment responses to keep MIME policy explicit.
- Do not add a second attachment URL, sanitizer, route allowlist, or write-time fallback.

### Regression Tests

- Add `packages/opencorvus/test/server/attachment-routes.test.ts`.
- Store a script-bearing SVG, fetch it through `Server.App()` with a project directory header, and assert raw bytes round-trip while response headers force non-executable download semantics.
- Store a PNG and assert normal image attachments still serve `image/png` without forced attachment disposition.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/attachment-routes.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/server/attachment-routes.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-C: signed public channel attachment reads

### Findings

- BH-008: `ChannelAttachment.create()` signs temporary URLs with `e` and `s`, and `ChannelAttachment.authorize()` validates expiry and HMAC, but `GET /channel/attachment/:id` never calls `authorize()`.
- BH-009: the generated URL path is `/channel/attachment/:id`, but `routeRequiresProjectDirectory()` still treats all `/channel/*` routes as project-scoped. A remote channel cannot fetch the generated URL without the private project directory header.
- The route surface is mixed: attachment creation and channel ingress are project-scoped operations, while reading one signed attachment is the only public operation.

### Call-point Inventory

- `packages/opencorvus/src/channel/attachment.ts` owns attachment persistence, URL signing, and authorization.
- `packages/opencorvus/src/server/routes/channel.ts` is the only HTTP reader for temporary channel attachments.
- `packages/transport-protocol/src/index.ts` is the single shared source for server route directory policy used by server middleware and clients.
- `packages/opencorvus/src/server/server.ts` calls `routeRequiresProjectDirectory()` before dispatching to project routes.
- `packages/opencorvus/test/channel/routes.test.ts` and gateway tests cover project-scoped channel routes, but not public signed attachment fetches.
- `packages/transport-protocol/test/contract.test.ts` already has uncommitted local changes, so this batch will add a new focused test instead of mixing into that dirty file.

### Fix Shape

- Keep `POST /channel/attachment`, `/channel/message`, and `/channel/runtime` project-scoped.
- Add an exact method/path directory-policy exception for `GET /channel/attachment/:id` only; do not add a broad `/channel/` bypass prefix.
- In the GET handler, call `ChannelAttachment.authorize(id, e, s)` before reading the file. Missing, invalid, expired, or mismatched signatures return the same 404 shape as missing metadata.
- Keep the existing no-secret behavior inside `ChannelAttachment.authorize()` unchanged for this batch; the security requirement here is enforcement when `OPENCORVUS_PUBLIC_URL_SECRET` or server password is configured.

### Regression Tests

- Add `packages/opencorvus/test/server/channel-attachment-routes.test.ts`.
- Create a signed attachment under `OPENCORVUS_PUBLIC_URL_SECRET`, fetch the generated URL path through `Server.App()` without `x-opencorvus-directory`, and assert raw bytes are returned.
- Assert missing signature, invalid signature, expired timestamp, and missing metadata all return 404 under the configured secret.
- Assert `routeRequiresProjectDirectory("/channel/attachment/<id>", "GET")` is false, while `POST /channel/attachment` and other `/channel/*` routes remain true.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/channel-attachment-routes.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus --filter=@opencorvus-ai/transport-protocol`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/server/channel-attachment-routes.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus --filter=@opencorvus-ai/transport-protocol`.

## Batch P1-C2: channel runtime attachment creation keeps project scope

### Findings

- Rawls' follow-up review found a related integration issue after BH-008/BH-009: `ChannelRuntime.publishChannelAttachment()` posts directly to `/channel/attachment`, while that create route intentionally remains project-scoped.
- `ChannelSupervisor.desired()` already sets `OPENCORVUS_PROJECT_DIR = Instance.directory` for managed runtimes, but `startInProcess()` did not pass that directory into `ChannelRuntime`.
- `ChannelRuntime.start()` creates SDK clients without directory context, so channel protocol calls such as `/channel/message` and the direct attachment create POST can fail the server's directory middleware.
- `Server.openapi()` already derives directory parameters from `routeRequiresProjectDirectory()`: current source generation keeps `directory` on `POST /channel/attachment` and removes it from `GET /channel/attachment/{id}`. The tracked SDK generated files are already dirty with unrelated changes, so this batch will add source-level OpenAPI regression coverage instead of rewriting generated artifacts.

### Call-point Inventory

- `packages/opencorvus/src/channel/supervisor.ts` owns managed runtime environment construction and already has the active `Instance.directory`.
- `packages/channel-runtime/src/main.ts` owns standalone runtime environment adaptation.
- `packages/channel-runtime/src/core.ts` owns SDK client creation and direct `fetch()` attachment publish.
- `packages/channel-runtime/test/start-idempotency.test.ts` covers `ChannelRuntime.start()` client construction with mocked SDK helpers.
- `packages/channel-runtime/test/core-channel-protocol.test.ts` covers URL-attachment publish flow with mocked `fetch`.
- `packages/opencorvus/test/server/app-routes.test.ts` covers `Server.openapi()` route metadata.
- `packages/overlay/src/services/api.ts` already consumes `routeRequiresProjectDirectory()` for directory injection; existing dirty overlay tests will not be mixed into this batch.

### Fix Shape

- Add `directory` to `ChannelRuntimeOptions` and require it when `start()` needs to bind the SDK client. No implicit `process.cwd()` or default project fallback.
- Pass `env.OPENCORVUS_PROJECT_DIR` from `ChannelSupervisor.startInProcess()` and `process.env.OPENCORVUS_PROJECT_DIR` from the standalone `main.ts` adapter into `ChannelRuntime`.
- Build the SDK client through `createOpenCorvusClient({ baseUrl, directory })` for both existing-server and newly-created-server modes so project-scoped channel calls carry the same directory.
- Add the same directory as a query parameter on the direct `POST /channel/attachment` publish request. Keep `POST /channel/attachment` project-scoped.
- Add OpenAPI regression assertions for `/channel/attachment` POST and `/channel/attachment/{id}` GET without editing generated SDK artifacts in the dirty worktree.

### Regression Tests

- Extend `packages/channel-runtime/test/start-idempotency.test.ts` to assert `createOpenCorvusClient()` receives the configured directory and start fails loudly without one.
- Extend `packages/channel-runtime/test/core-channel-protocol.test.ts` to assert `publishChannelAttachment()` posts with the configured directory and still surfaces upload failures.
- Extend `packages/opencorvus/test/server/app-routes.test.ts` to assert `Server.openapi()` removes the `directory` query from public signed GET while preserving it on project-scoped POST.

### Verification

- Focused test command: `bun test packages/channel-runtime/test/start-idempotency.test.ts packages/channel-runtime/test/core-channel-protocol.test.ts packages/opencorvus/test/server/app-routes.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=@opencorvus-ai/channel-runtime --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused channel-runtime tests passed: `bun test packages/channel-runtime/test/start-idempotency.test.ts packages/channel-runtime/test/core-channel-protocol.test.ts`.
- Focused OpenAPI directory assertion passed: `bun test packages/opencorvus/test/server/app-routes.test.ts -t "directory query"`.
- Full `app-routes.test.ts` currently exposes a separate pre-existing browser-preview request-body schema failure (`schema.properties.url.type` is undefined); that failure is outside this channel attachment batch and was not masked.
- Typecheck passed: `bunx turbo run typecheck --filter=@opencorvus-ai/channel-runtime --filter=opencorvus`.

## Batch P0-H: preserve provider credential and Hexin budget secrecy under local edits

### Findings

- Current working-tree edits to `packages/opencorvus/src/server/routes/provider.ts` removed three already-required protections from prior batches: saved provider credentials were no longer bound to that provider's configured API URL, Hexin budget upstream error bodies were returned to the overlay, and `HexinBudgetResponse` again allowed `{ ok: true }` without `budget` or `{ ok: false }` without `error`.
- Current working-tree edits to `packages/opencorvus/test/server/provider-hexin-budget.test.ts` removed the regression test that catches reflected `Authorization` leakage.
- This is not a compatibility path or fallback; the single route contracts remain the strict contracts from the earlier P0/P1 fixes.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/provider.ts` owns `/provider/discover-models`, `/provider/hexin/budget`, `HexinBudgetResponse`, and the shared provider URL normalization helper.
- `packages/opencorvus/src/provider/provider.ts` owns `Provider.resolveHexinApiKey()` and `Provider.getProvider()` used by these routes.
- `packages/opencorvus/test/server/provider-hexin-budget.test.ts` covers Hexin budget success, missing key, malformed upstream JSON, and reflected upstream authorization redaction.
- `packages/opencorvus/test/server/provider-discover-models.test.ts` covers saved-key exfiltration prevention for discovery.
- `packages/overlay/src/services/config.ts` exposes `getHexinBudget()` as the overlay consumer contract.

### Fix Shape

- Keep saved provider credentials usable only when the requested discovery base URL normalizes to one of that provider's configured model API base URLs.
- Keep Hexin budget non-2xx responses body-blind: status and status text are returned, never the upstream response body.
- Keep Hexin budget thrown errors redacted against the active API key before returning them.
- Restore the discriminated `HexinBudgetResponse` schema and the reflected-authorization redaction test.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/provider-hexin-budget.test.ts packages/opencorvus/test/server/provider-discover-models.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/server/provider-hexin-budget.test.ts packages/opencorvus/test/server/provider-discover-models.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-D: OAuth callback error HTML escaping

### Findings

- BH-010: `packages/opencorvus/src/mcp/oauth-callback.ts` renders `HTML_ERROR(error)` with `${error}` directly inside `<div class="error">`.
- The route sets `errorMsg = errorDescription || error` from OAuth callback query parameters before rendering the error page, so a malicious OAuth provider can reflect HTML/script into the local callback page.
- This is a response-rendering bug, not an OAuth-state bug. The callback promise should still reject with the original provider error text; only the HTML response must encode it.

### Call-point Inventory

- `packages/opencorvus/src/mcp/oauth-callback.ts` owns the local Bun callback server, `HTML_ERROR`, pending callback resolution/rejection, and fixed callback path handling.
- `packages/opencorvus/src/mcp/index.ts` starts the callback flow and registers `McpOAuthCallback.waitForCallback()` before opening the browser.
- `packages/opencorvus/test/mcp/oauth-callback-cancel.test.ts` already owns focused callback namespace tests and stops the server after each case.
- `packages/opencorvus/test/mcp/oauth-browser.test.ts` exercises full MCP OAuth browser behavior but has slower mocked browser timing and should not be expanded for this narrow HTML rendering contract.

### Fix Shape

- Add a small local HTML text escaping helper for `&`, `<`, `>`, `"`, and `'`.
- Call the helper inside `HTML_ERROR` at the interpolation boundary.
- Do not add UI-side sanitization, content-type gates, or callback-state gates; the route's HTML renderer is the single source of this output contract.

### Regression Tests

- Extend `packages/opencorvus/test/mcp/oauth-callback-cancel.test.ts` with a real callback-server request containing HTML in `error_description` and `error`.
- Register a matching pending state so the error path also exercises rejection cleanup.
- Assert the response contains escaped text and does not contain raw `<script>`, `<img`, or unescaped quoted attributes.

### Verification

- Focused test command: `bun test packages/opencorvus/test/mcp/oauth-callback-cancel.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/mcp/oauth-callback-cancel.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-E: OAuth callback port ownership fail-fast

### Findings

- BH-011: `McpOAuthCallback.ensureRunning()` treats any listener on fixed port `19876` as if the local callback server is already running.
- `MCP.authenticate()` relies on process-local `McpOAuthCallback.waitForCallback()` state. If another process owns `19876`, the browser callback goes to that process, while the current process waits until the five-minute callback timeout.
- The fixed callback port cannot be safely shared without a process-owned callback listener and matching in-memory state, so accepting an external listener is not a valid compatibility path.

### Call-point Inventory

- `packages/opencorvus/src/mcp/oauth-callback.ts` owns callback server creation, process-local pending callback state, and `isRunning()`.
- `packages/opencorvus/src/mcp/index.ts` calls `McpOAuthCallback.ensureRunning()` before generating OAuth state and before `authenticate()` registers `waitForCallback()`.
- `packages/opencorvus/src/mcp/oauth-provider.ts` owns the fixed `OAUTH_CALLBACK_PORT` and callback URL.
- `packages/opencorvus/test/mcp/oauth-callback-cancel.test.ts` already owns focused callback-server lifecycle tests and can bind a dummy server to the fixed port.
- `packages/opencorvus/test/mcp/oauth-browser.test.ts` owns higher-level `MCP.authenticate()` OAuth flow tests, but the current file already exceeds Bun's 5s default timeout in this workspace and is not a stable narrow regression target for this batch.

### Fix Shape

- Keep `if (server) return` for the local process-owned callback server.
- Otherwise call `Bun.serve()` directly on `OAUTH_CALLBACK_PORT`; if the bind fails, throw a deterministic error naming the occupied callback port.
- Do not attempt cross-process callback sharing, alternate-port fallback, provider allowlists, or delayed waiting. OAuth auth must fail before state registration when the local callback listener cannot be created.

### Regression Tests

- Bind a dummy `Bun.serve()` listener on `OAUTH_CALLBACK_PORT`.
- Assert `McpOAuthCallback.ensureRunning()` rejects immediately and `McpOAuthCallback.isRunning()` remains false.
- This covers the `MCP.authenticate()` failure point because `MCP.startAuth()` calls `ensureRunning()` before OAuth state generation, browser open, transport creation, or `waitForCallback()` registration.
- Keep the existing callback cancel and HTML escaping tests unchanged.

### Verification

- Focused test command: `bun test packages/opencorvus/test/mcp/oauth-callback-cancel.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/opencorvus/test/mcp/oauth-callback-cancel.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-F: active project route update ownership

### Findings

- BH-013: `PATCH /project/:projectID` validates the path parameter and body, then calls `Project.update({ ...body, projectID })`.
- Server project routes are project-scoped by directory middleware. A request carrying directory for project A can still put project B's ID in the path and mutate B, because the handler does not compare the path ID against `Instance.project.id`.
- `Project.update()` is a lower-level global project mutation used by internal project discovery and should not be narrowed to ambient `Instance` context. The HTTP route is the ownership boundary.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/project.ts` owns `PATCH /project/:projectID` and has active `Instance.project.id` available after directory binding.
- `packages/opencorvus/src/project/project.ts` owns `Project.update()` and updates by global project ID.
- `packages/opencorvus/test/server/project-routes.test.ts` already exercises real `Server.App()` project routes with `x-opencorvus-directory`.
- `packages/opencorvus/src/server/error-handler.ts` maps `NotFoundError` to HTTP 404, which matches the route's documented `errors(400, 404)`.

### Fix Shape

- In `PATCH /project/:projectID`, require the path project ID to equal `Instance.project.id`.
- On mismatch, throw `NotFoundError` and do not call `Project.update()`.
- Do not add a new cross-project update route, fallback to `directory`, or accept path/body disagreement. The active project selected by directory is the single project mutation target for this route.

### Regression Tests

- Extend `packages/opencorvus/test/server/project-routes.test.ts`.
- Create project A and project B through real `Instance.provide()` directory binding.
- Send `PATCH /project/<projectB>` with project A's directory header and assert 404.
- Re-read project B from storage and assert its name is unchanged.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/project-routes.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Focused ownership test passed: `bun test packages/opencorvus/test/server/project-routes.test.ts -t "PATCH /project/:projectID"`.
- Full `project-routes.test.ts` currently exposes a separate pre-existing cleanup-candidates failure: `GET /project/current/cleanup-candidates is read-only ownership inspection` returns no `processOrphans` for the seeded dead PID in this environment. That failure is outside BH-013 and was not masked.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-G: memory get/delete project ownership

### Findings

- BH-014: `packages/opencorvus/src/server/routes/panel.ts` lists and searches memory with `projectId: Instance.project.id`, but `GET /panel/knowledge/memory/:id` calls global `Memory.getFile(id)` / `Memory.getChunks(id)` and `DELETE /panel/knowledge/memory/:id` calls global `Memory.deleteFile(id)`.
- `packages/opencorvus/src/tool/memory.ts` has the same split: search/list/write are project-scoped, while get/delete currently use global memory file IDs.
- `Memory.getFileInProject()` and `Memory.getChunksInProject()` already exist and are used by agent context tools. The delete boundary is still global and must move into the memory API itself.

### Call-point Inventory

- `packages/opencorvus/src/memory/index.ts` owns global and project-scoped memory row access helpers.
- `packages/opencorvus/src/server/routes/panel.ts` owns `/panel/knowledge/memory` list/get/search/delete routes under project directory middleware.
- `packages/opencorvus/src/tool/memory.ts` owns the model-facing `memory` tool and derives the active project from `Instance.project.id`.
- `packages/opencorvus/test/agent/context-tools.test.ts` already covers separate agent context memory_get project isolation, but not the MemoryTool wrapper or panel HTTP routes.

### Fix Shape

- Change panel get to resolve the file with `Memory.getFileInProject({ fileId, projectId: projectId() })`.
- Change MemoryTool get to resolve the file with `Memory.getFileInProject({ fileId, projectId })`.
- Use `Memory.getChunksInProject()` for content reads after the ownership check.
- Replace the global exported delete primitive with `Memory.deleteFileInProject({ fileId, projectId })`. Its transaction must constrain FTS chunk deletion, `memory_chunk` deletion, and `memory_file` deletion by both file ID and project ID.
- Panel delete and MemoryTool delete must call the scoped delete API directly and return 404 / "Not found" from its result, not from a separate precheck followed by global deletion.
- Do not add fallback lookups, allowlists, or cross-project memory routes.

### Regression Tests

- Add a `Server.App()` panel route test that creates memory under projects A and B, asserts A can get/delete its own row, asserts A cannot get/delete B's row, and confirms B's file, chunks, and search results remain.
- Extend `packages/opencorvus/test/tool/memory.test.ts` so MemoryTool get/delete against a project B file under project A return "Not found", leave B searchable, and the same tool can delete an A-owned row.
- Extend `packages/opencorvus/test/memory/stages.test.ts` with direct `deleteFileInProject` API coverage for foreign delete returning false while preserving the foreign file, chunks, and FTS result.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/panel-memory-routes.test.ts packages/opencorvus/test/tool/memory.test.ts packages/opencorvus/test/memory/stages.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Independent agent review rejected the first caller-precheck/global-delete shape; the final implementation moves delete ownership into `Memory.deleteFileInProject({ fileId, projectId })`.
- Focused tests passed: `bun test packages/opencorvus/test/server/panel-memory-routes.test.ts packages/opencorvus/test/tool/memory.test.ts packages/opencorvus/test/memory/stages.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.

## Batch P1-H: experimental schedule route project ownership

### Findings

- BH-015: `packages/opencorvus/src/server/routes/experimental.ts` accepts caller-supplied `projectId` on cron schedule list/create/delete and event-schedule list/create/delete routes.
- `sessionId` is also caller-supplied on create routes and can point at another project's session while the new job is stored under whichever project ID the caller supplied.
- `CronService` and `EventService` correctly filter by the project ID they are handed; the HTTP route is the untrusted boundary that currently chooses that project ID from request data.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/experimental.ts` is the only caller of `CronService.list/create/remove` and `EventService.list/create/remove`.
- `packages/opencorvus/src/scheduler/cron-service.ts` stores cron jobs in `CronJobTable`, polls only `Instance.project.id`, and wakes the optional stored `session_id`.
- `packages/opencorvus/src/scheduler/event-service.ts` stores event jobs in `EventJobTable`, processes events only for `Instance.project.id`, and wakes the optional stored `session_id`.
- `packages/opencorvus/src/tool/schedule.ts` already binds schedule operations to `Instance.project.id` directly and is not the vulnerable route surface.
- `Session.get()` exposes `projectID` for validating that optional schedule `sessionId` belongs to the active project.

### Fix Shape

- Remove `projectId` from experimental schedule and event-schedule route query/body contracts. Reject caller-supplied `projectId` via strict validators instead of ignoring it.
- Bind all six routes to `Instance.project.id` and pass that project ID into `CronService` / `EventService`.
- Add service-level session ownership validation for create calls: if `sessionId` is present, it must resolve to a session row in the same `projectId`, otherwise throw `NotFoundError`.
- Change service remove calls to return whether a row was deleted; route delete returns 404 when the job ID is absent from the active project.
- Do not add allowlists, compatibility fallbacks, or cross-project schedule endpoints.

### Regression Tests

- Add a `Server.App()` route test with projects A and B. Under project A, `GET/DELETE` with `?projectId=<B>` must return 400 and leave B rows intact.
- Under project A, `POST /experimental/schedule` and `/event-schedule` with body `projectId: <B>` must return 400 and create no B rows.
- Under project A, create calls with a project B `sessionId` must return 404 and create no rows.
- Valid creates under project A without `projectId` must create rows under project A only; deleting project B job IDs from project A must return 404 and leave B rows intact.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/experimental-schedule-routes.test.ts packages/opencorvus/test/scheduler/cron-service.test.ts packages/opencorvus/test/scheduler/event-service.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Independent agent review confirmed the vulnerable boundary is the experimental route contract, and flagged the additional SDK/OpenAPI `projectId` contract leak and legal `directory` query requirement.
- Focused tests passed: `bun test packages/opencorvus/test/server/experimental-schedule-routes.test.ts packages/opencorvus/test/server/experimental-schedule-contract.test.ts packages/opencorvus/test/scheduler/cron-service.test.ts packages/opencorvus/test/scheduler/event-service.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus` and `bunx turbo run typecheck --filter=@opencorvus-ai/sdk`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P1-I: session config route project ownership

### Findings

- BH-016: `packages/opencorvus/src/server/routes/session.ts` accepts a raw `:sessionID` for `GET /session/:sessionID/config` and `PATCH /session/:sessionID/config`.
- `sessionConfig()` calls global `Session.get(sessionID)` before `EffectiveConfig.base({ sessionID })`; for a foreign session, `EffectiveConfig.base` switches to the foreign session directory and can return that project's effective config.
- `Session.mergeConfigOverlay()` reads and updates `SessionTable` by session ID only, so the route write path can mutate a foreign session's overlay.

### Call-point Inventory

- Config HTTP routes: `packages/opencorvus/src/server/routes/session.ts` is the only route owner for `session.config.get` and `session.config.update`.
- Read helper: `sessionConfig(sessionID)` calls `Session.get`, `EffectiveConfig.base`, `Config.Overlay.parse`, and `Config.mergeOverlay`.
- Write helper: `Session.mergeConfigOverlay()` is called by the session config route, mission route prompt-profile updates, task creation/model updates, task follow-up prompt-profile updates, and tests. All production callers are current-project contexts.
- `Session.list()` and `Session.children()` already scope by `Instance.project.id`, and `treeInProject` / `childrenInProject` show the existing project-scoped service API pattern.
- SDK/OpenAPI already model these routes with `directory` query and `sessionID` path only; no generated contract field needs to change.

### Fix Shape

- Add `Session.getInProject({ sessionID, projectID })` as the project-scoped read primitive for a single session row.
- Add `Session.mergeConfigOverlayInProject({ sessionID, projectID, patch })` and make the existing `Session.mergeConfigOverlay({ sessionID, patch })` delegate to it with `Instance.project.id`, so the write boundary itself constrains the `UPDATE` by both session ID and project ID.
- Change `sessionConfig()` to take a project ID, load the session with `Session.getInProject`, then resolve the base/effective config only after ownership is proven.
- Change the GET/PATCH config routes to pass `Instance.project.id`; prompt-profile validation and the final response must use the project-scoped helper.
- Do not add compatibility lookups, fallback project matching, or route-level allowlists.

### Regression Tests

- Add a `Server.App()` route test with projects A and B. Under project A, `GET /session/<B>/config` returns 404 and does not expose B's overlay or project config.
- Under project A, `PATCH /session/<B>/config` returns 404 and leaves B's `metadata.configOverlay` unchanged.
- Confirm valid project A GET/PATCH still works and returns the session origin tree.
- Add direct service coverage that `Session.mergeConfigOverlay()` under project A rejects a project B session and does not mutate the foreign row.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/session-config-routes.test.ts packages/opencorvus/test/server/session-routes.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Independent agent review confirmed the vulnerable path is route-level raw `sessionID` use plus service-level `mergeConfigOverlay` reading/writing by session ID only.
- Added project-scoped `Session.getInProject()` and `Session.mergeConfigOverlayInProject()`; the existing `Session.mergeConfigOverlay()` now binds writes to `Instance.project.id` instead of global session ID updates.
- Focused tests passed: `bun test packages/opencorvus/test/server/session-config-routes.test.ts packages/opencorvus/test/server/session-routes.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P1-J: export session route project ownership

### Findings

- BH-017: `packages/opencorvus/src/server/routes/export.ts` handles `GET /export/session/:sessionID` under the project-scoped app, but reads the target with global `Session.get(sessionID)`.
- After the global read, it calls `Session.messages({ sessionID })` and returns session metadata plus the transcript, so a request under project A can export a project B session.

### Call-point Inventory

- Route mount: `packages/opencorvus/src/server/routes/app.ts` mounts `ExportRoutes()` at `/export` inside the project-scoped route tree.
- Route implementation: `packages/opencorvus/src/server/routes/export.ts` contains the only `export.session` HTTP operation.
- Existing tests only cover retired task export/import routes in `packages/opencorvus/test/server/task-export-retired.test.ts`; there is no active session export ownership coverage.
- SDK/OpenAPI expose the route with `sessionID` path and optional project `directory` query; no request contract change is required.

### Fix Shape

- Replace the global route read with `Session.getInProject({ sessionID, projectID: Instance.project.id })`.
- Keep `Session.messages({ sessionID })` after ownership is proven; do not add a second export path, compatibility fallback, or client-side gate.
- Return the same success payload for owned sessions and 404 for missing or foreign sessions.

### Regression Tests

- Add a `Server.App()` route test with projects A and B. Exporting project B's session under project A must return 404 and the response must not include B's title or message content.
- Exporting project A's own session under project A must return 200 with the same session metadata shape and messages array.
- Keep the retired task export/import route test unchanged.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/export-routes.test.ts packages/opencorvus/test/server/task-export-retired.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Independent agent review confirmed `/export/session/:sessionID` is project-scoped by middleware but previously used global `Session.get(sessionID)` before transcript export.
- Added project ownership enforcement via `Session.getInProject({ sessionID, projectID: Instance.project.id })` before reading messages.
- Focused tests passed: `bun test packages/opencorvus/test/server/export-routes.test.ts packages/opencorvus/test/server/task-export-retired.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P1-K: session artifact read route project ownership

### Findings

- BH-018: `GET /session/:sessionID/todo`, `GET /experimental/task-plan?sessionId=...`, and `GET /experimental/scratchpad?sessionId=...` read session-owned artifacts directly from caller-supplied session IDs.
- The project-scoped route middleware has already selected `Instance.project.id`, but these handlers do not prove the requested session belongs to that project before calling global artifact readers.
- `Todo.get`, `TaskPlan.list`, and `Scratchpad.get` are session-local storage primitives and intentionally do not receive a project ID; the HTTP routes are the untrusted boundary.

### Call-point Inventory

- `Todo.get(sessionID)` is used by the session todo route, todo read tool, session compaction, and ACP transcript mapping. Only the route accepts arbitrary user-supplied session IDs outside an existing session context.
- `TaskPlan.list(sessionID)` is used by the experimental task-plan route, planner tool, and `TaskPlan.toMarkdown`; only the route accepts a query `sessionId` from HTTP callers.
- `Scratchpad.get(sessionID)` is used by the experimental scratchpad route, planner tool, scratchpad append/system-prompt helpers, and compaction; only the route accepts a query `sessionId` from HTTP callers.
- `Session.getInProject({ sessionID, projectID })` is the existing single-session project ownership primitive introduced for BH-016 and reused by BH-017.

### Fix Shape

- Before each artifact read route calls `Todo.get`, `TaskPlan.list`, or `Scratchpad.get`, call `Session.getInProject({ sessionID, projectID: Instance.project.id })`.
- Preserve the success payloads for owned sessions and return 404 for missing or foreign sessions.
- Do not add artifact-level fallback reads, compatibility query parameters, or allowlists.

### Regression Tests

- Add a `Server.App()` route test with projects A and B. Seed project B with todos, task-plan rows, and scratchpad content.
- Under project A, request B's todo, task-plan, and scratchpad endpoints and assert 404 with no B marker text in the response.
- Under project A, seed owned artifacts and assert the same endpoints still return the expected todo/task/scratchpad payloads.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/session-artifact-routes.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Independent agent review confirmed the three vulnerable endpoints are HTTP trust boundaries over session-local artifact stores.
- Added project ownership checks via `Session.getInProject({ sessionID, projectID: Instance.project.id })` before reading todo, task-plan, or scratchpad rows.
- Focused tests passed: `bun test packages/opencorvus/test/server/session-artifact-routes.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P1-L: PTY route project ownership regression

### Findings

- BH-019 records a risk that `/pty` routes use raw PTY IDs for list/get/update/remove/connect.
- Current code already stores PTY host sessions in `lazyInstanceState`, which delegates to `Instance.state(() => Instance.directory, ...)`; this makes `PtyHost.list/get/rename/resize/remove/preparePtyConnect` operate on the active project directory's state map.
- `PtyRoutes` is mounted under `AppRoutes` at `/pty`, and `Server.App()` project middleware binds `Instance.provide` from `?directory=` or `x-opencorvus-directory` before route execution.
- Existing PTY tests mostly call `PtyRoutes()` inside a manual `Instance.provide`, so they do not prove the real `Server.App()` middleware boundary for cross-project requests.

### Call-point Inventory

- `Pty.list/get/update/remove/connect` are called only by `packages/opencorvus/src/server/routes/pty.ts` in production route code.
- `Pty.create` enforces `cwd === Instance.directory` through `projectCwd`.
- `PtyHost.startPrepared/list/get/rename/resizePty/remove/preparePtyConnect` all read the same `state()` instance-scoped map.
- SDK/OpenAPI expose the existing `/pty` route contracts with optional project directory injection; no request contract change is required.

### Fix Shape

- Do not add a second ownership source or duplicate PTY project fields unless the route-level regression proves the existing instance-scoped state leaks.
- Add a `Server.App()` regression test that creates a PTY under project A, then sends list/get/update/remove/connect requests under project B and asserts B cannot observe or mutate A's PTY.
- Preserve the existing success behavior for project A.

### Regression Tests

- Create A/B git-backed temp projects. Under A, `POST /pty` starts a long-lived PTY.
- Under B, `GET /pty` returns an empty list, `GET /pty/:id`, `PUT /pty/:id`, `DELETE /pty/:id`, and `/pty/:id/connect` return 404 before websocket upgrade.
- Under A, the PTY remains readable after B's rejected update/delete attempts and can be removed normally.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/pty-routes.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Result

- Implemented on 2026-06-17.
- Independent agent review confirmed regular PTY HTTP operations are already instance-scoped, and identified websocket connect as the context-lifetime risk.
- Added pre-upgrade project-scoped PTY visibility validation so foreign project connect requests return 404 before websocket upgrade.
- Wrapped websocket lifecycle callbacks in the request directory's `Instance.provide` context, using the same project directory decoding helper as server middleware.
- Focused tests passed: `bun test packages/opencorvus/test/server/pty-routes.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P1-M: session message and part route ownership

### Findings

- BH-020: `GET /session/:sessionID/message/:messageID` carries both IDs in the route, but `Message.get({ sessionID, messageID })` currently queries `MessageTable` only by `messageID` and loads parts only by `messageID`.
- The adjacent `GET /session/:sessionID/message` list route is the same HTTP trust boundary: under project A, a caller can supply a project B `sessionID` unless the route proves active-project ownership before reading transcript rows.
- BH-021: `PATCH /session/:sessionID/message/:messageID/part/:partID` validates that the request body IDs match the route IDs, then calls `Session.updatePart(body)`. `Session.updatePart` upserts by global `partID`, so a foreign existing part with the same ID can be overwritten if the caller supplies its route/body IDs.
- `removeMessage` and `removePart` already constrain deletes by session ID, but BH-022 tracks their missing affected-row checks separately.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/session.ts` owns the HTTP list messages, GET message, DELETE message, DELETE part, and PATCH part routes.
- `packages/opencorvus/src/session/message.ts` owns `Message.get` and `Message.parts`; other callers use `Message.get` after they already have a session-local message ID, so the scoped service query is the single safe boundary.
- `packages/opencorvus/src/session/index.ts` owns `Session.updatePart`; it is used by live session processing, shell/command execution, compaction, control messages, tools, and tests as both create and update primitive.
- Because `Session.updatePart` is also the create primitive, the fix must allow inserting a new part only when `(sessionID, messageID)` exists, and must reject updating an existing `partID` whose stored `session_id` or `message_id` differs.

### Fix Shape

- At every message/part HTTP route that accepts `:sessionID`, prove `Session.getInProject({ sessionID, projectID: Instance.project.id })` before reading, deleting, or patching message state.
- Change `Message.get` to query `MessageTable` by both `messageID` and `sessionID`; missing or wrong-session messages return the same not-found path.
- In `Session.updatePart`, before the upsert, assert that the owning message row exists for `(sessionID, messageID)`. Then read any existing part by `partID`; if it exists under another session or message, reject as not found before `onConflictDoUpdate`.
- Reuse the same existing part row for tool-status monotonicity; do not add route-level prechecks, compatibility fallback reads, or global override paths.

### Regression Tests

- Add a `Server.App()` route test with projects A and B. Seed B with a session, message, and text part.
- Under project A, request `/session/<B-session>/message` and `/session/<A-session>/message/<B-message>` and assert 404 with no B text leaked.
- Under project A, patch `/session/<A-session>/message/<A-message>/part/<B-part>` with a route/body-consistent A payload and assert 404; then verify B can still read its original part text unchanged.
- Assert A can still read its own message and patch its own part successfully.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/session-message-routes.test.ts packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/session/part-delta.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus`

### Independent Review Feedback

- Hume confirmed the current patch closes BH-020 and BH-021 as written: `Message.get` is scoped by `(sessionID, messageID)`, routes prove active-project session ownership, and `Session.updatePart` rejects existing foreign `partID` rows before upsert.
- Hume also identified adjacent isolation surfaces not covered by the original BH-020/BH-021 statement: `/:sessionID/conversation`, `/:sessionID/summarize`, and `Session.removePart`'s missing `messageID` predicate. These should be handled as a follow-up review item instead of silently expanding this batch.

### Result

- Implemented on 2026-06-17.
- Added project ownership checks before message list/get/delete and part delete/patch route handlers read or mutate `:sessionID` resources.
- Changed `Message.get` to resolve a message by both session ID and message ID.
- Hardened `Session.updatePart` so existing part rows cannot be overwritten through a foreign global part ID, and new parts require their owning message row to exist in the same session.
- Focused tests passed: `bun test packages/opencorvus/test/server/session-message-routes.test.ts`.
- Adjacent session tests passed after aligning stale token fixtures with the current `Message.TokenUsage` schema: `bun test packages/opencorvus/test/session/part-delta.test.ts packages/opencorvus/test/session/session.test.ts packages/opencorvus/test/session/prompt.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P1-N: remaining session route active-project ownership

### Findings

- Independent follow-up review found P1 cross-project reads and writes outside the BH-020/BH-021 message routes.
- `GET /session/:sessionID/conversation` read `Session.get(sessionID)` and `Session.messages({ sessionID })` before proving the requested session belonged to `Instance.project.id`, so project A could hydrate project B's conversation transcript.
- `POST /session/:sessionID/summarize` read a global session, cleared rewind state, created a compaction control row, and started a summary loop for a caller-supplied session ID.
- Adjacent `:sessionID` HTTP handlers still called global services that trust the supplied ID: `events`, `get`, `children`, `delete`, `patch`, `init`, `fork`, `abort`, `diff`, sync prompt, async prompt, async prompt status, command, and shell.

### Call-point Inventory

- `Session.get(sessionID)` in `applySessionPromptRouteOverlay`, conversation, events, get, patch, and summarize was replaced or guarded with active-project session resolution.
- `Session.children(sessionID)`, `Session.fork({ sessionID })`, `Session.initialize({ sessionID })`, `SessionSummary.diff({ sessionID })`, `SessionPrompt.cancel(sessionID)`, `TaskQueueService.cancelSessionPrompts({ sessionIDs })`, `TaskQueueService.executePrompt`, `TaskQueueService.enqueuePromptAfterPersistingUserMessage`, `TaskQueueService.getStatus`, `SessionPrompt.command`, and `SessionPrompt.shell` remain service primitives, but the HTTP handlers now prove the session belongs to the active project before calling them.
- Already-fixed message list/get/delete and part delete/patch handlers keep using `assertActiveProjectSession`.
- `Session.getInProject({ sessionID, projectID: Instance.project.id })` is the existing single source for this route boundary; no route allowlist, fallback lookup, or client-side compatibility path was added.

### Fix Shape

- Introduce a route-local `getActiveProjectSession(sessionID)` helper that returns `Session.getInProject({ sessionID, projectID: Instance.project.id })`; keep `assertActiveProjectSession` as a thin wrapper for handlers that do not need the session object.
- Replace global reads in conversation/get/summarize and prompt overlay with `getActiveProjectSession`.
- Add `await assertActiveProjectSession(sessionID)` before each remaining untrusted `:sessionID` HTTP operation that reads, mutates, queues, or executes session-scoped work.
- Preserve owned-session success payloads and return 404 for missing or foreign sessions.

### Regression Tests

- Add a `Server.App()` route test with projects A and B. Seed project B with a session, message, and text part.
- Under project A, request B's conversation and assert 404 with no B title/message leaked.
- Under project A, request B's summarize route and assert 404 and no `manual_summarize` control row is created for B.
- Under project A, exercise the remaining read/mutate/queue/execute session routes with B's session ID and assert 404 before side effects.
- Under the owning project B, assert representative owned routes still succeed.

### Result

- Implemented on 2026-06-17.
- Added route-local `getActiveProjectSession(sessionID)` and reused `Session.getInProject({ sessionID, projectID: Instance.project.id })` as the single active-project session boundary.
- Replaced global session reads in prompt overlay, conversation hydrate, session get, and summarize with active-project session reads.
- Added active-project checks before events, children, delete, patch, init, fork, abort, diff, async prompt status, command, and shell handlers call their session-scoped service primitives.
- Added `packages/opencorvus/test/server/session-ownership-routes.test.ts` covering foreign-session rejection for conversation, summarize, events, get, children, delete, patch, init, fork, abort, diff, sync prompt, async prompt, async prompt status, command, and shell.
- Focused test passed: `bun test packages/opencorvus/test/server/session-ownership-routes.test.ts`.
- Combined focused tests passed: `bun test packages/opencorvus/test/server/session-ownership-routes.test.ts packages/opencorvus/test/server/session-message-routes.test.ts packages/opencorvus/test/server/session-prompt-async.test.ts packages/opencorvus/test/session/part-delta.test.ts packages/opencorvus/test/session/session.test.ts packages/opencorvus/test/session/prompt.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P2-A: BH-022 message and part delete row ownership

### Findings

- BH-022 remained after route-level project checks: `Session.removeMessage` and `Session.removePart` issued deletes without inspecting affected rows.
- A nonexistent or wrong-session message/part delete returned success and published a removal event even when the database row was not deleted.
- `Session.removePart` also deleted by `(partID, sessionID)` without `messageID`, so a same-session request for `/message/M1/part/P2` could delete a part that actually belonged to `M2` and publish the removal under the wrong message.

### Call-point Inventory

- `Session.removeMessage` is called by the HTTP delete-message route and session rewind cleanup paths.
- `Session.removePart` is called by the HTTP delete-part route and compaction cleanup paths.
- `Message.Event.Removed` and `Message.Event.PartRemoved` are consumed by protocol/message bridge and session mirror subscribers; publishing them for zero-row deletes corrupts observable state.
- `NotFoundError` from `storage/db` is the existing server-mapped 404 error class.

### Fix Shape

- Make `removeMessage` delete with the complete `(messageID, sessionID)` key and require one returned row before publishing `Message.Event.Removed`.
- Make `removePart` delete with the complete `(partID, sessionID, messageID)` key and require one returned row before publishing `Message.Event.PartRemoved`.
- Throw `NotFoundError` when the complete key does not match a row; do not publish removal events on miss.
- Do not add service fallback reads, route compatibility behavior, or silent no-op deletes.

### Regression Tests

- Delete nonexistent message/part and assert 404 plus no removal event.
- Delete a project A session with project B message/part IDs and assert 404 plus no removal event.
- Delete a same-session part through the wrong message ID and assert 404, original row still exists, and no removal event.
- Delete owned message/part rows and assert 200 with one correct removal event.

### Result

- Implemented on 2026-06-17.
- Changed `Session.removeMessage` to delete by `(messageID, sessionID)` with a returned-row check before publishing `Message.Event.Removed`.
- Changed `Session.removePart` to delete by `(partID, sessionID, messageID)` with a returned-row check before publishing `Message.Event.PartRemoved`.
- Missing, wrong-session, and same-session wrong-message deletes now throw `NotFoundError` and publish no removal event.
- Added route regression coverage in `packages/opencorvus/test/server/session-message-routes.test.ts` for nonexistent rows, wrong-session rows, same-session wrong-message part rows, and owned delete success events.
- Focused test passed: `bun test packages/opencorvus/test/server/session-message-routes.test.ts`.
- Combined focused tests passed: `bun test packages/opencorvus/test/server/session-ownership-routes.test.ts packages/opencorvus/test/server/session-message-routes.test.ts packages/opencorvus/test/server/session-prompt-async.test.ts packages/opencorvus/test/session/part-delta.test.ts packages/opencorvus/test/session/session.test.ts packages/opencorvus/test/session/prompt.test.ts`.
- Typecheck passed: `bunx turbo run typecheck --filter=opencorvus`.
- Contract checks passed: `bun run api:routes-check` and `bun run docs:check`.

## Batch P0-I: BH-090 WhatsApp and Mattermost inbound authentication

### Findings

- BH-090 covers several unauthenticated inbound channel adapters, but the correct fix is platform-specific verification, not a shared local gate.
- `packages/channel-runtime/src/adapters/whatsapp.ts` only optionally checks the GET challenge token and accepts unsigned POST delivery. WhatsApp webhooks provide a verify token for subscription and `x-hub-signature-256` payload signatures based on the Meta app secret.
- `packages/channel-runtime/src/adapters/mattermost.ts` accepts JSON or form POSTs without checking the Mattermost outgoing-webhook token.
- MS Teams, DingTalk, Google Chat, and WeCom remain in the deferred channel set for this batch because the real fixes require Bot Framework activity JWT verification, DingTalk callback crypto, Google Chat request JWT verification, and WeCom callback token/AES verification plus message decryption. A synthetic shared token or a custom-robot outbound signature would hide the actual protocol work.

### Call-point Inventory

- `packages/channel-config/src/index.ts` owns channel env fields and required-field status used by UI/config/schema and runtime env resolution.
- `packages/channel-runtime/src/registry.ts` maps resolved env fields into adapter constructor options and owns skip warnings for incomplete channel config.
- `packages/channel-runtime/src/adapters/whatsapp.ts` owns WhatsApp GET challenge handling, POST parsing, message dispatch, and outbound Cloud API calls.
- `packages/channel-runtime/src/adapters/mattermost.ts` owns Mattermost outgoing-webhook JSON/form parsing, message dispatch, and outbound REST replies.
- `packages/channel-runtime/test/mainstream-adapters.test.ts` covers direct adapter behavior for the affected adapters.
- `packages/channel-runtime/test/registry.test.ts` covers required env registration and constructor option forwarding.
- `packages/web/src/content/docs/channels/{whatsapp,mattermost}.mdx` and `packages/web/src/content/docs/zh-cn/channels/{whatsapp,mattermost}.mdx` document the required env contract for operators.

### Fix Shape

- WhatsApp: require both `verifyToken` and `appSecret`; reject subscription challenges with a missing/wrong verify token; verify every POST using `x-hub-signature-256: sha256=<hex HMAC>` over the raw request body before JSON parsing or dispatch.
- Mattermost: add required `webhookToken` config/env, require the inbound JSON/form `token` to match before handler dispatch, and reject missing/wrong token with no message delivery.
- Do not add compatibility fallback paths, alternate unauthenticated modes, or shared channel-auth gates.

### Regression Tests

- WhatsApp token-only env is incomplete; GET challenge with a wrong token returns 401; POST with missing/wrong `x-hub-signature-256` returns 401 with no handler call; valid signed POST dispatches.
- Mattermost URL + bot token without webhook token is incomplete; missing/wrong inbound token returns 401 with no handler call; valid JSON and form webhook tokens dispatch.
- Existing outbound send paths for both adapters remain covered by the mainstream adapter tests.

### Verification

- Focused test command: `bun test packages/channel-runtime/test/mainstream-adapters.test.ts packages/channel-runtime/test/registry.test.ts`
- Typecheck command: `bun run --cwd packages/channel-runtime typecheck`

### Independent Review Feedback

- Socrates confirmed MS Teams remains the highest-risk unresolved P0 because it must verify Bot Framework activity JWTs before trusting `serviceUrl`.
- Socrates also flagged DingTalk as requiring DingTalk callback crypto rather than a custom-robot outbound signing shortcut. This batch deliberately excludes DingTalk to avoid a synthetic or wrong-protocol patch.

### Result

- Implemented on 2026-06-17.
- WhatsApp now requires `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`; subscription challenge requests with a wrong token return 401, and POST delivery requires a valid `x-hub-signature-256` HMAC before JSON parsing or handler dispatch.
- Mattermost now requires `MATTERMOST_WEBHOOK_TOKEN`; inbound JSON and form outgoing-webhook requests must carry the matching token before handler dispatch.
- Registry required-field tests now skip incomplete WhatsApp and Mattermost configuration instead of registering unauthenticated inbound endpoints.
- Operator docs now list the new required WhatsApp app secret and Mattermost outgoing webhook token.
- Focused tests passed: `bun test packages/channel-runtime/test/mainstream-adapters.test.ts packages/channel-runtime/test/registry.test.ts`.
- Package typechecks passed: `bun run --cwd packages/channel-runtime typecheck`, `bun run --cwd packages/channel-config typecheck`, and `bunx turbo run typecheck --filter=@opencorvus-ai/channel-runtime --filter=@opencorvus-ai/channel-config`.
- Docs check passed: `bun run docs:check`.

## Batch P0-J: BH-088 MS Teams Bot Connector activity authentication

### Findings

- BH-088 remains the highest-risk channel P0: `MSTeamsAdapter.route()` accepts unsigned POST activities, trusts the caller-supplied `serviceUrl`, stores it in `this.session`, and later sends the bot's Connector bearer token to that URL.
- Microsoft Bot Connector authentication requires incoming Connector requests to carry `Authorization: Bearer <JWT>` and requires the bot to verify issuer, audience, validity window, OpenID signing key, and the JWT `serviceUrl` claim against the root activity `serviceUrl`.
- A domain allowlist, shared local token, or optional auth bypass would not prove the Connector signed the activity and would still leave the bearer-token exfiltration path open.

### Call-point Inventory

- `packages/channel-runtime/src/adapters/msteams.ts` owns inbound activity parsing, session `serviceUrl` persistence, outbound replies, and token acquisition for Connector sends.
- `packages/channel-runtime/test/mainstream-adapters.test.ts` owns current MS Teams inbound and outbound adapter coverage.
- `packages/channel-runtime/package.json` had no direct JWT or Bot Framework dependency before this batch; the fix adds `jose` as a direct channel-runtime dependency instead of borrowing the existing transitive lock entry.
- Official protocol source: Microsoft Learn "Authentication with the Bot Connector API", sections "Authenticate requests from the Bot Connector service to your bot" and "Verify the JWT token".

### Fix Shape

- Add a focused MS Teams auth helper that verifies Connector-to-bot JWTs with `jose` before route dispatch or session persistence.
- Verification requirements: Bearer scheme, valid three-part JWT, `alg` `RS256`, issuer `https://api.botframework.com`, audience equal to configured `appId`, `nbf`/`exp` with five-minute clock skew, valid signature against `https://login.botframework.com/v1/.well-known/openidconfiguration` JWKS, and `payload.serviceUrl === activity.serviceUrl`.
- Cache OpenID metadata/JWKS for at most 24 hours, matching Microsoft guidance that keys are stable but can be added.
- In `MSTeamsAdapter.route()`, parse JSON first for a 400 malformed-body response, then authenticate every POST activity before checking `type`, invoking the handler, or writing `this.session`.
- Do not add fallback unauthenticated mode, serviceUrl allowlist shortcuts, or client-configurable auth disable flags.

### Regression Tests

- Missing `Authorization` returns 401, does not call the handler, does not persist a session, and a later `sendMessage()` for that channel still throws "not initialized".
- Wrong signature, wrong issuer, wrong audience, expired token, wrong `channelId`, missing `msteams` key endorsement, and `serviceUrl` claim mismatch return 401 with the same no-handler/no-session behavior.
- A valid RS256 fixture backed by a local JWKS dispatches, writes the session, and outbound `sendMessage()` posts to the authenticated `serviceUrl`.
- Existing screenshot hero-card send behavior remains covered through a pre-seeded authenticated session.

### Verification

- Focused test command: `bun test packages/channel-runtime/test/mainstream-adapters.test.ts`
- Typecheck command: `bun run --cwd packages/channel-runtime typecheck`

### Independent Review Feedback

- Planck confirmed that the correct minimal repair is Bot Connector Bearer JWT/JWKS verification before any `serviceUrl` persistence.
- Planck specifically recommended a direct `jose` dependency rather than hand-written RSA verification or transitive dependency borrowing.
- Planck also required rejecting unauthenticated dev/emulator fallback paths, domain allowlists, decoded-but-unverified JWTs, and HMAC schemes that do not match Bot Connector inbound authentication.

### Result

- Implemented on 2026-06-17.
- Added `packages/channel-runtime/src/adapters/msteams-auth.ts` using `jose` to verify Bot Connector JWTs against the official OpenID metadata and JWKS.
- `MSTeamsAdapter.route()` now parses JSON, verifies every POST activity, and only then applies message filtering, invokes handlers, or writes `this.session`.
- Verification enforces Bearer auth, RS256, issuer `https://api.botframework.com`, audience equal to the bot app ID, token validity, `msteams` channel ID and key endorsement, and exact JWT/activity `serviceUrl` match.
- Added direct `jose` dependency to `@opencorvus-ai/channel-runtime`.
- Focused tests passed: `bun test packages/channel-runtime/test/mainstream-adapters.test.ts`.
- Typecheck passed: `bun run --cwd packages/channel-runtime typecheck`.

## Batch P1-K: BH-095 managed channel runtime env isolation

### Findings

- BH-095 remains a P1 project-isolation and credential-residue bug: `ChannelSupervisor.desired()` read adapter credentials from global `process.env`, `startInProcess()` wrote project config credentials back into global `process.env`, and adapter registration then resolved from that same global env.
- The old chain let Slack config A survive after the project channel config was deleted or emptied. Updating Slack A to Slack B could also keep registering A because the old `if (!process.env[key])` write refused to overwrite the stale global value.
- `registerAdapters()` already accepted an explicit env object, so the root fix is to make managed channel runtime pass a scoped project env and to stop treating global env as a project channel config source.

### Call-point Inventory

- `packages/opencorvus/src/channel/supervisor.ts` owns managed runtime config resolution, runtime startup, and adapter registration.
- `packages/channel-runtime/src/registry.ts` owns adapter env resolution through `resolveChannel()`.
- `packages/channel-runtime/src/main.ts` is the standalone runtime entry and already passes `process.env` explicitly.
- `packages/opencorvus/src/channel/registry.ts` owns the UI channel status list and was also using `channelState()` with the default `process.env`.
- `packages/channel-config/src/index.ts` owns `resolveChannel()`, `channelState()`, and `channelEnv()`; those helpers remain generic, but managed callers must pass their selected source explicitly.

### Fix Shape

- Managed supervisor `desired()` resolves channel adapter env from `config.channel` only by calling `channelEnv(..., {})`.
- Managed supervisor `startInProcess()` no longer writes project channel credentials into global `process.env`.
- Managed supervisor adapter registration calls `registerAdapters(runtime, env, factories)` with the scoped config env.
- `registerAdapters()` no longer defaults to `process.env`; every caller must choose an env source explicitly. The standalone runtime remains the explicit `process.env` caller.
- `ChannelRegistry.list()` renders project channel status from config-only env so global Slack tokens do not make an empty project look configured.
- No stop-time env cleanup, overwrite-on-start patch, compatibility fallback, or hidden gate is added.

### Regression Tests

- `packages/opencorvus/test/channel/supervisor-env.test.ts` covers global Slack env ignored by managed sync, Slack A -> empty config becoming disabled with no env residue, and Slack A -> Slack B registering B.
- `packages/opencorvus/test/channel/registry.test.ts` covers global Slack env not marking an empty project channel as configured.
- `packages/channel-runtime/test/registry.test.ts` covers explicit empty env not consulting `process.env`.

### Verification

- Focused test command: `bun test packages/opencorvus/test/channel/supervisor-env.test.ts packages/opencorvus/test/channel/registry.test.ts packages/channel-runtime/test/registry.test.ts`
- Typecheck command: `bunx turbo run typecheck --filter=opencorvus --filter=@opencorvus-ai/channel-runtime`

### Independent Review Feedback

- Ramanujan confirmed that removing only the global env write would be insufficient because `desired()` and `ChannelRegistry.list()` also used default global env sources.
- Ramanujan specifically rejected stop-time cleanup, overwrite patches, and gates, and recommended config-only managed env plus explicit standalone env selection.

### Result

- Implemented on 2026-06-17.
- Managed channel supervisor now resolves channel adapter env from project config only, never writes project channel credentials into global `process.env`, and registers adapters from the scoped env object.
- `registerAdapters()` now requires an explicit env parameter; standalone runtime remains the explicit `process.env` caller.
- Channel registry UI status now evaluates project channel config without reading global channel env.
- Focused tests passed: `bun test packages/opencorvus/test/channel/supervisor-env.test.ts packages/opencorvus/test/channel/registry.test.ts packages/channel-runtime/test/registry.test.ts`.
- Package typecheck passed: `bunx turbo run typecheck --filter=opencorvus --filter=@opencorvus-ai/channel-runtime`.

## Batch P1-L: bus notification payload validation and session.error contract

### Findings

- The current working tree introduced stricter notification validation in `BusEvent.resolveNotify()`, but its first implementation had a generic return type that failed `opencorvus` typecheck.
- After the type issue was repaired, the focused bus test exposed a deeper contract bug: `SessionEvents.Error` reused `Message.Assistant.shape.error`, which is optional because regular assistant messages may not be errors. As a result, `BusEvent.resolveNotify(SessionEvents.Error.type, {})` returned the static tier-1 descriptor instead of rejecting an invalid `session.error` payload.
- A notification-layer special case would only hide the schema mismatch. The event definition itself must state that a `session.error` payload includes an actual error.

### Call-point Inventory

- `packages/opencorvus/src/bus/bus-event.ts` owns event definitions, notification descriptors, payload schema generation, and `resolveNotify()`.
- `packages/opencorvus/src/session/events.ts` owns `SessionEvents.Error`.
- `packages/opencorvus/src/session/message.ts` defines `Message.Assistant.shape.error` as optional for regular assistant messages.
- `packages/opencorvus/src/session/llm.ts` publishes `Bus.publish(SessionEvents.Error, { sessionID, error })` with a concrete `Message.fromError()` result.
- `packages/opencorvus/src/session/loop.ts` publishes predictive budget errors through `Session.Event.Error`; its helper accepted the optional assistant error type even though all call sites pass concrete errors.
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` subscribes to `SessionEvents.Error` and bridges already-validated properties.
- Raw executor/protocol events with `type: "session.error"` are separate stream payloads and are not the `BusEvent.define()` source.

### Fix Shape

- `BusEvent.resolveNotify()` parses the registered event payload before resolving descriptors, including static descriptors and omitted notification descriptors.
- `BusEvent.parseProperties()` returns a correctly inferred `z.output<Properties>` from the event's schema.
- `SessionEvents.Error` unwraps `Message.Assistant.shape.error` so the event requires `error` while regular assistant messages can still omit it.
- `stopTurnWithPredictiveBudgetError()` now accepts `NonNullable<Message.Assistant["error"]>`, matching the required event contract.
- No fallback payload, no notification-specific bypass, and no schema gate was added.

### Regression Tests

- `packages/opencorvus/test/bus/bus.test.ts` validates static descriptors, resolver descriptors, and omitted notification definitions all parse payloads.
- The same test asserts `SessionEvents.Error` accepts a real error payload and rejects `{}`.
- `Bus.publish()` is covered to ensure invalid event payloads do not reach subscribers.

### Verification

- Focused test command: `bun test packages/opencorvus/test/bus/bus.test.ts`
- Typecheck command: `bun run --cwd packages/opencorvus typecheck`

### Result

- Implemented on 2026-06-17.
- Focused bus tests passed: `bun test packages/opencorvus/test/bus/bus.test.ts`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Independent Review Feedback

- Helmholtz confirmed the runtime root cause was schema reuse: `Message.Assistant.shape.error` is optional for normal assistant messages, while `session.error` must require structured `error`.
- Helmholtz confirmed `sessionID` should remain optional because some global error publishers do not have a session, and raw executor `type: "session.error"` stream payloads are separate from this BusEvent schema.
- Helmholtz also warned not to mix unrelated current `bus.test.ts` churn into this batch; duplicate event registration coverage must remain intact.

## Batch P1-M: BH-108 shared channel session persistence must fail closed

### Findings

- BH-108 is a P1 shared-session consistency bug in `ChannelRuntime`: corrupt shared-session files were treated like missing files, and shared-session file write failures were logged as warnings after `sharedSessionId` had already been set.
- That let shared-mode runtimes create and use replacement sessions that were not safely persisted. Later restarts or parallel runtimes could then fork channel threads across different sessions.
- Missing file is the only valid "create a new shared session" state. Existing unreadable, invalid, or invalid-shaped shared-session files are corrupt state and must fail initialization visibly.

### Call-point Inventory

- `packages/channel-runtime/src/core.ts` owns `sharedMode()`, `sharedFile()`, `readSharedSessionFile()`, `writeSharedSessionFile()`, and `ensureSharedSession()`.
- `ChannelRuntime.start()` preloads an existing shared-session file before messages arrive.
- `ChannelRuntime.handleMessage()` calls `ensureSharedSession()` and already sends "Failed to initialize shared session." when it returns no ID.
- `packages/channel-runtime/src/main.ts` and `packages/opencorvus/src/channel/supervisor.ts` only pass `sharedMode/sharedFile` options and do not own persistence semantics.
- `packages/channel-runtime/test/core-session-isolation.test.ts` already covers per-thread session behavior and is the narrow test home for shared-session behavior.

### Fix Shape

- Replace `Bun.file(file).json().catch(() => undefined)` with explicit file reading: only `ENOENT` means absent, while read errors, invalid JSON, missing `session_id`, or empty `session_id` throw.
- In message handling, `ensureSharedSession()` catches shared-file read/preparation failures and returns undefined so the existing user-visible failure notice is sent and no message is prompted.
- Prepare the shared-session file directory before `session.create()` so obviously unwritable paths fail before creating a replacement session.
- Write the shared-session file before setting `this.sharedSessionId`; if the write fails after session creation, return undefined and do not bind or prompt with the unpersisted session.
- No fallback replacement session, no corrupt-file overwrite, and no warning-only write path is retained.

### Regression Tests

- Corrupt shared-session JSON rejects initialization, preserves the corrupt file, does not call `session.create()`, and does not call `promptAsync()`.
- Existing shared-session files with missing, non-string, or empty `session_id` reject initialization with the same no-create/no-prompt behavior.
- Unusable shared-session file directory fails before `session.create()`, preserves the blocker file, and does not call `promptAsync()`.
- Normal shared mode creates once, writes `session_id`, and a fresh runtime using the same file prompts into the persisted shared session without creating a second session.
- Corrupt shared-session files make `start()` reject before starting adapters and roll back `running`.
- Post-create write failure does not bind the thread, does not prompt, and does not set `sharedSessionId`.

### Verification

- Focused test command: `bun test packages/channel-runtime/test/core-session-isolation.test.ts`
- Typecheck command: `bun run --cwd packages/channel-runtime typecheck`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/channel-runtime/test/core-session-isolation.test.ts`.
- Package typecheck passed: `bun run --cwd packages/channel-runtime typecheck`.

### Independent Review Feedback

- Kant confirmed that only `ENOENT` may mean "shared session not initialized"; corrupt JSON, invalid shape, empty `session_id`, and non-`ENOENT` read errors must fail closed.
- Kant required write failure to remain non-binding and non-prompting, with no warning-only use of an unpersisted session.
- Kant also flagged `start()` preloading as a side-effect risk; shared-session validation now runs before server/event/adapter startup so corrupt files reject without half-started runtime state.

## Batch P1-N: BH-092 audio downloads must enforce STT size before buffering

### Findings

- BH-092 is a P1 channel-runtime memory and availability bug: Slack and Telegram adapters fetch full audio payloads into memory with `arrayBuffer()` before STT size validation runs in `STTPipeline.transcribe()`.
- Slack exposes audio file `size` metadata in the message event, but the adapter ignored it and downloaded `url_private` first.
- Telegram exposes `file_size` metadata on voice/audio messages and on `getFile()` results, but the adapter ignored it and downloaded the file URL first.
- A response without usable metadata can still exceed the STT limit while streaming. The runtime must stop reading as soon as the accumulated bytes cross the limit instead of buffering the whole body and rejecting later.

### Call-point Inventory

- `packages/channel-runtime/src/adapters/slack.ts` owns Slack `file_share` audio detection, bearer-authenticated `url_private` download, and `AudioAttachment` construction.
- `packages/channel-runtime/src/adapters/telegram.ts` owns voice/audio message handling, `bot.api.getFile()`, Telegram file URL construction, and `AudioAttachment` construction.
- `packages/channel-runtime/src/stt/pipeline.ts` owns final transcription-time audio size enforcement through `STTConfig.maxFileSizeBytes`.
- `packages/channel-runtime/src/stt/types.ts` documents the STT max size config contract.
- `packages/channel-runtime/src/core.ts` receives adapter `AudioAttachment` objects and sends them to STT; it should not own platform download limits.
- Existing tests cover STT pipeline behavior, but there are no Slack/Telegram audio predownload regression tests.

### Fix Shape

- Add a single STT default audio size constant and shared assertion helper under `packages/channel-runtime/src/stt/limits.ts`.
- Replace the old eager `AudioAttachment { data: Buffer }` contract with lazy `AudioSource { read(maxFileSizeBytes) }`. Adapters only describe the audio source; the STT pipeline owns bounded reading.
- Add `downloadAudioBuffer()` / `createHttpAudioSource()` in `packages/channel-runtime/src/adapters/audio-download.ts`. The downloader checks platform metadata size before fetch, checks HTTP `Content-Length` before reading the body, and streams chunks while enforcing the same max byte limit.
- Slack passes `url_private`, bearer headers, `mimetype`, `name`, `size`, and `duration_ms` into a lazy HTTP audio source without downloading during adapter dispatch.
- Telegram passes message `file_size` into a lazy source without calling `getFile()` during adapter dispatch. `getFile().file_size` is checked inside `read()` before the file URL body is fetched.
- `STTPipeline.transcribe()` now accepts `AudioSource`, checks metadata before opening it, calls `read(maxFileSizeBytes)`, rechecks the resulting `AudioBuffer`, and only then invokes the provider.
- STT provider fallback is removed as part of this boundary cleanup: `STT_PROVIDER` names exactly one provider, `STT_PROVIDERS` is rejected, and managed channel runtime passes the scoped runtime env into `createConfiguredSTT()` instead of reading global `process.env`.
- `ChannelRuntime.handleMessage()` treats STT failure as a visible voice-processing failure and returns before normal text prompt submission, so audio failures are not silently converted into text-only prompts.
- No fallback path keeps the old `arrayBuffer()`-first behavior for normal streamed responses, no provider fallback is retained, and no adapter-local size constant is introduced.

### Regression Tests

- Add `packages/channel-runtime/test/audio-download.test.ts` to assert metadata rejects before `fetch`, oversized `Content-Length` rejects before body consumption, and streamed oversized responses cancel before all chunks are buffered.
- Add `packages/channel-runtime/test/slack-adapter.test.ts` to assert Slack emits lazy audio metadata without calling `fetch`; oversized metadata rejects from the source before fetch.
- Add `packages/channel-runtime/test/telegram-adapter.test.ts` to assert Telegram emits lazy audio metadata without calling `getFile()` or `fetch`; oversized message metadata rejects before either call.
- Extend `packages/channel-runtime/test/stt-pipeline.test.ts` so oversized source metadata rejects before `read()` and before provider invocation.
- Add `packages/channel-runtime/test/core-stt.test.ts` so disabled STT never reads audio, and STT failure does not submit a text-only fallback prompt.

### Verification

- Focused test command: `bun test packages/channel-runtime/test/audio-download.test.ts packages/channel-runtime/test/slack-adapter.test.ts packages/channel-runtime/test/telegram-adapter.test.ts packages/channel-runtime/test/stt-pipeline.test.ts packages/channel-runtime/test/core-stt.test.ts`
- Typecheck command: `bun run --cwd packages/channel-runtime typecheck`

### Result

- Implemented on 2026-06-17.
- Focused tests passed: `bun test packages/channel-runtime/test/audio-download.test.ts packages/channel-runtime/test/slack-adapter.test.ts packages/channel-runtime/test/telegram-adapter.test.ts packages/channel-runtime/test/stt-pipeline.test.ts packages/channel-runtime/test/core-stt.test.ts`.
- Package typecheck passed: `bun run --cwd packages/channel-runtime typecheck`.
- Managed runtime env isolation regression passed with explicit runner timeout for this Windows workspace: `bun test packages/opencorvus/test/channel/supervisor-env.test.ts --timeout 20000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Independent Review Feedback

- McClintock rejected an adapter-only bounded-buffer fix because it would still keep the eager `AudioAttachment.data` contract and would not prevent downloads when STT is disabled.
- McClintock required the STT pipeline to become the single audio acquisition boundary: metadata size check, response `Content-Length` check, stream chunk accounting, and provider invocation must all happen behind one bounded source reader.
- McClintock also flagged the existing dirty STT provider fallback work as a separate risk. The final patch makes that behavior explicit: one configured provider, no `STT_PROVIDERS` fallback chain, and no managed-runtime global env read.

## Batch P1-O: BH-093 QQ Ed25519 webhook key derivation

### Findings

- BH-093 is a P1 QQ webhook authentication bug: `QQAdapter` calls `generateKeyPairSync("ed25519", { seed })`, but Node/Bun do not use that `seed` option for Ed25519 key generation. Each adapter instance receives a fresh random keypair.
- Existing tests hide the defect by reading the adapter's private key and signing inbound requests with that private key, so the tests prove self-consistency rather than the QQ platform contract.
- QQ's documented webhook contract derives an Ed25519 key from the app secret repeated/truncated to 32 bytes. The signature input is `timestamp + rawBody` for inbound events and `event_ts + plain_token` for validation responses.

### Call-point Inventory

- `packages/channel-runtime/src/adapters/qq.ts` owns QQ webhook signature verification, validation response signing, access token fetch, and outbound replies.
- `packages/channel-runtime/test/mainstream-adapters.test.ts` owns QQ validation, inbound C2C, channel at-message, and outbound reply coverage. The current `qqSigned(adapter, ...)` helper reads `adapter.privateKey`.
- `packages/channel-config/src/index.ts` defines the QQ app ID/app secret env contract and registry-required fields.
- `packages/channel-runtime/src/registry.ts` passes `QQ_BOT_APP_ID`, `QQ_BOT_APP_SECRET`, sandbox, host, port, and path into `QQAdapter`.
- `packages/web/src/content/docs/channels/qq.mdx` and `packages/web/src/content/docs/zh-cn/channels/qq.mdx` document the QQ setup surface but do not participate in signing.

### Fix Shape

- Replace random Ed25519 key generation with deterministic PKCS#8 Ed25519 private-key import from the 32-byte repeated app-secret seed, then derive the public key with `createPublicKey()`.
- Keep a single key derivation implementation in `QQAdapter`; do not add signature fallback modes, dual-key verification, app-secret HMAC gates, or adapter-private-key testing shortcuts.
- Keep the existing signature input `timestamp + rawBody` and validation response input `event_ts + plain_token`.
- Update tests so platform-style fixtures derive their own key from the app secret and never read adapter private fields.

### Regression Tests

- Update QQ signing helper to accept `appSecret` and sign with an independently derived Ed25519 private key.
- Assert a known app secret derives the documented raw public key bytes, so the fixture itself is pinned to the platform algorithm.
- Assert validation challenge response signature exactly for a fixed app secret, plain token, and event timestamp.
- Existing QQ validation and inbound tests should pass with independently signed requests and fail on wrong signatures.
- Add a deterministic same-secret assertion: two adapters with the same app secret return the same validation signature for the same challenge.

### Verification

- Focused test command: `bun test packages/channel-runtime/test/mainstream-adapters.test.ts -t "qq"`
- Typecheck command: `bun run --cwd packages/channel-runtime typecheck`

### Result

- Implemented on 2026-06-17.
- Focused QQ tests passed: `bun test packages/channel-runtime/test/mainstream-adapters.test.ts -t "qq"`.
- Package typecheck passed: `bun run --cwd packages/channel-runtime typecheck`.

### Independent Review Feedback

- Hubble confirmed the vulnerable boundary is deterministic Ed25519 key derivation, not route parsing or registry wiring.
- Hubble confirmed tests must stop reading adapter private fields and should use an independent app-secret fixture.
- Hubble recommended exact fixed-fixture coverage. The final tests pin the documented raw public key value and pin a deterministic validation-response signature for fixed `plain_token` / `event_ts`.

## Batch P1-P: BH-109 experimental workspace delete project ownership

### Findings

- BH-109 is a P1 cross-project deletion bug: `DELETE /experimental/workspace/:id` was bound to the active project by `Server.App()` directory middleware, but the handler called `Workspace.remove(id)` with only the global workspace ID.
- `Workspace.remove(id)` looked up `WorkspaceTable` by `id` only, then called `Worktree.remove({ directory: info.config.directory })`.
- `Worktree.remove()` may physically remove an existing directory even when the directory is not a registered current-project git worktree. A project A request that knows project B's workspace ID can therefore delete B's workspace row and invoke physical deletion for B's directory.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/experimental.ts` owns `POST /experimental/workspace/:id`, `GET /experimental/workspace`, and `DELETE /experimental/workspace/:id`.
- `packages/opencorvus/src/workspace/workspace.ts` owns `Workspace.create`, `list`, `get`, and `remove`.
- `packages/opencorvus/src/workspace/workspace.sql.ts` stores `project_id`, which is the ownership column that delete must use.
- `packages/opencorvus/src/worktree/index.ts` owns physical directory removal; this batch must prevent foreign workspace rows from reaching it.
- `rg -n -F 'Workspace.remove(' packages/opencorvus/src packages/opencorvus/test` shows the experimental route as the only call site after this batch.

### Fix Shape

- Make `Workspace.remove()` the single canonical delete API with input `{ id, projectID }`; remove the global ID-only delete entrypoint.
- Query workspace rows by both `id` and `project_id`; if no row matches, throw `NotFoundError` before calling `Worktree.remove()`.
- Delete the row by the same `(id, project_id)` predicate after physical removal.
- Update the experimental route to pass `Instance.project.id` and change the 200 schema from optional workspace to required workspace. Missing or foreign workspace IDs now surface as 404.
- Do not modify `Worktree.remove()` in this batch and do not add route-only prechecks, fallback global deletion, or compatibility branches.

### Regression Tests

- Add `packages/opencorvus/test/server/experimental-workspace-routes.test.ts`.
- Seed project A and project B workspace rows with sentinel directories. Delete B's workspace while scoped to project A and assert 404, B row remains, and B sentinel remains.
- Delete a nonexistent workspace while scoped to project A and assert 404.
- Delete A's workspace while scoped to project A and assert 200, A row removed, A directory removed, and B row/sentinel still intact.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/experimental-workspace-routes.test.ts`
- Typecheck command: `bun run --cwd packages/opencorvus typecheck`

### Result

- Implemented on 2026-06-17.
- Focused workspace route test passed: `bun test packages/opencorvus/test/server/experimental-workspace-routes.test.ts`.
- Package typecheck passed after rerun against the current worktree: `bun run --cwd packages/opencorvus typecheck`.

### Independent Review Feedback

- Herschel confirmed the root cause is the global workspace ID delete crossing the active-project route boundary and reaching `Worktree.remove()` before ownership validation.
- Herschel required the workspace service API to be project-scoped, not just the route, and flagged the old global `Workspace.remove(id)` as a second unsafe delete source.
- Herschel also recommended the 200 response schema be non-optional and missing workspace IDs return 404; both are reflected in the final route contract.

## Batch P1-Q: BH-101 destructive DB operations must fail closed after dispose failure

### Findings

- BH-101 is a P1 destructive database safety bug: `/global/db/mysql/import` and `opencorvus db reset --force` swallowed `Instance.disposeAll()` failures before mutating SQLite state or deleting database/runtime files.
- `/global/db/reset` already awaits `Instance.disposeAll()` directly, so the HTTP reset path is not part of the remaining defect.
- A failed dispose means in-memory runtime state may still own SQLite handles, worktree state, or executor/session resources. Continuing with import/reset under that condition can corrupt DB/filesystem state and hide the real runtime failure.
- Independent review found the deeper root: `State.disposeEntry()` logged disposer failures and swallowed them, so real state disposer failures could make `Instance.disposeAll()` appear successful even after the route/CLI callers stopped swallowing the returned promise.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/global.ts` owns `/global/db/reset`, `/global/db/mysql/schema`, `/global/db/mysql/export`, and `/global/db/mysql/import`.
- `packages/opencorvus/src/cli/cmd/db.ts` owns `opencorvus db reset --force`; the CLI top-level already turns thrown handler errors into `process.exitCode = 1`.
- `packages/opencorvus/src/storage/db.ts` owns `Database.reset(projectDir)` and `Database.rebuildSqlite(...)` used by MySQL import.
- `packages/opencorvus/src/storage/mysql-transfer.ts` owns `importMysqlTransferSnapshot(...)`, which rebuilds SQLite from the provided transfer snapshot.
- `packages/opencorvus/src/project/state.ts` owns project-scoped state disposal for `Instance.dispose()` and `Instance.disposeAll()`.
- `rg -n "Instance\\.disposeAll|Database\\.reset|importMysqlTransferSnapshot|db/mysql/import" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` shows the remaining swallowed destructive dispose paths are the MySQL import route and CLI reset command.

### Fix Shape

- Replace the MySQL import route's swallowed `await Instance.disposeAll().catch(() => undefined)` with direct `await Instance.disposeAll()` before reading the validated snapshot or calling `importMysqlTransferSnapshot(...)`.
- Replace the CLI reset command's swallowed `await Instance.disposeAll().catch(() => undefined)` with direct `await Instance.disposeAll()` before calling `Database.reset(projectDir)`.
- Make `State.disposeEntry()` rethrow disposer failures after logging them, and only remove state entries after successful disposal. Failed entries remain registered so a later dispose retry can clean them up instead of pretending the runtime state was released.
- Export the CLI reset command object for focused handler-level regression tests, matching existing exported CLI subcommand test patterns.
- Do not add fallback reset/import behavior, route-local retry gates, alternate cleanup paths, or compatibility branches. The destructive operation must stop at the dispose failure.

### Regression Tests

- Add a server route test that exports a valid MySQL snapshot, changes the DB to a different sentinel state, makes `Instance.disposeAll()` reject, posts the snapshot to `/global/db/mysql/import`, and asserts non-2xx plus unchanged DB state.
- Add a CLI reset test that creates DB/WAL/SHM and project runtime sentinel files, makes `Instance.disposeAll()` reject, invokes `ResetCommand.handler({ force: true })`, and asserts it rejects, `Database.reset()` is not called, and all sentinel files remain.
- Extend `packages/opencorvus/test/project/state-reset-dispose.test.ts` so `reset()` and `State.dispose(key)` reject on disposer failure and retain the failed entry for retry.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/global-db-destructive.test.ts packages/opencorvus/test/cli/db-reset.test.ts packages/opencorvus/test/project/state-reset-dispose.test.ts`
- Typecheck command: `bun run --cwd packages/opencorvus typecheck`

### Result

- Implemented on 2026-06-17.
- Focused destructive DB/state disposal tests passed: `bun test packages/opencorvus/test/server/global-db-destructive.test.ts packages/opencorvus/test/cli/db-reset.test.ts packages/opencorvus/test/project/state-reset-dispose.test.ts`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Independent Review Feedback

- Newton confirmed the immediate destructive-path fix should be direct `await Instance.disposeAll()` with existing HTTP 500 / CLI nonzero propagation, not a local fallback or compatibility path.
- Newton identified `State.disposeEntry()` as the deeper source of false-success disposal. The final patch now rethrows disposer failures and keeps failed entries registered for retry.
- Newton warned not to mix the unrelated `global.ts` SSE envelope changes or other dirty workspace files into this batch; commit staging must remain limited to BH-101 files/hunks.

## Batch P1-R: BH-082 acceptance command timeouts must be inactivity-based

### Findings

- BH-082 is a P1 unattended verification bug: acceptance project checks and runtime dependency install checks start one fixed wall-clock timer when the child process starts.
- Commands that continuously emit useful stdout/stderr progress can be killed at the fixed deadline even though they are active, violating the project rule that test timeouts must be real inactivity timeouts.
- The same timeout implementation is duplicated in `project-gate.ts` and `runtime-readiness.ts`, so fixing only one path would leave a second source of false failures.

### Call-point Inventory

- `packages/opencorvus/src/acceptance/checks/project-gate.ts` owns `runShellCommand(...)` for acceptance check commands and injects `OPENCORVUS_TASK_ID` / `OPENCORVUS_PROJECT_DIR`.
- `packages/opencorvus/src/acceptance/checks/runtime-readiness.ts` owns `runInstallCommand(...)` for frozen dependency installs.
- `rg -n "setTimeout|proc.kill|stdout|stderr|COMMAND_TIMEOUT_MS|INSTALL_TIMEOUT_MS" packages/opencorvus/src/acceptance packages/opencorvus/test/acceptance -g "*.ts"` shows the two duplicated fixed-timer child-process runners.

### Fix Shape

- Add one acceptance-local process helper that runs a child process with stdout/stderr collection and an inactivity timeout.
- Start the inactivity timer when the process starts, reset it on every stdout or stderr data event, and clear it on process exit/error.
- Keep the existing `exitCode === undefined` timeout contract and captured output contract so callers can report failures consistently.
- Replace both duplicated wall-clock timer implementations with the shared helper. Do not add a longer timeout, retry, command allowlist, or fallback path.

### Regression Tests

- Add a focused helper test where a command emits progress beyond the nominal timeout and exits 0; it must not be killed.
- Add a silent command fixture that exceeds the timeout without output; it must return `exitCode: undefined` and include an inactivity timeout diagnostic.

### Verification

- Focused test command: `bun test packages/opencorvus/test/acceptance/inactivity-timeout-process.test.ts`
- Existing acceptance gate compatibility command: `bun test packages/opencorvus/test/acceptance/project-gate.test.ts`
- Typecheck command: `bun run --cwd packages/opencorvus typecheck`

### Result

- Implemented on 2026-06-17.
- Focused inactivity timeout tests passed: `bun test packages/opencorvus/test/acceptance/inactivity-timeout-process.test.ts`.
- Existing acceptance project gate tests passed: `bun test packages/opencorvus/test/acceptance/project-gate.test.ts`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Independent Review Feedback

- Lovelace confirmed both original child-process runners used fixed wall-clock timers and did not refresh on stdout/stderr activity.
- Lovelace confirmed the correct boundary is a shared acceptance-local helper used by both project checks and runtime install checks, without changing timeout constants or adding retries/fallbacks.
- Lovelace flagged the first draft of the regression test as insufficient because the active command exited before the inactivity window. The final test now runs longer than the timeout window while emitting output more frequently than the window.

## Batch P1-S: BH-085 right-sidebar coding task selection must be directory-bound

### Findings

- BH-085 is a P1 project-directory isolation bug in `PATCH /coding/session/:sessionID/selection`.
- The route already validates that the right-sidebar coding assistant session belongs to the active project and `Instance.directory`, but selected task validation only checks `task.projectID`.
- Tasks in the same project can still resolve to a different working directory through their root `SessionTable.directory`; persisting that task ID into the right-sidebar session metadata binds the sidebar to the wrong directory.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/coding.ts` owns right-sidebar coding assistant session create/list/get/update/delete/abort/selection routes.
- `packages/opencorvus/src/coding-assistant/session.ts` owns `setRightSidebarCodingAssistantSelectedTask(...)` and session metadata shape.
- `packages/opencorvus/src/task-api/index.ts` owns `EngineService.getTask(...)`, which returns `viewTask(...)` with a resolved `directory`.
- `packages/opencorvus/src/engine/queue.ts` owns `taskCwd(taskID)`: task root session directory wins, falling back to project worktree.
- `packages/opencorvus/test/server/coding-routes.test.ts` already covers selected task persistence and cross-project rejection.

### Fix Shape

- In the selection route, require the selected task to match both the active project and the active `Instance.directory`.
- Use the task directory returned by `EngineService.getTask(taskID)` so the route shares the existing task directory source of truth.
- Reject mismatched-directory tasks with the same 404 response used for foreign-project tasks, and do not call metadata merge.
- Do not add alternate task lookup paths, route-local fallback to project worktree, or compatibility behavior for cross-directory selection.

### Regression Tests

- Extend `packages/opencorvus/test/server/coding-routes.test.ts`.
- Create a right-sidebar session in directory A, a task in the same project whose root session directory is directory B, then attempt selection from directory A.
- Assert 404 and assert the coding assistant session metadata remains unchanged.

### Verification

- Focused test command: `bun test packages/opencorvus/test/server/coding-routes.test.ts -t "persists selected task metadata" --timeout 20000`
- Typecheck command: `bun run --cwd packages/opencorvus typecheck`

### Result

- Implemented on 2026-06-17.
- Focused right-sidebar selection regression passed: `bun test packages/opencorvus/test/server/coding-routes.test.ts -t "persists selected task metadata" --timeout 20000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Independent Review Feedback

- Kierkegaard confirmed the bug is specific to the selection route: the route already validates the coding session by current project and directory, but the selected task check only used project ownership.
- Kierkegaard confirmed task directory is projected from `EngineTaskTable.session_id -> SessionTable.directory`, falling back to `ProjectTable.worktree`; the route must use the projected task directory instead of inventing another source.
- Kierkegaard recommended expressing the invariant as selected task `projectID/directory` matching the validated session `projectID/directory`; the final route uses the session fields directly.

## Batch P1-T: BH-061 plugin service path rewrite must use route segments

### Findings

- BH-061 is a P1 plugin service proxy bug in `packages/opencorvus/src/server/routes/plugin.ts`.
- `pluginRequest(...)` searched the full URL pathname with `indexOf("/" + serviceID)`.
- For service IDs that overlap the route prefix, such as `plug`, the first match in `/plugin/plug/ping` is the `plug` inside `/plugin`; the forwarded plugin request is rewritten to the wrong suffix instead of `/ping`.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/app.ts` mounts `PluginRoutes()` at `/plugin`.
- `packages/opencorvus/src/server/routes/plugin.ts` owns all plugin service proxy dispatch under `/:id/*`.
- `packages/opencorvus/src/plugin/index.ts` owns plugin service registration and duplicate/diagnostic errors; no service registration shape change is required.
- `packages/opencorvus/test/server/plugin-service-routes.test.ts` already covers normal path rewrite, missing directory enforcement, unknown service errors, manifest services, duplicate service IDs, and registration failure errors.
- `rg -n "PluginRoutes|/plugin|serviceID|pluginRequest|pathname" packages/opencorvus/src packages/opencorvus/test` showed no other plugin proxy rewrite implementation.

### Fix Shape

- Rewrite forwarded plugin request paths by checking the exact route segments `/plugin/{serviceID}`.
- Decode only the service ID segment for equality with Hono's route parameter, then preserve the remaining path segments as the forwarded suffix.
- Keep query string, method, headers, and body by constructing the new `Request` from the original request after changing only `url.pathname`.
- Reject a route-prefix mismatch as an internal invariant failure; do not fall back to scanning the whole URL or forwarding `/`.

### Regression Tests

- Extend `packages/opencorvus/test/server/plugin-service-routes.test.ts`.
- Register service ID `plug` and request `/plugin/plug/ping`.
- Assert the plugin service receives pathname `/ping`.

### Verification

- Focused regression command: `bun test packages/opencorvus/test/server/plugin-service-routes.test.ts -t "rewrites plugin service IDs" --timeout 30000`
- Full plugin route command: `bun test packages/opencorvus/test/server/plugin-service-routes.test.ts --timeout 60000`
- Typecheck command: `bun run --cwd packages/opencorvus typecheck`

### Result

- Implemented on 2026-06-17.
- The first wildcard-based draft failed the focused regression by forwarding `/`; the implementation was corrected to exact segment parsing before completion.
- Focused regression passed: `bun test packages/opencorvus/test/server/plugin-service-routes.test.ts -t "rewrites plugin service IDs" --timeout 30000`.
- Full plugin service route tests passed: `bun test packages/opencorvus/test/server/plugin-service-routes.test.ts --timeout 60000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Independent Review Feedback

- James confirmed the segment-based rewrite closes BH-061 and removes the previous fallback behavior that forwarded `/` when no marker was found.
- James confirmed the mismatch check is a fail-fast route invariant, not a compatibility path or gate.
- James noted the first overlap regression only asserted pathname; the final test now also asserts method, query, header, and JSON body preservation for the overlapping service ID.
- James noted URL-encoded service IDs are not explicitly covered. Current plugin service IDs are route path parameters and existing registration tests use plain IDs; encoded-ID policy should be handled as a separate contract decision rather than silently expanding this batch.

## Batch P1-U: BH-067 permission deny wins before prompting

### Findings

- BH-067 is a P1 permission ordering bug in `packages/opencorvus/src/permission/next.ts`.
- `PermissionNext.ask(...)` evaluated request patterns in order and returned a pending prompt as soon as one pattern resolved to `ask`.
- For a single tool request with multiple patterns, a harmless first pattern could create a pending permission prompt before a later pattern resolved to `deny`.
- The red regression reproduced this behavior with `patterns: ["echo hello", "rm -rf /"]`, rules `* => ask` and `rm * => deny`; the buggy implementation timed out the pending prompt with `RejectedError` instead of throwing `DeniedError`.

### Call-point Inventory

- `packages/opencorvus/src/permission/next.ts` owns `PermissionNext.ask(...)`, pending prompt creation, `PermissionNext.list(...)`, and `PermissionNext.reply(...)`.
- `packages/opencorvus/src/tool/bash.ts` sends multi-pattern bash permission requests from parsed shell commands and external-directory globs.
- `packages/opencorvus/src/tool/apply_patch.ts` sends multi-file edit permission requests through the same `ctx.ask(...)` path.
- Other tool `ctx.ask(...)` callers found by `rg -n "ctx\\.ask\\(" packages/opencorvus/src/tool` use single-pattern requests or wildcard-only tool permissions; they benefit from the central evaluator change without local edits.
- Permission UI/API consumers (`engine/interaction.ts`, `protocol/session-mirror.ts`, `server/routes/permission.ts`, `acp/agent.ts`, `cli/cmd/run.ts`) consume pending events/lists and do not perform pattern evaluation.

### Fix Shape

- Keep `evaluate(...)` unchanged: it remains the single source for one `permission + pattern` decision with last-match-wins rules.
- Change `PermissionNext.ask(...)` to evaluate every pattern in the request before creating a pending prompt.
- If any evaluated pattern resolves to `deny`, throw `DeniedError` immediately and leave `pending` empty.
- If no pattern denies but at least one pattern resolves to `ask`, create exactly one pending prompt for the original request.
- Do not add tool-specific preflight rules, gates, fallback behavior, or duplicate evaluators in `bash` / `apply_patch`.

### Regression Tests

- Extend `packages/opencorvus/test/permission/next.test.ts`.
- Add `ask - denies later denied patterns before prompting earlier ask`.
- The test asserts the multi-pattern request throws `PermissionNext.DeniedError` and `PermissionNext.list()` remains empty.
- Add `ask - denies later edit file patterns before prompting earlier ask`.
- The edit-shaped test covers multi-file permission requests such as `apply_patch`, where an earlier file can resolve to `ask` while a later file resolves to `deny`.

### Verification

- Red test before fix: `bun test packages/opencorvus/test/permission/next.test.ts -t "ask - denies later denied patterns before prompting earlier ask" --timeout 10000` failed with timeout-driven `RejectedError`, proving the prompt was created before the denied pattern was checked.
- Focused regression after fix passed: `bun test packages/opencorvus/test/permission/next.test.ts -t "ask - denies later denied patterns before prompting earlier ask" --timeout 10000`.
- Full permission test file passed: `bun test packages/opencorvus/test/permission/next.test.ts --timeout 30000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Result

- Implemented on 2026-06-18.
- `PermissionNext.ask(...)` now completes all pattern evaluation before creating a prompt.
- Denied patterns in a multi-pattern request win over any earlier ask pattern and no stale pending permission prompt is emitted.

### Independent Review Feedback

- Hypatia independently confirmed the root cause is the early `return new Promise` inside the `request.patterns` loop, not `evaluate(...)`.
- Hypatia identified `bash` multi-command requests and `apply_patch` multi-file edit requests as the highest-risk call shapes.
- Hypatia recommended a central `PermissionNext.ask(...)` fix with no tool-layer branches, matching the implemented fix shape.
- Hypatia also recommended the edit-shaped regression; the final test suite includes it.

## Batch P1-V: BH-066 apply_patch Add File must not overwrite existing files

### Findings

- BH-066 is a P1 file-destruction bug in `packages/opencorvus/src/tool/apply_patch.ts`.
- The tool `add` hunk branch treated every `*** Add File` as creation from empty content, built permission metadata with `before: ""`, then wrote with `fs.writeFile(...)`.
- If the target path already existed, the tool silently overwrote it after showing the permission UI an add-from-empty diff instead of the true replacement.
- The lower-level `Patch.applyPatch(...)` and `Patch.maybeParseApplyPatchVerified(...)` had the same Add File existence gap, so leaving them unchanged would preserve a second Add File overwrite semantic.

### Call-point Inventory

- `packages/opencorvus/src/tool/apply_patch.ts` owns the user-facing `apply_patch` tool execution, permission metadata, file writes, file watcher events, and LSP touches.
- `packages/opencorvus/src/patch/index.ts` owns `parsePatch(...)`, `applyHunksToFiles(...)`, `applyPatch(...)`, `maybeParseApplyPatch(...)`, and `maybeParseApplyPatchVerified(...)`.
- `rg -n "Patch\\.applyPatch\\(|applyHunksToFiles\\(|maybeParseApplyPatchVerified\\(|maybeParseApplyPatch\\(" packages/opencorvus/src packages/opencorvus/test` showed direct `Patch.applyPatch(...)` usage only in patch tests; tool execution uses `Patch.parsePatch(...)` and then applies its own permission-aware write path.
- `packages/opencorvus/test/tool/apply_patch.test.ts` already contained a test named `adds file overwriting existing file`; that test encoded the buggy behavior and was replaced with the correct rejection contract.
- `packages/opencorvus/test/patch/patch.test.ts` covers the lower-level patch helper and now also covers Add File existing-target rejection.

### Fix Shape

- Add one shared `Patch.assertAddFileTargetDoesNotExist(filePath)` helper.
- Use `lstat` so any existing filesystem entry, including directories and symlinks, rejects Add File before permission metadata is built.
- Call it from the tool `add` branch before building add-from-empty metadata or asking permission.
- Call it from lower-level `Patch.applyHunksToFiles(...)` before any hunk writes so a later existing Add File target cannot leave earlier add/update side effects.
- Write Add File content with `flag: "wx"` in both write paths so a race between validation and creation cannot overwrite an existing target.
- Call it from `Patch.maybeParseApplyPatchVerified(...)` and preserve that function's existing `CorrectnessError` return contract.
- Do not reinterpret `Add File` as update, do not show replacement metadata as a create diff, and do not add a compatibility path for overwriting existing files.

### Regression Tests

- Update `packages/opencorvus/test/tool/apply_patch.test.ts`.
- Replace `adds file overwriting existing file` with `rejects add file when target already exists before asking permission`.
- Assert the tool rejects with `apply_patch verification failed: Add File target already exists`, does not call `ctx.ask(...)`, and preserves original file content.
- Add a mixed-patch test where an earlier Add File and Update File are valid but a later Add File target already exists; assert no permission prompt, no new file, no update write, and original duplicate content preserved.
- Extend `packages/opencorvus/test/patch/patch.test.ts`.
- Assert `Patch.applyPatch(...)` rejects an Add File existing target and preserves content.
- Assert `Patch.applyPatch(...)` rejects a mixed patch before writing earlier valid changes.
- Assert `Patch.maybeParseApplyPatchVerified(...)` returns `MaybeApplyPatchVerified.CorrectnessError` for the same existing-target shape.

### Verification

- Red tool regression before fix: `bun test packages/opencorvus/test/tool/apply_patch.test.ts -t "rejects add file when target already exists" --timeout 20000` failed because the promise resolved and overwrote the file.
- Red patch regression before fix: `bun test packages/opencorvus/test/patch/patch.test.ts -t "should reject add when target file already exists" --timeout 20000` failed because `Patch.applyPatch(...)` resolved and overwrote the file.
- Focused regressions after fix passed:
  - `bun test packages/opencorvus/test/tool/apply_patch.test.ts -t "rejects add file when target already exists" --timeout 20000`
  - `bun test packages/opencorvus/test/patch/patch.test.ts -t "should reject add when target file already exists" --timeout 20000`
- Mixed-patch no-side-effect regressions passed:
  - `bun test packages/opencorvus/test/tool/apply_patch.test.ts -t "existing add" --timeout 30000`
  - `bun test packages/opencorvus/test/patch/patch.test.ts -t "existing add" --timeout 30000`
- Full patch suites passed:
  - `bun test packages/opencorvus/test/tool/apply_patch.test.ts --timeout 60000`
  - `bun test packages/opencorvus/test/patch/patch.test.ts --timeout 60000`
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Result

- Implemented on 2026-06-18.
- `*** Add File` now only creates missing files.
- Existing targets fail before permission prompts, metadata creation, filesystem writes, watcher events, or LSP touches.

### Independent Review Feedback

- Carver independently confirmed BH-066 was still present before this batch and that the parser was not the root cause.
- Carver identified the user-facing tool and lower-level `Patch.applyHunksToFiles(...)` as same-semantic write paths that must not diverge.
- Carver recommended rejecting existing targets before `ctx.ask(...)`, preserving original content, replacing the old overwrite test, adding a mixed-patch no-side-effect regression, and using exclusive create writes to avoid validation/write races.

## Batch P1-W: BH-064 URL skill discovery must reject traversal paths

### Findings

- BH-064 is a P1 filesystem write bug in `packages/opencorvus/src/skill/discovery.ts`.
- `Discovery.pull(...)` trusted remote `index.json` values and used `skill.name` directly in `path.join(cache, skill.name)`.
- It also used each remote `file` directly in `path.join(root, file)` and in `new URL(file, ...)`.
- A malicious registry could use `../` or URL-like path strings to write outside `Discovery.dir()` or request unintended file URLs.

### Call-point Inventory

- `packages/opencorvus/src/skill/discovery.ts` owns URL registry index fetch, download path construction, cache writes, and returned skill directories.
- `packages/opencorvus/src/skill/skill.ts` calls `Discovery.pull(...)` for configured `skills.urls` during skill discovery.
- `packages/opencorvus/src/skill/manager.ts` calls `Discovery.pull(...)` for `SkillManager.install({ kind: "url" })` and then persists URL source metadata for returned roots.
- `packages/opencorvus/src/util/filesystem.ts` already provides `Filesystem.contains(...)`; the fix reuses it instead of creating a parallel containment rule.
- `packages/opencorvus/test/skill/discovery.test.ts` already covers normal URL discovery, trailing-slash handling, invalid indexes, reference files, and cache reuse.

### Fix Shape

- Build and validate the full download plan before any `mkdir(...)` or file download.
- Validate remote `skill.name` as a single safe relative path segment.
- Validate each remote file as a POSIX relative path segment sequence.
- Reject empty values, trimmed-different values, `.` / `..` / empty segments, backslashes, absolute paths, Windows drive paths, URL-like `:`, query `?`, and fragment `#`.
- Resolve local targets from validated path segments and assert skill roots remain under `Discovery.dir()` and file targets remain under their skill root.
- Build download URLs from the validated encoded path segments, not from raw remote strings.
- Fail closed on unsafe entries; do not slug, sanitize, skip bad entries, fall back to empty result, add host allowlists, or move validation to UI/config gates.

### Regression Tests

- Extend `packages/opencorvus/test/skill/discovery.test.ts`.
- Add a fixture registry with `name: "../escaped-skill"` and another entry with `files: ["SKILL.md", "../escape.txt"]`; assert `Discovery.pull(...)` rejects and nothing is written outside or inside partial safe roots.
- Add a safe-name malicious-file fixture with `files: ["SKILL.md", "../file-escape.txt"]`; assert rejection and no partial `SKILL.md`.
- Add URL-like file path fixture `https://attacker.invalid/SKILL.md`; assert only `index.json` is requested and no partial skill file is written.
- Add Windows backslash traversal fixture `..\\escape.txt`; assert only `index.json` is requested and no partial skill file is written.

### Verification

- Red traversal regression before fix: `bun test packages/opencorvus/test/skill/discovery.test.ts -t "rejects traversal entries" --timeout 20000` failed because `Discovery.pull(...)` resolved instead of rejecting.
- Focused regressions after fix passed:
  - `bun test packages/opencorvus/test/skill/discovery.test.ts -t "rejects" --timeout 30000`
- Full discovery suite passed: `bun test packages/opencorvus/test/skill/discovery.test.ts --timeout 60000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Result

- Implemented on 2026-06-18.
- URL skill discovery now validates the whole remote file plan before any file write.
- Remote path traversal, Windows-style traversal, absolute paths, and URL-like file paths fail before download or cache writes.

### Independent Review Feedback

- Russell independently confirmed BH-064 was still present and that the parser was not the root cause.
- Russell identified the two production entry points as configured `skills.urls` in `Skill.all()` and URL install in `SkillManager.install(...)`.
- Russell recommended validating the whole index before downloading, reusing `Filesystem.contains(...)`, rejecting unsafe entries visibly, and avoiding sanitizing/slugging/skip-bad-entry compatibility behavior.

## Batch P1-X: BH-065 managed git skill slugs must not resolve outside their own child directory

### Findings

- BH-065 is a P1 managed skill deletion bug in `packages/opencorvus/src/skill/manager.ts`.
- `SkillManager.install({ kind: "git" })` normalized the source, derived `path.join(managedRoot(), slug(source))`, and then called `ensureManagedRepo(...)`.
- `slug(...)` allowed `.` and could produce an empty string for inputs such as `---`, `.git`, `git://`, and `https://.git`.
- Those values made install target the managed root itself or its parent before `git clone` failed.
- `SkillManager.remove({ kind: "git" })` used the same slug path and `Filesystem.contains(managedRoot(), source)`. Because `Filesystem.contains(parent, parent)` is true, a root-resolving slug let remove delete the whole managed root.
- The same remove branch also swallowed `rm(...)` errors even though `force: true` already handles missing paths; that hid real filesystem failures.

### Call-point Inventory

- `packages/opencorvus/src/skill/manager.ts` owns `SkillManager.install(...)`, `SkillManager.remove(...)`, `managedRoot()`, `slug(...)`, and `ensureManagedRepo(...)`.
- `packages/opencorvus/src/server/routes/skill.ts` exposes the install/remove API routes and delegates directly to `SkillManager`.
- `packages/overlay/src/services/extensions.ts` sends install/remove requests without adding a separate path boundary.
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx` maps `managed_git` entries back to `kind: "git"` for removal.
- `packages/opencorvus/src/util/filesystem.ts` owns the existing containment semantics; the fix reuses that helper instead of introducing a parallel path rule.
- Existing tests covered path install/remove and discovery flows but did not cover malformed git source slugs or sentinel preservation.

### Fix Shape

- Add a single `managedGitTarget(source)` constructor inside `SkillManager`.
- Use it for both git install and git remove after `normalizeGit(...)`.
- Reject empty slugs, `.`, `..`, non-single-segment names, absolute paths, Windows absolute paths, root equality, and paths outside `managedRoot()`.
- Perform rejection before `ensureManagedRepo(...)`, `patchGlobal(...)`, `.keep` writes, `git clone/pull`, or `rm(...)`.
- Remove the `rm(...).catch(() => undefined)` in the git remove path so real filesystem errors remain visible.
- Remove swallowed `.keep` write/delete errors in `ensureManagedRepo(...)`; setup failures should stop before git operations rather than being hidden.
- Do not hash, sanitize, rename, skip, allowlist, or fall back for malformed git sources.

### Regression Tests

- Add `packages/opencorvus/test/skill/manager.test.ts`.
- For install, cover `.`, `..`, `---`, `.git`, `git://`, and `https://.git`.
- For remove, cover the same malformed sources.
- Each test sets `OPENCORVUS_HOME` to a temp portable home, creates sentinels in both `config/skills-market` and its parent config directory, and asserts both sentinels remain.
- Install tests place a fake git binary earlier on `PATH` that writes a marker if invoked; every malformed source asserts the marker is absent, proving rejection happened before process execution.

### Verification

- Red regression before fix: `bun test packages/opencorvus/test/skill/manager.test.ts` failed because install/remove deleted the managed root sentinel or returned success for `..`.
- Focused regression after fix passed: `bun test packages/opencorvus/test/skill/manager.test.ts`.
- Adjacent skill and route suites passed: `bun test packages/opencorvus/test/skill/manager.test.ts packages/opencorvus/test/skill/skill.test.ts packages/opencorvus/test/server/skill-routes.test.ts --timeout 30000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Result

- Implemented on 2026-06-18.
- Managed git skill install/remove now share one validated target constructor.
- Malformed git sources fail before any config mutation, filesystem deletion, git process launch, or managed directory write.

### Independent Review Feedback

- Huygens independently confirmed BH-065 was still present after the BH-064 URL discovery fix.
- Huygens identified `install(git)`, `remove(git)`, and `slug(...)` as the root call chain, with API and overlay callers forwarding into that server boundary.
- Huygens recommended a single shared `managedGitTarget(source)` function, strict child containment under `managedRoot()`, rejection before config or filesystem mutation, and tests for `.`, `..`, `.git`, `git://`, and `https://.git`.
- Huygens also recommended removing the swallowed `rm(...)` error from git remove; the final implementation keeps real filesystem failures visible.

## Batch P1-Y: BH-026 direct-reply failures stay structured instead of becoming task-root wakes

### Findings

- BH-026 was recorded against the generic task agent direct-reply path: direct-reply failures were suspected to become `202` task-root wakes while the route documented structured 4xx/410 errors.
- Current HEAD no longer has that failure mode on `POST /task/:taskID/session/:sessionID/reply`.
- The route calls `EngineService.replyAgentSession(...)` directly and only returns `202` after `appendDirectAgentSessionReply(...)` succeeds.
- `InvalidReplyTargetKindError`, `BuildSessionDirectReplyError`, `ReplyTargetEnvelopeMissingError`, `SessionRuntimeContractMissingError`, and `MissingModelConfigError` bubble to `serverErrorResponse(...)`.
- `namedErrorStatus(...)` maps those errors to 400, 409, 410, and 400 respectively.
- `replyRouteErrors(...)` documents the reply-specific 400 NamedError union instead of the generic Hono validation error.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/orchestrator.ts` owns `POST /task/:taskID/session/:sessionID/reply`.
- `packages/opencorvus/src/task-api/index.ts` owns `EngineService.replyAgentSession(...)`, `appendDirectAgentSessionReply(...)`, and `resolveDirectReplyTarget(...)`.
- `packages/opencorvus/src/orchestrator/direct-reply.ts` owns direct-reply NamedError classes and the direct-reply/control kind sets.
- `packages/opencorvus/src/server/error-handler.ts` owns NamedError-to-HTTP status mapping.
- `packages/opencorvus/src/server/error.ts` owns OpenAPI response schemas for normal routes and reply-specific routes.
- `packages/opencorvus/test/server/reply-error-taxonomy.test.ts` is the current regression suite for this bug class.
- `packages/opencorvus/test/server/task-message-routes.test.ts` and `packages/overlay/test/agent-session-controls.test.ts` cover the adjacent task-root build guidance contract.

### Design Boundary

- `POST /task/:taskID/session/:sessionID/reply` is the only direct agent reply route.
- `POST /task/:taskID/message` is task-root operator guidance. Its structured `target: { kind: "build_session" }` is not a direct-reply fallback; it is the explicit build guidance contract from `specs/new-arch/2026-06-10-build-card-steer-operator-guidance.md` and `specs/new-arch/2026-06-13-build-steer-live-ownership-interrupt-fix.md`.
- Build sessions remain excluded from generic direct reply. Build guidance stays visible on the task root and lets the orchestrator decide whether to wait, inspect, cancel a stale owner, or dispatch a fresh build.
- Do not remove `TaskMessageInput.target` as a BH-026 fix; doing so would regress the later build guidance design and conflate task-root operator guidance with direct reply again.
- Do not add a catch-and-wake fallback from the direct-reply route to `/message`.

### Regression Tests

- `reply-error-taxonomy.test.ts` covers invalid session kind, build session kind, hybrid `envelope.agent === "build"`, missing envelope, missing runtime contract, missing model config, healthy worker success, and contract-without-descriptor rejection.
- `task-message-routes.test.ts` covers task-root operator messages with structured source/target metadata and verifies build guidance remains a task-root wake, not a child direct reply.
- `agent-session-controls.test.ts` covers overlay routing: non-build session replies go to `/session/:sessionID/reply`, build guidance goes to `/message` with structured source/target.

### Verification

- Direct-reply taxonomy passed: `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts --timeout 30000`.
- Overlay route selection passed: `bun test packages/overlay/test/agent-session-controls.test.ts --timeout 30000`.
- Task message route contract passed: `bun test packages/opencorvus/test/server/task-message-routes.test.ts --timeout 30000`.

### Result

- Verified on 2026-06-18.
- No code change was required for BH-026 in current HEAD; the direct-reply contract is already fixed by earlier reply taxonomy work.
- The remaining `/message.target` behavior is an intentional task-root build guidance contract, not the BH-026 fallback path.

### Independent Review Feedback

- Galileo confirmed the dedicated direct-reply route currently has no catch-and-wake fallback: it returns 202 only on success and otherwise lets NamedError statuses surface.
- Galileo also identified the adjacent `/task/:taskID/message` `target` field. After reviewing the 2026-06-10 and 2026-06-13 build guidance specs, this field is retained as structured task-root guidance metadata rather than treated as a direct-reply bug.

## Batch P1-Z: BH-027 direct-reply attachment failures must not degrade into summary-only task-root messages

### Findings

- BH-027 was recorded against a historical failure path where direct-reply failure became a task-root wake and only forwarded an attachment summary.
- Current HEAD does not route direct-reply failure through task-root wake.
- `POST /task/:taskID/session/:sessionID/reply` rejects invalid targets before persistence; even when the request includes `attachments`, the root and child sessions receive no message.
- Explicit task-root messages still carry attachments structurally: `TaskMessageInput.attachments` are written through `AttachmentStore.write(...)`, appended to `task.attachments`, and persisted as `Message.FilePart` rows by `appendTaskSessionMessage(...)`.
- `dispatchTaskLoop.event.operatorMessage.attachmentSummary` remains only a scheduler prompt summary and is not the durable attachment source.

### Call-point Inventory

- `packages/opencorvus/src/engine/model.ts` owns `TaskMessageInput`, `TaskAttachmentInput`, and `AgentSessionReplyInput`.
- `packages/opencorvus/src/server/routes/orchestrator.ts` owns `/task/:taskID/message` and `/task/:taskID/session/:sessionID/reply`.
- `packages/opencorvus/src/task-api/index.ts` owns `appendDirectAgentSessionReply(...)`, `handleTaskMessage(...)`, `appendAndWakeTaskOperatorMessage(...)`, `appendTaskSessionMessage(...)`, and `appendTaskAttachment(...)`.
- `packages/overlay/src/services/task.ts` owns overlay callers for non-build direct reply and build task-root guidance.
- `packages/opencorvus/src/tool/panel.ts` and `packages/opencorvus/src/orchestrator/tools.ts` call task-message or direct-reply services through the same central APIs.

### Fix Shape

- No production code change was required in current HEAD.
- Add regression coverage to keep the existing contract from regressing:
  - direct-reply failure with attachments must reject structurally and must not persist a task-root fallback message;
  - explicit task-root messages with attachments must persist file parts and append the same attachment reference to `task.attachments`.
- Do not convert `AgentSessionReplyInput.attachments` into task-root attachments on failure.
- Do not add a catch/retry path that re-sends failed direct replies through `/task/:taskID/message`.

### Regression Tests

- Extend `packages/opencorvus/test/server/reply-error-taxonomy.test.ts`.
- Add `invalid direct reply with attachments rejects without task-root fallback`; it posts a URL attachment to an invalid direct-reply target, expects `400 InvalidReplyTargetKindError`, and asserts both root and child sessions have no messages.
- Extend `packages/opencorvus/test/server/task-message-routes.test.ts`.
- Strengthen the attachment-summary test so the HTTP response and persisted root message include a `file` part, and the task row's `attachments` include the same user-upload/spec-artifact reference.

### Verification

- Direct-reply attachment fallback regression passed: `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts --timeout 30000`.
- Task-root attachment persistence regression passed: `bun test packages/opencorvus/test/server/task-message-routes.test.ts --timeout 30000`.
- Task API attachment persistence suite passed: `bun test packages/opencorvus/test/task-api/handle-task-message-attachment-persistence.test.ts --timeout 30000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Result

- Verified on 2026-06-18.
- Direct-reply failure with attachments remains a structured error and writes no fallback task-root message.
- Explicit task-root message attachments remain structured persisted file parts and task attachment references; the scheduler summary is only an auxiliary prompt summary.

### Independent Review Feedback

- Hegel confirmed BH-027 is not present in current source: direct reply and task-root message are separate paths, and task-root attachments are persisted as file parts plus task attachment refs.
- Hegel recommended preserving the current split rather than adding fallback conversion, and recommended the two regression additions implemented in this batch.

## Batch P1-AA: BH-028 interaction ask/resolve must update run blocking state

### Findings

- BH-028 was recorded against a runtime ownership regression: `EngineInteraction` creates and resolves durable interaction rows, then asks `EngineRuntime.syncRun(...)` or `syncTask(...)` to update the run blocker.
- `EngineRuntime.syncRun(...)` is no longer a pipeline advancement mechanism. Its remaining responsibility for this surface is run-state convergence: pending interactions set the active run to `blocked`, and resolved interaction blockers are cleared.
- Existing tests covered durable interaction rows and a pre-blocked run clearing path, but did not exercise the real ask/resolve path that starts with a `running` run.
- Independent review found the remaining production hole in per-goal mode: `syncGoalRuns(...)` returned immediately while any goal_run was live, before projecting pending interactions or clearing a resolved interaction blocker on the parent run.

### Call-point Inventory

- `packages/opencorvus/src/engine/interaction.ts` owns `EngineInteraction.subscribe(...)`, permission/question ask upserts, and `resolveInteraction(...)`; it is the single event-to-engine bridge for `PermissionNext` and `Question` prompts.
- `packages/opencorvus/src/engine/runtime.ts` owns `EngineRuntime.syncRun(...)` and `syncTask(...)`; the relevant branches are pending-interaction blocking and no-queue interaction-blocker clearing.
- `packages/opencorvus/src/engine/state.ts` owns `hooks().updateRun(...)`, which appends artifact-backed run rows and is the durable persistence path for `status` and `blocking_reason`.
- `packages/opencorvus/src/task-api/index.ts` owns `EngineService.replyInteraction(...)` and `rejectInteraction(...)`; server routes, channel ingress, panel tools, and TUI callers converge here before emitting `PermissionNext` / `Question` replies.
- `packages/opencorvus/src/channel/ingress.ts`, `packages/opencorvus/src/tool/panel.ts`, and `packages/opencorvus/src/server/routes/orchestrator.ts` are callers only; they must not add local blocking-state fixes.
- `packages/opencorvus/src/session/processor.ts` and `packages/opencorvus/src/session/loop.ts` are ask producers through `PermissionNext.ask(...)`.
- `packages/opencorvus/src/executor/contract.ts` and `packages/opencorvus/src/executor/managed.ts` own executor queue status typing; production executors use queued/retrying/running/completed/failed and do not provide a separate executor `blocked` status.

### Fix Shape

- Add a focused regression test that subscribes `EngineInteraction` with real `hooks()`, creates a live run with no queue ref, emits a permission ask from a child session, and asserts the persisted run becomes `blocked` with `blocking_reason = "permission"`.
- Resolve the same interaction through `EngineService.replyInteraction(...)` and assert the persisted run returns to `running` with `blocking_reason = null`.
- Add per-goal runtime coverage for a live goal_run with a pending interaction: `syncRun(...)` must persist the parent run as `blocked`, then clear it after the interaction resolves, without waking the terminal goal batch path.
- Fix the central runtime path only. Do not add route-level updates, caller-specific gates, or a fallback wake path.

### Regression Tests

- Extend `packages/opencorvus/test/engine/interaction-permission.test.ts`.
- Cover both ask-side persistence and resolve-side clearing with `findRun(...)`, not only in-memory hook calls or interaction row status.
- Extend `packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts`.
- Cover live goal_run interaction blocking and resolved-blocker clearing before the live goal_run early return.
- Extend `packages/opencorvus/test/engine/protocol-interaction.test.ts`.
- Cover protocol reply clearing the persisted run blocker when the executor is still running.

### Verification

- Focused interaction regression passed before the per-goal fix: `bun test packages/opencorvus/test/engine/interaction-permission.test.ts --timeout 30000`.
- New live goal_run regression failed before the runtime fix with `Expected: "blocked"; Received: "running"`.
- Combined runtime/interaction/protocol regression passed after the fix: `bun test packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts packages/opencorvus/test/engine/interaction-permission.test.ts packages/opencorvus/test/engine/protocol-interaction.test.ts --timeout 30000`.
- Package typecheck passed after the executor status contract cleanup: `bun run --cwd packages/opencorvus typecheck`.

### Result

- Verified on 2026-06-18.
- Implemented on 2026-06-18.
- `syncGoalRuns(...)` now projects pending interactions and clears resolved interaction blockers before returning for live goal_run work.
- Permission ask from a child build session persists the active run as `blocked` with `blocking_reason = "permission"`.
- Replying through `EngineService.replyInteraction(...)` persists the run back to `running` with `blocking_reason = null`.
- Protocol interaction replies now assert persisted run blocker clearing while the executor remains `running`.
- Unsupported executor status `blocked` was removed from `ExecutorStatusInfo`; run-level `blocked` remains the durable engine state.

### Independent Review Feedback

- Epicurus confirmed the no-queue permission ask/reply path is covered by the first regression, but identified a remaining per-goal early return before interaction projection.
- Epicurus recommended keeping all run blocking writes inside runtime/interaction/state rather than adding route, panel, or channel callers.
- Epicurus also flagged the executor `blocked` status contract as adjacent debt: current production executors do not produce it (`ManagedCodingExecutor` excludes it and `TaskQueueStatus` has no `blocked` value). The final fix removes the unsupported executor status instead of inventing a default executor blocking reason.

## Batch P1-AB: BH-029 dead-owner active tasks must not hold cwd queue ownership forever

### Findings

- BH-029 targets the directory queue: `claimNextForCwd(...)` treats any task with `time_started IS NOT NULL` and `time_completed IS NULL` in the same cwd as active ownership.
- Dead-owner execution convergence exists in `engine/writer.ts::convergeDeadOwnerLiveExecution(...)`, but it only runs on server startup. A queued same-cwd task can remain blocked if queue advancement happens while an orphaned active task is still present.
- The existing orphan model already defines the physical fact: a live goal_run with a foreign dead owner means the old owner process died and the mid-stream goal cannot resume.
- The queue must not invent a synthetic wake or route-level bypass. The correct central fix is to converge dead-owner active tasks for that cwd before claiming the next queued task.

### Call-point Inventory

- `packages/opencorvus/src/engine/queue.ts` owns cwd serialization: `claimNextForCwd(...)`, `advanceQueue(...)`, `dispatchTaskLoop(...)`, `startQueuedTaskInCwd(...)`, and `listActiveForCwd(...)`.
- `packages/opencorvus/src/engine/writer.ts` owns live-execution terminalization for shutdown/startup: `convergeDeadOwnerLiveExecution(...)`, `abortCurrentProcessLiveExecution(...)`, `terminateTaskOwnedSessionsAndFail(...)`, `abortGoalRunsForRows(...)`, and `abortRunsForRows(...)`.
- `packages/opencorvus/src/engine/orphan.ts` owns the owner-stamp orphan predicate used to distinguish dead-owner live goal_runs from still-live foreign owners.
- `packages/opencorvus/src/task-api/index.ts` calls `dispatchTaskLoop(...)` after task creation, retry, operator messages, and `startQueuedTaskNow(...)`.
- `packages/opencorvus/src/engine/runtime.ts` calls `dispatchTaskLoop(...)` when terminal goal batches settle.
- `packages/opencorvus/src/cli/cmd/serve.ts` runs project-wide dead-owner convergence on server startup; BH-029 adds a queue-time convergence path for the same physical fact, not a second lifecycle rule.

### Fix Shape

- Add a writer helper that converges a caller-provided set of active tasks using the same dead-owner logic as startup convergence.
- `advanceQueue(cwd)` should call that helper for `listActiveForCwd(cwd)` before `claimNextForCwd(cwd)`.
- If an active task has a live owner or no dead-owner live execution facts, the helper must not mutate it and the queued sibling must remain queued.
- If the active task is terminalized by dead-owner convergence, `advanceQueue(cwd)` can claim and start the next queued task through the existing queue path.
- Do not make queued tasks bypass `claimNextForCwd(...)`, do not synthesize operator messages, and do not add route-specific cleanup.

### Regression Tests

- Extend `packages/opencorvus/test/engine/queue.test.ts`.
- Seed an active task with a live run and a dead-owner live goal_run, plus a queued same-cwd task; `advanceQueue(cwd)` must abort the dead-owner execution, mark the old task failed, and start the queued task.
- Keep existing tests proving a live active task still blocks queued siblings.
- Add a queue-level negative case where the active task's goal_run is owned by the current process; `advanceQueue(cwd)` must not terminalize it and the queued sibling must stay queued.

### Verification

- New dead-owner queue regression failed before the fix with `Expected: "failed"; Received: "active"`.
- Queue suite passed after the fix: `bun test packages/opencorvus/test/engine/queue.test.ts --timeout 30000`.
- Owner-orphan and shutdown convergence suites passed: `bun test packages/opencorvus/test/engine/goal-run-owner-orphan.test.ts packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts --timeout 30000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.

### Result

- Implemented on 2026-06-18.
- `advanceQueue(cwd)` now first converges dead-owner active tasks in that cwd, then uses the existing `claimNextForCwd(...)` path to start queued work.
- Startup convergence now delegates to the same task-scoped dead-owner helper, preserving a single terminalization implementation.
- Current-process live owners are not terminalized by queue advancement, and their same-cwd queued siblings remain queued.

### Independent Review Feedback

- Confucius confirmed BH-029 is fixed in the dirty worktree by the queue-time convergence path.
- Confucius identified all automatic queue advancement callers as affected and confirmed `queue=false` and `/task/:taskID/start-now` are explicit bypass/override semantics, not this bug's fix path.
- Confucius recommended the current-process/live-owner negative regression, which was added before final verification.

## Batch P1-AC: BH-030 open tool orphan detection must filter current owners before prompt cap

### Findings

- BH-030 targets `describe.ts::listOpenToolCallsWithoutCurrentOwner(...)`.
- Current code queries open tool parts ordered newest-first with `LIMIT 5`, then filters out sessions whose `SessionStatus` is `streaming` or `retry`.
- If the latest five open tool parts are still owned by the current process, a sixth older stale open tool call is dropped before the owner filter and never reaches the orchestrator prompt.
- The stale open tool projection is read-only execution evidence. The fix must stay in the describe projection and must not mutate task/session/message state.

### Call-point Inventory

- `packages/opencorvus/src/engine/describe.ts` owns `listOpenToolCallsWithoutCurrentOwner(...)`, `describeTask(...)`, and `renderTaskDescription(...)`.
- `packages/opencorvus/src/session/status.ts` owns current-process session status facts used to exclude live `streaming`/`retry` sessions.
- `packages/opencorvus/src/session/session.sql.ts` owns `part` rows and tool-part persisted status.
- `packages/opencorvus/test/engine/describe-stream-error.test.ts` already covers stale open tool projection and current-process exclusion.
- `specs/operator-wake-open-tool-facts-2026-06-17.md` defines the read-only boundary: describe surfaces orphaned open tool facts; startup convergence must not fail run-less active tasks merely because they have open tool parts.

### Fix Shape

- Query enough open tool candidates to survive current-process filtering, then apply `OPEN_TOOL_CALL_PROMPT_CAP` after filtering.
- Keep the final rendered list capped at `OPEN_TOOL_CALL_PROMPT_CAP`.
- Do not push current-process filtering into SQL because `SessionStatus` is in-memory process state, not a durable table.
- Do not add task lifecycle mutation, synthetic tool results, or a queue/runtime gate.

### Regression Tests

- Extend `packages/opencorvus/test/engine/describe-stream-error.test.ts`.
- Seed five newest current-process `streaming` open tool parts and one older stale open tool part; assert the stale tool is still projected and rendered.

### Verification

- The cap-order regression failed before the implementation because `desc.open_tool_calls_without_current_owner` was `undefined` when the stale open tool was sixth after five current-process open tools.
- Implemented on 2026-06-18: `listOpenToolCallsWithoutCurrentOwner(...)` now reads open tool candidates, filters current-process `streaming` and `retry` sessions through `SessionStatus`, and only then applies `OPEN_TOOL_CALL_PROMPT_CAP`.
- Added a negative regression proving current-process `retry` open tools are excluded alongside `streaming`.
- `bun test packages/opencorvus/test/engine/describe-stream-error.test.ts -t "describeTask.open_tool_calls_without_current_owner" --timeout 30000` passed with 3 tests.
- `bun run --cwd packages/opencorvus typecheck` passed.
- Independent agent Dirac reviewed the dirty worktree, confirmed BH-030 is fixed by moving the cap after current-process filtering, and recommended the `retry` negative coverage that was added before final verification.

## Batch P1-AD: BH-031/BH-032 read_context must preserve describe-layer facts

### Findings

- BH-031 targets the terminal goal batch wake fact written by `packages/opencorvus/src/engine/runtime.ts::recordGoalBatchNotification(...)`.
- The fact is persisted as `engine_artifact.kind = "goal_batch_notification"` after `dispatchTaskLoop(...)` starts, but no describe/read_context projection reads that artifact back.
- BH-032 targets `packages/opencorvus/src/orchestrator/tools.ts::read_context`. The tool calls `describeTask(...)` for collaboration closure, then rebuilds the goal list from `listGoals(...)`, `goalStatusByID(...)`, and `findLatestTipGoalRun(...)`.
- Rebuilding from raw goals loses describe-layer facts already present in `GoalDesc`: `needs_redispatch`, `latest_attempt.superseded_reason`, `is_orphaned`, and full attempt timeline details.

### Call-point Inventory

- `packages/opencorvus/src/engine/runtime.ts` owns `terminalGoalBatchFingerprint(...)`, `hasGoalBatchNotification(...)`, and `recordGoalBatchNotification(...)`.
- `packages/opencorvus/src/engine/store.ts` owns artifact list/read helpers used by describe-layer projections.
- `packages/opencorvus/src/engine/describe.ts` owns `describeTask(...)`, `GoalDesc`, `TaskDesc`, and `renderTaskDescription(...)`; it is the correct single model-visible task fact source.
- `packages/opencorvus/src/orchestrator/tools.ts` owns `read_context`; the `scope=goals` branch must render `desc.goals`, not rebuild raw goal rows.
- Existing coverage lives in `packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts`, `packages/opencorvus/test/engine/goal-run-owner-orphan.test.ts`, and `packages/opencorvus/test/orchestrator/tools.test.ts`.

### Fix Shape

- Add a store helper for recent `goal_batch_notification` artifacts, then project them into `TaskDesc` through `describeTask(...)`.
- Render terminal goal batch wake facts in `renderTaskDescription(...)` and in `read_context scope=goals/all`.
- Export and reuse the describe-layer goal renderer from `read_context` so `needs_redispatch`, superseded reason, orphan state, and attempt details have one text source.
- Include `session_id` in rendered attempts so `read_context` keeps its live child-session steering fact while moving to `GoalDesc`.
- Do not add a scheduler gate, retry state machine, synthetic message, or duplicate read_context-only status derivation.

### Regression Tests

- Add a describe-layer test that seeds a `goal_batch_notification` artifact and asserts `describeTask(...)` plus `renderTaskDescription(...)` surface run id, fingerprint, and goal_run statuses.
- Add/modify `orchestrator/tools.test.ts` coverage so `read_context scope=goals` preserves redispatch intent from a superseded terminal tip and owner-orphan state from `GoalDesc`.
- Update the existing read_context runtime-id test to assert the shared renderer exposes `run=<goal_run_id>` and `session=<child_session_id>`.

### Verification

- The terminal batch describe regression failed before the implementation because `desc.recent_terminal_goal_batches` was `undefined` after `EngineRuntime.syncRun(...)` wrote a `goal_batch_notification` artifact.
- The read_context regressions failed before the implementation because `scope=goals` still rendered raw `latest_goal_run_*` rows and did not contain `NEEDS_REDISPATCH(...)` or `ORPHANED(...)`.
- Implemented on 2026-06-18: `describeTask(...)` projects recent `goal_batch_notification` artifacts into `TaskDesc`, `renderTaskDescription(...)` renders them, and `read_context scope=goals/all` reuses the describe-layer goal and terminal-batch renderers.
- `bun test packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts --timeout 30000` passed with 9 tests.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "read_context surfaces terminal goal batch wake facts|read_context preserves describe-layer redispatch and orphan facts|read_context surfaces latest goal_run" --timeout 30000` passed with 3 tests.
- `bun run --cwd packages/opencorvus typecheck` passed.
- Broader check `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 30000` was attempted and did not pass: 56 passed, 14 failed, 1 error. Sample isolated failures were outside the BH-031/BH-032 read_context path (`MissingModelConfigError` in `propose_task`, missing real tool execution identity in an integrity artifact-missing test, and a freshContext worktree marker precondition). These residual failures are not hidden as success and need separate triage if they are not already covered by later bug-hunt entries.
- Independent agent Descartes confirmed BH-031/BH-032 existed on HEAD, identified the double-source read_context goal rendering as the root cause, and recommended the shared describe-layer renderer plus terminal batch read path used here.

## Batch P1-AE: BH-033 terminal operator wake must requeue through cwd serialization

### Findings

- BH-033 targets `packages/opencorvus/src/task-api/index.ts::appendAndWakeTaskOperatorMessage(...)` and `packages/opencorvus/src/engine/queue.ts::dispatchTaskLoop(...)`.
- The older 2026-06-05 terminal wake note required terminal `/message` and `/inject` calls to record visible messages without waking. Later specs supersede that contract for user-authored follow-up messages:
  - `specs/new-arch/2026-06-09-operator-message-add-goal-dispatch.md` requires completed-task follow-up messages to wake the orchestrator so it can add concrete goals in the same task conversation.
  - `specs/2026-06-10-cancelled-task-message-input.md` requires cancelled-task messages to clear cancelled metadata, clear the error, requeue, append the user message, and dispatch.
  - `specs/new-arch/2026-06-14-model-resume-progress-root-cause-fix.md` reaffirms cancelled task messages should reopen naturally with a fresh valid orchestrator execution owner.
- The real BH-033 root cause is narrower: completed-task operator messages were reopening the task as `active`, which clears `time_completed` and lets `dispatchTaskLoop(...)` take the active-task re-entry path instead of the queued `advanceQueue(...) -> claimNextForCwd(...)` path.
- Queue terminal guards are not the right fix point because task-api has already hidden the terminal fact by changing the task to active. Adding an active same-cwd gate in queue would blur legal active-task wake behavior and duplicate cwd queue ownership logic.

### Call-point Inventory

- `packages/opencorvus/src/task-api/index.ts::handleTaskMessage(...)` is the `/task/:taskID/message` service entry and returns `should_resume`.
- `packages/opencorvus/src/task-api/index.ts::injectMessage(...)` is the `/task/:taskID/inject` service entry and returns `orchestratorWoken`.
- `packages/opencorvus/src/task-api/index.ts::appendAndWakeTaskOperatorMessage(...)` is the shared writer/wake path for `/message` and `/inject`.
- `packages/opencorvus/src/task-api/index.ts::reopenCompletedTaskFromOperatorMessage(...)` is the bad reopen point; it must requeue completed tasks, not activate them.
- `packages/opencorvus/src/task-api/index.ts::reopenFailedTaskFromOperatorMessage(...)` and `reopenCancelledTaskFromOperatorMessage(...)` already requeue and remain the matching terminal-follow-up behavior.
- `packages/opencorvus/src/engine/queue.ts::dispatchTaskLoop(...)` already sends queued tasks through `advanceQueue(...)`; same-cwd serialization lives in `claimNextForCwd(...)`.
- `packages/opencorvus/test/server/task-message-routes.test.ts` owns route-level `/message` and `/inject` coverage.
- `packages/opencorvus/test/engine/queue.test.ts` already proves direct queue dispatch against a still-terminal task is ignored.

### Fix Shape

- Change completed-task follow-up reopen from `active` to `queued`.
- Keep `should_resume: true` and `orchestratorWoken: true` for terminal follow-up messages because the scheduler has been notified; do not reinterpret those fields as proof that a loop already started.
- Do not change failed/cancelled requeue behavior.
- Do not add queue-level fallback/gate logic. Queued tasks must continue through the existing cwd claim path.

### Regression Tests

- Update the completed `/message` route regression to assert the task becomes `queued`, `time_started` is cleared, `time_completed` is cleared, metadata is preserved, and scheduler dispatch receives the operator message.
- Add active-A plus completed-B same-cwd `/message` coverage: posting to B must requeue B, not launch a second loop while A is active.
- Add matching active-A plus completed-B same-cwd `/inject` coverage because inject uses the same shared task-api wake path.
- Keep existing failed and cancelled `/message` and failed `/inject` requeue/wake tests as the current contract.

### Verification

- Before the implementation, the focused completed-message same-cwd regression failed because the completed task was reopened as `active` and `runTaskLoop` started while another same-cwd task was already active.
- Implemented on 2026-06-18: `reopenCompletedTaskFromOperatorMessage(...)` now reopens completed follow-up tasks as `queued`, matching failed/cancelled terminal follow-up behavior and forcing dispatch through `advanceQueue(...) -> claimNextForCwd(...)`.
- Added same-cwd `/message` and `/inject` route regressions proving completed task B is queued behind active task A and no second loop starts.
- Focused terminal/same-cwd route tests passed: `bun test packages/opencorvus/test/server/task-message-routes.test.ts -t "completed task|completed same-cwd|reopens failed terminal|cancelled task" --timeout 30000`.
- Full route suite passed: `bun test packages/opencorvus/test/server/task-message-routes.test.ts --timeout 30000`.
- Queue suite passed: `bun test packages/opencorvus/test/engine/queue.test.ts --timeout 30000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Mendel initially flagged the older 2026-06-05 no-wake terminal contract, then re-reviewed against the later 2026-06-09, 2026-06-10, and 2026-06-14 specs.
- Final independent conclusion: terminal follow-up messages currently requeue/wake, but completed tasks must requeue rather than become active. The root fix belongs in task-api's completed reopen path, not in queue fallback logic.

## Batch P1-AF: BH-034 live browser preview commands must be serial inside a sidecar session

### Findings

- BH-034 targets `packages/opencorvus/src/browser-preview/live.ts`, specifically the embedded `BROWSER_PREVIEW_LIVE_SCRIPT` stdin loop.
- `browserPreviewLiveSession(...)` already creates one `BrowserPreviewLiveSidecar` per `taskID:targetID:viewportID`; that sidecar is the single live-session owner for mutable Playwright state.
- Host-side `BrowserPreviewLiveSidecar.command(...)` tracks pending command IDs and timeouts, but it writes JSON lines immediately. It does not serialize command execution.
- The sidecar script reads all complete stdin lines from a chunk and calls `handle(message).catch(...)` without awaiting the previous command. Concurrent `ensurePage(...)`, `applyInput(...)`, and `capture(...)` calls share mutable globals: `browser`, `context`, `page`, `currentUrl`, and `currentViewport`.
- The root bug is not route validation or target lookup. It is the sidecar session execution loop allowing same-session commands to run concurrently.

### Call-point Inventory

- `packages/opencorvus/src/browser-preview/live.ts::captureBrowserPreviewLiveSnapshot(...)` sends snapshot commands to the live sidecar.
- `packages/opencorvus/src/browser-preview/live.ts::interactBrowserPreviewLive(...)` sends input commands to the same live sidecar.
- `packages/opencorvus/src/browser-preview/live.ts::browserPreviewLiveSession(...)` defines the live session key and sidecar reuse boundary.
- `packages/opencorvus/src/browser-preview/live.ts::BrowserPreviewLiveSidecar.command(...)` owns host pending response matching and command timeout handling.
- `packages/opencorvus/src/browser-preview/live.ts::BROWSER_PREVIEW_LIVE_SCRIPT` owns the child process stdin loop, `ensurePage(...)`, `capture(...)`, `applyInput(...)`, and `handle(...)`.
- `packages/opencorvus/src/server/routes/browser-preview.ts` is only the HTTP route surface and should not add a route-level queue.
- `packages/opencorvus/test/browser-preview/live-lifecycle.test.ts` already uses source-level lifecycle guards for the embedded sidecar script.
- `packages/opencorvus/test/server/browser-preview-routes.test.ts` owns route-level live snapshot/input coverage.

### Fix Shape

- Add a sidecar-local promise chain and enqueue each parsed command through it.
- Each command in the chain must settle to a stdout response before the next command starts, preserving stdin order for a single live session.
- A failed command must write the same structured `{ id, ok:false, error }` response and must not poison the chain for later commands.
- Do not add a host route queue, alternate browser context source, fallback screenshot path, or duplicate target/session store.

### Regression Tests

- Extend `packages/opencorvus/test/browser-preview/live-lifecycle.test.ts` to assert the embedded sidecar script contains a serial command chain and no longer directly starts `handle(message)` from the stdin parser.
- Add route-level concurrent live input coverage in `packages/opencorvus/test/server/browser-preview-routes.test.ts`: warm the same live session, fire two concurrent inputs, and use page-colour evidence to prove the second command observes the first command's completed state instead of racing ahead.

### Verification

- New lifecycle guard failed before the implementation because `BROWSER_PREVIEW_LIVE_SCRIPT` did not contain `commandChain` or `enqueueCommand(...)` and still called `handle(message).catch(...)` directly from the stdin parser.
- Implemented on 2026-06-18: the embedded sidecar script now enqueues parsed commands through a sidecar-local `commandChain`; each command writes a structured success or failure response before the next command starts.
- Added a route-level concurrent live-input regression whose page paints red after the first command completes, paints blue only if the second command sees that completed state, and paints a persistent race colour if the second command runs too early. The second response and final snapshot must both be blue.
- Focused regression passed: `bun test packages/opencorvus/test/browser-preview/live-lifecycle.test.ts packages/opencorvus/test/server/browser-preview-routes.test.ts -t "serializes commands|serializes concurrent same-session" --timeout 60000`.
- Full lifecycle suite passed: `bun test packages/opencorvus/test/browser-preview/live-lifecycle.test.ts --timeout 30000`.
- Full browser-preview route suite passed: `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts --timeout 60000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Lagrange confirmed the live session key `taskID:targetID:viewportID` is the correct serialization boundary because the embedded sidecar owns the mutable Playwright `browser/context/page` state.
- Lagrange recommended strengthening the route test from simple red/blue clicks into an ordered/race visual assertion. The final route regression uses that shape.

## Batch P1-AG: BH-035 provider fetch must clear inactivity timer on pre-response failures

### Findings

- BH-035 targets `packages/opencorvus/src/provider/provider.ts::getSDK(...)`, specifically the `options["fetch"]` wrapper installed for provider SDKs.
- The wrapper creates an inactivity `AbortController`, starts a timer before calling `fetchFn(...)`, and clears the timer only on HTTP-error handling, stream flush, or non-streaming success.
- If the custom or global `fetchFn` throws before returning a `Response`, the wrapper rethrows while leaving the timer live. The later timer callback aborts a signal for a request that has already failed, producing delayed side effects and noisy timeout logs.
- The same leak can happen for other synchronous failures after `resetInactivityTimer?.()` and before the wrapper returns a response.

### Call-point Inventory

- `packages/opencorvus/src/provider/provider.ts::resolveFetchInactivityMs(...)` chooses the timeout duration; `alibaba-coding-plan-cn` can use a short configured timeout and is useful for deterministic coverage.
- `packages/opencorvus/src/provider/provider.ts::providerFetchInit(...)` forwards the composed `AbortSignal` into the SDK fetch call.
- `packages/opencorvus/src/provider/provider.ts::getSDK(...)` installs the wrapped fetch into provider options for bundled and dynamically loaded providers.
- `packages/opencorvus/src/provider/provider.ts::getLanguage(...)` obtains the SDK-backed language model and is the public path that triggers the wrapped fetch.
- `packages/opencorvus/test/provider/provider.test.ts` already covers provider timeout policy and provider config merging.

### Fix Shape

- Add a local `clearInactivityTimer()` beside `resetInactivityTimer()`.
- Wrap the post-timer provider fetch body in `try/catch`.
- On any throw before a streaming response is returned, clear the inactivity timer before rethrowing the original error.
- Keep the existing streaming response behavior: while a stream is returned, activity resets the timer on chunks and clears it on stream flush.
- Do not add fallback retries, suppress the original provider error, or convert it into a host-side timeout.

### Regression Tests

- Add `provider fetch clears inactivity timer when fetch throws before response` in `packages/opencorvus/test/provider/provider.test.ts`.
- Use an in-memory custom provider config whose `fetch` captures the supplied `AbortSignal` and throws immediately.
- Set a short `alibaba-coding-plan-cn` provider timeout, assert the provider error is still surfaced, wait beyond the inactivity window, and assert the captured signal was not aborted later.

### Verification

- New regression failed before the implementation: after `fetch` threw, the timer fired 20ms later and `observedSignal.aborted` became `true`.
- Implemented on 2026-06-18: the provider fetch wrapper now uses a local `clearInactivityTimer()` helper and clears the timer in a catch path before rethrowing the original provider error.
- Strengthened the regression to prove the 20ms inactivity timer was actually set and cleared, then waited beyond the inactivity window and asserted the captured `AbortSignal` was still not aborted.
- Focused regression passed: `bun test packages/opencorvus/test/provider/provider.test.ts -t "provider fetch clears inactivity timer" --timeout 30000`.
- Full provider suite passed: `bun test packages/opencorvus/test/provider/provider.test.ts --timeout 30000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Hume confirmed the root cause was the timer started before `fetchFn(...)` and the missing cleanup path when `fetchFn` throws before returning a `Response`.
- Hume confirmed the final fix preserves the original provider error, adds no retry/fallback/gate, and recommended the set/clear timer assertion added to the regression test.

## Batch P1-AH: BH-036 SDK server startup timeout must terminate the child process

### Findings

- BH-036 targets `packages/sdk/js/src/server.ts::createOpenCorvusServer(...)`.
- The SDK spawns `opencorvus serve ...`, waits for stdout to contain `server listening`, and rejects on startup timeout.
- The timeout path only rejects the promise. It does not terminate the child process, so a slow or wedged server binary can remain alive after the caller sees a failed startup.
- The startup lifecycle owner is the SDK helper itself: callers only receive a `close()` handle after startup succeeds, so they have no handle to clean up a child that times out before URL discovery.

### Call-point Inventory

- `packages/sdk/js/src/server.ts::resolveCommand()` resolves the executable used by `createOpenCorvusServer(...)`.
- `packages/sdk/js/src/server.ts::createOpenCorvusServer(...)` owns process spawn, stdout URL discovery, startup timeout, abort handling, and the returned `close()` method.
- `packages/sdk/js/src/index.ts` re-exports `createOpenCorvusServer(...)` and calls it from `createOpenCorvus(...)`.
- `packages/sdk/js/example/example.ts` calls `createOpenCorvusServer(...)` directly.
- `packages/channel-runtime/test/subscribe-events-global.test.ts`, `packages/channel-runtime/test/start-idempotency.test.ts`, and `packages/channel-runtime/test/sdk-mock.ts` use mock SDK server helpers only; they are not affected by child-process lifecycle changes.
- `packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts` has source-level SDK contract coverage, but no real child-process timeout regression.

### Fix Shape

- On startup timeout, terminate the spawned process before rejecting.
- The timeout rejection must preserve the current timeout error message so callers still receive the same startup failure contract.
- Reuse the same direct process termination primitive for pre-start abort cleanup where applicable; do not add retries, fallback binaries, gates, or compatibility command wrappers.
- Keep successful startup behavior unchanged: after URL discovery, callers still receive `{ url, close() }`, and `close()` terminates the spawned server.

### Regression Tests

- Add `packages/sdk/js/test/server.test.ts`.
- Use `OPENCORVUS_BIN_PATH=node` and a temporary extensionless `serve` script in the current working directory. Node executes that script as the first CLI argument, which works on Windows without a `.cmd` wrapper.
- The fake `serve` script writes its PID to a file and then stays alive without printing `server listening`.
- Call `createOpenCorvusServer(...)` with a short startup timeout, assert it rejects with the timeout message, then assert the recorded PID exits within a bounded window.
- The test's `finally` block kills any surviving PID so the red test does not leak a process.
- Add an SDK package `test` script so the regression has a package-local entry point.

### Verification

- New regression failed before implementation: `createOpenCorvusServer(...)` rejected with the expected timeout message, but the fake server PID was still alive after the bounded wait.
- Implemented on 2026-06-18: `createOpenCorvusServer(...)` now owns a local `stopProcess()` helper, calls it before timeout rejection, calls it on pre-start abort, and reuses it for the returned `close()` method.
- SDK `tsconfig.json` now explicitly loads only Node ambient types. This fixed the package typecheck toolchain issue where `tsc --noEmit` auto-loaded unrelated root `@types` packages with missing transitive type definitions.
- Package test entry passed: `bun run --cwd packages/sdk/js test --timeout 30000`.
- SDK package typecheck passed: `bun run --cwd packages/sdk/js typecheck`.
- Existing SDK source contract suite passed: `bun test packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts --timeout 30000`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Parfit confirmed BH-036 was still present before the fix: the startup timeout callback only rejected, while `close()` was unreachable because the server handle is returned only after successful URL discovery.
- Parfit agreed the root fix belongs in `createOpenCorvusServer(...)`'s startup lifecycle owner and does not require fallback binaries, gates, command parsing rewrites, or a supervisor.
- Parfit recommended adding explicit timeout-path process-kill coverage. The final regression uses a real long-running fake server process and asserts the PID exits after timeout.

## Batch P1-AI: BH-037 sidecar handshake tests must timeout on stdout inactivity

### Findings

- BH-037 targets `packages/opencorvus/test/cli/sidecar-smoke.test.ts`, where the handshake loop computes `deadline = Date.now() + 30_000` but then awaits `reader.read()` directly.
- If the sidecar child keeps stdout open and silent, the pending `reader.read()` never resolves, so the loop never reaches the `Date.now() < deadline` check again.
- The same raw handshake loop shape exists in `packages/opencorvus/test/cli/sidecar-chaos.test.ts` and `packages/opencorvus/test/cli/sidecar-contention.test.ts`.
- This is a test-harness timeout bug, not a sidecar production behavior bug: the sidecar command already has a real stdout handshake contract, and the harness must fail with diagnostics when that contract stays silent.

### Call-point Inventory

- `packages/opencorvus/src/cli/cmd/sidecar.ts` writes the canonical handshake line `OPENCORVUS_LISTEN=127.0.0.1:<port>` after the server starts and the lock is acquired.
- `packages/opencorvus/test/cli/sidecar-smoke.test.ts` reads that handshake before health, shutdown, and lock cleanup assertions.
- `packages/opencorvus/test/cli/sidecar-chaos.test.ts::spawnSidecar(...)` optionally waits for the same handshake before lock-contention and parent-watchdog checks.
- `packages/opencorvus/test/cli/sidecar-contention.test.ts` waits for the first sidecar's handshake before launching the contending sidecar.
- `packages/opencorvus/test/cli/sidecar-chaos.test.ts` also drains stderr for diagnostics, but that drain is intentionally process-lifetime and does not define the stdout handshake timeout.

### Fix Shape

- Add one test-local `readSidecarHandshake(...)` helper under `packages/opencorvus/test/cli`.
- The helper must parse the canonical handshake line from stdout and return `{ port, stdout }`.
- The helper must wrap each `reader.read()` in an inactivity timeout. Any stdout chunk resets the timeout; a silent open stream rejects with a diagnostic that includes the configured label and stdout tail.
- Replace the raw Date-deadline handshake loops in smoke, chaos, and contention tests with the helper.
- Do not add production sidecar gates, alternate handshake formats, or fallback parsing.

### Regression Tests

- Add a silent open `ReadableStream<Uint8Array>` fixture and assert `readSidecarHandshake(...)` rejects after stdout inactivity with diagnostics.
- Add a delayed-chunk fixture that emits non-handshake progress before the inactivity window and later emits the real handshake, proving the timeout is activity-based rather than a total wall-clock deadline.
- Add a source guard that fails if sidecar CLI tests reintroduce a raw `while (Date.now() < deadline) { await reader.read() }` handshake loop.

### Verification

- New source guard failed before replacing the existing loops because `sidecar-smoke.test.ts`, `sidecar-chaos.test.ts`, and `sidecar-contention.test.ts` did not import or call `readSidecarHandshake(...)` and still contained the raw deadline-reader shape.
- Implemented on 2026-06-18: added `packages/opencorvus/test/cli/sidecar-test-utils.ts::readSidecarHandshake(...)` and replaced the three sidecar handshake loops with that helper.
- New harness regression passed: `bun test packages/opencorvus/test/cli/sidecar-handshake-timeout.test.ts --timeout 30000`.
- Affected sidecar integration tests passed: `bun test packages/opencorvus/test/cli/sidecar-smoke.test.ts packages/opencorvus/test/cli/sidecar-chaos.test.ts packages/opencorvus/test/cli/sidecar-contention.test.ts --timeout 120000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Lorentz independently confirmed the original `sidecar-smoke.test.ts` loop could park forever on a silent open stdout stream because the Date deadline was checked only before awaiting `reader.read()`.
- Lorentz confirmed this is a test-harness bug, not a production sidecar change: `sidecar.ts` emits the canonical handshake, and the VS Code production startup manager already has a stdout inactivity watchdog.
- Lorentz also found the same raw handshake pattern in `sidecar-chaos.test.ts` and `sidecar-contention.test.ts`, matching the final shared-helper fix.

## Batch P1-AJ: BH-038 supervised LSP stdio handles must satisfy the LSP client process contract

### Findings

- BH-038 targets `packages/opencorvus/src/lsp/server.ts::spawnSupervisedStdio(...)` and `packages/opencorvus/src/lsp/client.ts::processExited(...)` / `rejectOnServerExit(...)`.
- TypeScript LSP is spawned through `ProcessSupervisor.spawnShell(...)`, then `spawnSupervisedStdio(...)` returns a plain object cast as `ChildProcessWithoutNullStreams`.
- That object only contains `pid`, `stdin`, `stdout`, `stderr`, and `kill`. It does not expose `exitCode`, `signalCode`, `once(...)`, or `off(...)`.
- `LSPClient.create(...)` treats `undefined !== null` as already exited in `processExited(...)`, so supervised TypeScript LSP can fail before initialize. If that pre-check is bypassed, `rejectOnServerExit(...)` still expects `process.once/off`.
- The root issue is a bad boundary adapter: the supervised handle must be normalized to the process contract the LSP client consumes.

### Call-point Inventory

- `packages/opencorvus/src/lsp/server.ts::spawnStdio(...)` returns normal Node child processes for most language servers.
- `packages/opencorvus/src/lsp/server.ts::spawnSupervisedStdio(...)` is used by `LSPServer.Typescript.spawn(...)` and returns the incomplete process-shaped object.
- `packages/opencorvus/src/lsp/client.ts::create(...)` constructs JSON-RPC stream reader/writer from `server.process.stdout/stdin`, sends `initialize`, reads `server.process.pid`, checks `exitCode/signalCode`, and registers `once/off` exit listeners during initialization.
- `packages/opencorvus/src/lsp/index.ts` owns LSP spawn/dispose orchestration and calls `LSPClient.create(...)`.
- `packages/opencorvus/src/shell/process-supervisor.ts::ProcessSupervisor.Handle` already exposes `exited`, `terminate()`, and `dispose()`, but not ChildProcess event methods.
- `packages/opencorvus/test/lsp/client.test.ts` already covers fake LSP interop and LSP disposal races, but not the TypeScript supervised spawn adapter.

### Fix Shape

- Normalize the `ProcessSupervisor.Handle` inside `spawnSupervisedStdio(...)` into a ChildProcess-compatible process object for LSP client use.
- The adapter must expose `exitCode` and `signalCode` as `null` while running and update them when `supervisor.exited` settles.
- The adapter must expose `once/off/on/removeListener/emit` for `"exit"` and `"error"` so `rejectOnServerExit(...)` observes early server exit without special-casing TypeScript LSP in the client.
- Keep `dispose()` delegated to the supervisor; keep `kill()` as a direct supervisor termination request.
- Do not add fallback language servers, retries, gates, or alternate TypeScript LSP startup paths.

### Regression Tests

- Extend `packages/opencorvus/test/lsp/client.test.ts`.
- Use `ProcessSupervisor.setFactoryForTest(...)` so `LSPServer.Typescript.spawn(...)` follows the production supervised path while the factory supplies a fake JSON-RPC LSP server over stdio.
- Assert `LSPClient.create({ serverID: "typescript", server: supervisedHandle, ... })` initializes successfully and `client.shutdown()` disposes the supervised handle.

### Verification

- New regression failed before implementation with `LSP server exited before initialize completed`, caused by the supervised process object's missing `exitCode` / `signalCode` fields making `processExited(...)` return true before initialize.
- Implemented on 2026-06-18: `spawnSupervisedStdio(...)` now wraps `ProcessSupervisor.Handle` with a ChildProcess-compatible adapter that exposes stdio streams, PID, `kill()`, running exit fields, and EventEmitter-style exit/error listener methods wired from `supervisor.exited`.
- Strengthened the regression to assert `client.shutdown()` calls the supervisor disposal path once.
- Focused regression passed: `bun test packages/opencorvus/test/lsp/client.test.ts -t "typescript client initializes when the server uses a supervised stdio handle" --timeout 30000`.
- Full LSP client suite passed: `bun test packages/opencorvus/test/lsp/client.test.ts --timeout 60000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Ptolemy independently confirmed the supervised TypeScript LSP handle was cast to `ChildProcessWithoutNullStreams` while missing `exitCode`, `signalCode`, `once(...)`, and `off(...)`.
- Ptolemy identified the first observable failure as `undefined !== null` in `processExited(...)`, and warned that patching only that pre-check would leave the missing event-listener contract.
- Ptolemy confirmed TypeScript is the built-in affected LSP because it goes through `spawnSupervisedStdio(...)`; most other LSPs use `spawnStdio(...)` and return real child processes.
- Ptolemy recommended boundary normalization plus a regression that asserts shutdown disposes the supervised handle; the final implementation and test use that shape.

## Batch P1-AK: BH-039 Bus dispatch must isolate synchronous subscriber failures

### Findings

- BH-039 targets `packages/opencorvus/src/bus/index.ts::dispatch(...)`.
- `dispatch(...)` already wraps returned promises with timeout and `.catch(...)`, so asynchronous subscriber rejection and timeout are observable through the bus warning log without rejecting `Bus.publish(...)`.
- The synchronous call `const result = sub(payload)` happens before that wrapper is installed. A subscriber that throws synchronously aborts the dispatch loop, skips later subscribers for the same event, and makes `Bus.publish(...)` reject.
- This violates the bus fan-out contract: one subscriber failure must not prevent remaining subscribers from seeing the event.

### Call-point Inventory

- `packages/opencorvus/src/bus/index.ts::publish(...)` builds the payload, starts `dispatch(payload)`, emits the global bridge event, and returns the dispatch promise.
- `packages/opencorvus/src/bus/index.ts::dispatch(...)` fans out to exact-type subscribers and wildcard subscribers.
- `packages/opencorvus/src/bus/index.ts::withTimeout(...)` owns async subscriber timeout handling.
- `packages/opencorvus/src/bus/index.ts::raw(...)` registers exact and wildcard callbacks.
- `packages/opencorvus/test/bus/bus.test.ts` covers subscribe/unsubscribe, wildcard subscribers, payload validation, notification metadata, and once semantics, but not synchronous subscriber failure isolation.
- Bus subscribers are broad: session status, message bridge, scheduler, executor event streams, MCP browser notifications, PTY lifecycle, and route tests all depend on a single process-global fan-out path.

### Fix Shape

- Move subscriber invocation into the same isolated promise path used for async failures.
- A synchronous throw should become a rejected promise that the existing catch logs as `subscriber timed out or failed`.
- Continue dispatching all remaining exact and wildcard subscribers.
- Keep `Bus.publish(...)` resolving with `Promise.allSettled(...)`; do not add retry, fallback subscriber paths, or a global gate.

### Regression Tests

- Extend `packages/opencorvus/test/bus/bus.test.ts`.
- Register a first subscriber that throws synchronously and a second subscriber that records the event.
- Assert `Bus.publish(...)` resolves and the second subscriber receives the event.

### Verification

- Before the BH-039 fix, the new regression failed because `Bus.publish(TestEvent, ...)` rejected when the first subscriber threw synchronously.
- While running the full bus suite, `packages/opencorvus/test/bus/bus.test.ts` exposed an existing test-chain break: `packages/opencorvus/src/server/event.ts` no longer exported `Heartbeat`, `payload(...)`, or `globalEnvelope(...)`, and `Bus.publish(...)` no longer parsed payloads before dispatch. This was restored as part of keeping the bus contract test meaningful.
- Implemented on 2026-06-18: `dispatch(...)` now catches synchronous subscriber throws and routes them through the existing timed subscriber warning path, then continues dispatching remaining subscribers.
- Focused regression passed: `bun test packages/opencorvus/test/bus/bus.test.ts -t "synchronous subscriber failure" --timeout 30000`.
- Full bus suite passed: `bun test packages/opencorvus/test/bus/bus.test.ts --timeout 60000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Bohr confirmed the root cause: the old `dispatch(...)` invoked `sub(payload)` before the timeout/error wrapper was installed, so synchronous throws escaped fan-out.
- Bohr confirmed the current fix is the minimal no-fallback shape: wrap the subscriber call in `try/catch`, convert sync throws to `Promise.reject(...)`, and reuse the existing `withTimeout(...).catch(...)` warning path.
- Bohr confirmed the regression covers the required behavior: first subscriber throws, second subscriber records the event, and `Bus.publish(...)` resolves.

## Batch P1-AL: BH-040 tool failures must not be hidden by a host circuit breaker

### Findings

- BH-040 targets `packages/opencorvus/src/util/tool-guard.ts::withCircuitBreaker(...)` and the orchestrator tool setup in `packages/opencorvus/src/orchestrator/agent.ts`.
- `toolGuard(...)` wraps every tool `execute(...)` with a per-tool consecutive failure counter. After 30 failures, it stops calling the real tool and throws a host-generated `circuit-open` message.
- That host-side circuit breaker is a gate: it replaces the next real tool result/error with guidance invented by the host, so the model and logs lose the actual failure evidence needed for root-cause repair.
- This violates the project rule that LLM tool-route problems must be solved through prompts or root-cause fixes, not host preflight gates or bypasses.

### Call-point Inventory

- `packages/opencorvus/src/orchestrator/agent.ts` imports `toolGuard`, wraps the tools returned by `createOrchestratorTools(...)`, builds the `enableMap` from `guard.tools`, and passes `guard.tools` into `SessionPrompt.setSessionRuntimeContract(...)`.
- Before this batch, `packages/opencorvus/src/util/tool-guard.ts` was the only implementation of `toolGuard(...)` and `withCircuitBreaker(...)`.
- Before this batch, full-repo TypeScript search found no tests covering `toolGuard(...)` and no other call sites for `withCircuitBreaker(...)`.

### Fix Shape

- Remove the circuit-breaker behavior from `toolGuard(...)`. It must preserve the orchestrator tool map without intercepting repeated failures.
- Remove the `withCircuitBreaker(...)` export, failure counters, `Log` dependency, and `maxFailures` option so there is no dormant gate path to reuse.
- Keep the orchestrator runtime-contract shape intact: `toolGuard(tools).tools` remains the same tool table, but tool execution is never short-circuited.
- Do not add fallback tools, retries, host guidance, alternate tool selection, or a new threshold.

### Regression Tests

- Add `packages/opencorvus/test/util/tool-guard.test.ts`.
- Build a failing tool whose `execute(...)` increments a counter and throws `original failure <n>`.
- Invoke it more than the former threshold and assert every call reaches the real tool and the observed errors remain the original failures, with no `circuit-open` replacement.

### Verification

- New regression failed before implementation: the real tool was called only 30 times and subsequent calls were replaced by the host-side circuit breaker.
- Implemented on 2026-06-18: removed `withCircuitBreaker(...)`, the failure counter, `maxFailures`, `Log` usage, and the generated circuit-open error. `toolGuard(...)` now preserves the tool-map boundary without intercepting execution.
- Focused regression passed: `bun test packages/opencorvus/test/util/tool-guard.test.ts --timeout 30000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.
- Broader optional check `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 120000` is not counted as this batch's BH-040 verification: it currently fails on unrelated missing-model-config, task ownership, and worktree marker assertions, while the focused BH-040 behavior regression passes.

### Independent Review Feedback

- Popper independently confirmed the old wrapper affected every orchestrator tool because `agent.ts` passed `guard.tools` into the runtime contract.
- Popper confirmed the final fix removes the dormant threshold path and preserves real tool errors across more than the former 30-failure threshold.
- Popper noted that the identity `toolGuard(...)` name could invite future gate logic; this batch keeps it only as a tested no-interception boundary so the behavior regression can invoke the production export directly.

## Batch P1-AM: BH-041 decision-log append failures must be visible

### Findings

- BH-041 targets `packages/opencorvus/src/decision-log/index.ts::createDecisionLog(...).append(...)`.
- `append(...)` wraps the entire `decision_log` insert in `try/catch`, then logs `decision log append failed (non-fatal)` and returns normally on any database failure.
- Decision-log entries carry cross-agent requirements, review findings, integrity feedback, and build reports. Silently losing them removes the durable context later agents rely on.
- The root issue is not caller-specific: every `createDecisionLog(taskID).append(...)` call shares this writer.

### Call-point Inventory

- `packages/opencorvus/src/decision-log/index.ts` owns the shared writer and all read projections.
- `packages/opencorvus/src/agent/runner.ts`, `engine/persist.ts`, `engine/workflow.ts`, `task-api/index.ts`, `tool/wait.ts`, `requirements/output-tools.ts`, and many `orchestrator/tools.ts` paths append durable decisions through this writer.
- `packages/opencorvus/src/decision-log/bundle.ts` and terminal state code read the same table to materialize task-scoped `decision-log.md`.
- Existing coverage in `packages/opencorvus/test/pipeline/decision-log.test.ts` validates normal append/read behavior and prompt rendering, but not insert failure visibility.
- Independent review also found caller-level catch blocks around decision-log appends in `agent/runner.ts`, `tool/wait.ts`, and several `orchestrator/tools.ts` paths; those would keep losing durable decisions even after fixing the shared writer.

### Fix Shape

- Remove the catch-and-warn behavior from `append(...)` so database insert failures propagate to the caller.
- Remove caller-level catch-and-warn wrappers around decision-log writes. The rule is shared: a failed durable decision write is visible to the current tool/agent instead of being treated as best effort.
- Keep successful logging after the insert succeeds.
- Do not add retry, fallback storage, alternate in-memory queues, or non-fatal swallowing at this shared writer.

### Regression Tests

- Extend `packages/opencorvus/test/pipeline/decision-log.test.ts`.
- Use the real `decision_log` schema and pass a runtime-invalid `null` value through a type assertion to trigger SQLite's `NOT NULL` constraint.
- Assert `append(...)` throws and no row is visible via `readByKey(...)`.
- Add a source guard scanning `packages/opencorvus/src` so production code cannot reintroduce `decision_log` append/write failure as non-fatal.

### Verification

- New regression failed before implementation: SQLite raised `NOT NULL constraint failed: decision_log.value`, but `append(...)` returned normally after logging `decision log append failed (non-fatal)`.
- Implemented on 2026-06-18: removed the shared writer catch, removed caller-level decision-log append catches in `agent/runner.ts`, `tool/wait.ts`, and `orchestrator/tools.ts`, and added a production source guard against reintroducing decision-log non-fatal swallowing.
- Decision-log suites passed: `bun test packages/opencorvus/test/pipeline/decision-log.test.ts packages/opencorvus/test/pipeline/decision-log-bundle.test.ts packages/opencorvus/test/engine/terminal-decision-log-bundle.test.ts --timeout 60000`.
- Affected tool/agent suites passed: `bun test packages/opencorvus/test/orchestrator/wait-tool.test.ts --timeout 60000`, `bun test packages/opencorvus/test/fact-check/orchestrator-tool.test.ts --timeout 60000`, `bun test packages/opencorvus/test/agent/runner-tool-scope.test.ts --timeout 60000`, and `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts --timeout 60000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Bacon confirmed the shared-writer root cause and recommended the same minimal fix: remove the `append(...)` catch and do not add retry, fallback storage, memory queues, or alternate stores.
- Bacon confirmed the real SQLite `NOT NULL` regression is stronger than mocking `Database.use(...)` because it covers the actual Drizzle/SQLite insert path.
- Bacon identified caller-level decision-log catch blocks as an extra risk. This batch removes the production caller-level decision-log swallowing found by follow-up search.

## Batch P1-AN: BH-042 aggregator metrics require every configured input to be fresh

### Findings

- BH-042 targets `packages/opencorvus/src/metrics/executor.ts::runAggregator(...)`.
- `runAggregator(...)` reads all `metric_result` rows for the target iteration, filters to configured metric IDs that are fresh, and computes the aggregate from the remaining values.
- That means an aggregate over `[a, b]` becomes fresh when only `a` has a fresh result and `b` is missing or stale.
- This incorrectly awards score credit for incomplete evidence and hides the real missing-input condition.

### Call-point Inventory

- `packages/opencorvus/src/metrics/executor.ts` is the only implementation of the aggregator evaluator and dispatches it from `evaluateSpec(...)`.
- `packages/opencorvus/src/metrics/types.ts` documents `aggregator` as composing other `metric_result` rows.
- `packages/opencorvus/test/metrics/executor.test.ts` currently covers all-fresh aggregation and zero-fresh aggregation, but not partial-fresh aggregation.

### Fix Shape

- Build an input lookup for the configured `of` metric IDs at the aggregator's target iteration.
- Treat any configured metric with no row, or only non-fresh evidence, as an incomplete aggregate.
- Return `evidence_fresh=false`, zero raw/normalized value through the existing evaluator path, and a diagnostic `evidence_ref` that identifies missing and stale inputs.
- Keep all aggregate operations unchanged when every configured input is present and fresh.
- Do not add fallback scoring, partial credit, retry, or a host gate around metric execution.

### Regression Tests

- Extend `packages/opencorvus/test/metrics/executor.test.ts`.
- Seed a previous iteration with one fresh input for a two-input aggregate and leave the second input missing.
- Execute the aggregator with `iteration_offset: -1` so current-iteration base spec execution cannot accidentally satisfy the aggregate.
- Assert the aggregate is skipped/stale with no score credit and records the missing-input reason.
- Add a sibling stale-input regression where the second configured input has a row but `evidence_fresh=false`, and assert the aggregate is still skipped/stale.

### Verification

- New missing-input regression failed before implementation: the aggregate used the lone fresh input and wrote `raw_value=0.8`.
- Implemented on 2026-06-18: `runAggregator(...)` now groups result rows by configured metric ID, requires every configured input to have a fresh result, and returns `aggregator://incomplete_inputs ...` with missing/stale IDs when the aggregate evidence is incomplete.
- Duplicate rows for the same configured input are no longer counted multiple times; the evaluator selects the latest fresh row for that input before computing the aggregate.
- Focused missing-input regression passed: `bun test packages/opencorvus/test/metrics/executor.test.ts -t "aggregator with a missing configured input" --timeout 30000`.
- Existing all-fresh aggregation path passed: `bun test packages/opencorvus/test/metrics/executor.test.ts -t "mean of named specs" --timeout 30000`.
- Metrics suites passed: `bun test packages/opencorvus/test/metrics/executor.test.ts packages/opencorvus/test/metrics/store.test.ts --timeout 60000`.
- Package typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Noether confirmed the root cause: `runAggregator(...)` filtered to present fresh rows and only checked `values.length === 0`, so partial fresh inputs were treated as complete evidence.
- Noether confirmed the score impact: `weightedMean(...)` accepts `evidence_fresh=true`, so the wrong fresh aggregate directly awarded score credit.
- Noether recommended the same fix shape: inspect each configured metric ID, return stale on any missing or stale input, keep all-fresh aggregation unchanged, and avoid partial credit, retry, fallback scoring, or host gates.
- Noether identified duplicate result rows for the same spec/iteration as a related risk. This batch uses a per-metric lookup and latest fresh row selection so repeated rows for one input do not duplicate that input's weight.

## Batch P1-AO: BH-050 VS Code native bridge requests must timeout and clear pending state

### Findings

- BH-050 targets `packages/overlay/src/services/vscode-transport.ts::createVsCodeTransport().native(...)`.
- HTTP-style bridge requests already default to `AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MILLISECONDS)` and remove their `pending` entry on abort.
- Native bridge requests post `native.request` and store `{ resolve, reject }` in `pendingNative`, but there is no timeout, abort signal, or cleanup path if the VS Code extension host never sends `native.response`.
- UI actions that call host native commands, such as workspace picking, opening paths, notification permission checks, and project editor launch, can remain pending forever after a dropped extension-host response.

### Call-point Inventory

- `packages/overlay/src/services/vscode-transport.ts` owns the only `pendingNative` map and the `native.response` dispatcher.
- `packages/overlay/src/services/host-transport.ts` owns `DEFAULT_REQUEST_TIMEOUT_MILLISECONDS` and the `HostTransport.native(...)` contract shared by overlay callers.
- Overlay callers of `getHostTransport().native(...)` include connection startup, config file writes, workspace directory picking, open path/editor commands, window commands, notifications, titlebar actions, and settings persistence.
- `packages/overlay/test/vscode-transport-ui-command.test.ts` currently covers native success, native error response, and unsupported command rejection, but not missing response cleanup.
- `packages/overlay/test/vscode-transport-decode.test.ts` already covers default timeout semantics for non-native VS Code transport requests.

### Fix Shape

- Add a timer to supported VS Code native requests using `DEFAULT_REQUEST_TIMEOUT_MILLISECONDS`.
- On timeout, remove the `pendingNative` entry and reject the promise with a visible timeout error that names the command kind.
- Clear the timer when `native.response` resolves or rejects the pending command.
- If `postMessage(...)` throws, delete the pending entry and clear the timer before rejecting the original error.
- Do not add fallback native command paths, retries, synthetic success, or UI-side gates.

### Regression Tests

- Extend `packages/overlay/test/vscode-transport-ui-command.test.ts`.
- Stub `setTimeout` / `clearTimeout` so the default native timeout can be triggered deterministically without waiting 15 seconds.
- Start a supported native command without sending `native.response`; assert it rejects with a timeout error, the timer used `DEFAULT_REQUEST_TIMEOUT_MILLISECONDS`, and a later `native.response` for the same ID is ignored.
- Keep existing native success and native error response tests green.

### Verification

- New regression failed before implementation: supported VS Code native requests created no timer, so the test observed zero scheduled timeouts.
- Implemented on 2026-06-18: supported VS Code native requests now store a timeout with the pending native command, reject with `TimeoutError` after `DEFAULT_REQUEST_TIMEOUT_MILLISECONDS`, delete the pending entry, clear the timer on response/error/timeout/post failure, and ignore late `native.response` messages.
- Focused native timeout regression passed: `bun test packages/overlay/test/vscode-transport-ui-command.test.ts -t "supported native commands timeout" --timeout 30000`.
- VS Code transport suites passed: `bun test packages/overlay/test/vscode-transport-ui-command.test.ts packages/overlay/test/vscode-transport-decode.test.ts packages/overlay/test/auth-change-stream.test.ts --timeout 60000`.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Darwin reviewed the repaired working tree and confirmed the current `pendingNative` shape stores a timer, `native.response` clears it, timeout rejects visibly, and postMessage failure cleans up pending state.
- Darwin listed runtime native callers that depend on this boundary: workspace pick/open commands, open-url/open-path helpers, notification permission/request/send, and project editor launch.
- Darwin confirmed this fix does not add fallback native paths or gates; it gives each native bridge request an explicit response timeout.

## Batch P1-AO-note: BH-049 rewind clear is already covered in current HEAD

### Findings

- BH-049 recorded an older overlay rewind-clear bug: clearing the rewind cursor referenced `clearPruneCursor` without calling it and did not rehydrate the older pruned events.
- Current HEAD no longer has a `clearPruneCursor` production reference.
- `task.rewound` with `cursorTime > 0` still prunes locally, but `cursorTime === 0` now calls `scheduleRewindClearRecovery(...)`, which invokes `recoverSelectedTaskAfterRewindClear(...)`.
- `recoverSelectedTaskAfterRewindClear(...)` hydrates the authoritative conversation before restarting the selected-task stream, and the tree writer clears local `rewindCursor` during hydrate.

### Verification

- Verified current behavior on 2026-06-18 without code changes.
- Selected-task recovery and event routing tests passed: `bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/events-refresh.test.ts --timeout 60000`.
- Bernoulli independently confirmed the current implementation no longer contains the `clearPruneCursor` production bug and identified the current recovery path from `events.ts` through `selected-task-recovery.ts`, `conversation.ts`, and `tree-writer.ts`.
- Bernoulli also confirmed the backend close loop: `clearRewindCursor(...)` emits `task.rewound` with `cursorTime: 0`, and the conversation route no longer filters the transcript when the task rewind cursor is null.

## Batch P1-AP: BH-051 session-history hydration must not write after task switch

### Findings

- BH-051 targets `packages/overlay/src/services/conversation.ts::loadConversationSessionHistory(...)`.
- Current `hydrateConversation(...)`, `continueConversationReplay(...)`, `mergeLatestConversationTail(...)`, and `loadOlderConversationHistory(...)` already use active source and epoch checks before writing to `cardTreeStore`.
- `loadConversationSessionHistory(...)` is still outside that guard discipline: it captures a task ID, awaits `task/:taskID/conversation/session/:sessionID`, and then calls `hydrateConversationView(...)` plus `replayTaskEventToTree(...)` without confirming the selected task is still the same.
- The runtime callers are build/phase card expansion and conversation agent rail history loading. Both can initiate an async session-history request while the user switches tasks.

### Call-point Inventory

- `packages/overlay/src/components/Card.tsx` calls `loadConversationSessionHistory(sessionID, taskID)` when an expanded phase card needs older build-session history.
- `packages/overlay/src/services/conversation.ts::loadConversationHistoryUntilCard(...)` calls `loadConversationSessionHistory(...)` for task conversation cards that represent a session whose message is not yet loaded.
- `packages/overlay/src/components/ConversationAgentRail.tsx` calls `loadConversationHistoryUntilCard(...)` when focusing an agent record.
- `packages/overlay/test/conversation-hydrate-replay.test.ts` owns hydration/replay/history regression tests for these code paths.

### Fix Shape

- Treat session-history hydration as a history load owned by the selected task source.
- Capture a history epoch and abort controller when `loadConversationSessionHistory(...)` starts.
- Pass the abort signal into `apiJson(...)`.
- Before the request, after the request, before each replayed event, and before returning success, assert the history epoch is current and `activeTaskID()` still equals the captured task ID.
- On superseded/foreign task completion, reject with `AbortError` before mutating the card tree.
- Do not add caller-side gates, fallback refreshes, delayed retries, or compatibility hydration paths.

### Regression Tests

- Extend `packages/overlay/test/conversation-hydrate-replay.test.ts`.
- Start `loadConversationSessionHistory(...)` for task A and delay the fake transport response.
- Switch `boardStore.selectedSource` to task B before resolving task A's response.
- Assert the stale request rejects with `AbortError` and no task A message/card appears in the current card tree.

### Verification

- New regression failed before implementation: the stale task A session-history request resolved after switching to task B.
- Implemented on 2026-06-18: `loadConversationSessionHistory(...)` now owns a history epoch and abort controller, passes its signal into `apiJson(...)`, and asserts active task/source before request, after request, before replaying each event, and before returning success.
- Focused regression passed: `bun test packages/overlay/test/conversation-hydrate-replay.test.ts -t "stale session-history response" --timeout 30000`.
- Conversation hydration suites passed: `bun test packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/selected-task-recovery.test.ts --timeout 60000`.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Volta reviewed the repaired working tree and confirmed `assertActiveSessionHistory(...)` checks the history epoch, abort signal, active task, and history source.
- Volta confirmed the fix is in the service-level async write boundary used by both direct build-phase card expansion and agent-rail history loading, rather than a caller-side UI gate.
- Volta confirmed the new regression covers the delayed old-task response after task switch and proves old task messages do not enter the current card tree.

## Batch P1-AQ: BH-059 Hexin budget response schema is discriminated

### Findings

- BH-059 targets `packages/opencorvus/src/server/routes/provider.ts::HexinBudgetResponse`.
- Current HEAD already contains the strict implementation restored by Batch P0-H: `HexinBudgetResponse` is a `z.discriminatedUnion("ok", ...)` with `{ ok: true, budget }` and `{ ok: false, error }`.
- The repair plan did not name `BH-059`, so the bug-hunt tracker still showed the issue as uncovered even though the production schema no longer permitted `{ ok: true }` without `budget` or `{ ok: false }` without `error`.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/provider.ts` owns `HexinBudgetResponse` and wires it to the `/provider/hexin/budget` OpenAPI response schema.
- `packages/opencorvus/test/server/provider-hexin-budget.test.ts` owns the Hexin budget route regression suite.
- `packages/overlay/src/services/config.ts` owns the overlay-side TypeScript contract `HexinBudgetResponse = { ok: true; budget } | { ok: false; error }`.

### Fix Shape

- Keep the existing discriminated schema; no route behavior change is required.
- Export `HexinBudgetResponse` so the route contract can be tested directly instead of relying on indirect response samples.
- Add schema assertions for both invalid shapes and both valid shapes.
- Do not add compatibility responses, caller-side checks, or fallback parsing.

### Verification

- Added regression coverage in `packages/opencorvus/test/server/provider-hexin-budget.test.ts`: `{ ok: true }` and `{ ok: false }` are rejected, while complete success and failure payloads are accepted.
- Removed stale overlay browser test fixtures that still returned invalid `{ ok: true }` for `/provider/hexin/budget`; those tests now use the valid failure shape `{ ok: false, error }`.
- Focused provider test passed: `bun test packages/opencorvus/test/server/provider-hexin-budget.test.ts --timeout 60000`.
- Typechecks passed: `bun run --cwd packages/opencorvus typecheck` and `bun run --cwd packages/overlay typecheck`.
- Static fixture check passed: `rg -n 'provider/hexin/budget.*ok: true|provider/hexin/budget"\).*\\{ ok: true \\}' packages/overlay/test packages/opencorvus/test -g '*.ts'` returned no matches.
- The affected overlay browser tests were run with the required Node runner: `node test/browser-runner.mjs test/browser/command-palette.test.ts test/browser/rewind-visual-stress.test.ts`. They did not reach a provider budget schema failure; they currently fail on BH-059-external issues: `command-palette.test.ts` reports missing i18n key `titlebar.menu.tools`, and `rewind-visual-stress.test.ts` reports the composer remaining disabled before the resume branch.

### Independent Review Feedback

- Herschel confirmed BH-059 is not present in current production code: `HexinBudgetResponse` is a `z.discriminatedUnion("ok", ...)`, `/provider/hexin/budget` binds it through `resolver(...)`, and the route only returns complete success or failure payloads.
- Herschel identified the remaining risk as test-fixture contract drift in `command-palette.test.ts` and `rewind-visual-stress.test.ts`, not a production fallback or route bug.

## Batch P1-AR: BH-060 Hexin budget tests must exercise Server.App directory middleware

### Findings

- BH-060 targets `packages/opencorvus/test/server/provider-hexin-budget.test.ts`.
- HEAD still mounted `ProviderRoutes()` directly through `new Hono().route("/provider", ProviderRoutes())` and then wrapped requests in `Instance.provide(...)`.
- That test shape bypassed the real `Server.App()` middleware that enforces `?directory=` or `x-opencorvus-directory` for project-scoped routes.
- The production route is mounted through `AppRoutes(...).route("/provider", ProviderRoutes())`, and `routeRequiresProjectDirectory(...)` does not bypass `/provider/hexin/budget`, so the route must be tested through `Server.App()`.

### Call-point Inventory

- `packages/opencorvus/src/server/server.ts` owns `Server.App()` and `DirectoryRequiredError`.
- `packages/opencorvus/src/server/routes/app.ts` mounts `/provider` under the project-scoped app routes.
- `packages/opencorvus/src/server/routes/provider.ts` owns `/provider/hexin/budget`.
- `packages/transport-protocol/src/index.ts` owns the route directory-injection policy; overlay coverage for `provider/hexin/budget` already exists in `packages/overlay/test/api-directory-injection.test.ts`.
- `packages/opencorvus/test/server/provider-hexin-budget.test.ts` is the focused route test suite.

### Fix Shape

- Delete the direct `new Hono().route("/provider", ProviderRoutes())` test helper.
- Route every budget request through `Server.App().request("/provider/hexin/budget", ...)`.
- Add a missing-directory regression that asserts 400 `DirectoryRequiredError` and no upstream fetch.
- For positive route cases, pass `x-opencorvus-directory` with a real temporary git project directory.
- Use process env restoration for the Hexin key so the real `Instance.provide(...)` bootstrapped by `Server.App()` sees the intended key snapshot.
- Do not change production middleware, add bypasses, or add compatibility route behavior.

### Verification

- Focused test passed: `bun test packages/opencorvus/test/server/provider-hexin-budget.test.ts --timeout 120000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Direct route bypass removed: `rg -n "ProviderRoutes\\(\\)|new Hono\\(" packages/opencorvus/test/server/provider-hexin-budget.test.ts` returned no matches.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Leibniz confirmed BH-060 was present in HEAD because the old test mounted `ProviderRoutes()` directly and manually wrapped `Instance.provide(...)`.
- Leibniz confirmed the candidate repair uses the correct boundary: missing `x-opencorvus-directory` returns `DirectoryRequiredError`, and present header enters the provider handler through `Server.App()`.

## Batch P1-AS: BH-069 package test entry must cover every test surface

### Findings

- BH-069 targets `packages/opencorvus/package.json::scripts.test`.
- HEAD used a hand-maintained path allowlist: `bun test --timeout 60000 test/acp test/agent ...`.
- That allowlist skipped entire direct test directories including `test/acceptance`, `test/architect`, `test/benchmark`, `test/browser-preview`, `test/channel`, `test/engine`, `test/executor`, `test/gateway`, `test/metrics`, `test/mission`, `test/orchestrator`, `test/pipeline`, `test/runtime`, `test/task-api`, `test/web-clone`, and `test/workbench`.
- It also skipped top-level tests including `test/acceptance-plan-restart-closure.test.ts`, `test/agent-report-contract.test.ts`, `test/architect-fidelity.test.ts`, `test/architect-owned-paths-overlap.test.ts`, `test/build-dispatch-fidelity-order.test.ts`, `test/emitter.test.ts`, `test/engine-goal-contract-runtime-split.test.ts`, `test/engine-goal-retry-count-derived.test.ts`, `test/prompt-loading.test.ts`, and `test/shell.test.ts`.
- The existing guard only asserted three release/script files were present, so it could not catch directory-level or top-level-file omissions.

### Call-point Inventory

- `packages/opencorvus/package.json` owns the default package test script used by package and turbo test runs.
- `packages/opencorvus/test/script/package-test-entry.test.ts` owns the regression guard for the package test entry.
- `packages/opencorvus/test/**` is the source of truth for discoverable test directories and top-level test files.

### Fix Shape

- Replace the hand-maintained allowlist with the single package test root: `bun test --timeout 60000 test`.
- Update `package-test-entry.test.ts` to discover every direct `test/*` directory containing `*.test.ts`, `*.test.tsx`, `*.test.js`, or `*.test.mjs`, plus every top-level `test/*.test.*` file.
- Assert the default package script has exactly one test entry, `test`, and that every discovered direct test entry is covered by that root.
- Do not add skip/exclude gates or a second test source. Live/e2e bodies remain controlled by their existing explicit environment-variable gates.

### Verification

- Focused guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Socrates confirmed BH-069 was present in HEAD: the default package script was a handwritten allowlist and the guard only protected the three BH-068 release/script entries.
- Socrates listed the skipped direct directories and top-level files and recommended a single real test entry plus a dynamic guard over `test/*` discoverable tests, without fallback or exclusion gates.

## Batch P1-AT: BH-071 package-local must fail when Docker Linux packaging is unavailable

### Findings

- BH-071 targets `script/package-local.ts`.
- The default local packaging flow builds the opencorvus overlay-server binaries, builds the native overlay bundle, then attempts Linux overlay targets through Docker.
- When `docker info` failed, HEAD only printed warnings and continued to the final `=== Package complete ===` summary.
- That made a release-like local package run appear successful even though the required Linux overlay artifacts were absent.

### Call-point Inventory

- Root `package.json::scripts.package:local` invokes `bun run script/package-local.ts`.
- `script/package-local.ts` owns `--skip-cli`, `--skip-linux`, `--skip-native`, and Linux Docker packaging dispatch.
- `packages/opencorvus/test/script/package-local.test.ts` covers package-local process behavior.
- `packages/opencorvus/test/script/package-test-entry.test.ts` ensures the new script test is included in the default package test suite through the `test` root entry.

### Fix Shape

- Keep `--skip-linux` as the only explicit way to skip Linux overlay packaging.
- When Linux packaging is requested and `docker info` fails, throw an error before the final package-complete summary.
- Do not add a fallback packaging path, hidden compatibility skip, or success-with-warning mode.

### Verification

- Added `packages/opencorvus/test/script/package-local.test.ts`.
- The regression runs `script/package-local.ts --skip-cli --skip-native` in a child Bun process with `PATH` restricted to an empty temporary directory, so `docker info` cannot resolve Docker while unrelated build phases are skipped.
- The test asserts a nonzero exit code, the Docker-required error text, and absence of the `=== Package complete ===` success summary.
- Focused tests passed: `bun test packages/opencorvus/test/script/package-local.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Kuhn confirmed BH-071 was present in HEAD: `docker info` failure was handled with `console.warn(...)` and package-local still reached `=== Package complete ===`.
- Kuhn confirmed the candidate repair is the minimal fail-closed boundary: throw when Docker is unavailable unless the operator explicitly passed `--skip-linux`.
- Kuhn identified a separate adjacent package-linux-binary stale-output risk; that is not included in this BH-071 batch.

## Batch P1-AU: BH-073 SDK generated output replacement must be transactional

### Findings

- BH-073 targets `packages/sdk/js/script/build.ts`.
- HEAD wrote tracked `src/gen` bootstrap stubs before OpenAPI generation, then deleted the tracked generated directory before the real SDK generation had succeeded.
- The stub write was masking a real import cycle: SDK build loads the OpenAPI generator, OpenAPI route inventory loads plugin routes, plugin code imported `@opencorvus-ai/sdk` at top level, and the SDK client imports `src/gen/*`.
- If OpenAPI generation, SDK generation, formatting, or process execution failed between those steps, the tracked generated SDK output could be left as partial stubs or removed files.

### Call-point Inventory

- `packages/sdk/js/script/build.ts` owns SDK OpenAPI and client generation.
- `packages/sdk/js/script/generation-transaction.ts` owns the generated-directory transaction helper introduced for this batch.
- `packages/sdk/js/package.json::scripts.build` invokes the SDK build script.
- `script/generate.ts` invokes the SDK build before package generation.
- `.github/workflows/typecheck.yml` and `.github/workflows/generate.yml` verify generated SDK/OpenAPI output in CI.
- `packages/opencorvus/src/server/server.ts::Server.openapi()` and `packages/opencorvus/src/server/routes/app.ts` provide the route inventory used during OpenAPI generation.
- `packages/opencorvus/src/plugin/index.ts` owned the top-level SDK import that completed the cycle.
- `packages/opencorvus/test/script/sdk-build-format-contract.test.ts`, `packages/opencorvus/test/script/sdk-build-transaction.test.ts`, and `packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts` cover the generation contract.
- `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/*`, and generated API docs must be regenerated together after route schema changes.

### Fix Shape

- Remove the plugin module's top-level SDK value import and load `createOpenCorvusClient` only inside the lazy plugin runtime path.
- Delete tracked stub writes and the pre-success `rmWithinPackage("src/gen")` step from the SDK build.
- Generate the client into owned untracked staging directory `.tmp-sdk-gen`, validate expected generated files there, then replace `src/gen` only after successful generation.
- During replacement, move the old target to an owned backup directory first and restore it if the final rename fails; remove staging and backup after completion.
- Do not add a fallback generation mode, compatibility stubs, or caller-side gates around OpenAPI generation.

### Verification

- Added `packages/opencorvus/test/script/sdk-build-transaction.test.ts`.
- The failure regression forces the staging build callback to throw after writing a partial generated file and asserts the tracked `src/gen` target remains unchanged and staging is removed.
- The success regression asserts the tracked generated directory is replaced only after staging generation succeeds.
- Updated `sdk-build-format-contract.test.ts` to assert the SDK build uses `replaceDirectoryAfterSuccessfulBuild(...)`, does not write tracked stubs, does not pre-delete `src/gen`, and the OpenAPI generation path no longer top-level imports the SDK client.
- Focused tests passed: `bun test packages/opencorvus/test/script/sdk-build-transaction.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- SDK package typecheck passed: `bun run --cwd packages/sdk/js typecheck`.
- Real SDK build passed: `bun ./packages/sdk/js/script/build.ts`.
- Staging cleanup check passed: `Test-Path packages/sdk/js/.tmp-sdk-gen; Test-Path packages/sdk/js/.tmp-sdk-gen-backup` returned `False` and `False`.
- Docs check passed: `bun run docs:check`.
- Route inventory check passed: `bun run api:routes-check`.
- Scoped typecheck passed: `bunx turbo run typecheck --filter=@opencorvus-ai/sdk --filter=opencorvus`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Halley confirmed BH-073 was present in HEAD and identified the real root cause as the SDK build -> OpenAPI route inventory -> plugin top-level SDK import -> generated SDK import cycle.
- Halley recommended fixing the cycle before removing stubs, then making `src/gen` replacement transactional through untracked staging and post-success replacement.
- Halley confirmed the required regression coverage: forced generation failure leaves tracked generated files unchanged; successful staging replaces the target; source contract forbids top-level plugin SDK imports, tracked stubs, and pre-success `src/gen` deletion.

## Batch P1-AV: BH-107 JSON-RPC executor requests must timeout on inactivity and honor abort

### Findings

- BH-107 targets `packages/opencorvus/src/executor/protocol/json-rpc.ts` and the Codex app-server startup chain in `packages/opencorvus/src/executor/codex-app-server.ts`.
- HEAD stored outbound JSON-RPC request resolvers in `pending` and settled them only when a response arrived, the stream reader failed, or the child process exited.
- A live child process that reads stdin and then stays silent leaves `initialize`, `thread/start`, `thread/resume`, `turn/start`, or `turn/interrupt` pending forever.
- `CodexAppServerExecutor.run()` and `.resume()` only passed the caller abort signal to the later event stream. Startup requests before `stream(...)` could not be unwound by managed executor abort or upstream inactivity gates.
- When startup failed before `threadStart` or `turnStart`, the previous `try/finally` began too late to guarantee `client.close()` for the spawned transport.

### Call-point Inventory

- `packages/opencorvus/src/executor/protocol/json-rpc.ts::JsonRpcLineTransport.create(...)` owns the stdio child, line reader, pending request map, event queue, and transport close path.
- `packages/opencorvus/src/executor/protocol/json-rpc.ts::request(...)` is the only outbound JSON-RPC request entry.
- `packages/opencorvus/src/executor/codex-app-server-client.ts::fromTransport(...)` maps Codex app-server methods to transport requests.
- `packages/opencorvus/src/executor/codex-app-server.ts::run(...)` sends `initialize`, `thread/start`, and `turn/start` before streaming events.
- `packages/opencorvus/src/executor/codex-app-server.ts::resume(...)` sends `initialize`, `thread/resume`, and `turn/start` before streaming events.
- `packages/opencorvus/src/executor/codex-app-server.ts::interrupt(...)` sends `turn/interrupt`; it remains protected by the transport request inactivity timeout.
- `packages/opencorvus/src/executor/bootstrap.ts::codexProvider(...)` creates the Codex app-server transport and must use the current `EngineConfig.get().activity.executor_events_idle_ms`.
- `packages/opencorvus/src/executor/managed.ts` marks the managed run failed only after the provider stream rejects; therefore the provider transport must reject instead of parking forever.
- `packages/opencorvus/test/executor/json-rpc.test.ts`, `codex-app-server.test.ts`, `managed.test.ts`, and `bootstrap.test.ts` cover the repaired boundary.

### Fix Shape

- Add required `requestIdleMs` to `JsonRpcLineTransport.create(...)`; validate it as a positive finite number.
- Use the existing `withStreamActivity(...)` inactivity primitive as the single source for JSON-RPC pending-request liveness.
- Start the request gate when the first outbound request is pending; reset it on real child stdout/stderr activity; clear it when no requests remain.
- On request inactivity, close the reader, terminate the child, reject every pending request, and wake event consumers.
- Add optional `AbortSignal` support to `transport.request(...)`; caller abort follows the same close/reject path as inactivity timeout.
- Let `CodexAppServerClientProcess.fromTransport(...)` pass request options through to every outbound startup request.
- Extend `CodexAppServerExecutor.create(...)` to accept async client factories so `bootstrap.ts` can read the current EngineConfig value before spawning the transport.
- Move the `try/finally` in `run()` and `resume()` so `client.close()` happens even when `initialize`, `threadStart`, `threadResume`, or `turnStart` fails.
- Do not add a managed-executor status gate, a wall-clock run cap, or a fallback completion path.

### Verification

- Added `json-rpc.test.ts` coverage where a child writes its PID, reads stdin, never replies, then the pending request fails after request inactivity and the child PID is no longer alive.
- Added `json-rpc.test.ts` coverage where caller abort rejects a pending request and terminates the child.
- Added `managed.test.ts` coverage where a silent Codex app-server child causes the managed run to reach `failed`, surfaces the `AbortError` / `json-rpc request` cause, and closes the child.
- Added `codex-app-server.test.ts` coverage that startup initialization failure closes the client for both run and resume.
- Added `codex-app-server.test.ts` coverage that run initialization receives the caller abort signal and closes the client after abort.
- Updated `bootstrap.test.ts` to assert `requestIdleMs` is taken from `EngineConfig.get().activity.executor_events_idle_ms`, not a default constant.
- Focused tests passed: `bun test packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/executor/codex-app-server.test.ts packages/opencorvus/test/executor/managed.test.ts packages/opencorvus/test/executor/bootstrap.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Avicenna confirmed BH-107 was still uncovered in the repair plan and traced the root cause to outbound JSON-RPC `pending` promises that only settled on response, reader error, or child exit.
- Avicenna identified two gaps in the first working-tree draft: startup requests still lacked caller abort wiring, and `bootstrap.ts` initially used `EngineConfig.defaults` instead of current project config.
- The final implementation addresses both review findings by passing `AbortSignal` through `initialize` / `threadStart` / `threadResume` / `turnStart` and by reading `EngineConfig.get()` inside the async Codex app-server client factory.

## Batch P1-AW: BH-046 browser preview evidence screenshots must be identity-bound

### Findings

- BH-046 targets `packages/overlay/src/components/BrowserPreviewPanel.tsx`.
- HEAD loaded capture screenshots as a bare object URL string through `captureImageUrl`.
- When `renderedEvidence()` changed from one evidence record to another, Solid's resource could keep the previous successful object URL visible while the new capture image request was pending or failed.
- That allowed a new evidence summary to render with a stale screenshot from a different evidence ID or viewport.
- The related GUI audit record already required browser preview evidence to stay scoped to the current task, target, and viewport; this batch closes the remaining capture-image object URL hole.

### Call-point Inventory

- `packages/overlay/src/components/BrowserPreviewPanel.tsx::renderedEvidence(...)` chooses the current persisted or freshly verified evidence record.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx::captureImage(...)` now loads capture object URLs with the evidence identity.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx::currentCaptureImage(...)` is the render-time identity check for task ID, evidence ID, and viewport ID.
- `packages/overlay/src/services/browser-preview.ts::loadTaskBrowserPreviewEvidence(...)` and `loadTaskBrowserPreviewEvidenceCaptureObjectUrl(...)` are the overlay service entrypoints.
- `packages/opencorvus/src/server/routes/browser-preview.ts` owns the persisted evidence JSON and capture PNG route.
- `packages/opencorvus/src/browser-preview/persist.ts` resolves persisted evidence artifacts and capture paths.
- `packages/overlay/test/browser-preview-panel.test.ts` owns source-contract coverage for the panel and its center workbench mounting.
- `packages/overlay/test/browser-preview-service.test.ts` owns binary error decoding for capture object URL loading.
- `packages/overlay/test/browser/browser-preview-evidence.test.ts` owns the real Playwright evidence rendering regression.
- `packages/opencorvus/test/server/browser-preview-routes.test.ts` owns backend route coverage for persisted evidence and capture PNG bytes.

### Fix Shape

- Replace the bare `captureImageUrl` resource with a `BrowserPreviewEvidenceImage` value carrying `taskID`, `evidenceID`, `viewportID`, and `url`.
- Render screenshots only through `currentCaptureImage()`, which returns an image only when its identity matches the current `renderedEvidence()`.
- Continue revoking old object URLs when resources change or the panel unmounts.
- Add `data-evidence-id` to the rendered screenshot so browser tests can prove the visible image belongs to the visible evidence.
- Extend the real browser test so desktop evidence first renders a valid screenshot, tablet evidence then returns a delayed 404 capture, and the assertion requires the tablet summary to render with no stale desktop image.
- Refresh stale static source-contract assertions for the center workbench selection path: current code uses `selectedCenterWorkbenchPanel(...)` and `focusTaskPanel()` instead of the retired `selectedRightActivity()` and inline task reset assertion. This is test maintenance required to run the BH-046 contract test, not a product behavior change.
- Do not add a fallback screenshot, retry gate, compatibility image cache, or second service-side state source.

### Verification

- Focused overlay tests passed: `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-service.test.ts --timeout 60000`.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Real browser regression passed with the required Node runner: `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts`.
- Backend evidence route regression passed: `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts --timeout 60000`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Pasteur confirmed BH-046 had no independent repair-plan batch before this entry.
- Pasteur confirmed the root cause: the previous panel stored a capture image as a bare blob URL, so a new evidence summary could keep rendering an old screenshot while the new capture load was pending or failed.
- Pasteur agreed with the fix boundary: bind the object URL to task ID, evidence ID, and viewport ID inside `BrowserPreviewPanel.tsx`; keep the service and backend as the single source for evidence records and capture bytes; avoid fallback, gate, compatibility, or local preview-source paths.

## Batch P1-AX: BH-047 browser preview target selection failures must clear pending state

### Findings

- BH-047 targets `packages/overlay/src/components/BrowserPreviewPanel.tsx`.
- HEAD set `pendingSelectedTargetID` before calling `selectTaskBrowserPreviewTarget(...)`.
- The pending state cleared only when the target resource later resolved to the pending ID.
- If the `PUT /task/:taskID/browser-preview/target` request failed, no resource could resolve to that pending ID, so `currentTarget()` stayed hidden and `targetTransitionPending()` kept the panel in loading.
- The failed PUT is an action-scoped error, not a backend target-resolution fallback; it must be visible without changing the persisted selected target authority.

### Call-point Inventory

- `packages/overlay/src/components/BrowserPreviewPanel.tsx::selectCandidate(...)` owns candidate selection action state.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx::pendingSelectedTargetID` blocks old target rendering while a candidate selection is in flight.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx::currentTarget(...)` hides the currently loaded target when it does not match the pending ID.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx::targetTransitionPending(...)` drives loading state while the selected target transition is pending.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx::currentTargetError(...)` now includes action-scoped selection errors.
- `packages/overlay/src/services/browser-preview.ts::selectTaskBrowserPreviewTarget(...)` remains the single overlay service entrypoint for backend target promotion.
- `packages/opencorvus/src/server/routes/browser-preview.ts::PUT /task/:taskID/browser-preview/target` remains the backend authority; this batch does not change routes or target persistence.
- `packages/overlay/test/browser-preview-panel.test.ts`, `packages/overlay/test/browser-preview-service.test.ts`, and `packages/overlay/test/browser/browser-preview-evidence.test.ts` cover the repaired boundary.

### Fix Shape

- Add `targetSelectionError` as local action state in `BrowserPreviewPanel`.
- Clear selection errors on new selection, refresh, task change, and directory change.
- On selection PUT failure, if the pending ID still matches that candidate, store the error message and clear `pendingSelectedTargetID`.
- Make target error rendering outrank loading and stale evidence so the user sees the failed selection instead of an indefinite spinner.
- Keep successful selection behavior unchanged: a successful PUT still triggers the target refetch and clears pending only when the backend-selected target ID is observed.
- Do not switch to another candidate, infer a URL, retry automatically, alter backend routes, or add a compatibility target source.

### Verification

- Focused overlay tests passed: `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-service.test.ts --timeout 60000`.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Real browser regression passed with the required Node runner: `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Goodall confirmed BH-047 was still present in current HEAD before the local repair.
- Goodall traced the root cause to `selectCandidate()` setting `pendingSelectedTargetID` without a failure path, while the only cleanup path required a later target resource with the pending ID.
- Goodall recommended keeping the backend target authority untouched and repairing only overlay action state plus browser/static/service tests; the final implementation follows that boundary.

## Batch P1-AY: BH-048 rewind POST failures must be visible and must not prune locally

### Findings

- BH-048 targets `packages/overlay/src/components/Card.tsx`, `packages/overlay/src/components/ChatBubble.tsx`, and the shared rewind header action hook.
- Current HEAD no longer had the older optimistic `pruneCardsAfterCursor(...)` call in `Card.tsx` / `ChatBubble.tsx`; authoritative pruning is already driven by backend `task.rewound` events in `packages/overlay/src/services/events.ts`.
- The remaining P1 bug was still substantive: both card surfaces submitted `POST /task/:taskID/rewind`, then swallowed non-2xx and thrown request errors with `console.error(...)`.
- `useCardHeadActions(...)` only cleared its pending flag in `finally`, so a 500 response produced no visible UI error. The failed rewind left the timeline unmodified only because the fixture did not emit `task.rewound`, not because the UI had an explicit failure path.
- Running the required visual benchmark exposed two real blockers from the earlier BH-059 note: missing `titlebar.menu.tools` caused `MissingI18nKeyError` console noise, and initial restored task selection left `primaryCenterPanel()` on Mission, which made the task composer look unavailable even with a selected task, directory, connection, and model.

### Call-point Inventory

- `packages/overlay/src/components/Card.tsx::onRewind(...)` is the store-card rewind submitter.
- `packages/overlay/src/components/ChatBubble.tsx::onRewind(...)` is the chat-bubble rewind submitter.
- `packages/overlay/src/hooks/use-card-head-actions.ts::onRewind(...)` owns confirmation, pending state, and now visible failure reporting.
- `packages/overlay/src/services/rewind.ts::submitTaskRewind(...)` is the single overlay rewind POST entrypoint.
- `packages/overlay/src/services/api.ts::apiRequest(...)` remains the HostTransport-aware request path that injects the active project directory.
- `packages/overlay/src/services/events.ts` consumes backend `task.rewound` and is still the only local card-tree prune trigger.
- `packages/overlay/src/main.tsx::focusInitialRestoredTaskWorkspace(...)` repairs the visual benchmark blocker where restored task state did not focus the task center surface.
- `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` reads `titlebar.menu.tools`; both locale catalogs must carry the key.
- `packages/overlay/test/rewind-service.test.ts`, `packages/overlay/test/use-card-head-actions.test.ts`, `packages/overlay/test/browser/rewind-visual-stress.test.ts`, `packages/overlay/test/mission-launcher-component.test.ts`, and `packages/overlay/test/titlebar-compaction-threshold.test.ts` cover the repaired boundary.

### Fix Shape

- Move the duplicated rewind POST body into `submitTaskRewind(...)`.
- Throw `RewindRequestError` on non-2xx responses, preserving status, path, and response body for details.
- Let `Card.tsx` and `ChatBubble.tsx` await the shared service and propagate failure to the hook.
- Catch rewind failures in `useCardHeadActions(...)` and show a persistent `notifyError(...)` with localized title/message and formatted backend details.
- Keep failed rewind recovery explicit: do not refresh the conversation, infer a cursor, clear a cursor, or prune local cards after a failed POST.
- Add the missing `titlebar.menu.tools` key in `en-US` and `zh-CN` to remove unrelated runtime i18n errors from the visual loop.
- On first successful init only, if a task was restored, focus the Tasks left activity and task center workbench so the restored task composer is not masked by Mission ledger state. Do not bind task selection to a global source-watching effect and do not run this on reconnect.
- Update the browser stress test to reject console-only rewind recovery, require the visible failed-rewind notification, and assert the restored task composer is truly task-bound before resume.

### Verification

- Focused overlay tests passed: `bun test packages/overlay/test/use-card-head-actions.test.ts packages/overlay/test/rewind-service.test.ts packages/overlay/test/store-card-tree-prune.test.ts packages/overlay/test/events-refresh.test.ts packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/titlebar-compaction-threshold.test.ts --timeout 60000`.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Real browser visual stress passed with the required Node runner: `cd packages/overlay; node test/browser-runner.mjs test/browser/rewind-visual-stress.test.ts`.
- Visual screenshots inspected:
  - `packages/overlay/.scratch/rewind-visual-stress/04-failed-rewind.png` shows the timeline tail still visible with a persistent "Rewind failed" notification.
  - `packages/overlay/.scratch/rewind-visual-stress/07-resume-branch.png` shows the new resume branch after rewind, with the old final tail absent.
  - `packages/overlay/.scratch/rewind-visual-stress/08-rapid-clear.png` shows the full tail restored after rapid rewind and clear.
- `packages/overlay/.scratch/rewind-visual-stress/progress.log` no longer contains the previous `MissingI18nKeyError`; the only allowed console error is the browser resource error for the fixture's intentional 503 response.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Sagan confirmed BH-048 was not fixed in committed HEAD: `Card.tsx` and `ChatBubble.tsx` still swallowed rewind failures with console-only logging, while `use-card-head-actions.ts` had no visible failure path.
- Sagan also confirmed the optimistic prune half was already gone from HEAD, so the right repair was not another card-tree patch but a single rewind submitter plus visible failure propagation.
- Lagrange confirmed the browser benchmark blocker was a real restored-task UI binding bug: `restoreInitialWorkspace()` selected the task, but `main.tsx` still defaulted `primaryCenterPanel()` to Mission, causing `missionLedgerActive()` to disable the composer.
- Lagrange confirmed `titlebar.menu.tools` was a real missing runtime locale key and recommended the focused static/browser tests now included in this batch.

## Batch P1-AZ: BH-084 executor model PATCH must require a JSON model body

### Findings

- BH-084 targets `packages/opencorvus/src/server/routes/executor.ts` and the generated SDK contract in `packages/sdk/openapi.json` plus `packages/sdk/js/src/gen`.
- HEAD still handled `PATCH /executor/:executorID/model` by calling `c.req.json<{ model?: string }>()` directly, then treating every non-string or missing `model` field as an empty string.
- For `codex` and `claude-code`, that path called `setModelOverride(executorID, null)` and cleared `OPENCORVUS_EXECUTOR_CODEX_MODEL` or `OPENCORVUS_EXECUTOR_CLAUDE_MODEL` while returning 200.
- The route also lacked a JSON validator, so OpenAPI did not expose a required request body and the generated SDK exposed `ExecutorSetModelData.body?: never`.
- The existing native-model design record explicitly keeps validation centralized in `setModelOverride`; this batch preserves that by validating only the body shape at the route boundary and leaving native model value validation in `runtime-env.ts`.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/app.ts` mounts `ExecutorRoutes()` at `/executor`.
- `packages/opencorvus/src/server/routes/executor.ts::PATCH /:executorID/model` is the only production caller of `setModelOverride(...)`.
- `packages/opencorvus/src/server/routes/executor.ts::GET /:executorID/model` and executor list rows call `getModelOverride(...)`.
- `packages/opencorvus/src/executor/runtime-env.ts` maps executor IDs to `OPENCORVUS_EXECUTOR_CODEX_MODEL` and `OPENCORVUS_EXECUTOR_CLAUDE_MODEL`; it trims values, clears empty strings, and rejects OpenCorvus provider/model refs for external executors.
- `packages/overlay/src/components/ExecutorSelector.tsx::pickExternalModel(...)` calls `packages/overlay/src/services/executor.ts::setExecutorModel(...)`, which sends the overlay model picker value to this PATCH route.
- SDK generation flows through `packages/opencorvus/src/server/server.ts::openapi()`, `packages/opencorvus/src/cli/cmd/generate.ts::generateOpenApiSpec()`, `packages/opencorvus/script/generate-openapi.ts`, and `packages/sdk/js/script/build.ts`.
- `packages/opencorvus/test/server/executor-routes.test.ts` previously covered only `GET /executor`; `packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts` already carried static generated-SDK contract checks for browser preview request bodies.

### Fix Shape

- Add one route-local Zod schema, `ExecutorSetModelInput`, requiring `model: string` and rejecting unknown JSON properties.
- Add `validator("json", ExecutorSetModelInput)` to `PATCH /:executorID/model` and read the body through `c.req.valid("json")`.
- Keep empty string as the explicit clear operation: `body.model.trim() || null` still clears the executor model override.
- Add the generic 400 response documentation through the existing `errors(400)` helper.
- Do not add fallback parsing, model-name compatibility translation, a route gate, or a parallel SDK schema.
- Let `Server.openapi()` and `packages/sdk/js/script/build.ts` regenerate the OpenAPI and SDK from the validator-owned schema; the generated SDK now exposes required `model: string` and maps it into the JSON body.

### Verification

- Added route regressions in `packages/opencorvus/test/server/executor-routes.test.ts`: `{ model: 42 }` and `{}` return 400 and leave the existing Codex model env unchanged; valid string bodies update the env; empty string still clears it; a valid body for unsupported `opencorvus` still returns 404.
- Added live OpenAPI regression in `packages/opencorvus/test/server/executor-routes.test.ts`: `/executor/{executorID}/model` PATCH has `requestBody.required === true`, `model` is a string, and `required` contains `model`.
- Added generated SDK contract regression in `packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts`: tracked OpenAPI requires the body, `ExecutorSetModelData` contains required `body.model`, and `OpenCorvusClient.executor.setModel(...)` requires a flat `model: string` parameter mapped into the request body.
- Regenerated SDK/OpenAPI with `bun run --cwd packages/sdk/js build`.
- Focused tests passed: `bun test packages/opencorvus/test/executor/runtime-env.test.ts packages/opencorvus/test/server/executor-routes.test.ts packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Banach confirmed BH-084 was still present in HEAD before the local repair: malformed JSON object bodies could return 200 and clear executor model env state, while generated SDK still had `body?: never`.
- Banach found no existing PATCH route coverage and identified the existing static SDK contract test as the right place to add generated-client assertions.
- Banach recommended the same minimal boundary used here: one Zod schema, `validator("json", ...)`, `c.req.valid("json")`, `errors(400)`, SDK regeneration from OpenAPI, and no fallback, gate, compatibility shim, or hand-edited generated contract.

## Batch P1-BA: BH-100 visual evidence project directory must use Instance context

### Findings

- BH-100 targets `packages/opencorvus/src/frontend-design/tools/webpage-render.ts`, `packages/opencorvus/src/frontend-design/tools/webpage-evaluate.ts`, and `packages/opencorvus/src/frontend-design/tools/webpage-vision-judge.ts`.
- HEAD wrote `projectDirectory: process.cwd()` into `render-result.json` and passed `process.cwd()` to `tryMaterializeVisualEvidenceBundle(...)`.
- In sidecar/server runs, the process working directory can differ from the active task workspace. That made the `VisualEvidenceBundle.rendered.projectDirectory` provenance point QA and integrity consumers at the wrong project.
- The visual fidelity evidence chain design record defines `VisualEvidenceBundle.rendered.projectDirectory` as part of the single structured evidence contract for rendered provenance. This batch keeps that contract task-scoped through `Instance.directory`.

### Call-point Inventory

- `packages/opencorvus/src/frontend-design/tools/webpage-render.ts::WebpageRenderTool` writes `render-result.json` and is the only source of render-time `projectDirectory` metadata.
- `packages/opencorvus/src/frontend-design/tools/webpage-evaluate.ts::WebpageEvaluateTool` can materialize a `VisualEvidenceBundle` after numeric comparison artifacts exist.
- `packages/opencorvus/src/frontend-design/tools/webpage-vision-judge.ts::WebpageVisionJudgeTool` can materialize a `VisualEvidenceBundle` after qualitative verdict artifacts exist.
- `packages/opencorvus/src/frontend-design/tools/visual-evidence-bundle.ts::tryMaterializeVisualEvidenceBundle(...)` is the single bundle serializer and intentionally receives `projectDirectory` from the tool caller instead of trusting stale render metadata.
- `packages/opencorvus/test/frontend-design/webpage-evidence-architecture.test.ts` owns static architecture guards for the visual evidence tool wiring.
- `packages/opencorvus/test/frontend-design/tools/visual-evidence-bundle.test.ts` covers the normal bundle materializer contract.

### Fix Shape

- Import `Instance` in all three webpage evidence tools.
- Write `render-result.json.projectDirectory` from `Instance.directory`.
- Pass `Instance.directory` to `tryMaterializeVisualEvidenceBundle(...)` from evaluate and vision judge.
- Keep `tryMaterializeVisualEvidenceBundle(...)` as the single serializer and do not add a second provenance source, cwd fallback, sidecar-specific branch, gate, or compatibility path.
- Add a focused materializer regression proving the supplied project directory wins over stale `render-result.json` metadata.
- Add a source architecture guard proving all three tools use `Instance.directory` and no longer contain `projectDirectory: process.cwd()`.

### Verification

- Focused tests passed: `bun test packages/opencorvus/test/frontend-design/tools/webpage-evidence-project-directory.test.ts packages/opencorvus/test/frontend-design/webpage-evidence-architecture.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Euler confirmed BH-100 was still present in committed HEAD before this local repair: all three webpage evidence tools used `process.cwd()` for visual evidence provenance.
- Euler identified `specs/new-arch/2026-06-08-visual-fidelity-evidence-chain.md` as the relevant design record and confirmed `VisualEvidenceBundle.rendered.projectDirectory` is part of the single structured visual evidence contract.
- Euler recommended binding the three tool entrypoints to `Instance.directory`, retaining `tryMaterializeVisualEvidenceBundle(...)` as the serializer boundary, and avoiding fallback or parallel metadata sources.

## Batch P1-BB: BH-098 global config patches must refresh active project runtime state

### Findings

- BH-098 targets `packages/opencorvus/src/server/routes/global.ts::PATCH /global/config` and `packages/opencorvus/src/config/config.ts::Config.updateGlobal(...)`.
- `Config.updateGlobal(...)` writes the global config file and resets only `Config.global`.
- `Config.get()` is backed by `Config.state`, a `lazyInstanceState(...)` value keyed by active project directory. Existing project instances therefore keep serving a stale merged config after the global file changes.
- `Provider` and `Agent` each build their own `lazyInstanceState(...)` from `Config.get()`, so they can continue exposing stale provider and agent settings even after a later config read is corrected.
- `ChannelSupervisor` keeps per-instance runtime state and derives its desired runtime signature from the merged config plus `Instance.directory`. A global config change that enables, disables, or edits channel settings must be applied to every active project instance without disposing those instances.
- Project-scoped `PATCH /config` already shows the intended refresh boundary for one project: reset provider and agent state, then synchronize the channel runtime from the freshly loaded config.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/global.ts::PATCH /config` is a control-plane route and is mounted before the project-directory middleware, so it has no single current project instance.
- `packages/opencorvus/src/config/config.ts::Config.global` caches the global user config file.
- `packages/opencorvus/src/config/config.ts::Config.state` caches merged config per active `Instance.directory`.
- `packages/opencorvus/src/config/config.ts::Config.update(...)` resets the current project config state after project config writes; this batch must extend the global write path, not replace project writes.
- `packages/opencorvus/src/skill/manager.ts::patchGlobal(...)` also calls `Config.updateGlobal(...)`, so global runtime invalidation must live in the update API rather than only in the HTTP route.
- `packages/opencorvus/src/provider/provider.ts::Provider.resetAll()` clears provider state for all active instances.
- `packages/opencorvus/src/agent/agent.ts::Agent.resetAll()` clears agent state for all active instances.
- `packages/opencorvus/src/channel/supervisor.ts::ChannelSupervisor.sync(...)` updates the managed channel runtime for the active instance from a provided config.
- `packages/opencorvus/src/project/instance.ts` owns the active instance cache; global config refresh needs an explicit active-instance traversal helper rather than `Instance.disposeAll()`.
- `packages/opencorvus/test/server/config-routes.test.ts` and `packages/opencorvus/test/server/config-patch-provider.test.ts` cover project config routes but do not cover global config cache invalidation.

### Fix Shape

- Add an `Instance.forEachActive(...)` helper that runs a callback inside every currently cached active instance context.
- After writing the global config file inside `Config.updateGlobal(...)`, reset `Config.global`, every cached project `Config.state`, all provider state, and all agent state.
- In the same `Config.updateGlobal(...)` path, call `ChannelSupervisor.sync(await Config.get())` inside every active instance through `Instance.forEachActive(...)`.
- Keep `PATCH /global/config` as a thin caller of `Config.updateGlobal(...)` so `skill/manager.ts` and any future global config writes share the same invalidation path.
- Do not call `Instance.disposeAll()`, kill executor sessions, infer a project directory from the process working directory, add a route gate, or introduce a second config source.
- Do not swallow channel synchronization failures in the global write path; BH-099 tracks the separate issue that existing project config patch hides channel runtime startup failures.

### Regression Tests

- Add `packages/opencorvus/test/server/global-config-routes.test.ts`.
- Prime an active project with `/config`, `Provider.list()`, and `Agent.get("build")`, then patch `/global/config` and assert the same active project observes the new global username, provider, and build-agent description without disposing the instance.
- Add a source-level guard proving `Config.updateGlobal(...)` owns active runtime invalidation through `state.resetAll()`, `Provider.resetAll()`, `Agent.resetAll()`, `Instance.forEachActive(...)`, and `ChannelSupervisor.sync(...)`.

### Verification

- Focused test passed: `bun test packages/opencorvus/test/server/global-config-routes.test.ts --timeout 60000`.
- Related config route tests passed: `bun test packages/opencorvus/test/server/global-config-routes.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/config-patch-provider.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Carver confirmed BH-098 was still substantive in HEAD `39ab900d97`: after priming `Config.get()`, `Config.updateGlobal({ username: "new-global" })` changed direct global reads while the same active instance still returned the old merged username.
- Carver identified the single-source requirement missed by the first draft: `Config.updateGlobal(...)` is also called by `packages/opencorvus/src/skill/manager.ts`, so Provider/Agent/channel invalidation cannot live only in `PATCH /global/config`.
- Carver also flagged that channel sync failures must not be hidden by copying the project `/config` route's `catch` block; this batch lets global update errors propagate visibly.

## Batch P1-BC: BH-099 channel runtime startup failures must fail config writes visibly

### Findings

- BH-099 targets `packages/opencorvus/src/channel/supervisor.ts::syncRuntime(...)` and `packages/opencorvus/src/server/routes/config.ts::PATCH /config`.
- `ChannelSupervisor.sync(...)` calls `syncRuntime(...)`, and `syncRuntime(...)` catches every runtime startup failure, stores `status: "error"`, logs the failure, and returns a snapshot.
- `PATCH /config` then calls `ChannelSupervisor.sync(updated).catch(...)`. Because `sync(...)` does not throw on startup failure, the catch does not run and the route returns a successful config response while the runtime is in error state.
- The same hidden-failure boundary also affects `ChannelSupervisor.restart(...)` and the global config refresh path added for BH-098 because both consume `ChannelSupervisor.sync(...)` / `restart(...)` as if thrown errors are the failure signal.

### Call-point Inventory

- `packages/opencorvus/src/channel/supervisor.ts::sync(...)` is the config-driven runtime reconciliation entrypoint.
- `packages/opencorvus/src/channel/supervisor.ts::restart(...)` is the explicit user restart entrypoint behind `POST /channel/runtime/restart`.
- `packages/opencorvus/src/channel/supervisor.ts::syncRuntime(...)` owns stopping the previous runtime, setting the next signature, starting the in-process runtime, and currently swallowing startup errors.
- `packages/opencorvus/src/server/routes/config.ts::PATCH /config` updates project config, resets provider and agent state, and syncs the channel runtime.
- `packages/opencorvus/src/config/config.ts::Config.updateGlobal(...)` syncs active channel runtimes after global config writes.
- `packages/opencorvus/src/project/bootstrap.ts::InstanceBootstrap()` calls `ChannelSupervisor.sync(await Config.get())` and currently catches bootstrap-time failures so project bootstrap itself remains available.
- `packages/opencorvus/src/server/routes/channel.ts::POST /channel/runtime/restart` returns the result of `ChannelSupervisor.restart(...)`.
- `packages/opencorvus/test/channel/supervisor-env.test.ts` already mocks the channel-runtime import chain without starting real adapters.
- `packages/opencorvus/test/channel/routes.test.ts` covers channel runtime routes but not startup failure behavior.

### Fix Shape

- Add a structured `ChannelRuntimeStartError` in `channel/supervisor.ts` carrying the visible message, detail, and channel IDs.
- In `syncRuntime(...)`, keep storing `status: "error"` and `detail` before throwing `ChannelRuntimeStartError`, so `/channel/runtime` can still report the last failure.
- Remove the hidden catch from project `PATCH /config`; channel startup failure must propagate through the normal server error handler.
- Let `Config.updateGlobal(...)` and `POST /channel/runtime/restart` share the same thrown failure behavior without route-specific gates.
- Do not add retries, fallback disabled state, config rollback, route allowlists, or a second runtime status source.

### Regression Tests

- Extend `packages/opencorvus/test/channel/supervisor-env.test.ts` so the fake runtime `start()` throws after a valid Slack config.
- Assert `PATCH /config` returns a structured `ChannelRuntimeStartError` response and does not return a successful config payload.
- Assert `/channel/runtime` still reports `status: "error"` and the same failure detail after the failed config patch.
- Assert `ChannelSupervisor.sync(...)` rejects directly on startup failure while preserving the error status snapshot.

### Verification

- Focused channel tests passed: `bun test packages/opencorvus/test/channel/supervisor-env.test.ts packages/opencorvus/test/channel/routes.test.ts --timeout 60000`.
- Related config/global route tests passed: `bun test packages/opencorvus/test/channel/supervisor-env.test.ts packages/opencorvus/test/channel/routes.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/global-config-routes.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Popper confirmed BH-099 was still substantive in committed HEAD `7d8d8ce649`: `syncRuntime()` caught startup errors and did not rethrow, while `PATCH /config` swallowed thrown sync errors and always returned the config payload.
- Popper confirmed the two-signal root cause: supervisor encoded startup failure as normal data (`status: "error"`) while the config route treated only thrown exceptions as failure.
- Popper recommended the same final boundary used here: preserve supervisor error status for `/channel/runtime`, throw structured `ChannelRuntimeStartError` from `sync()` / `restart()` startup failures, remove the project `/config` catch, and avoid retry, fallback disabled state, rollback, route gate, or second status source.

## Batch P1-BD: BH-106 edit create-file path must not overwrite existing files

### Findings

- BH-106 targets `packages/opencorvus/src/tool/edit.ts::EditTool.execute(...)`.
- `EditTool` treats `oldString === ""` as a create-file path, but HEAD first checks `Filesystem.exists(filePath)` only to choose watcher event type and then writes through `Filesystem.write(...)`.
- That branch never calls `FileTime.assert(...)`, prompts permission with an add-only diff from empty content, and overwrites existing files while reporting the operation as a create.
- The adjacent `apply_patch` Add File repair already defines the single-source create-file semantics: `Patch.assertAddFileTargetDoesNotExist(...)` rejects existing targets before permission metadata, and the actual write uses `flag: "wx"` so an interleaving create cannot be overwritten after permission approval.

### Call-point Inventory

- `packages/opencorvus/src/tool/edit.ts::EditTool.execute(...)` is the direct tool path for string edits and create-file requests through empty `oldString`.
- `packages/opencorvus/src/tool/apply_patch.ts::ApplyPatchTool.execute(...)` handles patch Add File hunks and already uses `Patch.assertAddFileTargetDoesNotExist(...)` plus exclusive create writes.
- `packages/opencorvus/src/patch/index.ts::Patch.assertAddFileTargetDoesNotExist(...)` is the existing Add File target-existence verifier used by apply_patch parsing/apply flows.
- `packages/opencorvus/src/file/time.ts::FileTime.assert(...)` protects overwrite edits that modify an existing file after a read; a create-file path should reject existing targets instead of treating them as stale-write candidates.
- `packages/opencorvus/test/tool/edit.test.ts` already covers create-file behavior, existing-file edits, FileTime failures, watcher events, and concurrent edits.
- `packages/opencorvus/test/tool/apply_patch.test.ts` covers the sibling Add File no-overwrite behavior and remains the reference for create-only semantics.

### Fix Shape

- Import `fs/promises` and `Patch` into `edit.ts`.
- In the `oldString === ""` branch, call `Patch.assertAddFileTargetDoesNotExist(filePath)` before constructing permission metadata.
- Keep the permission prompt's add-only diff only after the target has been proven absent.
- Create parent directories and write the file with `{ flag: "wx" }` instead of `Filesystem.write(...)`.
- Publish only an `add` watcher event for that branch, because existing targets are no longer legal create-file targets.
- Do not add an update fallback, compatibility path, retry, route gate, or alternate create-file verifier.

### Regression Tests

- Extend `packages/opencorvus/test/tool/edit.test.ts`.
- Assert existing file plus `oldString: ""` rejects with the shared Add File target-exists error, does not call `ctx.ask(...)`, and preserves original file content.
- Assert a target created while `ctx.ask(...)` is pending makes the exclusive create write fail and preserves the interloper content.
- Preserve the existing successful create-file and nested-directory create coverage.
- Assert the create-file path emits only an `add` watcher event.
- Add a source-level guard that the edit create path uses `Patch.assertAddFileTargetDoesNotExist(...)` and an exclusive `flag: "wx"` write, matching apply_patch Add File semantics.

### Verification

- Focused tool tests passed: `bun test packages/opencorvus/test/tool/edit.test.ts packages/opencorvus/test/tool/apply_patch.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Dirac confirmed BH-106 was still substantive in committed HEAD `3468fffb5b0ed4a347dacd9c5678491b4015e2ec`: `oldString === ""` used `Filesystem.exists(...)` only for watcher event selection, skipped `FileTime.assert(...)`, prompted with an add-only diff, and overwrote through `Filesystem.write(...)`.
- Dirac identified the same single-source repair boundary: use `Patch.assertAddFileTargetDoesNotExist(...)`, write with `flag: "wx"`, publish only `add`, and avoid update fallbacks, retries, gates, or compatibility paths.
- Dirac added the required race regression where the file is absent during validation but appears during permission; the final test suite covers that interleaving.

## Batch P1-BE: BH-070 Windows CLI archives must use the installer-compatible binary name

### Findings

- BH-070 targets `install:343` and `script/check-release-assets.ts::cli`.
- `install` detects Windows and downloads `opencorvus-windows-*.zip`, but `download_and_install()` unconditionally moves `$tmp_dir/opencorvus` into the install directory.
- `script/check-release-assets.ts` accepts either `opencorvus` or `opencorvus.exe` for every CLI platform through `/^opencorvus(\.exe)?$/`, so a Windows release directory with only `opencorvus.exe` passes validation while the installer fails after unzip.
- `packages/opencorvus/script/build.ts` and `packages/opencorvus/script/build.local.ts` still set the Bun compile output to `dist/${name}/opencorvus` for every target, so the producer, validator, and installer do not share one platform binary-name contract.

### Call-point Inventory

- `install` owns downloaded archive selection, extraction, and final install path under `$HOME/.opencorvus/bin`.
- `script/check-release-assets.ts` validates release CLI platform directories before upload.
- `.github/workflows/build.yml::Package CLI archive` zips/tars the contents of each `packages/opencorvus/dist/opencorvus-*` directory as the archive root consumed by `install`.
- `packages/opencorvus/script/build.ts` produces release CLI and overlay-server artifact directories.
- `packages/opencorvus/script/build.local.ts` produces local package artifact directories.
- `packages/opencorvus/script/build-artifact.ts` already owns artifact naming helpers for package base names and bundled Node runtime executable names.
- `packages/opencorvus/test/script/check-release-assets.test.ts` covers CLI validator behavior.
- `packages/opencorvus/test/script/build-artifact.test.ts` covers build artifact naming and build-script source contracts.

### Fix Shape

- Add `artifactExecutableName(targetOS)` to `packages/opencorvus/script/build-artifact.ts`, returning `opencorvus.exe` for `win32` / `windows` and `opencorvus` for other platforms.
- Use that helper in both build scripts for the Bun compile `outfile`.
- Use the same helper in `script/check-release-assets.ts` so the validator requires exactly the platform binary name instead of accepting both names everywhere.
- In `install`, derive `installed_binary_name` from detected `os`, move `$tmp_dir/$installed_binary_name` into `$INSTALL_DIR/$installed_binary_name`, and copy local `--binary` installs to the same platform path.
- Do not add a fallback that tries both `opencorvus` and `opencorvus.exe`; a mismatched archive should fail visibly.

### Regression Tests

- Add an install-script regression that runs `install --version ... --no-modify-path` through Git Bash / bash with fake `uname`, `curl`, and `powershell.exe`, downloads a real zip containing only `opencorvus.exe`, and asserts the install succeeds with `$HOME/.opencorvus/bin/opencorvus.exe`.
- Extend `check-release-assets.test.ts` so Windows CLI validation passes with only `opencorvus.exe`, fails with only extensionless `opencorvus`, and Linux validation fails with only `opencorvus.exe`.
- Extend `build-artifact.test.ts` to assert `artifactExecutableName(...)` and both build scripts use that helper for `outfile`.

### Verification

- Focused package tests passed: `bun test packages/opencorvus/test/script/install-script.test.ts packages/opencorvus/test/script/check-release-assets.test.ts packages/opencorvus/test/script/build-artifact.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Adjacent npm wrapper test passed: `bun test packages/opencorvus/test/script/published-package-bin.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Bohr found that the exact Windows Git Bash install failure described in BH-070 no longer reproduced in HEAD `199521d6af9ee073d100a6b346557dcbffcecc45`, because Git Bash can resolve `opencorvus.exe` through a bare `opencorvus` command.
- Bohr confirmed the substantive remaining bug is the release executable-name contract gap: `install` hardcoded `opencorvus`, release validation accepted either `opencorvus` or `opencorvus.exe` for every platform, and build scripts emitted extensionless `opencorvus` even for Windows targets.
- Bohr confirmed the same no-fallback fix boundary: define one platform executable-name helper and use it in build output, release validation, and install destination; require exactly `opencorvus.exe` for Windows and exactly `opencorvus` for Linux/macOS.

## Batch P1-BF: BH-072 pre-push checks must catch full OpenAPI drift

### Findings

- BH-072 targets `.husky/pre-push`, `packages/opencorvus/script/check/routes.ts`, and `packages/opencorvus/script/docs/render-api-md.ts`.
- Pre-push already runs `api:routes-check` and `docs:check`, but HEAD only compared method/path route sets across runtime OpenAPI, tracked `packages/sdk/openapi.json`, and generated SDK routes.
- Schema, response, summary, operation metadata, components, and `x-codeSamples` drift could preserve the same method/path set and still pass `api:routes-check`.
- `docs:check` read tracked `packages/sdk/openapi.json`; if that file was stale, docs could regenerate from the stale source and pass without touching live route schemas.
- The canonical SDK OpenAPI source is `generateOpenApiSpec()`, not raw `Server.openapi()`, because it augments operations with `x-codeSamples`.

### Call-point Inventory

- `.husky/pre-push` runs `bun run api:routes-check` and `bun run docs:check`.
- `package.json` maps `api:routes-check` to `packages/opencorvus/script/check/routes.ts` and docs checks to `packages/opencorvus/script/docs/render-api-md.ts`.
- `packages/opencorvus/src/server/server.ts::Server.openapi()` provides raw runtime route OpenAPI.
- `packages/opencorvus/src/cli/cmd/generate.ts::generateOpenApiSpec()` is the SDK OpenAPI generator and adds code samples.
- `packages/opencorvus/script/generate-openapi.ts` and `packages/sdk/js/script/build.ts` use `generateOpenApiSpec()` to write tracked `packages/sdk/openapi.json` and SDK generated sources.
- `packages/opencorvus/script/check/routes.ts` owns static route rules, runtime route inventory, tracked OpenAPI reads, SDK route extraction, and now the full generated-vs-tracked OpenAPI parity comparison.
- `packages/opencorvus/script/docs/render-api-md.ts` owns generated API reference markdown for English and Chinese web docs.
- `packages/web/src/content/docs/reference/api.mdx` and `packages/web/src/content/docs/zh-cn/reference/api.mdx` are generated docs outputs.
- `packages/web/src/content/docs/reference/sdk.mdx`, `packages/web/src/content/docs/zh-cn/reference/sdk.mdx`, and `specs/README.md` describe the generation source.

### Fix Shape

- Keep `Server.openapi()` as the raw route source, but use `generateOpenApiSpec()` as the single generated OpenAPI source for SDK parity checks and API docs rendering.
- Add stable JSON normalization to the route checker and compare the full canonical generated OpenAPI object against tracked `packages/sdk/openapi.json`.
- Keep method/path inventory checks for missing route/SDK entries, but add `generated-openapi-differs-tracked-openapi` for schema and metadata drift.
- Extract the inventory violation assembly into a testable function used by `api:routes-check`, so regression tests exercise the same full-spec comparison path as the pre-push check.
- Update generated API reference docs and source descriptions to say they come from the generated OpenAPI spec, not directly from tracked `packages/sdk/openapi.json`.
- Do not ignore `x-codeSamples`, add metadata allowlists, or add a fallback compare against raw `Server.openapi()`.

### Regression Tests

- Add `packages/opencorvus/test/script/routes-check-openapi.test.ts`.
- Assert schema drift on an existing method/path fails through the inventory checker with `generated-openapi-differs-tracked-openapi`.
- Assert metadata drift, including changed summary and missing `x-codeSamples`, fails.
- Assert stable key ordering does not fail semantically identical OpenAPI objects.
- Assert route check and docs renderer use `generateOpenApiSpec()` and do not source docs from tracked `packages/sdk/openapi.json` or raw `Server.openapi()`.

### Verification

- Focused script tests passed: `bun test packages/opencorvus/test/script/routes-check-openapi.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Route contract check passed: `bun run api:routes-check`.
- Docs were regenerated with `bun run docs:api`, then docs check passed: `bun run docs:check`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Rawls confirmed BH-072 was still present in HEAD `b6ef153741d5b4ce6e440ec08f3f29c4b44d7c55`: pre-push ran route/docs checks, but route check reduced OpenAPI to method/path sets and docs read the tracked OpenAPI file.
- Rawls identified that comparing raw `Server.openapi()` to tracked SDK OpenAPI would false-fail because the canonical generator injects `x-codeSamples`; this batch uses `generateOpenApiSpec()` as the shared source instead.
- Rawls recommended schema-drift, metadata-drift, stable-order, and actual inventory-check regression coverage; the final tests cover those cases.

## Batch P1-BG: BH-074 overlay release bundles must be complete per platform

### Findings

- BH-074 targets `script/check-release-assets.ts::overlay` in release mode with `--require-bundle`.
- `packages/overlay/script/build.ts` explicitly calls Tauri with complete platform bundle sets: `app dmg` on macOS, `msi nsis` on Windows, and `deb rpm appimage` on Linux.
- `.github/workflows/build.yml::package-overlay` stages every emitted release bundle into `packages/overlay/dist-artifacts/<platform>` and then calls `check-release-assets.ts overlay --require-bundle` for release builds.
- The validator already requires both Windows MSI and NSIS bundles through separate checks, but macOS and Linux use a single `requireAny(...)` call. A macOS artifact with only `.dmg` or only `.app.tar.gz` passes, and a Linux artifact with only one of `.AppImage`, `.deb`, or `.rpm` passes.

### Call-point Inventory

- `script/check-release-assets.ts` owns release artifact validation for `cli` and `overlay` modes.
- `.github/workflows/build.yml::Validate overlay assets` invokes `script/check-release-assets.ts overlay` and adds `--require-bundle` only for release builds.
- `.github/workflows/build.yml::Stage overlay artifacts` copies bare overlay binaries, macOS `.app.tar.gz`, and bundle files with `.dmg`, `.deb`, `.rpm`, `.AppImage`, `.msi`, and `*-setup.exe` names into the validated directory.
- `packages/overlay/script/build.ts::bundleTargets()` is the build-side single source for expected release bundle families.
- `packages/overlay/src-tauri/tauri.conf.json` keeps bundle targets active, but the script-level `--bundles` list is what makes the required release set explicit.
- `packages/opencorvus/test/script/check-release-assets.test.ts` already covers CLI validation and can own overlay validator regression coverage.

### Fix Shape

- Keep `--require-bundle` as the release-only switch.
- Add exact per-family bundle checks in overlay mode: macOS requires both DMG and app tarball; Linux requires AppImage, DEB, and RPM; Windows continues to require MSI and NSIS.
- Do not add alternate fallback bundle sets, platform-specific warning-only behavior, or a "some bundle is enough" compatibility path.

### Regression Tests

- Extend `packages/opencorvus/test/script/check-release-assets.test.ts` with overlay-mode helpers.
- Assert macOS release validation fails when either `.dmg` or `.app.tar.gz` is missing and passes when both are present.
- Assert Linux release validation fails when any one of `.AppImage`, `.deb`, or `.rpm` is missing and passes only with all three.
- Assert Windows release validation fails when either `.msi` or NSIS `*-setup.exe` is missing and passes when both are present.
- Assert dev snapshot overlay validation still accepts a bare overlay binary when `--require-bundle` is absent.
- Keep CLI release archive tests unchanged.

### Verification

- Focused release validator tests passed: `bun test packages/opencorvus/test/script/check-release-assets.test.ts --timeout 60000`.
- Package-script guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Sartre confirmed BH-074 was still present in HEAD `9b208f74dc3794d0183504d7ac840c027aaf5100`: macOS and Linux release bundle checks used `requireAny(...)`, so a single bundle satisfied a required bundle set.
- Sartre confirmed the root cause is validator logic, not staging or ambiguous Tauri targets: `.github/workflows/build.yml` stages all bundle families, and `packages/overlay/script/build.ts::bundleTargets()` explicitly requests the complete platform set.
- Sartre recommended the final no-fallback boundary used here: keep `--require-bundle` release-only, require every platform bundle family independently, and keep dev snapshot validation to the bare overlay binary.

## Batch P1-BH: BH-075 serve must not kill unrelated port owners

### Findings

- BH-075 targets `packages/opencorvus/src/cli/cmd/serve.ts`.
- `handleServeCommand(...)` currently probes the requested port with `net.createConnection(...)`. When the port is open, it calls `killOldProcess(...)`.
- `killOldProcess(...)` runs `fuser -k <port>/tcp` on Unix and `netstat | findstr` plus `taskkill /F /PID` on Windows. Neither path proves the listener is an OpenCorvus process owned by the current runtime.
- `Server.listen(...)` already has the correct fail-fast boundary: it attempts `Bun.serve(...)` and throws `Failed to start server on port ...` if the bind fails.

### Call-point Inventory

- `packages/opencorvus/src/cli/cmd/serve.ts::handleServeCommand(...)` is the only production caller of `isPortInUse(...)` and `killOldProcess(...)`.
- `packages/opencorvus/src/cli/cmd/serve.ts::ServeCommand` and `DefaultServeCommand` both route to `handleServeCommand(...)`.
- `packages/opencorvus/src/index.ts` and `packages/opencorvus/src/overlay-server.ts` register those serve command entrypoints for the CLI and overlay-server binary.
- `packages/opencorvus/src/server/server.ts::Server.listen(...)` owns actual port binding and already returns a structured startup failure when binding fails.
- `packages/opencorvus/src/cli/network.ts::resolveNetworkOptions(...)` resolves `--port`, `--hostname`, mDNS, and CORS before startup.
- `packages/opencorvus/test/cli/serve-default-command.test.ts` already covers command routing and can own the occupied-port regression.

### Fix Shape

- Remove `isPortInUse(...)`, `killOldProcess(...)`, the `net.createConnection` import, and the startup block that kills and waits for port release.
- Let `Server.listen(opts)` be the single startup authority. If the port is occupied, startup fails visibly.
- Do not add process-name heuristics, owner checks, retries, fallback ports, prompts, or any automatic process termination.

### Regression Tests

- Extend `packages/opencorvus/test/cli/serve-default-command.test.ts`.
- Bind an unrelated local HTTP listener on an OS-assigned port, call `handleServeCommand(...)` with that exact port, and assert it rejects with the server bind failure.
- Spy on `Bun.spawnSync` and assert no `fuser`, `netstat`, or `taskkill` process is spawned.
- After the failed serve startup, fetch the unrelated listener and assert it is still alive.

### Verification

- Focused CLI tests passed: `bun test packages/opencorvus/test/cli/serve-default-command.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Pauli confirmed BH-075 was still present in HEAD `aab98e52b3315dd51cafdc901d2b46a247a39088`: serve probed the port, then ran `fuser -k` or `netstat` plus `taskkill` before calling `Server.listen(...)`.
- Pauli identified the same root cause: "target port has a listener" was treated as "old OpenCorvus process can be killed" without ownership proof, host/interface distinction, or project/runtime identity.
- Pauli recommended the final no-fallback boundary used here: delete pre-bind probing and automatic process termination, make `Server.listen(opts)` the only startup authority, and let explicit occupied ports fail visibly.

## Batch P1-BI: BH-077 explicit run agent selection must be fail-closed

### Findings

- BH-077 targets `packages/opencorvus/src/cli/cmd/run.ts`.
- `RunCommand` currently validates `args.agent` inside `execute(...)`, but missing agents and subagents both print a warning and return `undefined`.
- `undefined` is then passed to `sdk.session.command(...)` or `sdk.session.prompt(...)`, causing the server-side default agent to run even though the operator explicitly selected a different agent.
- The validation happens before `session(sdk)` today; the bug is the fallback-to-default behavior, not ordering.

### Call-point Inventory

- `packages/opencorvus/src/cli/cmd/run.ts::RunCommand` owns CLI `--agent` parsing, local/attached client creation, session creation/forking, and the final `sdk.session.command(...)` / `sdk.session.prompt(...)` calls.
- `packages/opencorvus/src/agent/agent.ts::Agent.get(...)` resolves configured and built-in agent definitions and returns `undefined` for unknown agents.
- `packages/opencorvus/src/agent/agent.ts::Agent.defaultAgent(...)` owns implicit default selection; explicit CLI agent validation must not fall through to this path.
- `packages/opencorvus/src/index.ts` registers `RunCommand` as the `run [message..]` command.
- `packages/opencorvus/test/cli` has no existing run-command regression coverage, so this batch adds a focused CLI test file.

### Fix Shape

- Add an exported `resolveRunAgent(...)` helper in `run.ts` that returns `undefined` only when no explicit agent was provided.
- When an explicit agent is unknown, throw before session creation with a concrete "not found" error.
- When an explicit agent has `mode === "subagent"`, throw before session creation with a concrete "is a subagent, not a primary agent" error.
- Keep explicit non-subagent agents accepted, including existing hidden/internal primary agents, because the current CLI contract only rejects missing agents and subagents.
- Remove the warning messages that mention falling back to default agent. Do not add prompts, compatibility branches, default retries, or host-side routing gates.

### Regression Tests

- Add `packages/opencorvus/test/cli/run-agent.test.ts`.
- Assert `resolveRunAgent(undefined)` returns `undefined`, preserving implicit default behavior only when the operator did not pass `--agent`.
- Assert `resolveRunAgent("missing-agent")` rejects with "not found".
- Assert `resolveRunAgent("explore")` rejects because built-in `explore` is a subagent.
- Assert `resolveRunAgent("coding")` returns the explicit primary agent id.
- Assert `RunCommand.handler(...)` rejects missing prompt agents and subagent `--command` agents before mocked SDK session create/list/fork/prompt/command side effects.
- Add a source-level guard that `run.ts` no longer contains "Falling back to default agent" and that `resolveRunAgent(...)` is called before `session(sdk)`.

### Verification

- Focused CLI tests passed: `bun test packages/opencorvus/test/cli/run-agent.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.

### Independent Review Feedback

- Raman confirmed BH-077 was still present in HEAD `1e18eff61d`: missing agents and subagents returned `undefined`, then `session/prompt` and `command-exec` paths interpreted `undefined` as default agent selection.
- Raman identified the same root cause: CLI collapses "explicit invalid agent" into "agent omitted"; server-side default selection is only valid for genuinely omitted agents.
- Raman recommended adding handler-level tests that invalid prompt and command invocations exit before session creation or prompt/command submission; the final test suite includes mocked SDK assertions for both paths.

## Batch P1-BJ: BH-078 GitHub action summary failures must stop git mutation

### Findings

- BH-078 targets `packages/opencorvus/src/cli/cmd/github.ts::summarize(...)`.
- The GitHub action flow calls `summarize(response)` only after the agent has produced dirty work and immediately before infrastructure `git add/commit/push` and PR creation.
- Current `summarize(...)` catches every summary model failure, derives a synthetic `Fix issue: <title>` string, and lets the caller continue into commit/push/PR mutation.
- That synthetic title is a fallback: it hides a model failure and changes repository state after the action has lost the ability to produce the intended commit/PR title.

### Call-point Inventory

- `packages/opencorvus/src/cli/cmd/github.ts::GithubRunCommand` owns GitHub action event routing and the outer failure handler that records `core.setFailed(...)`, comments user-facing errors for user events, and restores git config.
- `packages/opencorvus/src/cli/cmd/github.ts::summarize(...)` is the only summary-title helper and is called before every infrastructure mutation path.
- Repo-event dirty path calls `summarize(response)`, then `pushToNewBranch(...)`, then `createPR(...)`.
- Local PR dirty path calls `summarize(response)`, then `pushToLocalBranch(...)`.
- Fork PR dirty path calls `summarize(response)`, then `pushToForkBranch(...)`.
- Issue dirty path calls `summarize(response)`, then `pushToNewBranch(...)`, then `createPR(...)`, then comments the PR result.
- `packages/opencorvus/src/cli/cmd/github.ts::chat(...)` wraps `SessionPrompt.prompt(...)` and already throws on assistant errors, prompt-too-large errors, missing text, and failed tool-only response summarization.
- `packages/opencorvus/test/cli/github-action.test.ts` currently covers response extraction and prompt-too-large formatting, but not summary-title failure propagation.

### Fix Shape

- Extract a small exported `summarizeGitHubActionResponse(response, chat)` helper that builds the existing "less than 40 characters" prompt and returns the model-produced summary.
- Make the nested `summarize(...)` delegate to that helper without catching errors.
- Let summary failures propagate to the existing outer GitHub action catch block, which fails the action before push/PR creation.
- Remove the `Fix issue: ...` fallback entirely. Do not replace it with a different fallback title, retry, prompt, route gate, or git mutation guard.

### Regression Tests

- Extend `packages/opencorvus/test/cli/github-action.test.ts`.
- Assert `summarizeGitHubActionResponse(...)` sends the expected short-title prompt and returns the chat result.
- Assert a thrown summary chat error propagates and no `Fix issue:` text is synthesized.
- Add a source-level guard that `github.ts::summarize(...)` contains no `catch`, delegates to `summarizeGitHubActionResponse(...)`, and each infrastructure mutation call remains after a local `const summary = await summarize(response)`.
- Add `packages/opencorvus/test/cli/github-action-run.test.ts` to run the mocked issue dirty flow through `GithubRunCommand.handler(...)`: main chat succeeds and writes a dirty file, summary chat throws, the action fails, no pull request is created, no synthetic title appears, commit count does not advance after the summary boundary, and the index is not staged by infrastructure `git add`.

### Verification

- Focused GitHub action tests passed: `bun test packages/opencorvus/test/cli/github-action-run.test.ts packages/opencorvus/test/cli/github-action.test.ts packages/opencorvus/test/cli/github-remote.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.

### Independent Review Feedback

- Galileo confirmed BH-078 was still present in HEAD `73711ecc5a`: `summarize(response)` caught every summary model failure and returned `Fix issue: ${title}`.
- Galileo identified the same root cause: commit/PR title generation failure was treated as recoverable, hiding the model failure and continuing into repository mutation.
- Galileo required a flow-level regression beyond helper/source tests; this batch adds the issue dirty handler test that verifies no post-summary git staging/commit and no PR creation when summary generation fails.

## Batch P1-BK: BH-086 sync apply backups must cover every mutating action

### Findings

- BH-086 targets `script/sync-host-wsl.ps1`.
- The script computes `$changedUnion` from modified/untracked files, then in `-Apply` mode immediately backs up only those paths.
- It later discovers clean tracked divergences by iterating `$trackedUnion` and, when a conflict preference is provided, turns them into mutating `host-to-wsl`, `wsl-to-host`, `delete-host`, or `delete-wsl` actions.
- Those later clean-tracked-divergence actions can overwrite or delete files that were not in `$changedUnion`, so no copy of the overwritten side exists in `backup-host-files`, `backup-wsl-files`, or deleted lists.

### Call-point Inventory

- `script/sync-host-wsl.ps1` is the only host/WSL sync entrypoint required by `AGENTS.md` rule 38.
- `Invoke-HostGitLines(...)` and `Invoke-WslGitLines(...)` collect `ls-files`, changed lists, and HEAD values.
- `$changedUnion` currently drives early apply-mode backups.
- `$trackedUnion` clean divergence detection can add mutating actions after backup creation.
- `Add-PreferredConflictAction(...)` maps both touched conflicts and clean tracked divergences into the same action vocabulary.
- Final `foreach ($entry in $actions)` is the single mutation site that copies or deletes files.
- No existing automated test covers `script/sync-host-wsl.ps1`.

### Fix Shape

- Move apply-mode backup creation until after actions, conflicts, and resolved conflicts are fully computed, but still before the final action loop mutates files.
- Derive backup paths from the final non-`noop` action list, not from `$changedUnion`.
- Back up both host and WSL sides for every mutating action path; this preserves overwritten sources, overwritten destinations, and deletion targets without needing per-action special cases.
- Treat an empty path set as containing no paths in `Contains-PathItem(...)`; behavior-level clean divergence tests showed PowerShell can materialize an empty `$changedUnion` as `$null`, which otherwise prevents the clean-divergence branch from reaching conflict handling.
- Keep dry-run behavior free of file backups and keep conflict-without-preference behavior non-mutating.
- Do not add a fallback sync direction, compatibility overwrite path, or route gate.

### Regression Tests

- Add `packages/opencorvus/test/script/sync-host-wsl.test.ts`.
- Assert source structure derives `$mutatingActionPaths` from `$mutatingActions`, then backs up that set with `Copy-BackupFile` for both host and WSL before the action loop.
- Assert the old `foreach ($relative in $changedUnion)` backup loop is gone.
- Assert the clean tracked divergence loop still routes preferred conflicts through `Add-PreferredConflictAction(...)`, so the mutating action path backup set includes those rows.
- Add behavior-level local WSL harness tests using two clean git workspaces with divergent tracked content and an empty changed set.
- Assert `-Apply -PreferHostForConflicts` copies host content to WSL and stores both original sides in backup files before overwrite.
- Assert `-Apply -PreferWslForConflicts` copies WSL content to host and stores both original sides in backup files before overwrite.
- Assert preferred clean tracked deletion backs up the deletion target and records the missing preferred side in `backup-*-deleted.txt`.
- Assert clean tracked divergence without a preference fails before mutation and before backup directories are created.

### Verification

- Focused sync tests passed: `bun test packages/opencorvus/test/script/sync-host-wsl.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.

### Independent Review Feedback

- Newton confirmed BH-086 was still present in HEAD `4575fee8b0`: `-Apply` backed up only `$changedUnion`, then clean tracked divergence later added mutating actions that could overwrite/delete unbacked files.
- Newton identified the same root cause: backup paths and mutation actions were two sources of truth; backups must derive from the final mutation action list.
- Newton required behavior-level clean git workspace fixtures beyond source guards; the final test suite includes host-preferred, WSL-preferred, deletion, and no-preference clean tracked divergence fixtures.

## Batch P1-BL: BH-096 secret scan must include env example compound suffixes

### Findings

- BH-096 targets `script/secret-scan.ts`.
- `TEXT_EXTENSIONS` lists `.env.example`, but `shouldScan(...)` derives only `path.extname(rel).toLowerCase()`.
- For a tracked file such as `config/app.env.example`, Node returns `.example`, not `.env.example`, so `scan(...)` skips the file before applying `SECRET_PATTERNS`.
- That makes pre-push secret scanning miss exactly the class of env template files that commonly contain credential placeholders and accidental copied keys.

### Call-point Inventory

- `script/secret-scan.ts::scan(...)` is the only production scanner entrypoint and calls `shouldScan(...)` before reading each tracked path.
- `script/secret-scan.ts::listTrackedFiles(...)` provides the default tracked path list from the git index; BH-097 will address the separate indexed-content versus worktree-content read boundary.
- `script/secret-scan.ts::TEXT_EXTENSIONS` owns ordinary text extension classification.
- `.husky/pre-push` invokes `bun run script/secret-scan.ts`, so pre-push coverage depends on the same `scan(...)` path.
- `packages/vscode-extension/test/secret-scan.test.ts` is the existing scanner regression suite and already imports `scan(...)`, `SECRET_PATTERNS`, and `parseGitIndexPaths(...)`.
- `packages/vscode-extension/package.json` exposes `bun test`, which discovers the scanner test file.

### Fix Shape

- Keep ordinary extension matching as the single source for normal text extensions.
- Move `.env.example` out of `TEXT_EXTENSIONS` because it is not an extension under `path.extname(...)`.
- Add a dedicated compound-suffix classifier for paths ending in `.env.example` before ordinary extension classification.
- Do not add a fallback scan-all mode, binary sniffing, compatibility path, hook-only gate, or any behavior that hides the classifier boundary.

### Regression Tests

- Extend `packages/vscode-extension/test/secret-scan.test.ts`.
- Add fixtures `.env.example` and `config/app.env.example` containing OpenAI-style key shapes and assert `scan(...)` reports `openai-style` hits for both files.
- Add `config/notes.example` with the same key shape and assert it is not reported, proving the fix did not broaden scanning to every `.example` file.
- Keep the fixture string marked with `// secret-scan: ignore` in the test source so the production pre-push scan does not flag the regression test file itself.

### Independent Review Feedback

- Averroes confirmed BH-096 was still present in HEAD `2bfa5ef247`: `.env.example` was modeled as an extension, while `path.extname(...)` returned `.example`.
- Averroes verified the current classifier shape hits `.env.example` and `config/app.env.example` while skipping `config/notes.example`.
- Averroes required the regression to cover root `.env.example`, nested `*.env.example`, and a negative `.example` fixture; the final test covers all three paths.

## Batch P1-BM: BH-097 secret scan must read git object snapshots

### Findings

- BH-097 targets `script/secret-scan.ts` and `.husky/pre-push`.
- `listTrackedFiles(...)` derives tracked path names from the git index, but `scan(...)` turns those paths into `path.join(opts.repoRoot, rel)` and reads current worktree bytes with `fs.readFileSync(...)`.
- A committed or staged secret can therefore be hidden by editing the worktree copy to remove the secret without staging that cleanup.
- The pre-push hook invokes the same scanner entrypoint, so it inherits the mismatch between pushed commit content, staged index content, and worktree reads.
- Index-only scanning is insufficient: if HEAD contains a secret and the cleanup has been staged, the index is clean while the commit being pushed is still dirty.

### Call-point Inventory

- `script/secret-scan.ts::gitIndexPath(...)` locates the active git index and already honors `GIT_INDEX_FILE`.
- `script/secret-scan.ts::parseGitIndexPaths(...)` parses path names from index entries; it is currently the single source for default scan paths.
- `script/secret-scan.ts::listTrackedFiles(...)` wraps `parseGitIndexPaths(...)` for the default production path list.
- `script/secret-scan.ts::scan(...)` is the only production scanning function and currently reads worktree files.
- `.husky/pre-push` runs `bun run script/secret-scan.ts`; the hook also receives local/remote refs on stdin, which identify the local commit objects Git is about to push.
- `packages/vscode-extension/test/secret-scan.test.ts` is the existing scanner regression suite and can create temporary git repositories for index-content behavior.

### Fix Shape

- Extend index parsing to return path, blob object id, file size, and mode from each stage-zero index entry.
- Add tree parsing for `git ls-tree -r -z -l <ref>` output so scanner can read committed/local-ref blobs by object id.
- Keep `parseGitIndexPaths(...)` as a compatibility-free wrapper over the richer parser for existing tests.
- Make default `scan({ repoRoot })` read HEAD tree blobs plus indexed blobs through `git cat-file --batch` by object id, chunked by blob size, before applying the existing text classifier and secret patterns.
- Add `refs` to `ScanOptions` for explicit pre-push local commit object ids; when present, scan those refs plus the index instead of implicitly resolving HEAD.
- Change `.husky/pre-push` to capture hook stdin and pipe it to `secret-scan.ts --pre-push-stdin`, where malformed ref lines fail loudly and deleted refs are ignored.
- Skip non-regular gitlink entries and blobs larger than the existing 1 MiB cutoff before invoking `git cat-file`.
- Keep explicit `files` in `ScanOptions` as a test fixture override only; the production path must not fall back to worktree reads when indexed blob reads fail.
- Do not add worktree fallback reads, hook-only checks, retry gates, `git diff` keyword matching, or scan-all behavior.

### Regression Tests

- Extend `packages/vscode-extension/test/secret-scan.test.ts`.
- Add a temp git repo fixture where a secret is committed, the worktree copy is cleaned without staging, and `scan({ repoRoot })` still reports `openai-style` from HEAD/index blobs.
- Add a temp git repo fixture where a clean commit is followed by a staged secret and an unstaged cleanup, and `scan({ repoRoot })` still reports `openai-style` from the staged index blob.
- Add a temp git repo fixture where a committed secret is hidden by a staged cleanup and `scan({ repoRoot })` still reports `openai-style` from HEAD.
- Add a pre-push local-ref fixture where a historical local commit contains a secret while current HEAD/index are clean, and `scan({ repoRoot, refs })` still reports the local-ref blob.
- Add parser coverage proving index entries and tree entries expose object id, file size, mode, and path while `parseGitIndexPaths(...)` remains path-only.
- Add pre-push stdin parser coverage for deduped pushed refs, deleted refs, and malformed lines.

### Verification

- Focused secret scanner tests passed: `bun test packages/vscode-extension/test/secret-scan.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Pre-push stdin equivalent passed: `"<local-ref-line>" | bun run script/secret-scan.ts --pre-push-stdin`.
- VS Code extension typecheck passed: `bun run --cwd packages/vscode-extension typecheck`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Curie confirmed BH-097 was still present in HEAD `925222cb87803144e1966c42c30a9b5c2c237251`: the scanner selected paths from `.git/index` but read worktree bytes with `fs.readFileSync(...)`.
- Curie identified that index-only scanning would still miss HEAD/local-ref secrets after a staged cleanup; the repair therefore scans both local-ref tree blobs and index blobs.
- Curie required committed, staged, staged-cleanup, parser, and pre-push local-ref regressions; the final test suite covers all of those paths.

## Batch P1-BN: BH-102 import command must fail on unreadable input

### Findings

- BH-102 targets `packages/opencorvus/src/cli/cmd/import.ts`.
- `ImportCommand.handler(...)` wraps `Filesystem.readJson(...)` in `.catch(() => undefined)`, so missing files, invalid JSON, permission errors, and every other read failure collapse into the same `undefined` value.
- The next branch prints `File not found: <file>` to stdout and returns normally; yargs/top-level CLI sees success.
- A second `if (!exportData)` branch that prints `Failed to read session data` is unreachable because the first `if (!exportData)` already returns.
- No current CLI test covers import failure behavior.

### Call-point Inventory

- `packages/opencorvus/src/cli/cmd/import.ts::ImportCommand` owns the `import <file>` CLI command.
- `packages/opencorvus/src/index.ts` registers `ImportCommand` with yargs, so handler rejection is propagated to the top-level catch and exits nonzero.
- `packages/opencorvus/src/util/filesystem.ts::Filesystem.readJson(...)` throws distinct filesystem and JSON parse errors; the import command currently erases them.
- `packages/opencorvus/src/session/index.ts::Session.toRow(...)` maps imported session info to `SessionTable`.
- `packages/opencorvus/src/session/session.sql.ts` defines `SessionTable`, `MessageTable`, and `PartTable`, the three tables import writes after a successful read.
- `packages/opencorvus/test/cli` has no import regression test file.

### Fix Shape

- Add explicit import-file error classes for missing input and invalid JSON.
- Replace `Filesystem.readJson(...).catch(() => undefined)` with a helper that reads text, maps `ENOENT` to the missing-file error, maps JSON parse failures to the invalid-JSON error, and lets other filesystem errors propagate.
- Extract the DB insert body into `importSessionData(...)` so tests can exercise read failure boundaries without duplicating production writes.
- Remove both stdout error branches and the unreachable second `if (!exportData)` branch.
- Let handler rejection propagate; do not call `process.exit(...)`, do not add fallback parsing, and do not silently skip invalid input.

### Regression Tests

- Add `packages/opencorvus/test/cli/import.test.ts`.
- Missing file: run `ImportCommand.handler(...)` in an isolated `OPENCORVUS_HOME` and project directory, assert rejection message names missing input, assert stdout is not used for error reporting, and assert `SessionTable`, `MessageTable`, and `PartTable` row counts remain zero.
- Malformed JSON: same setup with invalid file contents, assert a distinct invalid-JSON message and zero rows in the three import target tables.
- Process-level missing and malformed JSON fixtures: run the actual CLI source entrypoint and assert exit code is nonzero, stdout does not claim import success, and stderr carries the distinct error message.
- Add a source-level guard that `import.ts` no longer contains `.catch(() => undefined)`, stdout `File not found`, or the unreachable `Failed to read session data` branch.

### Verification

- Focused import tests passed: `bun test packages/opencorvus/test/cli/import.test.ts packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Einstein confirmed BH-102 was still present in HEAD `9a24dcb130382fb43cc3d9215d2661fad428fe06`: `Filesystem.readJson(...).catch(() => undefined)` collapsed all read/parse failures, stdout printed `File not found`, and handler returned normally.
- Einstein identified the direct automation impact: `packages/opencorvus/src/cli/cmd/pr.ts` uses `.nothrow()` and only sees exit code, so import false-success hides a failed restore.
- Einstein required process-level CLI coverage in addition to handler-level tests; the final suite includes missing and malformed JSON subprocess assertions.

## Batch P1-BO: BH-104 Mission wake must be directory-bound inside linked worktrees

### Findings

- BH-104 targets `packages/opencorvus/src/mission/session.ts` and `packages/opencorvus/src/project/project.ts`.
- `Project.fromDirectory(...)` intentionally gives linked git worktrees the same `project.id` while exposing each active worktree as a distinct `Instance.directory`.
- Mission read/action routes already resolve records with `getMissionSessionByDirectory({ missionID, directory: Instance.directory })`.
- The wake/create side still used a project-wide lookup and lock: `findMissionSessionID(missionID)`, `findExistingMissionSession(missionID)`, `ensureMissionSessionInner(...)`, and lock key `${Instance.project.id}:${missionID}`.
- Therefore a primary worktree could create mission session A, and a linked worktree waking the same `missionID` would reuse session A and inject the second worktree prompt into the wrong Mission session.
- This is not a `Project.fromDirectory(...)` bug; linked worktrees sharing project identity is the intended project model. Mission session identity must include the active directory.

### Call-point Inventory

- `packages/opencorvus/src/mission/session.ts::findExistingMissionSession(...)` is used by the wake route only to compute `created`.
- `packages/opencorvus/src/mission/session.ts::ensureMissionSession(...)` is used by `/mission/wake`, Mission helper tests, mission-state tests, panel provenance tests, and task lineage/title tests.
- `packages/opencorvus/src/server/routes/mission.ts::missionRouteSession(...)` already resolves action routes by `Instance.directory`.
- `packages/opencorvus/src/server/routes/mission.ts::POST /mission/wake` is the production path that selects the Mission session and then calls `SessionWake.wake(...)`.
- `packages/opencorvus/src/session/wake.ts` writes to the supplied `sessionID`; it cannot repair a wrong Mission session selection upstream.
- `packages/opencorvus/test/mission/session.test.ts` encoded the previous `(project, missionID)` singleton invariant and needed to be updated.
- `packages/opencorvus/test/mission/wake-route.test.ts` had same-directory reuse coverage but no linked-worktree reuse coverage.

### Fix Shape

- Remove the project-only Mission session lookup from the wake/create path.
- Make `findExistingMissionSession(...)` require `{ missionID, directory }` and query by project, directory, kind, and mission metadata id.
- Make `ensureMissionSession(...)` normalize `defaultCwd`, parse `missionID`, and use `(projectID, normalized directory, missionID)` for both the in-process lock key and the DB lookup.
- Keep `getMissionSessionByDirectory(...)` as the action-route read path, with normalized directory comparison.
- Do not add project-only fallback lookup, reject-after-lookup gates, route bypasses, or changes to linked-worktree project identity.

### Regression Tests

- Extend `packages/opencorvus/test/mission/session.test.ts` with a real `git worktree` fixture proving the same project can hold two directory-bound Mission sessions with the same `missionID`, while repeated ensure in the same linked directory still reuses that directory's row.
- Extend `packages/opencorvus/test/mission/wake-route.test.ts` with a real linked-worktree route test: wake primary, wake linked directory with the same `missionID`, assert `SessionWake.wake(...)` receives the linked session id and `created:true`, then wake linked again and assert `created:false`.
- Update `findExistingMissionSession(...)` assertions to require the active directory.
- Keep same-directory wake reuse tests unchanged.

### Verification

- Focused Mission helper and wake route tests passed: `bun test packages/opencorvus/test/mission/session.test.ts packages/opencorvus/test/mission/wake-route.test.ts --timeout 90000`.
- Mission action route tests passed: `bun test packages/opencorvus/test/server/mission-routes.test.ts --timeout 90000`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Ohm confirmed BH-104 was still present at HEAD `df4778223c9c4b50b13ba0d7c85cb1f4fb643f49`.
- Ohm independently identified the same root cause: wake/session acquisition used `projectID + missionID`, while later Mission routes used `directory + missionID`.
- Ohm required a real `git worktree` test, route-level `SessionWake.wake(...)` assertions, directory-aware `created` semantics, and no project-only fallback path.
- Ohm noted the implementation should normalize raw `defaultCwd`; `ensureMissionSession(...)` now uses `Filesystem.resolve(...)` before lookup and lock key construction.

## Batch P1-BP: BH-110 public replan surfaces must not use retry intent

### Findings

- BH-110 targets `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/opencorvus/src/tool/panel.ts`, and `packages/opencorvus/src/task-api/index.ts`.
- `/task/:taskID/replan` and panel `replan_task` returned "Replan queued" but called `EngineService.retryTask(...)`.
- `retryTask(...)` reopens active blocked runs and dispatches retry text, so a failed task with an active plan could continue the stale blocked plan instead of forcing fresh planning.
- A text-only note was not enough as the contract boundary because route/tool callers need a structured operator intent that tests can assert without inferring semantics from free-form prose.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/orchestrator.ts::POST /task/:taskID/retry` remains the retry route and must keep retry semantics.
- `packages/opencorvus/src/server/routes/orchestrator.ts::POST /task/:taskID/replan` is the HTTP replan surface and now calls `EngineService.replanTask(...)`.
- `packages/opencorvus/src/tool/panel.ts::retry_task` remains the panel retry action and calls `EngineService.retryTask(...)`.
- `packages/opencorvus/src/tool/panel.ts::replan_task` is the panel replan action and now calls `EngineService.replanTask(...)`.
- `packages/opencorvus/src/task-api/index.ts::retryTask(...)` is the canonical retry service and still reopens blocked active runs.
- `packages/opencorvus/src/task-api/index.ts::replanTask(...)` is the canonical replan service, supersedes active plans, and dispatches `operatorIntent.kind="replan"` without using the retry reopen path.
- `packages/opencorvus/src/orchestrator/agent.ts::OrchestratorEvent` now carries structured `operatorIntent` so retry/replan dispatch is not inferred from note text.
- `packages/opencorvus/test/panel/actor-whitelist.test.ts` covers the panel actor boundary; validation exposed that the denied `update_goal` fixture had invalid acceptance spec shape and was not testing the intended actor guard.

### Fix Shape

- Introduce a shared internal wake helper for operator intents and expose separate `retryTask(...)` and `replanTask(...)` services.
- Keep retry behavior unchanged: clear cancellation metadata, reopen stale blocked active runs, and dispatch `operatorIntent.kind="retry"`.
- For replan, clear cancellation metadata, supersede prior active plans through the existing plan persistence helper, skip `reopenActiveRunForOperatorWake(...)`, and dispatch `operatorIntent.kind="replan"` with an explicit fresh-plan note.
- Route `/replan` and panel `replan_task` use the new service directly; route `/retry` and panel `retry_task` remain on retry.
- Do not add route gates, note-string parsing, retry fallback, or compatibility behavior.
- Make the panel actor whitelist denied `update_goal` fixture schema-valid so the test verifies authorization before downstream business logic.

### Regression Tests

- Extend `packages/opencorvus/test/orchestrator/operator-message.test.ts` to prove retry and replan notes remain distinct.
- Extend `packages/opencorvus/test/engine/task-message-revive.test.ts` to prove `EngineService.replanTask(...)` supersedes the active plan, does not reopen a blocked run as retry, and dispatches structured replan intent.
- Extend `packages/opencorvus/test/server/replan-routes.test.ts` to prove `/replan` dispatches `operatorIntent.kind="replan"` and removes the active plan, while `/retry` dispatches `operatorIntent.kind="retry"` and keeps the active plan.
- Extend `packages/opencorvus/test/tool/panel-replan.test.ts` to prove panel `replan_task` dispatches structured replan intent and supersedes the active plan.
- Update `packages/opencorvus/test/panel/actor-whitelist.test.ts` so every denied mission action, including `update_goal`, reaches the actor guard with valid params.

### Verification

- Focused BH-110 tests passed: `bun test packages/opencorvus/test/orchestrator/operator-message.test.ts packages/opencorvus/test/engine/task-message-revive.test.ts packages/opencorvus/test/server/replan-routes.test.ts packages/opencorvus/test/tool/panel-replan.test.ts --timeout 90000`.
- Panel actor whitelist passed: `bun test packages/opencorvus/test/panel/actor-whitelist.test.ts --timeout 90000`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Darwin confirmed BH-110 was still present before the repair: HTTP `/replan` and panel `replan_task` both flowed into `retryTask(...)`.
- Darwin required a first-class replan service or intent rather than string-only note differences, plus service, route, and panel tests that prove retry and replan are separate paths.
- Darwin also called out stale active plans as the deep risk; the final repair supersedes active plans on replan and verifies the blocked retry reopen path is not invoked.

## Batch P2-BQ: BH-023 public worktree delete routes must reject unregistered directories

### Findings

- BH-023 targets the public worktree delete routes in `packages/opencorvus/src/server/routes/project.ts` and `packages/opencorvus/src/server/routes/experimental.ts`.
- Raw `Worktree.remove(...)` intentionally treats an existing directory that is absent from `git worktree list` as cleanup residue and recursively removes it. That behavior is still required by GC, reclaim, create cleanup, and registered zombie cleanup.
- The route bug was exposing that low-level cleanup primitive directly to caller-supplied JSON. A caller could pass a sibling directory that was not a current-project worktree and have it removed.
- The route-level sandbox cleanup also compared raw strings, so deleting a registered path returned by git could leave a sandbox pointer when the stored path contained `..` or a different but equivalent spelling.
- While validating the project route file, `GET /project/current/cleanup-candidates` exposed an adjacent ownership visibility bug: `Ownership.*.record(...)` writes task-scoped markers under `.opencorvus/r/o/{w,p}/...`, but list/orphan/clear only scanned the legacy unscoped marker directories.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/project.ts::DELETE /project/current/worktrees` is the current project web/API delete surface.
- `packages/opencorvus/src/server/routes/experimental.ts::DELETE /experimental/worktree` is the older delete surface with the same semantics and must not remain a raw delete backdoor.
- `packages/opencorvus/src/worktree/index.ts::remove(...)` is the low-level canonical remover used by GC/reclaim/create cleanup and must retain zombie cleanup behavior.
- `packages/opencorvus/src/worktree/index.ts::listProjectWorktrees(...)` is the current project visible worktree list and the right single source for route deletability.
- `packages/opencorvus/src/project/project.ts::removeSandbox(...)` removes the project sandbox pointer after successful worktree removal.
- Raw `Worktree.remove(...)` remains used by `packages/opencorvus/src/worktree/gc.ts`, `packages/opencorvus/src/workspace/workspace.ts`, `packages/opencorvus/src/engine/rewind.ts`, `packages/opencorvus/src/goal/runner.ts`, and internal worktree reclaim/create cleanup; those call sites derive directories from persisted project/runtime state rather than public JSON.
- `packages/opencorvus/src/engine/ownership.ts` owns both marker writing and cleanup route enumeration for legacy and task-scoped ownership markers.

### Fix Shape

- Add `Worktree.removeProjectWorktree(...)` as the public-route service boundary: canonicalize the requested path, require a matching `removable` row from `listProjectWorktrees(...)`, and only then call raw `remove(...)` on the registered directory.
- Make both delete routes call `removeProjectWorktree(...)` instead of raw `remove(...)`.
- Return the registered worktree row from `removeProjectWorktree(...)` so route sandbox cleanup uses the same resolved directory that was actually deleted.
- Make `Project.removeSandbox(...)` remove path-equivalent sandbox entries, not only byte-identical strings.
- Update `/experimental/worktree` OpenAPI metadata to advertise 404 for unregistered directories.
- Keep raw `Worktree.remove(...)` behavior unchanged for GC/reclaim/zombie cleanup; do not add a global registered-only gate or route fallback.
- Update ownership marker scanning to read both legacy unscoped marker directories and current task-scoped `w` / `p` marker directories.

### Regression Tests

- Extend `packages/opencorvus/test/server/project-routes.test.ts`:
  - positive delete for `/project/current/worktrees` still removes a registered worktree;
  - positive delete for `/experimental/worktree` removes a registered worktree;
  - both routes reject an unregistered sibling directory with 404 and leave its sentinel file intact;
  - cleanup-candidates sees task-scoped process and worktree ownership markers without mutating them.
- Extend `packages/opencorvus/test/engine/ownership.test.ts` expectations to use valid task/session IDs and the current ownership root so scoped marker list/orphan/clear behavior is exercised.
- Keep `packages/opencorvus/test/project/worktree-remove.test.ts` and `packages/opencorvus/test/project/worktree-gc.test.ts` passing to prove low-level registered/zombie removal is not broken.

### Verification

- Focused worktree/project/ownership tests passed: `bun test packages/opencorvus/test/engine/ownership.test.ts packages/opencorvus/test/project/worktree-remove.test.ts packages/opencorvus/test/project/worktree-gc.test.ts packages/opencorvus/test/server/project-routes.test.ts --timeout 90000`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Heisenberg confirmed the repaired public route callpoints now use `Worktree.removeProjectWorktree(...)` and no other current HTTP route directly passes user-supplied directories to raw `Worktree.remove(...)`.
- Heisenberg identified the remaining `/experimental/worktree` 404 contract gap; the route metadata and positive/negative route tests now cover that surface.
- Heisenberg confirmed the raw low-level remover still has legitimate internal call sites for GC, stored workspace rows, rewind, goal runner cleanup, and worktree reclaim/create cleanup.

## Batch P2-BR: BH-024 DB reset route must reject unregistered project directories

### Findings

- BH-024 targets `POST /global/db/reset` in `packages/opencorvus/src/server/routes/global.ts`.
- The route already rejected relative `projectDir` values through the request schema, and `Database.reset(projectDir)` also rejects relative paths.
- The remaining defect was absolute but unregistered input: the route passed caller-supplied `projectDir` directly to `Database.reset(...)`, which recursively removes the global DB files plus runtime and legacy scratch directories under that path.
- `Database.reset(...)` is also used by `opencorvus db reset --force`, where `process.cwd()` is the command boundary. Moving registered-project checks into the storage helper would break the low-level reset/recovery path rather than fixing the HTTP authority bug.
- Overlay's hidden DB reset backdoor posts `activeDirectory()`, which can be a registered project worktree or sandbox. The route must accept registered project directories without accepting arbitrary absolute filesystem paths.

### Call-point Inventory

- `packages/opencorvus/src/server/routes/global.ts::POST /global/db/reset` is the only HTTP surface that accepts a JSON `projectDir` and triggers recursive runtime deletion through `Database.reset(...)`.
- `packages/opencorvus/src/storage/db.ts::Database.reset(projectDir)` is the low-level destructive reset helper shared by HTTP and CLI callers; it must retain its absolute-path guard but not learn HTTP registry semantics.
- `packages/opencorvus/src/cli/cmd/db.ts::ResetCommand` calls `Database.reset(process.cwd())`; it is not an arbitrary remote path input.
- `packages/overlay/src/main.tsx` posts `activeDirectory()` to `global/db/reset`; `activeDirectory()` may refer to a registered project worktree or sandbox.
- `packages/opencorvus/src/project/project.ts` owns the existing path equivalence helper and the Project table projection containing primary worktrees and sandboxes.

### Fix Shape

- Export the existing `Project.samePath(...)` helper instead of adding a second route-local path normalization rule.
- Add `Project.findByRegisteredDirectory(...)` to resolve an input directory against registered project worktrees and registered sandboxes.
- Make `/global/db/reset` call `Project.findByRegisteredDirectory(...)` immediately after body validation and before `hasActiveSessions()`, `Instance.disposeAll()`, or `Database.reset(...)`.
- Reject unknown absolute paths with the documented 400 response shape and leave filesystem state untouched.
- Pass the registered directory spelling to `Database.reset(...)`, not the caller's raw spelling, so equivalent paths with trailing separators cannot select a different target.
- Keep `Database.reset(...)` unchanged for CLI reset/recovery; no fallback, route gate, or compatibility path was added.
- Regenerate `packages/sdk/openapi.json` so `api:routes-check` matches the current route inventory.

### Regression Tests

- Extend `packages/opencorvus/test/server/global-db-destructive.test.ts`:
  - relative `projectDir` returns 400 before `Instance.disposeAll()` or `Database.reset(...)`;
  - unknown absolute `projectDir` returns 400 and preserves sentinels under `.opencorvus/r` plus all legacy runtime paths;
  - registered primary worktree with trailing separator succeeds and passes the registered path to `Database.reset(...)`;
  - registered sandbox with trailing separator succeeds and passes the registered sandbox path to `Database.reset(...)`;
  - the existing MySQL import dispose-failure test no longer assumes cross-file test isolation owns every project row.
- Keep `packages/opencorvus/test/storage/db-path.test.ts` covering direct `Database.reset(...)` filesystem deletion and relative-path rejection.
- Keep `packages/opencorvus/test/cli/db-reset.test.ts` covering CLI dispose-failure stop-before-delete semantics.

### Verification

- Focused BH-024 tests passed: `bun test packages/opencorvus/test/server/global-db-destructive.test.ts packages/opencorvus/test/server/directory-required.test.ts packages/opencorvus/test/storage/db-path.test.ts packages/opencorvus/test/cli/db-reset.test.ts --timeout 90000`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- API route inventory passed after regenerating tracked OpenAPI: `bun run api:routes-check`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Descartes confirmed clean HEAD still had BH-024: unknown absolute `projectDir` returned 200 and deleted sentinel files under runtime and legacy scratch directories.
- Descartes confirmed the repaired dirty tree rejected relative and unknown absolute inputs before `Instance.disposeAll()` / `Database.reset(...)`.
- Descartes called out the Overlay `activeDirectory()` sandbox boundary; the final repair accepts registered sandboxes as registered project directories while still rejecting unknown absolute paths.
- Descartes confirmed CLI reset is a separate `process.cwd()` caller and should not receive route-level registered-project semantics.

## Batch P2-BS: BH-025 project directory transport must preserve literal percent sequences

### Findings

- BH-025 targets the project-directory request boundary in `packages/opencorvus/src/server/server.ts` and the SDK directory transport in `packages/sdk/js/src/client.ts`.
- Hono already returns `c.req.query("directory")` after URL query decoding. The old `decodeProjectDirectory(...)` decoded that value again, so a literal path component such as `literal%2Fname` arrived as `literal/name`.
- The same helper was also used by the PTY websocket connect route, so fixing only the main middleware would have left a second project-directory entry point with the same bug.
- The SDK used `x-opencorvus-directory` as a percent-encoded header for non-ASCII paths. Headers do not have URL decoding semantics, and decoding that header on the server conflicts with legitimate percent characters in filesystem paths.
- Overlay already injects directory through URL/transport query values; its contract needed explicit coverage that `URLSearchParams` encodes the literal percent sign once as `%25`.

### Call-point Inventory

- `packages/opencorvus/src/server/server.ts` is the project-scoped route middleware and now calls `selectProjectDirectory(...)` without percent-decoding.
- `packages/opencorvus/src/server/routes/pty.ts::GET /pty/:ptyID/connect` is the websocket project scope entry point and now uses the same selector.
- `packages/opencorvus/src/server/directory.ts::selectProjectDirectory(...)` is the single server helper for choosing query over header without transforming the value.
- `packages/sdk/js/src/client.ts::createOpenCorvusClient(...)` now injects configured project directory through request query parameters for project-scoped routes.
- `@opencorvus-ai/transport-protocol::routeRequiresProjectDirectory(...)` remains the shared route policy used by server, overlay, and SDK.
- `packages/overlay/src/services/api.ts` continues to inject directory through `URLSearchParams` and HostTransport query data.

### Fix Shape

- Replace `decodeProjectDirectory(...)` with `selectProjectDirectory(...)`; the server no longer calls `decodeURIComponent(...)` on project directories.
- Keep query precedence over header, but treat both values as already-literal request values instead of encoded payloads.
- Update the PTY websocket route to use the same helper so there is no second directory decoding path.
- Move SDK configured-directory transport from `x-opencorvus-directory` header mutation to a fetch wrapper that appends `?directory=` only for routes that require project scope.
- Preserve SDK MINGW/MSYS path normalization before query injection.
- Add `@opencorvus-ai/transport-protocol` as the SDK dependency so route scope policy is not duplicated.
- Do not add path probing fallback, literal-vs-decoded fallback, `%2F` gates, or compatibility decoding.

### Regression Tests

- Extend `packages/opencorvus/test/server/directory-required.test.ts`:
  - create sibling `literal%2Fname` and `literal/name` directories and assert query `directory=` resolves to the literal percent directory;
  - assert `x-opencorvus-directory` header also preserves the literal percent directory;
  - assert `selectProjectDirectory(...)` itself preserves literal query/header values and prefers query.
- Extend `packages/opencorvus/test/server/sdk-client-auth.test.ts`:
  - configured SDK directory injects query scope for project routes;
  - configured SDK directory does not inject global routes;
  - non-ASCII directory values are carried through query without header encoding.
- Extend `packages/overlay/test/api-directory-injection.test.ts`:
  - `apiUrl("tasks")` encodes literal `%2F` as `%252F` while `searchParams.get("directory")` remains the literal path;
  - HostTransport query injection preserves the literal `%2F` value.

### Verification

- Focused BH-025 server/SDK tests passed: `bun test packages/opencorvus/test/server/directory-required.test.ts packages/opencorvus/test/server/sdk-client-auth.test.ts --timeout 90000`.
- Focused overlay directory injection tests passed: `bun test packages/overlay/test/api-directory-injection.test.ts --timeout 60000`.
- SDK typecheck passed: `bun run --cwd packages/sdk/js typecheck`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Root typecheck passed: `bun typecheck`.
- SDK import boundary check passed: `bun run check:sdk-imports`.
- API route inventory passed: `bun run api:routes-check`.
- Docs check passed: `bun run docs:check`.
- Overlay i18n check passed: `bun run overlay:i18n-check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Huygens confirmed `HEAD` before the repair still reproduced BH-025 because `directory` query values were decoded by Hono and then decoded again by server helper logic.
- Huygens confirmed the repaired tree no longer reproduced the issue for query or header directory transport.
- Huygens identified PTY websocket connect as a second call point that had to share the same helper.
- Huygens recommended direct selector coverage plus overlay literal `%2F` transport coverage; both are now in the regression suite.

## Batch P2-BT: BH-043 staged attachment display filenames must not alias different blobs

### Findings

- BH-043 targets `packages/opencorvus/src/storage/attachment-store.ts::AttachmentStore.stageToWorktree(...)`.
- The old staging logic mapped every multimodal attachment to `references/<displayFilename>`, then skipped `fs.copyFile(...)` whenever that destination already existed.
- Two different blobs with the same safe display filename, such as two uploaded `screenshot.png` images, therefore returned the same `relPath` and left the second staged reference pointing at the first blob's bytes.
- The issue is not in the content-addressed blob store. `AttachmentStore.write(...)` already stores distinct bytes under distinct sha names; the loss happened only when converting blob references into human-readable worktree `references/` files.
- Preserving a pre-existing staged file is still required for goal retries and for user/tool edits inside the worktree. The fix must distinguish "same content, reuse" from "different content, allocate a distinct path" instead of treating every existing path as equivalent.

### Call-point Inventory

- `packages/opencorvus/src/storage/attachment-store.ts::stageToWorktree(...)` is the single path allocator for staged multimodal attachment files.
- `packages/opencorvus/src/build/agent.ts::buildAgent(...)` is the production caller and renders the returned `relPath` values into the build agent prompt through `renderStagedList(...)`.
- `packages/opencorvus/src/build/agent.ts::collectBuildReferenceAttachments(...)` gathers `task.attachments` plus visual-reference `task.system_artifacts` and deduplicates by `sha ?? url`, not by display filename. Same-name different-content inputs are therefore valid and must be staged distinctly.
- `packages/opencorvus/src/task-api/index.ts` write paths preserve caller filenames while attachment tables deduplicate by sha, so same-name different-blob attachments can be produced by task creation, later task messages, and visual-reference artifacts.
- The lower-level `AttachmentStore.write(...)`, `read(...)`, and `resolveAbsolute(...)` APIs remain content-addressed and do not need staging-specific filename policy.

### Fix Shape

- Replace path-existence-only staging with content-aware destination selection.
- Reuse `references/<displayFilename>` only when the existing file's SHA-256 equals the source blob's SHA-256.
- When the display path exists with different content, stage the source under deterministic `stem-<sha8><ext>` naming.
- If that deterministic collision path exists with the same content, reuse it for re-entrant staging.
- If that deterministic collision path exists with different content, throw `AttachmentStore.stageToWorktree: staged filename collision ...` instead of overwriting, skipping, or inventing another path.
- Keep the fix inside `stageToWorktree(...)`; no task API merge rule, build-agent prompt rule, fallback path, or compatibility branch was added.
- Tighten the helper existence check so only `ENOENT` means "absent"; permission and filesystem errors propagate.

### Regression Tests

- Extend `packages/opencorvus/test/storage/attachment-stage.test.ts`:
  - same-content re-runs reuse the same staged `relPath`;
  - mutated/pre-existing staged files are preserved and the source blob is staged under a deterministic sha-suffixed filename;
  - two different same-name image attachments in the same staging call produce distinct `relPath` values and both staged files match their source bytes;
  - restaging the second blob alone reuses the same sha-suffixed path;
  - a pre-existing sha-suffixed path with different content rejects with the explicit hard collision error and leaves both existing files unchanged.

### Verification

- Focused attachment staging tests passed: `bun test packages/opencorvus/test/storage/attachment-stage.test.ts packages/opencorvus/test/storage/attachment-display-filename.test.ts packages/opencorvus/test/storage/attachment-project-isolation.test.ts --timeout 60000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Root typecheck passed: `bun typecheck`.
- API route inventory passed: `bun run api:routes-check`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Helmholtz confirmed `HEAD` before the repair still reproduced BH-043: both different blobs returned `references/screenshot.png`.
- Helmholtz confirmed the production entry point is build-agent staging and that upstream task/artifact write paths legitimately allow same display filename with different sha values.
- Helmholtz recommended keeping the repair boundary inside `AttachmentStore.stageToWorktree(...)` and using deterministic `stem-<sha8><ext>` allocation.
- Helmholtz requested a hard-collision regression where `references/screenshot-<sha8>.png` is already occupied by different content; that test is now included.

## Batch P2-BU: BH-044 terminal tool updates must preserve the first terminal state

### Findings

- BH-044 targets `packages/opencorvus/src/session/index.ts::Session.updatePart(...)`.
- Tool part writes use `insert(...).onConflictDoUpdate({ set: { data } })`, so every accepted update replaces the entire persisted part payload.
- The old monotonicity check ranked `completed` and `error` equally and only skipped updates when `newRank < oldRank`.
- Because equal-rank terminal updates were still accepted, a stale `error` update could overwrite an already persisted `completed` tool result, and a stale `completed` update could overwrite an already persisted `error` failure.
- The right invariant is first-terminal-wins between different terminal statuses. Same-terminal updates must still be allowed because compaction refreshes completed tool metadata such as `time.compacted`.

### Call-point Inventory

- `packages/opencorvus/src/session/index.ts::Session.updatePart(...)` is the single durable write boundary for message parts and the single place where tool status monotonicity belongs.
- `packages/opencorvus/src/session/message.ts` defines the tool state union: `pending`, `running`, `completed`, and `error`.
- Production callers converge through `Session.updatePart(...)`, including session processor, session loop, shell execution, batch tools, engine writer shutdown cleanup, control messages, server session routes, and session compaction.
- `packages/opencorvus/src/session/compaction.ts` performs same-status completed updates to mark compacted tool output, so terminal handling cannot ban every terminal-to-terminal write.

### Fix Shape

- Keep the status rank model but type it as `Record<Message.ToolPart["state"]["status"], number>` so new tool statuses must update the comparator explicitly.
- Add a typed `TERMINAL_TOOL_STATUS` set for `completed` and `error`.
- Skip updates when the new status has lower rank than the persisted status.
- Also skip updates when the persisted and incoming statuses have equal rank, differ from each other, and the persisted status is terminal.
- Allow same-status terminal writes, preserving compaction metadata refreshes and other legitimate idempotent updates.
- Keep the fix inside the durable write boundary; no processor, engine, route, or UI-side gate was added.

### Regression Tests

- Add `packages/opencorvus/test/session/tool-status-monotonicity.test.ts`:
  - `completed -> error` preserves the persisted completed output;
  - `error -> completed` preserves the persisted failure;
  - stale terminal updates do not publish `message.part.updated`, so observers do not see an event for data that was not persisted;
  - `completed -> completed` can refresh `time.compacted`, proving same-terminal updates still work.

### Verification

- Focused session monotonicity and adjacent tests passed: `bun test packages/opencorvus/test/session/tool-status-monotonicity.test.ts packages/opencorvus/test/session/part-delta.test.ts packages/opencorvus/test/session/session.test.ts packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts --timeout 90000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- API route inventory passed: `bun run api:routes-check`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Carson confirmed `HEAD` before the repair still allowed `completed -> error` and `error -> completed` overwrites because equal terminal ranks flowed through `onConflictDoUpdate`.
- Carson confirmed all production writers converge through `Session.updatePart(...)`, so the fix should not be duplicated in processor, engine, build, or route call sites.
- Carson recommended a strong typed comparator instead of `Record<string, number>` with unknown-status fallback; the final repair uses `Message.ToolPart["state"]["status"]`.
- Carson requested event suppression and same-terminal refresh coverage; both are now in the regression suite.

## Batch P2-BV: BH-045 acceptance latest readers need deterministic same-ms tie-breaks

### Findings

- BH-045 targets the acceptance artifact readers in `packages/opencorvus/src/engine/store.ts`.
- Acceptance lifecycle rows are append-only `engine_artifact` rows with `kind="acceptance"` and the same logical `acceptance_id`.
- `latestPerAcceptance(...)` intentionally keeps the first row for each logical acceptance id, so every caller must pass rows sorted newest-first.
- The four public acceptance readers sorted only by `time_created DESC`. Same-millisecond lifecycle rows could therefore keep the stale `candidate` row before a later `delivered` or `publishing` row.
- `packages/opencorvus/src/engine/persist.ts::findLatestAcceptanceArtifact(...)` had the same ordering gap for lifecycle writers such as `markAcceptancePublishing(...)` and `finalizeAcceptanceResult(...)`.
- Neighboring artifact readers already use `time_created DESC, id DESC` for same-millisecond determinism, including run and acceptance-verdict readers.

### Call-point Inventory

- `findAcceptanceByRun(...)` reads task-level acceptance rows for a run.
- `findLatestAcceptanceForRun(...)` reads the latest acceptance for a run, including goal-run deliveries.
- `findDeliveriesForTask(...)` reads all latest acceptance deliveries for a task.
- `findAcceptanceByGoalRun(...)` reads the latest acceptance bound to a goal run.
- `latestPerAcceptance(...)` collapses the append-only stream and depends on caller ordering.
- `findLatestAcceptanceArtifact(...)` in `persist.ts` is the private lifecycle-writer reader used before appending publishing/final result rows.

### Fix Shape

- Add `desc(EngineArtifactTable.id)` as the secondary order key to every acceptance latest reader.
- Apply the same secondary ordering in `persist.ts::findLatestAcceptanceArtifact(...)`.
- Update comments in `store.ts`, `persist.ts`, and `engine.sql.ts` so the documented latest rule is `time_created desc, id desc`.
- Do not add fallback reads, repair gates, or in-memory resorting inside `latestPerAcceptance(...)`; the single source of truth is deterministic SQL ordering at the reader boundary.

### Regression Tests

- Add `packages/opencorvus/test/engine/acceptance-latest-order.test.ts`:
  - same-time task-level acceptance rows keep the highest artifact id as latest across `findAcceptanceByRun(...)`, `findLatestAcceptanceForRun(...)`, and `findDeliveriesForTask(...)`;
  - same-time goal-run acceptance rows keep the highest artifact id as latest across `findAcceptanceByGoalRun(...)`, `findLatestAcceptanceForRun(...)`, and `findDeliveriesForTask(...)`;
  - `markAcceptancePublishing(...)` copies the payload from the same-time highest-id acceptance row, covering the private `persist.ts` helper.
- The fixture inserts minimal `verification-evidence` artifacts for synthetic acceptance rows so it does not violate engine state invariants while exercising read-model ordering.

### Verification

- Focused BH-045 tests passed: `bun test packages/opencorvus/test/engine/acceptance-latest-order.test.ts --timeout 60000`.
- Adjacent start-new-attempt tests passed: `bun test packages/opencorvus/test/engine/start-new-attempt.test.ts --timeout 90000`.
- Engine invariant tests passed independently: `bun test packages/opencorvus/test/engine/state-invariants.test.ts --timeout 60000`.
- OpenCorvus typecheck passed: `bun run --cwd packages/opencorvus typecheck`.
- Package test-entry guard passed: `bun test packages/opencorvus/test/script/package-test-entry.test.ts --timeout 60000`.
- API route inventory passed: `bun run api:routes-check`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Aquinas confirmed `HEAD` still had BH-045 in all four public acceptance readers because `latestPerAcceptance(...)` first-seen collapse received rows sorted only by `time_created`.
- Aquinas identified `persist.ts::findLatestAcceptanceArtifact(...)` as the adjacent same-root lifecycle helper; it is now sorted by `time_created desc, id desc`.
- Aquinas recommended updating `engine.sql.ts` and helper comments to document the deterministic latest rule; those comments now match the implementation.
- Aquinas pointed to existing `findRun`, `findGoalRun`, and acceptance-verdict readers as local precedent for `id desc` same-millisecond ordering.

## Batch P2-BW: BH-052 workspace onboarding must surface discovery failures

### Findings

- BH-052 targets workspace discovery behavior in `packages/overlay/src/services/workspace.ts` and `packages/overlay/src/components/WorkspaceOnboardingDialog.tsx`.
- `loadDiscoveredProjects()` already propagates `apiJson("global/projects/discover")` failures, and `ensureDefaultDirectory()` already lets those failures reject during initialization.
- The UI bug was in `WorkspaceOnboardingDialog`: its mount-time discovery call caught every failure and set `discoveredRoot` to `""` plus `discoveredProjects` to `[]`, making API, server, or authentication failures indistinguishable from "no discovered projects".
- The same root pattern exists in `TaskDirBar` discovery handling, but BH-052's recorded regression surface is the no-directory onboarding dialog. `TaskDirBar` remains an adjacent follow-up rather than being mixed into this onboarding repair.

### Call-point Inventory

- `packages/overlay/src/components/App.tsx` always mounts `WorkspaceOnboardingDialog`.
- `WorkspaceOnboardingDialog` opens when `settingsStore.directory` is empty and owns the initial project-discovery rows shown before recent directories.
- `WorkspaceOnboardingDialog` previously called `loadDiscoveredProjects()` directly and swallowed failures in the component.
- `packages/overlay/src/services/workspace.ts::loadDiscoveredProjects()` owns the `global/projects/discover` API request.
- `packages/overlay/src/services/workspace.ts::ensureDefaultDirectory()` calls `loadDiscoveredProjects()` during initialization and already rejects on discovery failure.
- `packages/overlay/src/components/TaskDirBar.tsx` also calls `loadDiscoveredProjects()` for the current-directory dropdown and is documented as an adjacent same-root issue for a later batch.

### Fix Shape

- Add `packages/overlay/src/services/workspace-onboarding-discovery.ts` as the onboarding presentation adapter around `loadDiscoveredProjects()`.
- Keep service-level discovery fail-fast. The adapter returns an explicit discriminated UI state: `{ status: "ready", root, projects }` or `{ status: "failed", message }`.
- Replace the component-level catch-and-clear path with an explicit `discoveryError` signal rendered in the onboarding dialog.
- Do not convert failed discovery to an empty project list, and do not add retry, gate, compatibility, or hidden fallback behavior.
- Add English and Chinese internationalization strings for the visible discovery failure message.
- Add a Cascading Style Sheets block for the visible onboarding error row using existing surface tokens.

### Regression Tests

- Extend `packages/overlay/test/workspace-discovery-service.test.ts` so direct `loadDiscoveredProjects()` failures preserve the `ApiError` status, path, body, and message.
- Extend `packages/overlay/test/workspace-onboarding-surface.test.ts` so onboarding failure state returns a visible failure message and the component no longer contains the catch-and-clear project-list path.
- Extend `packages/overlay/test/browser/workspace-onboarding-browser.test.ts` with a real browser fixture returning 503 from `/global/projects/discover`; assert the onboarding error row is visible, the directory remains empty, no detected-project rows render, and the manual path form remains available.
- Save and inspect `.scratch/workspace-onboarding-discovery-error.png` for the visual state.

### Verification

- Focused service and surface tests passed: `bun test packages/overlay/test/workspace-onboarding-surface.test.ts packages/overlay/test/workspace-discovery-service.test.ts --timeout 60000`.
- Real browser onboarding test passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/workspace-onboarding-browser.test.ts`.
- Visual review passed for `.scratch/workspace-onboarding-discovery-error.png`.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Overlay internationalization check passed: `bun run --cwd packages/overlay check:i18n`.
- API route inventory passed: `bun run api:routes-check`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Pasteur confirmed `HEAD` still had BH-052 because `WorkspaceOnboardingDialog` caught discovery failures and wrote empty discovery state.
- Pasteur confirmed `loadDiscoveredProjects()` and `ensureDefaultDirectory()` already propagated rejection, so the repair belongs at the onboarding presentation layer instead of the shared workspace service.
- Pasteur recommended a real browser onboarding regression in addition to source-level checks; the browser test now exercises the visible error row and screenshot evidence.
- Pasteur identified `TaskDirBar` as an adjacent same-root UI swallow; it is recorded for a later batch because this batch is scoped to the BH-052 onboarding surface.

## Batch P2-BX: BH-053/BH-054/BH-055/BH-056/BH-058 Hexin budget selector identity and visual coverage

### Findings

- BH-053 was only partially repaired in the previous Hexin selector batch. `ExecutorSelector.tsx` keyed the budget resource by active directory, model, task id, session-config refresh, and timer tick, but it still omitted a provider/auth refresh identity. Saving or rotating the Hexin API key through Settings could leave the same model and directory budget resource cached until the 10-minute timer.
- BH-054 production code already formatted budget numbers with `localeTag()`, but the bug-hunt tracker had no batch proving that the app locale remained the source for selector budget formatting.
- BH-055 was only partially repaired. The inline budget span used `role="status"` and `aria-live="polite"`, but an error rendered as generic `Hexin error` without a useful accessible retry context.
- BH-056 was still under-covered because the browser redesign test used DOM and layout assertions plus unrelated full-page screenshots. It did not require a budget-specific screenshot or pixel evidence for the low-balance red state.
- BH-058 was adjacent to the same route and policy surface: `provider/hexin/budget` was not explicitly enumerated in `api-directory-injection.test.ts`.

### Call-point Inventory

- `packages/overlay/src/components/ExecutorSelector.tsx` builds `hexinBudgetBaseKey`, creates the `createResource(hexinBudgetKey, ...)`, formats values with `localeTag()`, and renders `[data-ui="executor-hexin-budget"]` inside the OpenCorvus chip meta row.
- `packages/overlay/src/services/config.ts::getHexinBudget()` calls `apiJson("provider/hexin/budget")`; directory query injection is owned by the shared transport policy.
- `packages/overlay/src/services/init.ts::loadConfigInfo()` and `loadProviderInfo()` are the real provider catalog/auth reload points used by startup and Settings provider saves.
- `packages/overlay/src/components/settings/ProvidersPanel.tsx::handleSaveApiKey()` is the real Hexin key rotation path: `PUT /auth/hexin`, `PATCH /config`, `POST /provider/hexin/refresh`, then `loadProviderInfo()`.
- `packages/overlay/test/browser/executor-selector-redesign.test.ts` owns the browser fixture and the dual-chip visual acceptance for the selector surface.
- `packages/overlay/test/api-directory-injection.test.ts` owns overlay-side route directory injection coverage and calls the shared `routeRequiresProjectDirectory(...)` policy.

### Fix Shape

- Add `appStore.providerAuthRefreshRevision`, a monotonic provider authentication refresh revision incremented when provider catalog/auth data is reloaded through `loadConfigInfo(..., { includeSettingsData: true })`, `loadProviderInfo()`, or the store helper setters.
- Add `providerAuthRefresh: appStore.providerAuthRefreshRevision` to `hexinBudgetBaseKey` so the Solid resource refetches after real provider auth/key refreshes without adding polling or compatibility behavior beyond the existing 10-minute refresh.
- Keep app-locale formatting single-sourced through `new Intl.NumberFormat(localeTag(), ...)`.
- Add a localized `executor.hexin_budget_retry_context` string and expose it through the budget status `title` and `aria-label` when provider or transport errors occur.
- Add the concrete `provider/hexin/budget` route to the injection test inventory.
- Extend the browser selector test to capture `[data-ui="executor-hexin-budget"]` directly, analyze the PNG for nonblank content and red-dominant low-budget pixels, switch directory through `window.applyDirectory(...)`, and rotate Hexin auth through the real Settings provider save path.

### Regression Tests

- `packages/overlay/test/executor-selector-dualbar.test.ts` now rejects a Hexin budget key missing `providerAuthRefresh: appStore.providerAuthRefreshRevision`, rejects losing `aria-label={title()}`, and requires the retry-context i18n key in both locales.
- `packages/overlay/test/api-directory-injection.test.ts` now explicitly expects `provider/hexin/budget` to inject project directory and to agree with `routeRequiresProjectDirectory(...)`.
- `packages/overlay/test/browser/executor-selector-redesign.test.ts` now asserts:
  - initial budget request carries `directory=D:/overlay/workspace/app`;
  - the inline budget has `role="status"`, `aria-live="polite"`, and a value/title using app-locale formatting;
  - `.scratch/executor-selector-hexin-budget-inline.png` exists, is nonblank, and includes red-dominant low-balance pixels;
  - switching to `D:/overlay/workspace/next` with the same Hexin model triggers a new budget request with the new directory;
  - saving a rotated Hexin API key through Settings triggers a fresh budget request without waiting for the 10-minute timer;
  - switching OpenCorvus away from Hexin removes the budget and subsequent request logs remain project-scoped.

### Verification

- Focused selector and directory tests passed: `bun test packages/overlay/test/executor-selector-dualbar.test.ts packages/overlay/test/api-directory-injection.test.ts --timeout 60000`.
- Real browser selector test passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/executor-selector-redesign.test.ts`.
- Visual review passed for `.scratch/executor-selector-hexin-budget-inline.png`; the screenshot shows the compact inline Hexin budget in the low-balance red state.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Overlay internationalization check passed: `bun run --cwd packages/overlay check:i18n`.
- API route inventory passed: `bun run api:routes-check`.
- Docs check passed: `bun run docs:check`.
- Production secret scan passed: `bun run script/secret-scan.ts`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Volta confirmed BH-053 still existed because the key lacked auth/provider refresh identity even after directory/model/task/timer keying landed.
- Volta confirmed BH-054 production code used `localeTag()` but lacked explicit tracker coverage.
- Volta confirmed BH-055 still lacked meaningful retry context even though status semantics were present.
- Volta confirmed BH-056 still lacked a budget-specific visual screenshot artifact and pixel-level assertion.
- Volta recommended repairing BH-053 through BH-056 together because they share the same component resource, browser fixture, and selector visual surface; BH-058 was kept in the same batch only as route-policy test coverage for the same endpoint.

## Batch P2-BY: BH-057 remove stale overlay direct-reply kind mirror

### Findings

- BH-057 targets `packages/overlay/src/utils/direct-reply-kinds.ts`.
- The module was no longer used by production overlay code. `Card.tsx` and `ChatBubble.tsx` already render `AgentSessionReplyBox` for every non-root agent session instead of using `canReceiveDirectAgentReply(...)` as a UI filter.
- The remaining mirror duplicated `packages/opencorvus/src/orchestrator/direct-reply.ts::DIRECT_REPLY_AGENT_KINDS` and its comment still documented structured 4xx refusal semantics.
- Current backend behavior is more nuanced: invalid direct replies with attachments still reject as structured errors, but many non-directable plain text replies intentionally become targeted task-root operator wakes with `202`. Keeping a frontend kind whitelist as a route-capability source is therefore stale and violates the single-source rule.
- The equality test `packages/overlay/test/direct-reply-kinds.test.ts` preserved the double-source mirror instead of proving the overlay had stopped relying on it.

### Call-point Inventory

- `packages/overlay/src/utils/direct-reply-kinds.ts` exported `DIRECT_REPLY_AGENT_KINDS` and `canReceiveDirectAgentReply(...)`.
- `packages/overlay/test/direct-reply-kinds.test.ts` imported the overlay mirror and backend canonical set only to assert equality.
- `packages/overlay/test/agent-reply-box-structured-errors.test.ts` already asserted `Card.tsx` and `ChatBubble.tsx` do not call `canReceiveDirectAgentReply(...)`.
- `packages/overlay/src/components/AgentSessionReplyBox.tsx` owns visible reply-box error diagnostics and remains the only overlay direct-reply response handling surface.
- `packages/opencorvus/src/orchestrator/direct-reply.ts` remains the backend source for direct-reply and session-control kind sets.
- `packages/opencorvus/test/server/reply-error-taxonomy.test.ts` is the backend contract proving targeted task-root wake behavior and the attachment rejection exception.

### Fix Shape

- Delete the unused overlay mirror module.
- Delete the equality test that kept the mirror alive.
- Extend `agent-reply-box-structured-errors.test.ts` with a source scan over `packages/overlay/src` proving there is no `DIRECT_REPLY_AGENT_KINDS`, `canReceiveDirectAgentReply`, `direct-reply-kinds`, or stale `structured 4xx` wording in overlay production source.
- Keep backend direct-reply kind sets unchanged. This batch does not add `build` to generic direct reply and does not change task-root operator guidance behavior.

### Regression Tests

- `packages/overlay/test/agent-reply-box-structured-errors.test.ts` now rejects reintroducing an overlay direct-reply kind mirror while preserving the existing assertions that `Card.tsx` and `ChatBubble.tsx` keep every non-root agent session replyable in the UI.

### Verification

- Focused overlay test passed: `bun test packages/overlay/test/agent-reply-box-structured-errors.test.ts --timeout 60000`.
- Overlay source residual scan passed: `rg -n "direct-reply-kinds|DIRECT_REPLY_AGENT_KINDS|canReceiveDirectAgentReply|structured 4xx" packages/overlay/src -g "*.ts" -g "*.tsx"` returned no matches.
- Overlay typecheck passed: `bun run --cwd packages/overlay typecheck`.
- Docs check passed: `bun run docs:check`.
- Diff whitespace check passed: `git diff --check`.

### Independent Review Feedback

- Fermat confirmed BH-057 was still present in committed `HEAD`, with the mirror unused by production overlay code and imported only by `packages/overlay/test/direct-reply-kinds.test.ts`.
- Fermat confirmed the authoritative direct-reply kind source remains `packages/opencorvus/src/orchestrator/direct-reply.ts`, while runtime policy and 202 task-root wake behavior live in `packages/opencorvus/src/task-api/index.ts`.
- Fermat recommended deletion rather than replacement because a generated or manually synced overlay mirror would still be a second policy source.
- Fermat explicitly warned not to mix backend BH-026/BH-027 contract reconciliation or build task-message `target` changes into this batch.
