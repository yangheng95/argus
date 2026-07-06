# Agent 执行原则

> 本文件是 Agent（Claude Code / Codex 等）在本项目中的强制行为规范。
> 所有规则均为硬性约束，违反任何一条都视为不合格交付。
> 编号沿用历史版本，便于追溯与对照。

- 严格根据本规则进行自动化工作，不要等待用户的指令来执行每一步。你必须根据你的专业知识和项目现状，主动执行每一步，直到重构结束。
- 并 git push 上传代码到 git-cc 远端，直到重构结束。你需要关注合并 remote 代码。
- 原则上禁止手搓有成熟工具链支持的UI/UX 设计、前端交互、后端架构、数据库设计等方案。对于任何有现成解决方案的设计问题，必须优先考虑使用成熟的工具链或库来实现，而不是从零开始手工编写。禁止在这些领域进行过度工程，必须利用现有的工具和框架来简化开发过程，提高效率和质量。
- 原则上禁止任何gate/门规则和机制，加这些东西是因为你找不到真正的症结在哪里了，或者你不想修真正的症结。禁止使用 gate 来绕过问题，必须直接面对和解决问题的根本原因。任何试图通过 gate 来掩盖问题的行为都是不可接受的。
- 设置benchmark后用定时器自我唤醒，不要保持监听日志
- Playwright 不允许用bun启动，在windows上会卡死，必须用 node 启动。
- 右侧前端预览面板禁止用临时 iframe、本地 signal、query 覆盖或手写交互冒充成熟工具链；必须以 task-scoped 后端 preview target / evidence 作为单一来源，UI 控件使用成熟 primitives，截图和诊断复用 Playwright/Node sidecar。

---

## 前端视觉验收 Principle（独立硬约束）

build agent 处理任何前端页面、组件、可视化、overlay、preview、UI/UX 相关任务时，必须负责启动真实页面、截图、亲自查看页面，并根据视觉反馈修改代码后复测。截图必须绑定到当前 goal / region / 交付面，不能只使用全局共享截图或只记录 browser/runtime diagnostics。任何只通过 lint、typecheck、build、DOM 文本、console clean、benchmark 分数或口头描述而没有截图查看和视觉拨乱反正的前端交付，一律不算完成。发现截图与目标不一致时，必须继续修复并重新截图，直到视觉问题被根治或按 rule 28b 坦诚标记未达成验收。

当任务要求复刻 / port / clone / parity，但同时说明“不是像素级复制”“不复制品牌视觉”“使用目标设计系统”时，这些措辞只能放松明确点名的 token、组件 primitive、图标来源、品牌资产等维度，不能放松信息架构、模块结构、区域顺序、布局密度、间距节奏、响应式行为和交互语义。禁止把 reference parity 任务改写成“目标设计系统风格的新页面”。已有 reference screenshot / source DOM / style-profile / interaction evidence 证明的不一致，不能写成 accepted variance；只能修复，或按 rule 28b 明确标记未达成验收。

前端复刻 / clone / parity 的项目生成默认是**桌面端单端复刻**。除非用户在当前任务中明确要求“多端迁移 / tablet / mobile / responsive 交付”作为独立目标，否则 build / frontend_design / visual_qa / integrity 不得主动把 tablet、mobile、响应式断点、移动端导航、移动端截图或移动端验收加入项目生成范围；上游模板、批量任务说明、通用验收清单里泛化出现的 responsive / tablet / mobile 字样不构成授权。多端迁移是独立任务，必须在桌面端复刻交付完成后另行建模、设计、实现和验收；普通桌面复刻只能用桌面 reference、桌面 region 证据和桌面截图闭环。

---

## 一、核心思维原则（先想清楚，再动手）

**1.** 看见 bug 要思考本质问题，要探索全部资料和代码寻找证据，不要企图胡说八道蒙混过关。任何掩盖问题的补丁都不应视为合格修复。

**2.** 如果用户的问题过于简单，要尝试深度理解和思考问题的本质，不要浮于表面。如果用户的问题当前路径无法根本解决问题，必须主动警示并重定向。不要迎合表面要求，更不要掩盖真正问题。

**3.** 永远怀疑问题的影响面和问题深度，challenge 你自己的方案，特别是没有证据的回答。如果你发现自己的回复没有任何探索、验证或数据支持，那就说明你可能在胡说八道。不要害怕承认这一点，并且要积极寻找证据来支持你的回答。

