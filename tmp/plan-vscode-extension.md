# Opencorvus VS Code Extension 集成方案

> 落盘时间: 2026-04-29
> 本次修订: 2026-04-29，基于现有代码与 VS Code 官方文档复核后重写
> 硬约束: 禁止 fallback / 禁止双源 / 禁止隐藏消息分叉 / LLM 调用保持流式 / 超时按无活动计时
> 现有证据:
> - `packages/opencorvus/src/server/server.ts` 已提供 Hono HTTP API、`/global`、`/auth`、`/ui` 与 Basic Auth 中间件。
> - `packages/opencorvus/src/cli/cmd/serve.ts` 当前会在固定端口被占用时杀旧进程，这不适合 extension sidecar。
> - `packages/overlay/src/services/api.ts` 是 overlay HTTP 入口，当前直接 `fetch(apiUrl(...))`，并非只通过 SDK。
> - `packages/overlay/src/services/sse.ts` 使用原生 `EventSource`，VS Code webview 内不能靠普通 fetch shim 覆盖。
> - `packages/overlay/src/services/{connection,config,init,theme,window,workspace}.ts`、`store/settings.ts`、`utils/native.ts` 仍有 Tauri invoke 入口。
> - VS Code 官方支持 `webview.postMessage`、`asWebviewUri`、CSP、`localResourceRoots` 与 platform-specific VSIX。

---

## 0. 结论

方案方向可行，但原方案不能直接实施。需要修正四个根本问题：

| 问题 | 原方案风险 | 修正 |
|---|---|---|
| 把 overlay 当成 SDK 客户端 | 现有 overlay 主要走 `services/api.ts` 与 `EventSource`，只注入 SDK fetch 覆盖不到 UI 主链路 | 以 `HostTransport` 替换 overlay 的网络入口：普通 HTTP、资源 fetch、SSE 全部经同一 transport |
| 保留替代路径 | iframe 直连、terminal 模式、首次启动下载二进制、GitHub Release 备用分发都会形成双源 | 只实现 webview panel + bundled sidecar + platform-specific VSIX；不可用即显式失败 |
| sidecar 启动沿用 serve 语义 | `serve.ts` 会杀占用端口的旧进程，`Server.listen({ port:0 })` 内部还会先尝试默认端口 | extension 专用命令 `serve --managed-sidecar` 使用随机端口且不杀进程，通过 stdout 握手返回实际端口 |
| SSE 未纳入桥协议 | `EventSource` 不能带 Authorization header，也不能被普通 fetch shim 透明代理 | transport 增加 `stream.open` / `stream.close`，extension 端连接 sidecar SSE 后逐事件转发 |

本方案以一个单一产品形态交付：VS Code extension 启动本地 sidecar，overlay UI 作为 webview 静态资源运行，所有后端访问都经 extension host 的 transport bridge 转发到 sidecar。

---

## 1. 设计目标

| 目标 | 要求 |
|---|---|
| 单一后端 | 只复用 `packages/opencorvus` 的 HTTP API；不新增第二套业务 API |
| 单一 UI | 只复用 `packages/overlay`；不写独立 VS Code UI |
| 单一通信边界 | webview 不直连 `127.0.0.1`；普通请求、资源、SSE 全部经 postMessage transport |
| 单一二进制来源 | VSIX 内携带当前平台 sidecar；不依赖 PATH，不启动时下载 |
| 单 workspace 单 sidecar | 每个 VS Code 窗口 / workspace 一个 sidecar，由 extension 全权管理生命周期 |
| 明确失败 | 缺二进制、握手无活动超时、健康检查失败、平台不支持都抛出明确错误 |
| 远程宿主策略明确 | extension 必须运行在 workspace extension host；远程 SSH / Dev Container 需要安装对应远端平台 VSIX |

---

## 2. 架构

```
VS Code Extension Host (workspace)
  activate()
    ├─ BinaryResolver
    │    └─ bin/<vscode-target>/opencorvus[.exe]
    ├─ SidecarManager
    │    └─ spawn opencorvus serve --managed-sidecar --port 0
    │       env:
    │         OPENCORVUS_CALLER=vscode
    │         OPENCORVUS_SERVER_PASSWORD=<random token>
    │         OPENCORVUS_PRINT_PORT=1
    ├─ TransportBridge
    │    ├─ request/response: webview postMessage → sidecar HTTP
    │    ├─ resource: webview postMessage → sidecar HTTP blob
    │    └─ stream: webview postMessage → sidecar SSE → event messages
    └─ OpencorvusPanel
         └─ media/ui/index.html + assets via asWebviewUri

opencorvus sidecar
  Hono routes:
    /global/*
    /auth/*
    /ui/*
    app routes from AppRoutes()
  stdout:
    OPENCORVUS_LISTEN=127.0.0.1:<actual-port>
```

关键点：

- Webview 内没有真实 server URL。它拿到的是 `opencorvus://sidecar` 这类逻辑 base URL，由 overlay transport 转成 message。
- Extension host 是唯一知道 `127.0.0.1:<port>` 和 token 的进程。
- sidecar 不启动 Tauri overlay，不杀旧进程，不扫描 PATH，不读 marketplace 外的二进制。

---

## 3. VS Code Extension 结构

```
packages/vscode-extension/
├── package.json
├── tsconfig.json
├── esbuild.mjs
├── .vscodeignore
├── README.md
├── CHANGELOG.md
├── icon.png
├── src/
│   ├── extension.ts
│   ├── sidecar/
│   │   ├── binary-resolver.ts
│   │   ├── manager.ts
│   │   └── errors.ts
│   ├── transport/
│   │   ├── protocol.ts
│   │   ├── bridge.ts
│   │   ├── http.ts
│   │   └── stream.ts
│   ├── webview/
│   │   ├── panel.ts
│   │   ├── html.ts
│   │   └── csp.ts
│   └── commands/
│       ├── open.ts
│       └── attach-file.ts
├── media/
│   └── ui/
├── bin/
│   └── <target>/
│       └── opencorvus[.exe]
└── script/
    ├── build.ts
    └── package-vsix.ts
```

`package.json` 必须声明：

- `main: "./dist/extension.js"`
- `extensionKind: ["workspace"]`
- `activationEvents`: 只保留 `onCommand:opencorvus.open`、必要的 workspace 事件；不在 VS Code 启动时主动拉起 sidecar。
- `contributes.commands`: `opencorvus.open`、`opencorvus.attachFile`
- `engines.vscode`: 至少覆盖 platform-specific extension 支持版本；实际发布建议不低于当前主线稳定版本。

`opencorvus.openTerminal` 不进入方案。它会引入第二套交互入口，且会绕过 webview 的消息流和任务上下文。

---

## 4. Sidecar 协议

