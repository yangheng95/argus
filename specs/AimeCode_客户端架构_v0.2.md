# MirrorCode 客户端架构设计 v0.2

**架构方向**：纯客户端 SPA，服务层 Mock 优先，真实接口后续替换
**运行前提**：无需后端，`npm install && npm run dev` 即可启动
**对应 PRD**：MirrorCode 骨架 PRD v0.1

---

## 目录

1. 技术栈
2. 目录结构（文件级）
3. 服务层设计（Interface + Mock + Real）
4. 状态管理设计
5. Mock 数据与场景设计
6. 关键组件说明
7. Mock → Real 切换机制
8. 启动与开发指南

---

## 一、技术栈

| 类别 | 选型 | 理由 |
|---|---|---|
| 构建工具 | Vite 5 | 秒级热更新，零配置启动 |
| 框架 | React 18 | 生态完善，hooks 体系成熟 |
| 语言 | TypeScript 5 | 接口定义是 Mock 机制的基石 |
| 样式 | Tailwind CSS 3 | 快速布局，无额外打包体积 |
| 组件库 | shadcn/ui | 复制粘贴式组件，完全可控 |
| 代码编辑器 | Monaco Editor | 与 VSCode 同源，免费商用 |
| 图表 | Plotly.js | 金融图表（K线/折线）首选 |
| 状态管理 | Zustand 4 | 轻量，无 boilerplate |
| 数据请求 | 无（服务层直接调用）| Mock 阶段不需要 HTTP 客户端 |
| 流式消费 | 原生 AsyncGenerator | Mock 和真实实现共用同一接口 |

---

## 二、目录结构

```
mirrorcode/
│
├── index.html
├── vite.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
│
└── src/
    ├── main.tsx                    # 入口，挂载 React
    ├── App.tsx                     # 根组件，路由配置
    │
    ├── pages/
    │   ├── ChatPage.tsx            # 主页：双栏布局（对话 + 输出）
    │   └── LoginPage.tsx           # 登录页（Mock 直接放行）
    │
    ├── components/
    │   ├── chat/
    │   │   ├── ChatPanel.tsx       # 左栏：对话区域容器
    │   │   ├── MessageList.tsx     # 消息列表（虚拟滚动）
    │   │   ├── MessageBubble.tsx   # 单条消息（用户/助手）
    │   │   ├── InputBar.tsx        # 底部输入框 + 发送 + 停止
    │   │   └── ToolCallBadge.tsx   # 工具调用进行中的指示器
    │   │
    │   ├── output/
    │   │   ├── OutputPanel.tsx     # 右栏：输出区域容器
    │   │   ├── CodeBlock.tsx       # Monaco 代码块 + 一键复制 + 运行按钮
    │   │   ├── ChartRenderer.tsx   # Plotly 图表容器
    │   │   ├── DataTable.tsx       # 可排序数据表格
    │   │   ├── SourceTag.tsx       # 数据来源标签（"来源：tushare · 2024Q3"）
    │   │   └── Disclaimer.tsx      # 免责声明组件
    │   │
    │   └── layout/
    │       ├── AppShell.tsx        # 整体三栏布局框架
    │       ├── Sidebar.tsx         # 会话历史侧边栏
    │       └── DevToolbar.tsx      # 开发工具栏（Mock/Real 切换开关）
    │
    ├── services/                   # ★ 服务层：接口优先设计
    │   │
    │   ├── types.ts                # 全局共享类型定义
    │   │
    │   ├── llm/
    │   │   ├── interface.ts        # ILLMService 接口定义
    │   │   ├── mock.ts             # MockLLMService（流式模拟）
    │   │   └── anthropic.ts        # AnthropicLLMService（stub，待实现）
    │   │
    │   ├── finance/
    │   │   ├── interface.ts        # IFinanceService 接口定义
    │   │   ├── mock.ts             # MockFinanceService
    │   │   └── tushare.ts          # TushareService（stub，待实现）
    │   │
    │   ├── executor/
    │   │   ├── interface.ts        # IExecutorService 接口定义
    │   │   ├── mock.ts             # MockExecutorService
    │   │   └── sandbox.ts          # SandboxService（stub，待实现）
    │   │
    │   └── registry.ts             # ★ 服务注册表：根据 config 注入实现
    │
    ├── stores/
    │   ├── session.store.ts        # 会话状态（消息列表、当前流状态）
    │   ├── ui.store.ts             # UI 状态（面板宽度、主题）
    │   ├── config.store.ts         # 配置（useMock、apiKeys）
    │   └── context.store.ts        # 对话上下文（当前标的、时间窗口）
    │
    ├── hooks/
    │   ├── useChat.ts              # 核心 Hook：发送消息、消费流、管理状态
    │   ├── useStream.ts            # 消费 AsyncGenerator，写入 session.store
    │   ├── useServices.ts          # 从 registry 取当前服务实例
    │   └── useEntityParser.ts      # 公司名→股票代码，日期表述→区间
    │
    └── mocks/
        ├── data/
        │   ├── companies.ts        # 公司名→代码映射表（50+ 常用标的）
        │   ├── financial-reports.ts # 茅台、宁德时代等财报 Mock 数据
        │   ├── market-data.ts      # OHLCV Mock 行情数据
        │   └── indicators.ts       # MA/MACD/RSI 预计算结果
        │
        └── scenarios/
            ├── s01-roe-chart.ts    # S01：ROE 趋势图的完整 Mock 响应流
            ├── s02-factor-debug.ts # S02：因子调试的 Mock 响应流
            ├── s03-wrap-query.ts   # S03：封装查询函数的 Mock 响应流
            ├── s04-stress-test.ts  # S04：压力测试的 Mock 响应流
            └── s05-comparison.ts   # S05：多标的对比的 Mock 响应流
```

