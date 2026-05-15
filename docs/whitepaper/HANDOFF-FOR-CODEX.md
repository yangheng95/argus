# OpenCorvus 白皮书与周报 · Codex 交接 Brief

> 任务：**返工** OpenCorvus 技术白皮书与项目周报。
> 当前产出由 Claude 写就，用户多轮反馈后仍不满意（最新原话：「内容幼稚」「电子垃圾」），现交由 codex 整体重做。
> 本文件**不告诉 codex 应该写成什么样**——只把用户的原始要求、已知约束、可验证事实、已暴露的错误一次性交付，由 codex 自行判断重做策略。

---

## 1 · 用户的原始诉求（按时间线，保留原话）

| # | 用户原话 | 含义解读（仅供参考，原话为准） |
|---|---|---|
| 1 | 「完成一个 Html 版的通俗易懂的 Opencorvus 技术白皮书，包括数据库，前后端，算法框架等等」 | 单文件 HTML、覆盖数据库 / 前后端 / 算法框架 / 通俗易懂 |
| 2 | 「这是个什么鬼东西？你用独立的设计师 agent 和内容审核官来 review，防止你瞎搞。迭代 10 轮」 | 不接受单循环写作。要求双独立 review（设计师 + 内容审核官），10 轮迭代 |
| 3 | 「现在这个东西就是纯纯的电子垃圾」 | 对 R2 之前版本全盘否定，要求大幅重写 |
| 4 | 「用准确精炼的表述和视觉材料描述项目的规模，不要吹嘘，要不显山不漏水，对比 opencode，openclaw 这种」 | 客观规模数据、不吹嘘、克制；与同类项目（如 opencode）对照 |
| 5 | 「我换个说法，你要体现我的工作量和价值」 | 不只是客观数字；需让读者识别出 OpenCorvus 自身（fork 之后）的工程投入 |
| 6 | 「内容幼稚」 | 调性整体不对——日常类比、拟人化、装饰性 callout、营销腔均需去除 |
| 7 | 「囊括内容：汇报的重点：# 总体情况 # 关键里程碑 # 本周（做了什么 / 核心结果 / 数据/指标变化 / blocker / 业务结果 / 下周计划）」 | 在白皮书之外，另出一份周报，结构按此 |
| 8 | 「你干脆让 codex 来返工所有，把我的要求总结转述」 | 当前——交付本 brief |

---

## 2 · 用户提供的视觉材料（必须使用）

绝对路径，已复制到 `docs/whitepaper/assets/`：

- `assets/agent-comparison.png`　两种 Agent 工作方式对比（来自 `c:/Users/chuan/Downloads/问题分析.png`）
- `assets/orchestration-framework.png`　事件驱动的单题编排（来自 `c:/Users/chuan/Downloads/编排框架.png`）
- `assets/opencorvus-goal-design.png`　Goal 设计三段式（来自 `c:/Users/chuan/Downloads/Opencorvus调度.png`）

返工时这三张图必须保留并合理使用；可以新增 SVG 自绘图，不能丢这三张。

---

## 3 · 必须遵守的项目硬规则（来自 `CLAUDE.md`）

下列规则约束**返工本身**与**返工产出的内容**：

- **rule 7 / 8**：禁止 fallback、禁止双源；产出与既有文档/代码不应有平行实现。
- **rule 11**：拦截违反抽象哲学的写法。
- **rule 16 / 17**：不留兼容代码、不留死代码。
- **rule 19**：缩写术语必须给注释（如 REQ-N、SSE、WAL）。
- **rule 20 / 27**：禁止「最简单的修复」、禁止补丁式糊弄式修复——内容失实必须根因修复。
- **rule 24**：自己验收过仍必须复核交付物。
- **rule 25**：视觉相关 benchmark 必须以视觉呈现（不准 headless）。
- **rule 28b**：若交付不达成，必须坦诚承认未达成、明列未解决问题，禁止包装成「基本完成」。
- **rule 30**：Explore/SubAgent 任务优先并行。
- **rule 32 / 33**：方案必须落盘；改动前后 commit + push（不绕 hook，不传 `--no-verify`）。
- **rule 35**：方案落盘前必须穷举调用点 / 全仓 grep；**任何提到的函数 / 表名 / 接口 / 工具名都必须 grep 验证**——这是过去 Claude 反复违反的规则，是大量失实的根因。

