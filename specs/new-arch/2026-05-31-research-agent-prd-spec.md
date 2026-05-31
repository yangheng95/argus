# Research Agent — 资料搜索与 PRD/SPEC 输入层（校准版）

- 日期：2026-05-31
- 状态：已校准草案（待实施）
- 触发：用户要求“设计一个全功能 research agent，用来根据用户的请求搜索资料整理文档/PRD/SPEC，细化我的需求”
- 校准来源：4 个独立 explorer 并行审查 + 本地核对 `workflow.ts` / `orchestrator-core.txt` / `orchestrator/tools.ts`
- 术语说明：PRD（Product Requirements Document，产品需求文档）；SPEC（Specification，规格说明）；LLM（Large Language Model，大语言模型）；MCP（Model Context Protocol，模型上下文协议）；API（Application Programming Interface，应用程序接口）；SDK（Software Development Kit，软件开发工具包）；URL（Uniform Resource Locator，统一资源定位符）

---

## 0. 校准结论

新增 `research`，但它不是第三条 workflow，也不是文档直交付器。当前系统只有两条内置 workflow：

1. `direct`: `analyze_intent? -> build`
2. `pipeline`: `frontend_design? -> analyze_intent? -> requirements? -> architect? -> per-goal build -> integrity`

`research` 是 orchestrator 可选调用的 **advisory side-tool**：当用户请求依赖外部事实、竞品/行业/API 调研、PRD/SPEC 资料整理时，orchestrator 可调用它产出一个可追溯、可过期、可校验的 `research_brief` artifact。这个 artifact 是事实输入，不是流程指针；orchestrator 仍根据完整上下文自行决定下一步。职责仍由：

- `requirements` 产最终 REQ-N 和 foundational decisions；
- `architect` 产 goal graph / contracts；
- `build` 写代码或 markdown 文档文件；
- `integrity` 做最终验收。

明确删除旧草案中的错误路径：`research -> publish_delivery`。`publish_delivery` 当前已禁用，不能作为 PRD/SPEC-only 任务的交付路径。纯文档任务如果需要产出文件，应通过现有可执行工作面完成并由 `integrity` 验收；具体是否需要 `requirements` / `architect` / `build` 由 orchestrator 从任务上下文推理，而不是由 research 固定指派。

---

## 1. 角色边界

| 角色 | 职责 | Research 不得侵入的边界 |
|---|---|---|
| `intent-analysis` | 判断意图、复杂度、缺失槽位、是否需要向用户澄清 | research 不替它做 intent classification，也不直接问用户 |
| `explore` | focused repository investigation，回答代码库/架构/依赖事实，结果写 decision log | research 不替代短平快 repo lookup；只有需要持久化外部证据包时才用 research |
| `research` | 外部事实 + 项目上下文的证据包；产 problem statements、user needs、constraints、source map、document outline、open questions | 不产最终 REQ-N，不产 acceptance specs，不拆 goal，不写代码，不直接交付 |
| `requirements` | 最终 REQ-N + foundational decisions + scope calibration | 不做大规模多源调研；只消费 research 的证据和问题陈述 |
| `architect` | goal graph、contracts、acceptance specs、traceability | 不重新创造 research facts；只引用 evidence IDs |
| `goal-workload-analyst` | 复核 goal 是否低估，产 execution inventory | 不搜索资料，不产需求，不产 PRD/SPEC |
| `fact-check` | 验证 worker terminal report 中的 factual claims | 不主动调研需求；research 不复制 fact-check schema |
| `build` | 产实际文件改动，包括 markdown 文档文件 | 不重新调研来改变需求边界 |
| `integrity` | 最终验收 gate | 不补资料、不写 PRD/SPEC |

决策信号（不是路由规则）：

- 请求缺失意图/范围信息时，`analyze_intent` 是可用工具面。
- 需要代码库事实时，`explore` 是可用工具面。
- 需要外部资料、竞品、行业、API、当前事实、PRD/SPEC 资料综合时，`research` 是可用工具面。
- `research` 的结果只增加证据和开放问题，不规定下一步工具。orchestrator 必须根据 task state、用户原始请求、已有 artifacts、open questions、integrity/build evidence 自行选择 `question` / `requirements` / `architect` / `build` / `fail_task` / 其他工具。

---

## 2. 用户需求细化

### 2.1 核心用户故事

