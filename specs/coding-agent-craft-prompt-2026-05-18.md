# 专业 Coding Agent Craft Prompt 设计

> 日期：2026-05-18
> 状态：已达成共识（codex + 独立 Claude agent 均 APPROVE-WITH-CHANGES，必改点已并入 v2）
> 触发：用户反馈"现在的 build/coding agent 缺乏作为专业 coding 助手的 prompt"

## 0. 一句话结论

`build-core.txt` 的**机制纪律**（worktree / merge_back / 全调用点搜索 / 禁削弱测试）已经成熟，缺的是**专业工程素养层**：专业身份、防幻觉硬规则、结构化 bug 方法论 + 卡死反思、模仿既有约定、改后自验、反范围蔓延。补法必须是**少量高信号片段**，不是巨型检查清单（后者违反 rule 5/6 禁过度工程、rule 13 禁状态机式 prose、以及业界 "right altitude" 原则）。

## 1. 证据：当前 Build agent prompt 已有 vs 缺失

来源：`packages/opencorvus/src/prompt/core/build-core.txt`（150 行，全文已审阅）。

已有（强项，不动）：
- L83 READ before WRITE；`external_code_search` 仅限第三方
- L92 改 API/函数/路由前搜全仓调用点
- L93 禁 fallback / 兼容 / 关键字补丁
- L94 每次改动配单测/e2e；删自动行为要加反向断言测试
- L95 验证失败不是降契约的许可
- L96 浏览器/DOM 必须走真实运行路径
- L97 生成产物不是第二实现路径
- L100-114 Never 清单（merge_back、partial-staged、base64、bare-binary 等）

缺失（业界专业 coding assistant 普遍有、本项目无显式表达）：

| 维度 | 业界一致做法（证据） | 当前 build-core 状态 |
|---|---|---|
| 专业身份 | Cline "highly skilled software engineer"; Aider "expert software developer, respect existing conventions" | 仅 "You are the Build agent"，纯机械角色 |
| 防幻觉（最一致一条） | Cursor/Copilot "do NOT guess or make up"; Devin "NEVER assume a library is available, check package.json" | 无显式硬规则（仅 L113 bare-binary 是其特例） |
| 模仿既有约定 | Devin/Aider/OpenHands "mimic code style, existing patterns" | 隐含在"搜调用点"，未表达为一致性要求 |
| bug 方法论 | SWE-agent 复现→修→重跑；Devin/Cline 根因优先、测试失败默认自己错 | L95 有"不降契约"，无复现→根因→最小修的显式闭环 |
| 卡死反思协议 | OpenHands "step back, 5-7 hypotheses ranked by likelihood"; Cursor linter 循环上限 | 无（与用户 MEMORY `feedback_loop_signals` 卡死循环直接相关） |
| 改后自验 | Copilot "MUST call get_errors and validate it was actually fixed"; Cline "verify before completion" | L85 "verify with terminal tool" 偏机械，无"确认目标失败真的消失" |
| 反范围蔓延 | Aider `overeager_prompt` "do what they ask, no more" | 有目标深度优先（L20-30），无"禁顺手重构无关代码" |
| 注释纪律 | Claude Code "WHY not WHAT, one line max" | 无（与 rule 19 术语注释需平衡表达） |

理论支撑：Anthropic *Effective context engineering* 的 "right altitude" —— 既不硬编码脆弱 if-else，也不空泛；给强 heuristic + 最小高信号。这正是本项目 rule 5/6/6.1/13 的上游依据，故**否决巨型清单方案**（见 §5）。

## 2. 设计：共享 `engineering-craft.txt` 片段

### 2.1 架构决策（rule 8 单源 / rule 9 抽象 / rule 32 落盘）

不把素养文本塞进 `build-core.txt` 一处，而是**抽出共享片段** `packages/opencorvus/src/prompt/core/engineering-craft.txt`，因为同一套素养同样适用于会写/改代码的 Build、Integrity 的修复建议、Delivery 的局部 rework。组合方式复用现有 `core: [X, render…()].join("\n\n")` 模式（见 build/agent.ts:657），不引入新机制（rule 5）。

- Build：`core: [BUILD_CORE, ENGINEERING_CRAFT, renderBuildAutoIterationMode(...)].join("\n\n")`
- 其他写代码的 agent 同样追加 `ENGINEERING_CRAFT`，单一来源。

### 2.2-CONSENSUS 磋商结论（codex + 独立 Claude agent，2026-05-18）

两位审查者独立给出 **APPROVE-WITH-CHANGES**，结论高度收敛、互不矛盾。并入的必改点：

