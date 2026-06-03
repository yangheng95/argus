# Stage-agent web-search 能力契约修复 + Exa 单源收敛

> 状态: 待实施 | 日期: 2026-05-19 | 分支: feat/architect-contract-audit-coverage
> 触发: 任务 tsk_e40ca29c00012nxf5M0eHIZdpG「为埃克塞特大学的 Dr Heng Yang 攥写一份学术简历」
> 编排器派 explore 调研 → explore 无 websearch → 退化 webfetch 打 Google Scholar 被反爬拦 → MessageAbortedError → 任务 65s cancelled

## 1. 根因（基于 feat/architect-contract-audit-coverage @615d5b1a02 重新核对）

权限层与工具层分离: `defaults` 权限 `websearch:"allow"`（agent.ts:100），注释明确
"Tool availability is still controlled separately by each agent's include/exclude list"。
真正闸门是工具 include/exclude 白名单 + context-tools 的 env gate。

### BUG① — explore 无搜索能力
`agent.ts:176` explore `tools.include = [read,glob,search_code,bash,external_code_search,lsp,webfetch,memory]`
有 `webfetch` 无 `websearch`。explore 是调研子 agent，只能抓已知 URL、不能搜索。
orchestrator（agent.ts diff: include 新增 `explore`）现在会主动派 explore 调研，爆发面扩大。

### BUG② — 4 个 stage agent web 搜索被双闸锁死
- **闸 A**: `context-tools.ts:104` `web_search` 仅当 `process.env.OPENCORVUS_ENABLE_WEB_SEARCH === "1"` 才产出。
  全仓 grep 该 env: 只有 gating 代码 + `test/agent/context-tools.test.ts` 引用，**无任何地方设置**（.env / server / benchmark 均无）→ 实际永远关闭 = 死开关（rule 7/10）。
- **闸 B（pull 新增）**: `agent.ts` requirements(322-331)/architect(343-352)/frontend-design(371-380)/intent-analysis(392-401)
  新增显式 `tools.include` 白名单，**均不含 `web_search`/`websearch`**。`filter-tools.ts:31-34`
  `if (include && include.length>0 && !include.includes(name)) return false` → 即使解开闸 A 仍被剔除。
- 叠加: 这 4 个 agent 连 `webfetch` 都没有；名称分叉 `web_search`(context-tools) vs `websearch`(registry)（rule 8）；
  4 个 core prompt（requirements/architect/frontend-design/intent-analysis-core.txt）全不提 web 搜索（rule 36 prompt↔能力失配）。

## 2. 全仓调用点枚举（rule 35）

| 文件 | 现状 | 处置 |
|---|---|---|
| `src/tool/websearch.ts` | registry `WebSearchTool` = `Tool.define("websearch")`，Exa `web_search_exa`，ctx.ask 权限，abortAfterAny(25s)，返回 {output,title,metadata} | 改为调用共享 `exaMcpCall()`；名称/shape 不变（canonical name = `websearch`） |
| `src/agent/context-tools.ts` | ai-sdk `tool()` `web_search`，Exa `web_search_exa`，AbortSignal.timeout(20s)，返回 string，**env-gated** | 重命名 key `web_search`→`websearch`；删 env gate（默认产出）；底层改调 `exaMcpCall()` |
| `src/tool/codesearch.ts` | `Tool.define("external_code_search")`，Exa `get_code_context_exa`（不同 method，同传输） | 底层改调共享 `exaMcpCall()`，自身 method/params 保留（非本 bug，但 rule 35/9 同源传输须收敛） |
| `src/agent/agent.ts` explore:176 | include 无 websearch | include 加 `"websearch"` |
| `src/agent/agent.ts` requirements:322 | include 无 websearch | include 加 `"websearch"` |
| `src/agent/agent.ts` architect:343 | include 无 websearch | include 加 `"websearch"` |
| `src/agent/agent.ts` frontend-design:371 | include 无 websearch | include 加 `"websearch"`（用户 2026-05-19 拍板：也加） |
| `src/agent/agent.ts` intent-analysis:392 | include 无 websearch | include 加 `"websearch"` |
| `src/prompt/core/{requirements,architect,frontend-design,intent-analysis}-core.txt` | 不提 web 搜索 | 各补一段 websearch 调研指引 |
| `src/agent/prompt/explore.txt:25` | 只提 webfetch | 补 websearch 优先于 webfetch 的指引 |
| `test/agent/context-tools.test.ts:6-26` | 测 env-gate | 改为断言默认产出 `websearch`；删 env-gate 用例 |
| `test/agent/runner-tool-scope.test.ts` | 现有 tool-scope 断言 | 扩：explore + 4 stage agent 解析后工具集含 `websearch` |
| `orchestrator` (agent.ts:274) | include 无 webfetch/websearch | 不动（scheduler，故意，agent.ts 注释明确） |
| integrity/prosecutor/compaction/title/summary/control | include:[] / [panel] | 不动（注入式/无工具，故意） |
| ~~acceptance~~ | pull 已删（deliver 退役） | N/A |

