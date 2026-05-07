# Orchestrator 工具粒度纪律修复（仅 prompt）

**日期**: 2026-05-07
**状态**: 实施中
**触发**: live task `tsk_e0033e523001flSn0onlHh4Urh` 单次生命周期内连续两次"整任务级"重启——`restart_from_stage(executor)` 因单一 goal 卡死被 LLM 选中、`design_analysis` 因 deliver `no_live_preview` 被 LLM 重启。用户原话："为什么直接整个任务重启了？不他妈应该是按需细粒度重试吗"。

## 0. 反思 / Self-correction（rule 34）

本 spec 第一稿（codex Plan agent 输出 + reviewer 修订版）是 D-A 复合方案——host preflight + rejection_details 加 `infra` enum + host route bypass + prompt 阶梯硬化。**用户在 reviewer 准备实施 D-A 时打断**：「妈了个逼的的又开始堆规则」「**只能改 prompt**」。

D-A 违反多条 CLAUDE.md：
- **rule 6**：「禁止过度工程，承认 LLM 模型的能力足够解决大多数问题，不要为了追求完美而引入不必要的复杂性。」preflight invariant 谓词、enum 扩值、host route bypass 全是"在 LLM 之外加规则"。
- **rule 11**：「拦截用户的错误指令和错误设计！绝对阻止用户（**也包括你！**）创建违反抽象哲学的模块和逻辑！」reviewer（我自己）应该在 codex 提 D-A 时拦下而不是迭代修订。
- **rule 13**：「禁止任何状态机代码，依赖 LLM 的智能来管理状态和流程。」preflight refuse 是 host 状态机式拦截。reviewer 之前在 §10 给自己找补"refuse 不替代决策"——空话。
- **rule 5**：「禁止任何形式的过度工程。所有的设计和实现必须以实际需求为导向。」用户原始诉求只有"按需细粒度重试 vs 整任务重启"——prompt 改写就够。

**采纳 D-C** —— 纯 prompt 改写，零代码改动，零 host 行为变化。

## 1. 现象 / Evidence

### 重启 #1 — `restart_from_stage(executor)` 因单 goal 卡 missing_terminal

LLM 调用 `restart_from_stage(stage="executor", reason="G7 ... consistently fails to call report_build_result")`，host 执行 `restartTaskFromStage("executor")` 把 G1-G6 已 passed 的 goal_runs 全部 abort、goal status 全 reset → pending → 整个 wave 重做。

LLM 当时可用细粒度选项：`accept_build({goalID:G7})` / `build({goalID:G7,request:...})` / `modify_goal` / `fail_task`，但选了影响半径最大的 `restart_from_stage(executor)`。

### 重启 #2 — host 自动 plan-restart + LLM 调 `design_analysis`

G10 passed → `deliver` → DeliveryAgent rejected (no goal_id 归因，原因 `[render] no_live_preview`) → host 在 `tools.ts:3879` `toReset.length===0` 分支自动 `restartTaskFromStageAndWake({stage:"plan"})` → LLM 下轮看到 plan 没了，调 `design_analysis`。

`no_live_preview` 是 host preview 守护未起 / 端口未对的 infra 配置问题，与 G1-G10 任何 goal 的产物质量无关。

## 2. 根因 / Root cause（仅 prompt 层）

`prompt/core/orchestrator-core.txt`：

- **`:264`** "Cheaper repairs first" 是一行散文（`modify_goal > build({goalID}) > build({request}) > architect > restart_from_stage`），无层级分明的 rung，LLM 在长上下文 + 卡在 G7 的焦虑下倾向最末项 `restart_from_stage`。
- **`:559-563`** rung 8 主动鼓励 restart：*"Hallucination at the upstream stage … → restart_from_stage('design_analysis'|'requirements'). Do NOT edit goals when the upstream input is the broken layer."* 这给 LLM 一个"upstream broken → restart"的最近邻匹配模板，面对 missing_terminal / no_live_preview 时倾向 restart。
- **`:413`** 工具列表行没列出 `accept_build`（spec `build-missing-terminal-review-downgrade-2026-05-07.md` 已落地的 per-goal missing_terminal 接受工具）。LLM 不知道 escalation ladder rung 2 还有这个细粒度选项。