### 4.1 新增 extension 专用 serve 模式

不要复用当前 `serve.ts` 的固定端口治理逻辑。新增专用参数：

```
opencorvus serve --managed-sidecar --port 0 --hostname 127.0.0.1 --project-dir <workspace>
```

行为要求：

- `--managed-sidecar` 下禁止 kill 占用端口。
- `--port 0` 必须直接交给 OS 分配随机端口，不能先尝试 `DEFAULT_SERVER_PORT`。
- 启动成功后 stdout 写一行：

```
OPENCORVUS_LISTEN=127.0.0.1:<actual-port>
```

- sidecar 内部 listen 成功后，对自身 process 写 `OPENCORVUS_SERVER_URL=http://127.0.0.1:<actual-port>`，供 sidecar 内 channel runtime 等子模块读取；extension host 不依赖此变量，永远以 stdout `OPENCORVUS_LISTEN=` 为唯一握手来源。
- 如果 `OPENCORVUS_SERVER_PASSWORD` 缺失，`--managed-sidecar` 直接失败。

### 4.2 启动等待

Extension 端读取 stdout/stderr：

- 看到 `OPENCORVUS_LISTEN=` 后进入健康检查。
- 子进程退出则抛 `SidecarStartupError`，错误信息包含 exit code 与 stderr 摘要。
- 超时按无活动计时：每次 stdout/stderr 有新数据都刷新计时器；若连续 10 秒无输出且未握手成功，则失败。
- 不猜端口，不扫描端口，不连接默认端口。

### 4.3 关闭

关闭顺序：

1. Extension 调 sidecar `/shutdown`；该路由仅在 `--managed-sidecar` 模式注册，且要求 Authorization。普通 `serve` / 开发态 `bun run dev` 不暴露 `/shutdown`。
2. 等待子进程退出；无活动 5 秒后发送 `SIGTERM`。
3. 再无活动 5 秒后按 PID 杀本进程树。

杀进程必须只作用于 SidecarManager 自己 spawn 的 PID 树，不能按端口或进程名清理。

---

## 5. Overlay 改造边界

### 5.1 HostTransport 是唯一跨宿主抽象

新增：

```
packages/overlay/src/services/host-transport.ts
packages/overlay/src/services/tauri-transport.ts
packages/overlay/src/services/vscode-transport.ts
```

接口：

```ts
export interface HostTransport {
  kind: "tauri" | "vscode"
  request(input: TransportRequest): Promise<TransportResponse>
  openStream(input: StreamOpenRequest, handlers: StreamHandlers): StreamHandle
  native(command: NativeCommand): Promise<unknown>
}
```

约束：

- `services/api.ts` 只依赖 `HostTransport.request`，不再直接持有 server URL。
- `services/sse.ts` 只依赖 `HostTransport.openStream`，不再直接 new `EventSource`。
- `fetchResourceAsObjectUrl()` 也走 `HostTransport.request`，确保资源鉴权和 origin 统一。
- Tauri 与 VS Code 只是 transport 实现不同，业务服务不分叉。

### 5.2 VS Code transport

Webview 端：

- 调 `acquireVsCodeApi()` 一次，并封装到 `vscode-transport.ts`。
- `request` 发 `{ type:"request", id, method, path, headers, bodyBase64 }`。
- `openStream` 发 `{ type:"stream.open", id, path, headers }`，收到 `{ type:"stream.event", id, event }` 后交给 SSE router。
- `native` 只允许明确命令：打开外部 URL、选择文件、选择目录、窗口控制中可被 VS Code API 表达的动作。不可表达的命令直接抛 `UnsupportedNativeCommandError`。

Extension 端：

- 验证消息 schema。
- path 必须是相对 API path，禁止 webview 提供绝对 URL。
- 自动加 Basic Auth header。
- `stream.open` 用 sidecar HTTP 打开 SSE，把每个事件转发成 webview message。
- webview dispose 时关闭所有 stream。

### 5.3 Tauri transport

Tauri 模式保留现有 HTTP 能力，但需要搬进 `tauri-transport.ts`，供同一个 `HostTransport` 接口调用。

现有 Tauri invoke 清单必须一次性收敛：

| 位置 | 命令 |
|---|---|
| `services/connection.ts` | `overlay_server_info`, `overlay_server_restart` |
| `services/config.ts` | `overlay_write_file` |
| `services/init.ts` | `overlay_settings_load` |
| `services/theme.ts` | `overlay_toggle_devtools` |
| `services/window.ts` | window controls |
| `services/workspace.ts` | `overlay_pick_dir`, `overlay_pick_files`, `overlay_create_dir` |
| `store/settings.ts` | `overlay_settings_save` |
| `utils/native.ts` | `overlay_open_url`, `overlay_open_path` |

搬迁后，仅 `services/host-transport.ts` 的 `createHostTransport()` 工厂允许检测 `window.__TAURI__` 与 `acquireVsCodeApi`；业务代码禁止直接读取这两个全局，禁止裸 `invoke()`。

### 5.4 现有 `.catch(() => ...)` 清理

本次 extension 化会碰到一些旧的吞错路径，例如：

- `loadConfigInfo()` 对 `config/prompt` 与整体加载吞错。
- `connection.ts` 对 Tauri server info / restart 吞错返回 `null`。
- `theme.ts` toggle devtools 吞错。
- `extensions.ts` 中 `skill/installed` 到 `skill` 的替代请求。

这些路径不是本方案的合格依赖。实施 overlay transport 时，相关吞错必须同步改为显式错误、显式能力缺失或上层可见状态，不能保留静默替代结果。

### 5.5 stream 语义与覆盖范围

VS Code transport 必须覆盖所有 `text/event-stream` 路由，而不是只覆盖任务列表：

| 路由 | 用途 |
|---|---|
| `/global/event` | 全局事件流 |
| `/event` | app 事件流 |
| `/task/events` | task list change stream |
| `/task/:taskID/events` | 单任务协议事件流 |
| `/task/:taskID/conversation/events` | 单任务 conversation event stream |
| `/panel/message/stream` | panel message streaming |
| `/coding/message/stream` | coding assistant streaming |

重连归属：

- `HostTransport.openStream()` 只负责打开、转发、关闭一个 stream；底层 SSE 断开后通过 `StreamHandlers.onClose(reason)` 通知上层，不在 transport 内自动重连。
- UI store 可以根据业务状态显式触发重连，但必须可见地进入 disconnected / reconnecting 状态。
- sidecar 异常退出由 `SidecarManager` 检测；第一期不自动重启，直接通知用户并要求重新执行 `opencorvus.open`。

---

## 6. Webview HTML 与 CSP

VSIX 打包时把 `packages/overlay/dist-vite/` 拷贝到 `packages/vscode-extension/media/ui/`。

加载方式：

