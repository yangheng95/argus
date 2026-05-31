# Image Attachment: Transport & Capability Single-Source

Date: 2026-05-23
Branch: codex/task-session-runtime-isolation
Author: 杨恒 + Claude session (Opus 4.7, 1M)

## 0. Problem (one paragraph)

Kimi / GLM / Qwen / 豆包 / MiniMax 等"OpenAI 兼容"系列模型在 opencorvus 里**几乎读不到图片**。两层独立但叠加的故障：

1. **传输层**：opencorvus 把附件 URL 写成 `/attachment/<projectID>/<sha>.<ext>`（`storage/attachment-store.ts:127`），透传给 AI SDK 的 `file` part。`@ai-sdk/anthropic` 自己 fetch+base64，**字节一定到位**；但 `@ai-sdk/openai-compatible` 直接把 URL 塞 `image_url.url`，让下游网关自己 fetch——而 CZ / Hexin / DashScope 等**内网网关 fetch 不出公网，也 reach 不到 opencorvus localhost**，结果统统 `ImageData load failed` / `HTTPSConnectionPool timeout`。Anthropic / OpenAI 通的，openai-compatible 全断。
2. **声明层**：`provider/builtin-test-providers.ts` 和 `provider/hexin-profiles.ts` 里中文系模型**系统性标 false**——Kimi K2.6 实测支持 vision（curl 直打 CZ Gateway 200 + reasoning_content 描述像素，见 §1.证据），仓内声明 `attachment: false`。即使传输修了，UI / `provider/transform.ts:155-163` 也会先把图片替换成 ERROR text。

两层缺一不可。**先修传输（更紧的瓶颈，标对了也得能送到）**，再修声明（capability runtime probe）。

## 1. 证据

### 1.1 传输断裂的复现

```bash
# 远程 URL：CZ Gateway 内网不出公网
curl -sS -X POST 'http://117.50.195.92:8080/gpt-oss-120b/kimik2/v1/chat/completions' \
  -d '{"model":"kimik26","messages":[{"role":"user","content":[
    {"type":"text","text":"What is in this image?"},
    {"type":"image_url","image_url":{"url":"https://upload.wikimedia.org/.../Cat03.jpg"}}
  ]}],"stream":false}'
# → "Connection to upload.wikimedia.org timed out. (connect timeout=3)"

# 同样请求，base64 inline：成功
curl ... -d '{... "image_url":{"url":"data:image/png;base64,iVBOR..."} ...}'
# → HTTP 200, reasoning_content: "image provided ... extremely small (1x1 pixel)"
```

### 1.2 声明 drift

`packages/opencorvus/src/provider/builtin-test-providers.ts`：
- L37 `glm-5.1-fp8`: `attachment: false`
- L64 `glm51`: `attachment: false`
- **L88 `kimik26`: `attachment: false`** — 实测 true

`packages/opencorvus/src/provider/hexin-profiles.ts`：
- L45 fallback profile: `attachment: false`
- L195 / L210 kimi family（两条）: `attachment: false` — 与 K2.5/K2.6 实际能力不符
- L226 / L253 glm family（两条）: `attachment: false` — GLM-4V / 5V 存在
- L267 qwen: `attachment: false` — Qwen-VL 存在
- L281 doubao: `attachment: false`
- L295 minimax: `attachment: false`

对照 Claude / GPT-5 / Gemini 全部 `attachment: true`，**只针对中文系系统性保守**。

### 1.3 传输链路调用点（rule 35 穷举）

构造 `{ type: "file", url, mediaType }` 的地方（流出 AI SDK 之前的所有调用点）：

| 路径 | 行 | 上下文 |
|---|---|---|
| `packages/opencorvus/src/session/message.ts` | 988-992 | tool result media re-injection |
| `packages/opencorvus/src/session/message.ts` | 749 | tool output → assistant attachments |
| `packages/opencorvus/src/agent/runner.ts` | 193, 588 | user prompt parts contract |
| `packages/opencorvus/src/acp/agent.ts` | 1306-1331 | ACP-to-internal file part conversion |
| 其余 builder：`session/prompt/parts.ts`、`build/agent.ts`、`frontend-design/agent.ts` | (需 codex 二次穷举) | agent 各自的 buildUserParts |