## 3. 设计决策

1. **单源收敛（rule 8）**: 新建 `src/tool/exa-mcp.ts` 导出 `exaMcpCall({method,arguments,timeoutMs,signal})`
   —— 封装 `POST https://mcp.exa.ai/mcp` + `x-api-key` header + JSON-RPC body + SSE `data:` 行解析 + `result.content[0].text` 提取。
   websearch.ts / context-tools.ts / codesearch.ts 三处共用，消除三源传输复制（rule 9）。
   不抽 LLM 工具 shape（Tool.define vs ai-sdk tool()），因二者由不同 runtime 消费，强抽属过度工程（rule 5）。
2. **canonical 名 = `websearch`（无下划线）**: 与 registry 既有名一致，改的是 context-tools 那一侧（影响面小）。
3. **删死开关 `OPENCORVUS_ENABLE_WEB_SEARCH`**（rule 7/10）: 无人设置的开关是死代码，不保留"运维逆瓣"——
   要禁用某 agent 的 websearch 应通过 `tools.exclude`/移出 `include`，单一机制，不引入第二条平行开关。
4. **闸 B 必须显式开**: stage agent include 是声明式能力契约（rule 6.1：config 层合法，非 host 守门）。
   逐个把 `websearch` 加入 5 个调研 agent 的 include；其余 agent 不动（保持各自职责边界）。

## 4. 验收

- `bun run typecheck`
- `bun test test/agent/runner-tool-scope.test.ts test/agent/context-tools.test.ts test/tool/schema-snapshot.test.ts`
- 断言: explore/requirements/architect/frontend-design/intent-analysis 解析后工具集均含 `websearch`；
  context-tools 默认（无 env）即产出 `websearch`；`web_search` 名不再存在（防双源回归）。
- 复测原失败任务形态: explore 调研类任务能调 websearch，不再退化 webfetch 撞反爬。

## 5. 用户审查纠偏（2026-05-19，rule 35 — 显式标注，非静默重写）

复测 task tsk_e40e99078001TKQEEbeisRhuFw（同"写简历"请求，本修复 push 后）暴露原方案选错靶：

- 同一 `Model tried to call unavailable tool 'websearch'` 报错有**两个病灶**。原方案
  只采样到第一个任务的 explore 路径（rule 35 单点泛化违规），漏掉了：**编排器自己**
  （deepseek-v4-flash）面对非代码任务时 `skill(research-report)` + `todowrite` +
  `websearch` 亲自下场。host 守门正确拦截（agent.ts:278-296 故意不给编排器 websearch）。
- 真根因是编排器**角色纪律**（rule 6.1：host 守门已正确工作，修 prompt 不修 host）。
- 原方案给 intent-analysis / frontend-design 加 websearch 属**过度扩张**（rule 5）：
  intent-analysis 实测在分类阶段 `websearch ×8` = 反模式；frontend-design 本职网页证据
  提取，通用 web 搜索与其证据链冗余且诱发 score loop。

修订（保留 §1-4 的单源收敛 + exa-mcp + explore/requirements/architect websearch）：

| Agent | §1-4 原方案 | 修订后 | 理由 |
|---|---|---|---|
| explore | 加 websearch | **保留** | 名副其实调研子 agent，webfetch 被反爬不够 |
| requirements / architect | 加 websearch | **保留** | 产出持久技术决策，greenfield 核实选型是本职 |
| intent-analysis | 加 websearch | **回退** | 首个廉价分类步，研究违背职责（×8 实证） |
| frontend-design | 加 websearch | **回退** | 本职网页证据提取，通用 web 搜索冗余 |
| orchestrator | 未涉及 | **新增 prompt 纪律** | `orchestrator-core.txt` Mission 段：deliverable-shape-agnostic 禁止自产；显式禁 skill/websearch/webfetch/todowrite 自干，一律 dispatch |

context-tools.ts / exa-mcp.ts 单源收敛与 explore/requirements/architect websearch **不回退**
（rule 8 正确且与本纠偏正交）。

### 仍未解决（需用户决策，超出 1/2 范围）
"写一份学术简历"这类纯文档/调研交付物与代码流水线（intent→requirements→architect→build
→integrity + pnpm build/test/typecheck 检查）根本不匹配。编排器纪律修好后会正确 dispatch，
但下游代码管道是否能产出非代码交付物，是独立的架构决策（原方案 §未覆盖）。
