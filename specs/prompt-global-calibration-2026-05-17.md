# Prompt 全局校准分析 — 2026-05-17

> 方法：4 个独立探查 agent 平行摸清 orchestrator/pipeline 拓扑、build/architect/delivery prompt、
> 辅助审查 agent prompt、prompt 组装 harness；主 agent 亲自复核最高影响论断；
> 引入独立 reviewer agent 反复 challenge 直到共识。

## 用户三个核心问题的回答

### Q1. 每个 agent 对整个 opencorvus 系统的认知是否完整？不完整是否影响性能？

**结论：普遍清晰，一处真实缺口 + 一处可接受窄认知。**

- 8/9 个 agent 的 core prompt 都有显式 `## Coordination Boundary` 段，逐条声明上下游 ownership。
  intent/design/requirements/architect/delivery/integrity/prosecutor 认知完整，无性能影响。
- **build 认知最窄（goal-centric）**：完全不提 integrity/prosecutor 存在。设计上可接受
  （depth-first 隔离意图，build-core.txt:21-30），不影响 build 自身性能，但 build 报告无法为
  下游审计预留信号——记录为已知边界，非缺陷。
- **真实缺口 — delivery "谁完成 task" 链路三层分散表述（中）**：LLM verdict（语义输入）→
  host arbiter（最终持久化裁决）→ accepted `deliver` 工具内副作用完成 task（commit 9d46ed8a3）。
  这三层在 delivery-core.txt / orchestrator-core.txt / role-contract.ts 三处分散，无一处把链路
  讲通。对 LLM 是潜在混淆点，可能导致 orchestrator 误判 task 是否已完成。**建议在
  orchestrator-core.txt 增一段权威链路说明（prompt 单源）。**

### Q2. prompt 是否以第一性原理驱动，囊括所有必须信息？

**结论：大多优秀，两处偏程序化但符合角色，无致命遗漏。**

- intent/prosecutor/integrity/architect 第一性原理最强（显式 `First principles:` 段，反对启发式偷懒）。
- build 偏 `## Never` 14 条堆砌 + `renderVisualContractPreamble` 无条件强约束——但每条有具体
  bench 失败证据注释支撑（符合 rule 1/3 有证据），可接受。
- delivery `## Process` 6-Phase 程序化——符合对抗性验收 gate 角色，host 侧是契约自洽校验
  （rule 6.1(a) 允许），非 host 状态机。
- 必要信息：所有 agent 的 terminal tool 校验失败都回传精确缺失项，形成闭环，模型无需猜验证规则。
  唯一靠探测项：build 让模型自探 shell（有意设计 rule 12，已用 staging 缓解）。

### Q3. harness 设计是否科学优雅？

**结论：核心抽象成熟（7.5/10），但有真实双源/平行实现缺陷需修。**

优雅点：`runAgentSession` 单 worker 入口 + `composeSystemPrompt` 单源 + `LLM.composeSystem`
的 `systemMode:"complete"` 语义 + 全程流式（rule 14 完全合规）+ 无 audience/synthetic 双路消息。
runner.ts 顶部 64 行论证 orchestrator 为何故意不收敛——范例级克制（非漏抽象）。

## 共识结论（主 agent + 独立 reviewer，一轮强 challenge 后定稿）