---

## 三、服务层设计

### 3.1 共享类型（`src/services/types.ts`）

```typescript
// ─── 流式事件（UI 消费的最小单元）────────────────────────────────
export type StreamEventType =
  | 'thinking'       // AI 思考中（显示 loading 动画）
  | 'tool_start'     // 工具调用开始（显示数据源气泡）
  | 'tool_end'       // 工具调用完成
  | 'tool_error'     // 工具调用失败
  | 'text_delta'     // 文本增量（流式拼接）
  | 'code_block'     // 完整代码块（一次性输出）
  | 'chart_data'     // Plotly JSON spec（一次性输出）
  | 'table_data'     // 表格数据（一次性输出）
  | 'disclaimer'     // 合规免责声明
  | 'done'           // 流结束
  | 'error'          // 系统错误

export interface StreamEvent {
  type: StreamEventType
  // thinking
  content?: string
  // tool_start / tool_end
  tool?: string
  source?: string       // 数据源名称，如 'tushare'
  params?: Record<string, unknown>
  // text_delta
  delta?: string
  // code_block
  language?: string
  code?: string
  // chart_data
  chartSpec?: object    // Plotly layout + data JSON
  // table_data
  columns?: string[]
  rows?: unknown[][]
  // done
  messageId?: string
}

// ─── LLM 消息格式 ────────────────────────────────────────────────
export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: MessageRole
  content: string
  contentBlocks?: ContentBlock[]  // 结构化块（代码/图表/表格）
  createdAt: Date
}

export type ContentBlock =
  | { type: 'text';  content: string }
  | { type: 'code';  language: string; code: string }
  | { type: 'chart'; spec: object }
  | { type: 'table'; columns: string[]; rows: unknown[][] }

// ─── 金融数据类型 ──────────────────────────────────────────────
export interface FinancialReport {
  ticker: string
  period: string          // 如 '2024Q3'
  reportDate: string
  fields: Record<string, number | null>  // { roe: 0.29, revenue: 14836000000, ... }
}

export interface OHLCVBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  turnover?: number
}

// ─── 代码执行结果 ──────────────────────────────────────────────
export interface ExecutionResult {
  status: 'ok' | 'error' | 'timeout'
  stdout: string
  stderr: string
  charts: Array<{ id: string; imageDataUrl: string }>
  durationMs: number
}
```

---

### 3.2 LLM 服务接口（`src/services/llm/interface.ts`）