- 使用 `vscode.Uri.joinPath(context.extensionUri, "media", "ui")`。
- `WebviewOptions.localResourceRoots` 只允许 `media/ui`。
- 所有 HTML 中的 `/assets/*`、`/i18n/*` 通过 `panel.webview.asWebviewUri()` 改写。
- CSP 使用 `webview.cspSource`，默认 `default-src 'none'`。
- `connect-src` 只允许 `webview.cspSource`；不允许直接连 `http://127.0.0.1:*`。
- 注入一段极小 bootstrap script，设置 VS Code transport；如果 CSP 不能安全允许 inline script，则生成 nonce 并只允许该 nonce。

注意：`packages/opencorvus/src/server/overlay-ui.ts` 的 `rewriteHtmlAssets()` 是 `/ui/` 服务端场景逻辑，VS Code webview 不能直接复用字符串结果；应抽公共规则或在 extension 侧实现等价但输出 `asWebviewUri`。

### 6.1 资源传输与缓存

资源请求不允许绕过 transport：

- `fetchResourceAsObjectUrl()` 走 `HostTransport.request` 拿 binary body。
- Webview 内用 `Blob` + `URL.createObjectURL()` 渲染图片、附件、缩略图。
- object URL 由模块级 LRU 缓存统一持有和释放；引用方不能各自随意 revoke，避免重复请求和闪烁。
- 缓存 key 至少包含 path、Authorization scope、etag / content hash；无 etag 时使用 path + response content-length + last-modified。
- 批量资源请求需要并发上限，避免 postMessage 大量 base64 payload 卡住 UI thread。

### 6.2 路径校验

`TransportBridge` 收到 webview 消息后必须先校验 path：

- path 必须是相对 API path，不能是绝对 URL。
- `posix.normalize(path)` 后不得包含 `..` 段。
- 不允许 `\0`、反斜杠、控制字符。
- 不允许 webview 自行设置 host、protocol、Authorization。
- 非法 path 返回 400 给 webview，不转发到 sidecar。

---

## 7. 鉴权

Extension 启动 sidecar 时生成随机 token：

```
OPENCORVUS_SERVER_USERNAME=opencorvus
OPENCORVUS_SERVER_PASSWORD=<random 32+ bytes>
```

要求：

- token 只保存在 Extension Host 内存，不写入 webview HTML、localStorage、settings。
- webview 消息不携带 token。
- Extension 转发所有 request/stream/resource 时补 Authorization header。
- sidecar 必须绑定 `127.0.0.1`。
- 若 sidecar 在 managed 模式缺少 token，启动失败。

---

## 8. Platform-Specific VSIX

发布目标采用 VS Code 官方 target 名称：

| VS Code target | 二进制目录 |
|---|---|
| `win32-x64` | `bin/win32-x64/opencorvus.exe` |
| `win32-arm64` | `bin/win32-arm64/opencorvus.exe` |
| `darwin-x64` | `bin/darwin-x64/opencorvus` |
| `darwin-arm64` | `bin/darwin-arm64/opencorvus` |
| `linux-x64` | `bin/linux-x64/opencorvus` |
| `linux-arm64` | `bin/linux-arm64/opencorvus` |

不发布不带 `--target` 的通用 VSIX。原因：通用包会成为未覆盖平台的替代包，违反明确失败原则。

`BinaryResolver` 映射必须用 VS Code target 命名，不用自造 `windows-x64` 目录名。

---

## 9. 远程宿主策略

由于 sidecar 必须访问 workspace 文件并在 workspace 所在机器运行，extension 声明 `extensionKind: ["workspace"]`。

含义：

- 本地 VS Code：sidecar 在本机运行。
- Remote SSH / Dev Container / WSL：extension 在远端 extension host 运行，sidecar 也在远端运行，需要安装远端平台对应 VSIX。
- VS Code for Web：本方案不支持，因为无法 spawn 本地 sidecar；不得发布 `web` target。

如果无法解析当前 extension host 对应的二进制 target，直接抛 `UnsupportedPlatformError`。

README 必须显式说明 Remote/WSL 行为：

- WSL Remote 用户需要把 Linux target VSIX 安装到 WSL extension host，Windows 主机上的 win32 target 不会跨过去。
- Remote SSH / Dev Container 同理，target 以远端 extension host 的 `process.platform` / `process.arch` 为准。
- `UnsupportedPlatformError` 必须包含 current target、extension host kind、期望安装位置，例如 `current target=linux-x64; install matching VSIX in the remote WSL extension host`。

---

## 10. 命令

第一期只实现两个命令：

| 命令 | 行为 |
|---|---|
| `opencorvus.open` | lazy 启动 sidecar 并打开 webview panel |
| `opencorvus.attachFile` | 通过 server 的附件创建 route 生成一条用户可见附件事件 |

`attachFile` 不能伪造隐藏消息，也不能降级为往输入框塞 `@file` 文本。当前代码只有 `GET /attachment/:projectID/:name`，没有创建用户附件事件的 route；因此 M6 前必须先补 server attachment create API，并让消息流中可见地出现用户附件事件。若该 route 未完成，第一期不发布 `attachFile`。

---

## 11. OpenAPI 与 SDK

OpenAPI 仍是后端 HTTP contract 的单一来源。

但现有 overlay 没有全量使用 `@opencorvus-ai/sdk`，因此本方案不要求先重写成 SDK。正确路线：

1. 保持 server route 与 OpenAPI 生成检查。
2. 让 overlay 的 `services/api.ts` 成为 UI 内唯一 HTTP helper。
3. `services/api.ts` 底层改用 `HostTransport.request`。
4. 后续如要引入 SDK，只能替换 `services/api.ts` 内部实现，不能让 SDK 与手写 fetch 双路并存。

---

## 12. 测试与验收

### 12.1 单元测试

- `BinaryResolver` 覆盖 6 个 target；缺失二进制抛 `UnsupportedPlatformError`。
- `SidecarManager` 解析 `OPENCORVUS_LISTEN=`；子进程退出、stderr 错误、握手无活动超时均抛明确错误。
- `SidecarManager.stop()` 只清理自己 spawn 的 PID 树。
- `TransportBridge` 拒绝绝对 URL、拒绝未知 message type、自动注入 auth。
- `stream.open` 能把 mock SSE 转发成 webview event，并在 close/dispose 时断开。
- `html.ts` 把 `/assets/*`、`/i18n/*` 改成 `asWebviewUri`，并设置正确 CSP。
- overlay `services/api.ts` 在 VS Code transport 下不直接调用 global `fetch`。
- overlay `services/sse.ts` 在 VS Code transport 下不直接 new `EventSource`。
- 全量 overlay 网络入口扫描通过：除 i18n 静态资源加载和 host transport 实现外，业务代码不得直接调用 `fetch()`、`EventSource`、`apiUrl()`。
- release extension bundle 扫描通过：不得包含 `OPENCORVUS_DEV_UI`、`OPENCORVUS_DEV_SIDECAR`、`OPENCORVUS_DEV_BINARY`、`DEV_UI`、`DEV_SIDECAR` 字符串。

