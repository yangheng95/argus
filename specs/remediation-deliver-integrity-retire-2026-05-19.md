# Remediation 方案 — deliver 退役 + integrity 升格 复审必做项

Date: 2026-05-19
Branch: detached HEAD（refactor 工作树，base `c1ef677b2`）
来源：4 路独立 read-only 复审 + rule-35 全仓扫描 consolidated verdict（codex 第 5 路因 PowerShell ConstrainedLanguage 工具故障降级，结论回来后按 rule 35 末条补入本文件 "codex 复核反馈" 段）。

用户裁决：**必做项全修**（rule 24/28/29）。spec-1 Non-goals 明确豁免项（delivery 源码树未删、DeliveryReviewBody 孤儿、legacy delivery prompt host-arbiter 文案）归入后续单独 cleanup 任务，**不在本轮**。

实施纪律（memory）：
- 仓库为嵌套 .git（外层 workspace root = `C:\Users\chuan\myhexin-local\opecorvus`，内层 `packages/opencorvus/.git`）。所有 git 操作 `git -C` **外层 workspace root**，**按显式路径 stage 自己的文件**，禁止 `git stash` 诊断，禁止 `--cd packages/opencorvus`（会丢父仓删除）。
- git surgery 前打 backup tag，操作后**验证 HEAD 真的移动**（防并发吸收）。
- pre-push 是质量门（typecheck / api:routes-check / docs:check），失败修根因，禁 `--no-verify`。若 `bun: command not found: tsc` 则 root `bun install`（sandbox-disabled）后 `git restore -- packages/sdk/` 丢 codegen drift。
- 实施走 claude-code 子 agent（rule 37；codex shell 本环境被 ConstrainedLanguage 降级，rule 23 → 不用 codex 写）。

---

## ITEM 1 — BLOCKER：5 个 untracked 依赖文件必须与 slice 原子提交

**根因**：已跟踪的 `packages/opencorvus/src/delivery/verdict.ts`（重写为 re-export shim）+ `packages/opencorvus/src/integrity/agent.ts` import 以下文件，但它们 git 未跟踪。任何提交不原子纳入即破 HEAD（dangling import + 缺 prompt 文件，pre-push tsc 必红，rule 8/16/33 + memory 半态破 HEAD）。

必须纳入暂存的 untracked 文件（rule 35 穷举，已核对 `git ls-files --others`）：
1. `packages/opencorvus/src/acceptance/review-verdict.ts`  — 被 integrity/agent.ts、integrity/acceptance-output-tools.ts、delivery/verdict.ts import（×4）
2. `packages/opencorvus/src/integrity/acceptance-tools.ts`  — integrity/agent.ts:71
3. `packages/opencorvus/src/integrity/acceptance-output-tools.ts` — integrity/agent.ts:72
4. `packages/opencorvus/src/prompt/core/acceptance-review-core.txt` — integrity/agent.ts:40,624
5. `packages/opencorvus/src/session/repair-hint.ts` — llm/api.ts:14
6. `packages/opencorvus/test/session/repair-hint.test.ts` — 5 的测试（rule 36，同批纳入）

同时本次 refactor 全部已跟踪修改（git status 114 项）需与上述 6 个新文件**同一 commit**。提交粒度建议沿用已提交 3 commit 的语义切分；但最小可接受为一次完整 "deliver 退役 + integrity 升格终审验收" commit，确保任一 HEAD 都可 tsc 通过。

验收：`git -C <root> add` 显式路径后，`git status` 无遗漏 `??` 核心文件；commit 后 `git -C <root> stash list` 空；pre-push 三门绿；`git -C <root> log -1 --stat` 含全部 6 个新文件；HEAD 已移动。

## ITEM 2 — MAJOR：删除 orchestrator/tools.ts 孤儿死代码（rule 16/17）

deliver/publish_delivery body 删除后唯一调用者消失而残留。**rule 35：删除前对每个符号全仓 grep 确认零 live caller，并清理其专属 import**。

