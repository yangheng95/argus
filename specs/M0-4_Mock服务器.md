# AimeCode M0-4 · Mock 服务器

> **自包含文档**：一个 AI 模型只读这一个文件，就能实现 AimeCode 的完整 Mock API 服务器。
> **前置条件**：M0-1（基础层）已完成——类型定义、Mock 场景数据、Mock 服务类均已就绪。
> **包含**：Bun + Hono API 服务器骨架、SSE 流式推送、REST CRUD（会话/消息）、Mock 数据路由、CORS 配置、健康检查。
> **不包含**：真实 LLM 调用（M2-1）、真实金融数据（M1-3/M1-4）、数据库持久化（M1-2）。

---

## 1. 目标与验收标准

### 1.1 里程碑目标

搭建 Bun + Hono Mock API 服务器，使前端从"浏览器内 Mock"切换为"请求本地 API 服务器"。这建立了前后端分离的架构骨架，后续里程碑只需逐步替换 Mock 实现为 Real 实现，无需重构通信层。

### 1.2 验收标准（逐条可执行）

| # | 验收项 | 操作 | 预期结果 |
|---|---|---|---|
| V1 | 服务器启动 | 执行 `bun run server/index.ts` | 控制台输出 "AimeCode Mock API Server running on http://localhost:3001"，无报错 |
| V2 | 健康检查 | `curl http://localhost:3001/api/health` | 返回 `{ "status": "ok", "mode": "mock", "version": "0.1.0" }` |
| V3 | 创建会话 | `curl -X POST http://localhost:3001/api/sessions` | 返回 `{ "id": "<uuid>", "title": "新对话", "createdAt": "..." }` |
| V4 | 获取会话列表 | `curl http://localhost:3001/api/sessions` | 返回数组，包含刚创建的会话 |
| V5 | SSE 流式聊天 | `curl -N -H "Content-Type: application/json" -d '{"message":"帮我画一下茅台ROE趋势","sessionId":"<id>"}' http://localhost:3001/api/chat` | SSE 流输出，依次包含 `event: thinking`、`event: tool_start`、`event: tool_end`、`event: text_delta`（多条）、`event: chart_data`、`event: code_block`、`event: disclaimer`、`event: done` |
| V6 | 场景匹配 | 分别发送 5 个场景关键词 | 每个返回不同的预制流内容 |
| V7 | 消息持久化 | 发送消息后 `curl http://localhost:3001/api/sessions/<id>/messages` | 返回包含 user 和 assistant 消息的数组 |
| V8 | CORS 正常 | 前端 `http://localhost:5173` 发起请求 | 无 CORS 错误，响应头包含 `Access-Control-Allow-Origin` |
| V9 | 中止流 | SSE 连接中客户端断开 | 服务端检测到断开，停止推送，无内存泄漏 |
| V10 | 前端对接 | 前端配置 `API_BASE_URL=http://localhost:3001` 后，S01 场景走通 | 与纯浏览器 Mock 完全相同的视觉效果 |
| V11 | TypeScript 零错误 | `bun run tsc --noEmit --project server/tsconfig.json` | 0 errors |

---

## 2. 技术栈

```
┌───────────────────────────────────────────────────────────────┐
│                   AimeCode Mock API Server                     │
├──────────────────┬────────────────────────────────────────────┤
│   运行时/打包    │  Bun 1.x（内置 TypeScript、HTTP server）    │
├──────────────────┼────────────────────────────────────────────┤
│   Web 框架       │  Hono 4.x（轻量、类型安全、中间件）         │
├──────────────────┼────────────────────────────────────────────┤
│   SSE 推送       │  Hono streaming helper                     │
├──────────────────┼────────────────────────────────────────────┤
│   存储（Mock）   │  内存 Map（M1-2 替换为 SQLite）             │
├──────────────────┼────────────────────────────────────────────┤
│   类型           │  复用 src/services/types.ts                 │
└──────────────────┴────────────────────────────────────────────┘
```

---

## 3. 项目结构

```
server/
├── index.ts                  # 入口：创建 Hono app、挂载路由、启动监听
├── tsconfig.json             # 服务端 TS 配置
├── routes/
│   ├── health.ts             # GET /api/health
│   ├── sessions.ts           # GET/POST/PATCH/DELETE /api/sessions
│   ├── messages.ts           # GET /api/sessions/:id/messages
│   └── chat.ts               # POST /api/chat（SSE 流式）
├── services/
│   ├── mock-llm.ts           # Mock LLM 流生成（消费 M0-1 场景数据）
│   ├── mock-finance.ts       # Mock 金融数据查询
│   └── mock-executor.ts      # Mock 代码执行
├── store/
│   └── memory-store.ts       # 内存会话/消息存储
└── middleware/
    ├── cors.ts               # CORS 中间件
    ├── logger.ts             # 请求日志
    └── error-handler.ts      # 全局错误处理
```

---

## 4. 核心文件实现

### 4.1 入口文件

文件路径：`server/index.ts`