### 12.2 集成测试

使用 `@vscode/test-electron`：

- 执行 `opencorvus.open` 后启动 sidecar，健康检查 `GET /global/health` 通过。
- webview 发起一次 API request，Extension Host 收到并转发到 sidecar。
- webview 打开 task list stream，sidecar SSE 事件能到 UI store。
- 关闭 panel 后 stream 全部关闭。
- VS Code 退出后 sidecar PID 不存在。

### 12.3 手工验收

- Windows x64、Windows arm64、macOS x64、macOS arm64、Linux x64、Linux arm64 各一次冒烟。
- 本地 workspace 和 Remote SSH / Dev Container 各一次冒烟。
- 视觉验收必须打开真实 VS Code 窗口，不使用 headless overlay benchmark 代替。
- 验收通过后复核交付物：检查没有新增双源入口、没有 `fallback` / `兜底` 行为、没有隐藏消息、没有裸 `invoke()` 散落。

---

## 13. 实施顺序

1. **M1: sidecar managed mode**
   - 修改 `serve.ts` / `server.ts`，新增 `--managed-sidecar`、直接随机端口、stdout 握手、强制 token。
   - 增加针对端口、握手、无活动超时、禁止 kill 旧进程的测试。
   - 前置 spike：同 workspace 双开两个 VS Code 窗口、两个 sidecar、两个 webview，验证 task list / session / executor runtime 不相互覆盖；若失败，M1 内落单 sidecar 所有权方案。

2. **M2: extension skeleton**
   - 新建 `packages/vscode-extension`。
   - 实现 `BinaryResolver`、`SidecarManager`、`opencorvus.open`、空 webview。
   - 用 mock sidecar 做 extension 单元测试。

3. **M3: HostTransport 抽象**
   - 先生成并提交全量清单：`rg -n "fetch\\(|new EventSource|EventSource\\(|apiUrl\\(|__TAURI__|invoke\\(|@tauri-apps/plugin-dialog" packages/overlay/src -S`。
   - 新增 overlay transport interface。
   - 收敛 `services/api.ts`、`services/sse.ts`、`main.tsx`、`store/board.ts`、`store/messages.ts`、`services/task.ts`、`utils/log.ts`、`components/Card.tsx` 等所有业务网络入口。
   - 收敛 Tauri invoke 到 `tauri-transport.ts`。

4. **M4: VS Code transport bridge**
   - 实现 request/resource/stream 协议两端。
   - 接通 `/global/health`、`/task/events`。

5. **M5: UI asset packaging**
   - 构建 overlay dist-vite。
   - extension 加载真实 overlay UI。
   - 完成 CSP 与 `asWebviewUri` 验证。

6. **M6: attachFile**
   - 当前 editor 文件与 selection 进入真实可见会话/附件流。
   - 增加消息流可见性测试。

7. **M7: platform-specific VSIX**
   - CI 分平台构建 sidecar 与 VSIX。
   - 只发布带 target 的 VSIX。
   - CI 解包每个 VSIX 检查 `bin/<target>/opencorvus[.exe]` 存在；macOS/Linux 必须有 executable bit；Windows 必须能 `opencorvus.exe --version`。

8. **M8: full acceptance**
   - 跑 extension 集成测试。
   - 真实 VS Code 手工视觉验收。
   - 二次 review 文档、代码、测试与打包产物。

---

## 14. 不实施项

以下内容从方案中删除，后续不得作为捷径重新引入：

- webview iframe 直连 `http://127.0.0.1:<port>/ui/`
- `opencorvus.openTerminal`
- 依赖用户 PATH 上的 opencorvus
- extension 首次启动下载二进制
- 发布 GitHub Release 包作为安装失败后的替代路径
- 通用 VSIX 包
- web target
- webview 内保存 sidecar token
- 根据端口或进程名杀旧进程

---

## 15. 官方依据

- VS Code Webview 支持 `postMessage`，webview 端通过 `acquireVsCodeApi()` 回传消息；消息需 JSON serializable。见 https://code.visualstudio.com/api/extension-guides/webview
- VS Code Webview 本地资源需通过 `asWebviewUri`，并可用 `localResourceRoots` 限制可访问目录。见 https://code.visualstudio.com/api/extension-guides/webview
- VS Code Webview 推荐使用 CSP，并用 `webview.cspSource` 限定脚本、样式、图片来源。见 https://code.visualstudio.com/api/extension-guides/webview#content-security-policy
- VS Code platform-specific extensions 从 VS Code 1.61 起按平台选择；未带 `--target` 的包会被用于未覆盖平台；`vsce --target` 支持指定 target；官方 target 包括 `win32-x64`、`win32-arm64`、`linux-x64`、`linux-arm64`、`darwin-x64`、`darwin-arm64` 等。见 https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions
- `extensionKind: ["workspace"]` 表示 extension 运行在 workspace 所在 extension host，符合 sidecar 需要访问项目文件的约束。见 https://code.visualstudio.com/api/advanced-topics/extension-host

---

## 16. Codex 复核回应：补充细化

### 16.1 接受（无异议）

| 修订点 | 接受理由 |
|---|---|
| `HostTransport` 替代 SDK fetch 注入 | 原方案漏看 `services/api.ts` + `EventSource`，注入 SDK fetch 覆盖不到 UI 主链路 |
| SSE 进桥协议 | `EventSource` 不能带 Authorization header，原方案纯靠 fetch shim 不可行 |
| `--managed-sidecar` 专用模式 | 现有 `serve.ts` 杀占端口的旧进程 + `Server.listen({port:0})` 先试默认端口，sidecar 用了会污染用户环境 |
| token 不进 webview | 多 extension / 第三方 webview 注入风险；token 只在 extension host 内存 |
| VS Code 官方 target 命名 (`win32-x64` 等) | 必须对齐 marketplace 自动选包逻辑 |
| `extensionKind: ["workspace"]` | sidecar 要访问 workspace 文件，必须在 workspace host |
| 禁止通用 VSIX | 通用包会被未覆盖平台抓到 → 等同于"静默 fallback"，违反明确失败原则 |
| `attachFile` 必须可见会话 | CLAUDE.md §15 禁止隐藏消息分叉；伪造后端注入是双路消息 |
| CSP `connect-src` 不允许 `http://127.0.0.1:*` | 强制走 postMessage 是更干净的边界 |
| Tauri invoke 一次性收敛 | CLAUDE.md §8 禁止双源 |
| 无活动超时计时器 | 比固定 10s 更稳健 |

