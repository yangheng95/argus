# Agent Trace — 深度调试指南

OpenCorvus 内置的 agent 输入/输出 trace，用于排查 agent 行为、prompt 内容、工具调用、终态报告。**默认开启**，零配置即可使用。

## 1. 状态

| 项 | 默认 | 说明 |
|---|---|---|
| 是否开启 | ✅ 开启 | 启动时自动写 trace |
| 输出位置 | `<project>/.opencorvus/trace/` | 在你的项目目录下 |
| 覆盖范围 | 所有 agent + 所有 LLM 调用 + 失败路径 | 见下方"覆盖矩阵" |

### 关闭 / 调整（按需）

```bash
# 完全关闭 trace
export OPENCORVUS_AGENT_TRACE=0      # 或 false / no / off

# 多模态附件（图片 / PDF base64）很大时，去掉 data: URL 主体
export OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS=1

# 显式指定 trace 输出目录（例如 benchmark / CI 不想写到 Instance.directory）
export OPENCORVUS_AGENT_TRACE_DIR=/path/to/trace-out
```

### Benchmark / CI 注意

`overlay-web-benchmark.ts` 默认会在结束时 `rm -rf temp.dir`（含 `<temp.dir>/.opencorvus/trace/`）。为防止 trace 被一并清掉，benchmark 启动时**自动**设置：

```
OPENCORVUS_AGENT_TRACE_DIR=<process.cwd()>/overlay-web-benchmark-trace-<ts>/
```

trace 落在 cwd（与 reportFile 同目录），不受 cleanup 影响。如果你显式传了 `OPENCORVUS_AGENT_TRACE_DIR`，benchmark 不会覆盖你的设置。

## 2. 输出文件布局

```
<project>/.opencorvus/trace/
├── _index.jsonl                     ← session 注册表（最先 cat 这个）
├── _task-tsk_xxx.jsonl              ← task 全链路时间线（一个文件 = 一个 task 的所有 agent）
├── _task-tsk_yyy.jsonl
├── ses_orchestrator_aaa.jsonl       ← orchestrator wake 1 的所有事件
├── ses_orchestrator_bbb.jsonl       ← wake 2
├── ses_requirements_ccc.jsonl       ← requirements agent
├── ses_architect_ddd.jsonl
├── ses_fidelity_eee.jsonl
├── ses_build_fff.jsonl
├── ses_delivery_ggg.jsonl
├── ses_prosecutor_hhh.jsonl
└── helper-agent-generate-1714xxx.jsonl   ← Agent.generate 单次调用
```

- 下划线开头的文件 (`_index`, `_task-*`) 排在 `ls` 顶部，方便从全局视图开始排查
- 每个 session 文件 = 该 session 所有事件（按 ts 升序，append-only）
- 每个 task 文件 = 该 task 所有 session 的所有事件混合，**按时间顺序**

## 3. 事件 schema

每行一个 JSON 对象：

```jsonc
{
  "ts": 1714000000000,            // epoch ms
  "kind": "<event-kind>",         // 见下表
  "sessionID": "ses_...",         // 该事件归属的 session
  "parentSessionID": "ses_...",   // 父 session（若有）
  "taskID": "tsk_...",            // 关联 task（若有）
  "agentName": "fidelity",        // agent 标识
  "agentMode": "primary",         // primary / subagent
  "payload": { /* 内容随 kind 不同 */ }
}
```

### 事件 kind 一览

| kind | 触发点 | payload 含义 |
|---|---|---|
| `session_open` | 第一次见到该 session（仅在 `_index.jsonl`） | `firstEvent` 该 session 的首个事件 |
| `llm_request` | `LLM.stream` 调 `streamText` 之前 | model / system / messages / tools — **真实发到 LLM 的全部输入** |
| `agent_report` | `runAgentSession` 成功 return | collector / structured / streamErrors |
| `agent_report_retry_final` | `runAgentSessionWithRetry` 终态 | collector / attempts / error?（exhausted 时） |
| `agent_report_failure` | `runAgentSession` 抛错 | collector?（best-effort）/ streamErrors / error |
| `orchestrator_wake` | orchestrator 一次 wake 完成 | finishReason / finalText / streamErrors |
| `orchestrator_wake_failure` | orchestrator catch 块 | error |
| `helper_llm_call` | `Agent.generate` / generateFollowup | messages / schema / output / error |