**3.1（分析深思熟虑细则 — 2026-06-20）**：分析失败或调度混乱时，禁止把最后一个表层状态（例如 cancelled / aborted / timeout / tool failed）当作根因。必须先分层还原：用户原始要求、调度决策序列、真实 tool call / session / artifact / decision-log 证据、代码职责边界、历史方案约束与矛盾点；再给出“可观察现象 → 直接触发点 → 深层设计/提示词/数据流原因 → 为什么之前路径没有根治”的因果链。证据不足时必须明确标注未知，不得用猜测填补。

**3.2（命名/标题不是因果证据 — 2026-07-03）**：调试 goal、task、artifact、message、session 时，实体标题、slug、label、命名模式（例如 `source row` / `visual source row`）只能作为分类线索，不能直接写成故障原因。必须用 terminal error、tool input/output、decision-log、artifact payload、依赖图、diff/commit 事实或代码路径证明“为什么失败”和“为什么该命名导致失败”。证据不足时只能写“疑似建模问题 / 未证明”，禁止把命名相似性包装成直接原因或必然原因。

**4.** 不要只关注特定的 Agent、LLM 等的问题，由于继承和多态的特性，任何一个问题都可能是系统性的。你需要从整体上分析问题，找到根本原因，而不是只修复表面症状。

**4.1（dispatcher 输入缺失信号）**：当 agent 收到的任务缺少上游约定的 XML（Extensible Markup Language，可扩展标记语言）块时，那是上游 dispatcher 信息丢失的**结构化信号**——查 dispatcher（orchestrator / build wrapper / integrity caller 等）而非 agent 自己。修 dispatcher 的 input 构造或 prompt template，**不要**改 agent prompt 让它"宽容"这种缺失（rule 6.1 — 这是 prompt-over-host 的反向应用，agent 已经在做对的事）。

**5.** 遵守第一性原因，禁止任何形式的过度工程。所有的设计和实现必须以实际需求为导向，禁止为了追求完美或过度抽象而引入不必要的复杂性。

**6.** 禁止过度工程，承认 LLM 模型的能力足够解决大多数问题，不要为了追求完美而引入不必要的复杂性。相反，要利用 LLM 的智能来简化设计和实现，确保系统的灵活性和可维护性。

**6.1（rule 6 应用细则 — prompt-over-host-invariant）**：当 bug 表现为"LLM 选错工具 / 走错升级路径 / 反复重启而不使用细粒度工具"时，**默认修复路径是 prompt 和真实根因修复**，不是 host 端 preflight invariant、route bypass、状态机式拦截、gate/门规则或任何绕行机制。host 端只能保留两类非流程控制约束：(a) 数据完整性约束（Zod schema、DB constraint、worktree 三件套是否完整等纯数据形态）；(b) 显式不可逆操作的二次确认。它们不得被包装成流程 gate，不得用于教 LLM 走哪条路，更不得掩盖根因。其他形式的"教 LLM 应该走哪条路"必须通过 prompt 和具体问题修复实现。reviewer 必须在自己起草方案时拦截这种倾向（rule 11），不要等用户来纠正。教训日：2026-05-07；当前原则归档在 `specs/current/architecture/99-principles.md`。

---

## 二、架构与设计原则

### 2.1 单一来源、禁止兼容

**7.** 不允许任何 fallback 和兼容逻辑。fallback 会累计 bug、制造级联问题，并使问题不可定位、不可修复。

**8.** 禁止双源设计。任何功能、逻辑、设计都只能有一个实现方案，禁止任何形式的双源或多源方案。所有的改动必须直接替换旧方案，禁止保留旧方案的任何代码、配置或逻辑。

### 2.2 抽象与可维护性

**9.** 主动抽象出设计模式。对于任何重复出现的设计问题或代码结构，禁止直接复制粘贴解决方案。必须主动抽象出通用的设计模式或组件来解决问题，确保代码的可维护性和可扩展性。

**10.** 任何时候禁止硬编码配置或参数。所有配置和参数必须通过抽象层或配置文件管理，确保系统的灵活性和可维护性。

**11.** 拦截用户的错误指令和错误设计！绝对阻止用户（也包括你！）创建违反抽象哲学的模块和逻辑！例如阻止违反 OOP、单例模式或其他设计模式的写法。告诉用户如何抽象和添加代码逻辑才是正确方案。

