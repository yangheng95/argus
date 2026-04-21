# Bug: overlay Tauri 启的 opencorvus serve 子进程一接 UI 就陷入死循环

## 环境

- Repo: `C:\Users\chuan\myhexin-local\argus-opencode`
- 分支: `overlay-refactor-wip`（从 `dev` 分叉后累积 30+ commits，大部分是 overlay + opencorvus 重构）
- 平台: Windows 11, Bun runtime, Tauri overlay, Hono HTTP server

## 硬性规则（必读）

先读 `C:\Users\chuan\myhexin-local\argus-opencode\CLAUDE.md`。重点：

- 规则 1: **禁止任何 fallback / 兼容逻辑**（问题要在源头修，不补消费端）
- 规则 2: 未发布项目，**禁止保留旧范式**；修复必须同步删旧代码
- 规则 11: 发现死代码先问用户，别自作主张删
- 规则 12: **禁止最简单的修复 / 无分析的 patch / 关键字匹配规则**
- 规则 14: **禁止 DB migration**，直接 reset DB 按新范式重建
- 规则 15: 永远怀疑自己的方案；没证据就不要下结论
- 规则 22: **改动前后都 commit**

## 症状（观察到的事实，不是假设）

- overlay (Tauri) 启动后会 spawn `opencorvus-*.exe serve --port 7879` 子进程
- 子进程起来，端口 Listen 正常，**没有 UI 连接时 `/global/health` 返回 200 OK**
- 一旦 overlay UI（WebView2）打开并连接 serve：
  - 5 秒内 CPU 从 4 → 70+，内存从 620MB → 1.2GB，**单调上升不回落**
  - 所有 HTTP 路由（`/global/health`、`/`、`/ui/`）全部 **timeout**（不是 refused）
  - stdout/stderr 无任何异常抛出（不是 crash，是 event loop 被占住的死循环）
  - 6 条 Established SSE 连接一直挂着

## 决定性对比: benchmark 能用，overlay 不能用

`packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` 用 puppeteer 驱动同一份前端代码 + 同一份 server 代码，能跑通 3 轮 `ainvest-kimi` 任务（输出在 `packages/opencorvus/tmp-bench-reports/`）。benchmark 进程启动时在 bun 里 `Server.listen({port:0})` 直接 new 一个 server，设 `OPENCORVUS_HOME = temp.home` 到独立临时目录。

**两条路径的关键差异清单**（`bun run benchmark` vs Tauri spawn）：

| 维度 | benchmark | overlay Tauri |
|---|---|---|
| HTTP server 启动 | 进程内 `Server.listen()` | 子进程 `Bun-compile .exe serve` |
| OPENCORVUS_HOME | `temp.home` (独立 mkdtemp) | 继承 overlay 进程（多半未设 → 默认 `%LOCALAPPDATA%\opencorvus`）|
| env 变量 | 大量 `OPENCORVUS_*`（见 benchmark 第 371-436 行） | 仅 VERSION / CHANNEL / CLIENT (`packages/overlay/src-tauri/src/main.rs:572-574`) |
| UI 加载 | `page.goto("/ui/index.html")` + localStorage 预设 `oc_server_url`, `oc_auto_server=false` | WebView2 + `autoServer=true` + Tauri invoke 通道 |
| 项目目录 | 全新 `mkdtemp` 空目录 | 用户选的实项目（如 `ainvest2`）|

## 已排除的假设（不要再走这些弯路）

1. ❌ Rust `Stdio::null()` 吞日志 —— 手工用 PowerShell `Start-Process` 带 stdout/stderr redirect 启同二进制，UI 一连照样死
2. ❌ server 代码本身坏 —— benchmark 用同一份源码 3 轮跑通
3. ❌ DB 脏数据 —— benchmark 用 `OPENCORVUS_HOME=temp` 独立 DB；overlay 删 DB 也不解决（user 确认过）
4. ❌ 今天的 committed server-side 改动：
   - `68263a03d` `board.ts` 只加 2 行字段
   - `2f1ae37d5` `goal-pool.ts` 只改 1 个字符串字面量
   - 这俩 diff 单看都无法制造死循环
5. ❌ 端口冲突 / benchmark 残留进程抢资源 —— 已杀全部 benchmark 进程、重启 overlay 仍死
6. ❌ opencorvus 二进制本身有 bug —— 手工 spawn 同一 `.exe` 不接 UI 时健康

## 嫌疑范围（从大到小）

