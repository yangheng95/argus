# AI 编程工具选型研究（中文研究报告）

> **研究主题**：『当前可购买』的 AI 编程工具选型研究（采购决策）
> **研究团队**：OpenCorvus（TypeScript / Bun monorepo，执行目录 /Users/yangheng/Desktop/opencorvus）
> **研究窗口**：2026-08-01 ～ 2026-08-08（动态事实统一访问日期：2026-08-01，时区 Asia/Singapore UTC+8）
> **复核日期**：2026-08-02（全部 12 个官方 source_urls 实际访问复核一致：0 变更 / 0 未确认；详见 specs/artifacts/ai-coding-tools-selection-review-2026-08-02.md）
> **交付链**：research-studio-planner（章程）→ research-studio-researcher（S0/S1/S2 设计 + S1 官方事实）→ universal-build（S2 实测执行）→ research-studio-analyst（S3 对比/成本/推荐）→ fact-checker（事实复核）→ research-studio-writer（本报告 + 结构化数据）
> **fact-check 裁决**：minor_corrections（13 verified / 1 minor correction / 0 unresolved），本报告已落实该修正（见第 6 章 §6.5）
> **审计要求**：每条事实附官方来源 URL + 访问日期；官方原文 / 价格数字 / 档位名 / 币种保留原文；NOT-COMPARABLE 与 PARTIAL 显著标注；禁止估计与第三方数字填充
> **结构化数据**：`specs/artifacts/ai-coding-tools-selection-data.json`（字段与本报告一致，供采购决策网站消费）

---

## 1. OpenCorvus 工程画像（S0）

> 依据：research-studio/research-evidence（S0 仓库画像，researcher 于 2026-08-01 复核补充）+ research-studio/research-charter（planner 基线）。

### 1.1 语言与包结构

OpenCorvus 是 **TypeScript ESM** 单体仓库（monorepo），包管理器 **bun@1.3.13**（存在 bunfig.toml，test preload=./test-preload.ts），由 **Turborepo 2.5.6** 编排（turbo.json 定义 typecheck / build / opencorvus#test 等任务），workspaces = `packages/*` + `packages/sdk/js`，共 **12 个包目录**：

| 包目录              | 技术栈 / 说明                                                        |
| ------------------- | -------------------------------------------------------------------- |
| ainvest-amd-replica | 仅参与 turbo 任务（.turbo-only），无独立发布                         |
| channel-config      | 渠道配置（S2 任务集 T1/T5 涉及）                                     |
| channel-runtime     | 渠道运行时与 adapters（S2 任务集 T1/T5 涉及）                        |
| opencorvus          | 主包（0.0.27-beta），CLI + Agent + 多包工作流核心                    |
| overlay             | Tauri（Rust）+ SolidJS 桌面应用（SolidJS 1.9 + Tailwind 4 + Vite 7） |
| plugin              | 插件                                                                 |
| script              | 脚本工具                                                             |
| sdk                 | sdk/js 子包                                                          |
| transport-protocol  | 传输协议（zod 契约，S2 任务集 T3 涉及）                              |
| util                | 通用工具                                                             |
| vscode-extension    | VS Code 扩展（.turbo-only）                                          |
| web                 | Astro 站点                                                           |

### 1.2 构建与质量工具链

| 类别          | 工具                                      | 用途                              |
| ------------- | ----------------------------------------- | --------------------------------- |
| Lint / Format | biome                                     | 代码风格与静态检查                |
| Dead code     | knip 6.27.0                               | 死代码检查                        |
| Git hooks     | husky 9.1.7                               | prepare 钩子                      |
| Pre-push hook | typecheck / api:routes-check / docs:check | 推送前质量门（AGENTS.md rule 33） |
| 任务编排      | turbo（2.5.6）                            | monorepo 任务调度                 |
| 状态持久化    | drizzle-orm + SQLite                      | 本地状态存储                      |
| API 契约      | Hono + hono-openapi + Zod                 | HTTP API 契约与校验               |

`script/` 目录提供脚本（含 `./script/generate.ts`，CI 用于物化 sdk 构建产物）。

### 1.3 提交历史特征

| 指标              | 数值（来源）                                                |
| ----------------- | ----------------------------------------------------------- |
| 总提交数          | 16,685 commits（planner 基线）                              |
| 首提交            | 2025-03-21                                                  |
| 近 12 个月提交    | ≈14,955 commits（≈40 commits/天，高频活跃，planner 基线）   |
| 近期 reflog 窗口  | 2026-07-13 .. 2026-08-01（≈51 commits/天，researcher 复核） |
| 提交 subject 前缀 | `dsw-33987`                                                 |
| 分支链            | v0.0.1beta .. v0.0.27beta                                   |
| 远端              | git-cc（myhexin）+ GitHub upstream（yangheng95/opencorvus） |

### 1.4 Issue 与典型任务

- **Issue 模板**（.github/ISSUE_TEMPLATE）：`bug-report` / `feature-request` / `question`。
- **CI 工作流**：13 个 GitHub Actions workflow（build / test / typecheck / generate / pr-standards / stale-issues 等；S0 复核值，planner 基线为 12，researcher 复核补充为 13）。
- **典型任务形态**：README 定义 requirements→goals→build→integrity 多 agent 流水线；executor 委托 OpenCorvus / Codex / Claude Code；14 个 channel adapter；headless HTTP API；overlay 桌面应用；coding CLI 集成清单含 claude-code / codex / gemini-code / copilot / glm-code（S2 任务集 T6 涉及 coding-cli 档案扩展）。
- **与选型研究的关系**：仓库高频活跃 + CLI/Agent/多包工作流为主 → 候选工具必须在 **CLI / headless / 无人值守** 与 **Bun 生态适配（bun.lock / bun run / bun test）** 上可验证（章程 §3.3）。

---

## 2. 候选工具官方资料对比表（S1，7 维）

> 依据：research-studio/research-evidence（S1 官方 7 维事实）+ research-studio/evidence-analysis（S3 comparison_matrix）。
> **访问日期：2026-08-01（全部事实）**；货币按官方原币种保留（本矩阵均为 USD）。
> 显著标注：**NOT-COMPARABLE**（无官方来源可确认，禁止估计）与 **PARTIAL**（官方存在但信息不完整 / 页面失效）。

### 2.1 GitHub Copilot

来源：https://github.com/features/copilot/plans 、https://docs.github.com/en/billing/managing-billing-for-github-copilot/about-billing-for-github-copilot （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                                                                                 | 比较性                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 价格       | Free $0 / Pro $10/user/mo / Pro+ $39/user/mo / Max $100/user/mo / Business $19/user/mo / **Enterprise varies（PARTIAL）**；credits 1=$0.01，Pro $15 / Pro+ $70 / Max $200 per mo | COMPARABLE（Enterprise PARTIAL） |
| 额度       | Free 2000 completions + 50 chat/mo；Pro unlimited completions + $15 credits；Pro+ 4x usage + $70 credits；Max 2.9x Pro + $200 credits                                            | COMPARABLE                       |
| IDE 支持   | VS Code / Visual Studio / Xcode / JetBrains / Neovim / Eclipse / Raycast / SSMS / Zed；提供 CLI（Copilot CLI）                                                                   | COMPARABLE                       |
| Agent 能力 | agent mode / cloud agent / Copilot CLI programmatic / delegate Claude Code+Codex / MCP / 30+ models                                                                              | COMPARABLE                       |
| 企业管理   | SAML SSO（Business+）/ usage metrics / IP indemnity / audit logs（Pro+）                                                                                                         | COMPARABLE                       |
| 安全       | enterprise-grade（Business+）/ public code filter / DPA+GDPR                                                                                                                     | COMPARABLE                       |
| 数据使用   | Business/Enterprise no-training；Individual opt-out；IDE prompts not retained；other 28 days                                                                                     | COMPARABLE                       |

