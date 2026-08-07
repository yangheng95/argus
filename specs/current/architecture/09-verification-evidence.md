# 09 — Host Verification Observations

> 对应代码：`packages/opencorvus/src/verification/` ·
> `packages/opencorvus/src/engine/engine.sql.ts` ·
> `packages/opencorvus/src/acceptance/visual-feedback-verification.ts`

验证层记录可观察事实，不拥有业务通过、Task 完成或下一步调度权。

## 事实族

| Artifact kind | 生产者 | 内容 |
| --- | --- | --- |
| `host_verification_observation` | 真实命令、静态检查和 Host checker | 精确 execution attempt/dispatch lineage、受影响 Slice revisions、检查名称、退出/匹配/摘要等原始观察 |
| `visual_feedback_verification` | Visual QA 证据校验器 | 严格 `VisualFeedbackVerification`，包括 Session、最终消息、VisualReview、Browser Preview evidence 和 SHA 引用 |
| `browser_preview_evidence` | Browser Preview 工具 | 截图、区域比较和浏览器诊断事实 |
| `visual_review` | Visual QA Agent | 领域审查 artifact；可以部分、不完整或与 Host observation 冲突 |

这些 artifact 不共享通用 `Evaluation`、`status + verdict + summary + checks`
报告协议。每个 producer 只保存自己真正拥有的事实。

## 所有权边界

- Host 命令退出、git、文件差异、截图字节和 SHA 只能由真实 Host/tool
  producer 写入。
- Agent 的语义判断只存在于对应领域 artifact 和可见最终 assistant 消息。
- `visual_feedback_verification` 只保存一次严格 payload；DecisionLog 不镜像
  payload，也不维护连续失败计数。
- Task 不保存可变 `criteria_results` rollup。每次检查以不可变、
  execution-evidence-scoped observation 保留，并可引用精确 Slice revision subjects。
- 缺失、部分或互相矛盾的观察必须保持可见。Host validator 不把专家 Session
  改写为业务失败。
- Orchestrator 根据最终自然消息、领域 artifacts、Session/tool trace 和 Host
  observations 自主决定继续、修复、重取证、交付或询问用户。

## Browser Preview 截图闭环

Visual QA 先用 `browser_preview` 建立一个 ready、已持久化的
`browser_preview_target`，再显式调用 `browser_preview_capture`。HTTP capture
route 与该工具共用同一个 target 解析和 Playwright 采集服务，并通过
`persistBrowserPreviewEvidenceBatch()` 产生唯一的 `preview-capture`
`browser_preview_evidence`。

工具结果同时返回两种同源投影：

- exact Engine Artifact locator、viewport ID、evidence ID、operation/status
  和 capture resource ref，供 catalog search/read/select/register；
- 从上述 capture resource 读取的相同 PNG 字节，以普通多模态 attachment
  交给模型直接查看。

AttachmentStore 仅负责内容寻址字节传输，不把任意 Browser 或 Model Context
Protocol (MCP) 截图自动升级为 Visual QA 验收证据。`visual_review` 是唯一持久
Visual QA 报告；同名或泛化 prose artifact、消息附件和 worker summary 都不能
替代其 evidence 与 `completeness_findings`。

对 hover、modal、menu、focus、编辑后状态等 Browser MCP 交互截图，Visual QA
必须显式调用 `browser_preview_capture_interaction_state`，引用当前 Session 中已完成的
canonical Browser `screenshot` / `observe` tool part、持久 target、viewport 和
`stateID`。该工具回读并校验原 attachment 的 project、PNG bytes 与 SHA-256
（Secure Hash Algorithm 256-bit，256 位安全散列算法），并要求 Browser source URL
与 target 同源；target 位于非根路径时 source 还必须位于该路径边界内。之后工具原子发布
Task-scoped capture 与 `preview-capture` evidence，并把 canonical source URL 写入
provenance。未经该显式提升的 Browser 截图只是即时观察，不能作为 core
`visual_review` 的正式证据。

## 查询

Host observation query 按精确 execution attempt 或 dispatch lineage、创建时间和
artifact ID 确定性读取全部观察。不同 Host producer
拥有不同检查；后写 observation 不覆盖先写 observation，互相矛盾的检查也作为独立
事实完整投影。查询不选择 Slice、不推断 Task 状态，也不生成 accepted/rejected
verdict。

Visual feedback 使用 artifact ID 精确读取。无法读取、Task 不匹配、SHA 不匹配或
引用的 Browser Preview evidence 不完整时，校验器记录冲突；该冲突仍由
Orchestrator 解释。

## 不变量

- 不存在已退役的通用 evaluation table、row 类型或 read model。
- 不存在 `verification-evidence` 通用 artifact kind。
- 不存在 `criteria_results` Task aggregate。
- 不存在 artifact + DecisionLog 双写。
- UI/API 只展示原始 artifact 和临时投影，不制造第二份 verdict。

## 验证

- Host observation 与 Visual feedback artifact 的针对性行为测试。
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
