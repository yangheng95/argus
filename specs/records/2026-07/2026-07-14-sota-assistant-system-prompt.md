# 2026-07-14 SOTA Assistant System Prompt

## Recall

### Original Request

- 用户要求调查 SOTA（State of the Art，当前最佳水平）助手的 system prompt 写法，以 Codex 和 Claude Code 为榜样。
- 用户要求改进当前 OpenCorvus 版本，特别关注“行动前先思考”和“可以调用子 Agent 解决问题”。
- 用户进一步明确 Coding Assistant 自身也必须具备 dispatch 子 Agent 的能力，但该能力与 Task Orchestrator 的调度工具定位不同。
- 用户要求所有可观察的 Agent 在持续思考或执行期间输出明文 narrative（工作叙述），不能长时间只运行工具而不说明已确认事实、当前动作和下一步。
- 用户允许使用子 Agent 完成调查。

### Acceptance Criteria

- 结论只把官方公开内容称为官方事实；Claude Code 未公开的默认 system prompt 不得用第三方泄露文本冒充。
- OpenCorvus 交互助手的通用行为只有一个代码来源；`coding` 与 `chat` 不再各自复制整份通用行为 prompt。
- Coding 与 Chat 获得真实的会话内 `delegate_agent` 工具：它创建可见的 standalone child session、使用父会话的精确模型、传播取消、返回精简结论和 child-session 指针，并禁止递归委托。
- `delegate_agent` 不创建 engine task / goal，不选择 expert squad，不解析 projected agent identity，也不拥有任务生命周期；Task Orchestrator 的 `dispatch_agent` 继续独占这些调度职责。
- 直接助手、Mission、Orchestrator 和 projected worker 的 prompt 与真实工具能力一致；不得把 `delegate_agent` 与 `dispatch_agent` 写成别名或兼容双路。
- 真正拥有 `dispatch_agent` 的 Orchestrator 明确采用证据驱动的决策循环，并只把自包含、独立或高输出工作委托给合适的 projected agent。
- 小而清晰的工作不强制形式化 plan；复杂、不确定、多文件或高风险工作先调查并形成可验证策略。
- 每个委托 brief 都保留目标、范围、约束、所需证据和预期输出；主 Orchestrator 保留综合判断与最终验收责任。
- 所有通过 Session LLM（Large Language Model，大语言模型）消息流运行的 primary assistant、Orchestrator 和 projected worker 都接收同一个 observable-narrative 协议：首次实质工具调用前给出简短明文进展，后续在一组有意义的工具结果后或方向改变时继续更新；该协议只要求结果层面的解释，不暴露私密 chain-of-thought（思维链）。
- narrative 必须作为真实 assistant text part 流出；不能用 host timer、合成消息、tool metadata 或隐藏消息冒充。它不替代 structured / terminal tool 的持久结果。
- 静态 prompt、最终模型输入、工具能力矩阵和文档健康检查通过；不得把 mocked/string contract tests 称为真实行为 E2E（End-to-End，端到端）。
- 已落盘的真实 E2E 红灯继续如实保留，除非本轮实际运行并满足完整验收。

### Hard Constraints