### 16.2 争议 / 修订

#### A. §4.1 `OPENCORVUS_SERVER_URL` 反向回写问题

> 原文："设置 `OPENCORVUS_SERVER_URL=http://127.0.0.1:<actual-port>`，保持现有 channel runtime 读取路径可用"

子进程 spawn 时 env 是父进程快照，sidecar 内部 `setenv()` 不会反向影响父 extension。这条只对 sidecar **自身进程内部**的 channel runtime 子模块有意义。需澄清写法：sidecar 在 listen 成功后**写自己的 env**，仅供 sidecar 内 channel runtime 读取；extension 端永远以 stdout 握手为准，不读 env。

**修订 §4.1 第 5 条为**：
- sidecar 内部 listen 成功后，对自身 process 写 `OPENCORVUS_SERVER_URL=http://127.0.0.1:<actual-port>`，供 sidecar 内 channel runtime 等子模块读取；extension host 不依赖此变量，永远以 stdout `OPENCORVUS_LISTEN=` 为唯一握手来源。

#### B. §5.3 "禁止散落 `(window as any).__TAURI__`" 太绝对

业务代码禁用同意，但 transport 工厂启动时**必须**有一处检测 host —— 否则没法选 tauri/vscode transport。

**修订 §5.3 末段为**：
- 搬迁后，仅 `services/host-transport.ts` 的 `createHostTransport()` 工厂允许检测 `window.__TAURI__` 与 `acquireVsCodeApi`；业务代码禁止直接读这两个全局，禁止裸 `invoke()`。

#### C. §10 `attachFile` 走会话输入还是真实附件 API

codex 写"走 UI 可见的会话输入或附件 API"。两者其实不等价：

- **走输入框**：等价于用户敲了一段 `@file:foo.ts:10-20` 文本，UI 上看得见
- **走附件 API**：现有后端有专门 attachment 路由（如 `/session/:id/attachment`），是结构化的"用户上传了文件"事件

后者更接近 Cursor / Claude Code 的"@file mention"。**推荐走附件 API + 在会话流中以 system-visible "user attached X" 形式落地**，避免靠"在输入框塞文本"这种半隐式做法。需要先核实 server 是否已有 attachment 路由，没有就先建。

**修订 §10 attachFile 行为为**：
- 优先调用 server 的 attachment route 创建一条用户附件事件；若 server 暂无该 route，则视为缺失能力，第一期 attachFile 不上线，**禁止**降级为输入框文本注入。

#### D. §6 资源 fetch 性能补丁

`fetchResourceAsObjectUrl()` 走 `HostTransport.request` 后，每个 `<img src>` / 头像 / 缩略图都要往返 postMessage + base64。大图、批量缩略图会卡主线程。

**新增 §6.1**：
- 资源 fetch 走 `transport.request` 拿到 binary body 后，在 webview 内 `new Blob(...)` + `URL.createObjectURL()` 渲染；引用方 dispose 时必须 `URL.revokeObjectURL()` 防泄漏。
- 同一资源短期复用走 webview 内 LRU 缓存（key = path + etag），避免重复 postMessage。

#### E. §6 路径校验防御

webview 是部分受信代码（用户内容、第三方扩展可能注入）。`path` 字段除了"必须相对"，还要防 `..` 跳出。

**新增 §6.2**：
- `TransportBridge` 收到的 `path` 必须 `posix.normalize` 后断言不含 `..`、不以 `/` 开头跳到非 API 路径、不含 `\0`；非法直接返回 400 不转发。

#### F. §4.3 `/shutdown` 路由暴露面

只在 managed 模式注册，否则成为后门。

**修订 §4.3 第 1 步为**：
- `/shutdown` 仅在 sidecar 以 `--managed-sidecar` 启动时注册到 Hono app，且要求 Authorization。其他模式（包括开发态 `bun run dev`）该路由不存在。

#### G. SSE 重连归属

桥协议下 `EventSource` 自动重连失效。归属需要明确：

**新增 §5.5 stream 重连策略**：
- VS Code transport 的 `openStream` 在底层 SSE 断开（sidecar 重启 / 网络异常）后，**不自动重连**；通过 `StreamHandlers.onClose(reason)` 通知上层 store 转为 disconnected 状态。
- UI 层显式按钮触发重连或自动 retry（属于 overlay 业务层，不是 transport 责任）。
- sidecar 异常退出由 `SidecarManager` 检测；第一期不自动重启，弹错误通知用户手动 `opencorvus.open` 重新激活，符合"明确失败"。

#### H. Multi-window / 同 workspace 双开

每个 VS Code 窗口启动一个 sidecar，但 SQLite (`opencorvus.db`) 用 WAL 模式可以多写，存量代码已经是 WAL（见根目录 `*.db-wal`）。需验证 `Instance` 抽象在两个进程持有同一 DB 时无竞争。

**新增 §13 M1 末尾 spike**：
- 双开同 workspace → 两个 sidecar 同时跑、各自打开 webview，验证 task list / session 不相互覆盖；若 instance 层有竞争，加文件级 advisory lock，第二个窗口连第一个 sidecar（变成多 webview 共享单 sidecar 模式）。
- 落决策：第一期不强制 single-sidecar，但要 spike 出"会不会坏"，坏了再切。

#### I. Dev 模式（不算双源）

extension 开发体验需要 hot reload overlay UI，每次重新打 vsix 不可接受。

**新增 §17 dev-only 入口**：
- `OPENCORVUS_DEV_UI=http://localhost:5173` 时，`webview/html.ts` 改为加载 vite dev server。
- 仅在 `process.env.NODE_ENV === 'development'` 与该 env 都满足时生效；生产 vsix build 中 esbuild 直接 dead-code-elim 掉这条分支。
- 这是 dev-only**编译期**分支，不属于运行时 fallback，不违反 §一-7。

#### J. Tauri invoke 清单需 verify

§5.3 列的清单是 codex 静态收集的，需 grep 全仓 verify。

**新增 §13 M3 第一步 spike**：
- `grep -rn 'invoke(' packages/overlay/src` 全量列出，与 §5.3 表格对齐；任何遗漏的命令在 transport 抽象阶段一并迁移。

#### K. WSL / Remote 流程文档化

`extensionKind: ["workspace"]` 在 WSL Remote 下会让 extension 跑在 WSL 的 Linux extension host，二进制查找走 `linux-x64`，但**用户必须把 linux-x64 vsix 装到 WSL 内**而不是 Windows 主机。

**新增 §9 末尾**：
- README 必须明确：WSL Remote 用户需在 "Extensions: Install in WSL" 时安装 linux-x64 target；Windows 主机的 win32-x64 target 不会跨过去。
- 二进制不可用时 `UnsupportedPlatformError` 错误信息要包含 "current target = linux-x64, install matching VSIX in remote host"。