### 2.2 Cursor（Anysphere）

来源：https://cursor.com/pricing 、https://cursor.com/docs/account/pricing 、https://cursor.com/security （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                                                                                                                                       | 比较性                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 价格       | Hobby $0 / Pro $20/mo / Pro+ $60/mo / Ultra $200/mo / Teams Standard $40/user/mo / Teams Premium $120/user/mo / **Enterprise custom（PARTIAL）**                                                                                       | COMPARABLE（Enterprise PARTIAL） |
| 额度       | Pro $20 Other Models + generous Cursor Models；Pro+ $70 Other Models；Ultra $400 Other Models；token rate $0.25/MTok（Teams+）；Daily Agent $60-100/mo、power $200+/mo 为官方 docs 指引（cursor.com/docs/account/pricing，2026-08-02） | COMPARABLE                       |
| IDE 支持   | Cursor editor / CLI / cloud agents / iOS                                                                                                                                                                                               | COMPARABLE                       |
| Agent 能力 | agent mode / Composer / Grok 4.5 / Bugbot / MCP+skills+hooks / BYOK                                                                                                                                                                    | COMPARABLE                       |
| 企业管理   | SAML+OIDC（Teams+）/ SCIM（Enterprise）/ central billing / usage analytics / audit logs                                                                                                                                                | COMPARABLE                       |
| 安全       | SOC 2 Type II / annual pentest / Privacy Mode（all plans）/ no China infra / CMEK                                                                                                                                                      | COMPARABLE                       |
| 数据使用   | Privacy Mode=no training；residency +10% uplift                                                                                                                                                                                        | COMPARABLE                       |

### 2.3 Claude Code（Anthropic）

来源：https://claude.com/pricing （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                                                                                                                                                                                                                                                                                                                               | 比较性                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 价格       | **捆绑在全部付费 Claude 订阅内（无独立订阅）**；Pro $20/mo（$200/yr）；Max from $100/mo（5x/20x）；Team Standard $20/seat/mo annual（$25 monthly）；Team Premium $100/seat/mo annual（$125 monthly）；Enterprise $20/seat + usage at API rates；API：Opus5 $5/$25、Sonnet5 $2/$10 intro till 2026-08-31 then $3/$15、Haiku4.5 $1/$5、Fable5 $10/$50 per MTok；batch 50% off；Managed Agents $0.08/session-hr；WebSearch $10/1K | COMPARABLE（Enterprise 超额按 API 计价） |
| 额度       | 5h rolling window + weekly caps；无固定请求数；context 200k/500k                                                                                                                                                                                                                                                                                                                                                               | COMPARABLE                               |
| IDE 支持   | terminal CLI / VS Code+JetBrains extensions / desktop+web+mobile                                                                                                                                                                                                                                                                                                                                                               | COMPARABLE                               |
| Agent 能力 | multi-step / tool calls / MCP / subagents / Claude Code for Enterprise                                                                                                                                                                                                                                                                                                                                                         | COMPARABLE                               |
| 企业管理   | SSO / SCIM / audit logs / compliance API / RBAC / custom retention / IP allowlisting / HIPAA-ready                                                                                                                                                                                                                                                                                                                             | COMPARABLE                               |
| 安全       | enterprise controls（Team+）/ Claude Security（beta）                                                                                                                                                                                                                                                                                                                                                                          | COMPARABLE                               |
| 数据使用   | Team/Enterprise no-training by default；individual opt-out                                                                                                                                                                                                                                                                                                                                                                     | COMPARABLE                               |

### 2.4 OpenAI Codex

来源：https://developers.openai.com/codex/pricing 、https://openai.com/chatgpt/pricing/ （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                                                                                                                                                                                                  | 比较性                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 价格       | **捆绑在 ChatGPT Free/Go/Plus/Pro/Business/Enterprise 内**；Go $8/mo；Plus $20/mo；Pro from $100（5x）或 $200（20x）/mo；Business $20/user/mo annual（$25 monthly），2+ users；**Enterprise contact sales（PARTIAL）**；API key usage-based；credits/MTok：Sol125in/750out、Terra50/300、Luna5/30 | COMPARABLE（Enterprise PARTIAL） |
| 额度       | Plus：Sol10-100/Terra25-200/Luna250-2000 per 5h；Business：Sol10-100/Terra25-200/Luna250-2000 per 5h（与 Plus 相同）；Pro 5x：Sol50-500/Terra125-1000/Luna1250-10000 per 5h；Pro 20x：Sol200-2000/Terra500-4000/Luna5000-40000 per 5h                                                             | COMPARABLE                       |
| IDE 支持   | Codex CLI / IDE extension / ChatGPT desktop+web / iOS / cloud                                                                                                                                                                                                                                     | COMPARABLE                       |
| Agent 能力 | multi-step / worktrees+git / AGENTS.md / Skills / subagents / MCP / scheduled tasks / GitHub review / non-interactive                                                                                                                                                                             | COMPARABLE                       |
| 企业管理   | SAML SSO+MFA（Business+）/ SCIM+EKM+RBAC（Enterprise）/ compliance API / analytics                                                                                                                                                                                                                | COMPARABLE                       |
| 安全       | TLS 1.2 / AES-256 / bug bounty / SOC2+ISO（Enterprise）                                                                                                                                                                                                                                           | COMPARABLE                       |
| 数据使用   | Business no-training by default；individual opt-out                                                                                                                                                                                                                                               | COMPARABLE                       |

### 2.5 Windsurf（已并入 Devin）— **PARTIAL**

来源：https://windsurf.com/pricing （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                                                      | 比较性                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 价格       | windsurf.com/pricing 现渲染 Devin 定价；Free $0 / Pro $20/mo / Max $200/mo / Teams $80/mo plan + $40/full dev seat / **Enterprise custom（PARTIAL）** | COMPARABLE（Enterprise PARTIAL） |
| 额度       | 未在收集范围内给出独立额度明细（随 Devin 产品）                                                                                                       | PARTIAL                          |
| IDE 支持   | Devin Desktop / ACP integrations / CLI                                                                                                                | COMPARABLE                       |
| Agent 能力 | cloud agents / SWE 1.7 / parallel sessions / Slack+Teams+Linear+Jira                                                                                  | COMPARABLE                       |
| 企业管理   | central billing（Teams）/ admin dashboard / SAML+OIDC（Enterprise）/ VPC（Enterprise）                                                                | COMPARABLE                       |
| 安全       | enterprise admin controls；teamspace isolation                                                                                                        | PARTIAL                          |
| 数据使用   | **standalone Windsurf policy 不再位于该 URL（PARTIAL）——训练/保留/传输政策无法从官方确认**                                                            | **PARTIAL（显著缺口）**          |

