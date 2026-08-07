# 专家团自进化架构方案

状态：实施中。2026-08-06 完成三路独立只读审查并达成一致；2026-08-06
根据用户对触发、版本保留、评分和静默升级的追问，重新完成全仓影响面审查并用中文重写。
2026-08-06 用户授权拉取最新代码、创建独立 worktree、按 milestone 实现并由独立 Agent 审查；
本文中的“已实现”状态只在对应 milestone 通过测试与独立复核后更新。

术语约定：ID 是 Identifier（标识符）；LLM 是 Large Language Model（大语言模型）；V1 是
Version 1（第一阶段版本）；P0–P6 是 Phase 0–6（实施阶段 0–6）。其余缩写在首次出现处给出全称。

## Recall

### 用户原始要求

真正执行工作的主体是专家团，因此自进化只优化完整、自包含的专家团，不让优化器进入目标专家团，
不破坏 OpenCorvus 核心 loop。需要调查主流商业与开源工程方案，排除学术型方案；需要多个独立
Agent 反复审查直到达成共识；随后继续回答自进化的触发、执行后 trace（执行轨迹）、快照、评分、
版本长期保留、静默升级和历史版本选择问题，并复核影响面是否调查完整。

### 实施 Goal Recall

- Goal：在独立 worktree 中完成 P0–P6，实现专家团自进化的版本固定、原子安装、证据、评测、
  `evolution-lab` package、benchmark 和只读操作面，最终合并回 `v0.0.33beta` 并推送 `myhexin`。
- 用户随后把最终收敛顺序明确为：先合入 `v0.0.33beta`，再合入 `v0.0.34beta`。本地 `0.33`
  合并提交为 `377d7587a9`，本地 `0.34` 合并提交为 `dcb6a90e04`；`0.34` 合并后重新通过全仓
  8/8 typecheck、29 个聚焦非 UI 测试文件、API route inventory、双语 API docs 与 overlay i18n 检查。
  两个分支的 push 均被 git-cc Stargate 在 receive-pack 阶段返回的 HTTP 200 `application/json`
  非 Git pkt-line 响应阻塞；固定长度、HTTP/1.1、chunked 和缩小到 `7edf52b1e1` 的快进推送结果一致，
  远端 refs 仍分别停在 `4e603b7a70` 与 `4c168c9c9e`。在远端实际接收前不得称为已推送交付。
- 输入：当前 `v0.0.33beta` 源码、本文冻结的架构与验收指标、显式选择的目标 Expert Squad、
  Dataset、Scorer、模型/环境/configuration/permission snapshot 和用户预算。
- 输出：不可变 package revision 与 Task binding、八类 `evolution-lab/...` Artifact、可复核 comparison、
  显式 promotion/restoration receipt，以及真实 UI 人工验收证据。
- worktree：`C:\Users\chuan\myhexin-local\opecorvus-expert-squad-evolution`；分支：
  `codex/expert-squad-self-evolution`；生成基线提交：`41fe717b4a`；P0 提交：`52b5a54ae7`；
  P1 提交：`c3188c8077`；P2 提交：`778de1e556`；P3 提交：`9774952e3a`；P4 提交序列：
  `cd2a3256e9`、`14cc8389e3`、`739482788e`、`1953927362`、`6b863ae9a0`、`004ff01f23`。
- 环境：复用仓库声明的 Bun/Node 工具链和项目测试入口；外部服务只使用显式 benchmark tenant、endpoint
  和 credential source，不读取或复制生产 secret。
- 超时：runner、scorer 和 benchmark 只按最后真实活动 cursor 计算 inactivity timeout；不使用从启动时刻
  机械倒计时的 hard timeout。
- milestone：P0 Task revision → P1 Manager CAS → P2 Artifact/evidence → P3 scorer runtime →
  P4 `evolution-lab` → P5 benchmark → P6 UI。每一阶段先跑聚焦非 UI 正向契约，再由独立 Agent 只读审查；
  审查问题修复并复测后才能提交该 milestone。
- UI 验收：P6 只使用真实应用、真实交互、截图和人工复核；禁止新增、修改或运行 UI 自动化测试。
- 当前同步事实：`git pull --ff-only myhexin v0.0.33beta` 返回 `Already up to date`；主工作区在创建
  worktree 前为 clean。远端此前曾在 push 阶段返回 Git 协议错误，因此最终 push 必须再次验证，不能把
  本地提交称为远端交付。
- P5b 继续实施基线为提交 `8146b66d3b`；其后的 Task 进程权限、Engine Git、evidence、comparison 与
  promotion/restoration 修改仍未提交，只有三路独立复审达成一致且串行非 UI 契约全部通过后才能形成 milestone
  提交。当时冻结的下一次真实 benchmark run 为 `prism-development-20260807-08`；该 run 后续已形成下文记录的不可变失败，
  当前 next-run identity 以本 Recall 后部的 `-09` 事实为准。
- 工具链基线：新 worktree 先以 `bun install --frozen-lockfile` 安装现有依赖，再运行 JavaScript SDK
  官方 build。build 暴露跟踪的 `sdk.gen.ts` 缺少当前 CommitMessage stream 契约已有的 `sessionID`；
  这是基线生成漂移，保留生成器的精确正向输出并在进入 P0 前单独提交。
- 用户在 P0 实施中明确确认删除既有 Task 运行期 `select_expert_squad`、`expert_squad_selector` 和
  profile-change continuation，不保留兼容入口。所有 Task 从创建事务开始绑定唯一 profile 与精确 package
  revision；选错时创建新 Task。
- P0 独立调查结论：creation binding 必须是 Core typed Artifact；新 Task 在 install lock 内解析 revision 并执行
  expected-digest Compare-And-Swap（比较并交换）；request replay 必须先比较已提交绑定，不能重新读取 live
  catalog；first/resume wake、Session overlay、workflow binding、uninstall reference 检查都只承认 creation
  binding。旧数据库中缺少该 binding 的 Task 按 typed error fail closed，不做 migration 或 live fallback。
- P0 首轮独立终审未批准并发现两项 P1：测试在逐 case 重复全局 runtime/database disposal 后污染下一次
  Windows Git process；request/channel conflict、restart/resume、uninstall ownership 与 Panel surface 的正向契约
  覆盖不足。根因修复为：共享 `memoryProject` fixture 删除 `spawnSync` 启动时硬超时，统一复用 activity-based
  Git runner；该 suite 只在全部 case 结束后执行一次全局 reset，各显式 Project disposal 后证明 supervisor
  live process 为零。契约新增 request/channel 异 profile/异 digest typed conflict、Project runtime dispose/reopen
  后固定 scheduler/worker revision、uninstall reference ownership、Task/List、workflow、CreateTaskInput 与 Mission
  Panel surface。禁止用重跑成功掩盖原失败。
- P0 payload 审查发现 repository selector 已更新但 bundled payload、portable template generator 与根
  `AGENTS.md` 仍保留旧运行期 selector 协议；已修改生成源、重生成 artifact/payload，并以全仓 grep 证明
  `select_expert_squad`、`expert_squad_selector`、`expertSquadSelection` 和 `profile_change` 在当前生产/模板/文档
  树零命中。
- P1 独立预审结论：所有 package 发布必须收敛到 manifest-ID 跨进程锁内的单一 primitive；锁内重新读取
  exact scope 当前 digest，再执行 Compare-And-Swap；同字节 create 重试返回 `unchanged`，不同字节 create
  或 stale expected digest 返回 typed conflict；update、import、payload install 与 exact snapshot restoration
  不得保留无 CAS 的 replace 路径。成功回执固定记录 before/after 完整 revision；发布后先 invalidation 再删除
  backup，失败恢复后再次 invalidation。
- P5 真实失败证据永久保留：`prism-development-20260806-01` 证明 Evolution Lab payload 缺失；`-02` 证明
  LSP warm-up cleanup 不 settle；`-03` 证明 Host Bash 可读取 campaign 外路径；
  `prism-development-20260807-04` 在 server readiness 前退出，并暴露 launcher 丢失 controller 原始输出、随后
  对已被 systemd CollectMode 回收的 unit 再执行 stop 的二次诊断污染；`prism-development-20260807-05`
  通过完整 controller 输出证明单文件 `server_binary` 缺失 packaged runtime closure；
  `prism-development-20260807-06` 证明 systemd transient service 未继承 client arbitrary environment，导致隔离配置与
  provider credential 均不可见；`prism-development-20260807-07` 启动完整 runtime、安装 Evolution Lab 与 Prism
  后，在 catalog Project 初始化的 `ensureGitignore` 暴露 Host Git 仍会被 ambient Capsule descriptor 错判成 Task
  进程。七次 run 都未删除或复用；这一阶段随后固定使用 `prism-development-20260807-08`，其最终结果见下文。
- P5 执行边界已改成 Host control plane + per-Task rootless OCI；曾尝试的 outer pivot-root 方案因 Windows
  drvfs path/UID 映射不成立而删除，不保留双路。当前冻结 toolchain 为
  `ubuntu-24.04-node-bun-browser-v10`，真实 A/B 同端口网络隔离与 Playwright/Chromium sidecar 已通过。
- P5 独立审查先后发现并根治：错误 `/srv` target import、controller scope MainPID 残留、launcher 只杀
  `systemd-run` client、Package Tool Host import/execute、raw browser fetch/write、MCP persistent connection、
  file broker symlink race、descriptor cache 绕过和 Package Tool introspect 无限等待。当前 launch envelope
  已能保存 controller 原始输出、验证完整 runtime closure 并以 declared-name exact environment 启动；P5/P6
  均尚未宣称通过。
- P5b 当前未提交实现把所有进程 owner 收敛为显式 Host 或由完整 Task→Session→Project lineage 解析的 Task
  authority；Task 创建提交不可变 native/capsule binding，Session shell/loop、Formatter、LSP（Language Server
  Protocol，语言服务器协议）、Browser、MCP、OfficeCLI 和 package tools 不再从 ambient descriptor 或 cwd 猜测。
  Engine Git 使用独立 closed environment、原始 blob bytes、临时 index、commit-tree 与 update-ref Compare-And-Swap；
  terminal Task 先完成结果 checkpoint，再提交 terminal lifecycle；run evidence 固定 process binding、baseline/result
  commit/tree 与每个 repository authority。Evolution owner 收集 Trial 证据时从 source Task 的 Project/root 读取，
  不把当前 Evolution Project 当作 Trial workspace。
- P5b 三路首审均为 `BLOCK` 并已逐项处理：完整 lineage 缺失不再降级 Host；baseline 保存完整 repository
  authority 且结果期不得重发现；Browser handle 与 checkpoint writer reservation 必须释放；Git status/diff/filter
  路径已从 Engine checkpoint 删除；Capsule Git admin 必须位于 writable Task root 外；通用 `util/git.ts` 的任意
  Engine Git argv 出口已删除并替换为 Engine 私有命名对象操作；Office 正向契约现执行默认 runner 与
  `Process.runTask`，只在最终操作系统命令边界注入测试进程。聚焦 Engine Git 与 process-authority 测试分别为
  1 pass / 7 assertions、1 pass / 5 assertions；仍需三路独立复审和全套串行非 UI 验证，不能提前宣称 P5b 通过。
- P5b 第二轮三路独立审查仍为 `BLOCK`：architecture 指出 deployment mode、Task/Project/root/time binding、
  ambient descriptor、terminal evidence 与 reopen checkpoint 不闭合；Capsule 审查指出 LSP 裸 spawn 和双 checkpoint
  夹住启动登记的等待环；candidate/promotion 审查指出 Trial workspace baseline、Campaign workspace resource、
  comparison 自报统计与 package tool 自报 Manager receipt。修复后 native/capsule mode 是显式部署事实，Task 创建事务
  精确复核 binding，所有 package file/fetch/external/browser/LSP surface 读取 persisted binding；LSP 的 Host 与 Task
  client/process authority 分区，废弃 `lsp/shared.ts` 已按用户既有删除授权移除。进程读租约获取与 spawn registration
  原子绑定，checkpoint reserve 后只等待已获读权启动完成，再终止 live process 并取得 writer；双 checkpoint 正向契约为
  1 pass / 6 assertions。
- Trial 首次执行前的 exact workspace tree 必须等于 Task creation process binding；Campaign 的 workspace digest 由不可变
  `opencorvus/workspace-tree@1` resource 重算，不能由 caller 单独声明。terminal evidence 只读已持久化 terminal checkpoint，
  inactive/awaiting 只记录 live observation；reopen 后再次 terminal 形成新的 result occurrence 并保留 `result_history`，
  不复用旧 singleton result。
- `comparison-recommendation` 发布器现在读取唯一 Campaign、Candidate 和全部直接 source 的 run/evaluation Artifact，按
  case × arm × repetition × scorer 重建冻结矩阵并确定性重算 paired delta、95% confidence interval（置信区间）、
  win/tie/loss（胜/平/负）、cost、token、activity duration、outcome rate、归一化 aggregate 和 recommendation。缺失 slot
  产生精确 required unavailable dimension 并强制 `inconclusive`；完整双臂正向矩阵测试与 package evidence suite
  分别为 1 pass / 1 assertion、6 pass / 54 assertions。
- promotion/restoration 已从 package publisher 移出：Evolution Lab package tool 的输入枚举不再包含
  `promotion-receipt`。唯一写入口是 Host-owned evolution mutation service，它验证 operation Task/Project/Session、
  Evolution Lab producer、唯一 Campaign/Candidate/Comparison、完整 promote recommendation 与逐字节相等的真实可见用户
  Message；随后 Manager 从 Registry 不可变 snapshot 执行 expected-current Compare-And-Swap，并在 install lock 与可恢复
  backup 仍有效时由 Core producer 写确定性 receipt。相同授权幂等返回相同 locator；restoration 只能精确撤销所选 prior
  receipt。promotion → 旧 Task 保持 A → 新 Resolver 读取 B → restoration 回 A 的正向契约为 1 pass / 4 assertions；
  Manager 原有 CAS/rollback/scope 契约仍为 1 pass / 30 assertions。