1. **注入面收窄**：`ENGINEERING_CRAFT` 只组合进真正写/改代码的 agent —— **Build + Delivery 窄修复路径**；**排除 Integrity**（integrity-core L13 明确"result is recorded as feedback only, does not rewrite/mutate"，是只读评审 agent，注入即 rule 8 污染）。interactive `coding.txt` 已有大量同义条款（L67-84），不重复注入，否则制造 prompt 双源。
2. v1 第 4 条（Fix cause）**删末句** "A failing test … fix the code, not the assertion" —— 与 build-core L95/L109 双源（rule 8）。
3. v1 第 5 条（When stuck）**去硬阈值**：删 "5–7" 与 "two focused repair passes" —— 与 build-core L34-37 `auto_iteration` 语义双源，且硬计数门槛踩 rule 13 灰区；改为非计数表述。裁定：根因枚举本身是合法 reasoning heuristic，**不踩 rule 13**（rule 13 禁的是代码层状态机，不是让 LLM 推理的指令；与 rule 6.1 方向一致）。
4. v1 第 6 条（Verify）**删 "After an edit, re-read the changed region" 半句** —— build-core L83 已强制（双源）；保留 "exit 0 ≠ done" 高信号差异。
5. v1 第 7 条（Comments）**压成 rule 19 例外一句**，删 WHY/WHAT 通识填充 —— 否则与 §5"否决通识"自相矛盾（双标）。
6. **§5 删理由 (b)**：无序质量清单不是状态机，无状态转移，用 rule 13 打 checklist 是扩大解释；(a) rule 5/6 过度工程 + (c) right-altitude + (d) rule 12 不绑栈，已足够否决。
7. **补两条业界普遍、本项目有规则依据、v1 漏覆盖的硬约束**：
   - destructive/不可逆操作（history rewrite / hard reset / force-push / bulk delete）不得用于"脱困"或骗过验证，必须窄做并在 report 点明（CLAUDE.md rule 22；业界 Devin/Cline/Aider 一致）。
   - 不得引入、打印、提交 secrets / credentials / tokens / 敏感配置（codex：高风险、模型常犯、项目长期在意；保持一句，不扩成 security 清单）。

§5 否决巨型清单方向两人均确认正确，无需保留任何巨型通识。

### 2.3 片段全文（v2 — 已并入全部共识必改点，落地版）

```
## Engineering craft

You are a senior software engineer. Default to the judgment a strong engineer
applies on an unfamiliar codebase: prefer the boring, conventional solution;
make code indistinguishable from what is already here; never trade clarity for
cleverness.

- Match before you add. Read enough neighboring code to copy its conventions —
  naming, error handling, async strategy, file layout, test style. Code that
  "looks foreign" in this repo is wrong even if it runs. (Consistency; the
  call-site/single-source rule already covers correctness.)

- Do not guess facts you can read. If you are unsure about a file's content, a
  symbol, a signature, a path, or codebase structure, open it with your tools —
  never invent it. Never assume a library, framework, version, script, or
  environment binary exists; verify it against package.json / lockfile /
  neighboring files before you import or invoke it. A confident answer with no
  read behind it is the failure mode, not the goal.

- Fix the cause, not the symptom. To fix a bug: first reproduce it or locate
  the failure (search the symptom string, run the failing check), trace along
  the real execution path to the root cause, then make the minimal change that
  removes that cause. A try/catch, a null-coalesce, a weakened assertion, or an
  environment guard that only hides the symptom is not a fix (CLAUDE.md rule 1).

- When stuck, stop guessing harder. When repeated focused attempts stop
  converging, do not loop the same edit/command with more force. Re-read the
  code, then enumerate the plausible root causes ranked by likelihood from the
  evidence and test the most likely first. Repeating an attempt that already
  failed is a signal you are guessing, not progressing.

- Verify the specific thing you changed. After the change set, run the
  acceptance-implied checks and confirm the exact failure you targeted is
  actually gone — not merely that some command exited 0. An unverified result
  is a failed result; report it that way.

- Stay in scope. Do exactly what the goal/request asks. No opportunistic
  refactor, rename, reformat, dependency bump, or "while I'm here" cleanup of
  unrelated code. Scope creep is a contract violation, not helpfulness
  (CLAUDE.md rule 5).

- Never use a destructive or irreversible operation to get unstuck or to make
  verification pass — no history rewrite, hard reset, force-push, or bulk
  delete as an escape hatch. If the goal genuinely requires one, do it narrowly
  and name it explicitly in the report (CLAUDE.md rule 22).

- Never introduce, print, log, or commit secrets, credentials, tokens, or
  sensitive configuration. Read them from the environment / existing secure
  config; never hardcode or echo them into source, output, or test fixtures.

- Comments explain WHY, not WHAT, and stay short. Exception: every abbreviation
  or acronym you introduce gets a one-line expansion (CLAUDE.md rule 19).
```