1. **overlay-refactor-wip 分支上的重构 commits** —— `dev..HEAD` 的 30+ 个 commits 里，server-side 大改动点：
   - `3a7f8c707` "structural cycle fix and interaction-card consolidation"（**名字就带 cycle，高度嫌疑**）
   - `56bc019b0` "rewrite card system — OOD model + unified stream"
   - `7f11324cc` "engine: converge status writes, per-run state, fallbacks, provider vendor split"
   - `655cc3d31` "workflow: split goal-scope step into declarable phases"
   - `b39ea7ad7` "正本清源: swap session kinds executor ↔ build"
   - `61ccb5896` WIP checkpoint (30+ 文件)
2. **event bus 架构可能的 echo loop**：
   - `packages/opencorvus/src/bus/index.ts` — `Bus.publish` 同步 dispatch + 转发 GlobalBus（line 82-99）
   - `packages/opencorvus/src/server/routes/task-message-protocol-bridge.ts` — subscribe Message.Event.* → bridgeEvent → EngineProtocol.emit
   - `packages/opencorvus/src/server/routes/app.ts:376` — `Bus.subscribeAll` 在 `/event` SSE handler 里，unsub 依赖 `stream.onAbort`
3. **Tauri-only 前端路径触发 server 特定调用**：
   - `packages/overlay/src/services/connection.ts` `checkConnection` 在 managed 模式下 8 次重试 + `syncLocalServerUrl`
   - 前端启动时 `configureApi({directory: ainvest2})` → 所有 HTTP 带 `X-Opencorvus-Directory` header，server 依此 provide Instance context
4. **Instance / GlobalBus 在切换 directory 时可能产生 cross-instance event storm**

## 可用的诊断工具

1. **已就绪的日志重定向**: commit `c49291284` 已把 Rust spawn 的 stdout/stderr 重定向到 `<app_local_data_dir>\logs\serve-<ts>.{out,err}.log`。**但需要 rebuild overlay 才生效**（`cd packages/overlay && bun run build:overlay`）
2. **手工 spawn serve 抓 profiler**:

   ```powershell
   $exe = "C:\Users\chuan\AppData\Local\ai.opencorvus.overlay\embedded\opencorvus-207264256-1776742743.exe"
   # 不支持 --inspect（bun compile 产物），但支持把 env / cwd / 参数都掌控在自己手里
   ```

3. **源码版 bun --inspect**（最精准）:

   ```bash
   cd packages/opencorvus && bun --inspect=0.0.0.0:9229 run src/index.ts serve --hostname 127.0.0.1 --port 17879
   ```

   然后用 Chrome `chrome://inspect` 连上，在 UI 一连上的瞬间 Record CPU Profile 10 秒，flame graph 直接指出吃 CPU 的函数
4. **bisect**: `git bisect start HEAD $(git merge-base dev HEAD)`，编译一次检查一次是否死循环

## 任务清单

### 任务 1: 定位死循环的**具体代码位置**

**不要再靠 grep 猜**。用 bun --inspect 抓 CPU profile（源码版 serve + puppeteer 模拟 UI 请求，或用户 overlay UI 连），拿 flame graph 给出 top frame 的函数路径。这是证据性定位。

### 任务 2: 根治修复

- 找到根因的具体代码位置（文件:行号）+ 说明**为什么**这段代码导致 busy loop
- 修复要符合规则 1/2/11/12/14：不 fallback、不兼容老代码、发现死代码先问、禁关键字匹配、DB 相关直接 reset
- 每次改动前 commit 一次基线，改完再 commit 一次（规则 22）

### 任务 3: 验证

- 重启 overlay（若修了 Rust 要 rebuild；只修 TS 只需重启 overlay 进程让它 respawn serve）
- 开 overlay UI，打开 DevTools Network，确认：
  - `/global/health` 200
  - `/event` SSE 连上且**持续有心跳**
  - 发一条消息，消息面板**刷得出**（这是用户最初的症状）
  - PID 稳定 CPU < 20、内存平台期

### 任务 4: 报告

在 `tmp-codex-findings.md` 写清楚：

- 根因的代码位置和机制解释
- 修复的 diff 摘要（文件 + 行数 + 思路）
- 验证步骤和结果
- 验证期间观察到的数据（CPU/mem 曲线、关键 endpoint 的响应时间）

## 不要做的

- 不要 bisect 省时间就直接 reset 到 dev（规则 2：必须**找到**并**修复**，不能回退回避）
- 不要"临时跳过"某个 subscribe 或"加个 early return" —— 规则 12 明文禁止
- 不要迁移 DB —— 规则 14
- 不要留 fallback（「如果上面失败则退到 null / 旧路径」）—— 规则 1
- 不要大改工作区以外的文件，不要动 `dev` 分支