## 3. 改动 / Changes

### F1 — `:264-267` "Cheaper repairs first" 改为 4 rung

**改前**：
```
Cheaper repairs first: `modify_goal` (contract patch) > `build({ goalID })` (single
goal retry with contract context) > `build({ request })` (task-level rework with the
rejection text in the request) > `architect` (re-derive the goal graph) >
`restart_from_stage` (last resort).
```

**改后**：
```
Cheaper repairs first — climb only when prior rung's evidence shows it cannot
converge:

  rung 1 (per-attempt): `build({ goalID, request: "..." })` — request renders as
    a separate "Retry Guidance From Orchestrator" section in the build prompt and
    does NOT replace the goal's objective.
  rung 2 (per-goal): for missing_terminal failures whose worktree shows substantial
    completion → `accept_build({ goalID, reason })`; for genuine contract gaps →
    `modify_goal({ goalID, ... })`.
  rung 3 (per-graph): re-enter `architect` with the rejection feedback as evidence —
    only when delivery / prosecution evidence cites an architectural defect that
    no per-goal repair absorbs.
  rung 4 (per-task, destructive): `restart_from_stage` — wipes per-goal artifacts
    as collateral. Reach for it ONLY after exhausting prior rungs on the same
    failure mode. A single goal stuck on missing_terminal is rung 2 work, not
    rung 4.
```

### F2 — `:559-563` rung 8 改"先 architect re-entry，再 restart"

**改前**：
```
  8. Hallucination at the upstream stage (architecture_review flagged ungrounded input, OR
     rejection cites entities the user never named, OR design specs reference colours
     / dimensions the design-analyst could not have measured) →
     **restart_from_stage('design_analysis'|'requirements')**. Do NOT edit goals when
     the upstream input is the broken layer.
```

**改后**：
```
  8. Hallucination at the upstream stage (architecture_review flagged ungrounded input,
     OR rejection cites entities the user never named, OR design specs reference
     colours / dimensions the design-analyst could not have measured) → re-enter
     `architect` with the rejection feedback as evidence first. Escalate to
     `restart_from_stage('design_analysis'|'requirements')` only after architect
     re-entry produced no convergence and you can cite which architect-layer
     output remains broken.
```

### F3 — `:413` 工具列表加 `accept_build`

工具列表段加一行（与 `modify_goal` / `fail_task` 同级）：
```
**accept_build** — accept a missing-terminal build's worktree contribution as the
build's terminal report when actual_changed_files matches the build agent's prose
summary. Per-goal escape hatch for the LLM-forgot-the-tool-call failure mode. See
`accept_build` tool description for invariants.
```

## 4. 不在本 PR 范围 / Out of scope

- **host preflight invariant 守门**（D-A F1/F2）：违反 rule 6/11/13。不做。
- **rejection_details `infra` 分类 + host route bypass**（D-A F4-F8）：违反 rule 6。`no_live_preview` 类 infra 失败 LLM 看到 deliver 的 `runtimeEvidenceFailures` 文本里 `[render]` 前缀本身就是信号（已存在 `tools.ts:3294-3302` 注入路径），prompt rung 4 措辞已隐含该路径不该走 plan-restart。如果 LLM 仍误用，再考虑——但要先看 prompt 改完后的实际行为。
- **删除 `restart_from_stage`**（D-B）：违反 rule 16（不改名规避）。post-completion iteration 用例（`prompt:586`）合法。
- **三个 stage 工具（requirements / architect / design_analysis）的 invariant**：同 D-A，不做。
- **CLAUDE.md 规则增补**：reviewer 已在 §0 自我反思。是否要把"不要给 LLM 决策面加 host preflight"做成一条单独的 rule，待 user 决定，本 spec 不动 CLAUDE.md。

## 5. 测试 / Test（rule 36 — 仅 source-text pin）