```typescript
import { Hono } from 'hono'
import { cors } from './middleware/cors'
import { logger } from './middleware/logger'
import { errorHandler } from './middleware/error-handler'
import { healthRoutes } from './routes/health'
import { sessionRoutes } from './routes/sessions'
import { messageRoutes } from './routes/messages'
import { chatRoutes } from './routes/chat'

const app = new Hono()

// ── 中间件 ──────────────────────────────────────────────────
app.use('*', cors())
app.use('*', logger())
app.onError(errorHandler)

// ── 路由 ────────────────────────────────────────────────────
app.route('/api', healthRoutes)
app.route('/api', sessionRoutes)
app.route('/api', messageRoutes)
app.route('/api', chatRoutes)

// ── 启动 ────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001

export default {
  port: PORT,
  fetch: app.fetch,
}

console.log(`AimeCode Mock API Server running on http://localhost:${PORT}`)
```

### 4.2 tsconfig.json

文件路径：`server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../src/services/*"],
      "@mocks/*": ["../src/mocks/*"]
    },
    "types": ["bun-types"]
  },
  "include": ["./**/*.ts"],
  "exclude": ["dist"]
}
```

### 4.3 CORS 中间件

文件路径：`server/middleware/cors.ts`

```typescript
import type { MiddlewareHandler } from 'hono'

export function cors(): MiddlewareHandler {
  return async (c, next) => {
    // 允许前端开发服务器的跨域请求
    const origin = c.req.header('Origin') || '*'
    const allowedOrigins = [
      'http://localhost:5173',   // Vite dev server
      'http://localhost:4173',   // Vite preview
      'http://127.0.0.1:5173',
    ]

    const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0]

    // 处理预检请求
    if (c.req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allowOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    await next()

    c.res.headers.set('Access-Control-Allow-Origin', allowOrigin)
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
}
```

### 4.4 请求日志中间件

文件路径：`server/middleware/logger.ts`

```typescript
import type { MiddlewareHandler } from 'hono'

export function logger(): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now()
    const method = c.req.method
    const path = c.req.path

    await next()

    const ms = (performance.now() - start).toFixed(1)
    const status = c.res.status
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m'
    console.log(`${color}${method}\x1b[0m ${path} → ${status} (${ms}ms)`)
  }
}
```

### 4.5 全局错误处理

文件路径：`server/middleware/error-handler.ts`

```typescript
import type { ErrorHandler } from 'hono'

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message)

  const status = 'status' in err ? (err as { status: number }).status : 500

  return c.json(
    {
      error: {
        message: err.message || 'Internal Server Error',
        code: status,
      },
    },
    status as any,
  )
}
```

### 4.6 内存存储

文件路径：`server/store/memory-store.ts`

```typescript
// 内存存储，M1-2 替换为 Drizzle + SQLite。
// 不持久化，进程重启后清空。

import type { Message, ContentBlock, ToolCallRecord } from '@shared/types'

export interface ServerSession {
  id: string
  title: string
  createdAt: string    // ISO 8601
  updatedAt: string
  messages: ServerMessage[]
}

export interface ServerMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  contentBlocks?: ContentBlock[]
  toolCalls?: ToolCallRecord[]
  thinkingText?: string
  createdAt: string
}

class MemoryStore {
  private sessions = new Map<string, ServerSession>()

  // ── Sessions ──────────────────────────────────────────────
  createSession(): ServerSession {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const session: ServerSession = {
      id,
      title: '新对话',
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    this.sessions.set(id, session)
    return session
  }

  getSession(id: string): ServerSession | undefined {
    return this.sessions.get(id)
  }

  listSessions(): ServerSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  updateSessionTitle(id: string, title: string): ServerSession | undefined {
    const session = this.sessions.get(id)
    if (!session) return undefined
    session.title = title
    session.updatedAt = new Date().toISOString()
    return session
  }

  deleteSession(id: string): boolean {
    return this.sessions.delete(id)
  }

  // ── Messages ──────────────────────────────────────────────
  addMessage(sessionId: string, msg: Omit<ServerMessage, 'id' | 'sessionId' | 'createdAt'>): ServerMessage | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    const message: ServerMessage = {
      id: crypto.randomUUID(),
      sessionId,
      createdAt: new Date().toISOString(),
      ...msg,
    }
    session.messages.push(message)
    session.updatedAt = message.createdAt

    // 自动从首条用户消息生成标题
    if (session.title === '新对话' && msg.role === 'user' && msg.content.length > 0) {
      session.title = msg.content.slice(0, 20) + (msg.content.length > 20 ? '...' : '')
    }

    return message
  }

  getMessages(sessionId: string): ServerMessage[] {
    const session = this.sessions.get(sessionId)
    return session?.messages ?? []
  }
}

export const store = new MemoryStore()
```

### 4.7 健康检查路由

文件路径：`server/routes/health.ts`

```typescript
import { Hono } from 'hono'

export const healthRoutes = new Hono()

healthRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    mode: 'mock',
    version: '0.1.0',
    uptime: Math.floor(process.uptime()),
  })
})
```

### 4.8 会话路由

文件路径：`server/routes/sessions.ts`

```typescript
import { Hono } from 'hono'
import { store } from '../store/memory-store'

export const sessionRoutes = new Hono()

// 获取所有会话
sessionRoutes.get('/sessions', (c) => {
  const sessions = store.listSessions().map(s => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  }))
  return c.json(sessions)
})

// 创建新会话
sessionRoutes.post('/sessions', (c) => {
  const session = store.createSession()
  return c.json({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
  }, 201)
})

// 获取单个会话
sessionRoutes.get('/sessions/:id', (c) => {
  const session = store.getSession(c.req.param('id'))
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  })
})

// 更新会话标题
sessionRoutes.patch('/sessions/:id', async (c) => {
  const body = await c.req.json<{ title?: string }>()
  if (!body.title) return c.json({ error: 'title is required' }, 400)

  const session = store.updateSessionTitle(c.req.param('id'), body.title)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json({ id: session.id, title: session.title })
})

// 删除会话
sessionRoutes.delete('/sessions/:id', (c) => {
  const deleted = store.deleteSession(c.req.param('id'))
  if (!deleted) return c.json({ error: 'Session not found' }, 404)
  return c.json({ deleted: true })
})
```

### 4.9 消息路由

文件路径：`server/routes/messages.ts`

```typescript
import { Hono } from 'hono'
import { store } from '../store/memory-store'

