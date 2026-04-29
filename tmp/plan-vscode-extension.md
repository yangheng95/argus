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

- 设置 `OPENCORVUS_SERVER_URL=http://127.0.0.1:<actual-port>`，保持现有 channel runtime 读取路径可用。
- 如果 `OPENCORVUS_SERVER_PASSWORD` 缺失，`--managed-sidecar` 直接失败。

### 4.2 启动等待

Extension 端读取 stdout/stderr：

- 看到 `OPENCORVUS_LISTEN=` 后进入健康检查。
- 子进程退出则抛 `SidecarStartupError`，错误信息包含 exit code 与 stderr 摘要。
- 超时按无活动计时：每次 stdout/stderr 有新数据都刷新计时器；若连续 10 秒无输出且未握手成功，则失败。
- 不猜端口，不扫描端口，不连接默认端口。

### 4.3 关闭

关闭顺序：

1. Extension 调 sidecar `/shutdown`。
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

搬迁后，overlay 代码中禁止散落 `(window as any).__TAURI__` 和裸 `invoke()`。

### 5.4 现有 `.catch(() => ...)` 清理

本次 extension 化会碰到一些旧的吞错路径，例如：

- `loadConfigInfo()` 对 `config/prompt` 与整体加载吞错。
- `connection.ts` 对 Tauri server info / restart 吞错返回 `null`。
- `theme.ts` toggle devtools 吞错。
- `extensions.ts` 中 `skill/installed` 到 `skill` 的替代请求。

这些路径不是本方案的合格依赖。实施 overlay transport 时，相关吞错必须同步改为显式错误、显式能力缺失或上层可见状态，不能保留静默替代结果。

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

---

## 10. 命令

第一期只实现两个命令：

| 命令 | 行为 |
|---|---|
| `opencorvus.open` | lazy 启动 sidecar 并打开 webview panel |
| `opencorvus.attachFile` | 将当前 editor 文件 URI 和 selection 作为真实用户动作发送到当前会话 |

`attachFile` 不能伪造隐藏消息。它必须走 UI 可见的会话输入或附件 API，让用户能在消息流中看到文件上下文。

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

2. **M2: extension skeleton**
   - 新建 `packages/vscode-extension`。
   - 实现 `BinaryResolver`、`SidecarManager`、`opencorvus.open`、空 webview。
   - 用 mock sidecar 做 extension 单元测试。

3. **M3: HostTransport 抽象**
   - 新增 overlay transport interface。
   - 收敛 `services/api.ts`、`services/sse.ts`、资源 fetch。
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