用户输入一个资料依赖较强的请求，例如“帮我做某竞品的 PRD”“调研某 API 后写 SPEC”“根据行业资料设计功能”，系统应自动完成：

1. 判断是否需要外部资料和持久化证据包。
2. 搜索和读取权威来源、竞品资料、技术文档、行业背景、项目内历史资料。
3. 抽取事实、约束、用户场景、竞品能力、风险和开放问题。
4. 生成 compact `research_brief` artifact，并把全文证据包落到磁盘 bundle。
5. 将模糊需求转成 evidence-backed problem statements / user needs / constraints，供 `requirements` 生成最终 REQ-N。
6. 为 PRD/SPEC 任务提供 document outline 和 citation map，但不直接交付最终文档。

### 2.2 REQ-N 需求清单

| ID | 类型 | 需求 | 验收 | 非目标 |
|---|---|---|---|---|
| REQ-1 | explicit | 用户可要求系统根据自然语言请求搜索资料并整理 PRD/SPEC 输入。 | 给定开放调研请求时，系统产生 compact research brief 和磁盘 evidence bundle。 | 不要求 research 直接改代码或交付最终文档。 |
| REQ-2 | explicit | research 必须细化用户需求素材，把模糊表述转成 problem statements、user needs、constraints、open questions。 | 输出包含证据支撑的问题陈述、用户需求、约束、待确认问题和文档大纲。 | 不注册最终 REQ-N，不写 acceptance specs。 |
| REQ-3 | implicit | 所有非显然事实必须可追溯到来源。 | 每个 fact 关联有效 evidence id；每个 evidence 有 pointer、retrieved_at、reliability、bundle pointer。 | 不为无法验证的事实编造来源。 |
| REQ-4 | implicit | research 结果必须能被 downstream agents 结构化消费且可判过期。 | artifact 包含 request_hash、source_digest、research_session_id、created_for_message_id、created_at；下游只消费未过期 brief。 | 不通过隐藏消息或 UI-only 文本传递上下文。 |
| REQ-5 | implicit | 调研必须区分事实、推断、约束、文档结构和待确认问题。 | schema 中分别记录 facts、inferences、constraints、document_outline、open_questions。 | 不把建议或推断伪装成事实。 |
| REQ-6 | implicit | 纯文档交付不得新增平行 delivery 系统。 | 当 orchestrator 判断需要文件交付时，使用现有可执行/验收工具面产出和验收 markdown；不调用 disabled publish_delivery。 | research 不选择交付路径，不直接交付最终文档。 |
| REQ-7 | implicit | agent 只读，不执行 shell、不写代码、不编辑仓库。 | effective runtime tools 不包含 bash/edit/write/apply_patch/task。 | 不承担 build、delivery 或 integrity 职责。 |

---

## 3. 数据流

```text
user request
  └─► orchestrator LLM
        ├─► analyze_intent?       可用工具面：模糊/重入请求澄清
        ├─► explore?              可用工具面：focused repository facts
        ├─► research?             可用工具面：external evidence + document input bundle
        ├─► requirements?         可用工具面：REQ-N + decisions
        ├─► architect?            可用工具面：goals/contracts
        ├─► workload_analysis?    可用工具面：goal sizing review
        ├─► build?                可用工具面：implementation or markdown document file
        └─► integrity?            可用工具面：final gate when appropriate
```

上图是 tool surface map，不是时序图。`research` 是否运行、运行前后调用什么工具，都由 orchestrator LLM 决定，不做 host-side 自动状态机。它不进入第一版内置 workflow step，避免变成第三条 workflow；但 `orchestrator-core.txt` 和 `research` tool description 必须明确职责边界。

### 3.1 编排器校准

本 spec 的核心边界是“提供证据面”，不是“新增编排路径”。实现必须满足：

- 不修改 `workflow.ts` 增加 research step。
- 不在 `research` tool result、`research-core.txt` 或 `orchestrator-core.txt` 里写固定 `NEXT:` / next-tool 指令。
- `research_brief.open_questions.blocking=true` 只能作为事实暴露，不能变成 host-side 自动提问、自动重跑或自动切阶段。
- orchestrator 可以选择调用或不调用 research；该选择来自 LLM 对 task state 的判断，不来自硬编码状态机。
- 文档/PRD/SPEC 的最终文件写入仍由现有可执行工作面完成；research 不直接 publish/deliver。