汇聚点：`provider/transform.ts:170 ProviderTransform.message()` ——所有 outbound 消息 100% 经过这里（在 `applyCaching` / `unsupportedParts` 之后调到 AI SDK 之前）。**这是唯一应当承担 inline-base64 的位置**——往上游分散到每个 builder 会重复 N 份、走回老的双源 trap（rule 8）。

### 1.4 capability 读点（rule 35 穷举）

`capabilities.input.image` / `attachment` 的所有读点：

| 路径 | 行 | 用途 |
|---|---|---|
| `provider/transform.ts` | 155-163 (`unsupportedParts`) | 把不支持的图替换成 ERROR text 给模型 |
| `mirror/tools/webpage-vision-judge.ts` | 156-160 | 强制要求 vision 才能跑 webpage_vision_judge |
| `mirror/tools/webpage-image-extract.ts` | 69-73 | 同上 |
| `storage/attachment-capability-gate.test.ts` | 全文 | 断言 gate 行为 |
| overlay 前端 | (需穷举：`packages/overlay/src` 中查 `attachment` 字段读处) | UI 上传 / 拖拽时的 gate |

## 2. 方案

### 2.1 Layer 1: Transport — Universal Inline Base64

**位置**：`ProviderTransform.message()` 内新增 `inlineLocalAttachments(msgs)`，紧跟 `unsupportedParts` 之后、`normalizeMessages` 之前。

**逻辑**：
```ts
async function inlineLocalAttachments(msgs: ModelMessage[]): Promise<ModelMessage[]> {
  // 遍历所有 user / tool 消息中的 file part；
  // 1. 已是 data: URL 跳过
  // 2. 是绝对 http(s) URL：留作 SDK 自处理（OpenAI 公网 / Anthropic 自 fetch；少数 vendor 可达）
  // 3. 是 opencorvus 内部 `/attachment/<projectID>/<sha>.<ext>`：
  //    - 调 AttachmentStore.nameFromUrl(url) → {projectID, name}
  //    - AttachmentStore.read(projectID, name) → bytes
  //    - 替换 url = `data:<mime>;base64,${bytes.toString("base64")}`
  // 4. read 失败：保留原 part，让 SDK / 网关报真实错误（不静默 fallback，rule 7）
}
```

**关键约束**：
- 必须 async（`message()` 当前是 sync——需要改签名，所有调用方一并改）。
- 不按 provider 分支（rule 8）：universal inline。Anthropic SDK 收到 data URL 直接解 base64，跳过它原本的 fetch；OpenAI 收到 data URL 也 OK；openai-compatible 修好。
- 不缓存 base64 字符串（每次重新读 fs，避免内存堆积）。fs cache 已经够快。
- PDF / audio / video 同样适用（同样的 transport 断裂）。

### 2.2 Layer 2: Capability — Runtime Probe + Cache

**目标**：让 `attachment` / `reasoning` / `tool_call` 等 capability 不再是手写常量，而是 runtime probe 一次性测出来，落 SQLite。

**新表**（`packages/opencorvus/src/provider/capability.sql.ts`）：
```ts
export const ProviderCapabilityTable = sqliteTable("provider_capability", {
  providerID: text().notNull(),
  modelID: text().notNull(),
  capability: text().notNull(),     // "attachment" | "tool_call" | "reasoning"
  supported: integer({ mode: "boolean" }).notNull(),
  evidence: text().notNull(),        // JSON: { probedAt, httpStatus, responseSnippet }
  // PK: (providerID, modelID, capability)
})
```

**Probe**（`packages/opencorvus/src/provider/capability-probe.ts`）：
- `probeAttachment(model)`：发一条 minimal vision request（1x1 PNG inline + 短文本 + max_tokens=32），按响应判定：
  - HTTP 200 + 响应里"看到图"或不报 image-related error → supported: true
  - HTTP 4xx + body 含 "image" / "vision" / "modality" → supported: false
  - HTTP 5xx 或网络错误 → 不写入，下次再 probe
- `probeToolCall(model)` / `probeReasoning(model)` 类似。

