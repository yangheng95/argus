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