---

## 4. 输出模型

必须使用 Zod schema 作为单一运行时校验来源，不只写 TypeScript interface。建议文件：

- `packages/opencorvus/src/research/schema.ts`
- `packages/opencorvus/src/research/types.ts` 仅从 schema infer

### 4.1 Compact Artifact

`engine_artifact.kind="research_brief"` 只存 compact payload：

```ts
export const ResearchBriefSchema = z.object({
  metadata: z.object({
    research_session_id: z.string(),
    created_for_message_id: z.string(),
    request_hash: z.string(),
    source_digest: z.string(),
    created_at: z.string(),
    stale_after: z.string().optional(),
  }),
  scope: z.object({
    user_goal: z.string(),
    deliverable_type: z.enum(["prd", "spec", "research_report", "implementation_input", "mixed"]),
    audience: z.string(),
    explicit_non_goals: z.array(z.string()),
    assumed_non_goals: z.array(z.string()),
  }),
  bundle: z.object({
    full_markdown_path: z.string(),
    evidence_json_path: z.string(),
    citation_map_path: z.string(),
  }),
  summary: z.string(),
  evidence_index: z.array(ResearchEvidenceRefSchema),
  facts: z.array(ResearchFactSchema),
  inferences: z.array(ResearchInferenceSchema),
  problem_statements: z.array(ResearchProblemStatementSchema),
  user_needs: z.array(ResearchUserNeedSchema),
  constraints: z.array(ResearchConstraintSchema),
  document_outline: z.array(ResearchDocumentSectionSchema),
  open_questions: z.array(ResearchOpenQuestionSchema),
})
```

### 4.2 Evidence

Artifact 里只保留 evidence index，不塞长正文：

```ts
export const ResearchEvidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum(["web", "code", "memory", "user"]),
  pointer: z.string(),
  title: z.string(),
  retrieved_at: z.string(),
  reliability: z.enum(["primary", "secondary", "community", "unknown"]),
  excerpt: z.string().max(800),
  bundle_ref: z.string(),
  volatile: z.boolean().default(false),
})
```

全文抓取内容、较长摘录、搜索过程、引用上下文写入 `bundle.full_markdown_path` 和 `bundle.evidence_json_path`。`requirements` / `architect` prompt 只注入 compact summary + selected IDs；需要全文时读取 bundle 文件。

### 4.3 Research Claims

research 不产半成品 REQ-N，不产 `acceptance_hint`。用更低层的候选输入：

```ts
export const ResearchProblemStatementSchema = z.object({
  id: z.string(),
  statement: z.string(),
  fact_ids: z.array(z.string()),
})

export const ResearchUserNeedSchema = z.object({
  id: z.string(),
  need: z.string(),
  fact_ids: z.array(z.string()),
})

export const ResearchConstraintSchema = z.object({
  id: z.string(),
  constraint: z.string(),
  fact_ids: z.array(z.string()),
})
```

`requirements` 负责把这些内容转成最终 REQ-N 和 acceptance。

### 4.4 Fact Check

不要在 research schema 中重定义 `fact_check_items`。单一来源是：

- `packages/opencorvus/src/fact-check/schema.ts`
- `FactCheckItemListSchema`

`submit_research_brief` terminal tool 可接受 `fact_check_items: FactCheckItemListSchema.default([])`，并把它保留在 research terminal report 中。artifact 可记录 `fact_check_item_count` 和 `research_session_id`，但不要复制一套不同的 item schema。

### 4.5 Semantic Validation

`submit_research_brief` 必须做 semantic validation：

- 所有 IDs 在同类数组内唯一。
- `facts[].evidence_ids` 必须指向 existing `evidence_index[].id`。
- `inferences[].based_on_fact_ids` 必须指向 existing `facts[].id`。
- `problem_statements[].fact_ids` / `user_needs[].fact_ids` / `constraints[].fact_ids` 必须指向 existing `facts[].id`。
- `document_outline[].evidence_ids` 必须指向 existing `evidence_index[].id`。
- `open_questions.blocking=true` 必须在 tool result 中作为事实显式暴露；不得把它渲染成固定的下一步工具建议。
- semantic validation 失败时不得写 artifact。

---

## 5. 工具与权限

`research` 是只读 stage agent。工具来源必须先收敛，避免复制出第三套 retrieval tools。