export const messageRoutes = new Hono()

// 获取会话消息列表
messageRoutes.get('/sessions/:id/messages', (c) => {
  const messages = store.getMessages(c.req.param('id'))
  return c.json(messages)
})
```

### 4.10 SSE 聊天路由（核心）

文件路径：`server/routes/chat.ts`

```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { store } from '../store/memory-store'
import { generateMockStream } from '../services/mock-llm'
import type { StreamEvent, ContentBlock, ToolCallRecord } from '@shared/types'

export const chatRoutes = new Hono()

chatRoutes.post('/chat', async (c) => {
  const body = await c.req.json<{ sessionId: string; message: string }>()

  if (!body.sessionId || !body.message) {
    return c.json({ error: 'sessionId and message are required' }, 400)
  }

  // 确保会话存在
  let session = store.getSession(body.sessionId)
  if (!session) {
    // 自动创建会话（前端可能在发送首条消息时才创建）
    session = store.createSession()
    // 注意：这里用新 session 的 id，前端需要处理
  }

  // 保存用户消息
  store.addMessage(body.sessionId, {
    role: 'user',
    content: body.message,
  })

  // 返回 SSE 流
  return streamSSE(c, async (stream) => {
    const contentBlocks: ContentBlock[] = []
    const toolCalls: ToolCallRecord[] = []
    let fullText = ''
    let thinkingText = ''
    let messageId = ''
    let aborted = false

    // 监听客户端断开
    c.req.raw.signal.addEventListener('abort', () => {
      aborted = true
    })

    const events = generateMockStream(body.message)

    for (const event of events) {
      if (aborted) break

      // 根据事件类型进行累积
      switch (event.type) {
        case 'thinking':
          thinkingText += event.content
          break
        case 'text_delta':
          fullText += event.delta
          break
        case 'chart_data':
          contentBlocks.push({ type: 'chart', spec: event.chartSpec })
          break
        case 'table_data':
          contentBlocks.push({ type: 'table', columns: event.columns, rows: event.rows })
          break
        case 'code_block':
          contentBlocks.push({ type: 'code', language: event.language, code: event.code })
          break
        case 'disclaimer':
          contentBlocks.push({ type: 'disclaimer', content: '' })
          break
        case 'tool_start':
          toolCalls.push({
            tool: event.tool,
            source: event.source,
            status: 'pending',
            params: event.params,
          })
          break
        case 'tool_end': {
          const tc = toolCalls.find(t => t.tool === event.tool && t.status === 'pending')
          if (tc) {
            tc.status = 'done'
            tc.summary = event.summary
          }
          break
        }
        case 'tool_error': {
          const te = toolCalls.find(t => t.tool === event.tool && t.status === 'pending')
          if (te) {
            te.status = 'error'
            te.errorMessage = event.error
          }
          break
        }
        case 'done':
          messageId = event.messageId
          break
      }

      // 推送 SSE 事件
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })

      // 模拟延迟（text_delta 30ms，其他 100ms）
      const delay = event.type === 'text_delta' ? 30 : 100
      await new Promise(r => setTimeout(r, delay))
    }

    // 流结束后保存 assistant 消息
    if (!aborted && messageId) {
      store.addMessage(body.sessionId, {
        role: 'assistant',
        content: fullText,
        contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        thinkingText: thinkingText || undefined,
      })
    }
  })
})
```

### 4.11 Mock LLM 流生成

文件路径：`server/services/mock-llm.ts`

```typescript
// 复用 M0-1 的场景定义，将其转化为线性事件序列。
// 此文件是 M0-1 src/mocks/scenarios/ 的服务端版本。
// M0-1 的场景 events 已是 StreamEvent[] 格式，这里直接消费。

import type { StreamEvent } from '@shared/types'

// ── 场景数据（内联，与 M0-1 保持一致）────────────────────────
// 每个场景定义为一个 StreamEvent 数组。
// 这里给出 S01 的完整定义，S02-S05 同理。

interface Scenario {
  id: string
  name: string
  trigger: (input: string) => boolean
  events: StreamEvent[]
}