- 禁止 fallback、兼容双路、关键词路由、host gate、固定 workflow 状态机和机械 retry。
- `prompt_profile.active`、`PromptProfileResolver`、exact projected agent ID 和 `dispatch_agent` 仍是现有唯一任务调度/专家团投影边界。
- 不把 Task Orchestrator 的 `dispatch_agent` 授予 `coding` / `chat`。新增 `delegate_agent` 只负责父助手当前会话内的临时子 Agent；长周期、多角色、需要持久 goal/task 生命周期的工作仍走 Chat `panel.wake_mission` -> Mission task -> Task Orchestrator `dispatch_agent`。
- 会话内子 Agent 与父助手共享当前项目工作区，因此并行委托只能由模型选择相互独立、只读或写入面不重叠的工作；不得新建第二套 worktree/merge scheduler 或 host 状态机来规避冲突。
- prompt 负责模型判断，host 只保留数据完整性与不可逆操作确认；不得用 runtime classifier 代替本次 prompt 改进。
- narrative 通过 prompt 约束模型在自然 assistant turn 中输出；禁止按墙钟计时注入 synthetic progress message，也禁止要求模型公开私密逐 token 推理。
- 修改前读取落盘方案并全仓 grep；修改配测试；测试超时使用 `run-with-inactivity.ts` 且 Bun `--timeout=0`。
- 当前 worktree 有大量其他未提交改动；不得回退、覆盖或把无关改动混入本任务提交。
- commit subject 以 `dsw-33987` 开头并 push 到 `myhexin`。

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/11-agent-oop-protocol.md`
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-01-expert-squad-concrete-prompts.md`
- `specs/records/2026-07/2026-07-06-agent-base-runtime-contract-projection.md`
- `specs/records/2026-07/2026-07-09-preset-prompt-expert-squad-boundary-cleanup.md`
- `specs/records/2026-07/2026-07-10-dynamic-expert-squad-agent-identity.md`
- `specs/records/2026-07/2026-07-14-delegated-context-agent-ownership.md`
- Current OpenAI Codex manual fetched through the `openai-docs` skill.
- OpenAI official Codex base instructions and agent-loop documentation.
- Anthropic official Claude Code best-practices, subagent, common-workflow, agent-loop, and Agent SDK system-prompt documentation.

### Official Research Findings

| Source | Public fact | OpenCorvus implication |
| --- | --- | --- |
| OpenAI Codex base instructions | Public default instructions separate identity, repository instructions, planning, execution, verification, progress updates, and tool rules. | Keep a thin shared behavioral core and identity-owned overlays instead of copying one monolithic prompt per assistant. |
| OpenAI Codex agent loop | Prompt inputs are layered; tool results return to the model and drive the next inference; long contexts are compacted. | Keep mutable task evidence out of stable prompt text and make each next action evidence-driven. |
| OpenAI Codex subagent docs | Parallel subagents are best for bounded independent/read-heavy work; the main thread preserves requirements and decisions. | Orchestrator should delegate bounded evidence work, synthesize summaries, and avoid recursive fan-out. |
| Anthropic Claude Code docs | Official loop is gather context -> act -> verify -> repeat; complex work benefits from explore/plan before implementation, but small tasks do not need ceremony. | Replace “think first” as a slogan with observable pre-mutation investigation and post-action verification. |
| Anthropic Claude Code subagents | Subagents isolate high-volume work and return summaries; shared-context iterative work stays in the main conversation. | Delegate only when context isolation or independent review materially helps. |
| Anthropic Agent SDK | The `claude_code` preset exists, but Anthropic does not publish the complete default Claude Code prompt text. | Do not copy third-party extracted prompts or claim exact Claude Code parity. |

Official references:

- OpenAI Codex public base instructions: <https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md>
- OpenAI Codex agent loop: <https://openai.com/index/unrolling-the-codex-agent-loop/>
- Claude Code best practices: <https://code.claude.com/docs/en/best-practices>
- Claude Code runtime loop: <https://code.claude.com/docs/en/how-claude-code-works>
- Claude Code subagents: <https://code.claude.com/docs/en/sub-agents>
- Claude Code tool reference: <https://code.claude.com/docs/en/tools-reference>

### Whole-Repository Grep And Call-Site Inventory

Commands included:

- `rg -n "PROMPT_CODING|PROMPT_SYSTEM|core_header|PrimaryAssistantRegistry.nativeDefaultPrompt|agent.prompt|runtimeSystemMode|systemMode.*complete|composeSystemPrompt|dispatch_agent" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07`
- `rg -n "spawn_agent|dispatch_agent|subagent|sub-agent|parallel" packages/opencorvus/src/agent/prompt packages/opencorvus/src/session/prompt packages/opencorvus/src/prompt/core packages/opencorvus/test`
- `rg -n "system prompt|systemPrompt|core prompt|corePrompt|Orchestrator|sub.?agent|think before|plan before|PromptProfileResolver" specs packages .opencorvus`
- `rg -n "parentSessionID|parent_id|Session.create|SessionPrompt.prompt|runAgentSession|delegated_worker|submit_delegated_worker_result|SubAgentProtocol" packages/opencorvus/src packages/opencorvus/test`
- `rg -n -i "narrative|progress update|text output is discarded|only through.*tool|free-form prose|reasoning before each tool call" packages/opencorvus/src/prompt packages/opencorvus/src/agent/prompt packages/opencorvus/src/session packages/opencorvus/test`