**触发时机**：
- Provider 首次"测试连接"按钮成功时：扇出 probe 这个 provider 下所有模型的所有 capability。
- 也提供 CLI `opencorvus capability probe [--provider X] [--model Y]` 手动刷新。
- **不在用户拖图的瞬间 probe**（UX 慢）。

**Profile 角色变化**：
- `builtin-test-providers.ts` / `hexin-profiles.ts` 里的 `attachment` 字段语义降级为**初始 hint**（DB 未 probe 过时的兜底）。
- Provider 资料显示 capability 时查 DB，DB miss 才回退到 profile hint。
- 这不算双源（rule 8）——profile 是 cold-start hint，DB 是权威，方向单一。

### 2.3 实施顺序

1. **L1 inline base64 改动** + 单元测试 + 集成测试（CZ 三个网关各发 1x1 PNG）→ commit + push
2. 把 `kimik26` 的 `attachment` 改成 true（最小修复，让用户能立即在 UI 拖图给 kimik26）→ commit + push
3. **L2 capability probe** spec 详化（新表 DDL / probe matrix / SDK 集成 / overlay UI 显示）→ 单独一个 PR

L1 + L2.step2 一个 PR 闭环（"立即能用"），L2 单独 PR（"系统性根治"）。

## 3. 测试矩阵（rule 36）

### 3.1 Layer 1 transport

- `test/provider/transform.test.ts` 新增：
  - case A: file part url=`/attachment/proj/sha.png` → mock AttachmentStore.read → assert output url=`data:image/png;base64,...`
  - case B: file part url=`data:image/jpeg;base64,abc` → assert 原样保留
  - case C: file part url=`https://example.com/x.png` → assert 原样保留（让 SDK 自处理）
  - case D: AttachmentStore.read throw → assert 原 part 保留（不被静默删除）
  - case E: mediaType=`application/pdf` → 同 case A 处理
  - case F: 多条消息混合 file/text part → assert 只动 file part
- `test/integration/openai-compatible-vision.test.ts` 新增（**真打三个 builtin 网关**，需 `OPENCORVUS_INTEGRATION=1` 环境变量门控）：
  - kimik26 / glm51 / iwc-aime（如果支持图）：发 1x1 PNG，assert HTTP 200 + 响应里能 reference 到图片
  - 一旦上游 capability drift，CI 失败

### 3.2 kimik26 capability flip

- `test/provider/builtin-test-providers.test.ts`：assert kimik26 `attachment === true && modalities.input.includes("image")`
- 上面 transport 集成测试同时覆盖

### 3.3 Layer 2 capability probe

- `test/provider/capability-probe.test.ts`：mock fetch，对 200/4xx/5xx 各种响应断言 probe 决策
- `test/provider/capability-store.test.ts`：DB 读写、TTL、override 行为
- 现有 `attachment-capability-gate.test.ts` 调整：让它读 DB 而非常量

## 4. 风险 & 反例

- **风险 A**：base64 膨胀让 cache key 改变 → Anthropic prompt cache miss 率上升。**缓解**：cache key 仅基于 messages 内容，原本就含 url；改成 data URL 一样是内容，cache 行为不变（且 cache breakpoint 在 `applyCaching` 内逐条 attach，并不哈希 file 内容）。
- **风险 B**：大图 inline 撑爆 request body。**缓解**：现有 attachment 上限 = 上传 gate 已经控制（`chat.attach_too_large_title` i18n key 引用了限制）。
- **风险 C**：Anthropic SDK 见到 data URL 仍二次 fetch（重复劳动）。**缓解**：AI SDK 对 data URL 短路 decode，无 fetch。
- **反例（rule 11 拦截）**：不要做"按 provider.npm 分支决定是否 inline"——双源 trap。统一 inline 是正解。
- **反例**：不要在 `unsupportedParts` 里悄悄把图替换成 ERROR text 时还输出"this model does not support image"——L2 修好后这种误判会消失；现在保留行为，但要在 L2 删掉这条不再适用的提示路径。

## 5. 验收