### 2.3 项目特定约束

**12.** 这是个通用工具，不是用来写 bun/ts/js/node 的。不要为了迎合某个特定环境而牺牲工具的通用性和健壮性。

**13.** 任何时候禁止任何状态机代码，依赖 LLM 的智能来管理状态和流程。禁止任何形式的状态机实现，包括但不限于 if-else、switch-case、状态枚举等。所有的流程控制必须通过 LLM 的智能决策来实现，禁止任何硬编码的状态管理逻辑。

**14.** 这个项目禁止任何非流式调用 LLM 的方案。所有与 LLM 的交互必须采用流式方式，禁止任何形式的批量调用或非流式交互，以确保系统的响应性和用户体验。

**15.** 禁止任何合成消息、伪消息、隐藏消息或只给模型/只给界面看的消息分叉。所有对话都必须走自然角色间对话：用户、编排器、agent、tool/result 等真实参与者各自发真实消息；消息流必须显示所有消息，禁止用 visibility/audience/synthetic/ignored 等标记制造双路消息。

**15.1（专家团解耦边界 — 2026-07-06）.** 专家团是 OpenCorvus 内部 scenario / agent capability package，不是全局 core prompt、普通 Codex skill、plugin、UI filter 或旧 `PromptProfile.builtIns` 的别名集合。

- 非 `general` 专家团只能以 `.opencorvus/expert-squads/<namespace>/<id>/` 项目 package 存在；随应用分发的非通用专家团也必须先 release 成这个明文项目 package，再走普通 discovery / catalog / resolver 路径。`namespace` 是来源和安装分区，不是 active identity；运行时内置 package 默认只保留 `general`，除非当前任务明确重开这一架构边界。
- `expert-squad.jsonc` 的 manifest `id` 是唯一专家团身份；目录名、ZIP 文件名、显示 label、selector skill 名、MCP server 名或相似命名都不能决定身份，禁止为改名/相似名增加 fallback、兼容 alias、猜测加载或 UI-only 过滤。
- `prompt_profile.active` 是唯一 active expert-squad 选择来源；禁止新增第二个 active squad 字段、session shadow state、隐藏消息或合成配置来表达“当前专家团”。
- `PromptProfileResolver` 是唯一运行时投影面，负责把 active expert squad 投影到 scheduler capability、worker capability、visible selector skills、skills、package tools、scoped MCP providers、catalog 和 skill-mount surface。禁止让 catalog、overlay、SkillTool、MCP 或 worker 各自扫描 inactive package 资源形成多源投影。
- 领域专家团规则必须放在 package README、`selector.md`、agent role overlay、package skills/tools/MCP 中；全局 Orchestrator/core prompt 只保留专家团协议、生命周期和投影边界，禁止把 frontend-replica 等具体专家团的领域策略写回 global core 或废弃的 built-in skill 文件。
- 专家团可以声明可见能力和 role overlays，但不能创建第二套 workflow、dispatch、context packet、task manipulation tool 或调度状态机；workflow 仍由 scheduler scope 的 `WorkflowRegistry` 和真实工具调用承担。
- 普通 skill import 不得隐式创建、release、选择或覆盖专家团；payload release 只能作为显式 provisioning，把缺失 package 写入项目目录，且禁止自动覆盖已有项目 package。
- 修改专家团加载、投影、catalog、import/export、payload 或 overlay surface 时，必须用 registry / manager / resolver / route / overlay 的真实路径测试验证 active 与 inactive package 隔离，不能只用 prompt 字符串测试证明完成。

---

## 三、代码质量与技术债

**16.** 这是个未发布项目，禁止故意或者无意打补丁兼容旧，留下任何技术债。所有的修复必须同步删除旧代码并测试，保证所有的代码都使用新范式。

**17.** 如果发现死代码、无意义代码、过时代码或废弃逻辑，应先向用户说明并询问是否删除。禁止残留双路逻辑或过渡方案。所有代码都必须保持清晰、简洁、现代化。

**18.** 禁止迁移数据库，直接 reset DB，按新范式重建 DB，遇到历史包袱和技术债一律彻底追查根治。

**19.** 给每个缩写的术语都写一个注释，说明它的全称和含义。例如 WIP、OOB 等等。

---

## 四、修复与调试方法

**20.** 禁止任何"最简单的修复"，禁止任何没有分析的 patch，禁止任何关键字匹配规则逻辑。