| Call site / sibling | Current behavior | Planned treatment |
| --- | --- | --- |
| `agent/prompt/coding.txt` | Full direct-assistant prompt; 83 of 88 non-empty behavior lines duplicate `session/prompt/system.txt`. | Replace with a thin `coding` identity/capability overlay. |
| `session/prompt/system.txt` | Generic assistant prompt and `core_header` default. | Retain as the single interactive behavioral kernel; add the evidence loop once and remove contradictory wording. |
| `agent/primary-assistant-registry.ts` | `coding` uses `coding.txt`; `chat` uses `coding.txt` plus Mission handoff. | Compose both from shared kernel + thin identity overlay; Chat keeps real `wake_mission` handoff. |
| `config/prompt-catalog.ts` | Catalog exposes `core_header` and fixed assistant prompts. | Keep catalog behavior but ensure default coding prompt equals the composed runtime prompt. Do not claim that `core_header` reaches complete-mode workers. |
| `session/llm.ts`, `agent/runtime-template-registry.ts`, `orchestrator/agent.ts` | Primary assistants converge at native LLM composition; projected descriptor hashes are computed from runtime-template/Orchestrator complete prompts before `session/llm.ts`. | Apply one code-owned observable-narrative fragment conditionally to primary IDs in native composition, to runtime-template core seeds, and to Orchestrator complete instructions. Config overrides cannot remove it, projected hashes describe the sent prompt, and title/summary/compaction helpers remain untouched. |
| `prompt/core/orchestrator-core.txt` | Exact projected dispatch and lifecycle rules exist, but no compact delegation-judgment section; 452 lines. | Add a concise evidence-driven decision loop and bounded delegation criteria without naming static agent IDs or adding a host gate. |
| `prompt/core/mission-core.txt` | Mission already inspects before dispatch, batches related work, and creates tasks through `panel`. | Preserve; do not add a second subagent protocol. |
| `orchestrator/delegated-worker-tool.ts` / `delegated-worker/*` | `delegated_worker` is a Task Orchestrator dispatch adapter bound to task lineage, active expert-squad projection, engine artifacts and a terminal finalizer. | Do not reuse it as Coding's local delegation path; preserve it for scheduler-owned projected workers. |
| `session/index.ts` / `session/prompt/*` | Standalone sessions already support `parentID`, real visible user/assistant messages, exact model input and cancellation. | Reuse this native path for Coding child sessions; persist parent/tool-call provenance in session metadata and return the child ID to the parent. |
| `agent/tool-pool-data.ts` | `coding` has no delegation tool; `chat` adds `panel`; Orchestrator projection privately owns `dispatch_agent`. | Add the distinct global `delegate_agent` capability to Coding/Chat only; do not add it to projected workers or Orchestrator. |
| `tool/global-tools.ts` / `tool/tool-id-catalog.ts` / `tool/registry.ts` | Global built-ins and role tool pools are the single materialization path for primary assistants. | Register `delegate_agent` once through this path; child prompt explicitly disables `delegate_agent` and `batch` so the batch wrapper cannot re-enter delegation. |
| `chat/session.ts` | Right-sidebar Chat forcibly restores a canonical required-tool list after removing caller-supplied system spoofing. | Add `delegate_agent` to `RIGHT_SIDEBAR_CHAT_REQUIRED_TOOLS` so clients cannot turn off the Coding Assistant's local delegation capability. |
| Structured worker core prompts | Requirements/Architect/Intent Analysis currently say prose is discarded or output must be tool-only. | Clarify that durable facts still require their terminal/structured tools while visible progress narrative is allowed and required. |
| `build/agent.ts` external executor projection | Internal providers persist text deltas, but exact external Codex/Claude builds explicitly drop `text_delta` and `reasoning_delta`. | Persist and stream real external `text_delta` as assistant narrative across tool boundaries; continue discarding `reasoning_delta`, plan deltas and diff previews. Reuse the same narrative prompt fragment in the external complete-system prompt. |
| `test/session/prompt-final-input.test.ts` | Verifies final fixed/complete-mode prompt inputs. | Update composed coding expectation and retain complete-mode isolation. |
| `test/agent/role-contract.test.ts` | Pins prompt catalog defaults to raw `coding.txt`. | Pin to the composed registry prompt instead. |
| `test/agent/final-system-prompt-audit.test.ts` | Static identity wording checks. | Add single-source and contradiction checks. |
| Orchestrator prompt/tool tests | Mostly source/string/schema tests. | Add focused semantic contract checks; run existing dispatch/message tests, but label them contract tests rather than real E2E. |

