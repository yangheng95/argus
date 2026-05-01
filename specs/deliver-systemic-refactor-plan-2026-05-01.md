# Deliver 系统性重构方案：可靠验收与可迭代修复

日期：2026-05-01

关联分析：`specs/deliver-defect-analysis-2026-05-01.md`

## 1. 目标

Deliver 必须从“LLM 自述式验收”重构为“确定性证据门禁 + LLM 修复/解释 + 发布硬门禁”的结构。

最终状态：

- 任何交付必须先生成唯一的 `DeliveryEvidenceManifest`。
- 发布、任务完成、goal passed、criteria_results 只能从该 manifest 投影，不能各自判断。
- LLM 可以分析、修复、补充语义判断，但不能把未执行或失败的检查声明为通过。
- 迭代修复必须以失败证据驱动，修复后重新运行对应检查，不能靠 prompt 说服系统继续。
- UI 和调试查询必须能解释：哪些检查必须跑、实际跑了什么、为什么能发布、为什么不能发布。

## 2. 现有问题的系统根因

当前 deliver 的核心缺陷不是某个 prompt 写得不严，而是权限边界错误：

- `DeliveryService` 把运行证据、LLM verdict、发布决策混在一个流程中，缺少独立门禁。
- `DeliveryAgent` prompt 要求“执行 build/test/lint”，但没有硬性 runner 证明它执行完整集合。
- `submit_verdict` 只做结构校验，无法验证命令是否运行、是否完整、是否新鲜、是否覆盖目标。
- `criteria_results`、goal status、delivery verdict 存在多处投影入口，容易出现“验收失败但任务 completed”。
- runtime/UI 验收缺少任务级真实工作流，截图停在登录页也能算 delivery 通过。
- 迭代重试没有稳定的 failure signature 和证据归因，容易重复修同一问题或把失败吞掉。

因此重构方向必须是权限拆分，而不是继续加 prompt。

## 3. 新架构

### 3.1 单一事实源

新增唯一事实源：

```ts
type DeliveryEvidenceManifest = {
  id: string;
  taskId: string;
  runId: string;
  deliveryId: string;
  iteration: number;
  baselineRef: string;
  headRef: string;
  requiredChecks: RequiredCheck[];
  checkResults: CheckResult[];
  requirementCoverage: RequirementCoverage[];
  goalCoverage: GoalCoverage[];
  runtimeFlows: RuntimeFlowResult[];
  reviewEvidence: ReviewEvidence[];
  integrityFindings: IntegrityFinding[];
  changedFiles: ChangedFile[];
  patchSummary: PatchSummary;
  finalGate: DeliveryGateVerdict;
  timeCreated: number;
};
```

落库规则：

- 使用一个 artifact kind，例如 `delivery_evidence_manifest`，作为 deliver 验收唯一事实源。
- `delivery_verdict` 只保存 manifest id、最终结论、摘要，不复制检查结果。
- `criteria_results`、goal passed/failed、board 展示都从 manifest 投影。
- 禁止同时保留另一套可独立决定通过/失败的 delivery 状态。

### 3.2 组件边界

#### DeliveryContractBuilder

职责：生成本次交付必须满足的验收合同。

输入：

- task goals
- requirements
- plan version
- package scripts / project metadata
- architect integrity findings
- delivery 任务类型识别结果

输出：

- required checks
- blocking requirements
- runtime flow requirements
- Phase 2.5 review requirements
- publish prerequisites

规则：

- 项目存在 `lint` script 时，lint 必须是 required check。
- 项目存在 `test` script 时，test 必须是 required check。
- 项目存在 `build` script 时，build 必须是 required check。
- TypeScript 项目存在 typecheck script 或可推导 `tsc --noEmit` 时，typecheck 必须是 required check。
- web/chat/upload/auth 等用户可见功能必须生成 runtime flow，不允许只用 unit test 代替。
- architect integrity 中未关闭的 blocking concern 必须进入合同。

#### ProjectCheckRunner

职责：执行合同中的确定性项目检查。

规则：

- runner 直接执行命令并记录 exit code、stdout/stderr 摘要、开始/结束时间、工作目录、环境摘要。
- 禁止 `|| exit 0`、`|| true`、吞错 wrapper、关键字匹配式假通过。
- 检查结果必须绑定当前 `headRef`，headRef 变化后旧结果自动失效。
- LLM tool call transcript 只能作为辅助证据，不能作为 pass 来源。

#### AcceptanceCoverageVerifier

职责：判断每个 goal / requirement 是否被真实证据覆盖。

规则：

- 空泛验收项必须被拒绝，例如“功能正常”“体验良好”“实现完整”。
- 对每个 blocking requirement，必须有至少一个 check 或 runtime flow 覆盖。
- 覆盖关系必须结构化记录，不能只写自然语言总结。
- 未覆盖 requirement 直接阻止发布。