const S01_EVENTS: StreamEvent[] = [
  { type: 'thinking', content: '用户想查看茅台的ROE趋势，需要调用财报工具获取历史ROE数据，然后生成折线图和分析文字。' },
  { type: 'tool_start', tool: 'get_financial_report', source: 'tushare', params: { ticker: '600519.SH', fields: ['roe'], freq: 'quarterly' } },
  { type: 'tool_end', tool: 'get_financial_report', source: 'tushare', summary: '15条 · 600519.SH · 2021Q1-2024Q3' },
  { type: 'text_delta', delta: '贵州' },
  { type: 'text_delta', delta: '茅台' },
  { type: 'text_delta', delta: '（600519.SH）' },
  { type: 'text_delta', delta: '过去三年' },
  { type: 'text_delta', delta: 'ROE 表现' },
  { type: 'text_delta', delta: '稳健，' },
  { type: 'text_delta', delta: '年化 ROE' },
  { type: 'text_delta', delta: ' 维持在' },
  { type: 'text_delta', delta: ' 33%-38%' },
  { type: 'text_delta', delta: ' 区间，' },
  { type: 'text_delta', delta: '显示出' },
  { type: 'text_delta', delta: '极强的' },
  { type: 'text_delta', delta: '盈利能力' },
  { type: 'text_delta', delta: '和资本' },
  { type: 'text_delta', delta: '回报效率。' },
  { type: 'text_delta', delta: '\n\n' },
  { type: 'text_delta', delta: '从季度' },
  { type: 'text_delta', delta: '累计值' },
  { type: 'text_delta', delta: '来看，' },
  { type: 'text_delta', delta: 'Q4 累计值' },
  { type: 'text_delta', delta: '逐年' },
  { type: 'text_delta', delta: '攀升' },
  { type: 'text_delta', delta: '（2021: 33.2% → ' },
  { type: 'text_delta', delta: '2022: 36.9% → ' },
  { type: 'text_delta', delta: '2023: 38.1%），' },
  { type: 'text_delta', delta: '反映公司' },
  { type: 'text_delta', delta: '净资产' },
  { type: 'text_delta', delta: '收益率' },
  { type: 'text_delta', delta: '持续改善。' },
  {
    type: 'chart_data',
    chartSpec: {
      data: [
        {
          type: 'scatter',
          mode: 'lines+markers',
          name: '贵州茅台 ROE（累计）',
          x: ['2021-Q1','2021-Q2','2021-Q3','2021-Q4','2022-Q1','2022-Q2','2022-Q3','2022-Q4','2023-Q1','2023-Q2','2023-Q3','2023-Q4','2024-Q1','2024-Q2','2024-Q3'],
          y: [8.2, 17.1, 24.8, 33.2, 9.4, 18.7, 27.3, 36.9, 9.8, 20.1, 29.2, 38.1, 10.6, 22.0, 31.5],
          line: { color: '#E8A838', width: 2.5 },
          marker: { size: 7, color: '#E8A838' },
        },
        {
          type: 'scatter',
          mode: 'lines',
          name: '均值 (24.7%)',
          x: ['2021-Q1','2024-Q3'],
          y: [24.7, 24.7],
          line: { color: '#64748B', width: 1, dash: 'dash' },
        },
      ],
      layout: {
        title: { text: '贵州茅台 ROE 趋势（2021Q1-2024Q3）', font: { size: 14 } },
        xaxis: { title: '报告期', tickangle: -45 },
        yaxis: { title: 'ROE (%)', side: 'right', rangemode: 'tozero' },
        annotations: [
          { x: '2023-Q4', y: 38.1, text: '峰值 38.1%', showarrow: true, arrowhead: 2, ax: 30, ay: -25, font: { size: 11, color: '#10B981' } },
        ],
        showlegend: true,
        legend: { x: 0.02, y: 0.98 },
      },
    },
  },
  {
    type: 'table_data',
    columns: ['报告期', 'ROE (%)'],
    rows: [
      ['2021-Q1', 8.2], ['2021-Q2', 17.1], ['2021-Q3', 24.8], ['2021-Q4', 33.2],
      ['2022-Q1', 9.4], ['2022-Q2', 18.7], ['2022-Q3', 27.3], ['2022-Q4', 36.9],
      ['2023-Q1', 9.8], ['2023-Q2', 20.1], ['2023-Q3', 29.2], ['2023-Q4', 38.1],
      ['2024-Q1', 10.6], ['2024-Q2', 22.0], ['2024-Q3', 31.5],
    ],
  },
  {
    type: 'code_block',
    language: 'python',
    code: `import pandas as pd
import plotly.graph_objects as go

# 贵州茅台 ROE 数据（来源：Tushare，截至 2024Q3）
data = {
    '报告期': ['2021-Q1','2021-Q2','2021-Q3','2021-Q4','2022-Q1','2022-Q2',
               '2022-Q3','2022-Q4','2023-Q1','2023-Q2','2023-Q3','2023-Q4',
               '2024-Q1','2024-Q2','2024-Q3'],
    'ROE': [8.2, 17.1, 24.8, 33.2, 9.4, 18.7, 27.3, 36.9, 9.8, 20.1, 29.2, 38.1, 10.6, 22.0, 31.5]
}
df = pd.DataFrame(data)

# 绘制 ROE 趋势折线图
fig = go.Figure()
fig.add_trace(go.Scatter(
    x=df['报告期'], y=df['ROE'],
    mode='lines+markers', name='ROE（累计）',
    line=dict(color='#E8A838', width=2.5),
    marker=dict(size=7),
))

# 均值参考线
mean_roe = df['ROE'].mean()
fig.add_hline(y=mean_roe, line_dash='dash', line_color='gray',
              annotation_text=f'均值 {mean_roe:.1f}%')

# 峰值标注
max_idx = df['ROE'].idxmax()
fig.add_annotation(
    x=df.loc[max_idx, '报告期'], y=df.loc[max_idx, 'ROE'],
    text=f"峰值 {df.loc[max_idx, 'ROE']}%",
    showarrow=True, arrowhead=2,
)

fig.update_layout(
    title='贵州茅台 ROE 趋势（2021Q1-2024Q3）',
    xaxis_title='报告期', yaxis_title='ROE (%)',
    yaxis=dict(side='right'),
    template='plotly_dark',
)
fig.show()`,
  },
  { type: 'disclaimer' },
  { type: 'done', messageId: crypto.randomUUID() },
]

// ── S02-S05 简化定义（完整场景数据见 M0-1 scenarios）────────
// 此处给出触发条件和骨架，完整 events 从 M0-1 复制

