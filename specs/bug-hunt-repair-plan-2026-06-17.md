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
