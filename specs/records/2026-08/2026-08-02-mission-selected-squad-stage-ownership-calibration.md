# Mission Selected-Squad Stage Ownership Calibration

Date: 2026-08-02
Status: Complete
Owner: Codex

## Recall

### User request

- “什么叫运行时无法把数据落盘？”并提供 Task
  `tsk_fbe244fb0001efbbgnPF0ukWWL` 的完整调试信息。
- “一般派生agent都基于build派生，检查sdk和已生成的专家团，哪些agent不是从build派生”。
- “帮我找校准实现”。

### Acceptance criteria

- 用真实 SDK、manifest、生成 payload、运行时数据库和 Mission 消息流证明问题来源。
- 不把所有非 Build Agent 粗暴改成 Build；保留 Requirements、Architect、Deep Research、
  Fact Check、Visual QA 等 typed runtime template 的协议所有权。
- 显式选择的 Expert Squad 只接收其 selector 与完整 workflow 明确拥有的 Task 阶段。
- 当所选 Squad 只覆盖原请求的一部分时，Mission 先派发最早、可独立验收的已覆盖阶段，
  将未覆盖的依赖阶段保留在 Mission 台账等待授权；禁止把未覆盖交付面塞入当前 Task，
  也禁止静默丢弃。
- `Original user input` 继续逐字保留，但不得反向扩大当前阶段已经写明的 in-scope 与
  acceptance boundary。
- 修复走 Mission prompt 与架构语义，不增加 Host gate、关键词路由、状态机、fallback
  或第二 active Squad 来源。
- 增加纯非 UI 的正向 prompt 契约回归；不新增、修改或运行 UI 自动化测试。
- 保留共享工作区全部并行改动，只提交本任务路径并推送到 `legacy-remote` 当前交付分支。

### Hard constraints

- 当前运行中的 OpenCorvus、Overlay、Task 和 SQLite 数据库只读检查；不停止、重启、
  刷新或修改运行状态。
- `prompt_profile.active`、manifest `id`、Registry、Resolver 和 Mission
  `create_task.promptProfile` 继续是既有单一来源。
- `base_role` 只选择 typed runtime template；不把它当作 Agent 身份继承树。
- `universal-build` 继续是 scheduler-only 平台身份，不写入 package manifest 或
  virtual workflow。
- 跨 Squad 的依赖阶段仍由 Mission 建立独立、固定 `promptProfile` 的 Task，并通过
  exact Artifact imports 交接。

### Sources read