const S02_EVENTS: StreamEvent[] = [
  { type: 'thinking', content: '用户的动量因子 IC 偏低，可能存在 look-ahead bias 或存活偏差。需要检查代码逻辑。' },
  { type: 'text_delta', delta: '你的动量因子 IC 偏低，' },
  { type: 'text_delta', delta: '可能存在以下问题：\n\n' },
  { type: 'text_delta', delta: '**1. Look-ahead Bias**：' },
  { type: 'text_delta', delta: '如果你在 t 日使用了 t 日的收盘价计算动量，' },
  { type: 'text_delta', delta: '但用 t 日的收益作为预测目标，' },
  { type: 'text_delta', delta: '就引入了未来信息。\n\n' },
  { type: 'text_delta', delta: '**2. 存活偏差**：' },
  { type: 'text_delta', delta: '如果样本只包含当前在市的股票，' },
  { type: 'text_delta', delta: '会高估动量策略表现。\n\n' },
  { type: 'text_delta', delta: '**修正建议**：' },
  { type: 'text_delta', delta: '使用 t-1 日收盘价计算动量信号，' },
  { type: 'text_delta', delta: 't+1 日收益作为预测目标。' },
  {
    type: 'code_block',
    language: 'python',
    code: `import pandas as pd
import numpy as np

# 修正后的动量因子计算
def calc_momentum_factor(df: pd.DataFrame, lookback: int = 20) -> pd.Series:
    """
    计算动量因子（已修正 look-ahead bias）
    - 使用 t-1 日收盘价计算，避免使用当日数据
    - lookback: 回看天数
    """
    # 关键修正：shift(1) 避免使用当日数据
    past_price = df['close'].shift(1 + lookback)
    current_price = df['close'].shift(1)  # t-1 日价格

    momentum = (current_price - past_price) / past_price
    return momentum

# 修正后的 IC 计算
def calc_ic(factor: pd.Series, forward_return: pd.Series) -> float:
    """计算截面 IC（Spearman 秩相关）"""
    valid = factor.dropna().index.intersection(forward_return.dropna().index)
    if len(valid) < 30:
        return np.nan
    return factor.loc[valid].corr(forward_return.loc[valid], method='spearman')`,
  },
  { type: 'done', messageId: crypto.randomUUID() },
]

const S03_EVENTS: StreamEvent[] = [
  { type: 'thinking', content: '用户需要沪深300成分股的平均换手率数据，并封装成可复用函数。需要调用行情工具和指数成分工具。' },
  { type: 'tool_start', tool: 'get_index_components', source: 'tushare', params: { index_code: '000300.SH' } },
  { type: 'tool_end', tool: 'get_index_components', source: 'tushare', summary: '300只 · 000300.SH' },
  { type: 'tool_start', tool: 'get_market_data', source: 'tushare', params: { ticker: '000300.SH', start_date: '2024-08-01', end_date: '2024-09-15' } },
  { type: 'tool_end', tool: 'get_market_data', source: 'tushare', summary: '30个交易日 · 000300.SH' },
  { type: 'text_delta', delta: '最近30个交易日' },
  { type: 'text_delta', delta: '沪深300成分股' },
  { type: 'text_delta', delta: '平均换手率为 ' },
  { type: 'text_delta', delta: '**1.42%**，' },
  { type: 'text_delta', delta: '处于历史中位偏低水平。' },
  {
    type: 'chart_data',
    chartSpec: {
      data: [{
        type: 'bar',
        name: '日均换手率',
        x: ['09-15','09-14','09-13','09-12','09-11','09-10','09-09','09-08','09-07','09-06',
            '09-05','09-04','09-03','09-02','09-01','08-31','08-30','08-29','08-28','08-27',
            '08-26','08-25','08-24','08-23','08-22','08-21','08-20','08-19','08-18','08-17'],
        y: [1.31,1.28,1.45,1.52,1.38,1.41,1.55,1.62,1.48,1.35,
            1.29,1.33,1.47,1.51,1.44,1.39,1.56,1.61,1.43,1.37,
            1.32,1.46,1.53,1.49,1.42,1.38,1.57,1.63,1.45,1.34],
        marker: { color: '#3B82F6' },
      }],
      layout: {
        title: { text: '沪深300成分股日均换手率（近30交易日）' },
        xaxis: { title: '日期', tickangle: -45 },
        yaxis: { title: '换手率 (%)', side: 'right' },
      },
    },
  },
  {
    type: 'code_block',
    language: 'python',
    code: `import pandas as pd
import numpy as np

def get_hs300_avg_turnover(start_date: str, end_date: str) -> pd.DataFrame:
    """
    获取沪深300成分股在指定区间内的日均换手率。

    参数:
        start_date: 开始日期 (YYYY-MM-DD)
        end_date: 结束日期 (YYYY-MM-DD)

    返回:
        DataFrame，列: date, avg_turnover, median_turnover, max_turnover, min_turnover
    """
    # 示例数据（实际使用时替换为 API 调用）
    dates = pd.bdate_range(start_date, end_date)
    np.random.seed(42)
    turnover = 1.2 + np.random.randn(len(dates)) * 0.15

    df = pd.DataFrame({
        'date': dates.strftime('%Y-%m-%d'),
        'avg_turnover': np.round(turnover, 2),
    })
    return df

# 使用示例
df = get_hs300_avg_turnover('2024-08-01', '2024-09-15')
print(f"区间平均换手率: {df['avg_turnover'].mean():.2f}%")
print(df.head(10))`,
  },
  { type: 'disclaimer' },
  { type: 'done', messageId: crypto.randomUUID() },
]