### 16.3 待澄清（不阻塞实施）

- **二进制体积**：6 target × ~80MB ≈ 480MB 总，单个 platform-specific vsix ~80MB，marketplace 上传是否触发审核延迟。M7 阶段实测，必要时 strip + UPX。
- **Bun runtime 在 WebView2 进程外的兼容性**：sidecar 是 Bun compile 二进制，独立 runtime，与 VS Code 的 Electron / Node 无关，理论无冲突。M1 spike 顺手验证。
- **token env 泄漏面**：Linux 下 `/proc/<pid>/environ` 同用户可读。属已知风险，与 Claude Code 等同等水位。短期不处理；长期可改 stdin 一次性传 token + memzero。

---

## 17. Dev-only 入口（开发体验）

开发入口必须是**独立 dev build**，不能是 release VSIX 中保留的运行时开关。

| dev build 变量 | 行为 |
|---|---|
| `OPENCORVUS_DEV_UI=http://localhost:5173` | webview 加载 Vite dev server，CSP 临时放行该 origin |
| `OPENCORVUS_DEV_SIDECAR=http://127.0.0.1:NNNN` | 连接开发者手动启动的 managed sidecar |
| `OPENCORVUS_DEV_BINARY=/abs/path/opencorvus` | 使用指定二进制调试 sidecar |

硬约束：

- 这些变量只能在 `packages/vscode-extension/script/dev.ts` 或 dev 专用 extension entry 中读取。
- production `esbuild.mjs` 必须通过 define / tree-shaking 删除全部 dev 分支。
- release VSIX 解包后，`dist/extension.js` 中不得出现 `OPENCORVUS_DEV_UI`、`OPENCORVUS_DEV_SIDECAR`、`OPENCORVUS_DEV_BINARY` 字符串。
- dev sidecar 也必须以 managed sidecar 语义启动：随机端口、stdout 握手、token、禁止 kill 旧进程。
- dev UI 可以直连 Vite dev server，但不得绕过 `HostTransport` 访问 sidecar。

---

## 18. 实施前阻断项

以下事项不完成，不进入 M2/M3 的实质实现。

### 18.1 Overlay 网络入口清单

先用命令生成清单并把结果落盘到 `tmp/vscode-extension-overlay-network-inventory.md`：

```
rg -n "fetch\(|new EventSource|EventSource\(|apiUrl\(|apiJson\(|__TAURI__|invoke\(|@tauri-apps/plugin-dialog" packages/overlay/src -S
```

当前已知必须处理的入口包括但不限于：

| 文件 | 风险 |
|---|---|
| `services/api.ts` | 核心 `fetch(apiUrl(...))` 和 resource fetch |
| `services/sse.ts` | `new EventSource()` 两处 |
| `services/task.ts` | `/panel/message/stream` 直接 fetch stream |
| `store/board.ts` | board sync 直接 fetch |
| `store/messages.ts` | transcript / timeline 直接 fetch |
| `main.tsx` | `/global/db/reset` 直接 fetch |
| `utils/log.ts` | `/log` fire-and-forget fetch |
| `components/Card.tsx` | `/task/:id/rewind` 裸相对 fetch |
| `utils/i18n.ts` | 静态 `i18n/*.json` fetch，需归类为 webview asset，不走 sidecar |
| `TopBar.tsx` / `SkillMarketPanel.tsx` | Tauri dialog plugin 动态 import |
| `WindowControls.tsx` / `services/dialog.ts` | Tauri window/global API 直接读取 |

清单验收：

- 业务 HTTP / SSE / resource 入口全部收敛到 `HostTransport`。
- 静态 UI asset 加载单独列白名单。
- Tauri native 能力全部收敛到 `HostTransport.native()`。
- 不允许保留第二套“临时直连 sidecar”的业务路径。

### 18.2 SSE 路由清单

先用命令生成清单并把结果落盘到 `tmp/vscode-extension-sse-inventory.md`：

```
rg -n "text/event-stream|streamSSE" packages/opencorvus/src/server packages/opencorvus/src -S
```

当前已知 stream 路由：

- `/global/event`
- `/event`
- `/task/events`
- `/task/:taskID/events`
- `/task/:taskID/conversation/events`
- `/panel/message/stream`
- `/coding/message/stream`

验收：任一新增 `text/event-stream` route 都必须有 bridge 测试；不能只测 `/task/events`。

### 18.3 Managed-only 管理路由

`/shutdown`、`/restart` 目前在 `AppRoutes()` 中通用挂载。实施 M1 时必须改成：

- `--managed-sidecar` 模式才注册 `/shutdown`。
- `/restart` 第一期开禁用或仅 managed 模式注册；禁止普通 server 被 webview 或外部请求重启。
- 两个路由都必须走 `OPENCORVUS_SERVER_PASSWORD` 鉴权。
- 测试覆盖普通 `serve` 下 404、managed sidecar 下 200。

### 18.4 Attachment 创建能力

当前 `AttachmentRoutes` 只有读取 content-addressed attachment 的 `GET /attachment/:projectID/:name`。

M6 之前必须新增单一创建路径：

- 接收 VS Code 当前文件 URI、selection、内容摘要。
- 写入 `AttachmentStore`。
- 创建用户可见的会话事件或消息 part。
- 通过 SSE / transcript 回放可见。

没有该 route 时，`opencorvus.attachFile` 不注册命令。

### 18.5 Release 包扫描

每个平台 VSIX 打包后必须解包检查：

- 只包含一个 target 的二进制目录。
- 不包含 dev-only 字符串。
- 不包含通用备用二进制。
- macOS/Linux executable bit 正确。
- `package.json` 没有 `browser` entry，没有 `web` extension target。
- `extensionKind` 只有 `workspace`。

### 18.6 远程宿主验收

必须至少覆盖：

- Windows 本地 `win32-x64`。
- WSL Remote 的 `linux-x64`。
- SSH Remote 的 Linux target。

每次验收记录：

- extension host kind。
- resolved target。
- resolved binary path。
- sidecar PID。
- stdout `OPENCORVUS_LISTEN=`。
- `/global/health` 结果。

### 18.7 并发实例决策

M1 spike 后必须二选一落盘：

| 决策 | 条件 |
|---|---|
| 每窗口独立 sidecar | 双开同 workspace 不会破坏 DB、Instance、executor session、watcher |
| workspace single-owner sidecar | 双开存在竞争；用 lock file + owner metadata，让第二个窗口连接 owner sidecar |

未落决策不得进入 M2。

---

## 19. 第二轮 Adversarial Review（实施前阻断升级）

针对 §18 的"实施前阻断项"再做一轮 challenge。下列问题在 §0–§18 中**漏写、措辞模糊或决策偏轻**，按严重度分级。

