# Agent 职责重构与质量控制方案

## 摘要
目标不是单纯“避免卡死”，而是把系统改成三件事同时成立：
- 不会因为职责混乱而进入长时间自证循环
- 不会把明显越界、膨胀、低信噪比的产物判成合格
- 即使最终失败，也要交付一份结构化失败报告，而不是无限跑下去

基于这次 `specs/prd.txt` 的事实，当前主要问题不是单点 bug，而是职责耦合：
- `spec/planner` 把“理解需求”扩成“定义大脚手架和 README 结构”
- `executor` 一边写代码一边自己决定测试与验收口径，导致反复“verify 结构/README/端口”
- `evaluator` 没有硬质量门，只看“是否还在推进”和局部检查结果，无法真实反映项目质量
- benchmark 只有活性和最终状态，没有“产物是否像狗屎”的量化约束

默认验收口径按你刚确认的 `严格产物约束` 设计。

## 关键职责划分
### 1. Spec Agent
只负责把原始请求压缩成 `TaskContract`，不允许产出实现方案之外的结构幻想。
必须输出：
- 目标用户价值
- P0 功能清单
- 明确非目标
- 允许修改的产物类型
- 禁止产物
- 最低验收命令/检查

禁止：
- 定义 README 树
- 定义“目录必须长这样”的形式主义约束
- 生成测试策略之外的实现细节
- 执行任何工具

`TaskContract` 建议字段：
- `scope.required_features`
- `scope.out_of_scope`
- `artifacts.allowed`
- `artifacts.forbidden`
- `checks.required`
- `budgets.max_changed_files`
- `budgets.max_doc_files`
- `budgets.max_replans`
- `budgets.max_noop_cycles`

### 2. Planner Agent
只负责把 `TaskContract` 变成可执行任务图，不负责写代码、不负责验收。
每个计划节点必须绑定：
- 输入前提
- 输出产物
- 完成判据
- 对应检查
- 是否允许新增文件

禁止：
- 把“验证目录结构”“补 README”“再看一遍 app.json”当成主任务
- 生成无法映射到用户价值的节点
- 把“自我确认”当作独立里程碑

计划节点必须分成 4 类：
- `implement`
- `configure`
- `test`
- `evaluate`

不允许出现“模糊 verify 节点”。

### 3. Executor / Builder Agent
只负责实现和最小必要自检，不负责最终是否通过。
允许：
- 代码实现
- 配置补齐
- 运行与当前改动直接相关的检查

禁止：
- 自己追加新验收标准
- 为了“看起来完整”扩展 README、目录、脚手架
- 连续重复运行相同验证而无新改动
- 在未发生代码变更时反复做结构巡检

执行器每轮必须输出 `ChangeManifest`：
- 改了哪些文件
- 每个文件对应哪个计划节点
- 为什么需要改
- 运行了哪些检查
- 上一轮失败点是否被消除

### 4. Test Agent
只负责暴露问题，不负责修复。
输入：
- `TaskContract.checks.required`
- `ChangeManifest`

输出：
- `CheckResult[]`
- 失败日志
- 失败归因标签
- 是否存在环境性阻塞

禁止：
- 改文件
- 提建议性实现
- 用模糊语言“应该差不多可以”

### 5. Evaluator Agent
只负责裁决，不负责实现、不负责测试执行。
输入：
- `TaskContract`
- `PlanGraph`
- `ChangeManifest`
- `CheckResult[]`
- `ArtifactAudit`
- `RunMetrics`

输出只能是：
- `accepted`
- `rejected`
- `blocked`

每个 `rejected/blocked` 必须带：
- 精确失败项
- 证据
- 是否允许 replan
- 下一轮唯一需要解决的问题集

禁止：
- 泛泛而谈“整体不错”
- 因为任务很大就放松标准
- 因为还在产生活动就不给失败结论

## 质量控制门与量化指标
### A. 活性门
防止“卡死但仍有噪音活动”。
指标：
- `meaningful_change_gap_ms`：距离上次有意义文件改动的时间
- `noop_cycle_count`：连续“无代码变更 + 只验证/只读/只写说明”的循环数
- `repeat_command_ratio`：重复命令占比
- `repeat_reasoning_similarity`：最近 N 轮推理相似度

判定：
- 超过阈值直接 `blocked`
- 不是继续跑，而是交付失败报告

### B. 产物质量门
防止交付一堆膨胀垃圾。
指标：
- `source_file_count`
- `doc_file_count`
- `non_source_churn_ratio`
- `readme_proliferation_count`
- `out_of_scope_file_count`
- `scaffold_noise_count`
- `placeholder_count`：TODO、stub、mock-only、未接线页面数量