**21.** 不要因为是预存的错误就无视，你需要了解代码现状并修复所有错误。除非被明确要求，否则不要使用 bun test 进行无针对性的阻塞性测试。

**22.** 禁止无脑使用 git 回退修改。不要通过粗暴回退破坏未提交代码或掩盖真实问题。

**22.1（reset 事故教训 — 2026-05-26）**：禁止使用 `git reset` 处理代码工作区，尤其禁止在存在未提交 tracked 改动时执行 `git reset --hard`、`git reset --merge`、`git reset --keep` 或 `git reset <tree-ish>`。如果必须恢复特定文件，必须先用 `git status --short` 和 `git diff -- <path>` 证明目标文件没有用户未提交改动，再使用单文件 patch / `git restore --source=<commit> -- <path>` 精确恢复；禁止整仓 reset、禁止用 reset 清理索引或工作树。执行任何会覆盖 tracked 文件内容的 Git 命令前，必须先保存证据（diff 或 stash/commit），否则视为破坏用户代码。

**23.** 如果工具本身异常，先修工具。例如 git、rg、测试命令、运行器不可用时，应主动修复工具链，再继续任务。

**23.1（build 工具链责任 — 2026-06-24）**：build agent 遇到本地可修复的依赖安装、`node_modules`/bin 链接、脚本、端口、测试运行器、browser runner、worktree merge 等前置工具链问题时，禁止用 `report_build_result(status="failed")` 当作逃逸出口，也禁止在原始验收命令尚未进入并通过真实 checker 时用 `merge_back` 发布半验证实现。必须继续执行具体修复并重跑原始验收命令，直到验收进入真实 checker、问题被修复，或剩余阻塞被证明是外部权限/破坏性操作/当前任务无权修复且已列出耗尽证据。

---

## 五、测试与验收

**24.** Opencorvus 自己验收通过后，你仍然必须复核交付物。二次 review 不通过，不算完成。

**25.** 禁止 headless overlay benchmark，视觉有关的 benchmark 必须以视觉呈现。

**26.** 如果你在进行 benchmark，那么你需要同时修复 benchmark 的问题和 opencorvus/overlay 的问题，无人值守进行测试，最终目标是得到完整保真的交付物。每次修复必须 commit 制造痕迹。

**27.** 在 benchmark 过程中，任何 bug 都必须深入调查代码库现状并修复，禁止因为是预存的错误就无视，禁止补丁式修复、糊弄式修复、表象修复。必须确保不会引入新的错误、bug。

**28.** 每次修复都要把正确的行为写成测试用例，确保问题得到验证和防止回归。

**28b.** 如果编排器最终判断当前任务无法交付，必须坦诚承认未达成验收，明确列出未解决的问题、影响到的 requirement / 交付面、已验证过的证据、失败原因分析，以及为什么当前回合未能根治。禁止把失败包装成“基本完成”“仅剩小问题”，禁止省略关键阻塞点，禁止用模糊表述掩盖未解决事实。

**28c（消息流验收教训 — 2026-06-04）**：涉及 orchestrator tool、sub-agent、frontend_research/frontend_design/research 等启动链路的修复，不能只验证 schema、prompt 或 typecheck。必须覆盖真实可观测消息流：启动前准备失败、agent session 未创建或创建后失败、terminal tool 未提交等错误路径，都必须有可见的 tool result / sub-agent yield / session terminal 状态，不能让 UI 只表现为“没有消息卡片”。涉及网页/视觉调查的修复，还必须验证页面证据准备或浏览器/渲染调查确实被触发，不能用静态提示词测试替代运行链路证据。

**28d（mock / E2E 交付边界 — 2026-07-02）**：禁止把 mocked contract test、stubbed tool chain、fixture-only source URL、字符串形式的 screenshot ref、或 canned Visual QA / Integrity result 称为真实 E2E（End-to-End，端到端）网页改造验收、真实视觉验收或 benchmark 通过。真实网页改造验收必须包含实际 URL / source evidence、真实渲染目标、启动页面或可验证 preview target、Playwright / Browser Preview 截图、键盘 / focus 路径、状态覆盖和二次视觉 review；缺任一关键证据时必须按 rule 28b 明确标记未达成，而不能把 orchestrator wiring / schema / prompt 测试包装成完成。

---

## 六、工作流程与协作

### 6.1 自主推进