### 2.6 JetBrains AI Assistant

来源：https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                                                                                                                                              | 比较性                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 价格       | AI Free $0（3 credits/30d）；AI Pro Individual $10/mo（10 credits）；AI Ultimate Individual $30/mo（35 credits）；AI Pro Org $20/mo（20 credits）；AI Ultimate Org $60/mo（70 credits）；AI Enterprise $60/mo；1 credit=$1；top-ups available | COMPARABLE                  |
| 额度       | credits per month：Free 3 / Pro 10-20 / Ultimate 35-70 / Enterprise 70+                                                                                                                                                                       | COMPARABLE                  |
| IDE 支持   | JetBrains IDEs（full suite）/ AI Pro in All Products Pack                                                                                                                                                                                     | COMPARABLE                  |
| Agent 能力 | AI Assistant / Junie agent / Grazie / local+cloud completions                                                                                                                                                                                 | COMPARABLE                  |
| 企业管理   | AI Enterprise org tier（SSO/SCIM per docs）                                                                                                                                                                                                   | COMPARABLE                  |
| 安全       | enterprise compliance per JetBrains docs                                                                                                                                                                                                      | PARTIAL（无独立认证细节页） |
| 数据使用   | official AI service license terms                                                                                                                                                                                                             | PARTIAL（无独立数据政策页） |

### 2.7 Amazon Q Developer

来源：https://aws.amazon.com/q/developer/pricing/ （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                     | 比较性                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 价格       | Free $0 / Pro $19/user/mo / **Enterprise AWS enterprise contract（PARTIAL）**；overage $0.003/LOC beyond 4K LOC pool | COMPARABLE（Enterprise PARTIAL） |
| 额度       | Free 50 agentic requests/mo + transformation 1,000 LOC/mo；Pro increased limits + 4K LOC/mo transformation pooled    | COMPARABLE                       |
| IDE 支持   | IDE plugins / CLI / AWS Console                                                                                      | COMPARABLE                       |
| Agent 能力 | agentic coding / Q&A chat / transformation agents                                                                    | COMPARABLE                       |
| 企业管理   | IAM Identity Center dashboard（Pro）/ per-use activation                                                             | COMPARABLE                       |
| 安全       | reference tracking / suppress public code / IP indemnity（Pro）                                                      | COMPARABLE                       |
| 数据使用   | Free opt-out；Pro automatically opted out                                                                            | COMPARABLE                       |

### 2.8 Tabnine（Tricentis）— 扩展候选（纳入）

来源：https://www.tabnine.com/pricing （访问日期 2026-08-01）

| 维度       | 官方事实（原文）                                                                                                                          | 比较性     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 价格       | Code Assistant $39/user/mo annual；Agentic Platform $59/user/mo annual；own-LLM unlimited；Tabnine LLM=provider price+5%；headless add-on | COMPARABLE |
| 额度       | reserved token quota model                                                                                                                | COMPARABLE |
| IDE 支持   | all major IDEs                                                                                                                            | COMPARABLE |
| Agent 能力 | agentic workflows / Tabnine CLI / Context Engine / MCP / headless agents                                                                  | COMPARABLE |
| 企业管理   | SSO / governance / analytics / auditability / per-user LLM control                                                                        | COMPARABLE |
| 安全       | zero retention / no training / VPC+on-prem+air-gapped / SOC2+ISO27001 / IP indemnification                                                | COMPARABLE |
| 数据使用   | zero retention；no sharing                                                                                                                | COMPARABLE |

### 2.9 Cline / Aider（开源）— **NOT-COMPARABLE（排除主矩阵）**

来源：无官方企业定价/政策页（尝试来源：无官方 URL 可得）

| 维度       | 官方事实（原文）                                                   | 比较性                           |
| ---------- | ------------------------------------------------------------------ | -------------------------------- |
| 价格       | no subscription；BYO model API costs                               | NOT-COMPARABLE                   |
| 额度       | 无官方统一额度（随模型供应商）                                     | NOT-COMPARABLE                   |
| IDE 支持   | Cline：VS Code ext；Aider：terminal CLI                            | COMPARABLE（非企业维度）         |
| Agent 能力 | multi-step agent（Cline）/ pair-programming（Aider）/ MCP（Cline） | COMPARABLE（非企业维度）         |
| 企业管理   | none                                                               | **NOT-COMPARABLE（无企业契约）** |
| 安全       | local context；model provider policies apply                       | NOT-COMPARABLE                   |
| 数据使用   | local context；model provider policies apply                       | NOT-COMPARABLE                   |

**排除结论（章程 §3.3）**：Cline/Aider 因**无官方企业定价/政策**，判定 **NOT-COMPARABLE**，不纳入主矩阵对比。

### 2.10 缺口汇总

| 工具               | PARTIAL 项                                                       | NOT-COMPARABLE 项          |
| ------------------ | ---------------------------------------------------------------- | -------------------------- |
| GitHub Copilot     | Enterprise 价格 varies                                           | —                          |
| Cursor             | Enterprise 价格 custom                                           | —                          |
| Claude Code        | Enterprise 超额按 API 计价（可算但依赖 token 消耗）              | —                          |
| OpenAI Codex       | Enterprise 价格 contact sales                                    | —                          |
| Windsurf/Devin     | Enterprise 价格 custom；独立数据使用政策页失效；额度明细随 Devin | —                          |
| JetBrains AI       | 安全认证细节、数据政策独立页缺失                                 | —                          |
| Amazon Q Developer | Enterprise 价格 contract                                         | —                          |
| Tabnine            | —                                                                | —                          |
| Cline/Aider        | —                                                                | 全部企业维度（无官方契约） |

全矩阵 NOT-COMPARABLE 单元格比例 < 10%（章程 §9 停止条件上限未触发）；各主候选均满足「≥1 官方定价页（L1）+ ≥1 官方数据使用/隐私页（L3）」最低证据要求。

---

## 3. 真实任务集（S2，T1–T6）

> 依据：research-studio/research-evidence（s2_taskset 设计）+ benchmark-records（任务实际产出）。任务覆盖五类工作：跨包修改 / 缺陷调查 / 测试 / 代码审查 / 文档研究；全部可在独立克隆的大仓库上复现，且有明确验收命令。