默认规则：
- 未明确要求时，模块级 README 一律判负项
- `node_modules`、构建产物、缓存产物不计入交付，但若进入变更集或验收叙事则判负项
- 文档文件数量必须受预算约束
- 新增文件必须能映射到计划节点和用户价值

### C. 验证质量门
防止“测了很多，但不代表质量”。
指标：
- `required_check_pass_rate`
- `critical_check_pass_rate`
- `check_relevance_score`：检查是否真的覆盖需求
- `verification_edit_ratio`：验证次数 / 有意义改动次数

规则：
- 必须先定义 `required checks`
- 没有覆盖用户关键能力的检查，不能支撑通过
- `verification_edit_ratio` 过高视为流程失控

### D. 需求贴合度门
防止过度工程化。
指标：
- `feature_coverage_p0`
- `scope_drift_score`
- `plan_to_change_traceability`
- `delivery_focus_score`

规则：
- 每个变更文件必须能追溯到 P0 功能或必要基础设施
- “为了更规范”“为了以后扩展”的新增内容默认不算正收益
- PRD 大任务优先做可运行 MVP，不允许先搭大而全骨架再慢慢填

## Benchmark 与持续迭代设计
### 1. Benchmark 输出升级
现有 full benchmark 之外，新增统一的 `RunMetrics` 和 `ArtifactAudit`。
建议固定输出：
- `task_status`
- `evaluation_verdict`
- `changed_files`
- `artifact_audit`
- `run_metrics`
- `failure_matrix`
- `manual_review_summary`

`ArtifactAudit` 建议字段：
- `source_files_added`
- `config_files_added`
- `doc_files_added`
- `out_of_scope_files`
- `unmapped_files`
- `placeholder_hits`
- `duplicate_docs`
- `scaffold_expansion_flags`

### 2. PRD 专项 benchmark
对 `specs/prd.txt` 这种大任务，不能只看“任务完成”。
必须额外引入：
- `scope_budget`
- `doc_budget`
- `verification_loop_budget`
- `meaningful_progress_budget`

并加 3 类硬失败：
- 长时间无有意义改动但持续验证
- 文档/目录/脚手架明显膨胀
- 最终产物与 P0 功能映射不清

### 3. 持续迭代闭环
每次 benchmark 结束后只保留一个主失败类别：
- `liveness`
- `scope_drift`
- `artifact_quality`
- `verification_gap`
- `delivery_gap`

迭代规则：
- 如果是 `liveness`，先修职责和 stop condition
- 如果是 `artifact_quality`，先修 evaluator 与 artifact audit
- 如果是 `verification_gap`，先补 required checks
- 如果是 `delivery_gap`，再调 planner/executor

禁止同时改一堆 prompt 和逻辑，否则指标失真。

### 4. 失败时的交付策略
不要卡死，也不要交狗屎。
统一改成：
- 达不到门槛时返回 `blocked/rejected`
- 附带失败报告、当前产物清单、未达标项、建议下一轮唯一目标
- 不再无限验证直到超时

## 测试与验收场景
### 职责边界测试
- Executor 不能在测试失败后直接修测试标准
- Test agent 不能编辑文件
- Evaluator 不能运行实现命令
- Planner 不能生成无映射的 verify 节点

### 质量门测试
- 人为注入多个 README，必须被 `artifact_quality` 拒绝
- 人为制造重复验证循环，必须被 `liveness` 阻断
- 只有结构脚手架、没有关键功能实现，必须被 `delivery_gap` 拒绝
- 所有 required checks 通过但存在明显 scope drift，仍必须拒绝

### PRD 场景测试
- `specs/prd.txt` full benchmark 不得因为持续“verify 结构/README”超过预算
- 如果任务过大无法在预算内完成，必须输出 `blocked` 而不是无限跑
- 最终 accepted 必须同时满足：P0 功能覆盖、检查通过、产物无明显膨胀、无长循环

## 关键接口与数据结构变更
需要新增或强化这些结构：
- `TaskContract`
- `PlanNode.kind`
- `ChangeManifest`
- `CheckResult`
- `ArtifactAudit`
- `RunMetrics`
- `EvaluatorVerdict`

其中最重要的新增字段：
- `forbidden_artifacts`
- `doc_budget`
- `max_noop_cycles`
- `repeat_command_ratio`
- `scope_drift_score`
- `plan_traceability`

## 默认假设
- 验收口径采用你确认的 `严格产物约束`
- `specs/prd.txt` 的目标是可运行 MVP，不是大而全脚手架样板
- README、目录美化、结构炫技不计入正向质量
- “还在持续输出日志”不等于“没有卡死”
- 失败也必须有结构化交付，不允许无限循环等超时