- P5b 第三轮三路审查仍为 `BLOCK`，新增确定性问题为：Comparison 允许 caller 自报 unknown/视觉/奖励投机结论，
  metric receipt 未闭合到同一 run locator；授权只拼接部分 text part；包替换在 target rename 与 Core receipt 之间存在进程
  崩溃窗口；LSP 最终 spawn 会从 ambient Session 二次推导 Task；Host Ripgrep 会读取 ambient Capsule descriptor；Manager
  restoration callback 可省略；正向契约没有创建真正的新 Task B。当前修复将 qualitative review 从全部独立 integrity review
  与冻结 visual scorer 结果确定性派生，拒绝额外 Artifact 类型、额外 slot、错 scorer、错 Task、错 Campaign/Candidate/run locator
  和非 Evolution Lab producer；授权要求真实用户 Message 只含一个精确 visible user text part。
- Manager 在改名之前持久化 `opencorvus/expert-squad-evolution-mutation-intent@1`，记录 exact target/staging/backup、A/B
  digest 和确定性 receipt identity；同 manifest-ID 下一次操作先在安装锁内以 Core receipt 为唯一提交事实收敛：无 receipt 恢复 A，
  有 receipt 验证 B 并清理，未知或损坏布局失败关闭。restoration 与 promotion 都要求 durable receipt callback 且 Manager 回读确认
  receipt 已提交；提交后 cleanup 失败返回已提交 mutation 并保留 journal 供下一次严格清理，不再把真实成功报告为 mutation 失败。
  测试在 target 已切到 B、receipt 尚未写入的位置注入 abrupt termination，随后以同一请求从 journal 恢复并成功晋升。
- LSP Task ID 现在由 `getClients` 的显式 authority 同时捕获到 capability probe 与 stdio spawn，Host/Task client pool 分离；
  checkpoint 正向测试执行真实 Language Server Protocol initialize，确认两个 owner 各有 client 且只回收 Task process。Host Ripgrep
  在存在 Capsule descriptor 时使用 Host runtime 并得到精确文件清单。promotion 正向契约创建真实 Engine Task 并验证 creation binding 为 B，
  同时旧 Task 保持 A。最新聚焦结果：comparison 1 pass / 1 assertion，package evidence 6 pass / 54 assertions，evolution mutation
  1 pass / 6 assertions，Manager 1 pass / 30 assertions，LSP 3 pass / 7 assertions，Host control plane 1 pass / 1 assertion；
  `packages/opencorvus` TypeScript typecheck 通过。
- P5b 第四至第六轮独立复审继续找到并根治 durable receipt 首次读取异常、精确 producer/evidence closure、Task
  创建与 journal 恢复之间的锁外竞态。最终锁协议由 `ExpertSquadInstallLock` 在同一 manifest ID 的跨进程锁内签发
  不可伪造、不可跨 ID、释放后失效的 active lease；Task 创建与 uninstall 都严格按“取得 exact-ID lease → lease 内
  收敛 project/global exact-ID journal → 禁用自动收敛地解析唯一 revision → 提交绑定/删除”执行。并发 mutation 必须取得
  同一 ID 锁，因此不存在预收敛后、读取前插入 B 的空窗，也没有伪重入或跨 scope 双源。
- 三名独立 Reviewer 最终全部 `APPROVE`：architecture boundary 确认 journal/lease/Task binding 原子边界；
  candidate/promotion 确认 Comparison、授权、Core receipt、真实新 Task B 与手工 package-management 边界；Capsule boundary
  确认 Host Ripgrep、LSP stdio/probe、client pool 与 checkpoint 没有 Task→Host 或 ambient Capsule 旁路。
- 2026-08-07 最终 P5b 串行非 UI 契约使用每个文件独立 Bun 进程和真实无活动超时执行，13 个文件共
  29 pass / 0 fail / 234 assertions；同一 Bun 进程组合运行会命中测试进程全局 Task wake runtime 重复配置，因此不作为
  Windows 验收方式。内嵌 payload 已从 Git index 的完整 authoring package 重生，Evolution Lab 完整投影为
  1 pass / 37 assertions；package TypeScript typecheck 与 `git diff --check` 通过。P5b 已满足提交前代码与独立审查验收，
  当时仍需提交后执行 `prism-development-20260807-08` 与 P6 真实页面人工视觉验收；两者的后续事实和当前剩余项见下文。
- `prism-development-20260807-08` 前三次严格预检均在创建 run 目录前失败并永久保留原始日志：第一次从
  Windows 启动被 Linux identity 拒绝，第二次暴露 benchmark controller 仍调用已删除的旧 supervisor，第三次
  暴露 toolchain launch 摘要仍采用 `9bf58ee8aa` 之前的递归 locale 顺序。逐文件 SHA-256 比较证明共享 toolchain
  与 `-07` 冻结副本字节完全相等；当前唯一 `workspaceTreeDigest` 的扁平 code-point 顺序摘要为
  `a69daa5aed66c6d77fee87d1656064f3d96a9962572e3e5b3dba9dbe889ebe11`。`-08` launch 已修正为该摘要并以
  WSL Linux Host 重新启动，失败日志不删除、不覆盖。
- P6 实施前再次读取本 Recall、`04-extensions.md`、Expert Squad skill/checklist，并调查 plugin、Evolution Lab
  私有 Artifact codec、Engine Artifact current/history partition、mutation authorization、server route、SDK 与
  ExpertSquadPanel。结论是完整八类 Evolution Artifact ABI 必须先从 package 私有目录提升为 plugin 公共单一来源；
  package 只重导出 ABI 并保留 package-owned runtime errors。项目历史由 Core 对当前 Project 的 current/history
  Artifact 分区派生，global target 也只显示当前 Project 产生的历史；禁止 Overlay 扫 Task、持久化 rank/best/current
  或复制 confirmation 文本。独立 Agent 正在只读复核历史 DTO 与真实可见用户授权消息边界，实施后仍需终审。
- 提交后 Linux 发布构建发现 Browser MCP（Model Context Protocol，模型上下文协议）Node sidecar 入口通过
  `BrowserMCP` 静态追入 Host-only launcher，导致 Node target bundler 继续追入服务端 Bun runtime。根治删除 sidecar
  namespace 上无人使用的 Host 配置转发，配置与 process resolution 仍由 `BrowserMCPBuiltin` 单一拥有；新增正向 Node
  bundle 契约为 1 pass / 3 assertions。完整 Linux executable 与 14,431-file runtime payload 随后构建成功；固定
  OfficeCLI asset 与 license 从 `-07` 已发布 runtime 重建唯一 build cache，并逐一验证等于 lock file SHA-256，未跳过
  download identity、license、runtime dependency closure 或 executable validation。
- `-08` 首次 Linux preflight 在零 run-directory mutation 时暴露 benchmark controller/attestation 仍调用已删除的
  authority-less `ProcessSupervisor.spawnCommand`。全仓受影响的 evolution launcher 与 runtime-memory-soak Host controller
  调用已统一迁移到 `spawnHostCommand`，零剩余旧调用；production runtime attestation 的真实 Host command 正向契约为
  1 pass / 1 assertion，launcher 聚焦套件为 7 pass / 12 assertions。Windows 误启动与 Linux preflight 失败日志均保留，
  正式 `-08` 目录尚未创建，因此后续启动仍是同一唯一 run 的首次持久化尝试。
- P6 首轮实现已把八类 Evolution Artifact Application Binary Interface（ABI，应用二进制接口）提升到 plugin 单一来源，
  增加 Core history/detail、authorization/mutation route、生成的 OpenAPI/SDK，以及 Overlay 历史与显式晋升/恢复骨架；
  plugin、Core、Overlay、SDK typecheck、route inventory 和聚焦非 UI 正向契约均通过。测试期曾把 `purpose` 错加到一个
  evidence projection 的期望顶层，已确认是测试期望形状错误并修正，完整 evidence 套件随后为 6 pass / 54 assertions。
- P6 独立终审尚未达成共识，因此 P6 不得验收。candidate/promotion Reviewer 给出七项 BLOCK：global detail 必须先验证
  当前 Project Task authority；current/history union 与 exact payload 必须位于同一 SQLite read transaction；history 必须以
  Campaign 为根并显示未完成图和 typed integrity issue；Overlay 必须消费 cursor 并完整展示 comparison/cost/unavailable/
  receipt；动态 i18n key 导致 `check:i18n` 真实失败；真实页面视觉验收尚未执行；`UserDomainAction` 被判定为只给 UI、
  不进入统一 LLM turn 的第二消息协议，违反真实单一路对话。architecture boundary Reviewer 对 ACP structural overload 复审
  `APPROVE`，但该结论没有消除 rule 15 的更高层冲突；存在审查争议即不算共识，实施必须删除 domain-action 分叉并绑定
  普通真实用户 Turn，随后重新独立复审。
- 2026-08-07 13:21 再查 `prism-development-20260807-08`：唯一进程仍在运行，最新 exact engine Artifact activity 为
  `1786080116048`，真实 inactivity deadline 已顺延至 `1786080716048`。因此它不是已证明的死锁，禁止机械计时误杀；
  必须等待 terminal result 或真实无活动监督器给出失败，再保留全量原始输出交给独立 Reviewer。
- `prism-development-20260807-08` 现已形成不可变失败 `result.json`，不得 resume、覆盖或删除。独立 Capsule Reviewer
  还原出的首个坏转移不是最终 `running`，而是 Task creation binding 对整个 Campaign Project root 摘要，随后 Host 合法写入
  `.opencorvus/.r/**` 被错误计入 Task source，首次 Engine Git prepare 因此记录 immutable workspace mismatch；Task lifecycle
  仍继续 Orchestrator dispatch。两次真实 OCI（Open Container Initiative，开放容器倡议）worker unit 接受后立即退出，但
  launcher 未保存 systemd exit status/journal，精确原因仍为 unknown；Read Tool 又把 typed capsule unavailable 折叠成
  `File not found`。Mission 与 Task 最终均按旧 Wait Tool 提示安排 20 分钟 wake，晚于 10 分钟 inactivity budget。
  supervisor 还在 deadline 前约 0.6 秒导出，未再次验证真实 `Date.now >= deadline`。根治项固定为：统一复用
  `ProjectRuntimePaths` 的 canonical source enumeration；immutable creation mismatch 形成可见 terminal infrastructure outcome；
  Read Tool 只映射真实 ENOENT；OCI 保存 unit terminal diagnostics；Wait 提示从 concrete event/inactivity deadline 推导时长；
  supervisor 循环复核 deadline 并输出 typed benchmark outcome；已有 result 的 run 在启动 server 前 typed fail-fast。
- P6 当前修复已删除 `UserDomainAction`/`purpose` 第二消息分叉，授权通过现有 `EngineService.handleTaskMessage` 写普通
  Task-root User Turn 并唤醒 Orchestrator；history 在一个 Project-scoped SQLite transaction 内以 Campaign 为根投影 current/
  historical exact graph，显示 Campaign-only、Candidate-in-progress、完整 comparison/receipt、typed authority/integrity facts 和
  frozen cursor；Overlay 消费分页并展示完整事实。聚焦 mutation/history 正向契约为 1 pass / 18 assertions，plugin/Core/
  Overlay/SDK typecheck、route inventory 与 i18n 检查通过，第二轮独立复审和真实页面人工验收仍未完成。
- `prism-development-20260807-08` 的根因修复已完成三路独立终审并全部 `APPROVE`：canonical source digest 排除
  Host-owned `.opencorvus/.r/**`；immutable mismatch 在同一 winning transaction 内提交 typed infrastructure Artifact、
  `task.infrastructure.failed` 与 `task.failed`；OCI unit 保存 `systemctl show/status` 与 journal 后再 stop/reset；Read 保留 typed
  capsule error；Wait 和 supervisor 均按真实 activity cursor 与 deadline 复核；Host projected Skill 只使用 Host authority。
  `-08` 的 `result.json` 及原始证据永久保留，下一次真实 benchmark run 固定为
  `prism-development-20260807-09`，禁止 resume、覆盖、复用或删除 `-08`。新 launch configuration 必须显式声明
  `evidence_scheduling_margin_ms`；当前 600,000 毫秒 inactivity window 对应 60,000 毫秒 scheduling margin，且 margin 必须
  严格小于 inactivity window。
- P6 第二轮三路独立终审全部 `APPROVE`。真实 UI 验收使用隔离数据库、真实 OpenCorvus 页面与原生 Browser：空历史态、
  Campaign-only 非空态、冻结 comparison context、baseline/dataset/budget 详情和 Refresh 均已人工复核；发现详情页签截断与
  双栏过窄后，收敛为单栏历史布局和同排紧凑页签，并重新构建、交互、截图、亲自复看。最终证据为
  `expert-squad-evolution-history-empty-20260807.jpg` 与
  `expert-squad-evolution-history-nonempty-final-20260807.jpg`。P6 仍需全量非 UI 契约、typecheck、文档健康与新 `-09`
  benchmark 通过后才能形成最终 milestone 提交。
- UI 后宽回归发现 OCI 正常 teardown 用 KILL 结束 `runc run` 时返回 137，旧 unit contract 把预期停止记成 failed；仅用
  `SuccessExitStatus=137` 又会把运行期异常 137 伪装成 clean inactive 并允许同 Task 自动重建。最终边界使用 systemd
  `RemainAfterExit=yes` 保留非 stop 的 `active/exited` terminal facts，只有 `active/running + MainPID > 0` 且 runc state 为
  running 才可复用。首次 terminal properties/status 通过 `Filesystem.writeAtomicIfAbsent` 原子发布到 Host-only、按
  controller + Task 物理身份分区的 immutable evidence；后续调用先幂等完成被中断的 stop/reset cleanup，再复现同一 typed
  failure，禁止第二 container occurrence、覆盖或删除证据。真实 WSL 契约覆盖正常隔离、unexpected 137、persist 后 crash
  recovery、controller BindsTo 和 systemd lifecycle；恢复场景证明 evidence bytes 不变、unit inactive/dead、runc inventory
  归零。最终 Capsule Reviewer 已 `APPROVE`；审查者独立复跑为 6 pass / 0 fail / 8 assertions，
  并确认原子 terminal evidence、中断后幂等 cleanup、同一 typed failure 重放、证据字节不变与零额外 container occurrence。
  因此本边界已满足提交与启动 `-09` 的独立审查前置。
- `prism-development-20260807-09` 通过全部只读 preflight 并完成不可变 runtime/toolchain/package
  副本持久化后，在 server 与 controller 启动前因直接 `wsl --exec bun` 进程未继承 login shell
  中的 `DEEPSEEK_API_KEY` 而失败。该 run 没有 checkpoint、controller unit 或 trial 消耗，但目录已存在，
  因此必须作为不可变失败证据保留，禁止 resume、覆盖、复用或删除。下一次唯一 run identity 固定为
  `prism-development-20260807-10`，使用同一 WSL login shell 加载凭据后再启动 launcher，不改变已冻结
  dataset、scorer、model、budget、permission 或 18 个 trial slot。
