# AimeCode M0-2 · UI 层

> **自包含文档**：一个 AI 模型只读这一个文件，就能在 M0-1 基础上实现全部 UI 层。
> **前置条件**：M0-1 已完成（类型定义、常量、服务接口、Mock 数据、Mock 服务实现、Zustand Stores、服务注册表、最小启动入口）。
> **产出**：全部 React 组件、Hooks、页面和入口文件，S01-S05 五个场景 Mock 链路视觉完整走通。

---

## 1. 目标与验收标准

### 1.1 里程碑目标

在 M0-1 提供的服务层和状态管理层之上，实现 AimeCode 的完整 UI：Hooks、聊天组件、输出组件、布局组件、页面和入口。最终 S01-S05 五个场景的 Mock 链路视觉完整走通。

### 1.2 验收标准

| # | 验收项 | 操作 | 预期结果 |
|---|---|---|---|
| V1 | S01 完整走通 | 在 InputBar 输入"帮我画一下茅台ROE趋势"，按 Enter | 左栏：thinking 提示 → ToolCallBadge(pending→done) → 文字逐字出现；右栏：图表渲染 + 代码块 + 免责声明 |
| V2 | S02-S05 全部走通 | 依次输入"我的动量因子IC很低" / "帮我封装换手率查询" / "用2015股灾数据跑回撤" / "对比宁德比亚迪亿纬" | 每个场景正确触发对应预制流，左右栏渲染对应内容 |
| V3 | 流式输出无闪烁 | 在 S01 场景中观察文字追加过程 | 文字逐字追加，无全量重渲、无闪烁、无卡顿 |
| V4 | 拖拽分栏工作 | 拖动左右栏之间的分隔线 | 宽度实时变化，Plotly 图表自适应新宽度，最小宽度 300px |
| V5 | CSV 导出工作 | 在 S03 或 S05 场景中点击表格右上角"导出 CSV"按钮 | 浏览器下载 CSV 文件，用 Excel 打开无乱码（含 BOM），数字为原始值 |
| V6 | 代码复制工作 | 在任意含代码块的场景中点击"复制"按钮 | 代码完整写入剪贴板，按钮文字变为"已复制"1.5 秒后恢复 |
| V7 | 停止按钮工作 | 在 S01 流式输出过程中点击停止按钮（或按 Escape） | 流中止，已生成内容保留，InputBar 恢复可输入状态 |
| V8 | 新会话空态引导 | 点击侧边栏"新对话"按钮 | 中间区域显示引导卡片（4 个场景入口），点击任一卡片自动发送对应提示 |
| V9 | 刷新后会话恢复 | 完成一个场景后刷新页面（F5） | 侧边栏会话列表恢复，点击会话后消息历史完整还原，右栏渲染对应 contentBlocks |
| V10 | TypeScript 零错误 | 执行 `pnpm tsc --noEmit` | 输出 0 errors |
| V11 | 暗色/亮色主题切换 | 点击 AppHeader 右侧的月亮/太阳图标 | 整个页面立即切换主题，刷新后恢复上次选择 |
| V12 | 设置弹窗可用 | 点击 AppHeader 右侧的设置图标 | 弹出设置弹窗，显示 API Key / Tushare Token（密码遮掩）/ Sandbox URL 输入框 + Mock/Real 切换开关，点击"保存"后弹出"设置已保存"提示并关闭弹窗 |
| V13 | 会话重命名 | 双击侧边栏中任意会话的标题 | 标题变为内联输入框，输入新名称后按 Enter 或点击其他区域即完成重命名 |
| V14 | 错误消息渲染 | 在 Mock 服务返回 error 事件后（或手动触发）| 聊天区域出现带有红色警告图标的错误提示，不崩溃，可继续发送新消息 |

---

## 2. 前置条件（M0-1 已提供的内容）

M0-2 只在以下已有导出之上构建 UI，不修改 M0-1 的任何文件（除 `src/App.tsx` 和 `src/main.tsx`）。

### 2.1 类型（`src/services/types.ts`）

```typescript
// 关键导出：
export type StreamEvent = /* 11 种事件的 discriminated union */
export type ContentBlock = /* text | code | chart | table | disclaimer */
export interface Message { id: string; role: MessageRole; content: string; contentBlocks?: ContentBlock[]; createdAt: Date }
export interface ChatOptions { tools?: ToolDefinition[]; systemPrompt?: string; maxTokens?: number }
export interface ExecutionResult { status: 'ok' | 'error' | 'timeout'; stdout: string; stderr: string; charts: Array<{ id: string; spec: object }>; durationMs: number }
```

### 2.2 Stores

**useSessionStore**（`src/stores/session.store.ts`）：

- 状态：`sessionsById`, `sessionOrder`, `currentSessionId`, `isStreaming`, `streamingBlocks`
- 动作：`createSession()`, `selectSession(id)`, `addUserMessage(content)`, `appendStreamEvent(event)`, `finalizeAssistantMessage(messageId)`, `setStreaming(v)`, `clearStreamingBlocks()`

**useConfigStore**（`src/stores/config.store.ts`）：

- 状态：`useMock`, `anthropicApiKey`
- 动作：`setUseMock(v)`, `setApiKey(key)`

### 2.3 Registry（`src/services/registry.ts`）

```typescript
export function getLLMService(): ILLMService
export function getFinanceService(): IFinanceService
export function getExecutorService(): IExecutorService
export function resetServiceCache(): void
```

### 2.4 Mock

- `detectScenario(input: string): Scenario` — 按关键词匹配 S01-S05
- `MockLLMService` — 消费场景 events 并按延迟 yield
- `MockFinanceService` — 从内联 Mock 数据返回
- `MockExecutorService` — 延迟 500ms 返回成功结果

### 2.5 常量

- `DISCLAIMER_TEXT`（`src/constants/disclaimer.ts`）
- `TOOL_DEFINITIONS`（`src/services/tool_definitions.ts`）

### 2.6 UI 基础组件（Button、ScrollArea）

M0-2 多处引用 `@/components/ui/button` 和 `@/components/ui/scroll-area`，使用内联实现，无需 shadcn CLI。

**文件路径：`src/components/ui/button.tsx`**

```tsx
import { forwardRef } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

type ButtonVariant = 'default' | 'outline' | 'ghost'
type ButtonSize = 'default' | 'sm' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={twMerge(clsx(
          'inline-flex items-center justify-center rounded-[6px] font-medium transition-colors duration-[120ms] focus:outline-none focus:ring-[3px] focus:ring-accent-subtle disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-accent text-fg-on-accent hover:bg-accent-hover':                           variant === 'default',
            'border border-border-default bg-base text-fg-default hover:bg-muted':         variant === 'outline',
            'text-fg-muted hover:bg-muted hover:text-fg-default':                          variant === 'ghost',
          },
          {
            'h-9 px-3 text-sm':  size === 'default',
            'h-7 px-2 text-xs':  size === 'sm',
            'h-10 px-4 text-sm': size === 'lg',
          },
          className,
        ))}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
```

**文件路径：`src/components/ui/scroll-area.tsx`**

```tsx
import { clsx } from 'clsx'

interface ScrollAreaProps {
  children: React.ReactNode
  className?: string
}

// 轻量级实现：原生 overflow-y-auto，无第三方依赖
export function ScrollArea({ children, className }: ScrollAreaProps) {
  return (
    <div className={clsx('overflow-y-auto', className)}>
      {children}
    </div>
  )
}
```

---

## 3. Hooks（完整代码）

### 3.1 `src/hooks/useChat.ts`

```typescript
import { useCallback } from 'react'
import { useSessionStore } from '@/stores/session.store'
import { getLLMService } from '@/services/registry'
import { TOOL_DEFINITIONS } from '@/services/tool_definitions'
import type { Message } from '@/services/types'

const MAX_CONTEXT_TURNS = 20

function buildContextMessages(allMessages: Message[]): Message[] {
  const sliced = allMessages.slice(-MAX_CONTEXT_TURNS * 2)
  const firstUserIdx = sliced.findIndex(m => m.role === 'user')
  return firstUserIdx > 0 ? sliced.slice(firstUserIdx) : sliced
}

export function useChat() {
  const isStreaming = useSessionStore(s => s.isStreaming)
  const currentSessionId = useSessionStore(s => s.currentSessionId)

  const sendMessage = useCallback(async (content: string) => {
    const store = useSessionStore.getState()
    if (store.isStreaming) return
    if (!content.trim()) return

    let sessionId = store.currentSessionId
    if (!sessionId) {
      sessionId = store.createSession()
    }

    store.addUserMessage(content)
    store.setStreaming(true)
    store.clearStreamingBlocks()

    const session = useSessionStore.getState().sessionsById[sessionId]
    if (!session) return

    const contextMessages = buildContextMessages(session.messages)
    const llm = getLLMService()

    try {
      const stream = llm.chat(contextMessages, { tools: TOOL_DEFINITIONS })
      for await (const event of stream) {
        if (!useSessionStore.getState().isStreaming) break

        store.appendStreamEvent(event)

        if (event.type === 'done') {
          store.finalizeAssistantMessage(event.messageId)
          return
        }
        if (event.type === 'error') {
          store.setStreaming(false)
          return
        }
      }
    } catch (err) {
      console.error('[useChat] stream error:', err)
      store.setStreaming(false)
    }
  }, [])

  const stopStreaming = useCallback(() => {
    const store = useSessionStore.getState()
    if (!store.isStreaming) return

    const llm = getLLMService()
    llm.abort()

    const messageId = crypto.randomUUID()
    store.finalizeAssistantMessage(messageId)
  }, [])

  return { sendMessage, stopStreaming, isStreaming, currentSessionId }
}
```