### 5.1 单源 Retrieval Tools

现状：

- `createAgentContextTools()` 提供 codebase、memory、`websearch`。
- `fact-check/index.ts` 私有实现 `webfetch` / `external_code_search`。
- registry 也有同名工具。

实施前先抽一个共享只读 retrieval tool 工厂，例如：

- `packages/opencorvus/src/agent/retrieval-tools.ts`
- 导出 `createReadonlyRetrievalTools()`
- `fact-check` 和 `research` 共用它

禁止把 `fact-check` 私有实现复制到 research。

实施校准：

- `websearch` / `webfetch` / `external_code_search` 的联网实现以 registry tool 为单一来源；runtime extras 不得 shadow 同名 registry tool。
- `research` 和 `fact-check` 只通过共享只读 retrieval factory 注入项目内 codebase/memory 工具和 structured output tools。
- codebase retrieval 必须使用真实 path boundary 校验，不能用字符串前缀 `startsWith` 判断项目根目录。
- `research` / `fact-check` 的 tools 和 disable 配置不可被用户 config 改写；否则只读边界会被重新打开。

### 5.2 Effective Runtime Tools

`research` 的 effective runtime tools 应包含：

- `read_file`
- `find_files`
- `search_code`
- `list_directory`
- `memory_search`
- `memory_get`
- `websearch`
- `webfetch`
- `external_code_search`
- `todoread`
- `todowrite`
- structured output tools

必须不包含：

- `bash`
- `edit`
- `write`
- `apply_patch`
- `task`
- `panel`
- mirror tools

测试不能只看 `Agent.Info.tools.include`，也不能只看 `filterAgentTools(createAgentContextTools())`；必须验证 `runAgentSession` 实际 tool switches。

### 5.3 Artifact 安全边界

`research_brief` 是来自 LLM 的不可信结构化数据，落库和注入下游 prompt 前必须校验：

- `source_digest` 必须等于 `evidence_index` 的规范化 digest。
- bundle path 必须是当前 task 的 `.opencorvus/runtime/tasks/<task>/research/<session>/...` 相对路径。
- 下游 prompt 只能以 bounded JSON 数据块注入 brief；不得把 summary/facts 直接渲染成可执行风格的 Markdown 指令。
- volatile evidence 必须有默认过期策略；没有 `stale_after` 的旧 artifact 也不能永久有效。
- `requirements.evidence_refs` 和 `architect.contract_graph.contracts[].evidence_refs` 只能引用当前非过期 brief 中存在的 evidence id。

---

## 6. 持久化与 Staleness

新增 artifact kind：`"research_brief"`。

写入：

```ts
EngineArtifactTable {
  task_id,
  kind: "research_brief",
  label: "active",
  payload: ResearchBriefSchema,
  run_id: null,
  goal_run_id: null,
  delivery_id: null
}
```

新增：

- `persistResearchBrief(input)`
- `findLatestResearchBriefArtifact(taskID)`
- `researchBriefIsStale(task, brief)`

Staleness 规则（数据完整性事实，不是路由规则）：

- `brief.metadata.request_hash` 必须匹配当前 task request + accepted operator refinements 的 hash。
- 如果用户后续 message 改变 scope，旧 brief 标为 stale。
- 如果 `requirements` 被 `restart_from_stage("requirements")` 重跑，旧 brief 必须重新校验 request_hash；不匹配则标记 stale。
- volatile evidence 超过 `stale_after` 后，describe 中标 `research_stale=true`。
- `requirements` / `architect` prompt 注入层只注入 non-stale latest brief；stale 状态仍作为事实暴露给 orchestrator，让 orchestrator 自行决定是否重新 research、询问用户、继续、或失败。

`describeTask` 暴露：

- research brief exists
- stale / not stale
- source count
- fact count
- blocking open question count
- bundle paths
- research session id

---

## 7. Orchestrator 接入

新增 orchestrator tool：`research`。

输入：

```ts
{
  reason: string
  target_deliverable?: "prd" | "spec" | "research_report" | "implementation_input" | "mixed"
  focus?: string
}
```

Tool result：

- session id
- artifact id
- stale key summary
- source count / fact count / open question count
- bundle path
- blocking open question summary, if any
- stale status
- evidence coverage summary