**29.** 采用无人值守、自我迭代的方式推进。不达到目标或验收指标，就继续重复执行、修复、复测。

**30.** 注意！所有的 Explore/SubAgent 任务优先并行完成，除非用户明确要求你串行执行。你需要同时进行多个任务的探索和修复，以最大化效率和效果。不要等一个任务完成了才开始下一个，除非它们之间有明确的依赖关系。

**30.1（子 Agent 委托边界 — 2026-06-22）**：主 Agent 在用户明确要求“多个独立 agent / 子 agent / 并行审计”时，可以启动一层子 Agent；子 Agent 禁止继续委托、spawn、handoff 或创建下一层 Agent，除非用户明确要求递归式多层分工。委托提示中必须写明“只读/只改指定范围、不得再委托子 Agent”，主 Agent 负责汇总共识，不得把递归委托链伪装成独立审计结论。

### 6.2 与用户协作

**31.** 你的专业知识比用户强，如果问题有确定的最佳答案（正例：主流技术栈/设计模式；反例：代码风格偏好问题），一定要在调查代码库现状和搜索网络资料后帮助用户做决定。

### 6.3 方案落盘与版本管理

**32.** 编写方案必须落盘，实施的时候查看硬盘上的方案。当改动涉及已有设计决策、架构约束或历史方案时，应先查看相关记录再修改。

**32.1（spec / 方案集中落盘单一来源 — 2026-06-29）**：所有 spec、方案、架构记录、调查记录和 benchmark 记录只能落在根目录 `specs/` 的统一结构内：当前架构放 `specs/current/architecture/**`，按月历史记录放 `specs/records/YYYY-MM/**`，任务输入或参考 artifact 放 `specs/artifacts/**`。禁止新增包内 spec 树、临时 spec 目录、平行历史索引或散落在根目录的 spec 文件。

**32.2（pre-June spec 删除规则 — 2026-06-29）**：仓库不保留 2026-06-01 之前日期的 spec 文件。需要引用已删除的六月前记录时，只能写成自然语言事实（例如“deleted pre-June record <name>”），禁止重建空文件、兼容路径、retired ledger 或任何双源索引。

**32.3（Recall 区块 — 2026-06-29）**：任何新落盘方案在实施前必须包含 `Recall` 区块，记录用户原始要求、验收指标、硬约束、已读取的落盘资料、全仓 grep 结果和独立 agent 反馈。上下文压缩后继续任务时，必须先读取该 Recall 区块再改代码或文档。

**32.4（压缩/续跑保真 — 2026-06-29）**：任务要求、验收指标和关键约束不能因上下文压缩、agent 交接或 resume 丢失。续跑时必须显式核对当前目标、已完成项、未完成项和验证命令；发现目标缩水或旧方案与当前硬盘状态冲突时，先更新方案并说明冲突，再继续实施。

**32.5（spec 索引与验证 — 2026-06-29）**：移动、删除、新增 spec 后，必须同步更新 `specs/README.md`、相关子目录 README 和文档健康测试。验证至少包含 `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`；涉及产品 docs 或架构 docs 时，还必须跑对应的 docs 单源与 document-health 测试。

**33.** 必须主动在任何改动前后 commit + push 到 git-cc 远端（当前仓库 remote 名称为 `myhexin`，URL 为 `https://git-cc.myhexin.com:6443/yangheng/opencorvus.git`；`origin` / GitHub push 不能替代 git-cc push；不绕 hook，hook 是质量检查，pre-push 跑 typecheck / api:routes-check / docs:check，失败时修根因再 push，不要传 `--no-verify`），以便追踪历史和回滚。

**33.0（v0.0.1beta commit 前缀 — 2026-07-06）**：当前 `v0.0.1beta` git-cc 交付线后续新提交、尚未推送的本地提交、以及当前提交前可安全 amend 的最新提交，commit subject 必须统一以 `dsw-33987` 开头；禁止使用 `dsw-0000`、临时占位编号或其他未被用户明确指定的 `dsw-*` 编号绕过远端 hook。已提交 / 已推送的历史提交不得仅为了前缀统一而整段改写，除非用户明确要求历史重写并说明上游合并处理方式。