### Independent Agent Feedback

- Prompt architecture audit: confirmed three identity families and the exact runtime composition chain; identified the `coding.txt` / `system.txt` duplicate source and the false idea that adding subagent prose to `coding` would create a capability.
- Claude official research: recommended context -> action -> verification loops, complexity-aware planning, bounded subagents, independent review, and avoiding speculative reviewer overengineering; confirmed no official full Claude Code default prompt is public.
- Prompt/test audit: confirmed current tests are mainly static or mocked; identified existing host decision gates and a currently red real browser/provider E2E record. Those facts prevent claiming that a prompt text change alone proves SOTA behavior.
- Coding delegation runtime audit: confirmed `runAgentSession` and `DelegatedWorkerAgent` are scheduler/projected-worker paths; recommended native standalone child sessions, exact parent model propagation, persistent parent lineage, explicit abort settlement and compact parent yields.
- Coding delegation architecture audit: rejected a new fixed helper identity for the current requirement because it is the same Coding/Chat capability in an isolated context and a helper identity would expand message identity, config, prompt catalog and compaction contracts. Recursion must instead be removed from the child capability surface, including the `batch` wrapper path.
- Coding delegation test audit: required tool-matrix isolation, right-sidebar anti-spoof coverage, real child messages with `coding` / `chat` authorship, conversation-tree visibility, no engine task/goal/artifact creation, abort/error settlement, and honest separation from real-model parent synthesis evaluation.
- Narrative audit: internal SessionProcessor already persists ordinary text parts, but external Codex/Claude build telemetry drops `text_delta`; `onStatus`, lifecycle state and reasoning deltas are not acceptable substitutes for visible narrative.

## Root-Cause Decision

The request should not be implemented by appending “think before work” or aliasing Orchestrator `dispatch_agent` into Coding. The direct assistant needs a real but narrower session-local delegation primitive, and all runtime identities need one natural visible narrative protocol. The root repair is:

1. One shared interactive behavior kernel.
2. Thin identity/capability overlays.
3. A standalone `delegate_agent` tool for Coding/Chat, distinct from scheduler-owned `dispatch_agent`.
4. One cross-cutting observable-narrative prompt fragment applied by the three real prompt owners before runtime hashes are computed.
5. Prompt/tool alignment, real child-session message-flow tests, and final-input tests.
6. Honest separation between contract verification and real behavior E2E.

## Implementation Plan