---

## 4 · 当前已落盘的产出（待返工的对象）

| 文件 | 用途 | 当前状态 |
|---|---|---|
| `docs/whitepaper/opencorvus-whitepaper.html` | 技术白皮书 v2026.05 主文件 | 经 9 轮 Claude 迭代，仍被用户判定为「内容幼稚」 |
| `docs/whitepaper/assets/*.png` | 三张视觉材料 | 必须保留 |
| `docs/reports/weekly-2026-w20.html` | 项目周报 2026-W20 | 第一版，未经评审 |
| `docs/whitepaper/HANDOFF-FOR-CODEX.md` | 本文件 | 交接 brief |

**返工时可以删除上述 HTML 全部内容、从零重写**，但必须保留三张 PNG 图与本文件。

---

## 5 · 已知 CRITICAL 失实点（必须避免重复）

下列失实点是历次 review 中已发现的、Claude 多次犯过的错误。返工时**每条必须先 grep / read 仓库验证再写**：

### 5.1 工具与 API 命名（必须从 `orchestrator/tools.ts` grep `: tool\(` 验证）
- 真实工具名：`analyze_intent` / `requirements` / `design_analysis` / `architect` / `integrity` / `prosecute` / `build` / `deliver` 等共 21 个。
- ❌ 不存在的工具名（**Claude 多次杜撰**）：`dispatch_intent_analysis` / `dispatch_architect` / `dispatch_build` / `dispatch_*` 任何形式。

### 5.2 Acceptance Spec 字段
- 真实字段：`scorers: ScorerSchema[]`（数组，schema 层 `.min(1)`）。验证：`packages/opencorvus/src/acceptance/types.ts:114`。
- ❌ 错写为单数 `scorer:`。

### 5.3 数据库表
- 真实表数：`grep -c "CREATE TABLE\|CREATE VIRTUAL TABLE" packages/opencorvus/src/storage/ddl.ts` = **44**（不是 43）。
- `memory_embedding` 是**独立表**（`memory.sql.ts:52` / `ddl.ts:214`），embedding 字段不在 `memory_file` 上。
- ❌ 把 `memory_embedding` 字段写在 `memory_file` 行。

### 5.4 ContractIR 例子
- `enum.variants` 是 `Array<{ value: string, meaning: string }>`（`contract-ir.ts:65–71`），meaning 必填。
- ❌ 写成字符串数组 `["pending", "active", "done"]`——schema 不通过。

### 5.5 Architect 至少 2 goal 的强制
- 真实实现：`packages/opencorvus/src/architect/output-tools.ts:90` 常量 `MIN_ARCHITECT_GOAL_COUNT = 2` + 运行时校验，`agent.ts:181` 抛错。
- ❌ 描述为 `z.array(...).min(2)` schema 校验。

### 5.6 SessionKind
- 真实 15 项：`session.sql.ts:50–65` `root | orchestrator | assistant | gateway | intent-analysis | requirements | design-analyst | goal | architect | integrity | delivery | executor | build | evaluator | system`。
- 9 个对外 Agent ≠ 上述 15 项的子集与 9 Agent prompt 一一对应；prosecutor 有 `agent.ts` 但**没有独立 SessionKind**。返工时必须澄清这点。

### 5.7 通道适配器
- `ls packages/channel-runtime/src/adapters/*.ts | wc -l` = **15**：dingtalk / discord / feishu / googlechat / http / line / matrix / mattermost / msteams / qq / signal / slack / telegram / wecom / whatsapp。
- ❌ 写为 14 / 13 / 漏 qq / 漏 http。

### 5.8 Overlay 组件
- `find packages/overlay/src -name "*.tsx" | wc -l` = **76**（不是 75，不是 79）。
- 总 ts+tsx = 177。

### 5.9 执行器文件命名
- 真实文件：`packages/opencorvus/src/executor/opencorvus.ts`（已于 2026-05-14 commit `1ee285e5b` 完成 rename）。
- ❌ 写为「底层 class 仍叫 OpencodeExecutor / 文件叫 opencode.ts」——这是过期事实，已不存在。
- `mirrorcode` 是 executor id；致敬血缘自 sst/opencode。

### 5.10 SerialQueue / 调度器
- 真实类：`packages/opencorvus/src/scheduler/task-queue-service.ts` 中的 `TaskQueueService`。
- ❌ 写为「SerialQueue」——白皮书自创，代码不存在。