| # | 问题 | 规则 | 严重度（共识） | 复核状态 |
|---|---|---|---|---|
| A | `NATIVE_DEFAULTS["build"]=PROMPT_BUILD`(build.txt) 但 `BuildAgent.run` 实际用 `BUILD_CORE`。catalog 展示/默认 ≠ 实际生效；用户在 catalog 改 build prompt，append 实际拼到 build-core 而非所见 build.txt 基线。其余 pipeline agent 都正确映射 `*_CORE`，唯 build 孤例 | 8 | **高** | ✅ 双方亲验 agent.ts:458-470 + llm.ts:68-73：`systemMode:"complete"` 时 `agent.prompt`(PROMPT_BUILD) 被丢弃→build.txt 在 pipeline **全路径死代码** |
| B | build 显式删除合成 recovery（agent.ts:685-691，引 rule 7/13）；delivery 仍保留 `terminalTool.recovery`（agent.ts:172-180）注入合成 user 消息。同一失败模式相反策略；**reviewer grep 全 specs/ 确认无任何文档为 delivery recovery 背书，build 所引 "spec B10" 文件不存在** | 15/13/7/8 | **高** | ✅ 双方亲验代码 + specs/ grep |
| ~~C~~ | ~~`Provider.defaultModel()` 兜底与 model.ts 无 fallback 冲突~~ **→ 推翻** | — | **作废** | ✅ 主 agent 亲验 provider.ts:1017-1024：`defaultModel()` 已严格单源（只读 `cfg.model`，否则 throw），旧 fallback 链注释明确已删。原描述事实错误（rule 3 教训：源自探查报告四未亲验即标高）。`?? defaultModel()` 是单源 resolver 非 fallback，最多 rule-17 死臂清理（低） |
| D | `system.txt` ↔ `build.txt` 大段逐字重复 | 8/9 | 中 | 子 agent 报告，双方同意 |
| E | `core_header` resolver 三处平行实现（system.ts:75/80 + prompt-catalog.ts:143） | 35 | 中 | 双方同意 |
| F | `parts.ts:229/294` 把 host 预读文件伪装成 "Called the Read tool" 文本。单路可见非 audience 分叉，rule 15 边界单例 | 15 边界 | 中 | 双方同意定界准确 |
| G | `system.txt:92-97` "Task tool" 措辞过时 | 17 | **低（reviewer 重定范围）** | orchestrator **从不接收 system.txt**（own buildSystemParts + `systemMode:"complete"`），原"误导 orchestrator 路径"impact 错误；仅泛化非 pipeline assistant 措辞陈旧 |
| H | delivery "谁完成 task" 链路分散 | — | **低（reviewer 降级）** | 链路在 orchestrator-core.txt:51-62 + delivery-core.txt:23-25 各自视角已明确陈述，是分散非缺失；删除原"可能致 orchestrator 误判"无证据 impact，仅文案合并 nicety |
| I | `agent.ts` delivery `steps` 靠注释"约定"同步两处硬编码 | 10 | 低 | reviewer 称含 "160 vs 1000" 事实错误注释；主 agent 抽查 agent.ts:227-233 为 buildUserPrompt 签名，cite 未对上——**行动前需重新定位** |
| J | prosecutor `kind="evaluator"` vs `agentName="prosecutor"` 残留双命名（new-arch/01-agents.md:139 确认 evaluator 模块已删，命名为死残留） | 8/17 边缘 | 低 | 双方同意"低但非 non-issue" |

**核心 prompt 补审（reviewer 逐字读 orchestrator-core/build-core/delivery-core.txt）**：均无 FSM/合成消息/fallback 违规；delivery 的 6-Phase 是 prose guidance 非 host FSM；范围外未发现遗漏的高危项。

## 已被复核降级/排除的项

- **K（原报告一：direct-build 走 deliver 命中 upstream-context.ts:116 硬抛错）**：
  复核发现 `buildArchitectureContractCatalogSection` 在 `goals.length===0` 时第 100 行**早返回 ""**，
  纯 direct-build（无 architect → 无 goal）不会命中抛错。抛错仅在"有 goal 但无 contract graph"
  的不一致中间态触发。**严重度从"耦合裂缝"降为"边缘防御性断言，合理 let-it-crash"，移出问题清单。**
- build prompt 内 `## Never` 14 条 / merge_back 5 步：prompt 内协议描述，非 host 状态机，rule 13 合规。
- requirements/intent "text discarded"：结构化输出契约，非 rule 15 双路分叉，合规。
- prosecutor 软失败 try/catch：显式声明的非必需步骤、如实记入 rationale，非 rule 7 违规。

## 共识修复方案

- **A（高）**：`NATIVE_DEFAULTS.build` → `BUILD_CORE`；`prompt/build.txt` 与 `agent.ts` 的 build
  `.prompt: PROMPT_BUILD` 在 `server/routes/coding.ts` direct coding assistant / default-agent path 仍有消费者，
  不能作为死代码删除。配测试断言 catalog build 默认 == BUILD_CORE 且 != PROMPT_BUILD。
- **B（高）**：删除 runner 的 `terminalTool.recovery` 协议面，并删除 delivery / design-analysis 上的
  same-session recovery 配置。统一为 build 的做法——缺 terminal tool 时保留 `TerminalToolMissingError` /
  typed contract error，由上游 LLM 决策 retry 或改策略（非 host 合成 user message）。配测试断言 delivery
  不再携带 recovery 字段。
- **C**：作废。最多把 `parts.ts/shell.ts/command.ts` 的 `?? Provider.defaultModel()` 死臂按
  rule-17 清理（低优先，可不动）。
- **D/E/F/J（中/中/中/低）**：技术债，建议抽公共行为规范段 / 统一 core_header resolver /
  核查 parts.ts 伪 tool-call 是否改真实 tool part / 统一 prosecutor kind 命名。非阻塞。
- **G/H/I（低）**：文案/注释清理，非阻塞。I 行动前先重新定位 `steps` 常量真实位置。

## 状态

主 agent 与独立 reviewer 已达成共识（一轮 challenge 后，C 推翻、A/B 修复范围收紧、G/H 降级、
J 定性精确化）。第二轮 challenge 低价值，共识达成。本文档为最终校准结论。