不得返回 “NEXT: call ...” 类型的流程指令；不得返回 “call publish_delivery”。`publish_delivery` disabled。tool result 只暴露事实，下一步由 orchestrator LLM 决定。

`orchestrator-core.txt` 增加：

- `research` is optional advisory evidence gathering, not a workflow step and not a route selector.
- It does not replace `analyze_intent`, `explore`, `requirements`, or `architect`.
- Focused repo lookup belongs to `explore`; external evidence packages belong to `research`.
- The result of `research` is evidence, stale status, and open questions only. It must not instruct the next tool.

---

## 8. 下游消费

### 8.1 Requirements

`requirements` prompt 注入 compact brief：

- summary
- problem statements
- user needs
- constraints
- facts with evidence IDs
- blocking open questions
- bundle path

`requirements-core.txt` 增加：

- research input is not REQ-N.
- Do not copy problem statements as final requirements without acceptance boundary.
- When a final requirement depends on research facts, preserve research evidence refs structurally.

代码层必须把 research evidence refs 接入 `engine_requirement.evidence_refs`，不能只塞进 description 或 decision reason。

### 8.2 Architect

`architect` prompt 注入 compact brief 和 bundle path。

`architect-core.txt` 增加：

- cite research evidence IDs when graph contracts depend on external facts.
- do not invent new external facts.
- document goals for PRD/SPEC must require citation integrity and open-question handling.

如果 contract graph 需要长期保留 research refs，必须扩展 contract schema，而不是把 refs 写进 freeform prose。

### 8.3 Build

build 不重新调研。它只能读：

- requirements
- architect contracts
- research bundle paths/IDs already passed through requirements/architect

当 orchestrator 判断 PRD/SPEC-only 任务需要文件交付时，当前可用执行面是让 build 产出 markdown 文件，并由 integrity 验收 citation coverage 和 open-question handling；research 只提供 evidence refs 和 bundle paths，不决定这条路径是否发生。

---

## 9. 实施清单

新建：

1. `packages/opencorvus/src/research/schema.ts`
2. `packages/opencorvus/src/research/types.ts`
3. `packages/opencorvus/src/research/output-tools.ts`
4. `packages/opencorvus/src/research/agent.ts`
5. `packages/opencorvus/src/research/index.ts`
6. `packages/opencorvus/src/prompt/core/research-core.txt`
7. `packages/opencorvus/src/agent/retrieval-tools.ts`（从 fact-check 私有 retrieval tools 抽出）
8. `packages/opencorvus/test/research/output-tools.test.ts`
9. `packages/opencorvus/test/research/agent-prompt.test.ts`
10. `packages/opencorvus/test/research/persist.test.ts`

修改：

1. `packages/opencorvus/src/agent/role-contract.ts`：注册 `research`。
2. `packages/opencorvus/src/session/session.sql.ts`：加入 session kind `research`。
3. `packages/opencorvus/src/agent/agent.ts`：注册 native hidden primary agent，加入 `NATIVE_DEFAULTS`。
4. `packages/opencorvus/src/orchestrator/tools.ts`：新增 `research` tool，并在 orchestrator tool include 中暴露。
5. `packages/opencorvus/src/prompt/core/orchestrator-core.txt`：加入 research 工具使用纪律。
6. `packages/opencorvus/src/engine/engine.sql.ts`：`EngineArtifactKind` 加 `research_brief`。
7. `packages/opencorvus/src/engine/persist.ts`：新增 `persistResearchBrief`。
8. `packages/opencorvus/src/engine/store.ts`：新增 `findLatestResearchBriefArtifact`。
9. `packages/opencorvus/src/engine/describe.ts`：暴露 research brief 摘要、stale 状态和 bundle paths。
10. `packages/opencorvus/src/requirements/agent.ts`：注入 non-stale research brief。
11. `packages/opencorvus/src/requirements/output-tools.ts` / persistence path：把 research evidence refs 写入 `engine_requirement.evidence_refs`。
12. `packages/opencorvus/src/prompt/core/requirements-core.txt`：消费 research 的边界规则。
13. `packages/opencorvus/src/architect/agent.ts`：注入 non-stale research brief。
14. `packages/opencorvus/src/prompt/core/architect-core.txt`：消费 research 的边界规则。
15. `packages/opencorvus/src/fact-check/index.ts`：改用共享 `createReadonlyRetrievalTools()`。