#### RuntimeFlowVerifier

职责：验证用户可见工作流。

针对 Web/chat 项目，最低要求：

- 启动应用。
- 完成 mock Google 登录。
- 新建 chat。
- 发送消息并收到 assistant 流式回复。
- 刷新页面后历史仍存在。
- 修改 title。
- 删除 chat 后历史和消息同时消失。
- 如果声明支持 upload，则上传流程必须真实执行。

规则：

- 截图只是证据之一，不能单独判定通过。
- 必须记录 DOM 断言、网络状态、关键 UI 状态、错误日志。
- 只停留在登录页不得通过 chat 类交付。

#### ReviewRequirementVerifier

职责：把 Phase 2.5 / integrity review 变成硬门禁。

规则：

- 如果 architect 或 planner 要求 review，则必须存在 review artifact。
- review artifact 必须引用检查范围、发现、结论、处理状态。
- 未处理的 blocking finding 必须阻止发布。

#### DeliveryAgent

职责：修复和语义解释，不负责最终授权。

规则：

- 输入 manifest 和失败证据。
- 可以修改代码、解释失败原因、建议补充检查。
- 修复后必须触发 runner 重跑。
- 不能直接把 finalGate 改成 passed。

#### PublisherGate

职责：唯一发布硬门禁。

通过条件：

- required checks 全部 passed。
- blocking requirements 全部 covered。
- runtime flows 全部 passed。
- Phase 2.5 / integrity blocking findings 全部 resolved。
- patch/changed_files 与 baseline..head 一致。
- 任务声明产生代码时，patch 不得为空。
- manifest 绑定当前 headRef，且没有过期检查。

## 4. 迭代修复机制

Deliver 的迭代必须由 manifest 驱动。

### 4.1 Failure Signature

每个失败检查生成稳定签名：

```ts
type FailureSignature = {
  checkId: string;
  commandDigest?: string;
  normalizedError: string;
  affectedFiles: string[];
  requirementIds: string[];
  goalIds: string[];
};
```

规则：

- 同一 signature 连续出现，说明修复无效。
- 超过 retry budget 后不能继续自旋，必须升级为 failed/replan。
- 新 signature 才允许进入下一轮修复。

### 4.2 Rework Scope

修复范围由失败证据归因：

- lint 失败只归因到具体文件和规则。
- test 失败归因到测试文件、错误堆栈、关联 requirement。
- runtime flow 失败归因到具体步骤和 UI/API 状态。
- integrity finding 归因到对应 goal 或全局架构问题。

禁止 blanket retry，禁止把全部 goal 重跑当作默认方案。

### 4.3 Freshness

每次代码变更后：

- 受影响 required checks 必须重跑。
- publish 前必须确认所有 required checks 的 `headRef` 等于当前 head。
- runtime flow 依赖前端或 API 改动时必须重跑。

## 5. 删除或替换的旧机制

必须删除：

- prompt-only “请执行 build/test/lint” 作为验收依据。
- `submit_verdict` 自己声明通过的授权能力。
- free-text `tool_call_evidence` 作为 pass 来源。
- delivery patch 为空但任务 completed 的路径。
- Phase 2.5 review 可被跳过的路径。
- 多处 independently sink criteria / goal status / run status 的逻辑。
- 对历史 DB 的兼容迁移路径；未发布项目应 reset DB 后按新 schema 重建。

必须保留但降权：

- LLM delivery review：保留为 semantic reviewer 和 repair planner。
- 截图：保留为 runtime flow 附属证据。
- criteria_results：保留为 board projection，不保留为事实源。

## 6. 分阶段实施计划

### P0：合同和 manifest 基础

- 定义 `DeliveryEvidenceManifest`、`RequiredCheck`、`CheckResult`、`DeliveryGateVerdict` 类型。
- 新增 manifest validator。
- 新增 artifact 持久化读写。
- 让现有 delivery verdict 引用 manifest id。
- 测试 manifest pass/fail、过期 headRef、缺失 required check。

验收：

- 没有 manifest 时不能 publish。
- manifest 缺少 required check 时不能 passed。

### P1：ProjectCheckGate

- 接入现有 `discoverChecks`，生成 required project checks。
- runner 统一执行 build/test/lint/typecheck。
- 删除 prompt-only check authority。
- `submit_verdict` 不再能覆盖 runner 结果。

验收：

- fixture 中 test 通过但 lint 失败时，delivery 必须 failed。
- `|| exit 0` 或吞错脚本必须被拒绝。

### P2：AcceptanceCoverageGate

- 解析 requirements 和 goals 的 blocking coverage。
- 增加 vacuous acceptance detector。
- 把未覆盖 requirement 输出到 manifest。