const S04_EVENTS: StreamEvent[] = [
  { type: 'thinking', content: '用户要用2015年股灾数据做压力测试。需要获取2015年行情数据，然后计算最大回撤。' },
  { type: 'tool_start', tool: 'get_market_data', source: 'tushare', params: { ticker: '000001.SH', start_date: '2015-01-05', end_date: '2015-12-31' } },
  { type: 'tool_end', tool: 'get_market_data', source: 'tushare', summary: '244个交易日 · 上证综指' },
  { type: 'text_delta', delta: '2015年A股经历了' },
  { type: 'text_delta', delta: '剧烈波动，' },
  { type: 'text_delta', delta: '上证综指从6月12日' },
  { type: 'text_delta', delta: '最高5178点' },
  { type: 'text_delta', delta: '跌至8月26日' },
  { type: 'text_delta', delta: '最低2850点，' },
  { type: 'text_delta', delta: '**最大回撤达 44.9%**。' },
  {
    type: 'chart_data',
    chartSpec: {
      data: [
        {
          type: 'candlestick',
          name: '上证综指',
          x: ['2015-06-01','2015-06-08','2015-06-15','2015-06-19','2015-06-26','2015-07-03',
              '2015-07-10','2015-07-17','2015-07-24','2015-07-31','2015-08-07','2015-08-14',
              '2015-08-21','2015-08-28','2015-09-04','2015-09-11','2015-09-18','2015-09-25'],
          open:  [4612,5023,5166,4952,4527,4053,3727,3957,4070,3705,3744,3965,3748,3232,3160,3200,3152,3142],
          high:  [5045,5178,5174,5023,4692,4184,3970,4132,4184,3789,3994,3993,3812,3399,3259,3253,3237,3241],
          low:   [4574,4888,4786,4476,3847,3629,3507,3805,3537,3537,3663,3748,3210,2850,3019,3100,3042,3092],
          close: [5024,5166,4952,4478,4053,3687,3878,4030,3663,3664,3965,3748,3232,3232,3200,3152,3098,3092],
          increasing: { line: { color: '#10B981' }, fillcolor: 'rgba(16,185,129,0.3)' },
          decreasing: { line: { color: '#EF4444' }, fillcolor: 'rgba(239,68,68,0.3)' },
        },
      ],
      layout: {
        title: { text: '2015年上证综指走势（股灾期间）' },
        xaxis: { title: '日期', rangeslider: { visible: false } },
        yaxis: { title: '指数点位', side: 'right' },
        annotations: [
          { x: '2015-06-15', y: 5178, text: '最高 5178', showarrow: true, arrowhead: 2, font: { color: '#10B981' } },
          { x: '2015-08-28', y: 2850, text: '最低 2850', showarrow: true, arrowhead: 2, ay: 30, font: { color: '#EF4444' } },
        ],
      },
    },
  },
  {
    type: 'code_block',
    language: 'python',
    code: `import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# 2015年上证综指月度数据（来源：Tushare）
data = {
    'date': ['2015-01','2015-02','2015-03','2015-04','2015-05','2015-06',
             '2015-07','2015-08','2015-09','2015-10','2015-11','2015-12'],
    'close': [3210,3310,3748,4442,4612,4277,3664,3206,3053,3383,3436,3539],
}
df = pd.DataFrame(data)

# 计算最大回撤
cummax = df['close'].cummax()
drawdown = (df['close'] - cummax) / cummax * 100
max_dd = drawdown.min()
max_dd_idx = drawdown.idxmin()

print(f"最大回撤: {max_dd:.1f}%")
print(f"发生月份: {df.loc[max_dd_idx, 'date']}")

# 绘制回撤曲线
fig = make_subplots(rows=2, cols=1, shared_xaxes=True,
                    row_heights=[0.7, 0.3], vertical_spacing=0.05)

fig.add_trace(go.Scatter(x=df['date'], y=df['close'],
    mode='lines', name='上证综指', line=dict(color='#3B82F6')), row=1, col=1)

fig.add_trace(go.Scatter(x=df['date'], y=drawdown,
    fill='tozeroy', name='回撤', line=dict(color='#EF4444'),
    fillcolor='rgba(239,68,68,0.2)'), row=2, col=1)

fig.update_layout(title='2015年上证综指与最大回撤', template='plotly_dark')
fig.show()`,
  },
  { type: 'disclaimer' },
  { type: 'done', messageId: crypto.randomUUID() },
]