- `prism-development-20260807-10` 通过凭据继承、server readiness 与 Core payload install，随后在
  launcher 校验“已安装 Evolution Lab digest 等于 launch 冻结 digest”时 typed fail closed：`-10` 仍指向
  `evolution-lab-39b86a548f`，而新 runtime 内嵌的是当前 `76e9318e79` 交付包。该 run 没有进入 Mission
  或 trial，但已形成唯一目录和 server log，因此同样永久保留，禁止 resume、覆盖、复用或删除。
  已从当前 Git-index 交付包创建新的不可变快照 `evolution-lab-76e9318e79`，源与快照的唯一
  package digest 均为 `2479c16840909db8dec95e84f6f5714c3d2f8ea5089bdd81a5b25dff86cd56a5`。下一次唯一
  run identity 固定为 `prism-development-20260807-11`，除 run/mission ID 与 Evolution Lab 冻结快照外，
  launch envelope 不变。
- `prism-development-20260807-11` 通过 runtime、toolchain、当前 Evolution Lab、Prism、provider discovery、
  Mission 创建与 controller lifecycle，但 DeepSeek 返回 HTTP 401 `authentication_error`。因此 Mission 在真实
  600,000 毫秒无活动窗口后导出不可变 `result.json`：`inactive/inactivity_timeout`，0 Task，
  0 Artifact；监督器在 deadline 后 6 毫秒再次确认时钟后才导出，证明 inactivity 修复本身有效，
  但该 run 不得冒充业务 benchmark 通过。只读 credential health 检查进一步证明：当前
  `DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`ALIBABA_CODING_PLAN_API_KEY`、`CODING_DASHSCOPE_API_KEY` 与
  `MOONSHOT_API_KEY` 均被各自 provider 拒绝为 HTTP 401；Hexin 生产网络路径在保持 TLS/SNI
  与固定内网地址的正式 transport 上返回 `ECONNREFUSED`。禁止使用 mock、伪模型、未声明代理或
  旧 key fallback 冒充通过。获得一个可用且明确声明的 provider credential 后，下一次唯一 run identity
  必须使用 `prism-development-20260807-12`，同时冻结新 model/runtime-config/credential-source 事实，
  其余 dataset、scorer、budget、permission 和 18 个 trial slot 不变。

### 本次审查验收

- 不把既有方案当成正确答案，重新核对真实代码调用点。
- 明确回答“什么触发进化、触发后发生什么、是否每次执行都评分、是否静默升级、下次是否按 rank
  （排名）选择版本”。
- 覆盖身份、安装、Task 创建与续跑、Mission、Registry、Manager、Resolver、Artifact、Metric、
  配置、密钥、权限、Model Context Protocol（MCP，模型上下文协议）、外部副作用、版本、并发、
  取消恢复、数据保留、Application Programming Interface（API，应用程序编程接口）、Software
  Development Kit（SDK，软件开发工具包）、Overlay、运维、成本和测试。
- 区分已具备能力、必须先修的架构缺口、V1 可直接实施面、后续里程碑和明确禁止项。
- 方案中的每个运行时 owner 只有一个事实来源，不增加 fallback（兜底）、第二 active 字段、host
  状态机、自动 score gate（分数门控）或静默生产升级。

### 硬约束

- `prompt_profile.active` 是唯一专家团逻辑选择源。
- `PromptProfileResolver` 是唯一运行时完整投影源。
- `ExpertSquadRegistry` 是 manifest、资源闭包、SHA-256（安全哈希算法 256 位）摘要与不可变 package
  snapshot（包快照）的唯一校验源。
- `ExpertSquadPackageManager` 是 project/global 安装、替换、恢复和删除的唯一写入源。
- Mission 与 Orchestrator 只通过真实消息和工具调用自然协调普通 Task，不新增固定 pipeline、自动重试、
  自动流转或 campaign 生命周期状态机。
- 候选始终是完整自包含 package revision（包修订），不是 prompt patch、overlay 或运行时继承。
- 所有超时都按最后一次真实活动计算 inactivity timeout（无活动超时），不能从进程启动机械计时。
- User Interface（UI，用户界面）质量只能通过真实页面、真实交互、截图和人工复核验收，禁止新增、
  修改或运行 UI 自动化测试。
- 测量失败必须保留为 typed unavailable（有类型的不可测事实），不能变成零分、旧分、替代 scorer
  （评分器）结果或重试指令。
- 生产晋升和恢复必须有用户的显式授权；不允许自动晋升、静默回滚或运行时 fallback。

### 已读取的落盘资料

- 根目录 `AGENTS.md`。
- `specs/current/architecture/01-agents.md`、`02-data.md`、`04-extensions.md`、
  `15-agent-facts-and-turns.md`、`17-code-work-agent-platform.md`、`99-principles.md`。
- 2026-07-29 Harness foundation 与 Work/Chat/Mission convergence 记录。
- 2026-08-01 Expert Squad project-over-global resolution 记录。
- 2026-08-03 Expert Squad authoring、Prism evidence 与 package closure 记录。
- 2026-08-06 Office Artifact Harness strategy。
- `specs/artifacts/五客户端长链路业务与开发需求.md`。
- `opencorvus-expert-squad-creator` 与 `benchmark-debug-template` 两个 Skill 的完整说明和检查清单。

### 本次直接检查的代码面

- `task-api/index.ts`、`engine/model.ts`、`engine/pipeline.ts`、`engine/task-creation-owner.ts`、
  `engine/engine.sql.ts`、`engine/task.ts`。
- `orchestrator/agent.ts`、`engine/workflow-binding*.ts`、`engine/completion-decision.ts`、
  `engine/cross-task-artifact-import.ts`。
- `expert-squad/registry.ts`、`manager.ts`、`install-lock.ts`、`configuration.ts`、`locations.ts`、
  `prompt-profile-resolver.ts`、`conversation-authoring.ts`。
- `metrics/types.ts`、`store.ts`、`executor.ts`、`score.ts` 与 `shell/shell.ts`、
  `shell/inactivity-process.ts`。
- `artifact-catalog/index.ts`、`engine/artifact-catalog-metadata.ts`、Task Artifact store。
- `panel/capability.ts`、server routes、OpenAPI、JavaScript SDK、Overlay expert-squad service、
  catalog refresh 与 task-list Server-Sent Events（SSE，服务器推送事件）。

### 全仓搜索

~~~text
rg -n "ExpertSquadPackageRevision|packageRevision|package_revision" packages/opencorvus/src
rg -n "createTaskInner|persistQueuedTask|CreateTaskInput|taskConfigSnapshot|promptProfile" packages/opencorvus/src
rg -n "readTaskWorkflowBinding|frozenPackageRevision|profile_change" packages/opencorvus/src
rg -n "loadPackageRevisionSnapshot|loadSourcePackage|materializePackageSnapshot" packages/opencorvus/src/expert-squad
rg -n "importDirectory|importArchive|updatePackage|uninstallPackage|expected.*Digest|lock" packages/opencorvus/src/expert-squad
rg -n "configuration|secret|credential|permission|projectID|installationScope" packages/opencorvus/src/expert-squad packages/opencorvus/src/config
rg -n "sourceTask.project_id|missionID|cross-task-artifact-import" packages/opencorvus/src
rg -n "executeMetrics|MetricSource|evidence_ref|timeoutMs|idleTimeoutMs" packages/opencorvus/src
rg -n "expert-squad-package-revisions|cleanup|prune|deleteEngineTask|onDelete.*cascade" packages/opencorvus/src
rg -n "expert_output|artifact_type must be namespaced|engineArtifacts.publish" packages/opencorvus/src packages/plugin/src
rg -n "task.completed|task.failed|task.cancelled|catalogRefreshToken" packages/opencorvus/src packages/overlay/src
rg -n "expert_squad_author|panel.create_task|promptProfile" packages/opencorvus/src packages/sdk expert-squads
rg -n "builtIn|built_in|assertNoBuiltInCollision" packages/opencorvus/src/expert-squad
~~~

### 已验证事实与前版遗漏

1. 当前 Task 创建只保存 active ID，没有在首次 workflow binding 前固定完整 package revision；存在
   create → queue/restart → first wake 期间字节漂移。
2. Task 在首次 workflow occurrence 前仍能修改 `promptProfile`，与 Panel 已声明的“Task 全生命周期固定
   Squad”不一致。引入创建时 pin 后必须禁止换 ID，不能重新 pin。
3. Registry 已有内容寻址、不可变 package snapshot，且没有发现 package revision 的自动 prune；可以直接
   复用，不需要 Harness 版本表。
4. Engine Artifact 和 Task Artifact 随 Task/Project 显式物理删除而删除；因此“永不删除”只能承诺
   “系统不自动删除”，不能虚假承诺用户执行显式破坏性删除后证据仍然存在。
5. Manager replacement 在 manifest-ID 跨进程锁内执行，但当前没有 `expected_current_digest` 的
   Compare-And-Swap（CAS，对比后交换）；晋升、恢复和 campaign 切臂都需要补齐。
6. 专家团 configuration/secret 按 installation scope、project identity、namespace、ID 保存，不按 digest
   保存。隔离 campaign Project 不会继承 global/生产 project 密钥，必须显式提供 benchmark 专用配置。
7. `executeMetrics` 没有生产调用点；现有 Metric 的 `baseline/challenge` 是指标来源，不是 package arm。
   shell scorer 仍使用 hard timeout，部分 evidence 是截断伪 URI（统一资源标识符），不能直接充当实验真值。
8. `expert_output.artifact_type` 必须以 active Squad ID 命名。前版泛写 `evolution/...` 没有声明 owner；
   新方案由自包含 `evolution-lab` 专家团拥有 `evolution-lab/...` Artifact ABI
   （Application Binary Interface，应用二进制接口）。
9. 当前 Mission 创建 Task 和 Cross-Task Artifact import 都受同一 Project/Mission lineage 约束；V1 必须使用
   单一隔离 campaign Project，不能假装双 Project 已可直接复用。
10. 当前内置 `base`、`advanced`、`research-studio` 不能被同 ID 外部包覆盖；运行时自进化 V1 只能晋升
    project/global 安装的非内置包。内置包候选只能走普通源码开发、产品构建和发布。
11. Package Tool 是进程内可信可执行扩展；Tool description 与 schema/execute 同在 `tools/*.ts`。
    V1 必须冻结全部 Tool source，不能只改 description。
12. Task 终态 SSE 当前只负责列表/catalog 失效刷新，不会也不应自动启动 Evolution Mission。

## 审查结论

前版的根本方向正确：进化对象是完整专家团 package revision，评测与目标解耦，生产晋升显式执行，
核心 loop 不感知 score。但前版不能称为“影响面调查已尽”，因为触发、Artifact owner、Task 内 profile
变更、内置包、删除保留、配置密钥、API/SDK/Overlay 和外部副作用没有闭合。

本版补齐这些边界后，可以作为详细架构基线。仍不能声称功能可立即上线：Task 创建时 revision pin、
Manager CAS、真实 scorer evidence、Evolution Lab package 和运行证据采集工具尚未实现。

## 一、总体架构：双循环、三种边界

### 1. 持续观察循环

普通生产 Task 继续按现有核心 loop 运行。系统保留已有真实 Task、Session、Message、Tool、Artifact、
Completion Decision、token、cost 和活动事实，但不对每次生产执行强制跑完整 scorer，也不自动创建候选。

符合条件的证据由显式启动的 `evolution-lab` Observer Task 读取，发布不可变
`evolution-lab/opportunity@1`。Opportunity 只说明“这里可能值得优化”，不具有 dispatch、retry、
candidate、rank 或 promotion 权力。

### 2. 隔离进化循环

用户或显式配置的 Automation（自动化任务）用一条真实、可见 Mission 消息启动 Evolution Mission。
Mission 在一个隔离 campaign Project 内创建固定 profile 的普通 Task：

~~~text
Opportunity / 用户要求
        ↓
Evolution Lab 归因与实验计划
        ↓
完整候选 package revision
        ↓
baseline / candidate 普通目标 Squad Task
        ↓
独立 Evaluator Agent 评分与对比
        ↓
Evolution Lab 推荐继续实验、停止或建议晋升
~~~

Mission 自然阅读证据并决定下一次真实工具调用。Host 不保存 campaign step、current candidate、
retry count、rank winner 或自动推进状态。

### 3. 生产晋升边界

隔离进化可以静默进行，但生产安装不能静默改变。只有用户显式批准后，Manager 才能以
`expected_current_digest` CAS 原子替换真实 project/global 安装，并生成可审计 receipt（回执）。

## 二、触发机制

### 1. V1 支持的触发来源

- 用户明确要求优化某个专家团或复核某个 revision。
- 用户明确选择一组失败 Task/Artifact 作为输入，启动 Evolution Mission。
- 用户显式创建的定时 Automation 周期性唤醒 Mission，消息中携带目标 Squad ID、证据范围和预算。
- 已经运行中的 Evolution Mission 收到它创建的 child Task 终态通知后，自然判断是否继续下一轮。

这些触发都是可见用户/Automation/Mission 消息，不是 Host 内部 `if score < N`。

### 2. 可形成 Opportunity 的证据

- 多个真实 Task 重复出现、且因果证据归属于 Squad instruction/Skill 的问题。
- 新增高质量失败样本、人工反馈、holdout（保留集）或业务验收合同。
- 模型/provider、OpenCorvus runtime、默认 Tool 或外部服务版本发生变化，需要重新认证当前 Squad。
- 交付质量基本不变，但 token、成本、无活动、人工交互或长链路耗时显著恶化。
- 同一输入多次执行方差过大。
- Reviewer 发现证据不完整、权限使用扩大、交付范围缩水或 reward hacking（奖励投机）。
- Evolution Agent 提出一个明确、可证伪、属于 V1 可变面的主动改进假设。

### 3. 明确不允许的触发

- Task 终态 SSE 直接创建 Evolution Task。
- Metric 阈值直接生成候选、重试或晋升。
- 标题、slug、错误关键字或最后一个 terminal status 触发修复。
- 每次生产执行都无条件跑全量长链路 benchmark。
- scorer/provider 不可用时切换替代 scorer/model。

### 4. Opportunity Artifact

`evolution-lab/opportunity@1` 至少包含：

- target logical/installed identity 与当前 exact revision；
- 触发类型与真实消息/Automation identity；
- 精确 Task、Session、Message、Tool、Artifact、Completion/failure evidence locators；
- 可观察现象、影响范围、发生频率和数据时间窗；
- 初步 owner 假设、未知项、敏感数据等级；
- 建议实验预算，但不包含自动执行命令。

## 三、进化对象和可变面

### 1. 唯一进化对象

进化对象是一个完整、自包含、由 Registry 验证且具有 SHA-256 digest 的 Expert Squad package
revision。parent 只表达 lineage（谱系），不是运行时依赖。候选不能读取另一个专家团私有路径、Tool、
Skill、MCP、asset 或协议。

### 2. V1 可以改变

- package README 中的 scheduler/Orchestrator 指令；
- `selector.md`；
- scheduler prompt；
- Agent prompt overlay；
- Skill 文本及 Skill 内模型可读 supporting files；
- package-owned few-shot 示例。

### 3. V1 必须冻结

- manifest identity、version 以外的 capability projection、Agent topology、base role、workflow graph；
- 全部 Tool source，包括 description、schema、execute；
- library、compiled bundle、MCP 声明/端点/能力；
- configuration schema、secret fields、permission、default host tools；
- assets、binary、Core prompt、模型/provider；
- Dataset、Scorer、Judge、benchmark environment。

CandidateRevision 必须正向列出全部 changed paths，并证明所有冻结文件的 digest 与 parent 完全相等。
这属于 package 数据完整性，不是质量 gate。

### 4. 不同能力应新建 Squad，而不是版本投机

如果两个“版本”服务于本质不同的业务域、权限或 workflow，应创建不同 manifest ID 的自包含专家团，
由用户显式选择；禁止用历史 rank 在运行时把同一个 ID 路由成多个隐含人格。

## 四、`evolution-lab` 自包含专家团

V1 新增一个 target-agnostic（与目标无关）的自包含 `evolution-lab` package，至少投影：

- Observer：整理 Opportunity，不做修复。
- Failure Analyst：完成因果归因。
- Experiment Planner：冻结实验变量、样本和预算。
- Candidate Author：只修改 V1 白名单并生成完整 package。
- Evaluator：独立读取两臂证据并执行冻结 scorer。
- Security/Integrity Reviewer：检查越权、泄漏、奖励投机和冻结面漂移。
- Recommendation Owner：汇总比较和未知项，不执行晋升。

Candidate Author 无权修改 `evolution-lab` 自身 package、Dataset、Scorer 或 evaluator workspace。
目标 Squad 不感知 arm、score、rank 或 candidate lineage。

跨 Squad 协作仍由 Mission 为 `evolution-lab` 和目标 Squad 分别创建固定 `promptProfile` 的 Task；
不存在同一 Task 中动态切 Squad。

## 五、Task 创建时 package revision pin

### 1. 当前问题

当前创建流程只验证 profile ID 并写入 root Session config overlay；首次 Orchestrator wake 在没有 workflow
binding 时重新读 live catalog。Manager 在 create 与 first wake 之间替换同 ID 包，会令 Task 执行错误字节。

### 2. 新建 Task 的输入

~~~ts
{
  promptProfile: string
  expectedPackageDigest?: string
}
~~~

Caller 只能提供 ID 与可选 expected digest。scope、project ID、namespace、version、snapshot path、
projection hash 和完整 revision 均由系统解析，caller 不得指定。

### 3. 创建提交边界

Task 对外可见、入队或启动前必须：

1. 与 Manager manifest-ID install lock 协调，避免 Time-of-Check to Time-of-Use（TOCTOU，检查与使用间竞态）。
2. 从 capability Project 的唯一 effective catalog 解析 active ID。
3. Registry 完整加载安装包并物化不可变 snapshot。
4. 系统生成 `{scope, projectID, namespace, id, version, packageDigest}`。
5. 如果 caller 提供 expected digest，则执行 CAS 校验。
6. 在 `persistQueuedTask` 的同一 Database（DB，数据库）事务内写 Task 和唯一
   `task_package_revision_binding` Core Engine Artifact。
7. 提交后才发布 `task.created`、入队或 wake。

使用 Engine Artifact 而不是自由 metadata 或新列，可以在现有 DDL（Data Definition Language，
数据定义语言）内完成，不需要新表和数据库重置。这个 Core Artifact 只表达 Task 创建时 package bytes，
不包含 campaign/score 语义。

### 4. 后续运行

- 每次首次/恢复 wake 都从 creation binding 读取 revision，调用 Resolver 已有 snapshot 路径。
- 首次 workflow binding 必须与 creation binding 全字段一致；workflow binding 不再创建 revision authority。
- snapshot 缺失、损坏或 identity 不一致时 typed fail closed，不读 live catalog、不回退 global。
- `requestID`/channel idempotency 命中旧 Task 时，profile/expected digest 不一致返回 typed conflict。
- Task 创建后 `promptProfile` 全生命周期不可改变；同 ID follow-up 可视为幂等，不同 ID 返回
  `TaskPromptProfileImmutableError`。禁止“换 ID 后重新 pin”。

## 六、单一隔离 campaign Project 的两臂实验

V1 使用一个隔离 campaign Project 和一个 Mission，因为当前 capability project 与 Cross-Task Artifact import
都绑定同一 Project/Mission lineage。

1. 冻结单一 Dataset partition 的 CampaignSpec、case workspace template 和 arm-blind delivery directories；
   development、holdout、certification 各自是独立 Experiment revision。
2. Manager 安装 exact baseline 到 campaign Project。
3. 用 `expectedPackageDigest=baseline` 创建并 pin 全部 baseline Tasks；暂不要求立即运行。
4. Manager 用 expected-current CAS 将 campaign 安装替换为 candidate。
5. 用 `expectedPackageDigest=candidate` 创建并 pin 全部 candidate Tasks。
6. 按 CampaignSpec 预先冻结的交叉/随机 arm 顺序运行这些已 pin Tasks。
7. 所有 Task 继续在同一 Project/Mission 内通过现有 Artifact import 交接证据。

安装顺序不等于运行顺序。创建时 pin 允许 catalog 只有一个 effective package，同时让已创建两臂各自运行
不可变字节。

capability Project 只承载 OpenCorvus 配置和 package；每个 trial delivery directory 从同一 snapshot
物化，初始 digest 必须相等，路径名不暴露 baseline/candidate 语义。package 安装文件不能被算作交付物。

## 七、八类不可变 Artifact

所有 package-owned Artifact type 都以 `evolution-lab/` 命名；大文件用 content-addressed resource set。
跨 Task 只能通过现有 Mission Artifact import，并保留原始 provenance（来源证明）。

1. `evolution-lab/opportunity@1`：为什么值得调查。
2. `evolution-lab/campaign-spec@1`：冻结 target、baseline digest、单一 Dataset partition、Case、Scorer、
   模型、环境、workspace、重复次数、arm 顺序、统计方法、预算、超时、UI rubric（评价量表）和 mutation
   surface；candidate digest 由后续 Candidate Artifact 固定，不能提前猜测。
3. `evolution-lab/failure-attribution@1`：现象 → 直接触发 → 深层原因 → owner 证据 → 旧路径为何未根治
   → 未知项。
4. `evolution-lab/candidate-revision@1`：精确 development Campaign locator、parent/candidate exact revision、
   两棵完整 package resource tree、hypothesis、changed paths、diff digest、冻结文件相等证明、Registry
   validation receipt 和生成 provenance；holdout/certification Campaign 不能发布 Candidate。
5. `evolution-lab/run-evidence-bundle@1`：case/arm/repetition、workspace digest、Task/Session/Message/Tool/
   Artifact/Completion/failure、模型、环境、token/cost/activity 与五个 revision 相等关系。
6. `evolution-lab/evaluation-result@1`：每个 scorer 的 measured/unavailable 结果和 exact evidence。
7. `evolution-lab/comparison-recommendation@1`：每个 scorer 的配对 mean/median/variance、预声明置信区间、
   win/tie/loss，两臂 failure/unavailable rate，token/cost/activity delta、nullable aggregate、回归、未知、
   视觉复核、reward-hacking 审查和建议。
8. `evolution-lab/promotion-receipt@1`：promotion/restoration 类型、用户授权、target identity、
   expected current、before/after digest、evidence 和 Manager 原子替换事实。

RunEvidenceBundle 必须证明：

~~~text
installed resolved digest
= expected digest
= Task creation binding digest
= workflow binding digest
= runtime loaded snapshot digest
~~~

Decision Log 只保存当前 Task 的 WHY，不充当跨 Task 总线、score store、版本表或 current-best。

## 八、trace、评分和长期版本

### 1. 不是每次生产执行都评分

普通 Task 的 trace 继续作为 canonical fact 保存。只有被用户/Automation/Mission 精确选入 campaign 的
Task，才由 run-evidence collector 生成实验 bundle 并执行 scorer。这样避免全量生产评分带来的成本、
隐私和误触发。

### 2. 评分是向量，不是唯一总分

至少分别记录：

- 交付正确性；
- 需求覆盖与长链路闭合；
- 证据完整性；
- 工具选择与调用质量；
- 稳定性/方差；
- token、成本、真实活动时长；
- 失败、无活动、人工交互；
- 权限与外部副作用；
- UI 人工评分；
- unavailable 比例。

可以计算 aggregate（聚合）用于阅读，但任何必需维度 unavailable 时 aggregate 必须是 `null`，不能对剩余
维度重新归一化。

### 3. 所有版本不自动删除

- Registry 的 content-addressed package snapshots 不自动 prune。
- candidate、run、score、comparison 和 receipt 所在 campaign Task/Project 不自动清理。
- 相同 package/file/resource bytes 按 digest 复用，避免重复存储。
- Task archive 只改变展示，不删除证据。
- 用户显式物理删除 Task/Project 会按现有 cascade 删除其 Engine/Task Artifacts；产品必须在确认界面展示
  将失去的 campaign/revision/evidence 数量。这是显式破坏性操作，不得声称删除后仍“永久保留”。
- 如果未来需要合规级 Write Once Read Many（WORM，一写多读）留存，应单独设计签名归档产品，不能用
  当前 Task Artifact 冒充。

因此精确承诺是：所有被 campaign 引用的版本和分数永不自动删除；只有用户明确授权的物理删除可以移除。

## 九、rank 与下次执行选择

### 1. 禁止全局动态 rank 路由

不存在跨 Dataset、模型、环境和时间都成立的“最佳版本”。单一 rank 会掩盖质量、成本、安全、视觉和未知
维度之间的权衡，也会让评测系统成为第二 active source。

生产 Task 永远使用当前 catalog 中显式安装的 revision。下次普通执行不查询历史 rank。

### 2. 使用 incumbent–challenger

- incumbent：当前明确安装的生产 revision。
- challenger：本次 campaign 的候选。
- 二者在同一 CampaignSpec 下做 paired comparison（配对比较）。
- Recommendation 只在当前 experiment context 内成立。
- 用户批准后 challenger 才成为新的 installed revision。

### 3. 允许派生排行榜，但不能持久化 active winner

UI/API 可以从不可变 comparison Artifacts 动态派生：

- 某一精确 Dataset/Scorer/模型/环境 revision 下的 Pareto frontier（帕累托前沿）；
- per-case win/tie/loss；
- 成本、时长、质量和证据完整性的多维排序；
- 历史 recommendation snapshot。

派生结果必须显示完整 experiment context 和 unavailable 维度；不能写入 `latest`、`current_best` 或
“下次自动使用版本”字段。

## 十、静默升级的边界

| 行为 | V1 决策 |
| --- | --- |
| 保存正常执行 trace | 可以，沿用现有可见、可审计事实与访问范围 |
| 在隔离 Project 生成候选 | 可以静默执行 |
| 在隔离 Project 跑 baseline/candidate | 可以静默执行，但所有 Task/Tool/Artifact 真实可见 |
| 生成比较与晋升建议 | 可以静默生成，最终通知用户 |
| 修改生产 project/global 安装 | 禁止静默，必须逐次显式授权 |
| 失败后自动切回旧版本 | 禁止；恢复是另一笔显式 CAS replacement |
| 每次 Task 按历史 rank 选版本 | 禁止；installed catalog 是唯一运行来源 |

“静默”只能表示不要求用户盯日志，不能表示隐藏消息、隐藏 Task、隐藏 Tool call 或不可审计状态变更。

## 十一、评分执行合同

### 1. 冻结实验尺子

候选生成前冻结 Dataset、Case、Scorer bundle、judge prompt/model、环境、workspace、模型参数、重复次数、
arm 顺序、统计方法、UI rubric、mutation surface、预算和 inactivity profile。任一 digest 改变即是新
Experiment revision，必须重跑 baseline。

### 2. measured 与 unavailable

~~~ts
type EvaluationAttempt =
  | {
      outcome: "measured"
      scorerRevision: string
      rawValue: unknown
      normalizedValue: number | null
      evidenceLocators: string[]
      executionArtifactLocator: string
    }
  | {
      outcome: "unavailable"
      scorerRevision: string
      reasonCode: string
      failureArtifactLocator: string
    }
~~~

scorer 配置错误、证据缺失/损坏、执行失败、judge provider 不可用和 inactivity 都产生 unavailable。
不能换 scorer、换模型、写零分、沿用旧值、自动重跑或从其他指标推导。

### 3. 重复与统计

- repetition 数量在看结果前冻结；
- 开发 case 每臂建议至少 3 次，finalist holdout/full-chain 每臂建议至少 5 次；
- 样本不足时只报告描述性证据，不宣称稳定提升；
- 报告 paired delta、均值、中位数、win/tie/loss、失败/unavailable rate、成本/token/activity delta、
  方差和预先声明的置信区间；
- 失败、取消、inactive 和 unavailable trial 不能从样本中消失；
- 禁止看到高分后提前停止或事后删异常值。

### 4. UI

UI 维度只有在真实页面、真实 URL、真实交互、Task/region 绑定截图和人工查看全部存在时才 measured。
缺少任一项时 UI 维度 unavailable；不得把 DOM、字符串、mock、fixture 或 screenshot baseline 称为视觉验收。

## 十二、无活动超时

唯一 deadline：

~~~text
last_real_activity_at + inactivity_timeout_ms
~~~

真实活动包括模型 stream chunk、Message part、Tool stdout/stderr、Tool lifecycle、Artifact publication、
Session/Task execution progress、真实子进程输出和 interaction request/response。

poll、timer wake、重复 cursor、synthetic heartbeat、archive/pin 和 monitor 自己的日志不算活动。

使用 scheduled wake，不长时间监听日志。持久化 activity cursor；timer 到期后重读 canonical facts；只有
cursor 推进才重排。runner 重启按旧 cursor 计算剩余时间，不能重新给完整窗口。queued 时间不计执行超时；
pending permission/question 产生 `awaiting_interaction`，Host 不自动回答。

现有 metrics shell 的 hard `timeoutMs`、截断 stdout 和伪 evidence URI 必须先修正，才能接入 evolution。

## 十三、配置、密钥、权限和外部副作用

### 1. 配置与密钥

Expert Squad 配置按 `{installationScope, projectID, namespace, id}` 保存，不按 package digest 保存。

- campaign 使用独立 project-scope 安装，不继承生产/global secret。
- baseline/candidate 使用相同 benchmark 专用 configuration。
- configuration schema 在 V1 冻结。
- secret 只以“已配置”事实出现，不能进入 Candidate、RunEvidence 或 prompt。
- 需要真实外部服务时使用专用测试 tenant/account/key，并在 CampaignSpec 记录 credential source identity，
  不记录 secret value。

### 2. 权限

两臂必须使用相同 permission snapshot。unexpected permission/question 是 trial fact，不能自动批准。
候选文本不能扩大 projected capability，但它可能改变既有 Tool 的调用频率和参数，因此全部 Tool call/side
effect 都必须进入 RunEvidence。

### 3. MCP 与外部系统

即使 MCP/Tool bytes 冻结，远端数据、配额、时间和副作用仍可能漂移：

- 优先使用固定数据 snapshot 或专用测试环境；
- live service 必须记录 endpoint class、数据 revision/时间窗、tenant、rate limit 和 side-effect receipt；
- 会发消息、下单、删除、发布或转账的 Tool 不得指向生产目标；
- 外部服务不可重复时，该维度明确标为 comparability limitation（可比性限制）。

这不是 hostile-code sandbox。Package Tool 仍是 trusted executable extension；可执行代码进化必须另设计
进程隔离与 capability Remote Procedure Call（RPC，远程过程调用）边界。

## 十四、版本、并发、晋升和恢复

### 1. 身份

- digest 是准确字节身份。
- manifest `YYYY.MM.DD.N` 是人类可读 authoring revision。
- parent digest 表达谱系，不表达 runtime inheritance。

### 2. 候选并发

campaign 内 version 相对 parent 单调。并发 campaign 可能产生同 version、不同 digest；digest 仍能严格区分。
不新增全局 reservation ledger 或 latest-candidate 状态。

如果晋升时 version 语义已冲突，Manager 返回 typed conflict；必须生成新 version 的完整候选并重新评测，
不能只改 manifest version 后沿用旧分数。

### 3. Manager CAS

所有 replace/promotion/restoration 输入必须包含 exact installation identity 与
`expected_current_digest`。Manager 在现有 manifest-ID 跨进程锁内：

1. 重新发现 exact scope target；
2. 读取当前完整 installed digest；
3. 比较 expected current；
4. Registry 重新验证 candidate/prior snapshot identity 和 closure；
5. staging/rename 原子替换；
6. 返回 before/after digest、version、scope/project 和 target root。

冲突 typed fail，保留当前完整安装，不自动重试。

### 4. 生产影响

- promotion 不修改 `prompt_profile.active`。
- promotion 前创建的 Task，即使尚未 first dispatch，也继续旧 pin。
- promotion commit 后创建的新 Task 才解析新 revision。
- restoration 是显式发布 exact prior snapshot；receipt 明示 version 回退，不是 fallback。
- global promotion 只报告哪些 project-local 同 ID 安装仍会遮蔽它，不以此阻断合法 global 更新。

## 十五、内置包与外部包

- project/global 安装的非内置专家团：可以使用完整 V1 runtime evolution 和 Manager promotion。
- 内置 `base`、`advanced`、`research-studio`：Resolver 禁止同 ID 外部 collision，不能在运行时用 campaign
  package 替换。它们可以接受相同 benchmark 评测，但候选必须作为普通源码改动，经过代码 review、build、
  payload/embedded freshness、产品发布和新 binary 验证；不称为运行时静默自进化。
- repository authoring source、payload、project install 和 global install 必须继续遵守各自唯一来源，不能用
  Registry snapshot 反写 authoring source。

## 十六、API、SDK、Overlay 与 catalog 影响

### API/SDK

- `CreateTaskInput`、`panel.create_task`、server route、OpenAPI 和 JavaScript SDK 增加
  `expectedPackageDigest`。
- Task describe/list projection返回 system-generated package revision binding，便于审计；不增加 active selector。
- Task follow-up 的 profile change 改为 typed immutable error。
- Manager import/update/restore API 增加 expected-current-digest CAS 与完整 receipt。
- 新增只读 run-evidence collector API/tool；它只读取 exact terminal lifecycle facts，不评分、不 dispatch。

### Overlay

- Task detail 可以显示 pinned package ID/version/digest 与 workflow binding equality。
- Expert Squad detail 可增加 Evolution 历史页：campaign、candidate graph、context-scoped Pareto comparison、
  unavailable、cost 和 promotion/restoration receipt。
- 不显示脱离 context 的全局“最佳版本”，不提供“下次自动选 rank 1”开关。
- promotion/restoration 是显式确认操作；物理删除 campaign 时展示将丢失的历史证据。
- 所有 UI 改动只做真实页面交互、截图和人工复核，禁止 UI 自动化测试。

### Catalog refresh

Manager 安装成功继续调用 Registry invalidation。Task 内完成 package write 后，现有 global task-list terminal
SSE 继续推进 Overlay 唯一 catalog refresh token。这个刷新只使读面重新加载，不触发 evolution。

## 十七、隐私、访问和数据保留

- Opportunity 默认引用 exact evidence，不复制完整生产消息正文。
- run-evidence collector 使用 typed allowlist 输出结构化 provenance、计量和显式选定 Artifact；禁止基于关键字
  的伪脱敏。
- 需要读取原始消息/文件时，必须由用户或 Mission 显式选择 locator，并继承同 Project/Mission 访问边界。
- secret configuration value、OAuth（开放授权）token、header 和环境密钥永不进入 Artifact payload。
- 历史 UI/API 只能向有对应 Project 访问权的主体展示。
- 外部 scorer 不得默认上传 trace；若未来接入商业 SaaS（Software as a Service，软件即服务），必须作为
  显式 external service 声明数据边界，且不能成为第二真值源。

## 十八、成本、容量和运行稳定性

- CampaignSpec 固定 token/cost、并发、provider quota、端口、网络和 workspace 预算。
- 预算是用户给定资源边界，不根据得分自动提前停止或自动扩容。
- 同一外部资源、端口、账号或 rate limit 会相互影响的 paired trial 不并行；真正互不影响的 case 才并行。
- 每个候选先跑非 UI contract、小型代表 case，再由 Mission 基于证据决定是否花费长链路和人工视觉成本。
- package/resource snapshot 采用内容寻址去重；报告需显示新增存储、token 和外部服务成本。

## 十九、失败、取消、恢复、rewind 和删除

- terminal completed/failed/cancelled、inactive、awaiting_interaction 都是合法 Trial outcome。
- runner/Mission 重启从持久化 Task、binding、Artifact、activity cursor 恢复，不从头猜测状态。
- Task reopen/继续执行会产生新的真实 lifecycle 和 Completion Decision；RunEvidence 必须冻结 exact terminal
  lifecycle reference，不能用“当前 Task 最新状态”覆盖历史 trial。
- rewind 只改变读投影，不删除底层事件；历史 trial 仍引用 exact event/terminal identity。
- scorer 失败不自动创建 replacement trial；Agent 若决定重跑，必须创建新 trial identity 并引用前次失败。
- archive 不删除；physical delete 才删除，并需要展示 evolution evidence impact。

## 二十、主流工程方案对照

本设计采用非学术、已产品化的公共模式：

| 产品 | 采用 | 不采用 |
| --- | --- | --- |
| [LangSmith evaluations](https://docs.langchain.com/langsmith/evaluate-llm-application) | Dataset、显式 evaluator、experiment metadata、per-example trace 和比较。 | 外部 trace/dataset 不能成为 OpenCorvus 真值。 |
| [Braintrust comparison](https://www.braintrust.dev/docs/evaluate/compare-experiments) | 指定 baseline、case delta、多 trial、regression、cost、latency。 | 不使用隐式 most-recent baseline，不用 CI/CD（持续集成/持续交付）阈值自动晋升。 |
| [Promptfoo metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/) | 版本化 case、确定性/自定义 assertion 和原始证据。 | exit code/pass rate 只是测量，不是 Task completion 或 promotion authority。 |
| [Langfuse experiments](https://langfuse.com/docs/evaluation/experiments/experiments-via-ui) | Dataset experiment、prompt comparison、code evaluator 和 LLM judge。 | 不使用 latest dataset；所有 revision 精确固定。 |
| [Weights & Biases Weave](https://docs.wandb.ai/weave/guides/core-types/evaluations) | Dataset + target + scorer 的可重复实验蓝图。 | 外部 Evaluation object 不是第二生命周期或 Artifact store。 |

共同可取模式是：固定输入 → 真实运行 → 保存 trace → 独立评分 → case-level 对比 → 人工发布决策。

## 二十一、可发挥想象力但不破坏边界的方案

### 1. Champion–Challenger（冠军—挑战者，默认）

一次候选与当前 installed incumbent 配对比较，最简单、因果最清晰，适合作为 V1 默认。

### 2. 多候选锦标赛

Candidate Author 针对不同 failure hypothesis 生成 2–3 个完整候选。先跑低成本非 UI regression corpus，
再让 finalist 与 incumbent 跑长链路。不能把多个胜出片段动态拼成 overlay package。

### 3. 免疫记忆

真实失败 → attribution → 最小复现 case → versioned regression Dataset。失败知识进入测试语料，不把具体答案
硬编码进生产 prompt。

### 4. Development/Holdout 双集

Candidate Author 只能看到 development Campaign。candidate digest 固定后，Mission 以一份不含 Candidate
Author 的全新 holdout Campaign 重跑 baseline/candidate；certification 同理。任何 candidate 字节变化都会
使既有 holdout/certification comparison 失效，必须从新的 development Experiment revision 开始，避免背答案
和迎合 scorer。

### 5. 周期再认证

模型、runtime、Tool、外部服务或数据分布变化后，用同一 incumbent 重跑 exact certification campaign。
旧版本重新胜出时只生成 restoration recommendation，不静默 fallback。

### 6. Shadow replay

对不会产生真实外部副作用、且数据权限允许的历史 case，在隔离 Project 重放候选；生产 Task 仍只跑 installed
revision。它不是生产流量分流或隐藏 canary（灰度）。

## 二十二、实施分期

### P0：先修通用 Task revision 正确性

- creation binding Core Artifact；
- expected digest CAS；
- install-lock 协调；
- first/resume wake 与 workflow equality；
- full-lifetime profile immutability；
- request/channel idempotency conflict；
- API/SDK/Panel 正向 contract tests。

实施状态：核心 creation binding、创建事务、expected digest、request replay、固定 revision runtime projection、
Session/workflow/uninstall 不变性、旧运行期选择工具删除和 API/SDK 投影已实现；聚焦契约、typecheck、文档检查
与独立 Agent 终审均已通过。终审确认 Orchestrator first/resume 无条件调用同一 pinned projection helper，
scheduler 投影的 agent/tool/skill 将 exact revision 传给 worker，dispatch lineage 与 completion transaction 都以
workflow binding 全字段等于 creation binding 为提交条件。P0 已获 `APPROVE`，进入 milestone commit。

### P1：Manager 并发与恢复

- import/update/restore 的 expected-current-digest；
- before/after receipt；
- exact prior snapshot restoration；
- project/global scope matrix；
- catalog invalidation。

实施状态：Manager 的 import、update、payload install 和 exact snapshot restoration 已收敛到同一个锁内
publication primitive；通用 `replace` boolean 已删除。create-only 同字节重试返回 `unchanged`，不同字节与
stale expected digest 返回 `ExpertSquadPackageMutationConflictError`；成功返回 `installed` / `unchanged` /
`replaced` / `restored` 的 before/after 完整回执。project/global exact scope、两并发 writer 唯一胜者、immutable
snapshot 恢复和 Registry invalidation 已通过聚焦正向契约；Core/SDK typecheck、OpenAPI、API docs、route 与
SDK import 检查通过。首轮独立终审没有批准，并发现四项根因：同字节分支可绕过 stale expected digest、
Overlay 仍使用旧 replace/receipt ABI、restore 未进入 bounded project-identity context、测试没有预热真实
`discoverAvailable` cache 或证明 invalidation 失败后的旧快照恢复。修复后 expected digest 总是先比较；catalog
把 installed package digest 作为唯一 CAS 输入投影给 Overlay；旧 replace toggle 和文案被直接删除；restore
与同类控制面路由使用相同 context；测试注入 invalidation failure，证明 backup 恢复、缓存复读与后续正常发布。
真实 Vite 页面连接隔离 backend 后，已展开 Squad Market 的本地安装区域并人工查看截图：只保留 scope、folder
和 ZIP 三个现有成熟控件，旧 replace toggle 不存在，布局完整无空洞。

P1 最终独立复审已 `APPROVE`。Reviewer 独立确认首次 invalidation 失败后 cleanup 第二次调用真实
`invalidateAvailable`，测试不再手工修复 cache，并正向验证 backup digest、恢复后的 baseline catalog、后续
replacement 与 restoration；禁止的负向断言已删除。独立 CAS 复测为 1 pass / 30 assertions，未发现剩余
blocker。P1 完成，进入 P2。

P2 当前实现状态：由 SDK（Software Development Kit，软件开发工具包）authoring writer 生成最小
`builtin/evolution-lab` 自包含 package 骨架，package 自己拥有八类严格 Artifact codec 和唯一 typed publisher；
Core 只新增通用 `taskRuns.collect` 与 `expertSquadPackages.materializeRevision/validateResourceSet` Host ABI，
不认识 campaign、arm、score、rank 或 promotion。collector 在一个 DB 读事务中冻结 Task、完整 Session
子树、Message/Part digest、显式选择的完整 Message body、current/history Engine Artifact metadata 与精确
completed/failed/cancelled/inactive/awaiting-interaction occurrence；inactive 只冻结最新 durable activity identity，
不在 collector 中判断超时。package candidate integrity 从已解析 manifest prompt、README、selector 与 Skill
closure 推导 V1 mutable text paths，要求 candidate 新 version、完整文件集、manifest 除 version 外相等、冻结
文件 SHA-256（Secure Hash Algorithm 256-bit，安全散列算法 256 位）逐项相等，并返回全部 changed paths。
首轮测试发现 Windows locale 排序不稳定，已改为明确 code-point 路径序；第二轮测试发现 suite 重复创建
memory Git Project 会触发已知 lifecycle 污染，已按 P0 根治方式改为 suite 级单一 Project。P2 聚焦测试当前
惰性创建的单一 Project。

P2 首轮独立终审为 `BLOCK`，发现四项根本缺口：terminal occurrence 缺少真实 Protocol lifecycle event
identity；RunEvidence 只引用孤立 hash 且没有完整 Part/Tool inventory；Skill supporting file 只按目录放行，
没有证明为模型可读文本；Task runtime 只做 lexical containment，可被 symlink/junction 逃逸；同时指出
awaiting-interaction 没有绑定 active Task。修复后 terminal outcome 直接携带现有
`TerminalLifecycleReference`，collector 在同一 DB transaction 验证 exact Protocol event 与当前 Task row
确实属于同一个 terminal occurrence；Task reopen 后禁止从变化后的 Task 重建旧 run，历史读取只复用先前发布的
不可变 Task Artifact evidence bundle；每个 Message 都列出逐 Part digest，Tool Part
额外列出 name/call/status，只有显式 selected Message 展开 body。collector 在 Task Artifact catalog read lock
内执行 DB read transaction，同时冻结完整 Task Artifact snapshot inventory；package tool 把 canonical JSON bytes
直接发布为 immutable Task Artifact，`run-evidence-bundle` codec 强制 exact JSON resource locator/digest 和
resource-set membership。Host 对 Skill closure 每个文件记录 strict UTF-8（Unicode Transformation Format 8-bit，
八位 Unicode 转换格式）且无 NUL 的文本事实；package 只允许 `SKILL.md`、`references/`、`examples/` 中已证明
为文本的文件变化，scripts/assets/opaque bytes 保持 frozen。revision materialize/validate 不接受 caller directory，
而是把精确 revision 发布为 Task-owned immutable Artifact resource set，再由同一个 Task Artifact Host 校验、物化；
因此不存在任意目标路径或检查后替换目录的竞争窗口。awaiting-interaction 只接受 active Task。
第三轮独立终审继续发现两项交付缺口：测试只保留普通 snapshot，没有执行 package 自己的 canonical
run-evidence publisher；公开 package receipt 仍暴露 ToolHost close 后必然失效的临时 directory。最终实现从
Materialized/Validated ABI 删除 directory，materialize、validate/candidate publish、compare 跨三个独立
Task Artifact execution，只传 immutable resource set；另由独立 active evolution evidence-owner Task 对 terminal
Trial 执行真实 `collect-run-evidence` package tool，发布 canonical `run-evidence.json`。目标 Trial reopen 后，新的
evidence-owner execution 通过 exact resource set 重新物化并验证 JSON 与原 bundle 全等。

P2 第四轮独立终审 `APPROVE`；聚焦测试为 5 pass / 27 assertions，全仓 typecheck 8/8、docs check 与
`git diff --check` 均通过。P2 完成，进入 P3。

### P2：Evolution Artifact 和只读证据工具

- 八类 `evolution-lab/...` codec；
- exact revision checkout 到 Task-owned workspace；
- frozen-file equality；
- canonical run-evidence collector；
- 删除影响投影与 retention 展示数据。

### P3：Scorer runtime 修复

- hard timeout 改真实 inactivity；
- 伪 URI/截断字符串改 exact Artifact；
- measured/unavailable；
- 完整 selected evidence judge；
- metrics 保持 observation-only，无 dispatch 权力。

P3 实施前代码调查确认：`executeMetrics` 当前没有生产调用点，可以直接替换错误 ABI 而不保留兼容入口；
`engine_metric_result.evidence_ref` 虽是 TEXT（文本）列，但不需要改 DDL（Data Definition Language，数据定义
语言），它将只序列化一个严格 `TaskArtifactRef`（任务产物引用），内存类型不再接受伪 URI。每次 evaluator
attempt 都由 active evaluator Task 的 Task Artifact Host 发布完整 canonical JSON，包括 typed `measured` 或
`unavailable`、reason code、完整 shell stdout/stderr 或 judge response、以及全部 exact selected evidence
locator/digest；数据库结果只保存该 immutable resource 的精确引用。

Shell config 直接使用必填 `inactivity_timeout_ms`，连同精确 executable/argv 只传给唯一的
`runCommandWithInactivity` runner；经用户授权，旧 `inactivity-process.ts` 与 `Shell.run` idle timer 已删除，
package、overlay、benchmark 与 scorer 调用点均已迁移。无输出窗口到期、spawn/exit/parse/config 失败均为 typed unavailable，不产生零分。Judge
输入改为调用方显式给出的 exact Artifact locator 集合，通过共享 complete-read helper 读取全部字节；Judge
runner 改为真实 streaming event contract，完整 rationale 与唯一 final score 一同进入证据 Artifact。Query 无行、
非数值和 aggregator 输入不全同样 unavailable；prebuilt 的真实 rubric failure 仍是 measured 0，证据缺失或损坏
则 unavailable。任何 required quality/diagnostic observation unavailable 时 aggregate 保持 `null`，禁止对剩余
维度重新归一化。该模块仍只写 observation 与 iteration snapshot，不新增 dispatch、retry、promotion 或流程门。

P3 第三轮独立终审 `APPROVE`。最终聚焦契约覆盖 exact stdout/stderr、真实 inactivity、output callback
failure 理由码、streaming judge、query 合法零与无行、prebuilt Artifact kind/label 身份、aggregator、损坏
selected locator、Task Artifact evidence replay 与数据库 canonical JSON 原文，共 1 pass / 22 assertions，连续三轮
通过；全仓 typecheck 8/8、docs check 与 `git diff --check` 均通过。P3 完成；P4 随后通过
`evolution-lab/shared/execute-evolution-metrics` 和 Task-scoped Metric Host 接入唯一生产调用点。

### P4：自包含 `evolution-lab` package

- Observer、Analyst、Planner、Author、Evaluator、Reviewer、Recommendation Owner；
- 固定 scorer/tool/assets；
- 与目标 package 完全解耦；
- 完整 Registry/Manager/Resolver 投影测试与 package ABI producer-consumer 测试。

实施将单个笼统 workflow 拆成 opportunity analysis、candidate preparation 与 campaign evaluation 三个
Mission 阶段；每个 Task 的 profile 与 package revision 从创建时固定，跨阶段只导入已接受的 terminal
Engine Artifact。八类 Artifact ABI 的可消费资源身份使用稳定 path/media/bytes/SHA-256，不保存来源 Task
snapshot/ref；Mission import 后由 `rehydrate-evolution-resources` 只读取当前 Task 已复制的 Engine resources，
重建 campaign inputs 或 parent/candidate package tree。Candidate Artifact 同时携带完整 parent 与 candidate
闭包，后续 Task 分别重新执行 Registry package validation，禁止相信 author 自报 diff。

Campaign publisher 对 frozen expected resources 与 Task Artifact actual resources 执行保留重复计数的规范化
一一对应比较；case/scorer ID 使用跨平台安全单路径段并具有唯一性，rehydrate 在任何 mkdir/writeFile 前再次
验证 target 位于 staging tree。Run publisher 重新采集 authoritative Task facts，并要求 caller 在创建 Trial
时真实提供 expected digest。Metric receipt 固定 Campaign、Run、Candidate、case、arm、repetition、Trial Task、
target revision、scorer result 与 exact evidence；metrics 保持 observation-only，不拥有 dispatch、retry 或
promotion 权力。Built-in target 明确返回 `product_release_required`，不伪装成可热安装候选。

第五轮独立终审 `APPROVE`。最终 focused tests 为 7 pass / 90 assertions，真实覆盖
`prepareCrossTaskArtifactImports` → 新 Task 持久化 → current-Task rehydrate → Campaign metric 执行，以及
Candidate parent/candidate 双树重建和双 digest validation；另覆盖路径逃逸、重复 case 与 duplicate expected
掩盖 extra resource 的 typed error。P0/P3/P4 聚焦回归、全仓 typecheck 8/8、docs check、API route check 与
`git diff --check` 均通过。P4 完成，进入 P5。

P5 前置审查随后回开 P4：原 Campaign 同时暴露 development/holdout，Comparison ABI 也无法保存本方案的
完整统计向量。正向契约现已替换为单一 `dataset_partition` Campaign；Candidate publisher 必须完整读取、
选择并验证 exact development Campaign，且 Campaign target/baseline 必须等于 candidate parent，holdout 或
certification 输入返回 typed integrity error。Comparison 现保存 mean/median/variance、预声明置信区间、
win/tie/loss、两臂 failure/unavailable rate、token/cost/activity delta 与 nullable aggregate；required
unavailable 非空时 aggregate 必须为 null。独立 benchmark-safe ABI 终审 `APPROVE`，focused tests 为
7 pass / 91 assertions，全仓 typecheck 8/8、docs check 和 `git diff --check` 通过。P4 再次完成。

### P5：Benchmark rollout

非 UI contract → 2–3 个代表性中长链路 → finalist holdout → OpenCorvus 完整十 case → 真实 UI 人工复核。
其他客户端只作横向参考，不与 OpenCorvus candidate 组成因果 paired comparison。

P5 实施前独立评测审查发现两项必须回开 P4 的数据契约缺口。第一，既有
`comparison-recommendation@1` 只能保存 paired mean/variance、cost delta 与笼统 unavailable，无法保存
本方案已要求的 median、预声明置信区间、win/tie/loss、两臂 failure/unavailable rate、token/activity delta
及 required dimension unavailable 时的 nullable aggregate。第二，CampaignSpec 同时把 development 与
secret holdout 放入 Candidate Author 可读取的同一资源闭包，无法证明候选没有看到 holdout。

正向修订为：每个 Campaign 只冻结一份 Dataset，并显式声明 `dataset_partition` 为 development、holdout 或
certification。Candidate preparation 只接受 development Campaign；候选 digest 固定后，Mission 创建不再包含
Candidate Author 的全新 holdout Campaign 并重跑 baseline。候选发生任何修改时，旧 holdout 只作为失败实验
历史保留，必须从新 development Campaign 开始。Comparison ABI 同步扩充完整预声明统计量与 nullable
aggregate；不把额外统计塞入 unknowns、旁路报告或 UI shadow state。

P5 唯一 launcher 只负责严格校验显式输入、启动隔离 Project/server、发送真实 Mission 请求、按 canonical
Task/Session/Message/Part/Tool/Artifact/interaction activity cursor 计算 scheduled inactivity wake，以及导出
最终 Artifact index。它不得 dispatch、补建 Trial、自动重试、根据分数推进或安装候选。十 Case 的 prose
必须先冻结成 machine-readable Task Artifact resources；provider/model、target revision、benchmark tenant、
credential-source identity、permission/config snapshot、预算和 repetition 全部显式输入，不搜索替代 provider、
`.env` 或默认 endpoint。

生产调用复核另发现：P3 executor 已定义 streaming judge contract，但 P4 `MetricEvaluationHost` 没有注入
真实 judge runner，任何 judge scorer 都只会得到 `provider_unavailable`。P5 前必须接入唯一 production runner：
只使用 scorer 明示的 provider/model、criteria、rubric 与 inactivity timeout；完整 selected evidence 是唯一输入；
LLM 调用必须 streaming、零重试、无启动时 hard timeout，每个真实 delta 推进 inactivity cursor，最终只能产生
一个冻结 rubric 内的 score。无活动、provider error、输出格式错误分别保留 typed unavailable，不搜索替代
provider/model，不使用旧分数或 query/shell 代替语义 judge。

Production judge 首轮独立审查 `BLOCK`：普通 Error 被统一误报为 `provider_unavailable`；protocol 与未转义
evidence 同处 user message；binary evidence 被无界 base64 注入文本模型；空 text delta 也会伪造活动。根治契约
为：runner 分别抛出 typed inactivity、input 与 parse error，executor 精确映射为 `inactivity_timeout`、
`input_unavailable`、`parse_failed`；不可变 judge protocol 独占 system role，criteria/rubric/evidence 作为 JSON
数据消息传入；judge scorer 必须冻结 `max_evidence_bytes`，只接受 strict UTF-8 text 与 JSON evidence，其他媒体
typed unavailable；只有非空真实 delta 才更新 activity cursor。Provider/model lookup 或真实 stream failure 才是
`provider_unavailable`。

第二轮独立复审确认上述运行时代码正确，但因测试只注入 fake `JudgeRunner` 而继续 `BLOCK`。根治后，production
runner 由显式 dependency object 组合唯一生产依赖，非网络契约测试真实调用同一 factory，正向证明
EffectiveConfig → exact provider/model → language/wrapper → system/user messages → `timeoutMs: false`、`retries: 0`
的完整调用参数，并证明 empty-only stream 触发真实输出 inactivity。共享 Plugin schema 现按 `evaluator_kind`
discriminated validation 五类严格 `evaluator_config`，executor 复用同一 schema；Evolution Lab 自包含 Skill 与
`scorer-contract.json` 同步声明 Judge 必填 provider、model、inactivity、byte budget、criteria 与 rubric。Judge
额外拒绝 unsupported media、非法 UTF-8 与伪装成 `application/json` 的无效 JSON，统一映射 typed
`input_unavailable`。聚焦三文件复测为 12 pass / 125 assertions；第三轮独立终审复跑相同契约并
`APPROVE`，确认无 fallback、状态机、隐式模型选择、非流式调用或额外运行路径。

P5 launcher 独立代码定位确认现有成熟 primitive 足以创建隔离目录、启动真实 server、调用唯一
`POST /mission/wake`、读取 Mission status 与导出 terminal child Task Artifact index；launcher 不得复用绕过生产
route 的旧 mission script，也不得调用业务 wait 污染活动事实。调查同时发现两个 launcher 前置缺口：第一，公开
API 尚无可重启恢复的 Mission 级 canonical durable activity cursor，必须从现有 Task run-evidence 的唯一活动
定义抽出共用 read owner，再投影 Mission 与全部 child Task 的精确 occurrence；第二，总 benchmark manifest 与原始
需求包含 holdout，绝不能进入 Candidate Author 可读项目。生成物现新增独立
`development-manifest.json`，只含 Case 3、4、10；父 launcher 在隔离项目外校验总 manifest，项目内只能复制该
development index 与三份 exact Case bytes。holdout/certification 必须使用不含 Candidate Author 的新 Project/
Mission/Campaign closure。

P5 实施进一步暴露并根治两个运行时断点。第一，`expectedPackageDigest` 原先只能与当前安装 revision
比较，已由 Candidate Author 验证并物化到 content-addressed revision store 的 external candidate 仍无法创建
Trial。正向契约现允许 Task 在 active external package 提供精确 scope/project/id/namespace 身份的前提下，直接
绑定同 id/namespace 的已物化 immutable digest；它不修改 installed catalog，built-in unpublished candidate 仍
明确不可运行。独立审查 `APPROVE`，测试正向证明 installed baseline 保持不变、candidate Task 与后续 scheduler
精确使用 candidate revision。

第二，首版 Mission cursor 复用了混合用途 `Task/Session.time_updated`，改名、权限、配置与归档会伪造执行活动，
且既有 Mission Task 列表会排除 archived Task。独立审查据此 `BLOCK`。canonical durable activity owner 已改为
Task 的明确 created/started/completed 执行时间、Session created 时间，以及 Message、Part、Engine Artifact、
Interaction Request 的持久活动 occurrence；Mission activity membership 使用仍存在的全部 Mission-bound Task，
archive 不再删除历史执行 scope。Task run-evidence 与公共 Mission route 共用该 owner。正向测试证明 title/config
类更新时间与 archive 后仍返回同一 exact execution occurrence，并通过生成 SDK 调用生产 route。

唯一 launcher 已落为显式 `start`/`resume` 命令。strict envelope 冻结 exact server binary/config、隔离 Project
seed、credential-source identity、test tenant、permission/scorer/statistics 资源、target/Evolution Lab digest、
Case 3/4/10、三次重复、完整 18 个唯一 slot、budget 与 inactivity window。server 必须以已哈希 binary、空 prefix
args、隔离 Project cwd 运行；runtime config 与 development/control resources 复制进隔离 root，父路径、总 manifest、
原始十 Case 和 holdout/certification bytes 不进入 Project。launcher 只 project-import baseline、发送一次真实 Mission
wake、持久化 exact cursor/deadline、按 deadline scheduled wake、导出 Mission status 与 Session turn-artifact index；
不创建/dispatch Task，不补 Trial，不重试/替换 provider，不读取分数推进，不安装 candidate，不 promotion/restoration，
不回答 interaction。`resume` 校验 exact config SHA-256，并按已持久化 deadline 的剩余时间继续，不能重置 inactivity
窗口。

P5 首次完整终审继续 `BLOCK` 五项：固定 source/id tie-break 会漏掉同毫秒新增 occurrence；launcher 只有
schema test；路由测试加载完整 Server 导致多文件 singleton 冲突；配置的 Evolution Lab digest 没有与运行中
server bundled bytes 绑定；父 launcher 未读总 catalog 且 arbitrary seed 可能携带 holdout。修订后，Mission cursor
新增对完整 canonical activity scope 的 SHA-256，launcher 只比较该指纹；正向测试在相同毫秒追加第二条 Message
并得到两个不同 scope digest。catalog summary 现对 built-in/external 一律公开 exact package digest，launcher 在 wake
之前从运行中 server catalog 校验 Evolution Lab 与 target digest。父进程读取并校验 total catalog，要求独立
development manifest 精确等于 Case 3/4/10 partition，并拒绝 seed 中出现原始总需求或任何 non-development Case
的 exact bytes；每个 18-slot 复制独立 execution directory，Mission 只获得这些目录。launcher 行为测试通过 injected
server boundary 真正执行 production start/resume 核心，正向断言一次 import/catalog/wake、两次 scheduled cursor
读取、status/turn-artifact 导出、close、18 个隔离 workspace、development-only resource inventory，以及 resume 沿用
持久化 deadline。路由测试改用局部 Hono production route，三项测试同进程执行 8 pass / 50 assertions，不再污染
Task wake runtime singleton。

第二次终审继续指出：resume 必须重新校验 binary/package/runtime catalog；restricted Dataset 校验必须发生在任何
Project 写入之前；scope digest 还必须识别同一 durable row 在同一毫秒内的内容 revision。最终实现把
`validateLaunchInputs` 提到所有 mkdir/copy 之前，start/resume 都校验 exact binary、runtime config、seed tree、
package sources、total/development Dataset 与 control assets；resume open server 后同样先校验 running catalog digest，
再读取 activity，且不发送第二次 wake。activity scope digest 现在还绑定 Task execution fields、Message/Part data、
Artifact catalog revision/payload SHA-256 与完整 Interaction row 的 per-row revision digest。同毫秒“新增 Message”及
随后“原 Message 同毫秒内容更新”产生三个不同 scope digest。聚焦联合测试更新为 8 pass / 51 assertions。

P5 第三轮独立终审 `APPROVE`：确认 validation 先于任何 filesystem mutation，resume 重验 exact runtime identity
且不 wake Mission，activity digest 能识别同 row/同毫秒 revision，running catalog digest 与 development-only
物理 closure 均被绑定。独立复跑 combined focused suite 8 tests / 51 assertions、full typecheck 8/8、API route
inventory 与 `git diff --check` 全部通过，无剩余 P5 实现 blocker。

首次真实开发集启动在 `mission.wake` 前被 running-catalog digest 校验安全拒绝：Evolution Lab 是随应用 payload
发布但需显式 release 到 Project 的普通 package，不是三个内嵌 core squad；首版 launcher 只导入目标 baseline，
测试 fake catalog 却预置了 Evolution Lab，因而掩盖了缺失的正式 provisioning。正向修复为 start 通过公共
`expertSquad.installPayload` 把二进制自带的 `evolution-lab` 精确 bytes 安装到隔离 campaign Project，严格验证
namespace、ID、project scope 与 frozen digest 后才导入 baseline、校验 effective catalog 并发送唯一 wake；不同
既有 bytes 由 Manager typed conflict 拒绝，resume 不重复 provisioning、import 或 wake。失败 run `-01` 的目录、
server log 和未产生 checkpoint 的事实原样保留，不复用或删除。

追加独立只读复审 `APPROVE`：确认该调用符合显式 payload release 单一协议，不激活 package、不覆盖不同 bytes，
没有 fallback、第二 active source、状态机、候选安装、晋升、重试、interaction answer 或生产 Project mutation。
独立复跑 launcher + Evolution Lab production projection 为 3 pass / 43 assertions，full typecheck 8/8、API route 与
diff check 通过。新原生二进制 digest 与 `-02` launch envelope 已重新冻结并在任何运行目录创建前完成预检。

真实 run `prism-development-20260806-02` 成功执行唯一 `mission.wake`，但最终以 Mission `inactive`、0 child Task、
0 Artifact 结束。不得把 inactive 当根因：durable chronology 显示 Mission 已完成 17 轮、67 个 tool call；第 18 轮
读取 Evolution Lab `lib/evolution-lab/artifacts.ts` 时，纯 read 在文件内容已取得后同步等待 TypeScript Language
Server Protocol（LSP，语言服务器协议）warm-up。LSP initialize 45 秒后 connection dispose，但 Windows process-tree
cleanup 没有 settle，read part、owned PID 与 `state.spawning` 一直保持 running，直到 launcher 按最后真实 Part
activity 的 10 分钟 inactivity window 导出结果。失败 run 的 checkpoint、result、server log 与数据库原样保留。

根治分三层：ReadTool 使用显式 `LSP.warmFile`，让可选 warm-up 不再成为已完成文件读取的前台条件；initialize 与
dispose 双失败聚合进 typed `LSPInitializeError` cause，Windows cleanup helper 自身也用真实 bounded Promise
termination 保证调用必然 settle；native `--kill-tree` 先终止 owner 冻结新后代，再按 snapshot deepest-first 回收。
真实 nonresponsive LSP 测试正向证明 owned process 获得 terminal exit/signal、schedule occurrence 清零、server
标记 broken、后续 wait-for-diagnostics touch 获得终局；Rust 测试正向证明 owner 以 TerminateProcess code 1 结束且
snapshotted descendants 均为 `WAIT_OBJECT_0`。edit/write/apply-patch 的成功 diagnostics 等待契约保持不变。

该修复经过三轮独立只读审查：首轮阻止只解耦 read 而遗留 PID/`state.spawning` leak；第二轮要求聚合 disposal
failure、使用当前 helper binary、跨平台 terminal disposition 并穿过真实 schedule；第三轮把负向 `!success()`
改为精确 code 1 正向契约后最终 `APPROVE`。最终 Rust 2/2、Bun 3/3（7 assertions）、full typecheck 8/8 与
`git diff --check` 通过。

真实 run `prism-development-20260806-03` 已越过此前 LSP 断点，成功创建 Candidate Preparation child Task 并
发布 3 个 Engine Artifact；但 Experiment Planner 随后通过 Bash 执行宿主级
`find /c/Users/chuan ...`，读取边界已越出隔离 Project。launcher 立即终止本次 run，保留数据库、日志、Task、
Artifact 与 running tool input 原始证据，不生成或伪造 comparison/result。该失败不能归因于 `find` 命令：
`external_directory` 只是模型调用前的 permission rule，Bash 最终仍以 server 的操作系统身份在宿主 Shell 中
执行；静态路径解析只覆盖少数命令，解释器、变量、子 Shell 和绝对路径均可绕开。把 permission 改为 deny、补
命令关键字、只改 cwd/worktree 或事后扫描都不是隔离，明确禁止。

进一步全链路审查推翻了“一个 campaign Project + 18 个 sibling execution directory 已足够隔离”的旧判断。
同一 Project 的 direct file tools 会把整个 Project 视为内部；Trial 可以观察其他 slot、Candidate、control 与
Evolution Lab 资源。Bash 还继承 server environment；只从 child environment 删除 provider key 仍不足，因为
同一用户/进程命名空间的 child 可观察 parent `/proc`。因此此前 P5 代码契约审查通过只证明 launcher identity、
activity、partition 与 resume 逻辑正确，不构成真实实验隔离或 benchmark 通过。P5 状态回退为
`isolation_runtime_unavailable`，直到以下单一执行边界完成并通过真实运行验收。

P5 新增 Task Execution Capsule（Task 执行舱）作为不可变 creation fact。每个目标 Trial 只获得一个 exact slot
workspace、一个 Case、一个 exact arm package revision、固定工具链与专用临时目录；Candidate、Evaluator 与
Mission 分别获得自己声明的最小资源闭包。descriptor（描述符）以 digest 固定 mount、读写模式、环境变量名称、
网络 capability、runtime/toolchain identity 和资源预算；不存在 runtime、digest 不一致或 mount 失败时返回 typed
unavailable，禁止回落宿主执行。Host 只校验 descriptor 数据完整性并启动同一个 executor，不根据 phase、status、
score 或命令内容推进流程，因此它不是 campaign 状态机或 gate。

三路独立仲裁最终收敛为 split-plane（控制面/执行面分离）Capsule：Host 控制面继续拥有 LLM/provider streaming、
scheduler、Database 与 Artifact；每个 Package Tool bundle 的 introspect/execute 也必须整体进入对应 Task OCI
（Open Container Initiative，开放容器倡议）worker，Host 只通过结构化 Remote Procedure Call（RPC，远程过程调用）
代理显式 ToolHost capability。所有受模型输入塑造的 data/operating-system effect 都进入 Capsule：Read/Edit 等直接
文件工具使用 Task-bound exact-root broker；Bash、LSP、compiler、package manager、local MCP、Browser sidecar 和
Package Tool worker 消费同一 descriptor。Package Tool 仍是 frozen trusted extension，不把本设计包装成 hostile-code
sandbox；即使 trusted code 直接调用 runtime global，它也只能看到单 Task workspace、private tmp/home、read-only
toolchain 和 private network。Host control plane 不执行 Agent command；跨 Task 数据只通过 immutable Artifact import。

当前机器没有 Docker/Podman；唯一 P5 executor 已实现为 WSL2 Ubuntu 上的 rootless `runc` Task Container。Host
controller 由 transient systemd service 持有，Task container service 以 `BindsTo` 绑定 controller，并配置独立
user、mount、PID（Process Identifier，进程标识符）、IPC（Inter-Process Communication，进程间通信）、UTS
（UNIX Time-sharing System，主机身份隔离）、network 与 cgroup namespace。rootfs read-only，只 bind exact
workspace 为 read-write、冻结 `/usr`/`/etc`/`/opt` 为 read-only，`/tmp` 与 `/home` 为 Task-private tmpfs，fresh
`/proc`，普通 exec capability 为空且 `no_new_privs`。Provider credential 留在 Host；child environment schema
强制为空。任一 descriptor、binary、toolchain、namespace 或 systemd/runc attestation 失败都 fail closed，禁止
native ProcessSupervisor fallback。

每个 Task child 默认无网络；需要外部服务时只能通过 descriptor 明示 endpoint/test-tenant capability 的 Host egress
broker，不把 provider secret 或 broker socket交给 child。Child root 只 mount 一个 exact slot、read-only
digest-addressed toolchain/package revision 与 private tmp/home/cache，不 mount campaign root、sibling、controller、
holdout、Windows drvfs、`/mnt/wsl`、`binfmt_misc`、`/init`、Docker socket、SSH agent 或 Host runtime socket。
OCI 只是这些 kernel primitives 的成熟封装，不是必需产品依赖；当前 WSL2 executor 必须实现同等的 resource
closure、pivot-root、capability/FD（File Descriptor，文件描述符）清理与 attestation，不能退化为裸 `unshare`。

真实验收冻结为：每个 Task creation fact 保存完整 capsule/runtime/resource digest；baseline/candidate 除 arm
revision 与 slot identity 外 capability 集合完全相等；runtime attestation 精确等于 descriptor；真实 Trial 在
Capsule 内完成原始 build/test 并发布 terminal Artifact；对 parent repo、holdout、controller、sibling slot、绝对
路径、symlink、WSL interop、outer PID 与 provider credential 的访问分别产生 typed capability/操作系统拒绝且返回
零资源 bytes；所有 Agent tool/process PID 均归属对应 Capsule；controller 终止后 descendant inventory 为零；
resume 重建同一 descriptor digest。上述证据缺一项，P5 不通过，也不得进入 finalist holdout。

截至 `prism-development-20260807-04` 启动前，P5 已完成以下实现与复核：Task creation transaction 固定 Capsule
binding；所有 process/tool、MCP、Browser、LSP、scorer、Package Tool file/process effect 统一消费该 binding；文件
broker 使用 parent directory file descriptor 与 `O_NOFOLLOW` 逐级锚定，递归 copy 不再使用 lexical reopen；
Package Tool bundle 不再由 Host import/execute；controller 使用 transient `.service`，正常 close 与 readiness failure
都先用冻结 systemctl stop exact service、确认 inactive，再回收 broker client；controller MainPID 被直接终止的真实
测试证明 Task service、child 与 runc inventory 归零。runtime descriptor 每次安全边界重新 attestation；Package Tool
introspect/execute 使用由 launch `inactivity_window_ms` 单源配置的真实无活动超时，stdout、stderr 和 RPC activity
都会续期。独立 architecture、candidate/promotion 与 Capsule boundary Reviewer 对确定性代码边界最终均批准进入
真实 18-slot run；Reviewer 同时要求用真实 run 补齐 Package Tool OCI activity/timeout、18 个精确 slot、完整 Artifact
链和 terminal descendant inventory，未获得这些证据前 P5 状态仍是 `running_validation`。

真实 run `prism-development-20260807-04` 在 server 发布随机端口前以 code 1 退出；当次 launcher 只保留了
`systemd-run` client 的内存 output，却没有把它写进早退 error 或文件，随后 cleanup 又对已由
`CollectMode=inactive-or-failed` 回收、显示 `Unit ... not loaded` 的 controller unit 执行 stop，最终栈被二次错误
污染。证据不足以证明 server 为什么退出，因此禁止把 code 1、unit not loaded 或 cleanup 当作根因。修复后的
readiness 由 stdout/stderr capture 直接更新单调 clock，以最后一次 activity 计算 15 秒无活动窗口；每轮先消费
最新 output 再判断 inactivity，typed early-exit error 完整保留 controller 原始首尾字节。已 terminal 的
systemd-run client 只执行 supervisor settle，仍在运行但无活动的 controller 才执行 exact unit stop、inactive
attestation 和 client settle。正向契约以受控时钟证明第 15000 毫秒到达的 readiness activity 会续期并成功返回，
同时验证 exact exit code、尾随换行与 error message。独立架构 Reviewer 终审 `APPROVE`，未发现 fallback、兼容
双路、持久化状态机、清理泄漏或新确定性 blocker；下一步构建新二进制并使用新 run ID 继续真实验证。

真实 run `prism-development-20260807-05` 在 controller 启动后约 1.7 秒退出，完整错误落在
`runtimePackageRequireForExecPath`：复制后的 run 只有 131,848,512 字节 executable，而发布目录还包含相邻
`package.json`、约 14,431 个 `node_modules`/native runtime 文件、`bin/rg`、`bin/officecli` 和
`browser-mcp-node` sidecar。packaged runtime resolver 明确拒绝从父目录 `node_modules` 解析，因此根因不是 OCI、
controller 或模型，而是 launch 把完整发布闭包错误建模成单一 `server_binary`。

正向契约已唯一替换为 `server_runtime { source_directory, tree_sha256 }`，旧字段和单文件 copy 均删除。start 在
任何 run 写入前验证 source 完整树 digest、两个 package JSON、成熟 build executable 清单中的普通文件与执行权限；
随后完整复制到 run-scoped `control/server-runtime`，用现有 runtime executable normalizer 恢复全部 native binary
mode，再对 persisted tree、descriptor、target package 和 toolchain 重新 attestation，关闭 source 校验与 copy 之间
的竞态。server 只从 persisted `control/server-runtime/opencorvus` 启动。resume 不读取或恢复 source runtime，只
接受同一 persisted closure；缺失或 digest 漂移直接失败。Capsule descriptor 同时记录
`server_runtime_tree_sha256`，但 control runtime 不 mount 给任何 Task。聚焦 start/resume 正向契约已用完整 fake
runtime closure 验证。descriptor/schema 修复进入新 packaged server 后，真实发布目录 digest 重新冻结为
`ab8f66f29aa9c3fa4ba4253717bab209a92a97813762978e4393fa928a4b909d`；等待全新 run。

首轮独立复审阻止把“若干固定文件存在”误称为完整 dependency closure：fake executable 即使没有
`node_modules` 仍可通过结构检查。根治复用 build 的 `artifactRuntimeNodeModules` 唯一清单，在主 server runtime
与 browser sidecar runtime 各自从 co-located package JSON 建立 Node require owner，递归解析全部声明 dependency
和显式 native runtime dependency；每个 resolved package 的 realpath 必须仍位于对应 runtime root，manifest name
必须精确匹配，禁止向父 repo `node_modules` 解析。production `spawnServer` 在 systemd 打开 executable 的最后使用
边界再次执行完整 persisted attestation，保留 launcher 层 start/resume 的显式验收而不依赖 injected runtime。
另一项 strict schema 漂移也已修复：生产 `ExecutionCapsuleRuntimeDescriptorSchema` 声明
`server_runtime_tree_sha256`，launcher 对 persisted descriptor 直接使用该生产 schema parse，正向测试读取真实
生成的 descriptor 并断言 digest；Task binding 仍只以完整 descriptor SHA-256 作为单一 runtime revision 身份。

真实 run `prism-development-20260807-06` 首次证明完整 14,431-file packaged runtime 可从 run-scoped closure 启动：
controller 进入 active，动态 runtime package require 成功，随后 Mission wake 以精确
`ProviderModelNotFoundError(deepseek/deepseek-chat)` 失败并按 controller cleanup 合同退出。调查确认
`systemd-run` client 拥有 `isolatedEnvironment`，但 transient service 默认不继承 arbitrary client environment，
所以 server 未获得 `OPENCORVUS_CONFIG`、`OPENCORVUS_HOME` 和 `DEEPSEEK_API_KEY`；错误不是模型 catalog bytes、
OCI 或 provider endpoint 本身。首版 `--setenv=NAME` 修复经独立审查发现仍会让 user manager 的 ambient environment
进入 controller，不能满足“未声明 credential 不可达”的隔离合同，因此未进入下一次 run。最终实现让 systemd 只按名称
复制声明变量，再由冻结 Node wrapper 根据声明名称集合构造 exact environment 并启动真实 packaged OpenCorvus；secret
value 不写 argv、journal、descriptor、文件或 Artifact，manager ambient variable 不进入真实 controller，Task child environment
仍固定为空。聚焦契约在 Linux Node 语义下验证 exact environment 和 name-only 参数；真实 WSL transient service probe 先向
user manager 注入未声明变量，再证明最终子进程环境严格等于 `{"DECLARED_PROBE":"declared-value"}`，证据保存在 run
根目录的 `controller-env-systemd-probe-20260807.json`。独立架构复审已确认 manager ambient credential、argv secret、
service lifecycle 与 Task child environment 四条边界闭合并给出 APPROVE；下一次真实复测必须使用新 run ID。

### P6：读面

最后增加 Evolution history、context-scoped comparison、evidence completeness 和显式 promotion/restoration UI，
并用真实页面与截图人工验收。

## 二十三、完整影响面矩阵

| 影响面 | 当前事实 | 方案动作 | V1 状态 |
| --- | --- | --- | --- |
| Active identity | `prompt_profile.active` 唯一 | 保持不变 | 复用 |
| Task package bytes | 首次 workflow 后才固定 | 创建事务写 creation binding | 必须先修 |
| Task follow-up | binding 前可换 profile | 全生命周期禁止换 ID | 必须先修 |
| Registry snapshot | 已内容寻址、无自动 prune | 直接复用 | 可用 |
| Manager replace | 有锁、无 expected-current CAS | 锁内 digest CAS | 必须先修 |
| Project/global override | project 覆盖 global | receipt 显示真实 effective scope | 复用并补证据 |
| Built-in Squad | 禁止外部同 ID collision | 只评测，晋升走产品发布 | V1 不热更新 |
| Authoring | SDK writer + Registry + Manager | exact parent checkout + 同一路径写入 | 需窄工具 |
| Configuration | 按安装 identity，不按 digest | campaign 专用配置，两臂一致 | 必须建模 |
| Secret | 0600 store，读面隐藏值 | 不进 Artifact/trace | 必须验证 |
| Permission | Task config snapshot | 两臂完全相同，interaction 保留 | 必须验证 |
| Tool/MCP | trusted executable / remote side effect | V1 冻结 bytes，隔离账号 | 必须验证 |
| Mission | 同 Project 固定 profile Tasks | 协调 campaign，不保存状态机 | 复用 |
| Cross-Task Artifact | 同 Project/Mission lineage | 单 campaign Project | 复用 |
| Artifact owner | type 必须 Squad ID 命名 | `evolution-lab/...` | 必须新增 package ABI |
| Metrics | Task-local，P4 已接入 Evolution Lab caller | 只作 observation，另建 experiment Artifact | 不可作为运行时 rank router |
| Scorer evidence | hard timeout、伪 URI | inactivity + exact evidence | 必须修 |
| Model/provider drift | alias 可能漂移 | 记录 exact 可得 identity/限制 | 必须建模 |
| Queue/restart | first wake 读 live catalog | creation pin | 必须修 |
| Reopen/rewind | 多 terminal facts / 读投影 | exact lifecycle ref | 必须建模 |
| Retention/delete | Task delete cascade Artifact | 永不自动删，显式删除显示影响 | 必须补读面 |
| API/SDK | 无 expected digest/receipt | schema、route、OpenAPI、SDK 同步 | 必须改 |
| Overlay/catalog | 有单一 refresh token | 加只读历史，不加 active rank | 后置 UI |
| Storage/cost | snapshots 可去重 | 报告存储/token/cost | 必须度量 |

## 二十四、验收指标

1. Task 在 digest A 安装时创建并提交 creation binding A；first wake 前安装切到 B 且进程重启，scheduler、
   worker、Tool、workflow、Completion 仍全部绑定 A。
2. expected digest mismatch 在 Task 可见前返回 typed result，零 Task/Artifact/queue 副作用。
3. 同 requestID/channel 对相同 profile/digest 返回原 Task，对不同 profile/digest 返回 typed conflict。
4. Task 创建后任何不同 `promptProfile` follow-up 都返回 immutable error；同 ID 不改变 pin。
5. Resolver 完整投影等于 pinned package 声明，workflow binding revision 与 creation binding 全字段相等。
6. Manager 在同锁内校验 expected current；冲突保留当前安装，成功返回 before/after exact receipt。
7. 单一 campaign Project 可创建两臂全部 pinned Tasks，生产 project/global digest 在显式 promotion 前不变。
8. 两臂 workspace initial digest、模型、环境、permission、configuration、budget、Dataset 和 Scorer 全部相同。
9. Candidate changed paths 仅位于 V1 白名单，冻结 closure 与 parent 完整相等，Registry 验证 package 自包含。
10. 每个 run 可追溯 Case、Dataset、Scorer、model、environment、Task、Session、Message、Tool、Artifact、
    workflow、Completion/failure、package revision 和 projection hash。
11. 每个 numeric score 引用 exact immutable evidence；unavailable 永远是 null + typed failure。
12. 所有 timeout 以最后真实 activity cursor 为准，runner restart 不重置窗口。
13. failed/cancelled/inactive/awaiting-interaction/unavailable trial 全部保留在 comparison。
14. 没有 metric-to-dispatch、metric-to-retry、metric-to-completion、metric-to-promotion 或自动 restoration 路径。
15. 普通 Task 下次执行只使用 installed catalog revision，不读取历史 rank。
16. 所有候选 package snapshot、campaign Artifact 和 score 不自动删除；显式物理删除前展示完整影响。
17. production secret、OAuth token、header、environment credential 不进入任何 Evolution Artifact。
18. 外部 side effect 使用测试 tenant/endpoint，并保留 receipt；production action 为零。
19. UI claim 具有真实页面、真实交互、Task/region screenshot 和人工 review，且没有 UI 自动化测试改动/执行。
20. promotion/restoration 具有用户授权和 exact CAS；旧 Task 继续旧 pin，新 Task 使用 commit 后 revision。
21. project/global、同 ID project override 和 built-in target 按本方案各自得到正确、无 fallback 的处理。
22. 不新增第二 active 字段、Harness/experiment lifecycle 表、current/latest pointer、alias、host workflow engine
    或 campaign-aware Resolver/Registry/Manager。
23. benchmark 通过后，独立 Reviewer 重新打开 raw evidence、candidate diff、unavailable、视觉证据和 receipt；
    二次 review 不通过则不得宣称完成。

## 最终回答

### 是否已经覆盖方方面面

本次已把当前仓库可识别的主要运行时、数据、权限、配置、安装、执行、评测、UI/API 和运维影响面纳入矩阵，
比前版完整得多；不能诚实声称未来不存在任何未知。尚未通过实现和真实 benchmark 证明的部分，均明确标成
“必须先修/必须建模/后置 UI”，不包装成已具备能力。

### 推荐触发与执行策略

~~~text
用户或显式 Automation 唤醒 Evolution Mission
        ↓
Opportunity + Failure Attribution
        ↓
冻结 CampaignSpec
        ↓
生成 2–3 个完整文本策略候选
        ↓
低成本 regression corpus
        ↓
incumbent 与 finalist 配对长链路
        ↓
独立多维评分、未知项和安全审查
        ↓
静默生成晋升建议
        ↓
用户显式批准
        ↓
Manager CAS 原子安装；只有新 Task 使用新 revision
~~~

### 对“快照、分数、静默升级、rank”的最终裁决

- 快照、trace、分数、比较和 receipt 全部不可变并永不自动删除。
- 不要求每次生产执行都评分，只评估明确进入 campaign 的运行。
- 候选生成与隔离评测可以静默；生产安装绝不静默。
- 历史可以按精确 experiment context 派生 Pareto/rank，但下次普通执行不按 rank 动态选版本。
- installed catalog 是唯一生产 current；推荐采用 incumbent–challenger，而不是 global rank router。