不修改：

- 不新增第三条 built-in workflow。
- 不启用 `publish_delivery`。
- 不让 research 写文件作为交付物；它只写 bundle/artifact。

---

## 10. Prompt 核心要求

`research-core.txt` 必须包含：

- 只读身份：不写代码、不改项目文件、不执行 shell。
- 证据纪律：事实必须有 evidence；无法验证就列为 open question。
- 来源优先级：primary > official docs/standards > reputable secondary > community。
- 搜索纪律：先制定 search plan；每个主要主题至少一个 query；多实体对比至少 N+1 个 query。
- 输出纪律：所有结果通过 structured tool；普通文本不作为交付。
- 文档纪律：PRD/SPEC outline 按用户目标组织，不照搬来源结构。
- 需求边界：产 problem/user need/constraint，不产 final REQ-N，不产 acceptance specs。
- 架构边界：不创建 goal graph，不制定实现计划，不写 priority roadmap。
- staleness 纪律：标记 volatile facts 和 retrieved_at。
- 文件变更声明：包含项目统一句 “Every agent owns its file mutations: if you modify project files, commit your own changes before finishing; if your role is read-only or only emits structured records, do not claim file changes.”

---

## 11. 测试计划

### 11.1 Schema / Output Tools

- duplicate IDs 拒绝。
- orphan `evidence_ids` / `fact_ids` 拒绝。
- 空 pointer / retrieved_at / excerpt 拒绝。
- overlong excerpt 拒绝。
- semantic validation 失败时 collector 不 finalize，artifact 不写入。
- `fact_check_items` 使用 `FactCheckItemListSchema`，不重新定义 schema。

### 11.2 Runtime Tools

- `research` effective runtime tools 包含 read-only retrieval tools。
- 不包含 bash/edit/write/apply_patch/task/panel/mirror tools。
- config override 不能让内置 research 打开禁止工具。
- `fact-check` 和 `research` 共用同一个 retrieval tool factory。

### 11.3 Orchestrator Tool

- success 写 compact artifact + bundle paths + decision log。
- aborted 不写 active artifact。
- terminal-tool-missing 不写 active artifact。
- schema-invalid 不写 active artifact。
- tool_error 不伪造 research brief。
- blocking open questions 出现在 tool result。
- tool result 不建议 `publish_delivery`。

### 11.4 Persistence / Staleness

- latest active 按 task 隔离。
- stale request_hash 不注入 requirements/architect。
- volatile fact 超期时 describe 标 stale。
- corrupted payload 被忽略或显式报错，不作为 active brief。
- requirements/architect 共用同一 read helper，不维护第二缓存。

### 11.5 Downstream Consumption

- requirements prompt 包含 compact brief 和 bundle path。
- requirements 输出依赖 research facts 时写入 `engine_requirement.evidence_refs`。
- blocking open question 未处理时 requirements 不得静默 finalize。
- architect prompt 包含 evidence IDs，不把 research problem statements 当 final requirements。
- PRD/SPEC build goal 必须包含 citation coverage / open-question handling 验收。

### 11.6 Prompt Hygiene / Role Contract

- `research-core.txt` 加入 `core-prompt-hygiene.test.ts` inventory 和 line budget。
- role contract 与 session kind 同步。
- orchestrator prompt 包含 research 工具使用纪律。
- workflow tests 断言 research 不是必跑 built-in workflow step。

---

## 12. 最小可交付版本

第一期只做：

1. `research` agent + Zod schema + structured output。
2. 共享 retrieval tool factory，供 `fact-check` 和 `research` 使用。
3. compact `research_brief` artifact + full bundle paths。
4. request_hash / source_digest / stale 判断。
5. orchestrator tool surface 暴露可选的 `research` 工具。
6. `requirements` 和 `architect` 只消费 non-stale brief。
7. 测试覆盖 schema、effective tools、artifact round-trip、staleness、下游 evidence refs。

暂不做：

- 自动文档发布。
- 多轮 crawling 队列。
- 专门 UI research 面板。
- 新 workflow。
- 启用 `publish_delivery`。

这样保留核心价值：在需求不清或资料依赖强时，系统可以生成可追溯、可过期、可校验的证据包；随后由 orchestrator 基于完整上下文选择现有工具面完成需求、设计、实现、文档交付或继续澄清，而不是由 research 固定后续路径。