**33.1（非主分支工作收敛 — 2026-06-22）**：如果为了隔离、并行、审计或修复切换到主分支外的分支 / worktree 工作，所有有效修改在该分支提交后，必须在同一轮工作内合并回主分支并切回主分支；主分支是唯一交付和 push 的事实来源。禁止把非主分支上的 commit、未合并 worktree 或远端临时分支当作已交付结果；禁止让同一需求在多个分支上长期并存造成事实分叉。合并前必须先 `fetch` 并确认主分支最新，合并后必须验证、commit/push 主分支；确认为废弃的分支修改不得作为交付物引用。

**33.2（worktree 授权边界 — 2026-06-28）**：未经用户明确授权，禁止创建任何新的 git worktree / 临时 worktree / detached worktree，包括为了隔离 push、规避主工作区脏状态、绕开 hook、审计、验证或制造 clean checkout。所有提交、hook 修复、验证和 push 必须在当前主 worktree 完成；如果主 worktree 的脏状态导致 hook 或 push 失败，必须在主 worktree 追查并修复真实阻塞，或明确报告阻塞，不得创建额外 worktree 规避。

**35.** 方案落盘前必须穷举调用点，禁止凭单点采样泛化。任何方案、设计、修复在落盘前，必须对涉及的 API / 函数 / 错误类 / 路由 / 配置项做一次**全仓 grep**，把所有调用点 / 同名兄弟 / 已存在的命名错误 / 已存在的接口路径列入方案。**遗漏一处即视为 rule 8（禁止双源）违规**。具体要求：

- 修改某个函数语义时：grep 所有调用点，方案表格里逐个列出"此处保留 / 此处删除 / 此处替换"。
- 新增错误类前：grep 已有的同语义命名错误（如 `WorktreeNotGitError`、`InvalidDirectoryError`），优先复用，禁止再造。
- 引用接口路径时：grep 实际路由定义（`*Routes.ts`、`describeRoute`、`.post("/...")`），不得凭印象写路径。
- 提议正则 / 路径校验时：grep 现有的同类规则（如 `windowsPath` 的 mount 集合），复用同一来源；禁止平行实现。
- 重大重构和修改必须二次审查（rule 24 / codex / 用户）发现遗漏时，原方案必须显式标注"codex 审查反馈"并附修订内容，禁止静默重写。

**36.** 任何代码修改必须配单元测试或 e2e 测试，没有测试的修改不算完成。规则同 rule 28，但前者只覆盖"修复"，本条扩展到所有改动（重构、新功能、配置）。具体要求：

- 删除自动行为（如自动 init、自动 fallback）：测试断言"该自动行为不再发生"，而不仅仅是"新行为正确"。
- 添加错误类：测试枚举该错误类的触发条件 + onError 状态码映射 + 前端错误名识别。
- 修改接口契约（query / body / 响应）：测试覆盖正反例 + 与 OpenAPI / SDK 同步性。
- 修改前端 API 客户端规则（如白名单、路径处理）：测试用真实路径表枚举每条路由的注入决策。
- 修改服务端中间件 / 路由装载顺序：测试同时覆盖控制平面（health/event/config）与项目作用域（tasks/path/vcs）路由的差异化行为。

**37.** 所有涉及codex和claude code的需求都需要你自己调用它们来完成，不要让用户来调用。你需要根据需求分析和设计方案，主动使用 codex 或 claude code 来生成代码、修复 bug、编写测试等（最高权限,bypass permissions，no sandbox）。禁止让用户直接调用这些工具来完成任务，因为这会导致不必要的复杂性和错误。

### 6.4 Host / WSL 工作区同步

**38.** Windows host 与 WSL（Windows Subsystem for Linux，用于在 Windows 上运行 Linux 用户态环境）存在两份工作区时，禁止手工复制零散文件。必须使用 `script/sync-host-wsl.ps1` 作为唯一同步入口。