- `AGENTS.md`
- `packages/sdk/js/src/expert-squad-manifest-v1.ts`
- `packages/sdk/js/src/expert-squad-authoring.ts`
- `packages/opencorvus/src/agent/runtime-template-registry.ts`
- `packages/opencorvus/src/agent/tool-pool-data.ts`
- `packages/opencorvus/src/agent/universal-build.ts`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/expert-squad/builtin/{base,advanced,research-studio}/**`
- repository-authored Expert Squad manifests under `expert-squads/**`
- `packages/opencorvus/generated/expert-squad-payload.ts`
- `specs/current/architecture/{01-agents,04-extensions,14-agent-runtime-mode,99-principles}.md`
- `specs/records/2026-07/2026-07-22-research-studio-expert-squad.md`
- `specs/records/2026-07/2026-07-25-research-studio-agent-expansion.md`
- immutable SQLite evidence for Mission Session
  `ses_041dd8146ffedKYkTMBKhzpnJp`, Task
  `tsk_fbe244fb0001efbbgnPF0ukWWL`, and its child Sessions and Artifacts.

### Whole-repository grep results

| Surface | Complete call-point result | Disposition |
| --- | --- | --- |
| Manifest runtime selection | Nine current package manifests declare 86 projected workers through `base_role`; 9 use Build and 77 use another typed runtime. | Preserve explicit per-role templates; no blanket Build conversion. |
| Generated packages | Six generated payload manifests (`frontend-innovate`, `frontend-replica`, `mirror-watch`, `opentest`, `prism`, `review-debug`) byte-match their tracked sources. | No payload drift repair is needed. |
| Research Studio | Researcher intentionally changed from Delegated Worker to Deep Research in `4438b8fa72`; its prompt explicitly forbids project writes. Writer remains Delegated Worker and owns Markdown materialization. | Keep the five-agent research contract; do not make its researcher a software implementer. |
| Universal Build | Resolver projects one scheduler-only `universal-build` for every active Squad; core Orchestrator permits it only for direct implementation or an explicitly described pre-review implementation position. | Do not insert it into Research Studio’s binding workflow or use it as a fallback. |
| Mission selection | `mission-core.txt` requires selector-guidance comparison and says a non-empty launcher selection cannot be widened, but its batch-first rule does not explicitly state how to split a request when the selected catalog owns only an earlier subset. | Add a positive partial-ownership staging contract at the Mission prompt source. |
| TED incident | Mission reasoning explicitly recognized that Research Studio did not own the website, but still bundled research, file materialization, and website into one Research Studio Task. Deep Research then published durable database Artifacts but could not create the requested files. | Calibrate pre-dispatch Task scope; do not repair the later worker symptom. |
| Tests | `mission-prompt-work-ledger.test.ts` is the focused non-UI prompt contract. It also contains historical negative string assertions. | Add positive selected-stage ownership coverage and remove the touched negative assertions rather than extending them. |

### Independent Agent feedback

The user did not request multiple independent Agents or parallel audit, so no sub-Agent was
started. The main Agent owns the runtime evidence audit, implementation, verification, and
second review.

## Causal chain

1. The operator selected only `research-studio`, so Mission’s visible catalog contained that
   one exact Squad.
2. Mission correctly observed that Research Studio owns research and report delivery but not
   structured file acquisition or website implementation.
3. The batch-first prompt did not explicitly say that partial catalog ownership is itself a
   split cause. Mission therefore treated shared dataset context as a reason to bundle every
   deliverable into one Research Studio Task.
4. The Task’s `full-research` workflow correctly dispatched a Deep Research worker. That
   worker had research update and Artifact publication tools but no Shell, POST, binary
   download, or project-file write surface.
5. Durable Engine Artifacts persisted successfully, proving this was not a disk or SQLite
   failure. The incompatible filesystem and website deliverables remained unmaterialized.
6. The Task asked the operator to choose a broader executor only after the incompatible
   Task had already run. The correct authority question belonged before that later phase,
   while the independently valid Research Studio phase could have started without waiting.

## Implementation

1. Amend Mission’s batch-first contract: related work may be bundled only when one exact
   selected Squad positively owns the complete authored Task phase.
2. Define partial ownership as a stage boundary. Dispatch the earliest self-contained stage
   that the selected Squad can complete and accept; record uncovered dependent stages for
   later authorization.
3. Require `create_task.request` to state the stage-local in-scope, out-of-scope, and
   acceptance boundary. Preserve the relevant original operator text verbatim without
   allowing that quotation to widen stage ownership.
4. Document the same boundary in current Agent/extension architecture.
5. Add positive non-UI prompt regression coverage and remove touched negative prompt-string
   assertions.

## Validation plan

- Run the focused Mission prompt contract.
- Run Mission expert-squad production prompt coverage.
- Run OpenCorvus TypeScript checking.
- Run historical-doc links and document-health checks required for a new record/current
  architecture update.
- Run `git diff --check`, inspect the exact task-owned diff, and perform a second causal
  review before commit.

## Validation findings

- The focused Mission prompt and Expert Squad production contracts passed `13/13` with
  `71` positive assertions.
- The touched Mission test no longer retains its historical negative string assertions.
- OpenCorvus TypeScript checking completed successfully with `tsc --noEmit`.
- Historical-link and document-health validation passed `62/62` with `1,144` assertions.
  The first document-health run correctly reported that this record and the concurrent
  Composer record linked by the shared August index were untracked. A current-HEAD
  temporary validation index included only those two existing records; the user's real
  index was not modified.
- The six generated Expert Squad payload manifests byte-match their tracked sources.
  No payload regeneration or manifest mutation was required.

## Second review

The exact incident chronology was reread after implementation. The Research Studio
worker behaved according to its declared Deep Research contract and successfully
persisted three domain outputs plus coordination evidence. The faulty boundary occurred
earlier: Mission bundled research, executable data acquisition, filesystem deliverables,
and a local website after already observing that the selected catalog owned only the
research/report phase. The repair now changes that upstream Task-authoring decision.

The review rejected three alternatives:

1. Converting all specialized workers to Build would erase typed adapter ownership.
2. Converting only the Research Studio researcher to Build would lose its structured
   research protocol and still leave website design, implementation, and acceptance
   unowned.
3. Inserting `universal-build` into the selected Research Studio graph would contradict
   its scheduler-only platform identity and use it as a workflow escape.

The implemented Mission prompt preserves one selected Squad per stage, starts useful
owned work without premature questioning, and defers only the uncovered dependent
stage that genuinely needs new operator authority.