| 符号 | 定义 file:line | 唯一调用者状态 | 处置 |
|---|---|---|---|
| `persistDeliveryVerificationThrow` | tools.ts:~970 | 调用者=已删 deliver catch | 删除 |
| `queueDeliveryReworkWake` | tools.ts:~1074 | 调用者=已删 deliver rejection 分支 | 删除 |
| `publishGateArtifactResult` | tools.ts:~1137 | 调用者=已删 publish_delivery body | 删除 |
| `sinkDeliveryVerdictToCriteria` | tools.ts:~923 | 仅被 persistDeliveryVerificationThrow(tools.ts:~1041) 调用，传递性死 | 删除 |
| import `markDeliveryPublishing` | tools.ts:~36 | 调用者=已删 publish_delivery body | 删 import |
| import `finalizeDeliveryResult` | tools.ts:~37 | 调用者=已删 publish_delivery body | 删 import |
| `composeLatestDeliveryFeedbackForBuild` | tools.ts:~618 | **仍 live**：build rework 路径 tools.ts:~4819/~4858 | **保留** |

执行约束：删除后对每个被删符号再次全仓 grep 必须 0 命中（除自身定义已删）；删除连带 unused import；`bun tsc` 必须 exit 0。

## ITEM 3 — MINOR but spec-mandated：补 2 个负路径测试（rule 28/36；spec-2 Test Expectations L60-62）

位置：`packages/opencorvus/test/integrity/agent.test.ts`（既有；orchestrator/tools.test.ts:84 mock 自动注入 acceptedAcceptance，门在此处结构不可测 → 测试必须落在 integrity/agent.test.ts）。

- **测试 A — 无 acceptance verdict 不能 accept**：构造 integrity 会话提交 `submit_integrity_review` 但不提交 acceptance verdict，断言 `buildSubmitIntegrityTool` 返回 `"Error: missing acceptance verdict"`（agent.ts:586-588）或 `reviewIntegrity` 后置硬抛（agent.ts:696-698）；并断言 terminal-tool 仅在 `!!collector.acceptanceVerdict` 时暴露（agent.ts:655）。
- **测试 B — rejected acceptance 强制聚合 needs_correction**：注入 `rejected` acceptance（所有维度 pass），断言 `aggregateIntegrityVerdict`（agent.ts:807-813）返回 `needs_correction`，且经 `synthesizeResult`（agent.ts:728）与 `summarizeIntegrity`（agent.ts:819）传播；并断言此时 orchestrator 完成路径（tools.ts:3097-3118 仅 `verdict==="pass"`）不会完成任务。

验收：两测试新增且 `bun test test/integrity/agent.test.ts` 全绿；断言的是"缺失即拒绝/拒绝即降级"的**不变量**，非 happy path。

---

## 用户裁决 2026-05-19：Fork B 贯彻全删 delivery（rule 35 末条 — 显式标注修订，不静默重写）

用户裁定 spec-1 Non-goals §"Do not delete the delivery source tree in this change" **被"退役"意图超越**。
原执行顺序（ITEM 1-3）作废，替换为 Fork-B 全删执行计划。spec-1 Non-goals 须同步改写落盘（FB-7）。

枚举纪律：上一轮 rule-35 sweep（Agent D）凭 git-diff 采样误判已删文件"存在"——**作废其结论**，
本轮穷举由本人基于工作树文件系统 Grep 重做，零遗漏（rule 35：漏一处 = rule 8）。

### Fork-B 执行段（待本人穷举枚举回填精确调用点表后定稿）

- **FB-1（B1，rule 35/16）**：清除所有指向已删 `@/delivery/agent` / `@/delivery/output-tools` /
  `delivery-core` 的 dangling，按枚举表逐点 [migrate→@/acceptance/review-verdict] / [删退役死码] / [删测试]。
  已知点：`prosecutor/agent.ts:44`、`orchestrator/tools.ts:3013`、`test/agent-report-contract.test.ts:9`、
  `test/agent/visible-brief-hygiene.test.ts:6-13`；`engine/config.ts:134-135` TS2304 待 triage 归属。