```typescript
import type { Message, StreamEvent } from '../types'

export interface ILLMService {
  /**
   * 发送消息，返回流式事件的 AsyncGenerator。
   * 调用方通过 for await 消费，直到 type === 'done'。
   */
  chat(
    messages: Message[],
    systemPrompt?: string,
  ): AsyncGenerator<StreamEvent, void, unknown>

  /** 中止当前流（用户点击"停止"按钮） */
  abort(): void
}
```

---

### 3.3 Mock LLM 服务（`src/services/llm/mock.ts`）

```typescript
import type { ILLMService } from './interface'
import type { Message, StreamEvent } from '../types'
import { detectScenario } from '../../mocks/scenarios'
import { sleep } from '../../utils/async'

export class MockLLMService implements ILLMService {
  private abortFlag = false

  async *chat(
    messages: Message[],
  ): AsyncGenerator<StreamEvent, void, unknown> {
    this.abortFlag = false
    const lastUserMessage = messages.at(-1)?.content ?? ''

    // 根据最后一条用户消息匹配预制场景
    const scenario = detectScenario(lastUserMessage)

    for (const event of scenario.events) {
      if (this.abortFlag) break

      // 模拟真实延迟：工具调用 500ms，文字增量 30ms，代码块 200ms
      const delay = event.type === 'tool_start'  ? 500
                  : event.type === 'tool_end'    ? 400
                  : event.type === 'text_delta'  ? 30
                  : event.type === 'code_block'  ? 200
                  : event.type === 'chart_data'  ? 300
                  : 100

      await sleep(delay)
      yield event
    }
  }

  abort(): void {
    this.abortFlag = true
  }
}
```

---

### 3.4 金融服务接口（`src/services/finance/interface.ts`）

```typescript
import type { FinancialReport, OHLCVBar } from '../types'

export interface IFinanceService {
  getFinancialReport(params: {
    ticker: string
    startDate: string
    endDate: string
    freq: 'quarterly' | 'annual'
    fields: string[]
  }): Promise<FinancialReport[]>

  getOHLCV(params: {
    ticker: string
    startDate: string
    endDate: string
    freq: 'D' | 'W' | 'M'
  }): Promise<OHLCVBar[]>

  getIndexComponents(params: {
    indexCode: string
    date: string
  }): Promise<Array<{ ticker: string; name: string; weight: number }>>

  /** 将公司名称或简称解析为标准股票代码 */
  resolveTicker(nameOrCode: string): Promise<string | null>
}
```

---

### 3.5 执行服务接口（`src/services/executor/interface.ts`）

```typescript
import type { ExecutionResult } from '../types'

export interface IExecutorService {
  execute(params: {
    code: string
    language: 'python'
    sessionId: string
  }): Promise<ExecutionResult>
}
```

---

### 3.6 服务注册表（`src/services/registry.ts`）

```typescript
/**
 * 服务注册表：根据 config.store.useMock 返回对应实现。
 * 这是唯一需要修改的地方——要切换为真实服务，只改这一个文件。
 */
import { useConfigStore } from '../stores/config.store'
import { MockLLMService }      from './llm/mock'
import { AnthropicLLMService } from './llm/anthropic'
import { MockFinanceService }  from './finance/mock'
import { TushareService }      from './finance/tushare'
import { MockExecutorService } from './executor/mock'
import { SandboxService }      from './executor/sandbox'
import type { ILLMService }      from './llm/interface'
import type { IFinanceService }  from './finance/interface'
import type { IExecutorService } from './executor/interface'

// 单例缓存
let _llm:      ILLMService | null = null
let _finance:  IFinanceService | null = null
let _executor: IExecutorService | null = null

export function getLLMService(): ILLMService {
  const { useMock, anthropicApiKey } = useConfigStore.getState()
  if (!_llm) {
    _llm = useMock
      ? new MockLLMService()
      : new AnthropicLLMService(anthropicApiKey)
  }
  return _llm
}

export function getFinanceService(): IFinanceService {
  const { useMock, tushareToken } = useConfigStore.getState()
  if (!_finance) {
    _finance = useMock
      ? new MockFinanceService()
      : new TushareService(tushareToken)
  }
  return _finance
}

export function getExecutorService(): IExecutorService {
  const { useMock, sandboxUrl } = useConfigStore.getState()
  if (!_executor) {
    _executor = useMock
      ? new MockExecutorService()
      : new SandboxService(sandboxUrl)
  }
  return _executor
}

/** 切换 Mock/Real 时清空缓存，强制重新实例化 */
export function resetServiceCache(): void {
  _llm = null
  _finance = null
  _executor = null
}
```