| 任务 | 类型     | 任务描述                                                        | 涉及包与文件                                                                                  | 验收标准                                                                          | 预期产出                                                                              | 预估复杂度 |
| ---- | -------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| T1   | 跨包修改 | channel-config 新增渠道（email）+ channel-runtime 注册          | packages/channel-config/src/index.ts、packages/channel-runtime/src/adapters/                  | 两包 typecheck 通过（channel-config tsc --noEmit、channel-runtime tsgo --noEmit） | 新渠道 adapter（email.ts）+ 渠道注册，既有契约测试保持全绿                            | medium     |
| T2   | 缺陷调查 | 修复 openai-compatible-chat-language-model.ts:387 类型安全 TODO | packages/opencorvus/src/provider/github-copilot/chat/openai-compatible-chat-language-model.ts | typecheck + 单测通过；类型安全真正恢复（独立类型探针报 TS2339）                   | 根因修复（errorStructure\<any\> + noImplicitAny:false 下 chunkSchema 隐式 any）+ 单测 | medium     |
| T3   | 测试     | transport-protocol zod 契约正向测试                             | packages/transport-protocol/src/index.ts + 新测试文件                                         | bun test 新文件通过（仅正向契约断言）                                             | 新正向契约测试文件（无负向断言）                                                      | low        |
| T4   | 代码审查 | 审查真实提交 diff（ea8ba625 / 8310bf69）                        | git diff（隔离克隆历史）                                                                      | 结构化 review 引用真实 diff 行（与 git show 比对一致）                            | 结构化审查文档（引用真实 hunk/文件/二进制哈希）                                       | low        |
| T5   | 文档研究 | 基于真实代码产出中文渠道架构说明文档                            | channel-config、channel-runtime/adapters、specs/current/architecture                          | 引用路径真实存在（≥10 处真实路径/标识符引用）                                     | 中文架构说明文档                                                                      | low        |
| T6   | 跨包接口 | coding-cli/index.ts 新增 coding CLI 档案（aider）               | packages/opencorvus/src/coding-cli/index.ts                                                   | typecheck + 现有测试通过                                                          | Icon 枚举 + DEFINITIONS 同构条目新增                                                  | medium     |

任务约束：6 个任务彼此独立、不产生写冲突；实测只允许在 /tmp 隔离克隆内执行（章程 §8）。

---

## 4. 实测对比结果与实测方法（S2）

> 依据：research-studio/benchmark-records（实测记录）+ research-studio/benchmark-method-log（方法与命令日志）。仅覆盖本机实际可用的 **claude 2.1.220** 与 **codex 0.145.0**；**禁止模拟/虚构实测结果**。

### 4.1 实测对比结果表（任务 × 工具）

质量 quality：目标达成度 0–5（验收命令通过是必要条件非充分条件；使既有契约测试转红或核心缺陷未真正修复则降分）；耗时 duration：wall-clock 分钟；人工介入：次数+类型；修改范围：文件数 / 净增减行。

**Claude Code（2.1.220）**

| 任务          | 质量         | 耗时(min) | 人工介入 | 修改范围（文件数 / +行 / -行）                                                  | 验证结果                                                                                                                    |
| ------------- | ------------ | --------- | -------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| T1            | 5            | 4.78      | 0        | 9 files / +108 / -2（含新 email.ts；另补 .env.example 与 READY_CHANNELS 13→14） | channel-config tsc EXIT=0；channel-runtime tsgo EXIT=0；registry.test.ts 14 pass/0 fail；假 SMTP 实跑 EmailAdapter 序列正确 |
| T2            | 5            | 7.97      | 0        | 2 files / +26 / -6（含新单测）                                                  | opencorvus tsc EXIT=0；新单测 5 pass/0 fail；**类型探针报 TS2339（类型安全真正恢复，阳性对照）**                            |
| T3            | 5            | 2.58      | 0        | 1 file / +0 / -0（新增测试文件）                                                | bun test contract-positive.test.ts 29 pass/0 fail（111 expects，全正向）                                                    |
| T4            | 5            | 4.32      | 0        | 1 file（T4-code-review.md，24949B，9 节）                                       | 逐条与 git show ea8ba625 比对一致；.png 实为 JPEG、孤儿资产两发现属实                                                       |
| T5            | 5            | 4.60      | 0        | 1 file（T5-channel-architecture.md，346 行）                                    | 19 处唯一包路径引用全部真实；03-control.md:84 逐字匹配                                                                      |
| T6            | 5            | 1.17      | 0        | 1 file / +15 / -0                                                               | opencorvus tsc EXIT=0；既有测试 4 pass/0 fail                                                                               |
| **合计/均值** | **均值 5.0** | **25.42** | **0**    | —                                                                               | 6/6 验收通过                                                                                                                |

**Codex（0.145.0）**

| 任务          | 质量          | 耗时(min) | 人工介入 | 修改范围（文件数 / +行 / -行）                     | 验证结果                                                                                                                                    |
| ------------- | ------------- | --------- | -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| T1            | 4             | 5.58      | 0        | 6 files / +88 / -1（新 email.ts 134 行）           | 两包 tsc/tsgo EXIT=0；**但 registry.test.ts 12 pass/2 fail（未补 .env.example 与 READY_CHANNELS 计数，破坏既有契约测试）**                  |
| T2            | 2             | 4.12      | 0        | 2 files / +6 / -4（含新单测 71 行 1 test）         | opencorvus tsc EXIT=0；新单测 1 pass/0 fail（仅运行时流式行为）；**类型探针 tsc exit=0 不报错——value 仍为 any，缺陷未真正修复（表象修复）** |
| T3            | 5             | 2.60      | 0        | 1 file（新增测试文件）                             | bun test 9 pass/0 fail（43 expects，全正向；覆盖面窄于 claude）                                                                             |
| T4            | 5             | 3.08      | 0        | 1 file（T4-code-review.md，10559B，116 行）        | 4 组引用与 git show ea8ba625 逐字一致；JPEG/80-160% 缩放范围两发现属实                                                                      |
| T5            | 5             | 5.55      | 0        | 1 file（T5-channel-architecture.md，216 行，7 节） | 18 处唯一包路径引用全部真实；27 渠道（13 native/14 planned）精确核实                                                                        |
| T6            | 5             | 1.37      | 0        | 1 file / +15 / -0                                  | opencorvus tsc EXIT=0；既有测试 4 pass/0 fail（与 claude 产出 diff 目标哈希一致）                                                           |
| **合计/均值** | **均值 4.33** | **22.30** | **0**    | —                                                  | 6/6 验收命令通过，但 T1/T2 核心目标受损                                                                                                     |

**未实测（NOT_TESTED，显著标注）**

| 工具    | 状态           | 原因                                                                                 |
| ------- | -------------- | ------------------------------------------------------------------------------------ |
| Copilot | **NOT_TESTED** | `command -v copilot` 探测失败（未安装）——Agent 能力/CLI 质量仅官方文档（L2）支撑     |
| Aider   | **NOT_TESTED** | `command -v aider` 探测失败（未安装）                                                |
| Cursor  | **NOT_TESTED** | `command -v cursor` 探测失败（未安装；GUI 应用无 CLI）                               |
| gh      | PROBED_ONLY    | gh 可用（/opt/homebrew/bin/gh）但为 GitHub CLI，非 AI 编程工具基准目标，仅记录可用性 |

**工具探测（2026-08-01）**：`command -v claude codex gh copilot aider cursor` → 可用：claude /Users/yangheng/.local/bin/claude (2.1.220)、codex /Users/yangheng/.local/bin/codex (codex-cli 0.145.0)、gh /opt/homebrew/bin/gh；未找到：copilot / aider / cursor。运行时：bun 1.3.13、node v24.18.0。

### 4.2 实测方法与日志摘要

**隔离执行**：`git clone /Users/yangheng/Desktop/opencorvus → /tmp/opencorvus-bench-20260801-002025`（本地完整克隆，非 --depth——T4 需引用祖先提交 8310bf69）；clone head `ea8ba625b247ace24ac8f32f5d0e692011f33f17`，分支 v0.0.27beta；主工作区全程只读（前后 git status 为空）；**未创建 worktree；未使用 git reset / git clean / git checkout --；不提交、不推送**；所有改动仅落在 /tmp 克隆内。