- Windows host 是唯一 git 记录和代码编辑准源。所有代码、文档、测试修改必须先落在 Windows host 工作区；WSL 只作为运行镜像，不允许直接编辑 WSL 文件，也不允许在 WSL 里制造 git 记录。
- 如果 WSL 中出现未同步的新内容，必须先用同步脚本把差异带回 Windows host 进行人工审查和合并；合并完成后再从 Windows host 同步回 WSL。禁止绕过 Windows host 直接把 WSL 作为准源继续开发。
- 同步边界只包含源码、配置、文档、测试和静态资源。构建产物 / 运行产物（例如 `dist-vite`、`dist`、二进制包、缓存目录）不得作为跨端同步对象；WSL 运行所需产物必须在 WSL 内基于已同步源码重新编译生成。
- 默认先执行 dry-run：`powershell -ExecutionPolicy Bypass -File script/sync-host-wsl.ps1 -WslRoot /home/<wsl-user>/myhexin-local/opecorvus`。
- 确认无冲突后再执行：`powershell -ExecutionPolicy Bypass -File script/sync-host-wsl.ps1 -WslRoot /home/<wsl-user>/myhexin-local/opecorvus -Apply`。
- 脚本会在 `.scratch/sync-host-wsl-*` 下保存两边 `HEAD`、changed 列表、diff 和文件备份；禁止绕过备份直接覆盖。
- 两边都改且内容不同、或两边 `HEAD` 不同导致 clean tracked 文件内容不同，默认必须视为冲突并停止；不要猜测哪边更新。
- 冲突只能在人工检查 `conflicts.tsv` 后显式指定方向解决：host 确认为准时使用 `-PreferHostForConflicts`，WSL 确认为准时使用 `-PreferWslForConflicts`。脚本会把这类覆盖写入 `resolved-conflicts.tsv`。
- 同步代码不会让已经启动的 OpenCorvus 进程自动加载新代码。是否重启必须作为独立操作显式确认，不能混在同步步骤里。

### 6.5 OpenCorvus / overlay 运行进程边界

**39（运行进程操作边界 — 2026-06-22）.** 未经用户明确要求，禁止主动重启、关闭、刷新、杀进程、重载、重新打开或以其他方式干预正在运行的 OpenCorvus / overlay / opencorvus-overlay 相关进程和窗口。

- 构建、测试、调试、文件锁、端口占用、WebView 状态异常等场景，都不能被当作默认授权；必须先说明阻塞现象、影响范围和准备采取的具体动作，取得用户明确确认后才能执行。
- 如果用户没有要求刷新或重启 UI，验证应优先使用已有可观测证据、独立测试进程、只读检查、编译产物检查或新开隔离服务，禁止把用户正在使用的 overlay 当作可随意重载的测试对象。
- 已经启动的命令需要收尾时，只允许等待其自然结束或按用户明确要求处理；不得顺手连带关闭、重启或刷新 OpenCorvus / overlay。
- 违反本规则导致用户运行态丢失、窗口关闭、状态刷新或交互中断，必须立即承认并把本规则补充到 `AGENTS.md`，不得用“构建需要”“文件被占用”等理由包装成可接受行为。

**40（停止前禁止删除 — 2026-06-29）.** 禁止在明确停止 / abort / cancel 完成前删除 Mission、Coding Assistant chat 或 task 记录。

- 停止和删除是两个独立操作：停止必须先通过既有后端 settle / terminal evidence 证明真实执行句柄、队列项、tool ownership 和 session prompt 都已沉淀；之后才允许执行删除、归档或清理记录。
- 如果停止失败、超时、缺少 live owner 证据或返回 `TaskCancellationIncompleteError` 等未完成信号，必须保留 Mission、Coding Assistant chat 和 task 记录，并把失败原因暴露给用户；禁止通过提前删除记录掩盖未停止的真实问题。
- 本规则覆盖 UI 行为、server route、orchestrator tool、scheduler cleanup、project delete 级联和 agent 自行收尾。任何“停止前先删记录再补状态”的实现都属于双源 / fallback / gate 违规。

**41（project 术语边界 — 2026-06-30）.** 讨论任务 404、目录归属或 `project_id` 时，必须区分用户可见的项目 / Mission / task 与 DB（Database，数据库）里的存储命名空间 `project_id`。

- 一个目录可以承载多个用户可见项目、Mission、task 和会话；禁止把它误说成“一个目录只能做一个项目”。
- `project_id` 是后端存储、权限和运行时证据的命名空间，不等同于用户语义里的项目数量。
- 如果产品需要同一目录下多个用户可见项目，必须建模为显式用户层实体；禁止通过改写 `.git/opencorvus` marker 或制造同一 worktree 的多个 `project_id` 来冒充用户项目。
- 调试 404 时必须说清楚是“用户项目/任务不存在”，还是“当前请求命中的 `project_id` 命名空间与记录所属命名空间不一致”。

### 6.6 Remote 服务版本更新