1. Convert `agent/prompt/coding.txt` into a thin direct-assistant overlay and compose it with `session/prompt/system.txt` in `PrimaryAssistantRegistry` for both Coding and Chat.
2. Replace the generic prompt's fixed nine-step recipe and contradictory “just stop” line with a compact evidence-driven work loop, complexity-aware planning, deliberate tool use, verification, and user-orientation rules.
3. Add `delegate_agent` to the primary-assistant global tool registry, Coding/Chat tool pools and the right-sidebar required-tool contract. Its execution creates one standalone `assistant` child session with `parentID`, reuses the parent's exact identity and model, sends a real visible delegation message authored by the parent assistant, preserves parent permissions while denying recursive delegation, `batch`, user-question and durable workflow-control tools in the child, propagates abort through `SessionPrompt.cancel`, settles the child terminal status, and returns a bounded `SubAgentProtocol` yield with the child-session pointer.
4. Update Coding/Chat prompt guidance: use local delegation for bounded context isolation, independent investigation/review, or non-overlapping work; keep tightly coupled work local; synthesize and verify child results; use Mission for durable workflow orchestration.
5. Add an Orchestrator evidence/delegation section that chooses exact projected agents from visible capability, dispatches independent evidence work in parallel only when safe, passes complete briefs, and synthesizes results before lifecycle decisions.
6. Add one observable-narrative fragment conditionally to primary assistant IDs in `LLM.composeSystem`, to `RuntimeTemplateRegistry` core seeds and to the Task Orchestrator complete instructions; external projected builds inherit it from the runtime template. Reconcile worker prompts that incorrectly claim all prose is discarded. Require brief pre-tool and periodic evidence-level updates without exposing chain-of-thought or replacing terminal tools.
7. Change exact external Codex/Claude event projection to stream and persist `text_delta` as ordinary assistant text parts, closing each narrative segment at tool/result/terminal boundaries while continuing to suppress `reasoning_delta`.
8. Update static prompt/catalog/final-input/tool-pool tests, right-sidebar anti-spoof tests, external narrative ordering tests, plus runtime tests for parent lineage, real visible child messages, exact model propagation, abort, recursive-tool absence and `dispatch_agent` isolation.
9. Run targeted tests through the inactivity wrapper, typecheck, historical-doc links, document health, and a second source/diff review.

## Validation Boundary

This task can prove source-of-truth composition, prompt/tool alignment, final model input, schema, and deterministic runtime contracts. It cannot claim the assistant now behaves better on real models unless a real provider benchmark also reaches a natural terminal result with visible subagent messages, checker evidence, and independent review. The latest recorded full browser/provider E2E remains `0/1`; this record will not relabel it.

## Implementation And Validation Record

Implemented:

- Composed Coding and Chat from the shared interactive kernel plus a thin Coding capability overlay.
- Added the Coding/Chat-only `delegate_agent` runtime, real standalone child-session lineage, exact parent model and identity propagation, inherited permissions with recursive/workflow-tool denial, cancellation propagation, terminal settlement, and compact `session:<id>` handoff.
- Kept `dispatch_agent` exclusive to the Task Orchestrator and active projected worker runtime.
- Applied one observable-narrative fragment to primary assistants, the host Orchestrator, and all runtime templates before final projected prompt hashing.
- Projected exact external Codex/Claude `text_delta` into persisted assistant text parts while continuing to suppress private reasoning and telemetry deltas.
- Updated current architecture chapters `01`, `13`, `14`, and `99` with the local-delegation, scheduler-dispatch, prompt-ownership, and narrative boundaries.

Verified:

- The first post-implementation `bun run typecheck` completed successfully before unrelated concurrent source changes arrived.
- Focused prompt, tool-pool, runtime-template, Orchestrator, external-event, child-lineage, permission, and cancellation contract tests passed.
- The exact managed external-executor test passed with narrative ordered before tool parts and a persisted end time.
- Historical-doc links, current-architecture scans, and product-doc single-source checks passed for this task's surfaces.

Repository-wide checks are not green and must not be represented as task E2E success:

- A later typecheck is blocked by concurrent `source_snapshot` / `captureArtifactSet` contracts and a missing `plugin-tool-host.revalidate` implementation outside this change.
- Existing package-copy tests are blocked by an undeclared `frontend-replica/dependencies/htmlparser2.mjs` file.
- The right-sidebar route test reaches a changed queue metadata contract before its required-tool assertions and then exits through the real inactivity timeout; the direct overlay/final-input contract verifies `delegate_agent=true` and no `dispatch_agent`.
- Document health remains red on unrelated provider-model schema drift, a hard-coded local profile path, other untracked July records, and a `.scratch` Vite source map.
- No real-provider behavioral benchmark was run, so improved model judgment and narrative cadence remain unclaimed.
