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
