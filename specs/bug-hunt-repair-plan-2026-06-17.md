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