const S05_EVENTS: StreamEvent[] = [
  { type: 'thinking', content: '用户要对比宁德时代、比亚迪、亿纬锂能三家公司。需要并行查询三家的财报数据。' },
  { type: 'tool_start', tool: 'get_financial_report', source: 'tushare', params: { ticker: '300750.SZ', fields: ['revenue_growth','gross_margin','pe_ttm'] } },
  { type: 'tool_start', tool: 'get_financial_report', source: 'tushare', params: { ticker: '002594.SZ', fields: ['revenue_growth','gross_margin','pe_ttm'] } },
  { type: 'tool_start', tool: 'get_financial_report', source: 'tushare', params: { ticker: '300014.SZ', fields: ['revenue_growth','gross_margin','pe_ttm'] } },
  { type: 'tool_end', tool: 'get_financial_report', source: 'tushare', summary: '4条 · 300750.SZ · 宁德时代' },
  { type: 'tool_end', tool: 'get_financial_report', source: 'tushare', summary: '4条 · 002594.SZ · 比亚迪' },
  { type: 'tool_end', tool: 'get_financial_report', source: 'tushare', summary: '4条 · 300014.SZ · 亿纬锂能' },
  { type: 'text_delta', delta: '新能源三巨头' },
  { type: 'text_delta', delta: '最新一期' },
  { type: 'text_delta', delta: '（2024Q3）' },
  { type: 'text_delta', delta: '核心指标对比：\n\n' },
  { type: 'text_delta', delta: '- **营收增速**：' },
  { type: 'text_delta', delta: '比亚迪（24.0%）> 亿纬锂能（18.5%）> 宁德时代（12.4%）\n' },
  { type: 'text_delta', delta: '- **毛利率**：' },
  { type: 'text_delta', delta: '宁德时代（26.3%）> 比亚迪（21.9%）> 亿纬锂能（18.2%）\n' },
  { type: 'text_delta', delta: '- **PE（TTM）**：' },
  { type: 'text_delta', delta: '比亚迪（28.5x）> 宁德时代（22.1x）> 亿纬锂能（15.8x）\n\n' },
  { type: 'text_delta', delta: '比亚迪增长最快但估值最贵；' },
  { type: 'text_delta', delta: '宁德时代盈利能力最强；' },
  { type: 'text_delta', delta: '亿纬锂能估值最低但毛利率承压。' },
  {
    type: 'table_data',
    columns: ['指标', '宁德时代', '比亚迪', '亿纬锂能'],
    rows: [
      ['营收增速 (%)', 12.4, 24.0, 18.5],
      ['毛利率 (%)',   26.3, 21.9, 18.2],
      ['PE (TTM)',    22.1, 28.5, 15.8],
      ['净利率 (%)',   14.2, 5.8,  9.1],
      ['ROE (%)',     21.5, 18.7, 14.3],
    ],
  },
  {
    type: 'chart_data',
    chartSpec: {
      data: [
        {
          type: 'bar', name: '宁德时代',
          x: ['营收增速 (%)','毛利率 (%)','PE (TTM)'],
          y: [12.4, 26.3, 22.1],
          marker: { color: '#3B82F6' },
        },
        {
          type: 'bar', name: '比亚迪',
          x: ['营收增速 (%)','毛利率 (%)','PE (TTM)'],
          y: [24.0, 21.9, 28.5],
          marker: { color: '#10B981' },
        },
        {
          type: 'bar', name: '亿纬锂能',
          x: ['营收增速 (%)','毛利率 (%)','PE (TTM)'],
          y: [18.5, 18.2, 15.8],
          marker: { color: '#F59E0B' },
        },
      ],
      layout: {
        title: { text: '新能源三巨头核心指标对比（2024Q3）' },
        barmode: 'group',
        yaxis: { title: '数值', side: 'right' },
      },
    },
  },
  {
    type: 'code_block',
    language: 'python',
    code: `import pandas as pd
import plotly.graph_objects as go

# 三家公司最新财报数据（来源：Tushare，2024Q3）
companies = {
    '宁德时代': {'revenue_growth': 12.4, 'gross_margin': 26.3, 'pe_ttm': 22.1, 'net_margin': 14.2, 'roe': 21.5},
    '比亚迪':   {'revenue_growth': 24.0, 'gross_margin': 21.9, 'pe_ttm': 28.5, 'net_margin': 5.8,  'roe': 18.7},
    '亿纬锂能': {'revenue_growth': 18.5, 'gross_margin': 18.2, 'pe_ttm': 15.8, 'net_margin': 9.1,  'roe': 14.3},
}

df = pd.DataFrame(companies).T
print(df.to_string())

# 分组柱状图
metrics = ['revenue_growth', 'gross_margin', 'pe_ttm']
labels = ['营收增速 (%)', '毛利率 (%)', 'PE (TTM)']
colors = ['#3B82F6', '#10B981', '#F59E0B']

fig = go.Figure()
for i, (name, data) in enumerate(companies.items()):
    fig.add_trace(go.Bar(
        name=name,
        x=labels,
        y=[data[m] for m in metrics],
        marker_color=colors[i],
    ))

fig.update_layout(
    title='新能源三巨头核心指标对比（2024Q3）',
    barmode='group', template='plotly_dark',
    yaxis=dict(title='数值', side='right'),
)
fig.show()`,
  },
  { type: 'disclaimer' },
  { type: 'done', messageId: crypto.randomUUID() },
]

// ── 场景注册 ────────────────────────────────────────────────
const SCENARIOS: Scenario[] = [
  {
    id: 'S01',
    name: '财报可视化',
    trigger: (input) => /roe|净资产收益|财报|趋势/.test(input.toLowerCase()),
    events: S01_EVENTS,
  },
  {
    id: 'S02',
    name: '因子调试',
    trigger: (input) => /ic|因子|动量|look.?ahead|alpha/.test(input.toLowerCase()),
    events: S02_EVENTS,
  },
  {
    id: 'S03',
    name: '数据封装',
    trigger: (input) => /换手率|封装|成分股|沪深300/.test(input.toLowerCase()),
    events: S03_EVENTS,
  },
  {
    id: 'S04',
    name: '压力测试',
    trigger: (input) => /股灾|压力测试|回撤|2015|最大回撤/.test(input.toLowerCase()),
    events: S04_EVENTS,
  },
  {
    id: 'S05',
    name: '多标的对比',
    trigger: (input) => /对比|比较|宁德|比亚迪|亿纬/.test(input.toLowerCase()),
    events: S05_EVENTS,
  },
]

// 默认场景（无匹配时）
const DEFAULT_EVENTS: StreamEvent[] = [
  { type: 'thinking', content: '分析用户意图...' },
  { type: 'text_delta', delta: '你好！' },
  { type: 'text_delta', delta: '我是 AimeCode，' },
  { type: 'text_delta', delta: '你的金融数据分析助手。' },
  { type: 'text_delta', delta: '\n\n我可以帮你：\n' },
  { type: 'text_delta', delta: '- 📊 查询和可视化财报数据\n' },
  { type: 'text_delta', delta: '- 📈 分析行情走势\n' },
  { type: 'text_delta', delta: '- 🔧 调试量化因子代码\n' },
  { type: 'text_delta', delta: '- 📉 历史情景压力测试\n' },
  { type: 'text_delta', delta: '- 🆚 多标的横向对比\n\n' },
  { type: 'text_delta', delta: '请告诉我你想做什么？' },
  { type: 'done', messageId: crypto.randomUUID() },
]

