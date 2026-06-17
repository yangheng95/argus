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