- L1 完成：CZ kimik26 + glm51 通过集成测试，能描述出 1x1 PNG 内容；`unsupportedParts` 单元测试全过；现有 `attachment-capability-gate` 行为不退化。
- L2 完成：profile 里所有 `attachment` 字段降级为 hint；DB 表落地；至少 builtin 三个 provider 首连后自动填充；CLI probe 命令可用；前端 UI 显示 capability 时优先查 DB。
- 两阶段都要：commit + push，pre-push hook（typecheck / api:routes-check / docs:check）必须过，不许 `--no-verify`（rule 33）。

## Codex Review

1. `ProviderTransform.message()` is the single production transform chokepoint only for wrapped language models. The main session path (`session/llm.ts`) and mirror vision tools (`mirror/tools/webpage-image-extract.ts`, `mirror/tools/webpage-vision-judge.ts`) use `ProviderLLM.wrapModel`, so their streaming, structured-output, and tool-result replay payloads pass through this transform. There are direct `streamText` callers that use `Provider.getLanguage()` without wrapping (`agent/agent.ts` agent generation, `gateway/decompose.ts`, `task-api/index.ts` follow-up suggestion, `server/routes/provider.ts` provider test). They are text-only today, so they do not block Layer 1, but the spec overstates "100% outbound messages" unless it scopes that claim to multimodal/session traffic. A future direct multimodal helper would bypass this fix unless it wraps the model.
2. The spec uses `url` for file parts, but AI SDK v6 canonical `ModelMessage` file parts use `data` plus `mediaType`; UI parts carry `url` only before `convertToModelMessages()`. `ProviderTransform.message()` runs on the canonical prompt inside the language-model middleware, so Layer 1 must inline `/attachment/...` found in `part.data` and should also cover legacy/ad-hoc `part.url` shapes in tests. Implementing only `url` would miss the real middleware payload.
3. Existing local URL to base64 logic is close but not a reusable exact fit. `AttachmentStore.inlineFileParts()` already resolves `/attachment/...` to data URLs, but it operates on attachment references before model-message construction and throws on unresolved URLs. `session/message.ts` also has a private `userFileUrl()` helper. Layer 1 should factor a small `AttachmentStore` helper for "attachment ref + MIME -> data URL" and reuse it from the provider transform, rather than creating a third independent read/base64 implementation.
4. Making `ProviderTransform.message()` async has a small but real cascade: the production middleware in `provider/llm.ts` must `await` it, and every direct unit test of `ProviderTransform.message()` must become async. The structured-output paths do not need separate call-site edits if they already pass a wrapped model, because AI SDK awaits async `transformParams`.
5. Data URL handling in installed AI SDK packages supports this approach. The AI SDK core (`ai/src/prompt/data-content.ts`) parses `data:<mime>;base64,...` into base64 content before provider conversion. `@ai-sdk/openai-compatible` turns image file parts into `image_url.url` and uses the provided base64 data when the part is not a URL. `@ai-sdk/google` parses data URLs and emits `inlineData`; `@ai-sdk/google-vertex` reuses the Google generative language model. `@ai-sdk/amazon-bedrock` rejects URL file parts but emits byte sources from non-URL data. This supports universal inlining and argues against provider-specific branching.
6. `unsupportedParts` still needs to remain in Layer 1. The transport fix makes capable models deliver bytes, but models whose profile still says `capabilities.input.image=false` must continue to reject/drop image parts until Layer 2 runtime probing replaces stale declarations. For `kimik26`, flipping both `attachment` and `modalities.input` is necessary: changing only `attachment` would leave `capabilities.input.image=false`, and `unsupportedParts` would still replace the image with ERROR text.
7. The `kimik26` flip has one intended side effect: `mimeToModality("image/png")` now passes because `Provider.from config` derives `capabilities.input.image` from `modalities.input`. It should not change PDF/audio/video behavior, since only `"image"` is added. The existing `attachment-capability-gate.test.ts` should not change because it exercises `AttachmentStore.inlineFileParts()` with explicit capability objects, not provider profile constants.
8. The integration-test target should be scoped to `kimik26` for this Layer 1 patch. The full spec's `glm51` acceptance conflicts with the brief's explicit "kimik26 capability flip only" boundary; testing `glm51` through the normal transform while leaving `glm51.capabilities.input.image=false` would correctly produce the existing ERROR text and fail for a declaration-layer reason outside this PR.