/**
 * 根据用户输入生成 Mock StreamEvent 序列。
 * 返回同步数组（非 async generator），由 chat 路由按延迟推送。
 */
export function generateMockStream(input: string): StreamEvent[] {
  for (const scenario of SCENARIOS) {
    if (scenario.trigger(input)) {
      console.log(`  [Mock LLM] Matched scenario: ${scenario.id} ${scenario.name}`)
      return scenario.events
    }
  }
  console.log('  [Mock LLM] No scenario matched, using default')
  return DEFAULT_EVENTS
}
```

---

## 5. 前端 API Client 适配

前端需要一个统一的 API Client 层，使切换 Mock/Real 后端时无需修改组件代码。

文件路径：`src/services/api-client.ts`

```typescript
// 前端 API Client
// Mock 模式：直接调用浏览器内 Mock 服务（M0-1）
// Server 模式：请求 Bun API Server（M0-4 或 M1+）
// 由 config.store.useServerApi 控制

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

export interface ApiClientConfig {
  baseUrl: string
}

class ApiClient {
  private baseUrl: string

  constructor(config?: ApiClientConfig) {
    this.baseUrl = config?.baseUrl || API_BASE
  }

  // ── Sessions ──────────────────────────────────────────────
  async createSession(): Promise<{ id: string; title: string; createdAt: string }> {
    const res = await fetch(`${this.baseUrl}/api/sessions`, { method: 'POST' })
    if (!res.ok) throw new Error(`Create session failed: ${res.status}`)
    return res.json()
  }

  async listSessions(): Promise<Array<{ id: string; title: string; updatedAt: string; messageCount: number }>> {
    const res = await fetch(`${this.baseUrl}/api/sessions`)
    if (!res.ok) throw new Error(`List sessions failed: ${res.status}`)
    return res.json()
  }

  async updateSession(id: string, title: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error(`Update session failed: ${res.status}`)
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`Delete session failed: ${res.status}`)
  }

  async getMessages(sessionId: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/messages`)
    if (!res.ok) throw new Error(`Get messages failed: ${res.status}`)
    return res.json()
  }

  // ── Chat (SSE) ────────────────────────────────────────────
  async *streamChat(
    sessionId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<any, void, unknown> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
      signal,
    })

    if (!res.ok) {
      throw new Error(`Chat request failed: ${res.status}`)
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 解析 SSE 格式
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''  // 保留不完整的行

      let eventType = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const parsed = JSON.parse(data)
            yield parsed
          } catch {
            // 忽略非 JSON 行
          }
        }
        // 空行表示事件结束
      }
    }
  }

  // ── Health ────────────────────────────────────────────────
  async health(): Promise<{ status: string; mode: string; version: string }> {
    const res = await fetch(`${this.baseUrl}/api/health`)
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
    return res.json()
  }
}

export const apiClient = new ApiClient()
```

---

## 6. Vite 环境变量

文件路径：`.env.development`

```env
VITE_API_BASE_URL=http://localhost:3001
```

文件路径：`.env.production`

```env
VITE_API_BASE_URL=/api
```

---

## 7. 启动脚本

在 `package.json` 中添加：

```json
{
  "scripts": {
    "dev": "vite",
    "dev:server": "bun run server/index.ts",
    "dev:all": "concurrently \"bun run dev\" \"bun run dev:server\"",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

需要安装 `concurrently`：

```bash
pnpm add -D concurrently
```

---

## 8. 集成陷阱

| # | 问题 | 解决方案 |
|---|---|---|
| T1 | Bun 导入 `@shared/types` 路径别名不生效 | `server/tsconfig.json` 配 `paths`，且 Bun 原生支持 `tsconfig.json` 路径（需 `bun run` 而非 `node`） |
| T2 | SSE 响应必须设置正确 Content-Type | Hono `streamSSE` 自动设置 `text/event-stream`，不要手动覆盖 |
| T3 | 浏览器 EventSource 只支持 GET，但 chat 是 POST | 不用 `EventSource`，用 `fetch` + `ReadableStream` 手动解析 SSE（`api-client.ts` 中的 `streamChat`） |
| T4 | SSE 数据中的换行符会破坏 SSE 协议 | Hono `streamSSE` 的 `writeSSE` 会自动处理 data 中的换行，无需手动转义 |
| T5 | 客户端断开后服务端继续推送导致报错 | 在 chat 路由中监听 `c.req.raw.signal` 的 `abort` 事件，及时终止循环 |
| T6 | `crypto.randomUUID()` 在 Bun 中可用 | Bun 内置 Web Crypto API，直接使用 |
| T7 | CORS 预检请求（OPTIONS）未处理 | cors 中间件需显式返回 204 for OPTIONS |
| T8 | 前端 `fetch` 跨域时不发送 cookie | Mock 阶段不需要 cookie，M1+ 需要时在 cors 中加 `credentials: include` |
| T9 | `concurrently` 在 Windows 下可能有路径问题 | 使用 `"dev:all"` 脚本时，确保 `bun` 在 PATH 中；或改用 `npm-run-all` |
| T10 | SSE 数据包可能被合并（浏览器缓冲） | 在 SSE 响应头中加 `Cache-Control: no-cache`，Hono streaming 默认已处理 |
