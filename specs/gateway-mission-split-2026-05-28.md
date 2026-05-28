# Gateway 基建 / Mission 上层编排 分家 — Spec

**Status**: Approved by user (3 design forks + naming confirmed 2026-05-28)
**Date**: 2026-05-28
**Supersedes**: `gateway-master-supervisor-2026-05-26.md`（上层 agent 概念全部迁出 gateway 命名空间）
**Author**: Claude Code, in conversation with user

---

## 0. TL;DR

把 `gateway-master`（上层任务编排/目标管理 agent）从 **gateway 基建命名空间**中拆出来，成为独立的 **Mission**。

- **Gateway 保留为基建**：transport / wake 接入 / channel ingress / control-message 路由 / `/gateway/stats|capabilities|control|channel` / panel **surface** `"gateway"`（远程/移动接入面）/ `@ai-sdk/gateway` provider。这些**不改名**。
- **Mission 是上层编排 agent**：agent id `mission`、actor `mission`、session kind `mission`、prompt `mission-core.txt`、title `Mission Control`、runtime path `.opencorvus/runtime/mission/<missionID>/`、route `POST /mission/wake`。
- 命名约定（用户 2026-05-28 确认）：**直接叫 `mission`，不叫 `mission-agent`/`mission_agent`**。
- Mission 是**满配协调者**（非 supervisor、非 "NOT executor"），但**不是 coding executor、不绕过 orchestrator**。
- Mission 派发的 squad/team task：`source: "mission"`、`metadata.actor: "mission"`、`metadata.mission.{id,session_id}`。

---

## 1. 用户确认的设计分叉（2026-05-28）

0. **命名 = `mission`**（不带 `-agent`/`_agent` 后缀）。人面文案可用 "Mission" / "Mission Control"。

1. **能力边界 = 协调者（不写代码）**
   tools.include = `read, glob, search_code, list, lsp, webfetch, websearch, mission_state, panel, memory, todoread, todowrite, question`。
   **显式不含** `bash / edit / write / apply_patch / url_screenshot / webpage_*`。
   能读分析项目、规划、委派、汇总、追问；具体执行交给 orchestrator-led squad/team。符合 rule 11 + "不绕过 orchestrator"。

2. **Panel 动作 = 协调集**（移除 create/query-only 限制，但仍由 host 按 actor 收窄 — rule 11）
   `MISSION_ALLOWED_ACTIONS` = `create_task, query_task, view_board, view_plan, view_tasks, send_task_message, cancel_task, reply_interaction, reject_interaction`。
   **不含** `replan_task / update_goal / delete_goal / retry_task / update_checks / set_executor / select_* / *_session`（属于 orchestrator 与桌面 panel_ui）。

3. **UI = 单页改名为 Mission**
   现有 operator 页 `Gateway Control` → `Mission Control`；`pageMode "gateway"→"mission"`；`Gateway.tsx→Mission.tsx`；i18n `gateway.*→mission.*` + `chat.role.gateway→chat.role.mission`。channel 运行时作为 Mission 页内**基建小节**保留（功能不变）。

---

## 2. 概念归属判定（rule 35 — 每个 gateway 字样逐项定性）

### KEEP as gateway（基建 / 第三方）
| 位置 | 性质 |
|---|---|
| `panel/capability.ts` PanelSurface `"gateway"`、`nonGateway` | 远程/移动接入 **surface**（基建） |
| `server/routes/gateway.ts` `/stats /capabilities /control/message /channel/:platform/message` | 基建接入/控制面路由 |
| `server/routes/app.ts` `.route("/gateway", GatewayRoutes())` | 基建路由挂载 |
| `channel/*`、`control/*` | channel ingress / control-message 基建 |
| `provider/transform.ts` `"gateway"` | `@ai-sdk/gateway` provider（第三方） |
| `overlay services` 的 channel/stats helpers | 基建数据源（保留） |

