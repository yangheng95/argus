# GLM-5.1 配置漂移根治方案 — 2026-05-18

## 0. 背景与证据（不可删，codex 实施前必读）

用户报"GLM 稳定复现乱码回复"。DB 取证结论：**不是字节编码乱码**
（`replacementChar=0 / controlByte=0 / mojibake=0`），是 `hexin/glm-5.1`
模型自身 token 退化 + 思维标签泄漏。

受控对照（同一 DB，仅两个模型在用）：

| 模型 | assistant msgs | maxOutput | finish=length | TerminalToolMissingError |
|---|---|---|---|---|
| hexin/**glm-5.1** | 885 | 32171（撞 cap） | 1 | 4（3 build + 1 delivery） |
| hexin/**kimi-k2.6** | 577 | 18780 | 0 | 0 |

两者 profile 都是 `reasoning:true` + `interleaved:{field:"reasoning_content"}`，
走同一套 soft-pin 终结工具逻辑。差别仅在 `transform.ts`：kimi-k2.6 配齐了
（`temperature:false` profile 闸 + `transform.ts:219` 显式分支 + `requestBody()`
hexin 覆盖），glm-5.1 三处皆缺。这是干净的受控实验，证明根因是配置漂移而非
soft-pin 设计本身（soft-pin 是 rule 6.1 正解，**不得推翻**）。

复现现场（delivery 退化）：`msg_e3a9bceb7001NHY9c3jTzX4yhu`，finish=length，
output=32171 tok，59K 字 `` `title bar`+`title bar` `` 复读，未调 `submit_verdict`
→ TerminalToolMissingError → delivery failed → task cancelled。
build 退化现场：`msg_e3aa5ada3001...`，文本含 `</think></think>` 内联思维标签泄漏。

## 1. 根因（rule 4 系统性 / rule 8 双源）

模型行为配置被拆成两个**无共享主键、各自按 model-id 子串匹配**的注册表：

1. `src/provider/hexin-profiles.ts` MATCHERS — capabilities（reasoning /
   temperature 闸 / interleaved / 窗口）
2. `src/provider/transform.ts` 的 `temperature()/topP()/topK()/variants()/
   options()/optionsForToolChoice()` — 采样 + thinking 开关 + tool_choice

新增模型只进 (1) 就在 (2) 静默缺席。glm-5.1 同时缺三处：

- F1 **采样**：`transform.ts` `temperature()/topP()/topK()` 无 glm-5.1 分支
  （兄弟 glm-4.6/4.7 有 `temperature → 1.0`）→ 无采样阻尼 → 复读塌缩。
- F2 **thinking-enable**：`transform.ts options()` 的 GLM thinking 分支 gate 在
  `providerID ∈ {zai,zhipuai}` / `baseten` / `opencorvus+[kimi-k2-thinking,
  glm-4.6]`，**永不匹配 `hexin`**。且 `vendor-messages.ts:112 interleavedReasoning`
  只在历史消息回灌时抽 `reasoning_content`，不剥离当前流内联 `<think></think>`
  → `</think>` 泄漏进 content。
- F3（次要，rule 6.1 边界内）：`loop.ts:1531-1548 shouldEnterTerminalToolRecovery`
  仅盖 `TerminalToolMissingError{retries:0}` 即 stop；delivery 无 goal 级
  retry → 单次退化即 task cancelled。本方案**不改 soft-pin 与 recovery 控制流**
  （rule 6.1：教 LLM 走哪条路只能靠 prompt），仅记录该缺口，F1/F2 修好后
  退化概率应趋零；F3 是否需要 delivery 重试由后续独立决策，不在本方案范围。

## 2. 修复范围（穷举调用点 — rule 35）

全仓 grep 结论（实施时须复核）：

- `transform.ts` model-id 关键分支行：`temperature()` L213-227、`topP()` L242-249、
  `topK()` L251-259、`variants()` L264+、`options()` L590-、`optionsForToolChoice()`
  L796-818、`providerOptions()`。glm-5.1 仅在 `hexin-profiles.ts:210` 出现，
  `transform.ts` 零处 → 确认双源漂移。
- 消费点：`session/llm.ts:159-163`
  `temperature: capabilities.temperature ? (agent.temperature ?? ProviderTransform.temperature) : undefined`
  / `topP` / `topK`；`llm.ts:134 options()`；`llm.ts:188 optionsForToolChoice`。
- 测试：`test/provider/transform.test.ts`、`test/provider/hexin-profiles.test.ts`、
  `test/provider/tool-choice-pin-e2e.test.ts`。

## 3. 实施项

### 修复 A — F1 采样（transform.ts）
为 glm-5.1 增补 `temperature()` / `topP()` 分支，**与 glm-4.6/4.7 既有先例
一致**（glm-4.6/4.7 = temperature 1.0），thinking 系模型 top_p 取 0.95
（与 transform.ts:245 既有 thinking 模型 topP 同源，不得平行另造常量）。
实施前 codex 须核对智谱 GLM-4.6/GLM-5 官方采样建议，若与 1.0/0.95 冲突以
官方为准并在方案附"codex 审查反馈"。禁止硬编码散落，复用既有匹配风格。

### 修复 B — F2 thinking-enable（transform.ts options() + 内联 think 剥离）
让 `hexin/glm-5.1`（及 GLM 5.x thinking 系）也下发 thinking 配置：
扩展 `options()` 的 GLM 分支条件覆盖 `providerID==='hexin'` 且 family==='glm'
且 reasoning。核实并修复内联 `<think>…</think>` 在 hexin/glm 流式响应中的
剥离/归一（F2 的 `</think>` 泄漏）——优先复用既有 reasoning 归一管线
（`vendor-messages.ts interleavedReasoning` / 既有 think-tag 处理），
**禁止新造平行解析器**（rule 9/35）。

### 修复 C — 结构性收敛（rule 8，关键，防再漂移）
评估将 capabilities 与采样/thinking 配置收敛为**单一 model 配置源**
（如 profile 内携带 sampling/thinking 字段，transform 从 profile 读取，
而非两张表各按 id 子串匹配）。若全量收敛过大，最小可接受方案：增加一条
**一致性守护测试**，枚举所有 `reasoning:true` 或 `interleaved` 的 hexin
profile，断言其在 transform.ts 采样/thinking 表均有非默认配置——使
"只进 profile 不进 transform" 在 CI 即失败。codex 决定收敛 vs 守护测试，
理由写入方案；倾向**真收敛**（rule 5/8），守护测试是兜底非首选。

### 修复 D — 测试（rule 36）
- 断言 `ProviderTransform.temperature('glm-5.1')` / `topP('glm-5.1')` 非 undefined
  且等于既定值。
- 断言 hexin/glm-5.1 经 `options()` 后含 thinking 配置。
- 内联 think-tag 剥离正反例（含 `</think></think>` 泄漏样本）。
- 修复 C 的一致性守护测试。
- 删除隐式自动行为须断言其不再发生（rule 36）：断言 glm-5.1 不再落入
  "无采样约束" 分支。

## 4. 验收

- `bun test test/provider/` 全绿（新增用例 + 原有不回归）。
- pre-push hook（typecheck / api:routes-check / docs:check）通过，不绕 hook。
- 二次 review（rule 24/35）：codex 自审 + 本 spec 标注"codex 审查反馈"。
- 不触碰 soft-pin / terminalToolChoice / recovery 控制流（rule 6.1）。

## 5. Git 纪律（见记忆 codex_git_pathspec_pitfall / nested_git_hazard）

- 一律 `git -C C:/Users/chuan/myhexin-local/opecorvus`（父仓根），按路径 stage 自己的文件。
- 改前打 backup tag；禁止 `git stash` 做诊断；容忍预存的无关报错。
- 改前后 commit + push 不绕 hook。