---

## 四、状态管理设计

### 4.1 会话 Store（`src/stores/session.store.ts`）

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Message, ContentBlock, StreamEvent } from '../services/types'

interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
}

interface SessionState {
  sessions: ChatSession[]
  currentSessionId: string | null
  isStreaming: boolean
  streamingBlocks: ContentBlock[]  // 当前流中积累的块

  // Actions
  createSession: () => string
  selectSession: (id: string) => void
  addUserMessage: (content: string) => void
  appendStreamEvent: (event: StreamEvent) => void
  finalizeAssistantMessage: (messageId: string) => void
  setStreaming: (v: boolean) => void
  clearStreamingBlocks: () => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      isStreaming: false,
      streamingBlocks: [],

      createSession: () => {
        const id = crypto.randomUUID()
        set(s => ({
          sessions: [...s.sessions, {
            id, title: '新对话',
            messages: [], createdAt: new Date()
          }],
          currentSessionId: id,
        }))
        return id
      },

      selectSession: (id) => set({ currentSessionId: id }),

      addUserMessage: (content) => {
        const { currentSessionId, sessions } = get()
        if (!currentSessionId) return
        const msg: Message = {
          id: crypto.randomUUID(),
          role: 'user', content,
          createdAt: new Date(),
        }
        set({
          sessions: sessions.map(s =>
            s.id === currentSessionId
              ? { ...s, messages: [...s.messages, msg],
                  title: s.messages.length === 0 ? content.slice(0, 30) : s.title }
              : s
          )
        })
      },

      appendStreamEvent: (event) => {
        // text_delta：追加到当前文本块
        // code_block / chart_data / table_data：新增结构化块
        set(s => {
          const blocks = [...s.streamingBlocks]
          if (event.type === 'text_delta' && event.delta) {
            const last = blocks.at(-1)
            if (last?.type === 'text') {
              blocks[blocks.length - 1] = { type: 'text', content: last.content + event.delta }
            } else {
              blocks.push({ type: 'text', content: event.delta })
            }
          } else if (event.type === 'code_block' && event.code) {
            blocks.push({ type: 'code', language: event.language ?? 'python', code: event.code })
          } else if (event.type === 'chart_data' && event.chartSpec) {
            blocks.push({ type: 'chart', spec: event.chartSpec })
          } else if (event.type === 'table_data') {
            blocks.push({ type: 'table', columns: event.columns ?? [], rows: event.rows ?? [] })
          }
          return { streamingBlocks: blocks }
        })
      },

      finalizeAssistantMessage: (messageId) => {
        const { currentSessionId, sessions, streamingBlocks } = get()
        if (!currentSessionId) return
        const fullText = streamingBlocks
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; content: string }).content)
          .join('')
        const msg: Message = {
          id: messageId,
          role: 'assistant',
          content: fullText,
          contentBlocks: streamingBlocks,
          createdAt: new Date(),
        }
        set({
          sessions: sessions.map(s =>
            s.id === currentSessionId
              ? { ...s, messages: [...s.messages, msg] }
              : s
          ),
          streamingBlocks: [],
          isStreaming: false,
        })
      },

      setStreaming: (v) => set({ isStreaming: v }),
      clearStreamingBlocks: () => set({ streamingBlocks: [] }),
    }),
    { name: 'mirrorcode-sessions' }
  )
)
```

### 4.2 配置 Store（`src/stores/config.store.ts`）

```typescript
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
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      useMock: true,            // 默认 Mock 模式
      anthropicApiKey: '',
      tushareToken: '',
      sandboxUrl: 'http://localhost:8001',

      setUseMock: (v) => {
        set({ useMock: v })
        resetServiceCache()     // 清空服务单例，下次 get 时重新实例化
      },
      setApiKey: (key) => set({ anthropicApiKey: key }),
    }),
    { name: 'mirrorcode-config' }
  )
)
```

---

## 五、Mock 数据设计

### 5.1 场景匹配器（`src/mocks/scenarios/index.ts`）

```typescript
import type { StreamEvent } from '../../services/types'
import { s01RoeChart }    from './s01-roe-chart'
import { s02FactorDebug } from './s02-factor-debug'
import { s03WrapQuery }   from './s03-wrap-query'
import { s04StressTest }  from './s04-stress-test'
import { s05Comparison }  from './s05-comparison'
import { defaultScenario } from './default'