## 2026-05-18 实施记录

- A 已实施：`Agent.nativeDefaultPrompt("build")` 返回 `BUILD_CORE`，prompt catalog 的 build 默认与真实
  build stage core prompt 单源一致。
- B 已实施：`runAgentSession` 不再支持 terminal tool same-session recovery；delivery / design-analysis 不再
  注入合成 user prompt 促使模型补调 terminal tool。
- H 已实施：`orchestrator-core.txt` 明确 `submit_verdict` 是语义 review input，`deliver` host arbiter
  才写入持久化 verdict，且只有 accepted host-arbiter verdict 完成 task。
- 新增/调整验收：`role-contract.test.ts`、`runner-terminal-recovery.test.ts`、
  `delivery/agent.test.ts`、`core-prompt-hygiene.test.ts`、`describe-build-terminal-report.test.ts`。
- `recovery_hint` 字段名仍保留在 describe 输出中，但内容已改为 terminal report retry hint；字段名如需
  重命名，必须另行全仓 grep 下游消费者后处理。

## 2026-05-17 二次复核（rule 24，主 agent 对实施记录的诚实校正）

- **B / H 复核通过**：runner 已删 terminalTool same-session recovery，`TerminalToolMissingError`
  转确定性 non-retryable 交上游 LLM 决策（runner.ts:382-467）；delivery/design-analyst 无残留
  recovery。与 build 范式一致，rule 7/13/15 闭合。
- **A 复核：实施记录"单源一致"措辞过强，存在被搬移的残留（rule 1/28b 如实记录）**。
  实测：`NATIVE_DEFAULTS.build=BUILD_CORE`（agent.ts:460，已改）但 `Agent.Info.build.prompt
  =PROMPT_BUILD`（agent.ts:131，**未改**）。结果：catalog 默认 BUILD_CORE == pipeline
  BuildAgent 运行时 ✓（这是修对的、最重要的那条）；但**通用 primary "build" agent**
  （`server/routes/coding.ts` "direct coding assistance" SSE 路由，非 complete 路径经
  `composeSystem` 取 `Agent.Info.build.prompt`）运行时仍是 `PROMPT_BUILD` ≠ catalog 默认。
  mismatch 未消除，从"catalog vs pipeline-build"**搬移**为"catalog vs direct-coding-assist
  agent"。这是可接受的取舍（pipeline build 是用户真正配置的自治面，对齐它优先级最高），
  但"build"名字仍被两个 prompt 身份重载共用一张 catalog 卡 + 一个 config 键——rule 8 根因
  未根治，仅缓解。**结论：A 为净改进，非完全闭合；若要根治需拆双卡/双 config 键或显式
  声明 direct-assist build 不经 catalog（设计决策，留待维护者定夺，禁止静默 patch）。**

## 2026-05-17 codex 三次意见 + 主 agent 复核（A 根治方向定稿）

codex（codex exec，读真实代码）裁决 A 根因走 **D = 按运行时契约拆 `coding` vs `build`
两个 prompt 身份**，第一性原理依据："prompt 身份不是名字，而是输入形态+工具面+终止协议"。
否决 C 的硬证据：`build-core.txt` 第一行要求经 `report_build_result` 终结，而 direct
SessionPrompt 路径不注入 `report_build_result`/`merge_back`（仅 stage runtime 注入，
build/agent.ts:499/546），共用 prompt 会让交互路径提示调用不存在的工具。

**主 agent 复核（rule 3/24，不盲信 codex）**：
- ✅ 硬盘半成品确在按 D 推进且已大幅完成：`role-contract.ts:29-41` 拆出 `coding`
  (promptConfigMode:"override") + `build`(append)；`agent.ts:126-147` `coding.prompt
  =PROMPT_BUILD`、`build.prompt=BUILD_CORE`；`agent.ts:518` 默认 primary 已从 build 改 coding。
  **→ 上方 2026-05-17 二次复核里"Agent.Info.build.prompt=PROMPT_BUILD 未改"的残留判断已被
  更新的硬盘状态取代：身份已拆，残留正在按 D 闭合。**
- ✅ codex 落地步骤3 真实有效：`coding.ts:201-204` 仍调 `Agent.defaultAgent()`（注释陈旧写
  "build agent"），配 `default_agent` 时 coding endpoint 会跑错 agent——**真实 bug，需改显式
  `agent:"coding"`**。
- ❌ **codex 落地步骤5 事实错误**：codex 称 `config.ts` knownKeys 未含 `prompt_append` 会重复
  塞 options；实测 config.ts:732-748 knownKeys **已含 `"prompt_append"`**，此项无需修。