### 19.1 阻塞级（Block M1）

#### 19.1.1 与现有 daemon / 全局 server 共存策略缺失

`opencorvus` 当前已有"用户手起 server，多个 channel bot / IM 共用"的 daemon 形态。Extension 强行 per-workspace 起 sidecar，会导致：

- 用户已运行的 `opencorvus serve` 与 extension sidecar 同时操作 `~/.local/share/opencorvus/*.db`，WAL 模式不防多写覆盖业务级状态。
- Project / Instance / Watcher 重复注册，文件 watcher 双源触发。
- channel runtime 的事件流被两个进程同时消费。

**现状 plan 表现**：§18.7 把"双开同 workspace"当成 multi-window VSCode，**没考虑 VSCode 之外的 daemon**。

**强制决策（M1 落盘）**:
- `--managed-sidecar` 启动时检测 `~/.local/share/opencorvus/server.lock`（或等价 owner file）；存在且 PID 活跃 → **直接 fail 并提示用户**：`existing opencorvus instance detected (PID=N), stop it before opening in VS Code`，不连接、不抢占、不静默另起。
- 这条是 fail-loud，不是 fallback。CLAUDE.md §一-7。

#### 19.1.2 Extension Host 异常退出 → sidecar 孤儿进程

`SidecarManager.stop()` 假设 `deactivate()` 一定被调用。事实：

- Extension Host crash / OOM / forced quit 不触发 `deactivate()`。
- macOS 强退 VS Code → child sidecar 不会随父退出（Bun spawn 默认 detached）。
- 用户重启 VSCode → 旧 sidecar 还活着、占着 DB lock → 新 extension 又起一个 → §19.1.1 的死锁。

**强制决策（M1 落盘）**:
- sidecar `--managed-sidecar` 启动时记下 parent PID（`OPENCORVUS_PARENT_PID` env 注入）。
- sidecar 内每 5s 检查 `process.kill(parentPid, 0)`；父进程不存在 → 自杀（先 `/shutdown` 内部钩子，再 exit）。
- 验收：M1 集成测试包含 "kill -9 extension host → sidecar 在 ≤10s 内退出"。

#### 19.1.3 Token env 通过 spawn 链泄漏到所有 sub-agent

opencorvus 自己会 spawn 大量 sub-process（LLM tool runner、sub-agent、bash tool、channel bot）。env 默认继承 → `OPENCORVUS_SERVER_PASSWORD` 出现在每个子进程的 `/proc/<pid>/environ`、ps 输出、core dump 里。

**现状 plan 表现**：§16.3 标记"长期可改 stdin + memzero"。**这条不能延后**，因为子进程数量大、用户可能在子进程里跑 untrusted 工具。

**强制决策（M1 落盘）**:
- sidecar 主进程读完 `OPENCORVUS_SERVER_PASSWORD` 后立刻 `delete process.env.OPENCORVUS_SERVER_PASSWORD`（Bun / Node 都支持）。
- 后续所有 spawn 默认不传该 env。
- Auth 中间件读的是模块内部变量，不是 env。
- 验收：M1 单测覆盖 "spawn child after token loaded → child env 不含 password"。

#### 19.1.4 dist 体积实测必须前置到 M0

§16.3 把"M7 阶段实测体积"放在最后。如果实测单平台 > 200MB（marketplace 上限），整个分发策略推翻。

**强制决策（M0 落盘，spike 优先于一切代码改动）**:
- `du -sh packages/opencorvus/dist/<each-target>` 实测当前 5 平台体积（含 `ui/`、二进制、models.dev cache、字体等所有 vsix 必带项）。
- 落到 `tmp/vscode-extension-binary-size.md`。
- 单平台 > 150MB → 触发 strip + UPX 子任务；> 200MB → 整个 platform-specific VSIX 路线否决，回到设计。

### 19.2 高优先级（Block M3/M4）

#### 19.2.1 完整 CSP 模板缺失

§6 只说"`connect-src` 允许 `webview.cspSource`"，**其他指令完全没列**。实际 webview 跑 React/Solid + LLM markdown 渲染，`default-src 'none'` + 缺指令 = 反复被 CSP 打脸。

**M5 前必须落盘完整模板**:
```
default-src 'none';
script-src 'nonce-{nonce}' {cspSource};
style-src 'unsafe-inline' {cspSource};
img-src {cspSource} data: blob:;
font-src {cspSource} data:;
connect-src {cspSource};
worker-src blob:;
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
```
LLM 输出的外部图片：第一期**显式禁止**（仅 `cspSource + data: + blob:`），不开 https:。

#### 19.2.2 Webview 安全配置硬锁

`WebviewOptions` 默认值不可靠。M5 前必须显式：
- `enableCommandUris: false`（防 prompt injection 让用户点 `command:vscode...` 链接）
- `enableScripts: true`（必需，但要配合 nonce CSP）
- `enableForms: false`
- `localResourceRoots`: 仅 `media/ui`，不带 workspace folder
- `retainContextWhenHidden: false`（VSCode 自己提示性能问题；除非业务必需，默认关）

**plan §6 缺这一段**，加进 §6.3。

#### 19.2.3 SSE backpressure / batching 策略

LLM token 流：每秒数百 chunk × postMessage 单条 marshal → webview 主线程被 React 渲染拖住时消息堆积。VSCode `webview.postMessage` 无 backpressure 信号。

**M4 必须决策**:
- TransportBridge 在 extension host 端对 stream events 做 10–50ms batching：
  ```
  收到 SSE event → 入 buffer → setTimeout(flush, 16ms) → 一次 postMessage 多个 events
  ```
- buffer size 上限（如 256），超限 → drop oldest（**这不是 fallback，是流式语义里 drop tail 的标准做法**，必须明示）。
- 验收：M4 集成测试包含 "1000 events/s 持续 10s → webview 收到全部 / drop 计数明确"。

#### 19.2.4 Sidecar 重启后 webview state 一致性

§13 M1 说"sidecar 异常退出 → 用户手动重开"。但 webview 已开 → state 是旧端口、旧 token、旧 stream id。

**M4 必须决策（二选一落盘）**:
- A. SidecarManager 检测 sidecar 退出 → 强制 `panel.dispose()` + 弹消息让用户重开（用户会丢草稿）
- B. WebView 持久化 unsent 输入到 `vscode.ExtensionContext.workspaceState`，重连后恢复
- 第一期推 A（明确失败、不藏复杂度）。B 进 backlog。

#### 19.2.5 macOS Gatekeeper / Windows SmartScreen