**依赖物化**：bun install（3295 packages，约 6s）；物化 packages/sdk/js/dist（gitignored 构建产物，从主工作区复制——sdk 包 exports 指向 ./dist/\*.d.ts，且 sdk 自身 build 存在自举依赖 generate-openapi → @opencorvus-ai/sdk/expert-squad-authoring）；物化后 channel-config / channel-runtime / transport-protocol / opencorvus 四包 typecheck 基线均 exit=0，与主工作区一致。

**每次运行隔离**：运行前确认 git status --short 为空；运行后 git status --short + git diff（--stat 与逐文件）核对修改范围；运行间恢复纯净用 `git restore --source=HEAD --staged --worktree -- .` + 删除 untracked 基准产出文件；**12 次运行共 12 次恢复**。

**Claude Code 命令模板（rule 37.1，脱敏）**：

```
claude -p --no-session-persistence --output-format stream-json --include-partial-messages --verbose \
  --permission-mode=bypassPermissions --disallowedTools=Task,EnterWorktree,ExitWorktree \
  --effort=medium --max-budget-usd=5 "$(cat /tmp/prompts/TN.txt)"
```

（cwd=/tmp/opencorvus-bench-20260801-002025；prompt 为单个 shell 参数置于全部选项之后；prompt 文件不含任何 .env/token/密钥；不使用 --continue/--resume/--fork-session。）

**Codex 命令模板**：

```
codex exec --cd /tmp/opencorvus-bench-20260801-002025 --sandbox workspace-write --json --ephemeral \
  -o /tmp/bench-logs/TN-codex.last.txt "$(cat /tmp/prompts/TN.txt)"
```

（注：codex 0.145.0 无 --max-budget-usd 参数，经 codex --help / codex exec --help 确认，预算控制以 --sandbox workspace-write + prompt 限界替代。）

**成功判定**：claude = 进程 exit=0 + 最终流式结果 is_error=false + subtype=success（12 次运行全部满足）+ 执行 agent 独立代码审查与验收（探针/抽查/diff 比对）；codex = 进程 exit=0 + 最终消息 + 独立验收。

**时间戳**：各次运行 start/end 为 shell 记录的 unix 秒（date +%s），duration = end-start 换算。

**命令日志摘要（12 runs）**：

| run       | 起止 epoch              | 耗时(min) | git 核对                                       | 验收输出                                  |
| --------- | ----------------------- | --------- | ---------------------------------------------- | ----------------------------------------- |
| T1-claude | 1785515172 → 1785515459 | 4.78      | 8 tracked(+108/-2)+1 untracked(email.ts)       | tsc EXIT=0；tsgo EXIT=0；registry 14/0    |
| T2-claude | 1785515493 → 1785515971 | 7.97      | 1 tracked(+26/-6)+1 untracked 测试             | tsc EXIT=0；5 pass/0 fail；探针 TS2339    |
| T3-claude | 1785515999 → 1785516154 | 2.58      | 仅 1 untracked 测试文件                        | bun test 29/0                             |
| T4-claude | 1785516195 → 1785516454 | 4.32      | 仅 T4-code-review.md                           | 引用比对一致；JPEG/孤儿资产属实           |
| T5-claude | 1785516472 → 1785516748 | 4.60      | 仅 T5-channel-architecture.md                  | 19 处引用真实；03-control.md:84 匹配      |
| T6-claude | 1785516776 → 1785516846 | 1.17      | 仅 coding-cli/index.ts(+15)                    | tsc EXIT=0；4/0                           |
| T1-codex  | 1785516901 → 1785517236 | 5.58      | 5 tracked(+88/-1)+1 untracked(email.ts 134 行) | 两包 EXIT=0；registry 12/2（契约被破坏）  |
| T2-codex  | 1785517259 → 1785517506 | 4.12      | 1 tracked(+6/-4)+1 untracked 测试(71 行)       | tsc EXIT=0；1/0；探针不报错（缺陷未修复） |
| T3-codex  | 1785517573 → 1785517729 | 2.60      | 仅 1 untracked 测试文件                        | bun test 9/0                              |
| T4-codex  | 1785517733 → 1785517918 | 3.08      | 仅 T4-code-review.md                           | 4 组引用一致；JPEG/80-160% 属实           |
| T5-codex  | 1785517926 → 1785518259 | 5.55      | 仅 T5-channel-architecture.md                  | 18 处引用真实；27 渠道核实                |
| T6-codex  | 1785518283 → 1785518365 | 1.37      | 仅 coding-cli/index.ts(+15)                    | tsc EXIT=0；4/0                           |

**事件日志（incident）**：一次恢复操作中误 rm 了 tracked 文件（openai-compatible-chat-language-model.ts），立即用 `git restore --source=HEAD -- <path>` 精确恢复（rule 22.1 允许的单文件恢复路径）；克隆与主工作区最终均 git status 为空，无数据丢失。

**证据存档**：全部实测证据保存在 /tmp/bench-logs/（65 个文件：jsonl 流式输出、diff、测试文件、审查/文档、探针结果），不属于交付物；交付物仅通过 Task Artifact Catalog 发布。

**预存仓库事实（与本次评测无关）**：packages/transport-protocol/test/contract.test.ts:103 存在 1 项 pre-existing 失败（fixture/schema 漂移，执行 agent 已独立复现）；packages/opencorvus 的 tsconfig 设 noImplicitAny:false，是 T2 缺陷的重要组成部分。

---

## 5. 年度成本模型（10/30/100 人 × 轻度/标准/重度）

> 依据：research-studio/evidence-analysis（cost_model）+ research-charter（§3.1 强度档假设、§7.3 模型结构）。
> **计算口径**：每格成本 = 席位成本（per-seat × 官方单价 × 12 × N）+ 超额用量成本（仅官方给出可换算单位时计算，否则 **NO_CONVERSION（不可换算）**）+ 企业合同一次性/最低承诺成本（Enterprise 档多 PARTIAL，未纳入单价）。
> **币种**：USD（全部官方原币种）。**假设项**：强度档用量为 **ASSUMED（章程 §3.1）**，非官方口径。团队未提供预算上限 → 只输出绝对成本与相对对比，不假设预算。

### 5.1 强度档假设（ASSUMED，章程 §3.1）

| 强度档        | 每月请求/会话口径（假设）                       | 每月 token 口径（假设）  | 典型工作形态                                      |
| ------------- | ----------------------------------------------- | ------------------------ | ------------------------------------------------- |
| 轻度 LIGHT    | 约 5,000–15,000 次请求/月/人（≈250–750 次对话） | 约 10M–30M tokens/月/人  | 代码补全、简单问答、小范围修改                    |
| 标准 STANDARD | 约 15,000–40,000 次请求/月/人                   | 约 30M–100M tokens/月/人 | 日常功能开发、常规缺陷修复、代码审查辅助          |
| 重度 HEAVY    | 约 40,000+ 次请求/月/人                         | 约 100M+ tokens/月/人    | 长会话 agent 任务、跨包多文件重构、无人值守批处理 |

