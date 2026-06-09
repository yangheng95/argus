# MCP（Model Context Protocol）

MCP 是 Anthropic 主导、社区维护的开放协议，定义 LLM 应用与外部工具服务器的标准通信接口。协议规范：[modelcontextprotocol.io](https://modelcontextprotocol.io)。

OpenCorvus 同时扮演：

1. **MCP Client** — 连接外部 MCP Server，将其工具 / 提示词 / 资源暴露给内部 agent
2. **MCP Server** — 运行中的 `opencorvus serve` 进程通过 Streamable HTTP 在 `/mcp/transport` 暴露自身工具给外部编码执行器

源码：`packages/opencorvus/src/mcp/index.ts`、`packages/opencorvus/src/mcp/serve.ts`。MCP 路由直接挂载在主 HTTP server 上（commit `796c384b0`，不再有独立的 `routes/mcp.ts`）；transport 仍是统一的 `/mcp/transport` 端点。

## 1. 消费外部 MCP Server

### 连接时序

1. 服务启动读 config `mcp` 字段（`src/mcp/index.ts:164-211`）
2. 按 `type` 创建 transport：
   - `"local"` → `StdioClientTransport`（子进程 stdin/stdout）
   - `"remote"` → 先 `StreamableHTTPClientTransport`，失败降级 `SSEClientTransport`
3. 连接后 `client.listTools()`
4. 工具名经 sanitize（非字母数字 → `_`）后以 `{clientName}_{toolName}` 注册到 session 工具集

Agent 调用 MCP 工具时通过 `client.callTool()` 转发（`src/mcp/index.ts:120-149`）。

## 2. 配置 MCP Server

### 本地进程（stdio）

```jsonc
{
  "mcp": {
    "my-local-server": {
      "type": "local",
      "command": ["node", "/path/to/server/index.js"],
      "environment": { "API_KEY": "sk-..." },
      "enabled": true,
      "timeout": 30000,
    },
  },
}
```

字段（`src/config/config.ts:533-552`）：

| 字段          | 说明                                 |
| ------------- | ------------------------------------ |
| `type`        | `"local"`                            |
| `command`     | 命令 + 参数数组                      |
| `environment` | 子进程额外 env（叠加 `process.env`） |
| `enabled`     | `false` 跳过连接                     |
| `timeout`     | 请求超时 ms（默认 30000）            |

### 远程 HTTP Server

```jsonc
{
  "mcp": {
    "my-remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/api",
      "headers": { "Authorization": "Bearer sk-..." },
      "oauth": false,
      "enabled": true,
      "timeout": 15000,
    },
  },
}
```

字段（`src/config/config.ts:569-591`）：

| 字段                 | 说明                                             |
| -------------------- | ------------------------------------------------ |
| `url`                | MCP Server HTTP(S) 地址                          |
| `headers`            | 请求头（Bearer Token 常用）                      |
| `oauth`              | `McpOAuth \| false`；`false` 禁用自动 OAuth 检测 |
| `oauth.clientId`     | 静态 client ID（跳过动态注册）                   |
| `oauth.clientSecret` | client secret                                    |
| `oauth.scope`        | OAuth scope                                      |

## 3. 已支持的 MCP 能力

| 能力                                         | 状态            |
| -------------------------------------------- | --------------- |
| Tools (`listTools` + `callTool`)             | ✅ 完整         |
| Prompts (`listPrompts` + `getPrompt`)        | ✅ 完整         |
| Resources (`listResources` + `readResource`) | ✅ 完整         |
| `ToolListChanged` 通知                       | ✅              |
| StreamableHTTP / SSE / stdio transports      | ✅ 全支持       |
| OAuth 2.0 + PKCE                             | ✅ 远程默认开启 |
| 动态 client 注册 (RFC 7591)                  | ✅              |

## 4. OAuth 认证流程

远程服务器返回 `UnauthorizedError` → 标记 `needs_auth`。执行：

```bash
opencorvus mcp auth <server-name>
```

OpenCorvus 本地启 callback server，打开浏览器跳转授权，code 交换 token 后持久化到 `~/.local/share/opencorvus/mcp-auth.json`。

查询状态：

```bash
opencorvus mcp status
```

清除认证：

```bash
opencorvus mcp remove-auth <server-name>
```

## 5. 典型配置示例

**本地 Filesystem Server：**

```jsonc
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"],
    },
  },
}
```

**远程 GitHub（Bearer Token）：**

```jsonc
{
  "mcp": {
    "github": {
      "type": "remote",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ghp_xxx" },
      "oauth": false,
    },
  },
}
```

**禁用某个已配置的 Server：**

```jsonc
{ "mcp": { "github": { "type": "remote", "url": "...", "enabled": false } } }
```

## 6. OpenCorvus 作为 MCP Server

executor 用的 MCP transport 内嵌于主 `opencorvus serve` 的 HTTP 服务器，无需单独进程。外部执行器（Claude Code 走 Anthropic Agent SDK、Codex 走 app-server）连接到：

```
POST/GET/DELETE http://<host>:<port>/mcp/transport
```

按 MCP 2025 规范走 Streamable HTTP。每个 MCP session 在 initialize 时通过 `X-Opencorvus-Directory` 请求头锁定一个工作目录；当配置了 `OPENCORVUS_SERVER_PASSWORD` 时，与其他 API 同一道 HTTP Basic 鉴权也保护此 transport。

OpenCorvus 自动把这个 URL 注入到执行器配置里：

- **Claude Code**：`MCPServe.url(...)` 返回 `McpHttpServerConfig`（`{ type: "http", url, headers }`），由 Anthropic Agent SDK 通过 `--mcp-config` 转发给 claude-code CLI。
- **Codex**：opencorvus 给 `codex app-server` 注入 `-c mcp_servers.opencorvus.url=...`。

暴露工具（`src/mcp/serve.ts`）：`memory`、`task_report`、网页证据工具（`webpage_extract`、`webpage_compile`、`webpage_analyze`、`webpage_runtime_state`、`webpage_render`、`webpage_evaluate`、`webpage_text_diff`、`webpage_vision_judge`）。本地已连接的外部 MCP Server 工具也会作为代理工具一并暴露。

## 7. 连接状态

| 状态                        | 含义                                    |
| --------------------------- | --------------------------------------- |
| `connected`                 | 连接成功                                |
| `disabled`                  | `enabled: false` 或手动断开             |
| `failed`                    | 连接失败（详见 `error`）                |
| `needs_auth`                | 需要 OAuth                              |
| `needs_client_registration` | 服务器不支持动态注册，需提供 `clientId` |

默认超时 30000ms（见 `src/mcp/index.ts` 的 `DEFAULT_TIMEOUT`）；可由单个 server 的 `timeout` 字段或全局 `experimental.mcp_timeout` 调整。