### RENAME to mission（上层概念）
| 位置 | gateway → mission |
|---|---|
| agent id | `gateway-master` → `mission` |
| actor | `gateway_master` → `mission` |
| session kind | `gateway` → `mission`（仅 `/master/wake` 创建，无其它 creator） |
| prompt 文件 | `gateway-master-core.txt` → `mission-core.txt`（全量重写） |
| prompt import const | `GATEWAY_MASTER_CORE` → `MISSION_CORE` |
| session title | `Gateway Control` → `Mission Control` |
| channelKey | `master:<id>` → `mission:<id>` |
| runtime path | `.opencorvus/runtime/gateway-master/<id>/` → `.opencorvus/runtime/mission/<id>/` |
| route | `POST /gateway/master/wake` → `POST /mission/wake` |
| 协议渲染 channel/role | session-mirror 的 `"gateway"` 渲染身份 → `"mission"` |
| overlay 上层控制面 | `pageMode/Gateway.tsx/gateway.css/i18n gateway.*/chat.role.gateway` → mission |

---

## 3. 全仓调用点清单（rule 35）

### 后端 src
- `agent/role-contract.ts` — AgentRoleID union `"gateway-master"`→`"mission"` + `all` 表项（改 description：满配协调者，去 "Does NOT execute work itself"）
- `agent/agent.ts` — import `GATEWAY_MASTER_CORE`→`MISSION_CORE`；agent key `"gateway-master"`→`"mission"`；NATIVE_DEFAULTS；tools 白名单（窄→协调者集）；注释
- `panel/capability.ts` — `PanelActor` enum `gateway_master`→`mission`、`derivePanelActor`（`"mission"` agent→`"mission"` actor）、注释
- `tool/panel.ts` — `GATEWAY_MASTER_ALLOWED_ACTIONS`→`MISSION_ALLOWED_ACTIONS`（协调集）；actor 判定；`create_task` 在 actor=mission 时 source 默认 `"mission"` + `metadata.mission.{id,session_id}`（server-derived，从 session metadata 读 mission.id，不可伪造）
- `tool/mission-state.ts` — runtimeBase 路径 `gateway-master`→`mission`；doc/描述
- `gateway/session.ts` → `mission/session.ts` — kind/title/channelKey/metadata.mission；函数名 `ensureGatewaySession`/`findExistingGatewaySession`→`ensureMissionSession`/`findExistingMissionSession`
- `server/routes/gateway.ts` — 删 `/master/wake` + `MissionID`/`newMissionID`/`MasterWake*`；保留基建路由
- `server/routes/mission.ts` — **新增** `POST /mission/wake`（kind=mission session + `SessionWake.wake({ agent: "mission" })`）
- `server/routes/app.ts` — 挂载 `.route("/mission", MissionRoutes())`
- `server/routes/session.ts` — import `enrichGatewaySessionTranscript`/`subscribeGatewaySessionMirror`→mission 名
- `protocol/session-mirror.ts` — `sessionRole==="gateway"`→`"mission"`；`stampGatewayPayload`/`enrichGatewaySessionTranscript`/`mirrorGatewaySessionBusEvent`/`subscribeGatewaySessionMirror`→mission 名；channel/resolvedRole `"gateway"`→`"mission"`
- `session/session.sql.ts` — `SESSION_KINDS` `gateway`→`mission`；改写注释（去 gateway-master 措辞）
- `engine/store.ts` — `findChildrenOfTask` 注释 "gateway-master dispatch path"→"mission dispatch path"

### overlay src
- `components/Gateway.tsx` → `components/Mission.tsx`（组件/类名/data-ui/i18n key）
- `store/page-mode.ts` — `PageMode "gateway"→"mission"`、`isGatewayPage→isMissionPage`、`setPageMode` 校验
- `services/gateway.ts` — `wakeMaster→wakeMission`、`/gateway/master/wake→/mission/wake`、`MasterWake*→MissionWake*`（channel/stats helpers 留存）
- `utils/gateway-helpers.ts` → `mission-helpers.ts`（`GATEWAY_REQUIREMENT_MAX_CHARS→MISSION_REQUIREMENT_MAX_CHARS`、i18n key `gateway.*→mission.*`）
- `utils/message.ts` — `AgentRole` `"gateway"→"mission"`、`AGENT_CARD_STAGES`、`normalizeAgentRole`（含 `gateway-master`→`mission`、`mission`）、`roleLabel`（`chat.role.gateway→chat.role.mission`）
- `utils/card-color.ts` — `"gateway"→"mission"`
- `components/Icon.tsx` / `Avatar.tsx` — role→icon 映射（图标资源可复用）
- `services/tree-writer.ts` — gateway session 卡片路由（如有专属分支）
- `main.tsx` / `index.html` / `styles/surfaces/gateway.css` — `data-page-mode="gateway"`→`"mission"`、css 改名 mission.css + class 前缀
- `i18n/en-US.json` + `i18n/zh-CN.json` — `gateway.*` 产品控制面 key → `mission.*`；`chat.role.gateway→mission`；channel 小节 key 迁入 `mission.channels.*`