interface Scenario {
  events: StreamEvent[]
}

const SCENARIOS: Array<{ keywords: string[]; scenario: Scenario }> = [
  { keywords: ['roe', '盈利', '茅台', '趋势', '财报'],  scenario: s01RoeChart },
  { keywords: ['因子', 'ic', '动量', '调试', '问题'],   scenario: s02FactorDebug },
  { keywords: ['换手率', '封装', '函数', '复用'],       scenario: s03WrapQuery },
  { keywords: ['压力测试', '回撤', '2015', '股灾'],     scenario: s04StressTest },
  { keywords: ['对比', '宁德', '比亚迪', '亿纬', '比较'], scenario: s05Comparison },
]

export function detectScenario(userMessage: string): Scenario {
  const lower = userMessage.toLowerCase()
  for (const { keywords, scenario } of SCENARIOS) {
    if (keywords.some(k => lower.includes(k))) return scenario
  }
  return defaultScenario
}
```

### 5.2 S01 场景示例（`src/mocks/scenarios/s01-roe-chart.ts`）

```typescript
import type { StreamEvent } from '../../services/types'

// 预生成的 Plotly 图表 spec（真实数据形状的 Mock）
const roeChartSpec = {
  data: [{
    x: ['2021Q1','2021Q2','2021Q3','2021Q4','2022Q1','2022Q2','2022Q3','2022Q4','2023Q1','2023Q2','2023Q3','2023Q4'],
    y: [0.268, 0.281, 0.290, 0.312, 0.295, 0.308, 0.319, 0.333, 0.301, 0.315, 0.322, 0.341],
    type: 'scatter', mode: 'lines+markers',
    name: '贵州茅台 ROE',
    line: { color: '#c0392b', width: 2 },
    marker: { size: 6 }
  }],
  layout: {
    title: '贵州茅台（600519.SH）季度 ROE 趋势',
    xaxis: { title: '报告期' },
    yaxis: { title: 'ROE', tickformat: '.1%' },
    hovermode: 'x unified'
  }
}

// 预生成的 Python 代码（含内联数据）
const roeCode = `import plotly.graph_objects as go

data = {
    'period': ['2021Q1','2021Q2','2021Q3','2021Q4',
               '2022Q1','2022Q2','2022Q3','2022Q4',
               '2023Q1','2023Q2','2023Q3','2023Q4'],
    'roe':    [0.268, 0.281, 0.290, 0.312,
               0.295, 0.308, 0.319, 0.333,
               0.301, 0.315, 0.322, 0.341],
}

fig = go.Figure()
fig.add_trace(go.Scatter(
    x=data['period'], y=data['roe'],
    mode='lines+markers', name='贵州茅台 ROE',
    line=dict(color='#c0392b', width=2),
))
fig.update_layout(
    title='贵州茅台（600519.SH）季度 ROE 趋势',
    yaxis_tickformat='.1%',
)
fig.show()`

export const s01RoeChart = {
  events: [
    { type: 'thinking',   content: '正在分析请求，识别到财报查询意图...' },
    { type: 'tool_start', tool: 'get_financial_report',
      source: 'tushare',
      params: { ticker: '600519.SH', period: 'quarterly', fields: ['roe'] } },
    { type: 'tool_end',   tool: 'get_financial_report', source: 'tushare' },
    { type: 'text_delta', delta: '以下是贵州茅台过去三年的季度 ROE 趋势：\n\n' },
    { type: 'chart_data', chartSpec: roeChartSpec },
    { type: 'text_delta', delta: '\n整体来看，ROE 从 2021Q1 的 26.8% 稳步提升至 2023Q4 的 34.1%，' },
    { type: 'text_delta', delta: '呈现出较强的持续性盈利能力。2022Q1 出现短暂回落，' },
    { type: 'text_delta', delta: '主要受疫情管控影响导致营收阶段性下滑。\n\n如需在本地复现图表，可使用以下代码：\n' },
    { type: 'code_block', language: 'python', code: roeCode },
    { type: 'disclaimer', content: '本分析仅供参考，不构成任何投资建议。' },
    { type: 'done',       messageId: crypto.randomUUID() },
  ] as StreamEvent[]
}
```

### 5.3 财报 Mock 数据结构（`src/mocks/data/financial-reports.ts`）

```typescript
import type { FinancialReport } from '../../services/types'