- **FB-2（B2，rule 8）**：删除 `requirements-core.txt:38`、`prosecutor-core.txt:6/18` 旧 Delivery 权威语言，改指 integrity 终审。
- **FB-3（B4，spec-3，Fork-B 下转为删除）**：deliver 全退役 → delivery-phase live card 整条删除：
  `DeliveryReviewCompleted` schema(model.ts:1428-1444)、`handleDeliveryReviewCompleted`、`DeliveryReviewBody`/`DeliveryReviewCard.tsx`、
  `review.stream.* phase:"delivery"` 分支、对应 i18n、相关 tests。**严禁动共享 `review.stream.*` 流式半区（integrity 仍用 phase:"integrity"）**——只摘 delivery 叶。
- **FB-4（B5，rule 7）**：overlay `tree-writer.ts:1343-1392` 缺失 `acceptance` 改 loud-fail。
- **FB-5（B3，rule 13/6.1）**：codex 裁决 `some()` post_build 提前完成（tools.ts:1695-1700 / 3097-3117）。
- **FB-6（B6，rule 15）**：codex 裁决 `syntheticAcceptanceRejection`（agent.ts:739-754）是否允许。
- **FB-7（rule 32）**：改写 spec-1 `_codex-disable-deliver-integrity-gate-2026-05-19.md` Non-goals，记入 Fork-B 裁决。
- 保留：ITEM 2（已删死码，工作树就绪）、ITEM 3（已补负测试，工作树就绪）、`publishGateArtifactResult`（live，作废删除）。
  `delivery-agent-verdict` 历史 artifact reader（store.ts:688/730-740）按 spec-2 "legacy 可读" 保留只读。

### ⚠ 并发碰撞冻结（2026-05-19，memory feedback_check_concurrent_refactor_collision_before_impl）

用户在复审期间**并发编辑工作树**：`prosecutor/agent.ts:44`、`orchestrator/tools.ts:3013` 已被用户
unstaged 改 `@/delivery/agent`→`@/delivery/verdict`，`engine/config.ts` TS2304 已消，
`bun run typecheck` 现 exit 0（硬阻塞 typecheck-红已被用户并发根治）；porcelain 114→185。
4 agents / codex / 本人早前所有静态发现均为**已失效快照**。**冻结实施派发**——不向移动中的树派实施 agent（必碰撞）。
仅保留对 stable checkpoint 的只读复核。

重新落地（仅 live 已核实、且与用户 import 修复正交、用户大概率未触的真实项）：
- **B2 双源 prompt（rule 8，live 确认）**：`prosecutor-core.txt:6,18`、`requirements-core.txt:38` 仍把验收权威指向 Delivery。
- **B3 post_build（rule 13/6.1，live 确认）+ rule-8/9 新发现**：post_build 分类逻辑在
  `orchestrator/tools.ts:1533-1536` 与 `delivery/tools.ts:198-201` **重复双源**；Fork-B 全删下应收敛单一来源。
- **B6（rule 15）**：`integrity/agent.ts:739` synthetic 验收，待 codex 裁决。
- B4/B5：tree 移动中，stable checkpoint 再核。
- ITEM2/ITEM3 已在树（未提交），需 checkpoint 复核仍干净适用。

执行段在用户并发编辑停止前**不定稿、不执行**；协调方式待用户裁决（见对话）。

## 用户裁决 2（2026-05-19）：协调=我接正交片区；继而"都是小问题，直接改"

用户裁定 B2/B3/B6 为小问题，**取消 codex 裁决 ceremony**（`specs/_codex-adjudicate-postbuild-synthetic-2026-05-19.md` 已删，rule 17）。
我接正交片区直接处置（不碰用户热 src 面）：