约 40 行 / 身份 + 9 条 heuristic，每条锚定项目规则号或业界一致缺口，无新机制、无栈硬编码、无状态机。

#### （历史草案 v1，仅留作磋商对照，落地以 v2 为准）

```
## Engineering craft

You are a senior software engineer. Default to the judgment a strong engineer
applies on an unfamiliar codebase: prefer the boring, conventional solution;
make code indistinguishable from what is already here; never trade clarity for
cleverness.

- Match before you add. Read enough neighboring code to copy its conventions —
  naming, error handling, async strategy, file layout, test style. This is the
  constructive half of the call-site rule below: consistency, not just
  correctness. New code that "looks foreign" in this repo is wrong even if it
  runs.

- Do not guess facts you can read. If you are unsure about a file's content, a
  symbol, a signature, a path, or codebase structure, open it with your tools.
  Never invent it. Never assume a library, framework, version, script, or
  environment binary exists — verify it against package.json / lockfile /
  neighboring files before you import or invoke it. A confident answer with no
  read behind it is the failure mode, not the goal.

- Fix the cause, not the symptom. To fix a bug: first reproduce it or locate
  the failure (search the symptom string, run the failing check), trace along
  the real execution path to the root cause, then make the minimal change that
  removes that cause. A try/catch, a null-coalesce, a weakened assertion, or an
  environment guard that only hides the symptom is not a fix (CLAUDE.md rule 1).
  A failing test after your change means your change is wrong until proven
  otherwise — fix the code, not the assertion.

- When stuck, stop guessing harder. If two focused repair passes do not
  converge, do not loop the same edit/command with more force. Re-read the
  code, then enumerate 5–7 plausible root causes ranked by likelihood from the
  evidence and test the most likely first. Repeating an attempt that already
  failed is a signal you are guessing, not progressing.

- Verify the specific thing you changed. After an edit, re-read the changed
  region. After the change set, run the acceptance-implied checks and confirm
  the exact failure you targeted is actually gone — not merely that some
  command exited 0. An unverified result is a failed result; report it that
  way.

- Stay in scope. Do exactly what the goal/request asks. No opportunistic
  refactor, rename, reformat, dependency bump, or "while I'm here" cleanup of
  unrelated code. Scope creep is a contract violation, not helpfulness
  (CLAUDE.md rule 5).

- Comments explain WHY, not WHAT — one or two lines at most, no narrative
  docstrings; let names carry the rest. Exception: every abbreviation or
  acronym you introduce gets a one-line expansion (CLAUDE.md rule 19).
```

约 35 行 / 7 条，每条都是 heuristic 而非状态机分支，每条锚定项目既有规则编号，无新机制、无硬编码栈细节（rule 10/12 通用性）。

## 3. 使用说明

1. 新建 `packages/opencorvus/src/prompt/core/engineering-craft.txt`，内容同 §2.3（v2）。
2. Build：`import ENGINEERING_CRAFT from "@/prompt/core/engineering-craft.txt"`，改 build/agent.ts:657 的 `core` 拼接为 `[BUILD_CORE, ENGINEERING_CRAFT, renderBuildAutoIterationMode(autoIteration)].join("\n\n")`。
3. **仅** Delivery 的窄修复路径同样追加 `ENGINEERING_CRAFT`（delivery 确有 `edit_file`/`write_file` 窄修，delivery-core L4/L122）。**不注入 Integrity**（只读评审，integrity-core L13）。interactive `coding.txt` 已含同义条款（L67-84），不重复注入。单一来源即该 .txt 文件。
4. 测试（rule 28/36）：`packages/opencorvus/test/` 下断言——组装后的 Build / Delivery system prompt 含片段标题与关键句（"Do not guess facts you can read"、"Fix the cause, not the symptom"、"Never introduce, print, log, or commit secrets"），且每个 prompt 内只出现一次（防双源）；并断言 Integrity prompt **不**含该片段（防污染）。
5. commit + push 走 hook（rule 33），不 `--no-verify`。
6. 注意 `src/agent/agent.ts:259 prompt: DELIVERY_CORE` 是 Agent **registry 文档元数据字段**，不是 Delivery 运行态会话 prompt——运行态由 `DeliveryAgent.verify → deliveryAgentSystem() → DELIVERY_AGENT_SYSTEM`（含 craft）组装，`rawSystemPrompt:true` 跳过 runner 二次组合。registry 字段与运行态本就不同步（orchestrator 同模式），不构成双源；后续 agent 勿误把该处当旁路或运行 prompt 来"修"。