### 5.11 commit 数
- `git log --oneline | wc -l` = 12506（含 fork 自 sst/opencode 的早期 11k+ 上游 commit）。
- `git log --oneline -- packages/opencorvus | wc -l` = **1503**（OpenCorvus 自身）。
- ❌ 把 12.5k+ 描述为 OpenCorvus 自身工作量——**这是用户最敏感的吹嘘点之一**。

### 5.12 不存在的对外资源
- `opencorvus.ai` 域名当前未上线。所有 install 命令、引用 URL 应使用 GitHub repo URL：`https://github.com/yangheng95/opencorvus`。

---

## 6 · 用户对调性的明确否定列表

返工产出**禁止包含**以下要素（来自用户「内容幼稚」的反馈）：

### 6.1 日常类比 / 拟人化
- ❌「工厂的传送带——每个工位（Agent）只做自己的事」
- ❌「盖房子前，结构工程师不会光说承重墙在那里」
- ❌「一道菜出锅前的四种验收：尝一口、请大厨打分、量个温度、对照配方」
- ❌「一份合同的归档——文件柜里有原始合同」
- ❌「一位医生不会守在病床前 24 小时刷新」
- ❌「Build Agent 是工头，Executor 是工人」
- ❌「就像 Kubernetes 调度容器，而不是用 Kubernetes 替代容器」
- ❌「把一家软件咨询公司浓缩成 9 个 AI 角色——产品经理、需求分析师、视觉设计师、架构师、开发、QA、交付审查、对抗测试、项目经理」
- ❌「Harness 字面意思是马具——把奔腾的力量变成可方向、可制动、可挂载的运输工具」

### 6.2 装饰性 lede 标签
- ❌ 每章首段用 `<span class="lede-label">类比</span>` / `<span class="lede-label">一句话</span>` / `场景` / `事实` / `最快路径` / `反向论证` 等机械化前缀。

### 6.3 自我表扬式 callout 标题
- ❌「核心理念」「核心创新」「关键观察」「为什么坚持事件驱动」「Harness 到底是什么」「9 vs 15」等装饰性 callout 标签。
- ❌ 整段「OpenCorvus 不是一个 demo——它是一个被 SQLite schema、单元测试、9 个 Agent prompt、15 个通道适配器和 12000+ commit 一起约束着推进的工程项目」这种反向防御性营销腔。

### 6.4 感性结尾
- ❌「如果有一天编码 Agent 能稳定地一次交付，那一定不是因为单个模型变得更聪明，而是因为框架本身学会了如何让多个模型互相纠错、互相验证、互相对抗——这是 OpenCorvus 选择的赛道」这类抒情段。

### 6.5 玩具式三态符号
- ❌ 对照表中过度使用 ✓ / 部分 / — 三态而无判据；如果用必须先给硬判据。

### 6.6 营销 hero 文案
- ❌「在你不盯人的时候」这种文案。

---

## 7 · 用户明确要求保留 / 加入的内容

### 7.1 必须有
- 单文件 HTML，可独立分发。
- 涵盖：数据库 / 前后端 / 算法框架 / 编排流程 / 部署。
- 三张视觉材料（`assets/*.png`）必须出现并合理使用。
- **客观规模数据**：用准确数字描述项目体量。
- **同类对照**：与 `sst/opencode`、Claude Code、Codex CLI、aider、cline 等做客观能力定位（不是「OpenCorvus 全胜」式排比）。
- **体现 OpenCorvus 自身工作量与价值**——但要克制、不显山不露水、不吹嘘。

### 7.2 周报另出
- 文件：`docs/reports/weekly-2026-w20.html`（已存在第一版，可重做）。
- 结构：`# 总体情况` / `# 关键里程碑` / `# 本周（做了什么 / 核心结果 / 数据/指标变化 / blocker / 业务结果 / 下周计划）`。

---

## 8 · 仓库定位（codex 应先执行的复核）

