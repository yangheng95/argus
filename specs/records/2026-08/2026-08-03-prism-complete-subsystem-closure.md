# Prism Complete Subsystem Closure

Status: Implemented
Date: 2026-08-03
Owner: Codex

## Recall

### User request

修改 Mirror Prism 的职责：它必须深入实现所有关联子页面，形成一个完整子系统，而不是交付单个页面或破碎的页面体验。

### Acceptance criteria

- Mirror Prism 的选择器、调度器、唯一工作流和全部交付角色都以一个完整、可运行、可联合验收的 AInvest 子系统为交付对象。
- 用户提供的 URL 只是子系统发现入口。来源研究必须沿已授权产品边界发现并保留完成核心业务能力所必需的关联子页面、共享壳层、路由、数据与状态关系、跨页导航边和端到端用户旅程。
- 研究产物必须声明一个有证据支持的 `subsystem_closure`：入口、成员 surface/route、共享能力、业务旅程和闭包理由。无法证明闭包时暴露精确证据缺口，不能把入口页包装成完整交付。
- Planner、Product Requirements Document（PRD，产品需求文档）、设计和代码职责必须一次覆盖闭包内全部成员；页面只是子系统内的实现单元，不能成为独立交付边界。
- 共享 shell、导航、组件、服务、数据和状态在规划/设计/实现中只有一个 owner；跨页旅程必须在真实 router 和真实应用状态上连通，禁止末端用孤立页面或静态跳转拼接。
- 设计、实现、Integrity 与 MirrorTest 必须对完整 route/surface 集合、跨页状态连续性、深链/返回路径、错误恢复和所有 material journey 做联合验收；任一必需子页面或连接断裂都不得接受。
- 保持 Prism 的 `greenfield_original` AInvest 设计权威、桌面单端边界、单一 `mirror-prism-ainvest` 工作流和自包含 package；不恢复 clone/reference-parity 能力。
- 版本、generated payload、当前架构、正向非 User Interface（UI，用户界面）契约测试与源 package 完全一致。

### Hard constraints

- 不增加 Host gate、状态机、fallback、兼容 alias、第二 active source、第二 workflow 或按关键字猜测子页面。
- 子系统成员必须由真实产品结构、业务依赖、导航、数据/状态关系和用户旅程证据决定，不设页面数量配额，也不从常见网站惯例虚构范围。
- 不新增、修改、更新或运行 UI 自动化测试。Package、Registry、Resolver、payload 和 prompt ownership 使用正向非 UI 契约测试；实际页面视觉验收留给真实 Prism 交付运行。
- 不触碰未跟踪的 `packages/vscode-extension/` 或其他无关修改。
- 提交标题使用 `dsw-33987` 前缀，并推送当前主交付分支到 `myhexin`。

### Sources read