- **B2（rule 8 双源 prompt）— 源已修，已验证未破测试；测试守护待协调**：
  穷举分类 `prosecutor-core.txt`（L5/6/9/13/18/19/24-25/33/42/59）+ `requirements-core.txt`（L11/38）每个 `deliver` token——
  角色权威引用 Delivery→Integrity（8+2 处 Edit），英文动词 "deliver"（requirements L54/66/68/70）按 rule 35 分类保留不动。
  全仓 test/ grep 旧权威串 **0 命中**——未破任何既有 hygiene 测试，且原先**本就无**该不变量的回归守护。
  rule 36 守护（断言"无 live agent prompt 把终审验收权威指向已退役 Delivery"）应落 `test/agent/core-prompt-hygiene.test.ts`——
  该文件是用户热文件（mtime 225s）→ 碰撞冻结，**守护待 stable checkpoint 或由用户在其面补**。精确断言：
  对 prosecutor-core / requirements-core / 其余 active agent core prompt 断言不含 `/Delivery (owns|reviewer)|to Delivery\b/` 类权威指向。
- **B3（rule 13/6.1 + rule 8/9）— 非 bug + 自动收敛**：`tools.ts:1523-1537` 的 `some()` 是带注释的既往
  codex-review §6.4#8 有意修复（in-flight tip ⇒ pre_build），非提前完成 bug。唯一实质是
  `orchestrator/tools.ts:1533` 与 `delivery/tools.ts:198` 双源——`delivery/tools.ts` 是用户 Fork-B
  正在删的退役面，**双源随用户删 delivery 自动收敛单一来源**；我不碰用户热 `tools.ts`。无我方编辑。
- **B6（rule 15）— 直接定论可接受，无需改**：`syntheticAcceptanceRejection`（agent.ts:739）仅在
  `agent.ts:428` empty-goal 结构短路（**根本不创建 integrity session**）处产生 `rejected`，fail-closed、
  从不伪造 pass。无 session 即无 transcript 可言，不落入 spec-2 "session transcript 证据" 边界意图；
  非 rule 15 合成消息（非双路 audience/隐藏消息，是真实拒绝态）。维持现状。

剩余唯一未闭合：B2 的 rule-36 回归守护（碰撞冻结于用户热 hygiene 测试面）。其余 ITEM2/ITEM3/B2-源
均在工作树未提交，等用户并发编辑收敛到 stable checkpoint 后由单一提交者（按协调）原子提交 + push（pre-push 三门）。

### 收尾顺序（冻结中，待协调裁决后生效）

1. backup tag（memory git surgery 前置：嵌套 .git，`git -C` 外层 root，显式路径，禁 stash）。
2. 本人穷举枚举 → 回填精确调用点分类表（每点 keep/migrate/delete）。
3. 并行 claude-code 实施 FB-1/2/3/4 + 并行 codex 裁决 FB-5/6（rule 30/37）。
4. `bun run typecheck` exit 0 + `bun test`（受影响面 + test/integrity/agent.test.ts）全绿；OpenAPI/SDK 同步（schema 变更须 regenerate）。
5. FB-7 改写 spec-1 落盘。
6. ITEM 1：`git -C <root>` 显式路径 add 全部 refactor 文件 + 新文件，原子 commit。
7. push（pre-push 三门：typecheck/api:routes-check/docs:check）；失败修根因，禁 `--no-verify`（memory toolchain：必要时 root `bun install` sandbox-disabled + `git restore packages/sdk/`）。
8. 验证 HEAD 移动 + stash 空 + `git -C <root> log -1 --stat` 完整。

## codex 复核反馈（rule 35 末条 — 显式标注，不静默重写）

codex bc7eds9kr 完成（exit 0，PowerShell ConstrainedLanguage 工具部分降级但 rg/读码可用），
**结论：不通过**。codex + 本人 tsc 复核推翻 4 路 agent 的 "mostly PASS"——A/B/D 凭
`git diff` 采样误判 `delivery/agent.ts` "存在"，实为工作树 ` D` 删除（rule 35 单点采样陷阱）。

真实 consolidated 阻塞项（已本人核对核心项）：

