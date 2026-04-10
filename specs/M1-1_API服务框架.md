# AimeCode M1-1 · API 服务框架

> **自包含文档**：一个 AI 模型只读这一个文件，就能将 M0-4 的 Mock 服务器升级为生产级 API 框架。
> **前置条件**：M0-4（Mock 服务器）已完成——Bun + Hono 骨架、SSE 路由、CORS 中间件均已就绪。
> **包含**：路由架构、中间件栈（认证/限流/验证/日志/错误处理）、SSE 流式推送增强、请求/响应类型定义、API 文档（OpenAPI）、优雅关闭。
> **不包含**：数据库（M1-2）、真实 LLM 调用（M2-1）、真实金融数据（M1-3/M1-4）。

---

## 1. 目标与验收标准

### 1.1 里程碑目标

将 M0-4 的 Mock 服务器升级为可承载真实后端逻辑的 API 框架：统一的错误格式、请求验证、速率限制、结构化日志、API Key 认证、优雅关闭。后续里程碑只需在这个框架上插入具体服务实现。

### 1.2 验收标准

| # | 验收项 | 操作 | 预期结果 |
|---|---|---|---|
| V1 | 请求验证 | `curl -X POST /api/chat -d '{}'` | 400，body `{ "error": { "code": "VALIDATION_ERROR", "message": "sessionId is required", "field": "sessionId" } }` |
| V2 | API Key 认证 | `curl -H "Authorization: Bearer invalid" /api/chat` | 401，body `{ "error": { "code": "UNAUTHORIZED", "message": "Invalid API key" } }` |
| V3 | 无 Key 时 Mock 模式 | `curl /api/health`（不带 Authorization） | 200，`mode: "mock"` |
| V4 | 速率限制 | 1 秒内连发 30 次 `/api/chat` | 第 21 次起返回 429，header `Retry-After: N` |
| V5 | 结构化日志 | 发送任意请求后查看 stdout | JSON 格式日志含 `timestamp`, `method`, `path`, `status`, `durationMs`, `requestId` |
| V6 | 请求 ID 链路 | 发送请求后检查响应头 | `X-Request-Id: <uuid>` 存在 |
| V7 | 优雅关闭 | 发送 SIGTERM | 等待进行中请求完成（最多 10s），打印 "Server shut down gracefully"，进程退出 0 |
| V8 | OpenAPI 文档 | `curl /api/docs` | 返回 JSON 格式 OpenAPI 3.0 spec |
| V9 | SSE 心跳 | 开启 SSE 连接等待 30s | 每 15s 收到 `event: ping` |
| V10 | TypeScript 零错误 | `bun run tsc --noEmit --project server/tsconfig.json` | 0 errors |

---

## 2. 项目结构（M0-4 → M1-1 增量）

```
server/
├── index.ts                    # 入口（升级：优雅关闭）
├── config.ts                   # 服务端配置（环境变量）
├── routes/
│   ├── health.ts               # GET /api/health（增强）
│   ├── sessions.ts             # 升级：请求验证
│   ├── messages.ts             # 升级：请求验证
│   ├── chat.ts                 # 升级：SSE 心跳 + 认证
│   └── docs.ts                 # NEW: GET /api/docs
├── services/                   # Mock 服务（不变）
├── store/                      # 内存存储（M1-2 替换）
├── middleware/
│   ├── cors.ts                 # 不变
│   ├── logger.ts               # 升级：结构化 JSON
│   ├── error-handler.ts        # 升级：统一错误格式
│   ├── request-id.ts           # NEW: X-Request-Id
│   ├── auth.ts                 # NEW: API Key 认证
│   ├── rate-limit.ts           # NEW: 速率限制
│   └── validate.ts             # NEW: 请求体验证
└── types/
    ├── api.ts                  # API 请求/响应类型
    └── errors.ts               # 错误码枚举
```

---

## 3. 服务端配置

文件路径：`server/config.ts`