验收：

- 空泛验收项不能通过。
- requirement 没有证据覆盖时不能 publish。

### P3：RuntimeFlowGate

- 为 web/chat/upload/auth 类型建立 runtime flow contract。
- 用浏览器流程生成 DOM/assertion/screenshot/log evidence。
- runtime flow 失败写入 manifest 并阻止发布。

验收：

- chat 回复未持久化时，刷新历史检查失败。
- 删除 chat 未删除消息时，删除流程检查失败。
- 只截登录页不能通过 chat delivery。

### P4：迭代可靠性

- 引入 failure signature。
- rework prompt 只接收相关失败证据和受影响文件。
- 修复后基于 changed files 重跑相关 checks。
- 同一 signature 重复失败时停止自旋并升级。

验收：

- 相同 lint/test/runtime 失败重复出现时不会无限 retry。
- 新错误出现时能进入下一轮修复。

### P5：发布完整性

- PublisherGate 只接受 gate-passed manifest。
- patch/changed_files 从 `baselineRef..headRef` 计算。
- delivery artifact 必须含 manifest id、patch summary、changed files。

验收：

- 有代码改动但 patch 为空时不能 completed。
- patch 文件列表和 git diff 一致。

### P6：Board 与调试可观测性

- board 展示 manifest 的 required checks、runtime flows、coverage、failure signature。
- SQL/debug templates 查询 manifest，而不是拼接多个状态源。
- criteria_results 改为 projection。

验收：

- 一个 failed delivery 能直接看到缺哪个 check、哪个 requirement、哪个 flow。
- task completed 的原因能追溯到 manifest。

### P7：清理旧 prompt 和双源状态

- 删除旧 prompt 中“没人会检查，所以你必须自己执行”的假前提。
- 删除多余 sink/update 入口。
- 删除历史兼容路径。

验收：

- 代码中不存在第二套 delivery pass 判定。
- review、publish、board 都从 manifest 派生。

## 7. 测试矩阵

必须新增：

- unit：manifest validator。
- unit：required check discovery。
- unit：forbidden command wrapper detector。
- unit：vacuous acceptance detector。
- unit：coverage validator。
- integration：lint fail/test pass 不可 publish。
- integration：build pass/test pass/typecheck pass/lint missing execution 不可 publish。
- integration：Phase 2.5 required but missing review 不可 publish。
- integration：patch empty but code task completed 不可 publish。
- e2e：chat app runtime flow，覆盖登录、发送、流式回复、刷新持久化、改 title、删除。
- e2e：重复 failure signature 停止自旋并升级。

## 8. 实施顺序建议

第一批只做 P0-P1-P5，因为它们能立刻阻断“lint 没跑但交付通过”和“patch 为空但 completed”这类高风险问题。

第二批做 P2-P3，把 requirement 和真实用户流程纳入硬门禁。

第三批做 P4-P6-P7，让迭代修复和 board 解释能力稳定下来，再删除旧 prompt 和双源状态。

这个顺序的原因是：先建立事实源和发布门禁，再扩展覆盖维度；否则 runtime 和 coverage 继续挂在旧 verdict 上，会形成新的双源。

## 9. 成功标准

重构完成后，以下命题必须恒真：

- deliver 通过必然意味着 required checks 实际执行且全部通过。
- deliver 通过必然意味着 blocking requirements 有结构化证据覆盖。
- 用户可见功能声明完成时，必然有对应 runtime flow 通过。
- 任何 completed task 都能从 manifest 解释为什么 completed。
- 任意失败都能归因到 check、requirement、goal、runtime step 或 integrity finding。
- 迭代修复不会靠重复 prompt 自旋。
- 发布只存在一个事实源，不存在第二套 verdict 或 criteria 判断链。

## 10. 实施记录

### 2026-05-01 第一轮

已完成：

- P0 部分完成：新增 `DeliveryEvidenceManifest` 类型、validator、artifact 持久化、manifest id。
- P1 部分完成：deliver 进入 LLM verdict 前，先通过 `discoverChecks` 生成 build/test/lint/typecheck 等 required checks，并由 `ProjectCheckRunner` 真实执行。
- P1 回归覆盖：当 build/test 通过但 lint 失败时，manifest gate 失败，delivery 被合成为 rejected。
- P1 回归覆盖：package script 使用 `|| exit 0` / `|| true` 这类吞错表达时，manifest gate 失败。
- P5 部分完成：auto publish 和 manual `publish_delivery` 都要求 accepted verdict + passed manifest。
- P5 部分完成：Publisher 校验 delivery 声明的 changed files 必须被 `workspace_export` patch 覆盖，否则返回 failed，不允许 completed。
- benchmark 覆盖：现有 `test/benchmark` 套件和新增 deliver/publish gate 回归测试通过。