- **B-NEW-1（spec-1 违规 + dangling → typecheck 红，rule 16/35/33）**：工作树删除了
  `src/delivery/agent.ts`、`src/delivery/output-tools.ts`、`prompt/core/delivery-core.txt`，
  但 spec-1 Non-goals 明确"本次不删除 delivery 源码树"。残留 dangling：`prosecutor/agent.ts:44`、
  `orchestrator/tools.ts:3013`（prosecute tool body，注释"Delivery is retired"）引用 `@/delivery/agent`；
  `test/agent-report-contract.test.ts:9` import 已删 `delivery/output-tools`；
  `test/agent/visible-brief-hygiene.test.ts:6-13` 读已删 `delivery/agent.ts`。
  另：`bun run typecheck` 还报 `engine/config.ts:134-135` `TS2304 DesignAnalystConfig/IntentAnalysisConfig`（待 triage 是否本 refactor 连带）。
- **B-NEW-2（rule 8 双源 prompt 权威）**：`prompt/core/requirements-core.txt:38` "Leave final acceptance ... to Delivery"；
  `prompt/core/prosecutor-core.txt:6/18` "Delivery reviewer / Delivery owns semantic verdict"——
  这些是**活跃 pipeline agent prompt**（非休眠 delivery 树），与 integrity 终审权威并存 = rule 8。
  （Agent B 低估为"延后非目标"，codex 纠正：requirements-core 指示 requirements agent 仍 defer to Delivery 是 live 双源。）
- **B-NEW-3（rule 13/6.1 提前完成风险）**：`tools.ts:1695-1700` 用 `some()`——任一 claiming goal terminal 即判 `post_build`；
  `tools.ts:3097-3117` 随即 integrity pass 完成 task。与 prompt "all blocking builds are terminal" 不等价，host 侧可提前完成。需裁决。
- **B-NEW-4（spec-3 不完整，MAJOR-deferred）**：源码无 backend `EngineEvent.DeliveryReviewCompleted` emit，仅 schema/UI/tests；
  decision-C "delivery.review.completed 仅派生自 decision.final" 无可验证后端实现（commit `cd96edfce`/`c4b0c0e3c` 半接线）。
  deliver 已禁用故休眠可接受，但须显式归入 spec-1 后续 cleanup 跟踪。
- **B-NEW-5（rule 7 fallback）**：overlay `tree-writer.ts:1343-1392` 对缺失 `acceptance` 降级为 `undefined` 而非 loud-fail；
  服务端 schema 要求 acceptance，UI 静默少渲染。
- **B-NEW-6（rule 15 待裁决）**：`syntheticAcceptanceRejection`（agent.ts:739-754）合成验收 verdict（仅失败/空 goal 态，从不伪造 pass）。
  Agent B 判"非 rule 15"，codex 判"需重新裁决是否允许非 session-transcript 验收证据"。设计裁决项。
- **本 spec 自身 rule-35 遗漏（rule 35 末条，显式标注不静默改）**：原 ITEM 2 表把 `publishGateArtifactResult`
  列为 dead 删除——错误。live 源串测试 `test/orchestrator/tools.test.ts:2063-2070`
  断言 `source.toContain("publishGateArtifactResult")` + `"Task lifecycle is unchanged"`（仅存在于其函数体）。
  ITEM 2 实施 agent 正确**拒绝删除**并上报。**ITEM 2 表行 3 作废**：`publishGateArtifactResult` **保留**。

ITEM 2 实施已落地（工作树未提交）：已删 `persistDeliveryVerificationThrow`/`queueDeliveryReworkWake`/`sinkDeliveryVerdictToCriteria`
+ 死 import `markDeliveryPublishing`/`finalizeDeliveryResult`/连带 `updateEvaluationFromDeliveryVerdict`；`composeLatestDeliveryFeedbackForBuild` 保留（仍 live）。
ITEM 3 实施已落地（工作树未提交）：`test/integrity/agent.test.ts` +2 负路径测试，mutation-kill 验证非 tautology，`bun test` 14/14 绿，src 字节未改。

**结论：当前 delta 二次复审不通过（rule 24）。ITEM 1 原子提交在 B-NEW-1/B-NEW-2 未根治前不得执行——会提交 typecheck-红 + 双源树。**
remediation 形态取决于 B-NEW-1 的 fork（见正文下方），需用户裁决后重写执行段（rule 35 末条：附修订，不静默重写）。