### llm_request payload 字段

```jsonc
{
  "model": { "providerID": "anthropic", "modelID": "claude-..." },
  "small": false,                       // 是否走 small 变体
  "toolChoice": "auto",
  "system": [ "core prompt...", "skill injection..." ],   // 拼装后的 system，按顺序
  "messages": [ /* 完整 ModelMessage[]，含 system 项、user 项、assistant 工具调用、tool_result */ ],
  "tools": [ { "name": "submit_verdict", "description": "..." }, ... ]
}
```

`messages` 是**LLM 真正看到的**消息流（含历史 tool_call / tool_result）。如果同一个 session 有多次 `llm_request`，对比相邻两次的 messages 即可看到一轮 step 间增加了什么。

### agent_report payload 字段

```jsonc
{
  "collector": { /* 各 agent 的内部 collector：
                    - fidelity: FidelityResult { verdict, issues, corrections, missingGoals }
                    - delivery: { verdict: DeliveryVerdictType, finalized: boolean }
                    - architect: ArchitectCollector { goals, contracts, ... }
                    - requirements: { requirements, decisions }
                    - build: undefined（build 用 structured，不用 collector）
                 */ },
  "structured": { /* StructuredOutput 指定 format=json_schema 的 agent（build）才有 */ },
  "streamErrors": [ { "reason": "...", "name": "..." } ]
}
```

## 4. 常见调试动作

### 4.1 看一个 task 的完整 agent 调度链

```bash
cd <project>/.opencorvus/trace
cat _task-tsk_<id>.jsonl | jq -r '"\(.ts) [\(.agentName)] \(.kind)"'
```

输出大致如下：
```
1714000000000 [orchestrator] session_open
1714000000050 [orchestrator] llm_request
1714000005000 [orchestrator] orchestrator_wake
1714000005500 [requirements] session_open
1714000005550 [requirements] llm_request
1714000020000 [requirements] agent_report
1714000020500 [architect] session_open
...
```

### 4.2 看 fidelity 实际发了什么 prompt

```bash
cat ses_fidelity_<id>.jsonl | jq 'select(.kind == "llm_request") | .payload.system'
cat ses_fidelity_<id>.jsonl | jq 'select(.kind == "llm_request") | .payload.messages'
```

### 4.3 看一个 agent 最终交付了什么

```bash
# fidelity 最终 verdict
cat ses_fidelity_<id>.jsonl | jq 'select(.kind == "agent_report") | .payload.collector'

# delivery 最终 verdict（含所有 attempts 的最后一个）
cat ses_delivery_<id>.jsonl | jq 'select(.kind == "agent_report_retry_final") | .payload'

# orchestrator 一次 wake 的结果文本
cat ses_orchestrator_<id>.jsonl | jq 'select(.kind == "orchestrator_wake") | .payload.finalText'
```

### 4.4 找出哪个 agent 失败了

```bash
# 全局扫所有 _task-*.jsonl，列出失败事件
for f in _task-*.jsonl; do
  jq -r 'select(.kind | endswith("_failure")) | "\(.ts) \(.agentName) \(.payload.error)"' "$f"
done
```

### 4.5 看 LLM 在每个 step 之间得到了什么新工具结果

```bash
# 一个 session 的所有 llm_request，diff messages 数组长度
cat ses_build_<id>.jsonl | jq 'select(.kind == "llm_request") | (.payload.messages | length)'
```

### 4.6 看一个 task 用了什么模型

```bash
cat _task-tsk_<id>.jsonl | jq -r 'select(.kind == "llm_request") | "\(.agentName) \(.payload.model.providerID)/\(.payload.model.modelID)"' | sort -u
```

### 4.7 看一个 agent 看到的 tool 列表是否符合预期

```bash
cat ses_fidelity_<id>.jsonl | jq 'select(.kind == "llm_request") | .payload.tools | map(.name)'
```

## 5. 覆盖矩阵（每次 release 必须确认）