- 根目录 `AGENTS.md`。
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md` 及其完整 checklist。
- `specs/README.md`、`specs/current/architecture/04-extensions.md`、`specs/records/2026-08/README.md`。
- `2026-08-03-prism-universal-ainvest-convergence.md`、`2026-08-03-prism-original-product-design-authority.md`、`2026-08-03-prism-semantic-evidence-and-review-closure-repair.md`。
- 当前 `expert-squads/mirror/prism` manifest、README、selector、Orchestrator prompt/Skill、所有 Product Requirements、design、code、MirrorTest 角色 prompt/Skill，以及 system-project、UI audit、PRD output schema 等 package-owned references。
- `packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`、`mirror-prism-source-capability.test.ts`、Software Development Kit（SDK，软件开发工具包）的 Prism authoring/collaboration tests 和 generated payload call points。

### Whole-repository grep results

已执行：

```text
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' "mirror-prism|mirror prism|Mirror Prism|mirror_prism" .
rg -n -i "page|subpage|surface|route|navigation|journey|system|subsystem|complete|broken|fragment" expert-squads/mirror/prism packages/opencorvus/test packages/sdk/js/test specs/artifacts/mirror-prism
rg -n -i "one page|single page|one paired|page author|page designer|page implementer|one implemented|each page|per-page|route-by-route|complete page|whole task|task-wide|route set" expert-squads/mirror/prism packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts packages/sdk/js/test/mirror-prism-authoring.test.ts packages/sdk/js/test/mirror-prism-collaboration.test.ts specs/artifacts/mirror-prism/source-capability-contract.json specs/current/architecture/04-extensions.md
rg -n -F "2026.08.03.3" expert-squads packages specs
```

结果证明 package 已经声称 Task-wide route coverage，但关键职责仍是 `Mirror PRD Page Author`、`Mirror Design Page Designer`、`Mirror Code Page Implementer`，并明确写有 “one self-contained AInvest page”、“one paired AInvest page” 和 “one implemented AInvest page”。当前流程先分别生产页面，再让 integration implementer 组装 router/shell/services，子系统闭包没有成为研究 Artifact、plan entry set、设计或实现的共同强约束。因此破碎体验不是单一提示词遗漏，而是交付对象在角色边界上从 system 降级成 page。

### Independent Agent feedback

未启动子 Agent。用户没有要求并行或独立 Agent，当前协作策略禁止主动委托；最终以实现后的独立本地 diff review 和二次验证代替。

## Root cause

Prism 现有流程在上游发现了 route、surface 和 journey，也在末端要求集成，但中间生产角色仍以单页为身份和职责边界。这样共享导航、数据、状态和跨页旅程被推迟到 integration pass 才处理；如果页面作者、设计者或实现者只完成入口页，后续集成者没有一个明确、可核对的子系统闭包可据以拒绝破碎交付。

根治方式不是增加“至少 N 个页面”的 gate，也不是在末端补链接，而是把唯一交付事实改为证据驱动的子系统闭包，并让每个阶段消费和保留同一个闭包。

## Implementation plan

1. 在 selector、README、Orchestrator prompt/Skill 和 manifest workflow 中明确：Prism 只接受完整子系统交付；单页请求只有在证据证明该页本身构成完整独立子系统时才成立，否则必须扩展到所有业务必需关联子页或暴露 scope/evidence blocker。
2. 扩充 system-project contract，增加 `subsystem_closure`，记录入口、完整成员、共享能力、跨页状态、material journeys、闭包依据和未闭合证据；保留证据驱动范围，不引入数量规则。
3. 让 Planner 的 entry set 按完整闭包规划，并为共享 owner、成员依赖、路由装配、跨页数据/状态连续性和联合验收建立明确正向产物。
4. 把 PRD/Design/Code 的 Page Author、Page Designer、Page Implementer 职责重命名为 Subsystem Author、Subsystem Designer、Subsystem Implementer；一次生产闭包内完整 surface/route 集合，页面只作为可并行内部工作项。
5. 强化 design/code integrator、visual/integrity reviewer 和 MirrorTest：真实运行全部必需子页面，穿越每个 material journey，验证共享 shell、深链、前进/返回、状态延续与恢复，亲自查看每个关键 surface/state 的当前截图。
6. 更新 package version、current architecture、正向 package/SDK contract assertions，并从 tracked source 重新生成 payload。
7. 运行 focused package/source-capability/SDK/payload/docs/typecheck 验证，执行 `git diff --check`，再做独立 diff review。由于本任务修改的是专家团职责而非一个具体生成页面，本轮不伪造真实 Prism 子系统截图；真实交付视觉证据由使用新 package 的后续 Prism Task 产生。

## Verification plan

- `bun test packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`
- `bun test packages/opencorvus/test/expert-squad/mirror-prism-source-capability.test.ts`
- `bun test packages/sdk/js/test/mirror-prism-authoring.test.ts packages/sdk/js/test/mirror-prism-collaboration.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- `git diff --check`

## Results

- Prism source package revision `2026.08.03.4` now makes `subsystem_closure` the shared delivery object from discovery through MirrorTest. The closure records the canonical entry, exact surface/route members and reasons, shared shell/service/data/state owners, navigation dependencies, deep-link/return/recovery behavior, material journeys, and unresolved evidence gaps.
- Page-oriented public labels were replaced by Subsystem Author, Subsystem Designer, and Subsystem Implementer. Their stable internal IDs remain the manifest-owned logical identities, but their prompts explicitly own the entire closure and cannot accept a representative or isolated surface.
- Planner, Product Requirements, design, implementation, integration, Integrity, non-UI MirrorTest, and live visual MirrorTest contracts now require exact closure-member equality and connected journey evidence. Placeholder destinations, parallel mini-applications, broken deep links/returns, lost shared state, and routes that work only in isolation are explicit incomplete-delivery findings.
- The generated Expert Squad payload was regenerated from the tracked source package and the payload freshness contract passed.
- Focused verification passed: Prism package 8/8 with a 15-second per-test timeout, Software Development Kit authoring/collaboration 4/4, source-capability plus payload generation 15/15, historical links 2/2, and OpenCorvus package typecheck. The first Prism package run used Bun's default five-second per-test timeout and the existing live asset materialization case completed in about 5.8 seconds; rerunning the unchanged case with a 15-second test timeout passed, so no product or test contract was patched around timing.
- No User Interface automation was added, modified, or run. This task changes the Expert Squad delivery contract rather than generating a concrete downstream AInvest subsystem; real screenshots and personal visual review remain mandatory evidence for the next Prism delivery Task that uses this package revision.