```typescript
// 从环境变量读取配置，提供类型安全的默认值。
// 不使用 .env 文件（Bun 内置 process.env 读取）。

export const config = {
  // 服务器
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST || '0.0.0.0',
  env: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',

  // 认证
  // 开发模式下无 key 自动进入 Mock 模式
  // 生产模式下必须配置
  apiKeyRequired: process.env.API_KEY_REQUIRED === 'true',

  // 速率限制
  rateLimit: {
    windowMs: 60_000,           // 1 分钟窗口
    maxRequests: 60,            // 每窗口最大请求数
    maxChatRequests: 20,        // /api/chat 单独限制（流式占资源多）
  },

  // SSE
  sse: {
    heartbeatIntervalMs: 15_000, // 心跳间隔
    maxStreamDurationMs: 300_000, // 流最大持续时间 5 分钟
  },

  // CORS
  cors: {
    allowedOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:4173').split(','),
  },

  // 日志
  log: {
    level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
    format: (process.env.LOG_FORMAT || 'json') as 'json' | 'pretty',
  },

  // 超时
  gracefulShutdownTimeoutMs: 10_000,
} as const

export type Config = typeof config
```

---

## 4. 错误码体系

文件路径：`server/types/errors.ts`

```typescript
export const ErrorCode = {
  // 客户端错误 4xx
  VALIDATION_ERROR:  'VALIDATION_ERROR',
  UNAUTHORIZED:      'UNAUTHORIZED',
  FORBIDDEN:         'FORBIDDEN',
  NOT_FOUND:         'NOT_FOUND',
  RATE_LIMITED:      'RATE_LIMITED',
  CONFLICT:          'CONFLICT',

  // 服务端错误 5xx
  INTERNAL_ERROR:    'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  LLM_ERROR:         'LLM_ERROR',
  DATA_SOURCE_ERROR:  'DATA_SOURCE_ERROR',
  EXECUTION_ERROR:    'EXECUTION_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
  }

  static validation(message: string, field?: string): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, message, 400, field ? { field } : undefined)
  }

  static unauthorized(message = 'Invalid API key'): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, message, 401)
  }

  static notFound(resource: string): AppError {
    return new AppError(ErrorCode.NOT_FOUND, `${resource} not found`, 404)
  }

  static rateLimited(retryAfterMs: number): AppError {
    return new AppError(ErrorCode.RATE_LIMITED, 'Too many requests', 429, { retryAfterMs })
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, message, 500)
  }
}
```

---

## 5. API 请求/响应类型

文件路径：`server/types/api.ts`

```typescript
import type { ContentBlock, ToolCallRecord } from '@shared/types'

// ── 通用响应 ─────────────────────────────────────────────────
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    field?: string
    details?: Record<string, unknown>
  }
}

// ── Sessions ─────────────────────────────────────────────────
export interface CreateSessionResponse {
  id: string
  title: string
  createdAt: string
}

export interface SessionListItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface UpdateSessionRequest {
  title: string
}

// ── Messages ─────────────────────────────────────────────────
export interface MessageResponse {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  contentBlocks?: ContentBlock[]
  toolCalls?: ToolCallRecord[]
  thinkingText?: string
  createdAt: string
}

// ── Chat ─────────────────────────────────────────────────────
export interface ChatRequest {
  sessionId: string
  message: string
  options?: {
    maxTokens?: number
    systemPromptOverride?: string
  }
}

// ── Health ────────────────────────────────────────────────────
export interface HealthResponse {
  status: 'ok' | 'degraded'
  mode: 'mock' | 'real'
  version: string
  uptime: number
  services: {
    llm: 'connected' | 'disconnected' | 'mock'
    finance: 'connected' | 'disconnected' | 'mock'
    database: 'connected' | 'disconnected' | 'memory'
    executor: 'connected' | 'disconnected' | 'mock'
  }
}
```

---

## 6. 核心中间件

### 6.1 Request ID

文件路径：`server/middleware/request-id.ts`