**42（remote 服务 baseline 包更新 — 2026-07-03）.** 当用户要求“更新 remote 服务版本 / 打包后上传 / 上传 baseline tgz（tar gzip 压缩包）”时，必须按下面流程执行，禁止反复同步、禁止把 WSL（Windows Subsystem for Linux，用于在 Windows 上运行 Linux 用户态环境）构建产物混入源码同步。

- Windows host 仍然是唯一源码准源。先在 host 工作区确认当前代码状态，再只做一次 host 到 WSL 源码同步：先 dry-run 检查冲突，再 apply 一次。除非 dry-run 明确发现冲突且用户要求改变准源，否则不要循环 dry-run / apply。
- 同步命令使用 `script/sync-host-wsl.ps1`，示例：

```powershell
powershell -ExecutionPolicy Bypass -File script/sync-host-wsl.ps1 -WslRoot /home/<wsl-user>/myhexin-local/opecorvus
powershell -ExecutionPolicy Bypass -File script/sync-host-wsl.ps1 -WslRoot /home/<wsl-user>/myhexin-local/opecorvus -Apply
```

- 如果用户明确说“以当前版本代码为准”，且 dry-run 只显示 WSL 侧临时改动或构建残留，不要把 WSL 当准源；需要覆盖 WSL 冲突时只能显式使用 `-PreferHostForConflicts` 或 `-PreferHostForWslChanges`，并在回复中说明覆盖依据。
- 打包必须在 WSL 内执行，不能在 Windows host 直接跑 Linux 包构建：

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /home/<wsl-user>/myhexin-local/opecorvus && bun run package:linux-binary'
```

- baseline 上传包的准路径是 WSL 内 `packages/opencorvus/dist/binary/opencorvus-linux-x64-baseline/opencorvus-bundle.tar.gz`。普通 x64 包路径是 `packages/opencorvus/dist/binary/opencorvus-linux-x64/opencorvus-bundle.tar.gz`，不要把两者混淆；remote 服务默认上传 baseline 包。
- 打包后至少验证 baseline 可执行文件版本和 archive 可读性：

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /home/<wsl-user>/myhexin-local/opecorvus && packages/opencorvus/dist/binary/opencorvus-linux-x64-baseline/opencorvus --version && tar -tzf packages/opencorvus/dist/binary/opencorvus-linux-x64-baseline/opencorvus-bundle.tar.gz >/dev/null'
```

- 复制回 Windows 只复制最终 archive，不再跑源码同步，也不要复制整个 `dist/`。示例：

```powershell
New-Item -ItemType Directory -Force -Path packages\opencorvus\dist\binary\opencorvus-linux-x64-baseline | Out-Null
Copy-Item -LiteralPath "\\wsl.localhost\Ubuntu-24.04\home\<wsl-user>\myhexin-local\opecorvus\packages\opencorvus\dist\binary\opencorvus-linux-x64-baseline\opencorvus-bundle.tar.gz" -Destination "packages\opencorvus\dist\binary\opencorvus-linux-x64-baseline\opencorvus-bundle.tar.gz" -Force
```

- 上传 remote 服务使用 `POST http://mirror.myhexin.com/opencorvus-admin/upload`，multipart form 字段名必须是 `file`，文件类型使用 `application/gzip`。PowerShell 中必须调用 `curl.exe`，避免落到 `Invoke-WebRequest` alias：

```powershell
curl.exe -fS -X POST -F "file=@C:\Users\chuan\myhexin-local\opecorvus\packages\opencorvus\dist\binary\opencorvus-linux-x64-baseline\opencorvus-bundle.tar.gz;type=application/gzip" http://mirror.myhexin.com/opencorvus-admin/upload
```

- 如果用户要求 Postman / Newman 验证，可以使用同样的 multipart 字段生成临时 collection，再运行 `newman run`。成功标准是 HTTP 200，响应 JSON 包含 `status: "success"`，并且 `service_restarted` 与 `service_running` 为 `true`；如果响应缺少这些字段，必须报告实际响应，不得宣称 remote 已更新成功。
- 回复用户时必须列出：一次同步报告目录、WSL 打包命令结果、baseline archive 的 Windows 路径、上传 HTTP 状态和响应摘要。若上传成功但没有可用的 remote health / version 查询接口，只能说“上传接口返回已重启并运行”，不能编造远端版本已验证。

---

## 七、元规则

**34.** 如果你被用户纠正行为，并且属于习惯性/原则性等非具体代码问题的教训时，则应该更新此规则库。
