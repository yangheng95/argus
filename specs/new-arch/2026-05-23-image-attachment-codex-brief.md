# Brief for Codex: Image Attachment Transport & Capability

你接手一项已经写好初版 spec 的工程任务。**完整 spec 在 `specs/new-arch/2026-05-23-image-attachment-transport-and-capability.md` 里**，先读它。

## 你的职责

1. **严格审查 spec**（rule 11 - 拦截违反 OOP / 抽象的设计；rule 35 - 穷举调用点；rule 24 - 二次 review）。把审查结论以 `## Codex Review` 区段直接追加到 spec 末尾。审查必须输出**具体反对意见、缺漏点、风险新发现**——不许只写"方案合理"这种空话。重点核对：
   - `provider/transform.ts:170 ProviderTransform.message()` 是不是唯一汇聚点？有没有跳过 transform.message 直接走 AI SDK 的旁路？
   - `inlineLocalAttachments` 改成 async 后，所有调用方的级联改动是否完整穷举（rule 35）？包括 streaming / non-streaming / structured-output / tool-result paths.
   - data URL 在 AI SDK 各 provider 里是否真的都被原地 decode（不二次 fetch）？尤其 `@ai-sdk/google` / `@ai-sdk/google-vertex` / `@ai-sdk/amazon-bedrock`（spec 没明确说这些）。
   - 现有 `attachment-capability-gate.test.ts` 行为是否会被本次改动破坏？
   - `unsupportedParts` 替换成 ERROR text 的逻辑在 Layer 1 完成后是否还需要？
   - `kimik26` flip 后还有哪些隐性副作用（比如 modalities.input 增加 "image" 是否会改变 `mimeToModality` 路径）？
   - 仓内是否已有"local URL → base64"的工具函数可复用，避免造新轮子（rule 9 - 主动抽象设计模式）？

2. **基于 spec 实施 Layer 1（transport universal inline base64）+ kimik26 capability flip**。具体硬约束：
   - 在 `ProviderTransform.message()` 中加入 `inlineLocalAttachments`，**所有 outbound `type: "file"` part** 中 url 形如 `/attachment/<projectID>/<sha>.<ext>` 的，inline 成 `data:<mime>;base64,...`。
   - 修改 `message()` 签名为 async（一并改所有调用方；用 `Promise.all` 串行也行，不要并发 fs read 撕磁盘）。
   - 改 `builtin-test-providers.ts` 中 `kimik26`：`attachment: true`，`modalities.input: ["text", "image"]`。
   - **测试覆盖**（rule 36）按 spec §3.1 / §3.2 全部写。集成测试用 `OPENCORVUS_INTEGRATION=1` 门控，CI 默认 skip。
   - 不许用 `--no-verify` 绕 hook（rule 33）。pre-push hook 跑 typecheck / api:routes-check / docs:check，挂了就修根因。
   - 不许加 fallback / 双源 / 状态机式 if-else（rule 7 / 8 / 13 / 20）。
   - 不许碰 Layer 2（capability probe）——那是独立 PR，本次只做 Layer 1 + kimik26 flip。
   - 不许碰当前 branch 已有的 overlay 半截重构（不属于本任务范围；如果它阻塞 build:overlay 可以 skip overlay 验收，但不能擅自删它）。

3. **commit + push**：
   - 落 commit 前先把 spec（含你的 Codex Review 追加）一并 stage。
   - commit message 形如 `fix(provider): inline base64 image attachments for openai-compatible transport`，正文说明根因 + Layer 1 范围 + kimik26 flip。
   - push 到 `origin/codex/task-session-runtime-isolation`（当前分支）。

## 验收

- `bun test packages/opencorvus/test/provider/transform.test.ts` 全过
- `bun test packages/opencorvus/test/storage/attachment-capability-gate.test.ts` 全过（如果你改了它的预期，必须解释为什么）
- 集成测试（如果你启用 `OPENCORVUS_INTEGRATION=1` 自验）：CZ kimik26 网关 1x1 PNG 能 200 + reasoning_content 描述像素
- pre-push hook 全过
- spec 末尾有你的 `## Codex Review` 区段

## 上下文（可能影响判断）

- 当前分支 `codex/task-session-runtime-isolation`，最新 commit `a635d7e4e`（task session runtime isolation）。
- 这分支的 overlay 部分有半截重构，不是本任务范围。
- `bun.lock` / `package.json` 有未 stash 的本地改动（之前已 stash 走），工作区干净。
- 用户已实测 CZ kimik26 网关：远程 URL fetch 超时（gateway 不出公网），data URL 成功（HTTP 200 + 准确描述 1x1 PNG）。这是 spec §1.1 证据。
- 用户实测 `attachment: false` 是声明 drift 不是真不支持，所以 capability declaration 那一行（spec §1.2）必修。
- 不要因为这是 "claude code 写的 spec" 而手下留情——按工程标准严肃 challenge。