### 3.2 `src/hooks/useStream.ts`

```typescript
import { useMemo } from 'react'
import { useSessionStore } from '@/stores/session.store'
import type { ContentBlock } from '@/services/types'

export function useStream() {
  const streamingBlocks = useSessionStore(s => s.streamingBlocks)
  const streamingToolCalls = useSessionStore(s => s.streamingToolCalls)
  const streamingThinking = useSessionStore(s => s.streamingThinking)
  const isStreaming = useSessionStore(s => s.isStreaming)

  const { currentText, richBlocks } = useMemo(() => {
    const textBlocks: Array<ContentBlock & { type: 'text' }> = []
    const rich: ContentBlock[] = []

    for (const block of streamingBlocks) {
      if (block.type === 'text') {
        textBlocks.push(block as ContentBlock & { type: 'text' })
      } else {
        rich.push(block)
      }
    }

    return {
      currentText: textBlocks.map(b => b.content).join(''),
      richBlocks: rich,
    }
  }, [streamingBlocks])

  return { currentText, richBlocks, toolCalls: streamingToolCalls, thinking: streamingThinking, isStreaming }
}
```

### 3.3 `src/hooks/useExecutor.ts`

```typescript
import { useState, useCallback } from 'react'
import { useSessionStore } from '@/stores/session.store'
import { getExecutorService } from '@/services/registry'
import type { ExecutionResult } from '@/services/types'

type ExecutorStatus = 'idle' | 'running' | 'done' | 'error' | 'timeout'

export function useExecutor() {
  const [status, setStatus] = useState<ExecutorStatus>('idle')
  const [result, setResult] = useState<ExecutionResult | null>(null)

  const execute = useCallback(async (code: string) => {
    setStatus('running')
    setResult(null)
    try {
      const svc = getExecutorService()
      const res = await svc.execute({
        code,
        language: 'python',
        sessionId: useSessionStore.getState().currentSessionId ?? '',
      })
      setResult(res)
      setStatus(res.status === 'ok' ? 'done' : res.status)
    } catch (err) {
      console.error('[useExecutor]', err)
      setStatus('error')
    }
  }, [])

  return { execute, status, result }
}
```

### 3.4 `src/hooks/useOnlineStatus.ts`

```typescript
import { useState, useEffect } from 'react'

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return isOnline
}
```

### 3.5 `src/hooks/useEntityParser.ts`

```typescript
import { useCallback } from 'react'
import { resolveTicker } from '@/mocks/data/companies'
import dayjs from 'dayjs'

export interface ParsedEntities {
  tickers: string[]
  dateRange?: { start: string; end: string }
  indexCodes: string[]
  original: string
}

const DATE_PATTERNS: Array<{ pattern: RegExp; resolve: (m: RegExpMatchArray) => { start: string; end: string } }> = [
  {
    pattern: /最近(\d+)年/,
    resolve: (m) => ({
      start: dayjs().subtract(parseInt(m[1]), 'year').format('YYYY-MM-DD'),
      end: dayjs().format('YYYY-MM-DD'),
    }),
  },
  {
    pattern: /过去(\d+)个?季度/,
    resolve: (m) => ({
      start: dayjs().subtract(parseInt(m[1]) * 3, 'month').format('YYYY-MM-DD'),
      end: dayjs().format('YYYY-MM-DD'),
    }),
  },
  {
    pattern: /(\d{4})年/,
    resolve: (m) => ({
      start: `${m[1]}-01-01`,
      end: `${m[1]}-12-31`,
    }),
  },
]

const INDEX_MAP: Record<string, string> = {
  '沪深300': '000300.SH',
  'hs300': '000300.SH',
  '中证500': '000905.SH',
  '创业板指': '399006.SZ',
  '上证50': '000016.SH',
}

export function useEntityParser() {
  const parse = useCallback((input: string): ParsedEntities => {
    const tickers: string[] = []
    const indexCodes: string[] = []
    let dateRange: { start: string; end: string } | undefined

    const ticker = resolveTicker(input)
    if (ticker) tickers.push(ticker)

    for (const [key, code] of Object.entries(INDEX_MAP)) {
      if (input.toLowerCase().includes(key.toLowerCase())) {
        indexCodes.push(code)
      }
    }

    for (const { pattern, resolve } of DATE_PATTERNS) {
      const m = input.match(pattern)
      if (m) {
        dateRange = resolve(m)
        break
      }
    }

    return { tickers, dateRange, indexCodes, original: input }
  }, [])

  return { parse, resolveTicker }
}
```

---

## 4. 聊天组件（完整代码）

### 4.1 `src/components/chat/ToolCallBadge.tsx`

```tsx
import { Loader2, Check, X } from 'lucide-react'

interface ToolCallBadgeProps {
  tool: string
  source: string
  status: 'pending' | 'done' | 'error'
  params?: Record<string, unknown>
  summary?: string
  errorMessage?: string
}

const TOOL_LABELS: Record<string, string> = {
  get_financial_report: '财报查询',
  get_market_data: '行情查询',
  get_index_components: '成分查询',
}

export function ToolCallBadge({ tool, source, status, params, summary, errorMessage }: ToolCallBadgeProps) {
  const label = TOOL_LABELS[tool] ?? tool
  const ticker = params?.ticker as string | undefined

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs leading-4
        border transition-colors duration-[120ms]
        ${status === 'pending' ? 'text-fg-muted border-border-default' : ''}
        ${status === 'done' ? 'text-success border-success' : ''}
        ${status === 'error' ? 'text-error border-error' : ''}
      `}
    >
      {status === 'pending' && <Loader2 className="w-3 h-3 animate-spin" />}
      {status === 'done' && <Check className="w-3 h-3" />}
      {status === 'error' && <X className="w-3 h-3" />}

      <span>{status === 'pending' ? '查询中' : status === 'done' ? '已获取' : '查询失败'}</span>
      <span className="text-fg-subtle">·</span>
      <span>{source}</span>
      <span className="text-fg-subtle">·</span>
      <span>{label}</span>
      {ticker && (
        <>
          <span className="text-fg-subtle">·</span>
          <span>{ticker}</span>
        </>
      )}
      {status === 'done' && summary && (
        <>
          <span className="text-fg-subtle">·</span>
          <span>{summary}</span>
        </>
      )}
      {status === 'error' && errorMessage && (
        <>
          <span className="text-fg-subtle">·</span>
          <span>{errorMessage}</span>
        </>
      )}
    </span>
  )
}
```

### 4.2 `src/components/chat/MessageBubble.tsx`

```tsx
import ReactMarkdown from 'react-markdown'
import { ToolCallBadge } from './ToolCallBadge'
import type { Message } from '@/services/types'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] rounded-[6px] bg-muted px-3.5 py-2.5 text-sm leading-[22px] text-fg-default">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-full text-sm leading-[22px] text-fg-default space-y-2">
        {/* 思考过程（历史消息恢复） */}
        {message.thinkingText && (
          <div className="text-xs text-fg-subtle italic border-l-2 border-border-muted pl-2">
            {message.thinkingText}
          </div>
        )}
        {/* 工具调用徽章（历史消息恢复） */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.toolCalls.map((tc, i) => (
              <ToolCallBadge
                key={i}
                tool={tc.tool}
                source={tc.source}
                status={tc.status}
                params={tc.params}
                summary={tc.summary}
                errorMessage={tc.errorMessage}
              />
            ))}
          </div>
        )}
        {/* 文字内容 */}
        {message.contentBlocks ? (
          <div className="space-y-2">
            {message.contentBlocks
              .filter(b => b.type === 'text')
              .map((block, i) => (
                <div key={i} className="prose prose-sm max-w-none">
                  <ReactMarkdown>{(block as { type: 'text'; content: string }).content}</ReactMarkdown>
                </div>
              ))}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-fg-default ml-0.5 animate-[blink_1s_step-end_infinite]" />
        )}
      </div>
    </div>
  )
}
```

### 4.3 `src/components/chat/MessageList.tsx`

```tsx
import { useRef, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageBubble } from './MessageBubble'
import { ToolCallBadge } from './ToolCallBadge'
import { useStream } from '@/hooks/useStream'
import { useSessionStore } from '@/stores/session.store'
import type { Message } from '@/services/types'
import ReactMarkdown from 'react-markdown'