### 5.2 席位成本主矩阵（团队年度成本 + 人均）

> 每格 = 团队年度成本（USD/年）；人均 = 团队年度 / 人数。席位成本与强度档无关（按席位单价×12×N），强度档差异体现在超额成本（见 §5.3）。
> 来源 URL 与访问日期随各工具 §2 官方页；单价原文保留。

| 工具 / 团队档位（单价原文）                                                    | 人均年成本           | 10 人团队年 | 30 人团队年 | 100 人团队年 | 币种 / 来源                                                                                           |
| ------------------------------------------------------------------------------ | -------------------- | ----------- | ----------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| GitHub Copilot Business（$19/user/mo）                                         | $228                 | $2,280      | $6,840      | $22,800      | USD；https://github.com/features/copilot/plans （2026-08-01）                                         |
| Cursor Teams Standard（$40/user/mo）                                           | $480                 | $4,800      | $14,400     | $48,000      | USD；https://cursor.com/pricing （2026-08-01）                                                        |
| Claude Code via Claude Team Standard（$20/seat/mo annual）                     | $240                 | $2,400      | $7,200      | $24,000      | USD；https://claude.com/pricing （2026-08-01）                                                        |
| OpenAI Codex via ChatGPT Business（$20/user/mo annual，$25 monthly，2+ users） | $240                 | $2,400      | $7,200      | $24,000      | USD；https://openai.com/chatgpt/pricing/ 、https://developers.openai.com/codex/pricing （2026-08-01） |
| Windsurf/Devin Teams（$80/mo plan + $40/full dev seat）                        | $480 + 平台费 $960/N | $5,760      | $15,360     | $48,960      | USD；https://windsurf.com/pricing （2026-08-01）                                                      |
| JetBrains AI Ultimate Org（$60/mo，70 credits）                                | $720                 | $7,200      | $21,600     | $72,000      | USD；https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html （2026-08-01）      |
| Amazon Q Developer Pro（$19/user/mo）                                          | $228                 | $2,280      | $6,840      | $22,800      | USD；https://aws.amazon.com/q/developer/pricing/ （2026-08-01）                                       |
| Tabnine Agentic Platform（$59/user/mo annual）                                 | $708                 | $7,080      | $21,240     | $70,800      | USD；https://www.tabnine.com/pricing （2026-08-01）                                                   |

_Windsurf 说明：团队年度 = $480×N + 平台费 $80/mo×12 = $480×N + $960；人均 = ($480×N + $960)/N。_

### 5.3 超额用量成本（强度档相关；ASSUMED 或 NO_CONVERSION）

| 工具                              | 官方超额单位（原文）                                                                                                             | 换算                                                                                                                                                                                           | 轻度 LIGHT                                   | 标准 STANDARD  | 重度 HEAVY  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------- | ----------- |
| GitHub Copilot Business           | credits 1=$0.01（Pro/Pro+/Max 个人档 $15/$70/$200 per mo；**Business 档 credits 未公开**）                                       | **NO_CONVERSION（Business 无公开超额单价）**                                                                                                                                                   | —                                            | —              | —           |
| Cursor Teams+                     | token rate $0.25/MTok（Teams+，官方）；套餐内 Other Models credits $20/$70/$400 per mo                                           | 可换算（ASSUMED 按 §3.1 token 档，未计 credits 抵扣）                                                                                                                                          | ≈$2.5–7.5/mo/人                              | ≈$7.5–25/mo/人 | ≈$25+/mo/人 |
| Claude Code（Team Standard 订阅） | 5h rolling window + weekly caps；无固定请求数                                                                                    | **NO_CONVERSION（订阅档无公开超额单价）**；API 模式官方单价 Opus5 $5/$25、Sonnet5 $2/$10 intro till 2026-08-31 then $3/$15、Haiku4.5 $1/$5 per MTok（HEAVY 若走 API 按实际 token 计，ASSUMED） | —                                            | —              | —           |
| OpenAI Codex（ChatGPT Business）  | 订阅内 5h window 档位（Plus/Pro 5x/Pro 20x 每 5h Sol/Terra/Luna 上限）；API 按量 Sol125in/750out、Terra50/300、Luna5/30 per MTok | **NO_CONVERSION（Business per-5h 额度已公开，与 Plus 相同：Sol10-100/Terra25-200/Luna250-2000；官方无 $↔credit 固定换算率）**；API 单价仅个人档位可换算                                       | —                                            | —              | —           |
| Windsurf/Devin Teams              | 无公开超额单价                                                                                                                   | **NO_CONVERSION**                                                                                                                                                                              | —                                            | —              | —           |
| JetBrains AI Ultimate Org         | 1 credit=$1；top-ups available；70 credits/mo                                                                                    | 可换算（ASSUMED 按强度档消耗）                                                                                                                                                                 | 超额 =（实际消耗 − 70）× $1/mo/人（ASSUMED） | 同左           | 同左        |
| Amazon Q Developer Pro            | overage $0.003/LOC beyond 4K LOC pool（transformation）；agentic requests 超额单价未公开                                         | **NO_CONVERSION（agentic 超额）**；transformation 按 $0.003/LOC（官方）                                                                                                                        | —                                            | —              | —           |
| Tabnine Agentic Platform          | own-LLM unlimited；Tabnine LLM=provider price+5%                                                                                 | own-LLM 无超额；Tabnine LLM 超额 = provider 价格 + 5%（官方公式）                                                                                                                              | —                                            | —              | —           |

### 5.4 敏感度说明

- 席位成本对「活跃用户占比」线性敏感：若按 80% 活跃折算，10/30/100 人团队有效席位成本 ×0.8（本模型按全量席位计算，章程 §7.3）。
- 超额成本仅在官方给出可换算单位时计算（Cursor / JetBrains / Tabnine / Amazon Q transformation）；其余 **NO_CONVERSION**，禁止估计。
- Enterprise 档（Copilot varies / Cursor custom / Windsurf custom / Codex contact sales / Amazon Q contract）为 PARTIAL，未纳入单价模型；正式采购须以厂商报价重算。

---

## 6. 推荐方案、适用条件、风险与试点计划

> 依据：research-studio/evidence-analysis（recommendations R1–R6 + claims C1–C8 + limitations L1–L7）+ fact-check 裁决（minor_corrections）。

### 6.1 推荐方案（R1–R5）