// 5 家公司 × 12 个季度的财报数据（供 MockFinanceService 使用）
export const MOCK_FINANCIAL_REPORTS: FinancialReport[] = [
  // 贵州茅台 600519.SH
  { ticker: '600519.SH', period: '2023Q4', reportDate: '2024-03-28',
    fields: { roe: 0.341, revenue: 17310000000, net_profit: 7477000000,
              gross_margin: 0.921, pe_ttm: 28.4, pb: 9.7 } },
  { ticker: '600519.SH', period: '2023Q3', reportDate: '2023-10-28',
    fields: { roe: 0.322, revenue: 13864000000, net_profit: 6009000000,
              gross_margin: 0.918, pe_ttm: 31.2, pb: 10.1 } },
  // ... 更多季度

  // 宁德时代 300750.SZ
  { ticker: '300750.SZ', period: '2023Q4', reportDate: '2024-03-15',
    fields: { roe: 0.165, revenue: 44191000000, net_profit: 4436000000,
              gross_margin: 0.224, pe_ttm: 16.8, pb: 2.8 } },
  // ...
]
```

### 5.4 公司名称映射（`src/mocks/data/companies.ts`）

```typescript
// 格式：[别名列表, 股票代码]
export const COMPANY_MAP: [string[], string][] = [
  [['茅台', '贵州茅台', '600519'],        '600519.SH'],
  [['宁德时代', 'CATL', '300750'],        '300750.SZ'],
  [['比亚迪', 'BYD', '002594'],           '002594.SZ'],
  [['亿纬锂能', '300014'],                '300014.SZ'],
  [['中国平安', '平安', '601318'],        '601318.SH'],
  [['招商银行', '招行', '600036'],        '600036.SH'],
  [['沪深300', 'hs300', '000300'],        '000300.SH'],
  // ... 50+ 常用标的
]

export function resolveTicker(input: string): string | null {
  const lower = input.toLowerCase()
  for (const [aliases, code] of COMPANY_MAP) {
    if (aliases.some(a => lower.includes(a.toLowerCase()))) return code
  }
  return null
}
```

---

## 六、关键组件说明

### 6.1 核心 Hook：useChat（`src/hooks/useChat.ts`）

```typescript
import { useSessionStore } from '../stores/session.store'
import { getLLMService }   from '../services/registry'