export function MessageList() {
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const session = useSessionStore(s => currentSessionId ? s.sessionsById[currentSessionId] : null)
  const messages = session?.messages ?? []
  const { currentText, toolCalls, thinking, isStreaming } = useStream()

  const parentRef = useRef<HTMLDivElement>(null)
  const scrolledToBottomRef = useRef(true)

  const items = useMemo(() => {
    const result: Array<{ type: 'message'; message: Message } | { type: 'streaming' }> = messages.map(m => ({
      type: 'message' as const,
      message: m,
    }))
    if (isStreaming) {
      result.push({ type: 'streaming' as const })
    }
    return result
  }, [messages, isStreaming])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  })

  useEffect(() => {
    if (scrolledToBottomRef.current && parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight
    }
  }, [items.length, currentText])

  const handleScroll = () => {
    const el = parentRef.current
    if (!el) return
    const threshold = 100
    scrolledToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }

  const scrollToBottom = () => {
    if (parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight
      scrolledToBottomRef.current = true
    }
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={parentRef}
        className="h-full overflow-y-auto px-5 py-4"
        onScroll={handleScroll}
      >
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualItem => {
            const item = items[virtualItem.index]
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
              >
                {item.type === 'message' ? (
                  <MessageBubble message={item.message} />
                ) : (
                  <div className="flex justify-start mb-4">
                    <div className="max-w-full text-sm leading-[22px] text-fg-default space-y-2">
                      {/* 思考过程 */}
                      {thinking && (
                        <div className="text-xs text-fg-subtle italic border-l-2 border-border-muted pl-2">
                          {thinking}
                        </div>
                      )}
                      {/* 工具调用徽章 */}
                      {toolCalls.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {toolCalls.map((badge, i) => (
                            <ToolCallBadge key={i} {...badge} />
                          ))}
                        </div>
                      )}
                      {/* 流式文字 */}
                      {currentText && (
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown>{currentText}</ReactMarkdown>
                        </div>
                      )}
                      <span className="inline-block w-0.5 h-4 bg-fg-default ml-0.5 animate-[blink_1s_step-end_infinite]" />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {!scrolledToBottomRef.current && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-base border border-border-default rounded-full px-3 py-1.5 text-xs text-fg-muted shadow-sm hover:bg-muted transition-all duration-[120ms]"
        >
          ↓ 滚动到最新
        </button>
      )}
    </div>
  )
}
```

### 4.4 `src/components/chat/InputBar.tsx`

```tsx
import { useState, useRef, useCallback } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/useChat'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