| 编号 | 推荐                                                                                                          | 理由（证据链）                                                                                                                                           | 适用条件                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | **组合首选：GitHub Copilot Business（$19/user/mo）+ Claude Code（Claude Team/Enterprise 订阅捆绑）**          | 7 维覆盖最全（Copilot：多 IDE+CLI/agent+Business 默认不训练+SSO/审计/DPA）与实测质量最高（Claude Code 6/6 quality=5）互补；两者企业治理/数据政策均可审计 | 需同时采购 IDE 补全与重型 agent 任务能力；预算按席位成本 Copilot $228/人/年 + Claude Team $240/人/年                                                                 |
| R2   | **预算敏感替代：OpenAI Codex（ChatGPT Business $20/user/mo annual）或 Amazon Q Developer Pro（$19/user/mo）** | 两者团队档单价最低（$228–240/人/年），均默认不训练，具备 agent/CLI 能力                                                                                  | 接受 Codex 实测 T1 破坏契约测试、T2 表象修复的风险（需严格验收命令 + 类型探针）；Amazon Q 需 AWS 生态                                                                |
| R3   | IDE 原生体验优先：Cursor Teams（Privacy Mode 全档、SOC 2 Type II、$0.25/MTok 超额可算）                       | Cursor 在隐私与安全认证维度强，且超额单价可换算                                                                                                          | 需补充 Cursor CLI 实测（本机当前 NOT_TESTED）；注意 Daily Agent $60-100/mo 为官方 docs 指引（cursor.com/docs/account/pricing，2026-08-02）；数据驻留 +10% 成本需评估 |
| R4   | 生态替代：JetBrains 生态 → AI Ultimate Org（$60/mo/70 credits）；AWS 生态 → Amazon Q Pro（$19/user/mo）       | 生态绑定场景下治理/账单与现有平台集成成本最低                                                                                                            | JetBrains credits 口径与 token/请求不可直接换算（NO_CONVERSION 项禁止估计）                                                                                          |
| R5   | **排除：Cline/Aider（无官方企业契约，NOT-COMPARABLE）；Windsurf/Devin 谨慎（数据政策页 PARTIAL）**            | 章程 §3.3/§3.4 判定标准                                                                                                                                  | 若团队坚持开源/自管，走 BYO 模型 API 成本建模（本章程非目标）                                                                                                        |

> **fact-check 修正落实（§6.5 详述）**：『预算敏感替代：OpenAI Codex（ChatGPT Business $20/user/mo annual）或 Amazon Q Developer Pro（$19/user/mo）』属于 **recommendations R2**，不属于 direct_answer——本报告将其置于推荐方案章节（上表 R2），未将其表述为「直接回答」的一部分。

### 6.2 主要风险

| 风险             | 描述                                                                                                                                                                 | 证据链（limitations） |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 价格变动         | 定价/额度/政策为 2026-08-01 快照；交付距访问日超 14 天需标 **STALE**，不能作为远期采购合同的唯一依据                                                                 | L1                    |
| 企业档价格不可比 | Enterprise 档多为 PARTIAL/custom（Copilot varies、Cursor custom、Windsurf custom、Codex contact sales、Amazon Q contract），未纳入单价模型；企业合同最低承诺成本缺失 | L2                    |
| 数据安全         | Windsurf 独立数据使用政策页已失效（PARTIAL），训练/保留/传输政策无法从官方确认；其余工具默认不训练政策见 §2 各表（Business/Team/Enterprise no-training）             | L5                    |
| 厂商锁定         | 各工具计费单位不同且多数超额不可换算（NO_CONVERSION），切换成本高；JetBrains credits 口径与 token 不可直接换算                                                       | L4、§5.3              |
| 实测局限         | 仅覆盖本机可用的 claude 与 codex；Copilot/Cursor/Aider 因 CLI 不可用 **NOT_TESTED**，其 Agent 维度结论置信度低于 claude/codex；实测为单次运行快照                    | L3                    |
| 预存技术债       | transport-protocol 既有 contract.test.ts:103 存在 1 项 pre-existing 失败（fixture/schema 漂移，与评测无关，已独立复现）                                              | L6                    |
| 结论可扩展性     | S3 依赖 S1+S2 闭合；后续补充其他工具实测需重算                                                                                                                       | L7                    |

### 6.3 10 人团队 4 周试点计划

**目标**：在最小预算与治理成本下验证「Copilot Business + Claude Code」组合（R1）在 OpenCorvus 真实工程形态（TypeScript/Bun monorepo、CLI+Agent 工作流）上的质量、效率与合规，并保留 R2 备选路径。

| 周         | 活动                                                                                                                                                                                      | 验收/产出                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| W1（准备） | 采购开通 Copilot Business（10 seats）+ Claude Team Standard（10 seats）；建立隔离评测环境（/tmp 克隆 + 依赖物化，复刻 benchmark-method-log 流程）；录制基线：四包 typecheck/test 全绿基线 | 基线记录；席位开通确认；数据不训练政策书面确认（Business/Team 默认 no-training）          |
| W2（实测） | 用 T1（跨包修改）、T2（缺陷调查）、T3（测试）类真实任务运行 Claude Code（rule 37.1 命令模板）；Copilot 用于 IDE 补全与日常 agent 任务                                                     | 每任务记录 quality / duration / human_interventions / 修改范围 / 验证结果（与 §4.1 同构） |
| W3（扩展） | 覆盖 T4（代码审查）、T5（文档研究）、T6（跨包接口）任务面；每周独立复核（类型探针/契约测试抽查）                                                                                          | 6 类任务全部覆盖；既有契约测试保持全绿                                                    |
| W4（决策） | 汇总指标；对照 R2 预算敏感替代（Codex/Amazon Q 单价）与 R3/R4 备选；形成采购决策书                                                                                                        | 决策书 + 是否扩大至 30 人的建议                                                           |

**试点指标（KPI）**：

- **质量**：验收命令（typecheck/test/build）通过率 ≥ 90%；类型探针/契约测试零回归（T2 类缺陷必须探针证明真正修复）；
- **效率**：任务平均耗时（参考 §4.1 基线：Claude Code 25.42 min/6 任务）与人均周任务数；
- **人工介入**：次数与类型（澄清/纠错/权限确认）——目标 0–2 次/任务；
- **成本**：实际席位成本（$228+$240/人/年）vs 预算；超额用量（如有）是否符合 §5.3 口径；
- **治理与合规**：SSO/审计日志可用性；确认无训练默认策略生效；无数据安全事件。

**退出条件**：

- **通过（扩至 30 人）**：4 周内验收通过率 ≥ 90%、0 次重大契约破坏、0 人工介入超限任务、无数据合规告警、成本在相对预算内（无预算上限 → 与 R2 备选单价对比不超 1.3×）；
- **不通过（转备选或重评）**：连续两周验收通过率 < 70%、出现数据安全/合规事件、或实际成本显著超预算（>2× 席位成本）→ 转 R2（Codex/Amazon Q）或暂停采购重新评估；
- **灰度（延长 2 周）**：部分指标未达标但趋势向好（如 W2 通过率 80% → W3 90%），延长试点 2 周再评估。

### 6.4 证据链：claims C1–C8 映射