| Agent | 输入截获 | 输出截获 | 失败截获 |
|---|---|---|---|
| orchestrator | ✅ llm_request | ✅ orchestrator_wake | ✅ orchestrator_wake_failure |
| requirements | ✅ llm_request | ✅ agent_report (collector) | ✅ agent_report_failure |
| architect | ✅ llm_request | ✅ agent_report (collector) | ✅ agent_report_failure |
| design-analyst | ✅ llm_request | ✅ agent_report (collector) | ✅ agent_report_failure |
| intent-analysis | ✅ llm_request | ✅ agent_report (collector) | ✅ agent_report_failure |
| fidelity | ✅ llm_request | ✅ agent_report (collector) | ✅ agent_report_failure |
| build | ✅ llm_request | ✅ agent_report (structured) | ✅ agent_report_failure |
| delivery | ✅ llm_request | ✅ agent_report_retry_final | ✅ agent_report_retry_final.error |
| prosecutor | ✅ llm_request | ✅ agent_report (collector) | ✅ agent_report_failure |
| planner (subagent) | ✅ llm_request | ✅ agent_report | ✅ agent_report_failure |
| general / explore | ✅ llm_request | ✅ agent_report | ✅ agent_report_failure |
| title / compaction / summary | ✅ llm_request | — (不经 runner) | — |
| Agent.generate (helper) | ✅ helper_llm_call | ✅ helper_llm_call.output | ✅ helper_llm_call.error |
| generateFollowup (helper) | ✅ helper_llm_call | ✅ helper_llm_call.output | ✅ helper_llm_call.error |

**唯一未捕获**：`server/routes/provider.ts:206` 的 model 健康检查 — 不是 agent，是诊断 ping，刻意排除。

## 6. 文件管理

trace 文件**追加写**，不会自动清理。每次 task 完成大约产出 5–20 MB（取决于 system prompt 长度 + 多模态附件）。建议：

```bash
# 任务排查完毕后，一键归档
mv .opencorvus/trace .opencorvus/trace-$(date +%Y%m%d-%H%M%S)

# 或者只保留最近一周
find .opencorvus/trace -name "*.jsonl" -mtime +7 -delete
```

如果要永久减小 trace 体量，启动时设：
```bash
export OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS=1
```
这会把图片 / PDF / 大文件 base64 替换为 `[redacted data URL, N chars]` 占位符，prompt / messages / 工具列表全部保留。

## 7. 实现细节（修改前必读）

- 入口模块：`src/trace/index.ts` (AgentTrace namespace)
- 4 个 hook 站点：
  - `src/session/llm.ts` — 唯一 LLM 入口
  - `src/agent/runner.ts` — runAgentSession + runAgentSessionWithRetry
  - `src/orchestrator/agent.ts` — Orchestrator.processTask
  - `src/agent/agent.ts` + `src/task-api/index.ts` — 两个旁路结构化 LLM helper 调用
- 失败 fail-soft：append 失败仅 `log.warn`，不 throw（不能让 trace 自身阻塞 agent 跑）
- session 文件由 OS 文件锁保护原子写（`fs.appendFileSync` 单调用单 line）
- 无 in-memory 缓冲；事件落盘即可见，调试时可 `tail -f`
- 规则 22 单源：所有写盘逻辑只在 `append()` 一处；新增 hook 时只调 `recordLLMRequest` / `recordAgentReport` / `recordHelperLLMCall`

## 8. FAQ

**Q: trace 会拖慢运行吗？**  
A: append 是同步 O(消息体积)。一次 LLM 调用 ~50KB，写盘 <1ms。默认开启对 agent 实际跑的影响在 1% 以内。

**Q: 多个 task 并行运行时，事件会交错吗？**  
A: 不会。每个 task 写自己的 `_task-<taskID>.jsonl`，每个 session 写自己的 `<sessionID>.jsonl`。append 是单线程文件操作，行级原子。

**Q: 如果 agent 在 prompt 阶段就 panic（比如 model 拿不到），有 trace 吗？**  
A: 有。`runAgentSession` 在创建 session 之后包了 try/catch，会写 `agent_report_failure`。在 model 解析阶段失败（更早），还没创建 session，trace 空，但 log 里有错误信息。

**Q: 我能给 trace 加新字段吗？**  
A: 可以。所有事件 payload 都是开放对象。建议：先在 `recordXxx` 入口加 typed 参数；hook 站点上加；不直接在 hook 站点 append 自定义事件，避免规则 22 双源。

**Q: trace 文件能 push 到 git 吗？**  
A: **不要**。`.opencorvus/` 应在 `.gitignore`。trace 含完整 prompt + 任务上下文，可能含敏感信息。
