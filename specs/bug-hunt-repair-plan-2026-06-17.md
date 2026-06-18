# Bug Hunt Repair Plan - 2026-06-17

## Objective

Repair the substantive findings recorded in `specs/bug-hunt-2026-06-17.md` by priority. This plan is append-only by batch: each batch records the disk evidence, call-point inventory, fix shape, and regression tests before code changes.

Glossary: TLS means Transport Layer Security. API means Application Programming Interface. HMAC means Hash-based Message Authentication Code. STT means Speech To Text. UI means User Interface.

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