```typescript
import type { MiddlewareHandler } from 'hono'

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header('X-Request-Id') || crypto.randomUUID()
    c.set('requestId', id)
    await next()
    c.res.headers.set('X-Request-Id', id)
  }
}
```

### 6.2 结构化日志

文件路径：`server/middleware/logger.ts`

```typescript
import type { MiddlewareHandler } from 'hono'
import { config } from '../config'

interface LogEntry {
  timestamp: string
  level: string
  method: string
  path: string
  status: number
  durationMs: number
  requestId: string
  userAgent?: string
  error?: string
}

export function structuredLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now()

    await next()

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - start),
      requestId: c.get('requestId') || '-',
    }

    if (c.res.status >= 400) {
      entry.userAgent = c.req.header('User-Agent')
    }

    if (config.log.format === 'json') {
      console.log(JSON.stringify(entry))
    } else {
      const color = entry.status >= 500 ? '\x1b[31m' : entry.status >= 400 ? '\x1b[33m' : '\x1b[32m'
      console.log(`${color}${entry.method}\x1b[0m ${entry.path} → ${entry.status} (${entry.durationMs}ms) [${entry.requestId.slice(0, 8)}]`)
    }
  }
}
```

### 6.3 API Key 认证

文件路径：`server/middleware/auth.ts`

```typescript
import type { MiddlewareHandler } from 'hono'
import { config } from '../config'
import { AppError } from '../types/errors'

declare module 'hono' {
  interface ContextVariableMap {
    authMode: 'mock' | 'real'
    anthropicApiKey?: string
    tushareToken?: string
  }
}

/**
 * 认证中间件。
 *
 * 策略：
 * - 请求头包含有效 API Key → real 模式
 * - 请求头无 Key 且配置允许 → mock 模式
 * - 请求头无 Key 且配置要求必须有 Key → 401
 *
 * Key 格式：Bearer <anthropic_key>:<tushare_token>
 * 或前端通过 JSON body 传递（chat 请求时）。
 */
export function auth(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader) {
      if (config.apiKeyRequired) {
        throw AppError.unauthorized('API key is required')
      }
      // 无 key，进入 mock 模式
      c.set('authMode', 'mock')
      await next()
      return
    }

    // 解析 Bearer token
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      throw AppError.unauthorized('Invalid Authorization header format')
    }

    // 支持两种格式：
    // 1. 纯 Anthropic Key: sk-ant-xxx
    // 2. 组合格式: sk-ant-xxx:tushare_token
    const parts = token.split(':')
    const anthropicKey = parts[0]
    const tushareToken = parts[1] || undefined

    // 基本格式验证（不调用远程验证，由具体 Service 在首次使用时验证）
    if (!anthropicKey.startsWith('sk-ant-')) {
      throw AppError.unauthorized('Invalid Anthropic API key format')
    }

    c.set('authMode', 'real')
    c.set('anthropicApiKey', anthropicKey)
    if (tushareToken) c.set('tushareToken', tushareToken)

    await next()
  }
}

/**
 * 可选认证：不阻止无 key 的请求，但会标记模式。
 * 用于 /api/health 等公开端点。
 */
export function optionalAuth(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')
    c.set('authMode', authHeader ? 'real' : 'mock')
    await next()
  }
}
```

### 6.4 速率限制

文件路径：`server/middleware/rate-limit.ts`

```typescript
import type { MiddlewareHandler } from 'hono'
import { config } from '../config'
import { AppError } from '../types/errors'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// 定期清理过期条目
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 60_000)

export function rateLimit(opts?: { maxRequests?: number }): MiddlewareHandler {
  const max = opts?.maxRequests ?? config.rateLimit.maxRequests
  const windowMs = config.rateLimit.windowMs

  return async (c, next) => {
    // 用 IP 作为限流 key（开发环境宽松）
    const key = c.req.header('X-Forwarded-For') || c.req.header('CF-Connecting-IP') || 'local'
    const now = Date.now()

    let entry = store.get(key)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    // 设置限流响应头
    c.res.headers.set('X-RateLimit-Limit', String(max))
    c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    c.res.headers.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      c.res.headers.set('Retry-After', String(retryAfter))
      throw AppError.rateLimited(entry.resetAt - now)
    }

    await next()
  }
}
```

### 6.5 请求验证

文件路径：`server/middleware/validate.ts`

```typescript
import type { MiddlewareHandler } from 'hono'
import { AppError } from '../types/errors'

type Schema = Record<string, { type: 'string' | 'number' | 'boolean' | 'object'; required?: boolean; minLength?: number; maxLength?: number }>

/**
 * 轻量级请求体验证。
 * 不引入 zod/joi 等外部库——M0 阶段保持零额外依赖。
 * M2+ 可换用 zod。
 */
export function validateBody(schema: Schema): MiddlewareHandler {
  return async (c, next) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      throw AppError.validation('Invalid JSON body')
    }

    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field]

      if (rules.required && (value === undefined || value === null || value === '')) {
        throw AppError.validation(`${field} is required`, field)
      }

      if (value !== undefined && value !== null) {
        if (rules.type === 'string' && typeof value !== 'string') {
          throw AppError.validation(`${field} must be a string`, field)
        }
        if (rules.type === 'number' && typeof value !== 'number') {
          throw AppError.validation(`${field} must be a number`, field)
        }
        if (rules.type === 'string' && typeof value === 'string') {
          if (rules.minLength && value.length < rules.minLength) {
            throw AppError.validation(`${field} must be at least ${rules.minLength} characters`, field)
          }
          if (rules.maxLength && value.length > rules.maxLength) {
            throw AppError.validation(`${field} must be at most ${rules.maxLength} characters`, field)
          }
        }
      }
    }

    await next()
  }
}
```

### 6.6 统一错误处理（升级版）

文件路径：`server/middleware/error-handler.ts`

```typescript
import type { ErrorHandler } from 'hono'
import { AppError } from '../types/errors'
import type { ApiErrorResponse } from '../types/api'

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') || '-'

  if (err instanceof AppError) {
    const response: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...err.details,
      },
    }
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      requestId,
      error: err.code,
      message: err.message,
    }))
    return c.json(response, err.status as any)
  }

  // 未预期的错误
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    requestId,
    error: 'UNHANDLED',
    message: err.message,
    stack: err.stack,
  }))

  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } satisfies ApiErrorResponse,
    500,
  )
}
```

---

## 7. 升级入口文件

文件路径：`server/index.ts`

```typescript
import { Hono } from 'hono'
import { config } from './config'
import { requestId } from './middleware/request-id'
import { structuredLogger } from './middleware/logger'
import { errorHandler } from './middleware/error-handler'
import { auth, optionalAuth } from './middleware/auth'
import { rateLimit } from './middleware/rate-limit'
import { cors } from './middleware/cors'
import { healthRoutes } from './routes/health'
import { sessionRoutes } from './routes/sessions'
import { messageRoutes } from './routes/messages'
import { chatRoutes } from './routes/chat'
import { docsRoutes } from './routes/docs'

const app = new Hono()

// ── 全局中间件（执行顺序从上到下）────────────────────────────
app.use('*', requestId())          // 1. 分配请求 ID
app.use('*', cors())               // 2. CORS
app.use('*', structuredLogger())   // 3. 结构化日志
app.use('*', rateLimit())          // 4. 全局速率限制
app.onError(errorHandler)          // 5. 统一错误格式化

// ── 公开路由（不需要认证）─────────────────────────────────────
app.route('/api', healthRoutes)    // GET /api/health
app.route('/api', docsRoutes)      // GET /api/docs

// ── 需认证的路由 ─────────────────────────────────────────────
// chat 路由有额外的速率限制
const protectedApp = new Hono()
protectedApp.use('*', auth())
protectedApp.route('/', sessionRoutes)
protectedApp.route('/', messageRoutes)

const chatApp = new Hono()
chatApp.use('*', auth())
chatApp.use('*', rateLimit({ maxRequests: config.rateLimit.maxChatRequests }))
chatApp.route('/', chatRoutes)

app.route('/api', protectedApp)
app.route('/api', chatApp)

// ── 启动服务器 ───────────────────────────────────────────────
const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
})

console.log(`AimeCode API Server running on http://${config.host}:${config.port} [${config.env}]`)

// ── 优雅关闭 ─────────────────────────────────────────────────
let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(`\n[${signal}] Shutting down gracefully...`)

  // 停止接受新连接
  server.stop()

  // 等待进行中的请求完成
  await new Promise(resolve => setTimeout(resolve, config.gracefulShutdownTimeoutMs))

  console.log('Server shut down gracefully')
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
```

---

## 8. SSE 流式推送增强

文件路径：`server/routes/chat.ts`（升级版）

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { store } from '../store/memory-store'
import { generateMockStream } from '../services/mock-llm'
import { config } from '../config'
import { AppError } from '../types/errors'
import type { StreamEvent, ContentBlock, ToolCallRecord } from '@shared/types'

export const chatRoutes = new Hono()

chatRoutes.post('/chat', async (c) => {
  // 验证请求体
  let body: { sessionId: string; message: string; options?: { maxTokens?: number } }
  try {
    body = await c.req.json()
  } catch {
    throw AppError.validation('Invalid JSON body')
  }

  if (!body.sessionId || typeof body.sessionId !== 'string') {
    throw AppError.validation('sessionId is required', 'sessionId')
  }
  if (!body.message || typeof body.message !== 'string') {
    throw AppError.validation('message is required', 'message')
  }
  if (body.message.length > 10_000) {
    throw AppError.validation('message must be at most 10000 characters', 'message')
  }

  const authMode = c.get('authMode')
  const session = store.getSession(body.sessionId)
  if (!session) {
    throw AppError.notFound('Session')
  }

  // 保存用户消息
  store.addMessage(body.sessionId, {
    role: 'user',
    content: body.message,
  })

  // ── SSE 流 ──────────────────────────────────────────────
  return streamSSE(c, async (stream) => {
    const contentBlocks: ContentBlock[] = []
    const toolCalls: ToolCallRecord[] = []
    let fullText = ''
    let thinkingText = ''
    let messageId = ''
    let aborted = false

    // 客户端断开检测
    c.req.raw.signal.addEventListener('abort', () => { aborted = true })

    // 心跳定时器（防止代理/CDN 超时断开）
    const heartbeat = setInterval(async () => {
      if (aborted) return
      try {
        await stream.writeSSE({ event: 'ping', data: '' })
      } catch {
        aborted = true
      }
    }, config.sse.heartbeatIntervalMs)

    // 流最大持续时间保护
    const maxDurationTimer = setTimeout(() => { aborted = true }, config.sse.maxStreamDurationMs)

    try {
      // 根据认证模式选择服务
      const events = authMode === 'real'
        ? generateMockStream(body.message)  // M2-1 替换为真实 LLM
        : generateMockStream(body.message)

      for (const event of events) {
        if (aborted) break

        // 累积内容（同 M0-4 逻辑）
        switch (event.type) {
          case 'thinking':   thinkingText += event.content; break
          case 'text_delta': fullText += event.delta; break
          case 'chart_data': contentBlocks.push({ type: 'chart', spec: event.chartSpec }); break
          case 'table_data': contentBlocks.push({ type: 'table', columns: event.columns, rows: event.rows }); break
          case 'code_block': contentBlocks.push({ type: 'code', language: event.language, code: event.code }); break
          case 'disclaimer': contentBlocks.push({ type: 'disclaimer', content: '' }); break
          case 'tool_start':
            toolCalls.push({ tool: event.tool, source: event.source, status: 'pending', params: event.params });
            break
          case 'tool_end': {
            const tc = toolCalls.find(t => t.tool === event.tool && t.status === 'pending')
            if (tc) { tc.status = 'done'; tc.summary = event.summary }
            break
          }
          case 'tool_error': {
            const te = toolCalls.find(t => t.tool === event.tool && t.status === 'pending')
            if (te) { te.status = 'error'; te.errorMessage = event.error }
            break
          }
          case 'done': messageId = event.messageId; break
        }

        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })

        const delay = event.type === 'text_delta' ? 30 : 100
        await new Promise(r => setTimeout(r, delay))
      }

      // 保存 assistant 消息
      if (!aborted && messageId) {
        store.addMessage(body.sessionId, {
          role: 'assistant',
          content: fullText,
          contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          thinkingText: thinkingText || undefined,
        })
      }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(maxDurationTimer)
    }
  })
})
```

---

## 9. OpenAPI 文档路由

文件路径：`server/routes/docs.ts`

```typescript
import { Hono } from 'hono'

export const docsRoutes = new Hono()

docsRoutes.get('/docs', (c) => {
  return c.json({
    openapi: '3.0.3',
    info: {
      title: 'AimeCode API',
      version: '0.1.0',
      description: '金融 AI 分析助手 API',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local development' },
    ],
    paths: {
      '/api/health': {
        get: {
          summary: '健康检查',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/sessions': {
        get: {
          summary: '获取会话列表',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: '会话数组' } },
        },
        post: {
          summary: '创建新会话',
          security: [{ bearerAuth: [] }],
          responses: { 201: { description: '会话对象' } },
        },
      },
      '/api/sessions/{id}': {
        patch: {
          summary: '更新会话标题',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: '更新后的会话' } },
        },
        delete: {
          summary: '删除会话',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: '删除确认' } },
        },
      },
      '/api/sessions/{id}/messages': {
        get: {
          summary: '获取会话消息',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: '消息数组' } },
        },
      },
      '/api/chat': {
        post: {
          summary: '发送消息（SSE 流式响应）',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sessionId', 'message'],
                  properties: {
                    sessionId: { type: 'string' },
                    message: { type: 'string', maxLength: 10000 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'SSE 流', content: { 'text/event-stream': {} } },
            400: { description: '参数错误' },
            401: { description: '未认证' },
            429: { description: '请求过多' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Anthropic API Key (sk-ant-xxx) 或组合格式 (sk-ant-xxx:tushare_token)',
        },
      },
    },
  })
})
```

---

## 10. 集成陷阱

| # | 问题 | 解决方案 |
|---|---|---|
| T1 | `Bun.serve` 不支持 `server.close()` 的 drain 参数 | 用 `server.stop()` + `setTimeout` 实现优雅关闭 |
| T2 | Hono 的 `c.req.json()` 在 body 为空时抛异常 | 在 `validateBody` 和 `chat` 路由中用 try-catch 包裹 |
| T3 | SSE 心跳在 stream 已关闭后写入会报错 | heartbeat callback 中 try-catch，出错即 `aborted = true` |
| T4 | `streamSSE` 的 `writeSSE` 不自动 flush | Bun 的 HTTP 实现默认 flush，无需额外处理 |
| T5 | 速率限制 Map 在长期运行后内存泄漏 | 定期（每分钟）清理过期条目 |
| T6 | `process.on('SIGINT')` 在 Windows 上行为不同 | 在 Windows 上 Ctrl+C 触发 SIGINT 正常，但 SIGTERM 需要 `taskkill` |
| T7 | Hono `ContextVariableMap` 类型扩展需要 `declare module` | 在 `request-id.ts` 和 `auth.ts` 中用 `declare module 'hono'` 扩展 |
| T8 | 多个 `app.use('*', rateLimit())` 会重复限流 | chat 路由的额外限流放在独立 sub-app 上，全局限流不重复计数（用不同 Map key 前缀） |