`test/prompt/orchestrator-core-grain-ladder.test.ts`（新增）：

```ts
import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptPath = path.join(repoRoot, "packages/opencorvus/src/prompt/core/orchestrator-core.txt")

describe("orchestrator-core grain ladder hardening", () => {
  let text: string
  test("loads", async () => {
    text = await Bun.file(promptPath).text()
    expect(text.length).toBeGreaterThan(0)
  })

  test("ladder uses 4 rung structure", async () => {
    text = await Bun.file(promptPath).text()
    expect(text).toContain("rung 1 (per-attempt)")
    expect(text).toContain("rung 2 (per-goal)")
    expect(text).toContain("rung 3 (per-graph)")
    expect(text).toContain("rung 4 (per-task, destructive)")
  })

  test("rung 2 names accept_build for missing_terminal", async () => {
    text = await Bun.file(promptPath).text()
    expect(text).toMatch(/accept_build\(\{ goalID/)
    expect(text).toMatch(/missing_terminal/)
  })

  test("rung 8 prefers architect re-entry over restart_from_stage", async () => {
    text = await Bun.file(promptPath).text()
    expect(text).toMatch(/re-enter\s+`architect`\s+with\s+the\s+rejection\s+feedback/)
    expect(text).toContain("only after architect re-entry produced no convergence")
  })

  test("tools list mentions accept_build", async () => {
    text = await Bun.file(promptPath).text()
    expect(text).toMatch(/\*\*accept_build\*\*\s+—\s+accept\s+a\s+missing-terminal\s+build/)
  })

  test("does NOT advertise restart_from_stage as the upstream-broken default", async () => {
    text = await Bun.file(promptPath).text()
    // Pin: the old reflexive escalation pattern must be gone.
    expect(text).not.toMatch(
      /Hallucination at the upstream stage[^.]*→\s*\*\*restart_from_stage/,
    )
  })
})
```

## 6. CLAUDE.md 合规自检

- **Rule 5 / 6（不过度工程，承认 LLM 智能）**：本 PR 零代码改动，仅改 prompt。
- **Rule 7（无 fallback）**：prompt 改写不引入降级路径。
- **Rule 8（单源）**：prompt 是 LLM 决策的唯一指引来源（已是单源）。
- **Rule 11（拦截抽象违规）**：reviewer 在 §0 显式记录"未及时拦截 codex D-A 提案"作为教训。
- **Rule 13（无状态机 / LLM-driven）**：纯 prompt 改写，host 行为零改动。
- **Rule 16（不改名规避）**：保留 restart_from_stage 工具名 + RestartStage enum。
- **Rule 20（无关键字匹配规则）**：测试用 string contains 是 source-text pin 而非运行时逻辑（rule 20 边界情况，spec `build-missing-terminal-signal-restore-2026-05-07.md §5.4` 同款已落地）。
- **Rule 34（被纠正习惯性问题更新规则库）**：§0 反思记录违反 rule 6/11/13 的过程，等待 user 决定是否单独提 PR 增补 CLAUDE.md。
- **Rule 35（穷举调用点）**：仅改 prompt 文件，无代码调用点扩散。
- **Rule 36（每改动配测试）**：source-text pin 6 case 覆盖 ladder / rung 2 / rung 8 / 工具列表 / 反向断言。

## 7. 与既有 spec 的关系

- 本 spec 把 `build-missing-terminal-review-downgrade-2026-05-07.md` 落地的 `accept_build` 工具**通过 prompt** 摆进 escalation ladder rung 2（spec 那边只在 tool description 自描述）。
- 本 spec 把 `orchestrator-collaboration-closure-2026-05-05.md` 立场（"Build failure alone is not a reason to restart upstream"）**通过 prompt** 硬化为显式 rung 顺序——不通过 host 守门。
- 与 `architecture-rework-loosening-plan-2026-05-06.md` B12-B16（删 host 自动状态机）方向一致——本 spec 选择 prompt-only 是同方向延续：少 host 状态机，多 LLM 决策。