```bash
# 仓库根
cd C:/Users/chuan/myhexin-local/opecorvus

# 9 个对外 Agent 的入口文件
ls packages/opencorvus/src/{intent-analysis,requirements,design-analyst,architect,build,integrity,delivery,prosecutor,orchestrator}/agent.ts

# 21 个 Orchestrator 工具调用（真实命名）
grep -nE "^    [a-z_]+: tool\(" packages/opencorvus/src/orchestrator/tools.ts

# 44 张表
grep -cE "CREATE TABLE|CREATE VIRTUAL TABLE" packages/opencorvus/src/storage/ddl.ts

# 15 通道适配器
ls packages/channel-runtime/src/adapters/

# 9 个核心 prompt
ls packages/opencorvus/src/prompt/core/

# OpenCorvus 自身 commit（fork 后两个半月）
git log --oneline -- packages/opencorvus | wc -l   # ≈ 1503

# 本周（W20: 2026-05-09 ~ 2026-05-15）commit
git log --since="2026-05-09" --until="2026-05-15 23:59" --oneline -- packages/opencorvus packages/overlay packages/channel-runtime docs | wc -l   # = 241

# Overlay 组件
find packages/overlay/src -name "*.tsx" | wc -l   # = 76
```

---

## 9 · 历次 review 已暴露的设计层问题（returning critic 视角）

下列问题在双 review 中被 critic 反复指出。返工时即便整体重写，也建议事先看一遍：

- **Hero 区域过度堆砌术语**——读者三秒内被 `packages/opencorvus`、`Append-only Artifacts` 等术语劝退。
- **暗色主题不适合白皮书**——首版用了暗色，被 critic 指出白皮书核心场景（打印、邮件转发、投影上会）不适合暗色，已改浅色。
- **SVG 自绘图几何易错**——箭头无 marker、端点不落到矩形边、replan 回环箭头落到空气中。返工 SVG 必须加 `marker-end` 和 `dominant-baseline="middle"`。
- **响应式与打印未真验证**——sidenav 在窄屏崩塌占首屏；`.grid.cols-4` 在 print 下挤爆；SVG 在窄屏字号实测变 5px 不可读。
- **字体栈中文回退**——首版用 serif 标题在 Windows 上回退为宋体，与 sans 正文断裂；已改为 sans-only。
- **CSS 死代码**：`--gold` 变量定义但无使用。
- **章节内引用与代码命名不一致**——`SessionKind` 列举遗漏 / `mirrorcode` vs `OpencodeExecutor` 命名漂移等。

---

## 10 · 交付要求

返工后请：

1. 落盘到原路径（`docs/whitepaper/opencorvus-whitepaper.html` 与 `docs/reports/weekly-2026-w20.html`）。
2. 第 5 节列出的 **每一条 CRITICAL 失实必须 grep / read 验证**——遗漏一条即视为 rule 35 违规。
3. 第 6 节列出的 **每一项调性禁忌必须避免**。
4. 第 7 节列出的 **每一项必须保留 / 加入**。
5. 完成后 `git add docs/whitepaper docs/reports && git commit && git push`（不绕 hook，不传 `--no-verify`）。
6. 浏览器打开两份 HTML 自检视觉（rule 24、rule 25）。
7. 若返工后仍有未解决项，按 rule 28b 坦诚列出，不要包装。

---

## 11 · 不要做的事

- ❌ 不要把本 `HANDOFF-FOR-CODEX.md` 文件的内容直接搬进白皮书或周报——这是给 codex 的 brief，不是产出物。
- ❌ 不要在白皮书里再次出现「Claude 之前写过 R1 R2 R3...」「双 review agent」等元过程描述——读者不关心 Claude 怎么折腾过。
- ❌ 不要为了「显得严肃」而把内容写得空洞——克制 ≠ 干瘪；保留必要的具体细节。
- ❌ 不要再次写出「OpenCorvus 不是一个 demo」这种反向防御句式。

---

## 12 · 联系上下文

- 用户名：Heng Yang（git config）
- 邮箱：yangheng2021@gmail.com
- 仓库：`C:/Users/chuan/myhexin-local/opecorvus`
- 当前分支：`codex/agent-boundary-role-contract`
- 主分支：`dev`
- 项目硬规则：`CLAUDE.md`（仓库根，必读）
- README：`README.md`（仓库根）
- AGENTS：`AGENTS.md`（仓库根）

---

_本文件由 Claude 在 2026-05-15 接到「让 codex 返工所有，把我的要求总结转述」指令后落盘。
内容是用户原始要求与可验证事实的**转述**，不包含 Claude 对返工方向的额外建议。
codex 接手后可自行决定重做策略。_