- ⚠️ codex 步骤2（NATIVE_DEFAULTS 缺 `coding` 项，coding 靠 agent.prompt fallback，与"native
  default 单源"注释张力）大体成立，建议补 `coding: PROMPT_CODING`。
- 步骤1（build.txt→coding.txt 改名消除路径暗示）、步骤6（非 complete 的
  `SessionPrompt.prompt({agent:"build"})` 应报错，属 rule 6.1(a) 数据完整性边界）、步骤7
  （external executor 是否吃 build.prompt_append 需穷举）合理，采纳。

**A 最终定稿方向 = D**（三方收敛：既有共识 + codex 裁决 + 硬盘半成品）。当时剩余 gap
（2026-05-18 闭环见下）：
1. `coding.ts:201` 显式 `agent:"coding"`，更新陈旧注释（真实 bug）。
2. `NATIVE_DEFAULTS` 补 `coding` 项（codex 步骤2）。
3. `build.txt`→`coding.txt` 改名、`PROMPT_BUILD`→`PROMPT_CODING`（codex 步骤1）。
4. 非 complete 路径拒绝 `agent:"build"` 硬约束（codex 步骤6）。
5. external executor 吃不吃 `config.agent.build.prompt_append` 须穷举确认（codex 步骤7）。
6. 配套测试（catalog 双卡 default 不等 / direct route 锁定 coding / composeSystem 分流 /
   runner append 到 BUILD_CORE / 非 complete agent:build 被拒 / 不再引用 build.txt）。
- codex 步骤5（config knownKeys）**不在 gap 内**——经复核为 codex 误判。

## 2026-05-18 闭环复核（主 agent 实施 + 独立 reviewer 待最终确认）

**A/D 已按运行时契约根治**：
- `prompt/build.txt` 已改为 `prompt/coding.txt`，源码和测试引用 `PROMPT_CODING`；`prompt-loading.test.ts`
  断言包内不再出现 legacy direct-assistant 文件名引用。
- `Agent.Info.coding.prompt = PROMPT_CODING`，`Agent.Info.build.prompt = BUILD_CORE`；
  `NATIVE_DEFAULTS.coding = PROMPT_CODING`、`NATIVE_DEFAULTS.build = BUILD_CORE`。
- 默认 direct assistant 是 visible primary `coding`；workflow build 是 hidden primary stage agent。
- `/coding/message/stream` 显式请求 `agent:"coding"`，不再受 `default_agent` 配置影响。
- 非 `systemMode:"complete"` 路径请求 `agent:"build"` 会硬失败，错误信息要求使用 `coding`。
- `config.agent.<stage>.prompt_append` 是 append 语义；append-mode 角色忽略 `prompt` 覆盖，避免把
  code-owned core prompt 替换掉。external executor 的 build system 也拼接 `config.agent.build.prompt_append`。

**B 已闭合**：runner 不再有 `terminalTool.recovery` 协议面；delivery / design-analysis 不再注入
same-session synthetic recovery。缺失 terminal report 以确定性 typed error 暴露给上游，不由 host
生成补救消息。

**F 已闭合**：host 预读文件上下文改为 `Host-provided file context (not a model tool call)`，失败读取也
标记为 host-provided context；不再伪装成模型调用过 Read tool。

**benchmark harness 已校正**：
- 删除 failed/cancelled terminal state 的自动 resume；报告保留真实 terminal state。
- 新增 `--idle-timeout-ms`，`waitForFinal` / architect wait 按最近 benchmark activity 判定真实无活动超时。
- 报告 API 读取失败写入 `diagnostics.report_api_errors`，不再静默替换为 `[]`。
- `local_verify` skipped 为 `status:"not_run"` / `exitCode:null`，不伪装成功。
- git changed-file 证据源失败会抛错，不返回空列表。

**2026-05-18 独立 reviewer 第二轮阻塞项已闭合**：
- native/custom agent 的运行身份不再能被 `config.agent.<id>.name` 改写；schema 和 registry 都硬失败。
- append-mode agent（build / requirements / architect / design-analyst / intent-analysis / delivery / integrity /
  prosecutor）的 `prompt` 字段被拒绝，只允许 `prompt_append`，避免静默 no-op。
- benchmark quality gate 将 artifact noise、placeholder、scope drift、configured local verify failure 都纳入硬失败；
  request-scoped module blocks 覆盖 package manifest / lockfile，不能再凭 config 文件类型绕过 scope 检查。
- resume benchmark 默认只 attach 现有 task；只有显式 `--resume-message` 才注入消息，注入失败直接抛错。

**仍需人工确认后才能删除的候选**：旧一次性 benchmark / audit 脚本若被后续确认无消费者，应另开清理；
本轮不删除死代码，遵守 rule 17。