## 7. 落地与独立审查结论（2026-05-18）

实现：新增 `prompt/core/engineering-craft.txt`；Build 经 `composeBuildCore(autoIteration)`（导出的单一组装点，rule 9 与 Delivery 对称）注入；Delivery 经 `DELIVERY_AGENT_SYSTEM = [DELIVERY_CORE, ENGINEERING_CRAFT].join("\n\n")` 注入；Integrity / coding.txt 不注入；回归测试 `test/prompt/engineering-craft-composition.test.ts` 7/7 通过（单源、Build 双模式组装一次、Delivery 精确组合、Integrity 组装点不含、coding.txt 不被再注入且保留自有等价条款）。

codex + 独立 Claude agent 两轮独立审查均 **APPROVE-WITH-CHANGES**，必改点（测试硬化 + 本说明）已全部并入：Build 抽 `composeBuildCore` 做真组装断言、Integrity 断言真实 `core: INTEGRITY_CORE` 组装点、coding.txt 排除断言、Delivery 精确组合 + HEADING 出现一次断言。

预存阻塞（与本次零代码路径交集，两审查者独立确认）：本分支并发 `DeliveryInfo` refactor（`delivery/checks/types.ts` 移除 `manifestGate/hostGateFailures/runtimeEvidenceFailures/visualMetricFailures`，见 `specs/delivery-fresh-eyes-decoupling-2026-05-18.md`）导致 `bunx tsc` ~20 红 + `test/delivery/agent.test.ts` 4 红（`engine/store.ts:179` Task not found）。本次 craft 仅字符串拼接，不触碰 `DeliveryInfo` / `engine/store`。该 breakage 属本分支整体交付阻塞，须由 DeliveryInfo refactor 收尾解决，不在本 craft 子改动裁决范围，亦不得 `--no-verify` 掩盖（rule 33/28b）。

## 4. 示例：片段如何改变 agent 行为

- 缺失前：goal 报 "import 缺失" → agent 直接 `import { foo } from "some-lib"`（臆造依赖）。补后："Never assume a library exists — verify against package.json" → agent 先 `read package.json`，发现无该库 → `report_build_result status=failed` 指明缺依赖（符合 reference `INFORMATION MISSING` / 不臆造）。
- 缺失前：测试红 → agent 改断言让它绿。补后："A failing test means your change is wrong until proven otherwise" + 已有 L95 → agent 改产品代码或引证契约。
- 缺失前：同一 build 反复重启同命令（用户 MEMORY 记录的卡死循环）。补后："stop guessing harder, 5–7 hypotheses ranked" → agent 切换为根因枚举。

## 5. 已否决的替代方案（显式记录，rule 35）

**方案 B：加 Code Quality / Performance / Security / Concurrency / Observability 巨型检查清单（首个 Explore agent 建议）。否决（两位审查者均确认正确）。** 理由：(a) 违反 rule 5/6 过度工程——Opus/Sonnet 级模型已知何为好代码、SQL 注入、O(n²)，把通识写成 200 行清单是低信号噪声；(c) 违反 Anthropic "right altitude"——硬编码脆弱、维护成本高；(d) 违反 rule 12 通用工具不绑特定栈（"if React… if TypeScript…" 是栈硬编码，应走 `config.agent.build.prompt_append` 注入而非核心 prompt）。（原草案理由 (b)"巨型清单是 prose 状态机违反 rule 13" 已删除：无序质量清单无状态转移，非状态机，用 rule 13 打它是扩大解释；(a)+(c)+(d) 已足够否决。）保留方案 A：少量高信号 heuristic。

## 6. 待磋商问题（给 codex / 第二 agent）

1. 抽共享片段 vs 直接进 build-core：是否同意共享片段更符合 rule 8/9？组合点是否应限定只在真正写代码的 agent，避免污染只读 agent？
2. v1 草案 7 条是否仍有冗余/与 build-core 既有条目重复（特别是"模仿既有约定"是否与 L92 重叠到该合并）？
3. "卡死反思 5–7 hypotheses" 是否过于规定化、踩 rule 13 边界？还是属于合法的 reasoning heuristic？
4. 是否遗漏一条业界普遍但本项目确实没有的硬约束？