export function InputBar() {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, stopStreaming, isStreaming } = useChat()
  const isOnline = useOnlineStatus()

  const handleSend = useCallback(() => {
    if (!text.trim() || isStreaming) return
    sendMessage(text.trim())
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, isStreaming, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  return (
    <div className="border-t border-border-default px-5 py-3">
      {!isOnline && (
        <div className="mb-2 px-3 py-1.5 bg-warning/10 text-warning text-xs rounded">
          网络已断开，消息将在恢复后发送
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={1}
          className="flex-1 resize-none bg-base border border-border-default rounded-lg px-3.5 py-2.5 text-sm leading-[22px] text-fg-default placeholder:text-fg-subtle max-h-[160px] overflow-y-auto transition-[border-color] duration-[120ms] focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-subtle disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {isStreaming ? (
          <Button
            onClick={stopStreaming}
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 border-error text-error hover:bg-error/10"
          >
            <Square className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={!text.trim()}
            size="sm"
            className="h-9 w-9 p-0 bg-accent text-fg-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
```

### 4.5 `src/components/chat/ChatPanel.tsx`

```tsx
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { useSessionStore } from '@/stores/session.store'
import { useChat } from '@/hooks/useChat'

const ONBOARDING_CARDS = [
  { icon: '📊', title: '查询财报', prompt: '帮我画一下茅台ROE趋势' },
  { icon: '📈', title: '绘制图表', prompt: '用2015股灾数据跑回撤' },
  { icon: '🔍', title: '对比分析', prompt: '对比宁德比亚迪亿纬' },
  { icon: '🛠', title: '代码调试', prompt: '我的动量因子IC很低' },
]

function OnboardingView({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8">
      <h1 className="text-2xl font-semibold text-fg-default mb-2">AimeCode</h1>
      <p className="text-sm text-fg-muted mb-8">用自然语言分析金融数据，无需切换工具</p>
      <div className="grid grid-cols-2 gap-3 max-w-md w-full">
        {ONBOARDING_CARDS.map(card => (
          <button
            key={card.title}
            onClick={() => onSelectPrompt(card.prompt)}
            className="flex flex-col items-start gap-1.5 p-4 rounded-[6px] border border-border-default bg-base hover:bg-muted transition-colors duration-[120ms] text-left"
          >
            <span className="text-lg">{card.icon}</span>
            <span className="text-sm font-medium text-fg-default">{card.title}</span>
            <span className="text-xs text-fg-muted leading-4">"{card.prompt}"</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function ChatPanel() {
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const session = useSessionStore(s => currentSessionId ? s.sessionsById[currentSessionId] : null)
  const hasMessages = (session?.messages.length ?? 0) > 0
  const { sendMessage } = useChat()

  const handleSelectPrompt = (prompt: string) => {
    sendMessage(prompt)
  }

  return (
    <div className="flex flex-col h-full bg-base">
      {hasMessages ? (
        <MessageList />
      ) : (
        <OnboardingView onSelectPrompt={handleSelectPrompt} />
      )}
      <InputBar />
    </div>
  )
}
```

---

## 5. 输出组件（完整代码）

### 5.1 `src/components/output/SafeRender.tsx`

```tsx
import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class SafeRender extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SafeRender] caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-3 rounded-[6px] border border-error/30 bg-error/5 text-xs text-error">
            渲染失败：{this.state.error?.message ?? '未知错误'}
          </div>
        )
      )
    }
    return this.props.children
  }
}
```

### 5.2 `src/components/output/CodeBlock.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import { codeToHtml } from 'shiki'
import { Copy, Check, Play, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useExecutor } from '@/hooks/useExecutor'
import { ChartRenderer } from './ChartRenderer'

interface CodeBlockProps {
  language: string
  code: string
  showRunButton?: boolean
}

export function CodeBlock({ language, code, showRunButton = true }: CodeBlockProps) {
  const [html, setHtml] = useState('')
  const [copied, setCopied] = useState(false)
  const { execute, status, result } = useExecutor()
  const [expanded, setExpanded] = useState(false)

  const lineCount = code.split('\n').length
  const needsCollapse = lineCount > 20

  useEffect(() => {
    codeToHtml(code, { lang: language || 'text', theme: 'github-light' }).then(setHtml)
  }, [code, language])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [code])

  const handleRun = useCallback(() => {
    execute(code)
  }, [code, execute])

  const isPython = language === 'python'
  const showRun = showRunButton && isPython

  return (
    <div className="rounded-[6px] border border-border-muted bg-subtle overflow-hidden">
      <div className="flex justify-between items-center px-3 py-1.5 bg-muted border-b border-border-muted">
        <span className="text-xs text-fg-muted">{language || 'code'}</span>
        <div className="flex items-center gap-1">
          {showRun && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRun}
              disabled={status === 'running'}
              className="h-7 px-2 text-xs text-fg-muted hover:text-fg-default"
            >
              {status === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span className="ml-1">{status === 'running' ? '运行中' : '运行'}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-xs text-fg-muted hover:text-fg-default"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="ml-1">{copied ? '已复制' : '复制'}</span>
          </Button>
        </div>
      </div>

      <div
        className={`px-4 py-3 overflow-x-auto font-mono text-[13px] leading-5 ${needsCollapse && !expanded ? 'max-h-[380px] overflow-y-hidden' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {needsCollapse && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-1.5 text-xs text-accent hover:text-accent-hover bg-subtle border-t border-border-muted transition-colors duration-[120ms]"
        >
          展开全部（{lineCount} 行）
        </button>
      )}

      {result && (
        <div className="border-t border-border-muted">
          {result.stdout && (
            <div className="px-4 py-3 bg-[#1a1a1a] text-[#e5e7eb] font-mono text-xs leading-[18px] max-h-[200px] overflow-y-auto whitespace-pre-wrap">
              {result.stdout}
            </div>
          )}
          {result.stderr && result.status === 'error' && (
            <div className="px-4 py-3 bg-error/5 text-error font-mono text-xs leading-[18px]">
              {result.stderr}
            </div>
          )}
          {result.status === 'timeout' && (
            <div className="px-4 py-2 bg-warning/10 text-warning text-xs">
              执行超时（&gt;30s），代码中可能存在无限循环
            </div>
          )}
          {result.charts.map(chart => (
            <ChartRenderer key={chart.id} spec={chart.spec} />
          ))}
          <div className="px-4 py-1 text-right text-[11px] text-fg-subtle">
            {(result.durationMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </div>
  )
}
```

### 5.3 `src/components/output/ChartRenderer.tsx`

```tsx
import { useRef, useEffect, useState } from 'react'
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

const Plot = createPlotlyComponent(Plotly)

interface ChartRendererProps {
  spec: object
  height?: number
  showToolbar?: boolean
}

export function ChartRenderer({ spec, height = 380, showToolbar = true }: ChartRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const plotSpec = spec as { data?: object[]; layout?: Record<string, unknown> }
  const data = plotSpec.data ?? []
  const layout = {
    ...plotSpec.layout,
    height,
    width: containerWidth > 0 ? containerWidth - 32 : undefined,
    font: { family: 'Inter, PingFang SC, sans-serif', size: 12, color: 'var(--fg-default)' },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    xaxis: {
      ...(plotSpec.layout?.xaxis as object ?? {}),
      gridcolor: 'var(--border-muted)',
      linecolor: 'var(--border-default)',
    },
    yaxis: {
      ...(plotSpec.layout?.yaxis as object ?? {}),
      gridcolor: 'var(--border-muted)',
      linecolor: 'var(--border-default)',
      side: 'right',
    },
    margin: { l: 8, r: 60, t: 36, b: 32, ...(plotSpec.layout?.margin as object ?? {}) },
    legend: { orientation: 'h' as const, y: 1.02, font: { size: 11 } },
    hovermode: 'x unified' as const,
  }

  const config = {
    displayModeBar: showToolbar ? 'hover' as const : false as const,
    responsive: true,
    toImageButtonOptions: {
      format: 'png' as const,
      filename: 'aimecode-chart',
      height: 600,
      width: 800,
    },
  }

  return (
    <div ref={containerRef} className="rounded-[6px] border border-border-muted bg-base p-4 min-h-[300px]">
      {containerWidth > 0 && (
        <Plot
          data={data as Plotly.Data[]}
          layout={layout}
          config={config}
          useResizeHandler
          style={{ width: '100%' }}
        />
      )}
    </div>
  )
}
```

### 5.4 `src/components/output/DataTable.tsx`

```tsx
import { useMemo, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Papa from 'papaparse'

interface DataTableProps {
  columns: string[]
  rows: unknown[][]
  sourceInfo?: { source: string; asOf?: string; count?: number }
}

const PERCENT_KEYWORDS = ['margin', 'rate', 'ratio', 'yoy', 'roe', 'roa']
const AMOUNT_KEYWORDS = ['revenue', 'profit', 'amount']
const MULTIPLE_KEYWORDS = ['pe', 'pb', 'ev']

function formatValue(value: unknown, columnName: string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'number') return String(value)

  const lowerCol = columnName.toLowerCase()

  if (PERCENT_KEYWORDS.some(k => lowerCol.includes(k))) {
    return (value * 100).toFixed(1) + '%'
  }
  if (AMOUNT_KEYWORDS.some(k => lowerCol.includes(k))) {
    if (Math.abs(value) >= 1e8) {
      return (value / 1e8).toFixed(2) + '亿'
    }
    if (Math.abs(value) >= 1e4) {
      return (value / 1e4).toFixed(2) + '万'
    }
    return value.toFixed(2)
  }
  if (MULTIPLE_KEYWORDS.some(k => lowerCol.includes(k))) {
    return value.toFixed(1) + 'x'
  }
  return typeof value === 'number' ? value.toFixed(2) : String(value)
}

function isNumericColumn(rows: unknown[][], colIndex: number): boolean {
  return rows.some(row => typeof row[colIndex] === 'number')
}

function getPercentColor(value: unknown): string {
  if (typeof value !== 'number') return ''
  if (value > 0) return 'text-fin-up'
  if (value < 0) return 'text-fin-down'
  return ''
}

export function DataTable({ columns, rows, sourceInfo }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])

  const tableData = useMemo(() =>
    rows.map((row, idx) => {
      const obj: Record<string, unknown> = { __rowIndex: idx }
      columns.forEach((col, i) => { obj[col] = row[i] })
      return obj
    }),
    [columns, rows]
  )

  const columnDefs: ColumnDef<Record<string, unknown>>[] = useMemo(() =>
    columns.map((col, colIdx) => ({
      accessorKey: col,
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 select-none"
          onClick={() => column.toggleSorting()}
        >
          {col}
          {column.getIsSorted() === 'asc' && <ArrowUp className="w-3 h-3" />}
          {column.getIsSorted() === 'desc' && <ArrowDown className="w-3 h-3" />}
          {!column.getIsSorted() && <ArrowUpDown className="w-3 h-3 text-fg-subtle" />}
        </button>
      ),
      cell: ({ getValue }) => {
        const val = getValue()
        const formatted = formatValue(val, col)
        const numeric = isNumericColumn(rows, colIdx)
        const lowerCol = col.toLowerCase()
        const isPercent = PERCENT_KEYWORDS.some(k => lowerCol.includes(k))
        const colorClass = isPercent ? getPercentColor(val) : ''
        return (
          <span className={`${numeric ? 'text-right tabular-nums' : ''} ${colorClass}`}>
            {formatted}
          </span>
        )
      },
    })),
    [columns, rows]
  )

  const table = useReactTable({
    data: tableData,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const handleExportCSV = () => {
    const csv = Papa.unparse({ fields: columns, data: rows })
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'aimecode-data.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-[6px] border border-border-muted overflow-hidden">
      <div className="flex justify-between items-center px-3 py-1.5 bg-muted border-b border-border-muted">
        <span className="text-xs text-fg-muted">
          {sourceInfo ? `${sourceInfo.source}${sourceInfo.asOf ? ` · ${sourceInfo.asOf}` : ''}${sourceInfo.count ? ` · ${sourceInfo.count}条` : ''}` : '数据表格'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportCSV}
          className="h-7 px-2 text-xs text-fg-muted hover:text-fg-default"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="ml-1">导出 CSV</span>
        </Button>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className="sticky top-0 bg-subtle px-3 py-2 text-left font-semibold border-b-2 border-border-default cursor-pointer select-none"
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-muted transition-colors">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-3 py-1.5 border-b border-border-muted">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

### 5.5 `src/components/output/SourceTag.tsx`

```tsx
interface SourceTagProps {
  source: string
  asOf?: string
  count?: number
}

export function SourceTag({ source, asOf, count }: SourceTagProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-fg-muted leading-[18px]">
      <span>来源：{source}</span>
      {asOf && (
        <>
          <span className="text-fg-subtle">·</span>
          <span>{asOf}</span>
        </>
      )}
      {count !== undefined && (
        <>
          <span className="text-fg-subtle">·</span>
          <span>{count}条</span>
        </>
      )}
    </div>
  )
}
```

### 5.6 `src/components/output/Disclaimer.tsx`

```tsx
import { DISCLAIMER_TEXT } from '@/constants/disclaimer'

export function Disclaimer() {
  return (
    <div className="mt-6 px-4 py-3 text-[11px] leading-4 text-fg-subtle border-l-2 border-border-muted">
      {DISCLAIMER_TEXT}
    </div>
  )
}
```

### 5.7 `src/components/output/OutputPanel.tsx`

```tsx
import { useMemo } from 'react'
import { useStream } from '@/hooks/useStream'
import { useSessionStore } from '@/stores/session.store'
import { SafeRender } from './SafeRender'
import { CodeBlock } from './CodeBlock'
import { ChartRenderer } from './ChartRenderer'
import { DataTable } from './DataTable'
import { Disclaimer } from './Disclaimer'
import type { ContentBlock } from '@/services/types'

function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'code':
      return <CodeBlock language={block.language} code={block.code} />
    case 'chart':
      return <ChartRenderer spec={block.spec} />
    case 'table':
      return <DataTable columns={block.columns} rows={block.rows} />
    case 'disclaimer':
      return <Disclaimer />
    default:
      return null
  }
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-sm text-fg-muted">← 向左侧发送消息开始分析</p>
    </div>
  )
}

export function OutputPanel() {
  const { richBlocks, isStreaming } = useStream()
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const session = useSessionStore(s => currentSessionId ? s.sessionsById[currentSessionId] : null)

  const historicalBlocks = useMemo(() => {
    if (!session) return []
    const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant?.contentBlocks) return []
    return lastAssistant.contentBlocks.filter(b => b.type !== 'text')
  }, [session])

  const blocksToRender = isStreaming ? richBlocks : historicalBlocks
  const hasContent = blocksToRender.length > 0

  return (
    <div className="flex flex-col h-full bg-base overflow-y-auto">
      {hasContent ? (
        <div className="px-5 py-4 space-y-4">
          {blocksToRender.map((block, i) => (
            <SafeRender key={i}>
              <div
                className="animate-[fadeIn_150ms_ease-out]"
                style={{ animationFillMode: 'both', animationDelay: `${i * 50}ms` }}
              >
                <BlockRenderer block={block} />
              </div>
            </SafeRender>
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}
```

---

## 6. 布局组件（完整代码）

### 6.1 `src/components/layout/Sidebar.tsx`

```tsx
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSessionStore } from '@/stores/session.store'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

export function Sidebar() {
  const sessionOrder = useSessionStore(s => s.sessionOrder)
  const sessionsById = useSessionStore(s => s.sessionsById)
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const createSession = useSessionStore(s => s.createSession)
  const selectSession = useSessionStore(s => s.selectSession)

  return (
    <div className="flex flex-col h-full w-[240px] bg-subtle border-r border-border-muted">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted">
        <span className="text-sm font-semibold text-fg-default">会话</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => createSession()}
          className="h-7 w-7 p-0 text-fg-muted hover:text-fg-default"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-0.5">
          {sessionOrder.map(id => {
            const session = sessionsById[id]
            if (!session) return null
            const isActive = id === currentSessionId
            return (
              <button
                key={id}
                onClick={() => selectSession(id)}
                className={`
                  w-full text-left px-3 py-2 rounded-[6px] transition-colors duration-[120ms]
                  ${isActive ? 'bg-accent-subtle text-fg-default' : 'text-fg-muted hover:bg-muted'}
                `}
              >
                <div className="text-sm truncate">{session.title}</div>
                <div className="text-[11px] text-fg-subtle mt-0.5">
                  {dayjs(session.createdAt).fromNow()}
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
```

### 6.2 `src/components/layout/DevToolbar.tsx`

```tsx
import { useConfigStore } from '@/stores/config.store'
import { useChat } from '@/hooks/useChat'

const QUICK_SCENARIOS = [
  { label: 'S01 ROE', prompt: '帮我画一下茅台ROE趋势' },
  { label: 'S02 因子', prompt: '我的动量因子IC很低' },
  { label: 'S03 换手', prompt: '帮我封装换手率查询' },
  { label: 'S04 压测', prompt: '用2015股灾数据跑回撤' },
  { label: 'S05 对比', prompt: '对比宁德比亚迪亿纬' },
]

export function DevToolbar() {
  const useMock = useConfigStore(s => s.useMock)
  const setUseMock = useConfigStore(s => s.setUseMock)
  const { sendMessage } = useChat()

  if (import.meta.env.PROD) return null

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-warning/10 border-t border-warning/20 text-xs">
      <span className="text-warning font-medium">DEV</span>
      <label className="flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          checked={useMock}
          onChange={e => setUseMock(e.target.checked)}
          className="w-3 h-3"
        />
        <span className="text-fg-muted">Mock</span>
      </label>
      <span className="text-fg-subtle">|</span>
      {QUICK_SCENARIOS.map(s => (
        <button
          key={s.label}
          onClick={() => sendMessage(s.prompt)}
          className="px-1.5 py-0.5 rounded text-fg-muted hover:text-fg-default hover:bg-muted transition-colors duration-[120ms]"
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
```

### 6.3 `src/components/layout/AppShell.tsx`

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Sidebar } from './Sidebar'
import { DevToolbar } from './DevToolbar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { OutputPanel } from '@/components/output/OutputPanel'

export function AppShell() {
  return (
    <div className="flex flex-col h-screen bg-base text-fg-default">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel defaultSize={42} minSize={25}>
            <ChatPanel />
          </Panel>
          <PanelResizeHandle className="w-px bg-border-muted hover:w-[3px] hover:bg-accent transition-all duration-[120ms] cursor-col-resize" />
          <Panel defaultSize={58} minSize={25}>
            <OutputPanel />
          </Panel>
        </PanelGroup>
      </div>
      <DevToolbar />
    </div>
  )
}
```

---

## 7. 页面和入口（完整代码）

### 7.1 `src/pages/ChatPage.tsx`

```tsx
import { useEffect } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { useSessionStore } from '@/stores/session.store'

export function ChatPage() {
  const sessionOrder = useSessionStore(s => s.sessionOrder)
  const createSession = useSessionStore(s => s.createSession)

  useEffect(() => {
    if (sessionOrder.length === 0) {
      createSession()
    }
  }, [sessionOrder.length, createSession])

  return <AppShell />
}
```

### 7.2 `src/App.tsx`（替换 M0-1 的占位版本）

```tsx
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { tinykeys } from 'tinykeys'
import { ChatPage } from '@/pages/ChatPage'
import { useSessionStore } from '@/stores/session.store'
import { useChat } from '@/hooks/useChat'

export default function App() {
  const createSession = useSessionStore(s => s.createSession)
  const { stopStreaming, isStreaming } = useChat()

  useEffect(() => {
    const unsubscribe = tinykeys(window, {
      'Escape': () => {
        if (isStreaming) stopStreaming()
      },
      '$mod+KeyN': (e) => {
        e.preventDefault()
        createSession()
      },
    })
    return () => unsubscribe()
  }, [isStreaming, stopStreaming, createSession])

  return (
    <>
      <ChatPage />
      <Toaster position="top-right" />
    </>
  )
}
```

### 7.3 更新 `src/main.tsx`

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

---

## 8. CSS 动画定义

在 `src/index.css` 的末尾追加以下 keyframes（M0-1 已有的 CSS 变量保持不变）：

```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## 9. 键盘快捷键

使用 `tinykeys` 库，在 `App.tsx` 中注册（见第 7.2 节代码）。

| 快捷键 | 行为 | 实现位置 |
|---|---|---|
| `Enter` | 发送消息 | `InputBar.tsx` 的 `onKeyDown` |
| `Shift+Enter` | 换行 | `InputBar.tsx`（默认 textarea 行为） |
| `Escape` | 中止流式输出 | `App.tsx` 全局绑定 |
| `Ctrl+N` / `Cmd+N` | 新建会话 | `App.tsx` 全局绑定 |

---

## 10. 文件创建顺序

严格按以下顺序创建文件。每个文件只能 import 序号更小的文件或 M0-1 已有文件。

| # | 文件路径 | 依赖 |
|---|---|---|
| 01 | `src/hooks/useOnlineStatus.ts` | 无项目依赖 |
| 02 | `src/hooks/useEntityParser.ts` | `companies.ts`, `dayjs` |
| 03 | `src/hooks/useChat.ts` | `session.store`, `registry`, `tool_definitions` |
| 04 | `src/hooks/useStream.ts` | `session.store`, `types` |
| 05 | `src/hooks/useExecutor.ts` | `session.store`, `registry`, `types` |
| 06 | `src/components/ui/button.tsx` | `clsx`, `tailwind-merge` |
| 07 | `src/components/ui/scroll-area.tsx` | `clsx` |
| 08 | `src/components/output/SafeRender.tsx` | React |
| 09 | `src/components/output/SourceTag.tsx` | 无 |
| 10 | `src/components/output/Disclaimer.tsx` | `disclaimer.ts` |
| 11 | `src/components/output/ChartRenderer.tsx` | `plotly.js-dist-min`, `react-plotly.js` |
| 12 | `src/components/output/CodeBlock.tsx` | `shiki`, `useExecutor`, `ChartRenderer` |
| 13 | `src/components/output/DataTable.tsx` | `@tanstack/react-table`, `papaparse` |
| 14 | `src/components/output/OutputPanel.tsx` | `useStream`, `SafeRender`, `CodeBlock`, `ChartRenderer`, `DataTable`, `Disclaimer` |
| 15 | `src/components/chat/ToolCallBadge.tsx` | `lucide-react` |
| 16 | `src/components/chat/MessageBubble.tsx` | `react-markdown`, `ToolCallBadge`, `types` |
| 17 | `src/components/chat/InputBar.tsx` | `useChat`, `useOnlineStatus`, `Button` |
| 18 | `src/components/chat/MessageList.tsx` | `@tanstack/react-virtual`, `MessageBubble`, `ToolCallBadge`, `useStream`, `react-markdown` |
| 19 | `src/components/chat/ChatPanel.tsx` | `MessageList`, `InputBar`, `useChat`, `session.store` |
| 20 | `src/components/layout/Sidebar.tsx` | `session.store`, `dayjs`, `Button`, `ScrollArea` |
| 21 | `src/components/layout/DevToolbar.tsx` | `config.store`, `useChat` |
| 22 | `src/components/layout/AppShell.tsx` | `react-resizable-panels`, `Sidebar`, `DevToolbar`, `ChatPanel`, `OutputPanel` |
| 23 | `src/pages/ChatPage.tsx` | `AppShell`, `session.store` |
| 24 | `src/App.tsx` | `ChatPage`, `tinykeys`, `sonner`, `useChat`, `session.store` |
| 25 | `src/main.tsx` | `App`, `index.css` |
| 26 | `src/index.css`（追加 keyframes） | 无 |

---

## 11. 集成陷阱

### 陷阱 1：Plotly.js 的 factory import 模式

```typescript
// 错误：导入完整包（8MB，首屏 10 秒）
import Plotly from 'plotly.js'

// 正确：导入最小化包 + factory
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'
const Plot = createPlotlyComponent(Plotly)
```

### 陷阱 2：Shiki 异步初始化

```typescript
// 错误：同步使用 shiki
const html = codeToHtml(code, { lang: 'python' })

// 正确：在 useEffect 中异步调用，结果存 state
useEffect(() => {
  codeToHtml(code, { lang: language, theme: 'github-light' }).then(setHtml)
}, [code, language])
```

### 陷阱 3：react-resizable-panels 用法

```typescript
// 错误：用 CSS flexbox 手动实现拖拽
// 正确：
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
// PanelResizeHandle 必须放在两个 Panel 之间，否则无法拖拽
```

### 陷阱 4：TanStack Table + 排序

```typescript
// 必须同时配置 getCoreRowModel() 和 getSortedRowModel()
// 排序状态必须外部管理：const [sorting, setSorting] = useState<SortingState>([])
// 通过 onSortingChange: setSorting 传入
```

### 陷阱 5：sonner Toaster 放置位置

```typescript
// 错误：在子组件中放 Toaster（多个实例会重复渲染）
// 正确：在 App.tsx 根级别放置唯一 <Toaster />
// 所有子组件直接调用 toast('message') 即可
```

### 陷阱 6：virtual scroll 的 estimateSize

```typescript
// estimateSize 设置过小会导致滚动跳跃
// 消息气泡高度差异大，用 120 作为合理估计值
// 必须传入 measureElement ref 让 virtualizer 动态测量
```

### 陷阱 7：数字格式化规则（对齐 M07 spec）

```
字段名包含 margin/rate/ratio/yoy/roe/roa → 百分比（×100，1位小数）
字段名包含 revenue/profit/amount → 亿元（÷1e8，2位小数）
字段名包含 pe/pb/ev → 倍数（1位小数 + 'x'）
其他数字 → 保留 2 位小数
```

### 陷阱 8：Zustand selector 避免不必要重渲

```typescript
// 错误：取整个 store 对象
const store = useSessionStore()

// 正确：精确 selector
const isStreaming = useSessionStore(s => s.isStreaming)
const currentSessionId = useSessionStore(s => s.currentSessionId)
```

### 陷阱 9：流式 text_delta 追加导致全量重渲

```
appendStreamEvent 中，text_delta 应合并到最后一个 text block
而非每次创建新 block。见 session.store.ts 中 appendStreamEvent 的实现。
MessageList 应使用 useStream() hook 的 currentText 而非直接读 streamingBlocks。
```

### 陷阱 10：dayjs 插件必须在模块顶层注册

```typescript
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
dayjs.extend(relativeTime)
dayjs.locale('zh-cn')
// 必须在 import Sidebar 之前执行，否则 fromNow() 返回英文
```

---

## 12. 验证检查点

### 检查点 1：useChat 能发送消息并消费 Mock 流

1. 在浏览器控制台执行：

```javascript
const store = window.__aimecode_sessions ?? (await import('@/stores/session.store')).useSessionStore
```

2. 在 InputBar 输入"帮我画一下茅台ROE趋势"，按 Enter
2. 观察：`isStreaming` 变为 true → streamingBlocks 逐步填充 → 最终 `isStreaming` 变回 false

### 检查点 2：单个组件能独立渲染

1. 在 React DevTools 中找到 `CodeBlock` 组件
2. 确认 Shiki 语法高亮渲染成功（非纯文本）
3. 点击"复制"按钮，确认剪贴板内容正确
4. 点击"运行"按钮（Python 代码），确认 loading → done 状态转换

### 检查点 3：双栏布局 + 拖拽工作

1. 页面加载后，左右栏以约 5:7 比例显示
2. 拖动分隔线，两栏宽度实时变化
3. 拖到极限位置（各 300px 左右），不会出现溢出或崩溃
4. Plotly 图表在拖拽后自适应新宽度

### 检查点 4：S01 完整场景走通

1. 输入"帮我画一下茅台ROE趋势"
2. 左栏：thinking 文字 → ToolCallBadge(pending→done) → 逐字文字 → 代码提示
3. 右栏：图表渲染 → 代码块渲染 → 免责声明
4. 点击停止 → 已生成内容保留
5. 刷新页面 → 会话恢复，消息历史完整

### 检查点 5：S01-S05 全部走通

依次输入以下内容，每个场景正确触发对应预制流：

| 场景 | 输入 | 右栏预期 |
|---|---|---|
| S01 | 帮我画一下茅台ROE趋势 | 图表 + 代码块 + 免责声明 |
| S02 | 我的动量因子IC很低 | 代码块（无图表、无免责声明） |
| S03 | 帮我封装换手率查询 | 数据表格 + 代码块 + 免责声明 |
| S04 | 用2015股灾数据跑回撤 | 图表 + 代码块 + 免责声明 |
| S05 | 对比宁德比亚迪亿纬 | 数据表格 + 免责声明 |

---

## 13. Demo 完整性必备功能

本章将 M0-2 从"Mock 链路功能可用"升级为**可演示的产品级 Demo**，补全主题切换、设置弹窗、会话管理（重命名 + 删除）、错误提示、产物摘要等六项核心交互。

所有改动均为自包含代码，无新增第三方依赖。新文件 7 个，修改文件 5 个，M0-1 最小扩展 2 个。

---

### 13.0 M0-1 最小扩展（先于本章其余内容执行）

#### 13.0.1 `src/stores/config.store.ts`（追加 2 个 setter）

在已有的 `ConfigState` interface 中追加，在 `create()` 的实现中追加对应方法（`setApiKey` 之后）：

```typescript
// 追加到 interface ConfigState：
setTushareToken: (token: string) => void
setSandboxUrl: (url: string) => void

// 追加到 create() 实现（setApiKey 之后）：
setTushareToken: (token) => set({ tushareToken: token }),
setSandboxUrl: (url) => set({ sandboxUrl: url }),
```

完整替换后的文件：

```typescript
// src/stores/config.store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { resetServiceCache } from '../services/registry'

interface ConfigState {
  useMock: boolean
  anthropicApiKey: string
  tushareToken: string
  sandboxUrl: string

  setUseMock: (v: boolean) => void
  setApiKey: (key: string) => void
  setTushareToken: (token: string) => void
  setSandboxUrl: (url: string) => void
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      useMock: true,
      anthropicApiKey: '',
      tushareToken: '',
      sandboxUrl: 'http://localhost:8001',

      setUseMock: (v) => {
        set({ useMock: v })
        resetServiceCache()
      },
      setApiKey: (key) => {
        set({ anthropicApiKey: key })
        resetServiceCache()
      },
      setTushareToken: (token) => set({ tushareToken: token }),
      setSandboxUrl: (url) => set({ sandboxUrl: url }),
    }),
    { name: 'aimecode-config' }
  )
)
```

#### 13.0.2 `src/stores/session.store.ts`（追加 deleteSession + renameSession）

在已有的 `SessionState` interface 中追加，在 `create()` 的实现中追加对应方法：

```typescript
// 追加到 interface SessionState：
deleteSession: (id: string) => void
renameSession: (id: string, title: string) => void

// 追加到 create() 实现（clearStreamingBlocks 之后）：
deleteSession: (id) => set(state => {
  const newById = { ...state.sessionsById }
  delete newById[id]
  const newOrder = state.sessionOrder.filter(s => s !== id)
  const newCurrentId = id === state.currentSessionId
    ? (newOrder[0] ?? null)
    : state.currentSessionId
  return { sessionsById: newById, sessionOrder: newOrder, currentSessionId: newCurrentId }
}),

renameSession: (id, title) => set(state => {
  const session = state.sessionsById[id]
  if (!session) return {}
  return {
    sessionsById: {
      ...state.sessionsById,
      [id]: { ...session, title },
    },
  }
}),
```

---

### 13.1 主题 Store（新建 `src/stores/theme.store.ts`）

```typescript
// src/stores/theme.store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',

      setTheme: (t) => {
        applyTheme(t)
        set({ theme: t })
      },

      toggleTheme: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        set({ theme: next })
      },
    }),
    {
      name: 'aimecode-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    }
  )
)
```

**注意**：M0-1 `tailwind.config.ts` 已包含 `darkMode: ['class', '[data-theme="dark"]']`，`applyTheme` 通过 `classList.toggle('dark', ...)` 即可触发 Tailwind 暗色模式，无需额外配置。

---

### 13.2 通用 Modal 组件（新建 `src/components/ui/modal.tsx`）

```tsx
// src/components/ui/modal.tsx
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        className={clsx(
          'relative bg-base rounded-[8px] border border-border-muted shadow-2xl',
          'w-full max-w-md mx-4 p-6 animate-[fadeIn_0.15s_ease-out]',
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-fg-default">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-[6px] text-fg-muted hover:text-fg-default hover:bg-muted transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
```

---

### 13.3 应用头部（新建 `src/components/layout/AppHeader.tsx`）

```tsx
// src/components/layout/AppHeader.tsx
import { Moon, Sun, Settings, Bot } from 'lucide-react'
import { useThemeStore } from '@/stores/theme.store'
import { useConfigStore } from '@/stores/config.store'
import { useSessionStore } from '@/stores/session.store'

interface AppHeaderProps {
  onSettingsClick: () => void
}

export function AppHeader({ onSettingsClick }: AppHeaderProps) {
  const { theme, toggleTheme } = useThemeStore()
  const useMock = useConfigStore(s => s.useMock)
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const session = useSessionStore(s =>
    currentSessionId ? s.sessionsById[currentSessionId] : null
  )

  return (
    <header className="flex items-center justify-between h-11 px-4 border-b border-border-muted bg-subtle shrink-0">
      {/* 左侧：Logo + 会话标题 + 模式标签 */}
      <div className="flex items-center gap-3 min-w-0">
        <Bot className="w-5 h-5 text-accent shrink-0" />
        <span className="text-sm font-semibold text-fg-default truncate max-w-[280px]">
          {session?.title ?? 'AimeCode'}
        </span>
        <span
          className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-tight ${
            useMock
              ? 'bg-warning/15 text-warning'
              : 'bg-success/15 text-success'
          }`}
        >
          {useMock ? 'Mock' : 'Real'}
        </span>
      </div>

      {/* 右侧：主题切换 + 设置 */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-[6px] text-fg-muted hover:text-fg-default hover:bg-muted transition-colors"
          title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
        >
          {theme === 'dark'
            ? <Sun className="w-4 h-4" />
            : <Moon className="w-4 h-4" />
          }
        </button>
        <button
          onClick={onSettingsClick}
          className="p-1.5 rounded-[6px] text-fg-muted hover:text-fg-default hover:bg-muted transition-colors"
          title="设置"
          aria-label="设置"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
```

---

### 13.4 设置弹窗（新建 `src/components/layout/SettingsModal.tsx`）

```tsx
// src/components/layout/SettingsModal.tsx
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/stores/config.store'

// 带眼睛图标的密码输入框
interface MaskedInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

function MaskedInput({ label, value, onChange, placeholder }: MaskedInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-fg-muted">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 text-sm px-3 py-2 rounded-[6px] bg-muted border border-border-muted text-fg-default placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="p-2 text-fg-muted hover:text-fg-default transition-colors shrink-0"
          aria-label={visible ? '隐藏' : '显示'}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

// CSS-only toggle switch
interface ToggleSwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  labelOn: string
  labelOff: string
}

function ToggleSwitch({ checked, onChange, labelOn, labelOff }: ToggleSwitchProps) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? 'bg-warning' : 'bg-success'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-1' : 'translate-x-[18px]'
          }`}
        />
      </button>
      <span className="text-xs text-fg-muted">{checked ? labelOn : labelOff}</span>
    </div>
  )
}

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const store = useConfigStore()

  // 本地 draft state，不立即写入 store，只在"保存"时一次性提交
  const [apiKey, setApiKey] = useState(store.anthropicApiKey)
  const [tsToken, setTsToken] = useState(store.tushareToken)
  const [sbUrl, setSbUrl] = useState(store.sandboxUrl)
  const [useMock, setUseMock] = useState(store.useMock)

  // 每次弹窗打开时同步最新值
  const [prevOpen, setPrevOpen] = useState(false)
  if (open && !prevOpen) {
    setApiKey(store.anthropicApiKey)
    setTsToken(store.tushareToken)
    setSbUrl(store.sandboxUrl)
    setUseMock(store.useMock)
    setPrevOpen(true)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  const handleSave = () => {
    store.setApiKey(apiKey.trim())
    store.setTushareToken(tsToken.trim())
    store.setSandboxUrl(sbUrl.trim() || 'http://localhost:8001')
    store.setUseMock(useMock)
    toast.success('设置已保存')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="设置">
      <div className="space-y-4">
        <MaskedInput
          label="Anthropic API Key"
          value={apiKey}
          onChange={setApiKey}
          placeholder="sk-ant-api03-..."
        />
        <MaskedInput
          label="Tushare Token"
          value={tsToken}
          onChange={setTsToken}
          placeholder="your-tushare-token"
        />
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-fg-muted">
            Sandbox URL
          </label>
          <input
            type="url"
            value={sbUrl}
            onChange={e => setSbUrl(e.target.value)}
            placeholder="http://localhost:8001"
            className="w-full text-sm px-3 py-2 rounded-[6px] bg-muted border border-border-muted text-fg-default placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border-muted">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">数据服务</span>
            <ToggleSwitch
              checked={useMock}
              onChange={setUseMock}
              labelOn="Mock 模式"
              labelOff="Real 模式"
            />
          </div>
          <Button onClick={handleSave} size="sm">
            保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

---

### 13.5 错误提示组件（新建 `src/components/chat/ErrorMessage.tsx`）

```tsx
// src/components/chat/ErrorMessage.tsx
import { AlertCircle } from 'lucide-react'

interface ErrorMessageProps {
  message: string
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-[6px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4 animate-[fadeIn_0.2s_ease-out]">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="leading-[22px]">{message}</span>
    </div>
  )
}
```

**CSS 变量依赖**：`--color-destructive` 需在 `src/index.css` 中定义（见 §13.10）。

---

### 13.6 更新：`src/hooks/useChat.ts`（追加错误 toast + 保留原有逻辑）

在原文件基础上追加 `import { toast } from 'sonner'`，并将 error 事件处理从静默改为 toast 提示：

```typescript
// src/hooks/useChat.ts
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useSessionStore } from '@/stores/session.store'
import { getLLMService } from '@/services/registry'
import { TOOL_DEFINITIONS } from '@/services/tool_definitions'
import type { Message } from '@/services/types'

const MAX_CONTEXT_TURNS = 20

function buildContextMessages(allMessages: Message[]): Message[] {
  const sliced = allMessages.slice(-MAX_CONTEXT_TURNS * 2)
  const firstUserIdx = sliced.findIndex(m => m.role === 'user')
  return firstUserIdx > 0 ? sliced.slice(firstUserIdx) : sliced
}

export function useChat() {
  const isStreaming = useSessionStore(s => s.isStreaming)
  const currentSessionId = useSessionStore(s => s.currentSessionId)

  const sendMessage = useCallback(async (content: string) => {
    const store = useSessionStore.getState()
    if (store.isStreaming) return
    if (!content.trim()) return

    let sessionId = store.currentSessionId
    if (!sessionId) {
      sessionId = store.createSession()
    }

    store.addUserMessage(content)
    store.setStreaming(true)
    store.clearStreamingBlocks()

    const session = useSessionStore.getState().sessionsById[sessionId]
    if (!session) return

    const contextMessages = buildContextMessages(session.messages)
    const llm = getLLMService()

    try {
      const stream = llm.chat(contextMessages, { tools: TOOL_DEFINITIONS })
      for await (const event of stream) {
        if (!useSessionStore.getState().isStreaming) break

        store.appendStreamEvent(event)

        if (event.type === 'done') {
          store.finalizeAssistantMessage(event.messageId)
          return
        }
        if (event.type === 'error') {
          toast.error(event.message ?? '发生未知错误，请重试')
          store.setStreaming(false)
          return
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`请求失败：${msg}`)
      store.setStreaming(false)
    }
  }, [])

  const stopStreaming = useCallback(() => {
    const store = useSessionStore.getState()
    if (!store.isStreaming) return

    const llm = getLLMService()
    llm.abort()
    store.setStreaming(false)
    store.clearStreamingBlocks()
  }, [])

  return { sendMessage, stopStreaming, isStreaming, currentSessionId }
}
```

---

### 13.7 更新：`src/components/chat/MessageBubble.tsx`（追加产物指示器 + 沿用原有逻辑）

在 assistant 消息的 `toolCalls` 徽章之后，追加产物指示器 pill，让用户在聊天区快速知晓右栏有哪些内容：

```tsx
// src/components/chat/MessageBubble.tsx
import ReactMarkdown from 'react-markdown'
import { ToolCallBadge } from './ToolCallBadge'
import type { Message } from '@/services/types'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] rounded-[6px] bg-muted px-3.5 py-2.5 text-sm leading-[22px] text-fg-default">
          {message.content}
        </div>
      </div>
    )
  }

  // 计算产物类型（用于快速预览指示器）
  const hasChart = message.contentBlocks?.some(b => b.type === 'chart') ?? false
  const hasCode = message.contentBlocks?.some(b => b.type === 'code') ?? false
  const hasTable = message.contentBlocks?.some(b => b.type === 'table') ?? false
  const hasArtifacts = hasChart || hasCode || hasTable

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-full text-sm leading-[22px] text-fg-default space-y-2">
        {/* 思考过程（历史消息恢复） */}
        {message.thinkingText && (
          <div className="text-xs text-fg-subtle italic border-l-2 border-border-muted pl-2">
            {message.thinkingText}
          </div>
        )}
        {/* 工具调用徽章（历史消息恢复） */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.toolCalls.map((tc, i) => (
              <ToolCallBadge
                key={i}
                tool={tc.tool}
                source={tc.source}
                status={tc.status}
                params={tc.params}
                summary={tc.summary}
                errorMessage={tc.errorMessage}
              />
            ))}
          </div>
        )}
        {/* 产物类型指示器（快速预览右栏内容） */}
        {hasArtifacts && (
          <div className="flex gap-1.5 flex-wrap">
            {hasChart && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-fg-muted leading-5">
                📊 图表
              </span>
            )}
            {hasCode && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-fg-muted leading-5">
                💻 代码
              </span>
            )}
            {hasTable && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-fg-muted leading-5">
                📋 数据表
              </span>
            )}
          </div>
        )}
        {/* 文字内容 */}
        {message.contentBlocks ? (
          <div className="space-y-2">
            {message.contentBlocks
              .filter(b => b.type === 'text')
              .map((block, i) => (
                <div key={i} className="prose prose-sm max-w-none">
                  <ReactMarkdown>{(block as { type: 'text'; content: string }).content}</ReactMarkdown>
                </div>
              ))}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-fg-default ml-0.5 animate-[blink_1s_step-end_infinite]" />
        )}
      </div>
    </div>
  )
}
```

---

### 13.8 更新：`src/components/layout/Sidebar.tsx`（内联重命名 + 删除确认）

```tsx
// src/components/layout/Sidebar.tsx
import { useState, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSessionStore } from '@/stores/session.store'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

export function Sidebar() {
  const sessionOrder = useSessionStore(s => s.sessionOrder)
  const sessionsById = useSessionStore(s => s.sessionsById)
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const createSession = useSessionStore(s => s.createSession)
  const selectSession = useSessionStore(s => s.selectSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const renameSession = useSessionStore(s => s.renameSession)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id)
    setRenameValue(currentTitle)
    setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (window.confirm('确认删除此会话？删除后不可恢复。')) {
      deleteSession(id)
    }
  }

  return (
    <div className="flex flex-col h-full w-[240px] bg-subtle border-r border-border-muted">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted">
        <span className="text-sm font-semibold text-fg-default">会话</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => createSession()}
          className="h-7 w-7 p-0 text-fg-muted hover:text-fg-default"
          title="新建会话"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-0.5">
          {sessionOrder.map(id => {
            const session = sessionsById[id]
            if (!session) return null
            const isActive = id === currentSessionId

            return (
              <div
                key={id}
                className={`
                  group relative flex items-center w-full rounded-[6px] transition-colors duration-[120ms]
                  ${isActive ? 'bg-accent-subtle' : 'hover:bg-muted'}
                `}
              >
                {renamingId === id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="flex-1 mx-2 my-1.5 text-sm bg-transparent text-fg-default outline-none border-b border-accent"
                  />
                ) : (
                  <button
                    className="flex-1 text-left px-3 py-2 min-w-0"
                    onClick={() => selectSession(id)}
                    onDoubleClick={() => startRename(id, session.title)}
                    title="单击选择，双击重命名"
                  >
                    <div className={`text-sm truncate ${isActive ? 'text-fg-default' : 'text-fg-muted'}`}>
                      {session.title}
                    </div>
                    <div className="text-[11px] text-fg-subtle mt-0.5">
                      {dayjs(session.createdAt).fromNow()}
                    </div>
                  </button>
                )}
                <button
                  className="shrink-0 mr-1 p-1 rounded-[4px] opacity-0 group-hover:opacity-100 text-fg-muted hover:text-destructive hover:bg-destructive/10 transition-all duration-[100ms]"
                  onClick={(e) => handleDelete(e, id)}
                  title="删除会话"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
```

---

### 13.9 更新：`src/components/layout/AppShell.tsx`（加入 AppHeader + SettingsModal）

```tsx
// src/components/layout/AppShell.tsx
import { useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Sidebar } from './Sidebar'
import { DevToolbar } from './DevToolbar'
import { AppHeader } from './AppHeader'
import { SettingsModal } from './SettingsModal'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { OutputPanel } from '@/components/output/OutputPanel'

export function AppShell() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex flex-col h-screen bg-base text-fg-default">
      <AppHeader onSettingsClick={() => setSettingsOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel defaultSize={42} minSize={25}>
            <ChatPanel />
          </Panel>
          <PanelResizeHandle className="w-px bg-border-muted hover:w-[3px] hover:bg-accent transition-all duration-[120ms] cursor-col-resize" />
          <Panel defaultSize={58} minSize={25}>
            <OutputPanel />
          </Panel>
        </PanelGroup>
      </div>
      <DevToolbar />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
```

---

### 13.10 更新：`src/index.css`（追加 destructive 变量 + 主题过渡动画）

在已有 `@keyframes blink` 和 `@keyframes fadeIn` 之后追加：

```css
/* ── destructive 颜色变量（亮色 / 暗色） ─────────────────────── */
:root {
  --color-destructive: #DC2626;
}
.dark {
  --color-destructive: #F87171;
}

/* ── 主题切换平滑过渡 ─────────────────────────────────────────── */
*, *::before, *::after {
  transition-property: background-color, border-color, color;
  transition-duration: 150ms;
  transition-timing-function: ease;
}
/* 排除动画相关属性，防止与原有动画冲突 */
.animate-\[blink_1s_step-end_infinite\],
.animate-\[fadeIn_0\.15s_ease-out\],
.animate-\[fadeIn_0\.2s_ease-out\] {
  transition: none;
}
```

同时在 `tailwind.config.ts` 的 `theme.extend.colors` 中追加 `destructive`：

```typescript
// tailwind.config.ts 追加
destructive: 'var(--color-destructive)',
```

---

### 13.11 新增文件创建顺序（在原表第 22 行之前插入）

| # | 文件路径 | 依赖 | 说明 |
|---|---|---|---|
| 01.5 | `src/stores/theme.store.ts` | `zustand` | 主题 Store（在 session.store 之后创建） |
| 08.5 | `src/components/ui/modal.tsx` | `lucide-react`, `clsx` | 通用弹窗（在 scroll-area 之后创建） |
| 15.5 | `src/components/chat/ErrorMessage.tsx` | `lucide-react` | 错误提示（在 ToolCallBadge 之后创建） |
| 21.5 | `src/components/layout/AppHeader.tsx` | `theme.store`, `config.store`, `session.store`, `lucide-react` | 应用头部（在 DevToolbar 之后创建） |
| 21.6 | `src/components/layout/SettingsModal.tsx` | `Modal`, `Button`, `config.store`, `sonner` | 设置弹窗（在 AppHeader 之后创建） |

修改文件（替换已有实现）：`useChat.ts`（#03）、`MessageBubble.tsx`（#16）、`Sidebar.tsx`（#20）、`AppShell.tsx`（#22）

---

### 13.12 验证检查点（新增，对应 V11-V14）

**检查点 6：主题切换（V11）**

1. 默认加载为暗色模式
2. 点击 AppHeader 右侧的 `<Sun>` 图标，页面即时切换为浅色
3. 刷新页面，仍保持浅色模式（persist 生效）
4. 再次点击切回暗色

**检查点 7：设置弹窗（V12）**

1. 点击 `<Settings>` 图标，弹出 Modal
2. 输入 API Key（masked），点击眼睛图标可直接切换明文/密文
3. 修改 Mock/Real 开关
4. 点击"保存"，弹出 "设置已保存" toast，弹窗关闭
5. 重新打开弹窗，输入框显示刚才保存的值
6. 按 `Escape` 关闭弹窗，修改未保存

**检查点 8：会话管理（V13）**

1. 创建多个会话
2. 双击侧边栏中某会话，标题变为内联输入框
3. 输入新名称，按 Enter，标题更新
4. Hover 某会话，出现红色垃圾桶图标
5. 点击垃圾桶，出现浏览器 confirm，确认后会话消失，自动切换至相邻会话

**检查点 9：错误消息渲染（V14）**

```javascript
// 浏览器控制台手动触发
const store = window.__aimecode_sessions.getState()
const id = store.currentSessionId || store.createSession()
store.appendStreamEvent({ type: 'error', message: '测试错误消息' })
```

执行后聊天区出现带红色警告图标的错误提示，页面不崩溃，InputBar 可继续使用。