### SDK / OpenAPI / docs
- `packages/sdk/openapi.json` + `packages/sdk/js/src/gen/{types,sdk}.gen.ts` — regen（`gateway.master.wake`→`mission.wake`）
- `docs/product/{en,zh-CN}/reference/api.md` — wake 端点路径/operationId
- `docs/product/{en,zh-CN}/concepts/architecture.md` — Gateway 基建 vs Mission 关系

### tests
- `test/gateway/master-route.test.ts` → `test/mission/wake-route.test.ts`（kind=mission、agent=mission、新 route、旧 /gateway/master/wake 404）
- `test/gateway/session.test.ts` — mission session（如保留）
- `test/tool/mission-state.test.ts` — 路径 mission
- `test/panel/actor-whitelist.test.ts` — actor `mission` 协调集允许/越界拒绝
- `test/panel/actor-provenance.test.ts` — actor=mission → source=mission + metadata.mission.*
- `test/panel/query-task.test.ts` — actor 名
- `test/agent/agent.test.ts` — `mission` 注册、协调者白名单、反向断言无 bash/edit/write、hidden primary
- `test/engine/interaction-permission.test.ts` — mission 命名（如涉及）
- overlay `test/gateway-i18n.test.ts`、`test/mission-launcher-component.test.ts` — mission 命名 + key

---

## 4. Mission → Squad/Team task provenance

Mission 不以 task 形式运行（它是一个 session），故 mission task 是**顶层 engine_task**，通过 metadata 关联回 mission session：

```
source: "mission"
metadata.actor: "mission"               // server-derived（derivePanelActor）
metadata.mission: { id, session_id }    // server-derived（actor=mission 时从 session metadata 读 mission.id；session_id=ctx.sessionID）
```

- `id`：mission session metadata `mission.id`（wake 时写入）。
- `session_id`：`ctx.sessionID`（mission 所在 session），可关联回 mission。
- squad/team 内部的 task→task 父子关系仍走既有 `metadata.parent_task_id` + `findChildrenOfTask`（engine/store.ts）。

UI 凭 `source==="mission"` / `metadata.mission` 可识别 Mission→Squad task，而非普通 panel workflow。

---

## 5. Commit 顺序（每步独立 revertable + 含测试）

1. 落盘本 spec + 旧 spec supersede 注记
2. agent identity + actor + panel（capability/panel.ts/role-contract/agent.ts）+ 测试
3. mission-core.txt 重写 + 删 gateway-master-core.txt
4. session kind + mission/session.ts + session-mirror + session.sql 注释 + 测试
5. routes 拆分（mission.ts + gateway.ts 瘦身 + app.ts 挂载）+ 测试
6. mission-state 路径 + .gitignore 核对 + 测试
7. overlay 改名（Mission.tsx + page-mode + services + helpers + message + css + i18n + main/index）+ overlay 测试
8. SDK/OpenAPI regen + docs
9. 全量 verify：targeted tests + typecheck + overlay build + i18n check + routes:check + docs:check

---

## 6. 验收（对应用户 brief）

- `rg "gateway-master|gateway_master|Gateway Master|Gateway Control|runtime/gateway-master|/gateway/master"` → 0（上层概念无残留）
- `rg "\bgateway\b"` 剩余项**逐一**确认是 infra/vendor/provider/protocol（panel surface、channel、@ai-sdk/gateway、stats/capabilities/control 路由）
- 新建 mission：用户先进入 Mission session（kind=mission，agent=mission）
- Mission 派发 → orchestrator-led squad/team workflow（source=mission）
- UI/protocol/task provenance 清楚区分 Gateway 基建（入口）/ Mission（用户目标管理层）/ Orchestrator·Squad·Team（执行层）

---

## 7. 不做（rule 5/6 防过度工程）

- 不新建第二个 Gateway 基建页（单页改名）
- Mission 不获得执行类工具（bash/edit/write）
- 不引入 MissionTable / 新 propose_task 继承（沿用 metadata + markdown 文件方案）
- 不改第三方 `@ai-sdk/gateway` provider 语义
