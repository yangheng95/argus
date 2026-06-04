# JavaScript / TypeScript SDK

**包名**：`@opencorvus-ai/sdk`
**源码**：`packages/sdk/js/`
**用途**：OpenCorvus REST API 的 TypeScript 类型化封装

## 安装

```bash
bun add @opencorvus-ai/sdk
```

## 两种客户端

### 1. 连接已运行的服务

```typescript
import { createOpenCorvusClient } from "@opencorvus-ai/sdk"
// 旧名 createOpencodeClient 仍是 alias，保留向后兼容

const client = createOpenCorvusClient({
  baseUrl: "http://127.0.0.1:7878",
  password: process.env.OPENCORVUS_SERVER_PASSWORD,  // 可选
})

// 创建任务
const { task_id } = await client.task.create({
  request: "为 src/foo.ts 添加单元测试",
})

// 订阅事件流
for await (const event of client.event.subscribe()) {
  console.log(event.type, event)
}
```

### 2. 在进程内嵌入启动

```typescript
import { createOpenCorvus } from "@opencorvus-ai/sdk"
// `createOpencode` 是 `createOpenCorvus` 的 alias

const { client, server } = await createOpenCorvus({
  directory: "/path/to/repo",
})
// ... 使用 client
await server.close()  // server 句柄上的 close() 关闭进程
```

返回对象结构（来自 `packages/sdk/js/src/index.ts:30-43`）：

```typescript
{ client: OpenCorvusClient, server: { url: string, close: () => void } }
```

## 主要命名空间

对应 REST API（见 [API 参考](./api.md)）：

| 命名空间 | 对应端点 |
|---|---|
| `client.task.*` | `/task` / `/tasks` / `/task/:id/*` |
| `client.session.*` | `/session/*` |
| `client.goal.*` / `client.run.*` | `/goal/*` / `/run/*` |
| `client.event.subscribe()` | `/event`（SSE） |
| `client.mcp.*` | `/mcp/*` |
| `client.permission.*` | `/permission/*` |
| `client.skill.*` | `/skill/*` |
| `client.executor.*` | `/executor/*` |
| `client.tui.runtime.*` | `/tui/runtime/*` |

## 事件订阅

`client.event.subscribe()` 返回 `AsyncIterable<Event>`，内部用 SSE 长连接，断连自动指数退避重试（最大 60s）。

```typescript
const stream = client.event.subscribe({ signal: abortController.signal })
for await (const event of stream) {
  if (event.type === "task.updated") { /* ... */ }
}
```

事件类型定义见 [API 参考 § SSE 事件 schema](./api.md#sse-事件-schema)。

## 类型生成

SDK 的类型从 OpenAPI schema 自动生成（由 [`@hey-api/openapi-ts`](https://github.com/hey-api/openapi-ts) 工具链），源文件 `packages/sdk/js/src/gen/`。

重新生成：

```bash
bun ./packages/sdk/js/script/build.ts
```

## 版本

只有一份 SDK 入口（`packages/sdk/js/src/index.ts`），没有 v1 / v2 分支。历史子路径 `@opencorvus-ai/sdk/v2` 已不再需要——直接 `import { createOpenCorvusClient } from "@opencorvus-ai/sdk"`。

## 底层实现

SDK 内部 = `@hey-api/openapi-ts` 生成的 fetch client + 生成的 TypeScript 类型 + SSE helper。若需自定义 HTTP 层（代理、拦截器），可以在 client config 里传入自定义 `fetch`，也可以直接用 REST API，见 [API 参考](./api.md)。