| Claim | 内容                                                                                                                                                                                 | 支撑证据                                                                                                                                                              | 置信度 | 范围                                                                     | 不确定性                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| C1    | GitHub Copilot Business 档 $19/user/mo，Business/Enterprise 数据默认不用于训练，支持 SAML SSO、审计日志、IP 赔偿与 DPA/GDPR                                                          | research-evidence github-copilot pricing/admin/security/data_usage + 官方定价与计费文档 URL                                                                           | HIGH   | S1 官方文档事实（L1/L2/L3），访问日期 2026-08-01                         | Enterprise 档价格为 varies（PARTIAL），未纳入单价模型                                                          |
| C2    | Claude Code 无独立订阅，捆绑在 Claude 付费订阅内（Pro $20/mo / Max from $100 / Team Standard $20/seat/mo annual / Team Premium $100/seat/mo annual），Team/Enterprise 默认不训练     | research-evidence claude-code pricing/data_usage + https://claude.com/pricing                                                                                         | HIGH   | S1 官方定价事实（L1），访问日期 2026-08-01                               | Enterprise 超额按 API 计价（$20/seat+usage），实际用量成本依赖 token 消耗                                      |
| C3    | Claude Code 实测 6/6 任务 quality=5、验收全通过、0 人工介入、总耗时 25.42 分钟；T2 类型安全缺陷被真正修复（独立类型探针报 TS2339，阳性对照有效）                                     | benchmark-records claude per_task 全部记录 + T2 verification；benchmark-method-log T1–T6-claude 命令日志                                                              | HIGH   | S2 实测（隔离克隆 /tmp/opencorvus-bench-20260801-002025，head ea8ba625） | 实测为单次运行快照；评分由执行 agent 独立复核给出                                                              |
| C4    | Codex 实测 T1 破坏既有契约测试（registry.test.ts 12 pass/2 fail），T2 为表象修复（类型探针 tsc exit=0 不报错，value 仍为 any），quality 2/5，平均 4.33                               | benchmark-records codex T1/T2 记录与 verification；benchmark-method-log T1/T2-codex 命令日志                                                                          | HIGH   | S2 实测（codex-cli 0.145.0）                                             | codex 0.145.0 无 --max-budget-usd 参数，预算控制以 --sandbox workspace-write+prompt 限界替代（方法日志已记录） |
| C5    | 实测方法满足章程 §8 硬约束：/tmp 隔离克隆、主工作区只读（前后 git status 为空）、禁止 worktree/git reset/git clean/git checkout --、12 次运行 12 次恢复、不提交不推送、prompt 无密钥 | benchmark-method-log method_summary/isolation/per_run_isolation/incident_log/no_secrets；incident_log 记录一次误 rm 后 git restore --source=HEAD -- \<path\> 精确恢复 | HIGH   | S2 方法审计                                                              | 无                                                                                                             |
| C6    | Cline/Aider 无官方企业定价/政策，判定 NOT-COMPARABLE 并按章程 3.3 排除主矩阵；copilot/aider/cursor 本机不可用（command -v 失败）标注 NOT_TESTED                                      | research-evidence cline-aider comparability=NOT-COMPARABLE；benchmark-records not_tested 列表 + tool_probe                                                            | HIGH   | S1 取舍结论 + S2 工具探测（2026-08-01）                                  | NOT_TESTED 工具（Copilot/Cursor/Aider）的能力评估仅基于官方文档，无实测证据                                    |
| C7    | Windsurf 已并入 Devin，windsurf.com/pricing 现渲染 Devin 定价（Free $0/Pro $20/Max $200/Teams $80 plan+$40 seat/Enterprise custom），独立数据政策页失效（PARTIAL）                   | research-evidence windsurf-devin pricing/comparability=PARTIAL；source_url https://windsurf.com/pricing                                                               | MEDIUM | S1 官方页面事实（L1），访问日期 2026-08-01                               | 产品合并期间数据政策与额度细节随 Devin 演进，需采购前复核                                                      |
| C8    | 成本模型每格=席位成本（官方单价×12×N）+超额（仅官方单位可算）+企业最低承诺（Enterprise PARTIAL 未纳入）；10/30/100 人×LIGHT/STANDARD/HEAVY 全矩阵已给出，超额多数 NO_CONVERSION      | charter §7.3 cost_model_structure 与 §3.1 强度档假设；research-evidence pricing 字段                                                                                  | MEDIUM | S3 模型（基于 S1 官方单价 + 章程口径）                                   | 强度档用量为 ASSUMED（非官方口径）；超额换算依赖假设；Enterprise 档 custom 价格未纳入                          |

### 6.5 fact-check 裁决与修正落实

fact-check 复核范围：evidence-analysis（target message hash 43719cab…，15 项全部检查）；总体裁决 **minor_corrections**（13 verified / 1 minor correction / 0 unresolved）。

- **已核实（13 项）**：Artifact 发布与目录唯一命中、payload 完整性（9 工具对比矩阵 / 2 工具实测 / 8 工具成本 / C1–C8 / L1–L7 / R1–R6 / 4 个 evidence locator）、source_artifact_locators 一致性、上次发布失败根因与修复（tool-input-invalid → 合法嵌套 JSON）、实测矩阵数字（claude 25.42min 均值 5；codex mean 4.33、T1 契约破坏、T2 表象修复）、成本矩阵逐项吻合（19/40/20/20/480/60/19/59 ×12×N，其中 480 为 Windsurf 年化席位价 = $40/mo×12，其余为月度单价）、claims C1–C7 与证据一致、limitations L1–L7 覆盖、recommendations R1–R6 为与事实分离的建议、遗留限制（NOT_TESTED / Enterprise PARTIAL / 2026-08-01 快照）。
- **已修正（1 项，minor）**：『预算敏感替代：OpenAI Codex（ChatGPT Business $20/user/mo annual）或 Amazon Q Developer Pro（$19/user/mo）』的显式推荐表述位于 **recommendations R2**，不在 direct_answer 内——direct_answer 仅在成本摘要中列出 Codex/Amazon Q 数字。本报告第 6.1 节已将该推荐归入「推荐方案 R2」章节（见 §6.1 上表与附注），并据此重述直接结论。
- **未解决（0 项）**。

### 6.6 直接结论（基于证据，非推荐归属）

在当前时间窗口（2026-08-01～2026-08-08），针对 OpenCorvus 真实工程形态的『当前可购买』AI 编程工具选型，S3 直接结论（事实层面）：

1. **7 维对比**：适合采购决策的组合首选为 GitHub Copilot Business（$19/user/mo）与 Claude Code（捆绑 Claude Team Standard $20/seat/mo 或 Team Premium $100/seat/mo，无独立订阅）——两者企业治理/数据政策均可审计；
2. **实测**（仅覆盖 claude 2.1.220 与 codex 0.145.0，12 次运行）：Claude Code 6/6 任务 quality=5、验收通过、0 人工介入、总耗时 25.42 分钟；Codex 总耗时 22.3 分钟，但 T1 破坏既有契约测试、T2 仅表象修复（类型探针 tsc exit=0 不报错），平均 quality 4.33；
3. **成本**（席位成本，官方单价×12×N）：Copilot Business ≈ $2,280/$6,840/$22,800；Claude Team Standard ≈ $2,400/$7,200/$24,000；超额用量多数 NO_CONVERSION（官方无公开换算依据）；
4. **排除**：Cline/Aider 因无官方企业定价/政策按章程 3.3 判定 NOT-COMPARABLE；copilot/aider/cursor 本机不可用（command -v 失败）标注 NOT_TESTED，不阻塞整体结论。所有价格/档位名/币种/URL 保留官方原文，访问日期 2026-08-01。

---

_报告归档：specs/artifacts/ai-coding-tools-selection-report.md；结构化数据：specs/artifacts/ai-coding-tools-selection-data.json；复核记录：specs/artifacts/ai-coding-tools-selection-review-2026-08-02.md（2026-08-02，12/12 官方 URL 一致）。动态事实（定价/额度/政策）访问日期 2026-08-01，交付超 14 天须按章程 §6 标注 STALE 并复核。_