export function useChat() {
  const store = useSessionStore()
  const llm = getLLMService()

  const sendMessage = async (content: string) => {
    // 1. 写入用户消息
    store.addUserMessage(content)
    store.setStreaming(true)
    store.clearStreamingBlocks()

    // 2. 构建消息历史（取当前会话的全部消息）
    const currentSession = store.sessions.find(
      s => s.id === store.currentSessionId
    )
    if (!currentSession) return

    // 3. 消费流
    try {
      const stream = llm.chat(currentSession.messages)
      for await (const event of stream) {
        if (event.type === 'done') {
          store.finalizeAssistantMessage(event.messageId ?? crypto.randomUUID())
          break
        }
        if (event.type === 'error') {
          console.error('Stream error:', event.content)
          store.setStreaming(false)
          break
        }
        store.appendStreamEvent(event)
      }
    } catch (err) {
      store.setStreaming(false)
      throw err
    }
  }

  const stopStreaming = () => {
    llm.abort()
    store.setStreaming(false)
    // 将已积累的块作为 assistant 消息落库
    store.finalizeAssistantMessage(crypto.randomUUID())
  }

  return { sendMessage, stopStreaming, isStreaming: store.isStreaming }
}
```

### 6.2 开发工具栏（`src/components/layout/DevToolbar.tsx`）

开发环境下显示的常驻工具栏，包含：
- Mock / Real 切换开关（联动 `config.store`）
- API Key 输入（切换 Real 时启用）
- 快速触发各核心场景的按钮（方便 UI 调试）
- 当前服务状态指示灯

```tsx
// 仅在 import.meta.env.DEV 时渲染
export function DevToolbar() {
  const { useMock, setUseMock, setApiKey } = useConfigStore()
  const { sendMessage } = useChat()

  if (!import.meta.env.DEV) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-background border rounded-lg p-3 shadow-lg space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${useMock ? 'bg-amber-400' : 'bg-green-400'}`}/>
        <span>{useMock ? 'Mock 模式' : 'Real 模式'}</span>
        <button onClick={() => setUseMock(!useMock)} className="text-xs underline">切换</button>
      </div>
      {!useMock && (
        <input
          placeholder="Anthropic API Key"
          className="text-xs w-48 border rounded px-2 py-1"
          onChange={e => setApiKey(e.target.value)}
        />
      )}
      <div className="flex gap-1 flex-wrap">
        {['ROE 趋势图', '因子调试', '封装查询', '压力测试', '多标的对比'].map((label, i) => (
          <button
            key={i}
            onClick={() => sendMessage(['帮我画一下茅台ROE趋势', '我的动量因子IC很低', '帮我封装换手率查询', '用2015股灾数据跑回撤', '对比宁德比亚迪亿纬'][i])}
            className="text-xs px-2 py-0.5 rounded border hover:bg-muted"
          >S0{i+1}: {label}</button>
        ))}
      </div>
    </div>
  )
}
```

---

## 七、Mock → Real 切换机制

整个切换只有两步：

**步骤 1**：在 `DevToolbar` 中关闭 Mock 开关，填入 API Key（界面操作，不改代码）

**步骤 2**：在 `services/llm/anthropic.ts` 中实现 `AnthropicLLMService`（当前是 stub），实现与 `MockLLMService` 完全相同的 `ILLMService` 接口：

```typescript
// src/services/llm/anthropic.ts（stub → 真实实现）
import Anthropic from '@anthropic-ai/sdk'
import type { ILLMService } from './interface'
import type { Message, StreamEvent } from '../types'

export class AnthropicLLMService implements ILLMService {
  private client: Anthropic
  private controller: AbortController | null = null

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  }

  async *chat(messages: Message[]): AsyncGenerator<StreamEvent, void, unknown> {
    this.controller = new AbortController()

    const stream = await this.client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }, { signal: this.controller.signal })

    for await (const chunk of stream) {
      // 将 Anthropic SDK 事件转换为 StreamEvent 格式
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield { type: 'text_delta', delta: chunk.delta.text }
      }
      // ... 其他事件类型映射
    }

    yield { type: 'done', messageId: crypto.randomUUID() }
  }

  abort(): void {
    this.controller?.abort()
  }
}
```

金融服务和执行服务同理，实现对应的 stub 即可。

---

## 八、启动与开发

```bash
# 安装依赖
npm install

# 开发模式启动（默认 Mock 模式，无需任何环境变量）
npm run dev
# 访问 http://localhost:5173

# 构建生产包
npm run build

# 代码检查
npm run lint
npm run typecheck
```

### package.json 关键依赖

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0",
    "@monaco-editor/react": "^4.6.0",
    "plotly.js-dist-min": "^2.30.0",
    "react-plotly.js": "^2.6.0",
    "tailwindcss": "^3.4.0",
    "clsx": "^2.1.0",
    "react-markdown": "^9.0.0",
    "rehype-highlight": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "@types/react": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^9.0.0"
  }
}
```

---

## 附录：新增真实服务的操作清单

当某个服务准备好接入真实接口时，执行以下步骤：

1. 在对应的 `src/services/{service}/real.ts` 中实现接口（参考 Mock 实现的方法签名）
2. `registry.ts` 中已经有 `useMock ? Mock : Real` 的分支，无需修改
3. 在 `DevToolbar` 中关闭 Mock 开关，验证真实调用
4. 全部场景测试通过后，可考虑将该服务的 `useMock` 默认值改为 `false`

---

*客户端架构至此完整。建议先实现 ChatPage 布局 + MessageList + InputBar + StreamEvent 渲染，
用 S01 场景跑通完整 UI 流程，再逐步补充其他组件。*