未完成，后续继续：

- P2：AcceptanceCoverageGate，blocking requirement 结构化覆盖。
- P3：RuntimeFlowGate，chat/web/upload/auth 真实浏览器流程。
- P4：failure signature 与 rework scope。
- P6：board/debug 查询显示 manifest。
- P7：删除旧 prompt-only 验收话术和冗余 sink。

### 2026-05-01 第二轮

已完成：

- P4 部分完成：每个失败 required check 生成 `failureSignature`，包含 check id、command digest、规范化错误和影响文件字段。
- P6 部分完成：manifest 中的 required check 结果会投影到 delivery verdict 的 `deferred_checks`，使 accepted/rejected 都能进入现有 `criteria_results` 展示链路。
- P6 部分完成：`viewBoardDelivery` 直接暴露 latest `delivery_evidence_manifest` 摘要、required checks、check results、failure signature。
- benchmark 覆盖：`test/benchmark`、delivery project gate、publisher delivery gate 再次通过。

未完成，后续继续：

- P2：requirement/goal coverage 还没有成为硬门禁。
- P3：真实 runtime flow 还没有按任务类型结构化生成。
- P4：rework retry budget 与重复 failure signature 升级尚未接入 orchestrator 调度。
- P6：overlay 视觉组件还未为 manifest 增加专门 UI，目前通过 board delivery payload 和 artifacts 可观测。
- P7：旧 delivery prompt 还未完成清理。

### 2026-05-01 第三轮

已完成：

- P2 部分完成：`DeliveryEvidenceManifest` 新增 `goalCoverage` 和 `requirementCoverage`。
- P2 硬门禁：blocking goal 必须携带结构化 `acceptance_specs`；只有 linked goal covered 时，requirement 才算 covered。
- P2 回归覆盖：blocking goal 的 `acceptance_spec_count=0` 时，manifest gate failed，并同时标记 goal 与 requirement coverage failed。
- P6 同步：board delivery payload 暴露 `goalCoverage` 和 `requirementCoverage`。
- benchmark 覆盖：`test/benchmark`、delivery project gate、publisher delivery gate 通过。

未完成，后续继续：

- P2：尚未执行 delivery-triggered acceptance scorers，仅完成结构化覆盖硬门禁。
- P3：真实 runtime flow 还没有按任务类型结构化生成。
- P4：重复 failure signature 的 retry budget 升级尚未接入 orchestrator 调度。
- P7：旧 delivery prompt 还未完成清理。

### 2026-05-01 第四轮

已完成：

- P7 部分完成：delivery core prompt 不再宣称“没有 deterministic evaluator / 没有人跑过检查 / YOU run every spec”。
- P7 部分完成：DeliveryAgent user prompt 改为说明 host 已经先运行 `DeliveryEvidenceManifest`，LLM verdict 是 manifest 之上的语义/运行时判断，不是项目检查事实源。
- P7 修正 schema 偏差：删除非法 `category="missing_requirement"` 指令，要求 linked requirement 缺口用 schema 已支持的 `category="quality"` 并在 error 中引用 REQ id。
- P7 回归覆盖：core prompt hygiene 测试禁止旧 evaluator 文案和非法 category 重新出现，并要求 prompt 明确引用 `DeliveryEvidenceManifest`。
- benchmark 覆盖：agent prompt hygiene、visible brief hygiene、`test/benchmark`、delivery project gate 通过。

未完成，后续继续：

- P3：真实 runtime flow 还没有按任务类型结构化生成。
- P4：重复 failure signature 的 retry budget 升级尚未接入 orchestrator 调度。
- P7：delivery prompt 中的 Phase 2.5 subagent review 仍需进一步与 manifest/review artifact 硬门禁对齐。

### 2026-05-01 第五轮

已完成：

- P4 部分完成：manifest 层新增 `deliveryFailureSignatureKeys` 和 `repeatedDeliveryFailureSignatures`，同时比较 check failure signature 与 coverage failure id。
- P4 硬门禁：delivery rejected 后，如果当前 manifest 的失败签名集合完全重复上一份 manifest，orchestrator 不再打开相同的 `delivery_rework`，而是写 decision log 并要求 `modify_goal` / `restart_from_stage` / `fail_task`。
- P4 回归覆盖：重复签名会被识别，新 failure signature 不会被误判为重复。
- benchmark 覆盖：`test/benchmark` 与 delivery project gate 通过。

未完成，后续继续：

- P3：真实 runtime flow 还没有按任务类型结构化生成。
- P4：重复签名 gate 目前基于相邻 manifest；后续可把更长历史窗口纳入 manifest helper。
- P7：Phase 2.5 review artifact 硬门禁仍未接入。