VSIX 内 bundle 的 Bun compile 二进制：
- macOS: 未签名 + 未公证 → 第一次运行被 Gatekeeper 拒绝 → extension `spawn EACCES` / `spawn ENOTSUP` → 用户卡住
- Windows: SmartScreen 警告（首次运行，可放行）
- Linux: 无问题

**M7 前必须落盘**:
- macOS：申请 Apple Developer ID + 在 CI 里 codesign + notarytool altool 公证。这条是法律 / 工时阻塞项，**必须早确认**（账号申请要数天）。
- Windows：SmartScreen 在用户量积累前总会警告，第一期接受；EV 证书延后。
- 第一期不能用 ad-hoc sign 替代公证 — Gatekeeper 在 macOS 13+ 会硬拒。
- **plan §8 当前完全没提。M7 的 "CI 分平台构建 sidecar 与 VSIX" 必须包含 codesign/notarize 步骤。**

#### 19.2.6 attachFile 语义校正

§16-C 决策是"创建用户可见附件事件"。**这语义错了**：单纯 attached event 不会触发 agent 工作，等于点了个按钮没下文。

**M6 必须落盘**:
- `attachFile` 不是发送动作，是"暂存到 composer 草稿"动作。
- 实现：通过 transport 把当前文件 URI + selection 传给 webview store → webview 把它作为 pending attachment 显示在输入框上方 → 用户看到 → 用户点 send 才真正发出。
- 这才是 Cursor / Claude Code 的 @file 语义，也才符合 CLAUDE.md §15 "自然角色对话"。
- 不是 server 路由，是 webview side state 改动 + 一条 `composer.attach` postMessage 类型。
- §10 / §16-C 必须重写。

### 19.3 中优先级（Block M5/M7）

#### 19.3.1 Serve.ts 改动边界明确化

§4.1 说"不要复用当前 serve.ts 的固定端口治理逻辑"。**措辞歧义**，可能被理解为"重写 serve.ts"，导致破坏现有 daemon 用户。

**M1 明确**:
- 现有 `opencorvus serve` 命令路径**不动**（端口治理、kill 占用进程的逻辑保留给现有用户）。
- 新增独立子命令 `opencorvus sidecar`（不是 `serve --managed-sidecar` 这种 flag），明确隔离两套语义。
- 路由侧 `/shutdown` `/restart` 在 sidecar 子命令模式下注册，serve 模式下不存在（§18.3）。
- CLAUDE.md §16/17：旧路径不留补丁，但**新功能可以独立分支**，不冲突。

#### 19.3.2 i18n 注入

VSCode `vscode.env.language` 必须传给 webview。当前 plan §6 完全没提。

**M5 落盘**:
- Extension host 启动 webview 时把 `vscode.env.language` 注入 HTML 的 `<html lang>` 和一个 bootstrap global（如 `window.__OPENCORVUS_LOCALE__ = "zh-CN"`）。
- overlay i18n 加载器读这个 global，**不是**读浏览器 `navigator.language`（webview 里可能不准）。

#### 19.3.3 Schema versioning

§5.2 协议 `{ type, id, method, path, ... }` 没有版本字段。webview 资源是 vsix 内 build 出来的，extension host 也是同一 vsix → 应该同步演进，但 marketplace 自动更新可能让用户的 VS Code 缓存到一半新一半旧。

**M4 落盘**:
- 协议加 `protocol: 1` 字段。
- TransportBridge 收到不匹配版本 → 直接拒绝并 dispose webview，要求用户重载窗口。
- 不做向下兼容（CLAUDE.md §一-7、§二-7 禁 fallback）。

#### 19.3.4 二次 review checklist 落具体 grep

§12.3 / §18.5 说"复核没有 fallback / 兜底 / 隐藏消息"，**没列 grep**。

**M8 落盘 review-grep.md**：
```
rg "\.catch\(\(\)\s*=>" packages/vscode-extension packages/overlay/src       # 静默吞错
rg "\?\?\s*\[\]" packages/vscode-extension packages/overlay/src              # 默认空数组兜底
rg "fallback|Fallback|FALLBACK" packages/vscode-extension packages/overlay/src
rg "兜底|降级|默认值" packages/vscode-extension packages/overlay/src
rg "fetch\(|new EventSource" packages/overlay/src                            # 必须只在 transport 实现里
rg "process\.env\.OPENCORVUS_DEV" dist/extension.js                          # release 包内不应出现
rg "127\.0\.0\.1" packages/vscode-extension/dist                             # bundle 内不该硬编码
```

#### 19.3.5 Chaos 集成测试

§12.2 全是 happy path。

**M8 集成测试新增**:
- sidecar 启动后 `kill -9` → extension 显示 disconnected，webview 不卡死
- DB 文件被 chmod 000 → sidecar 启动失败 → extension 报清晰错
- workspace 切换中途 → 旧 sidecar 全干净退出
- 手动占用 `OPENCORVUS_LISTEN` 那行的端口 → managed sidecar 直接 fail，不抢占
- extension host SIGSTOP 30s → sidecar parent-watchdog 触发自杀（§19.1.2）

### 19.4 待澄清（不阻塞，但记下）

- **VSCode for Cursor**：Cursor 用自己的 marketplace（cursor 不直接用 VS Code marketplace），需要单独发布。第一期接受"用户手装 vsix"。
- **JetBrains/Zed**：本方案与之无关，但 IDE 钩子代码（`src/ide/index.ts`）已为多 IDE 设计；JetBrains 需要独立 plugin 项目。
- **Webview Lifecycle 与 panel 多实例**：用户可能同时打开多个 panel（"split panel"），每个 panel 都 acquireVsCodeApi。当前 panel.ts 是否单实例？plan 未明示。M2 落"单 panel 单 sidecar 单 webview"。
- **i18n 资源同时被 sidecar 和 webview 各自加载**：sidecar 自己有 ui/、webview 用 vsix 内 media/ui，**两份**。第一期接受冗余，第二期看是否能共享。

### 19.5 阻断升级表

下列项不完成不得进入对应里程碑（覆盖 §18）：

| 项 | 阻断阶段 |
|---|---|
| 19.1.4 dist 体积实测 | M0（先于一切） |
| 19.1.1 daemon 共存策略 | M1 |
| 19.1.2 parent-watchdog | M1 |
| 19.1.3 token env 清理 | M1 |
| 19.3.1 serve.ts 边界 | M1 |
| 19.2.3 SSE batching | M4 |
| 19.2.4 sidecar 重启 state | M4 |
| 19.3.3 protocol version | M4 |
| 19.2.1 完整 CSP | M5 |
| 19.2.2 Webview 安全配置 | M5 |
| 19.3.2 i18n 注入 | M5 |
| 19.2.6 attachFile 语义重写 | M6 |
| 19.2.5 codesign / notarize | M7 |
| 19.3.4 review-grep | M8 |
| 19.3.5 chaos test | M8 |
