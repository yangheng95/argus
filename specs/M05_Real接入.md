# AimeCode M0.5 · Real 模式接入

**优先级**：P0
**前置里程碑**：M0-1（基础层）+ M0-2（UI 层）已完成，Mock 模式下 S01-S05 全部走通
**负责范围**：`AnthropicLLMService` 完整实现 · `TushareService` 完整实现 · Token 预算控制 · 合约测试 · HTCR 基线测试集
**参考文档**：
- `AimeCode_客户端架构_v0.2.md`（§3.2.1 / §3.5.1 / §附录 B.3 / §附录 B.4）
- `M05_M06_金融工具.md`（IFinanceService 接口 / 字段定义）
- `M08_M11_M12_上下文记忆与基础设施.md`（M12 合约测试规格）
- `AimeCode_骨架PRD_v0.1.md`（阶段 0.5 验收基准 / HTCR 测量方法）
- `IMPL_实施手册.md`（陷阱 7：Anthropic SDK dangerouslyAllowBrowser）

---

## 1. 目标与验收标准

### 1.1 目标

将 Mock 模式替换为真实 LLM（Anthropic Claude）+ 真实金融数据源（tushare Pro），建立 HTCR 基线指标。

### 1.2 验收标准

| 编号 | 标准 | 阈值 | 测量方式 |
|------|------|------|----------|
| AC-01 | HTCR（混合任务闭环率） | >= 55% | 20 条标注指令集自动评测 |
| AC-02 | 金融工具调用成功率 | >= 90% | 合约测试 + HTCR 测试集中工具调用日志统计 |
| AC-03 | Real 实现通过全部合约测试 | 100% | `vitest run --reporter=verbose` |
| AC-04 | DevToolbar Mock/Real 切换工作 | 功能验证 | 切换后旧服务 abort、新服务实例化 |
| AC-05 | Token 预算控制生效 | 功能验证 | 超预算时拒绝发送、每日零点重置 |
| AC-06 | Disclaimer 正确性 | >= 90% | 含金融数据回复有 disclaimer，纯代码回复无 disclaimer |

### 1.3 不在本里程碑范围内

- AkshareService 实现（推迟到阶段 1，TushareService 为首选数据源）
- SandboxService 真实实现（M04 代码执行，阶段 1）
- 上下文记忆引擎（M08，阶段 1）
- 企业私有化部署与审计日志（M11 完整版，阶段 2）

---

## 2. 前置条件

### 2.1 M0-1 + M0-2 交付物确认

在开始 M0.5 之前，以下条件必须全部满足：

- [ ] 5 个核心场景（S01-S05）Mock 链路全部走通，无中断、无白屏
- [ ] 流式输出帧率 >= 30fps（文字 delta 无可感知卡顿）
- [ ] 所有 ContentBlock 类型（text/code/chart/table/disclaimer）正确渲染
- [ ] Mock 合约测试全部通过（MockFinanceService / MockLLMService / MockExecutorService）
- [ ] `pnpm tsc --noEmit` 零错误

### 2.2 外部依赖

| 依赖 | 用途 | 获取方式 |
|------|------|----------|
| Anthropic API Key | LLM 调用 | 用户自行配置，存储在 localStorage |
| tushare Pro Token | 金融数据 | 用户自行配置，存储在 localStorage |
| `@anthropic-ai/sdk` | Anthropic 官方 TypeScript SDK | 已在 M0-1 安装（`pnpm add @anthropic-ai/sdk`） |
| `ky` | HTTP 客户端（tushare API 调用） | 已在 M0-1 安装（`pnpm add ky`） |

---

## 3. AnthropicLLMService 完整实现

### 3.1 文件位置

`src/services/llm/anthropic.ts`

### 3.2 核心设计

Claude 的 Tool Use 是一个多轮循环：LLM 请求调用工具，客户端执行工具拿到结果，再把结果喂回 LLM 让它继续生成。这个循环（Agentic Loop）在 `AnthropicLLMService.chat()` 内部完成，`useChat` 不感知循环细节，只看到一个线性的 StreamEvent 流。

### 3.3 完整实现代码

```typescript
// src/services/llm/anthropic.ts

import Anthropic from '@anthropic-ai/sdk'
import type { ILLMService } from './interface'
import type { Message, StreamEvent, ChatOptions } from '../types'
import { BASE_SYSTEM_PROMPT } from './system-prompt'
import { getFinanceService } from '../registry'

// ── 重试配置 ─────────────────────────────────────────────────────
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000  // 1s → 2s → 4s 指数退避

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class AnthropicLLMService implements ILLMService {
  private client: Anthropic
  private controller: AbortController | null = null

  constructor(apiKey: string) {
    // 陷阱 7：浏览器端使用 Anthropic SDK 必须显式允许
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  }

  async *chat(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    this.controller = new AbortController()

    // 构建 Anthropic 消息格式
    const anthropicMessages: Anthropic.MessageParam[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    // ── Agentic Loop：循环直到 LLM 不再请求工具 ──────────────────
    let continueLoop = true
    while (continueLoop) {
      continueLoop = false  // 默认退出，除非 LLM 请求工具

      yield { type: 'thinking', content: '正在思考...' }

      // ── 带重试的流式请求 ───────────────────────────────────────
      let stream: ReturnType<Anthropic['messages']['stream']>
      let lastError: Error | null = null

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
          await sleepMs(delay)
        }

        try {
          stream = this.client.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: options?.maxTokens ?? 4096,
            system: options?.systemPrompt ?? BASE_SYSTEM_PROMPT,
            messages: anthropicMessages,
            tools: options?.tools?.map(t => ({
              name: t.name,
              description: t.description,
              input_schema: t.input_schema as Anthropic.Tool.InputSchema,
            })),
          }, { signal: this.controller.signal })

          lastError = null
          break  // 成功创建 stream，退出重试循环
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))

          // 检查是否为可重试的 HTTP 错误
          const status = (err as any)?.status ?? (err as any)?.statusCode
          if (!isRetryable(status) || attempt === MAX_RETRIES) {
            // 不可重试 或 已达最大重试次数
            if (status === 429) {
              yield { type: 'error', content: '请求过于频繁，请稍后再试' }
            } else if (status >= 500) {
              yield { type: 'error', content: 'Anthropic 服务暂时不可用，请稍后再试' }
            } else if ((err as any)?.name === 'AbortError') {
              return  // 用户主动取消，静默退出
            } else {
              yield { type: 'error', content: `LLM 请求失败：${lastError.message}` }
            }
            return
          }
          // 可重试，继续下一次尝试
        }
      }

      // stream! 在此处一定已被赋值（否则上面已 return）
      // TypeScript 无法推断 break 后的赋值，用非空断言
      const activeStream = stream!

      // ── 事件映射表 ─────────────────────────────────────────────
      //
      // Anthropic SDK 事件               → AimeCode StreamEvent
      // ─────────────────────────────────────────────────────────────
      // content_block_start (text)        → （忽略，等 delta）
      // content_block_delta (text_delta)  → { type: 'text_delta', delta }
      // content_block_start (tool_use)    → { type: 'tool_start', tool, source }
      // content_block_delta (input_json)  → （累积 JSON 片段，不 yield）
      // content_block_stop (tool_use)     → 执行工具 → { type: 'tool_end' } 或 tool_error
      // message_stop (end_turn)           → { type: 'done' }
      // message_stop (tool_use)           → 设 continueLoop=true，带工具结果继续

      let currentToolUse: {
        id: string; name: string; inputJson: string
      } | null = null

      const toolResults: Anthropic.MessageParam['content'] = []

      try {
        for await (const event of activeStream) {
          // ── 文本增量 ─────────────────────────────────────────
          if (event.type === 'content_block_delta'
              && event.delta.type === 'text_delta') {
            yield { type: 'text_delta', delta: event.delta.text }
          }

          // ── 工具调用开始 ─────────────────────────────────────
          if (event.type === 'content_block_start'
              && event.content_block.type === 'tool_use') {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: '',
            }
            yield {
              type: 'tool_start',
              tool: event.content_block.name,
              source: 'tushare',
            }
          }

          // ── 工具参数累积（JSON 片段）─────────────────────────
          if (event.type === 'content_block_delta'
              && event.delta.type === 'input_json_delta'
              && currentToolUse) {
            currentToolUse.inputJson += event.delta.partial_json
          }

          // ── 工具调用结束 → 本地执行 ─────────────────────────
          if (event.type === 'content_block_stop' && currentToolUse) {
            try {
              const params = JSON.parse(currentToolUse.inputJson)
              const result = await this.executeTool(currentToolUse.name, params)

              yield {
                type: 'tool_end',
                tool: currentToolUse.name,
                source: 'tushare',
                summary: `${Array.isArray(result) ? result.length : 0} 条数据`,
              }

              // 把工具结果存起来，待循环结束后追加到消息历史
              toolResults.push({
                type: 'tool_result' as const,
                tool_use_id: currentToolUse.id,
                content: JSON.stringify(result),
              })
            } catch (err) {
              yield {
                type: 'tool_error',
                tool: currentToolUse.name,
                source: 'tushare',
                error: err instanceof Error ? err.message : String(err),
              }
              toolResults.push({
                type: 'tool_result' as const,
                tool_use_id: currentToolUse.id,
                content: JSON.stringify({ error: String(err) }),
                is_error: true,
              })
            }
            currentToolUse = null
          }
        }
      } catch (streamErr) {
        // ── 流中断处理 ──────────────────────────────────────────
        // 保留已接收内容（已 yield 的 StreamEvent 不会丢失）
        if ((streamErr as any)?.name === 'AbortError') {
          return  // 用户主动取消
        }
        yield {
          type: 'error',
          content: '回复中断，已保留已生成内容',
        }
        return
      }

      // ── 检查 stop_reason 决定是否继续循环 ──────────────────────
      const finalMessage = await activeStream.finalMessage()

      if (finalMessage.stop_reason === 'tool_use' && toolResults.length > 0) {
        // LLM 要求使用工具 → 把 assistant 回复 + tool_result 追加到消息历史
        anthropicMessages.push({ role: 'assistant', content: finalMessage.content })
        anthropicMessages.push({ role: 'user', content: toolResults as any })
        continueLoop = true  // 继续循环，让 LLM 基于工具结果继续生成
      }
    }

    yield { type: 'done', messageId: crypto.randomUUID() }
  }

  /** 根据工具名分发到对应 Service */
  private async executeTool(
    name: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const finance = getFinanceService()
    switch (name) {
      case 'get_financial_report':
        return finance.getFinancialReport({
          tickers: [params.ticker as string],
          startDate: params.start_date as string | undefined,
          endDate: params.end_date as string | undefined,
          freq: (params.freq as 'quarterly' | 'annual') ?? 'quarterly',
          fields: params.fields as string[],
        })
      case 'get_market_data':
        return finance.getOHLCV({
          ticker: params.ticker as string,
          startDate: params.start_date as string,
          endDate: params.end_date as string,
          freq: (params.freq as 'D' | 'W' | 'M') ?? 'D',
        })
      case 'get_index_components':
        return finance.getIndexComponents({
          indexCode: params.index_code as string,
          date: params.date as string | undefined,
        })
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  abort(): void {
    this.controller?.abort()
  }
}
```

### 3.4 Agentic Loop 流程图

```
useChat.sendMessage()
  → AnthropicLLMService.chat()
      → while (continueLoop) {
           → 带重试的 client.messages.stream()
               → 429/5xx: 指数退避重试（1s → 2s → 4s），最多 3 次
               → 网络断开: 不重试，立即报错
           → for await (event of stream) {
                text_delta → yield { type: 'text_delta', delta }
                tool_use_start → yield { type: 'tool_start' }
                input_json_delta → 累积到 currentToolUse.inputJson
                content_block_stop → executeTool() → yield { type: 'tool_end' }
              }
           → catch (streamErr):
               → AbortError: 静默退出（用户取消）
               → 其他: yield { type: 'error', content: '回复中断，已保留已生成内容' }
           → if stop_reason === 'tool_use':
               → 追加 assistant content + tool_result 到消息历史
               → continueLoop = true  // 再来一轮
           → else:
               → continueLoop = false  // LLM 完成了
         }
      → yield { type: 'done', messageId }
```

### 3.5 重试策略

| 场景 | 策略 |
|------|------|
| 429 Too Many Requests | 指数退避重试，最多 3 次（1s → 2s → 4s），超过后 yield `error` 事件："请求过于频繁" |
| 5xx Server Error | 同上重试策略 |
| 网络断开 | 不重试，立即 yield `error` 事件："LLM 请求失败" |
| 流中断（partial stream） | 保留已 yield 的内容，yield `error` 事件："回复中断，已保留已生成内容" |
| AbortError（用户取消） | 静默 return，不 yield 任何错误事件 |

### 3.6 关键设计决策

1. **Tool Use 循环在 `chat()` 内部闭合**：`useChat` 只看到一个线性的 StreamEvent 流，不需要处理多轮工具调用逻辑。
2. **`executeTool()` 调用 `getFinanceService()`（经过 registry）**：Mock/Real 模式自动切换。即使 LLM 是 Real，金融数据服务也可以独立切换。
3. **工具结果以 JSON 字符串传回 LLM**：LLM 基于结果生成文字/代码/图表。
4. **重试逻辑在 `chat()` 内部**：不暴露给 `useChat`，调用方无感知。

---

## 4. TushareService 实现

### 4.1 文件位置

`src/services/finance/tushare.ts`

### 4.2 tushare Pro API 概述

tushare Pro 是 A 股金融数据的 HTTP API。所有接口使用统一的 POST 请求格式：

```
POST https://api.tushare.pro
Content-Type: application/json

{
  "api_name": "<接口名>",
  "token": "<用户token>",
  "params": { ... },
  "fields": "field1,field2,..."
}
```

响应格式：

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["field1", "field2"],
    "items": [["value1", "value2"], ...]
  }
}
```

### 4.3 完整实现代码

```typescript
// src/services/finance/tushare.ts

import ky from 'ky'
import type { IFinanceService } from './interface'
import type { FinancialReport, OHLCVBar } from '../types'

// ── tushare API 响应类型 ─────────────────────────────────────────
interface TushareResponse {
  code: number
  msg: string
  data: {
    fields: string[]
    items: (string | number | null)[][]
  } | null
}

// ── tushare 字段映射：AimeCode 字段 → tushare 字段 ──────────────
// getFinancialReport 需要拼接多个 tushare 接口的数据
const FIELD_SOURCE_MAP: Record<string, { api: string; tsField: string }> = {
  // fina_indicator 接口
  revenue:       { api: 'fina_indicator', tsField: 'revenue' },
  net_profit:    { api: 'fina_indicator', tsField: 'n_income_attr_p' },
  gross_margin:  { api: 'fina_indicator', tsField: 'grossprofit_margin' },
  net_margin:    { api: 'fina_indicator', tsField: 'netprofit_margin' },
  roe:           { api: 'fina_indicator', tsField: 'roe' },
  roa:           { api: 'fina_indicator', tsField: 'roa' },
  debt_ratio:    { api: 'fina_indicator', tsField: 'debt_to_assets' },
  revenue_yoy:   { api: 'fina_indicator', tsField: 'or_yoy' },
  profit_yoy:    { api: 'fina_indicator', tsField: 'n_income_attr_p_yoy' },
  // daily_basic 接口
  pe_ttm:        { api: 'daily_basic', tsField: 'pe_ttm' },
  pb:            { api: 'daily_basic', tsField: 'pb' },
  ev_ebitda:     { api: 'daily_basic', tsField: 'total_mv' },  // 需二次计算
}

// ── tushare 报告期格式转换 ───────────────────────────────────────
// AimeCode: '2024-Q3' → tushare: '20240930'
function periodToTushareEndDate(period: string): string {
  const match = period.match(/^(\d{4})-Q(\d)$/)
  if (!match) return period.replace(/-/g, '')
  const [, year, q] = match
  const quarterEndMonth = { '1': '0331', '2': '0630', '3': '0930', '4': '1231' }
  return `${year}${quarterEndMonth[q as '1' | '2' | '3' | '4']}`
}

// tushare end_date → AimeCode period
function tushareEndDateToPeriod(endDate: string): string {
  const year = endDate.slice(0, 4)
  const monthDay = endDate.slice(4, 8)
  const quarterMap: Record<string, string> = {
    '0331': 'Q1', '0630': 'Q2', '0930': 'Q3', '1231': 'Q4',
  }
  const quarter = quarterMap[monthDay]
  return quarter ? `${year}-${quarter}` : year
}

// ── 频率限制：tushare 每分钟 200 次 ─────────────────────────────
const REQUEST_INTERVAL_MS = 310  // 每 310ms 最多一次请求，约 190 次/分钟，留余量
let lastRequestTime = 0

async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL_MS - elapsed))
  }
  lastRequestTime = Date.now()
}

export class TushareService implements IFinanceService {
  private token: string

  constructor(token: string) {
    this.token = token
  }

  // ── 底层 HTTP 调用 ───────────────────────────────────────────
  private async callApi(
    apiName: string,
    params: Record<string, unknown>,
    fields?: string,
  ): Promise<TushareResponse> {
    await waitForRateLimit()

    const response = await ky.post('https://api.tushare.pro', {
      json: {
        api_name: apiName,
        token: this.token,
        params,
        fields: fields ?? '',
      },
      timeout: 30000,  // 30s 超时
    }).json<TushareResponse>()

    // ── 错误处理 ─────────────────────────────────────────────
    if (response.code !== 0) {
      // tushare 错误码语义
      // code=-2001: 无权限（积分不够或未购买该接口）
      // code=-2002: 输入参数错误
      // code=40203: 每分钟调用次数超限
      if (response.code === 40203) {
        throw new Error(`tushare 频率限制：${response.msg}。请稍后再试。`)
      }
      if (response.code === -2001) {
        throw new Error(`tushare 无权限：${response.msg}。请检查 tushare Token 的积分等级。`)
      }
      throw new Error(`tushare API 错误 [${response.code}]：${response.msg}`)
    }

    if (!response.data || !response.data.items) {
      throw new Error(`tushare 返回空数据：api=${apiName}, params=${JSON.stringify(params)}`)
    }

    return response
  }

  // ── 将 tushare 响应转为行对象数组 ─────────────────────────────
  private parseRows<T extends Record<string, unknown>>(
    response: TushareResponse,
  ): T[] {
    const { fields, items } = response.data!
    return items.map(row => {
      const obj: Record<string, unknown> = {}
      fields.forEach((field, i) => {
        obj[field] = row[i]
      })
      return obj as T
    })
  }

  // ── getFinancialReport ────────────────────────────────────────
  async getFinancialReport(params: {
    tickers: string[]
    startDate?: string
    endDate?: string
    freq: 'quarterly' | 'annual'
    fields: string[]
  }): Promise<FinancialReport[]> {
    const results: FinancialReport[] = []

    for (const ticker of params.tickers) {
      // 确定需要调用的 tushare 接口
      const apisNeeded = new Set<string>()
      const tsFieldsByApi = new Map<string, string[]>()
      const fieldMapping = new Map<string, string>()  // tsField → aimecodeField

      for (const field of params.fields) {
        const source = FIELD_SOURCE_MAP[field]
        if (!source) continue
        apisNeeded.add(source.api)
        const existing = tsFieldsByApi.get(source.api) ?? []
        existing.push(source.tsField)
        tsFieldsByApi.set(source.api, existing)
        fieldMapping.set(source.tsField, field)
      }

      // 调用 fina_indicator（财务指标）
      if (apisNeeded.has('fina_indicator')) {
        const tsFields = tsFieldsByApi.get('fina_indicator')!
        const finaParams: Record<string, unknown> = {
          ts_code: ticker,
        }
        if (params.startDate) {
          finaParams.start_date = params.startDate.replace(/-/g, '')
        }
        if (params.endDate) {
          finaParams.end_date = params.endDate.replace(/-/g, '')
        }
        // tushare fina_indicator 按报告期返回
        // period 字段为 tushare 的 ann_date（公告日期），end_date 为报告期末日
        const allFields = ['end_date', 'ann_date', ...tsFields]

        const response = await this.callApi(
          'fina_indicator',
          finaParams,
          allFields.join(','),
        )

        const rows = this.parseRows<Record<string, unknown>>(response)

        for (const row of rows) {
          const endDate = row.end_date as string
          if (!endDate) continue

          // 按频率过滤
          const monthDay = endDate.slice(4, 8)
          if (params.freq === 'annual' && monthDay !== '1231') continue
          // quarterly 不过滤，保留全部季报

          const period = tushareEndDateToPeriod(endDate)
          const reportDate = row.ann_date as string ?? endDate

          const fields: Record<string, number | null> = {}
          for (const tsField of tsFields) {
            const aimecodeField = fieldMapping.get(tsField)
            if (!aimecodeField) continue
            const value = row[tsField]
            if (value === null || value === undefined) {
              fields[aimecodeField] = null
            } else {
              let numValue = Number(value)
              // tushare 百分比字段返回的是百分数（如 92.1 表示 92.1%），转为小数
              if (['gross_margin', 'net_margin', 'roe', 'roa', 'debt_ratio',
                   'revenue_yoy', 'profit_yoy'].includes(aimecodeField)) {
                // tushare grossprofit_margin 返回如 92.1，需要除以 100
                numValue = numValue / 100
              }
              fields[aimecodeField] = numValue
            }
          }

          results.push({
            ticker,
            period,
            reportDate: `${reportDate.slice(0, 4)}-${reportDate.slice(4, 6)}-${reportDate.slice(6, 8)}`,
            fields,
          })
        }
      }

      // 调用 daily_basic（每日基本面指标，用于 PE/PB 等估值指标）
      if (apisNeeded.has('daily_basic')) {
        const tsFields = tsFieldsByApi.get('daily_basic')!
        // daily_basic 是日频数据，取每个报告期末的最近交易日数据
        // 策略：取当前已有 results 中每个 period 对应的报告期末日，查询该日的估值
        const periodsForTicker = results
          .filter(r => r.ticker === ticker)
          .map(r => ({
            period: r.period,
            endDate: periodToTushareEndDate(r.period),
          }))

        for (const { period, endDate } of periodsForTicker) {
          try {
            const response = await this.callApi(
              'daily_basic',
              {
                ts_code: ticker,
                trade_date: endDate,
              },
              ['trade_date', ...tsFields].join(','),
            )

            const rows = this.parseRows<Record<string, unknown>>(response)
            if (rows.length > 0) {
              const row = rows[0]
              const existingReport = results.find(
                r => r.ticker === ticker && r.period === period,
              )
              if (existingReport) {
                for (const tsField of tsFields) {
                  const aimecodeField = fieldMapping.get(tsField)
                  if (!aimecodeField) continue
                  const value = row[tsField]
                  existingReport.fields[aimecodeField] =
                    value !== null && value !== undefined ? Number(value) : null
                }
              }
            }
          } catch {
            // daily_basic 该日无数据（如非交易日），跳过估值字段
          }
        }
      }
    }

    // 按 period 升序排列
    results.sort((a, b) => a.period.localeCompare(b.period))

    return results
  }

  // ── getOHLCV ──────────────────────────────────────────────────
  async getOHLCV(params: {
    ticker: string
    startDate: string
    endDate: string
    freq?: 'D' | 'W' | 'M'
  }): Promise<OHLCVBar[]> {
    // tushare pro_bar 或 daily 接口
    // 日线用 daily，周线/月线用 pro_bar
    const freq = params.freq ?? 'D'

    // tushare 接口选择
    let apiName: string
    let tsParams: Record<string, unknown>

    if (freq === 'D') {
      apiName = 'daily'
      tsParams = {
        ts_code: params.ticker,
        start_date: params.startDate.replace(/-/g, ''),
        end_date: params.endDate.replace(/-/g, ''),
      }
    } else {
      // 周线、月线用 pro_bar
      apiName = 'pro_bar'
      tsParams = {
        ts_code: params.ticker,
        start_date: params.startDate.replace(/-/g, ''),
        end_date: params.endDate.replace(/-/g, ''),
        freq: freq,
        adj: 'qfq',  // 前复权
      }
    }

    const tsFields = 'trade_date,open,high,low,close,vol,amount,pct_chg'

    const response = await this.callApi(apiName, tsParams, tsFields)
    const rows = this.parseRows<Record<string, unknown>>(response)

    // tushare daily 返回结果为倒序（最新在前），需要翻转
    rows.reverse()

    // 补充换手率数据（需额外调用 daily_basic）
    let turnoverMap: Map<string, number> | null = null
    try {
      const basicResponse = await this.callApi(
        'daily_basic',
        {
          ts_code: params.ticker,
          start_date: params.startDate.replace(/-/g, ''),
          end_date: params.endDate.replace(/-/g, ''),
        },
        'trade_date,turnover_rate',
      )
      const basicRows = this.parseRows<Record<string, unknown>>(basicResponse)
      turnoverMap = new Map(
        basicRows.map(r => [r.trade_date as string, Number(r.turnover_rate) / 100]),
      )
    } catch {
      // 换手率非必须，获取失败不阻塞
    }

    return rows.map(row => {
      const tradeDate = row.trade_date as string
      return {
        date: `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.vol) * 100,  // tushare vol 单位为手（100股），转为股
        amount: row.amount ? Number(row.amount) * 1000 : undefined,  // tushare 单位为千元，转为元
        turnover: turnoverMap?.get(tradeDate) ?? undefined,
        change_pct: row.pct_chg !== null ? Number(row.pct_chg) / 100 : undefined,
      }
    })
  }

  // ── getIndexComponents ────────────────────────────────────────
  async getIndexComponents(params: {
    indexCode: string
    date?: string
  }): Promise<Array<{ ticker: string; name: string; weight: number }>> {
    const tsParams: Record<string, unknown> = {
      index_code: params.indexCode,
    }
    if (params.date) {
      tsParams.trade_date = params.date.replace(/-/g, '')
    }

    const response = await this.callApi(
      'index_weight',
      tsParams,
      'con_code,con_name,weight',
    )

    const rows = this.parseRows<Record<string, unknown>>(response)

    return rows.map(row => ({
      ticker: row.con_code as string,
      name: (row.con_name as string) ?? '',
      weight: Number(row.weight),
    }))
  }

  // ── 数据源元信息（用于 SourceTag）──────────────────────────────
  getSourceInfo(): { name: string; latency?: number } {
    return { name: 'tushare' }
  }
}
```

### 4.4 tushare Pro 接口速查

| AimeCode 方法 | tushare 接口 | 文档链接 |
|---------------|-------------|---------|
| `getFinancialReport` | `fina_indicator`（财务指标） | https://tushare.pro/document/2?doc_id=79 |
| `getFinancialReport` | `daily_basic`（估值指标） | https://tushare.pro/document/2?doc_id=32 |
| `getOHLCV`（日线） | `daily`（日线行情） | https://tushare.pro/document/2?doc_id=27 |
| `getOHLCV`（周/月线） | `pro_bar`（通用行情） | https://tushare.pro/document/2?doc_id=109 |
| `getIndexComponents` | `index_weight`（指数权重） | https://tushare.pro/document/2?doc_id=96 |

### 4.5 错误处理策略

| 错误类型 | tushare 错误码/条件 | 处理方式 |
|----------|-------------------|---------|
| API 限流 | `code === 40203` | 抛出明确错误信息，提示用户稍后再试 |
| 无权限 | `code === -2001` | 抛出明确错误信息，提示检查 Token 积分等级 |
| 参数错误 | `code === -2002` | 抛出明确错误信息，包含原始错误描述 |
| 返回空数据 | `data.items` 为空 | 抛出错误，说明查询条件和接口名 |
| 网络超时 | ky 30s 超时 | 由 ky 抛出 TimeoutError |

### 4.6 频率限制

tushare Pro API 限制每分钟 200 次调用。`TushareService` 通过 `waitForRateLimit()` 在每次请求前做最小间隔控制（310ms），确保不超过限制。这是模块级别的节流，所有 `callApi` 调用共享同一个计时器。

### 4.7 数据单位对齐

tushare 接口返回的数据单位与 AimeCode 内部约定不同，`TushareService` 在转换层统一处理：

| 字段类型 | tushare 单位 | AimeCode 单位 | 转换 |
|----------|-------------|--------------|------|
| 百分比（roe/margin 等） | 百分数（如 92.1） | 小数（如 0.921） | `÷ 100` |
| 成交量 | 手（100 股） | 股 | `× 100` |
| 成交额 | 千元 | 元 | `× 1000` |
| 涨跌幅 | 百分数 | 小数 | `÷ 100` |
| 换手率 | 百分数 | 小数 | `÷ 100` |

---

## 5. Token 预算控制

### 5.1 config.store 扩展

在 `src/stores/config.store.ts` 中新增以下字段：

```typescript
interface ConfigState {
  // ── M0-1 已有字段（不修改）─────────────────────────────────
  useMock: boolean
  anthropicApiKey: string
  tushareToken: string
  sandboxUrl: string

  setUseMock: (v: boolean) => void
  setApiKey: (key: string) => void

  // ── Token 预算控制（M0.5 新增）──────────────────────────────
  maxTokensPerRequest: number    // 单次请求最大输出 token，默认 4096
  dailyTokenBudget: number       // 每日 token 预算，默认 100000（约 $3）
  dailyTokenUsed: number         // 当日已用 token 数
  dailyTokenResetDate: string    // 上次重置日期，格式 'YYYY-MM-DD'

  setMaxTokensPerRequest: (n: number) => void
  setDailyTokenBudget: (n: number) => void
  addTokenUsage: (tokens: number) => void
  checkTokenBudget: () => { allowed: boolean; remaining: number }
}
```

### 5.2 实现逻辑

```typescript
// config.store.ts 中的 Token 预算相关实现

// ── 每日零点重置逻辑 ──────────────────────────────────────────
function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)  // 'YYYY-MM-DD'
}

function ensureDailyReset(state: ConfigState): ConfigState {
  const today = getTodayDate()
  if (state.dailyTokenResetDate !== today) {
    return { ...state, dailyTokenUsed: 0, dailyTokenResetDate: today }
  }
  return state
}

// ── checkTokenBudget：发送前检查 ──────────────────────────────
checkTokenBudget: () => {
  const state = ensureDailyReset(get())
  if (state !== get()) set(state)  // 如果发生了重置，更新 store

  const remaining = state.dailyTokenBudget - state.dailyTokenUsed
  const allowed = remaining >= state.maxTokensPerRequest
  return { allowed, remaining }
}

// ── addTokenUsage：流结束后累加 ───────────────────────────────
addTokenUsage: (tokens: number) => {
  set(state => {
    const updated = ensureDailyReset(state)
    return { ...updated, dailyTokenUsed: updated.dailyTokenUsed + tokens }
  })
}
```

### 5.3 在 AnthropicLLMService 中集成

```typescript
// useChat.ts 中的调用点（伪代码）

async function sendMessage(content: string) {
  // ── 预算检查 ───────────────────────────────────────────────
  if (!configStore.useMock) {
    const { allowed, remaining } = configStore.checkTokenBudget()
    if (!allowed) {
      addMessage({
        role: 'assistant',
        content: `Token 预算已用尽。今日剩余 ${remaining} tokens，不足以发起新请求。预算将在明日零点重置。`,
      })
      return
    }
  }

  // ── 正常发送 ───────────────────────────────────────────────
  const service = getLLMService()
  for await (const event of service.chat(messages, options)) {
    appendStreamEvent(event)
  }

  // ── 累加用量（Real 模式下从 Anthropic usage 字段读取）──────
  if (!configStore.useMock) {
    // finalMessage.usage.input_tokens + finalMessage.usage.output_tokens
    // 这个值从 AnthropicLLMService 通过额外的 StreamEvent 传出
    // 新增 StreamEvent: { type: 'usage', inputTokens: number, outputTokens: number }
    configStore.addTokenUsage(totalTokens)
  }
}
```

### 5.4 DevToolbar 显示

在 DevToolbar 中新增 Token 用量显示：

```
┌────────────────────────────────────────────────────────────────┐
│  ● Mock 模式    [切换]     上下文：茅台 · 2021~2024             │
│                                                                │
│  快速场景：[S01 ROE] [S02 因子] [S03 封装] [S04 压测] [S05 对比]  │
│                                                                │
│  Real 模式时：                                                  │
│  Anthropic Key: [sk-ant-**************] [清除]                  │
│  tushare Token: [********************] [清除]                   │
│  Token 用量：23,456 / 100,000（今日）  [设置预算]                │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. 测试基础设施配置

在运行合约测试和 HTCR 评测脚本之前，需完成以下三个文件的配置。

### 6.1 vitest.config.ts

文件路径：`vitest.config.ts`（项目根目录）

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // jsdom 提供 window/fetch/crypto 等浏览器 API，与 Anthropic SDK 兼容
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],

    // 合约测试调用外部 API，超时设长
    testTimeout: 60_000,

    // 从项目根目录加载 .env.test 中的环境变量
    envDir: '.',

    // 默认只跑 unit 测试（不需要真实 API Key）
    // 合约测试单独运行：vitest run tests/services/ --reporter=verbose
    include: ['tests/unit/**/*.test.ts'],
  },
})
```

### 6.2 tests/setup.ts

文件路径：`tests/setup.ts`

```typescript
// 全局测试环境初始化
// 如需 @testing-library/jest-dom 断言扩展，在此引入
// import '@testing-library/jest-dom'
```

### 6.3 .env.test

文件路径：`.env.test`（项目根目录，**不提交到 git**）

```
# 合约测试 / HTCR 评测所需的真实 API Key
# 未填写时，Real 测试用例自动跳过，只跑 Mock 测试
VITE_ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
VITE_TUSHARE_TOKEN=xxxxxxxx
```

在 `.gitignore` 中确认已排除：
```
.env.test
.env.*.local
```

### 6.4 tests/ 目录结构

```
tests/
├── setup.ts                          # 全局测试初始化
├── unit/                             # 纯单元测试（无外部 API，CI 全量跑）
│   └── services/
│       └── mock-data.test.ts         # Mock 数据完整性校验（可选）
├── services/                         # 合约测试（需真实 API Key）
│   ├── finance.contract.test.ts      # IFinanceService：Mock vs Tushare（§7.2）
│   └── llm.contract.test.ts          # ILLMService：Mock vs Anthropic（§7.3）
└── htcr/                             # HTCR 评测集（需真实 API Key）
    ├── s01-roe-analysis.ts           # S01 标注指令集（§8.2）
    ├── s05-comparison.ts             # S05 标注指令集（§8.3）
    └── run-htcr.ts                   # 自动评测脚本（§8.4）
```

**运行命令**：

```bash
# 单元测试（CI）
pnpm vitest run

# 合约测试（需填写 .env.test）
pnpm vitest run tests/services/ --reporter=verbose

# HTCR 评测
tsx tests/htcr/run-htcr.ts
```

---

## 7. 合约测试

### 7.1 设计原则

使用 Vitest `describe.each` 跑 Mock 和 Real 的一致性测试。同一套测试用例验证两种实现返回结构一致、行为兼容。

### 6.2 finance.contract.test.ts

```typescript
// tests/services/finance.contract.test.ts

import { describe, it, expect } from 'vitest'
import { MockFinanceService } from '@/services/finance/mock'
import { TushareService } from '@/services/finance/tushare'

// Real 实例需要 Token，从环境变量读取。无 Token 时跳过 Real 测试。
const TUSHARE_TOKEN = import.meta.env.VITE_TUSHARE_TOKEN ?? ''
const realService = TUSHARE_TOKEN ? new TushareService(TUSHARE_TOKEN) : null

const services: [string, MockFinanceService | TushareService][] = [
  ['MockFinanceService', new MockFinanceService()],
  ...(realService ? [['TushareService', realService] as const] : []),
]

describe.each(services)('%s', (_, service) => {
  // ── getFinancialReport ────────────────────────────────────
  describe('getFinancialReport', () => {
    it('返回数组，每条含 ticker 和 period', async () => {
      const result = await service.getFinancialReport({
        tickers: ['600519.SH'],
        fields: ['roe'],
        freq: 'quarterly',
      })
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('ticker')
      expect(result[0]).toHaveProperty('period')
    })

    it('ticker 字段与请求一致', async () => {
      const result = await service.getFinancialReport({
        tickers: ['600519.SH'],
        fields: ['roe'],
        freq: 'quarterly',
      })
      for (const row of result) {
        expect(row.ticker).toBe('600519.SH')
      }
    })

    it('period 格式为 YYYY-QN 或 YYYY', async () => {
      const result = await service.getFinancialReport({
        tickers: ['600519.SH'],
        fields: ['revenue'],
        freq: 'quarterly',
      })
      for (const row of result) {
        expect(row.period).toMatch(/^\d{4}(-Q[1-4])?$/)
      }
    })

    it('fields 包含请求的字段', async () => {
      const result = await service.getFinancialReport({
        tickers: ['600519.SH'],
        fields: ['roe', 'revenue'],
        freq: 'quarterly',
      })
      for (const row of result) {
        expect(row.fields).toHaveProperty('roe')
        expect(row.fields).toHaveProperty('revenue')
      }
    })

    it('百分比字段值为小数（0-1 范围）', async () => {
      const result = await service.getFinancialReport({
        tickers: ['600519.SH'],
        fields: ['roe', 'gross_margin'],
        freq: 'quarterly',
      })
      for (const row of result) {
        if (row.fields.roe !== null) {
          expect(row.fields.roe).toBeGreaterThan(0)
          expect(row.fields.roe).toBeLessThan(1)
        }
        if (row.fields.gross_margin !== null) {
          expect(row.fields.gross_margin).toBeGreaterThan(0)
          expect(row.fields.gross_margin).toBeLessThanOrEqual(1)
        }
      }
    })

    it('结果按 period 升序排列', async () => {
      const result = await service.getFinancialReport({
        tickers: ['600519.SH'],
        fields: ['roe'],
        freq: 'quarterly',
      })
      for (let i = 1; i < result.length; i++) {
        expect(result[i].period >= result[i - 1].period).toBe(true)
      }
    })

    it('多标的并行查询返回多个 ticker 的数据', async () => {
      const result = await service.getFinancialReport({
        tickers: ['600519.SH', '300750.SZ'],
        fields: ['roe'],
        freq: 'quarterly',
      })
      const tickers = new Set(result.map(r => r.ticker))
      expect(tickers.has('600519.SH')).toBe(true)
      expect(tickers.has('300750.SZ')).toBe(true)
    })
  })

  // ── getOHLCV ──────────────────────────────────────────────
  describe('getOHLCV', () => {
    it('返回数组，每条含 date/open/high/low/close/volume', async () => {
      const result = await service.getOHLCV({
        ticker: '600519.SH',
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      })
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      const bar = result[0]
      expect(bar).toHaveProperty('date')
      expect(bar).toHaveProperty('open')
      expect(bar).toHaveProperty('high')
      expect(bar).toHaveProperty('low')
      expect(bar).toHaveProperty('close')
      expect(bar).toHaveProperty('volume')
    })

    it('date 格式为 YYYY-MM-DD', async () => {
      const result = await service.getOHLCV({
        ticker: '600519.SH',
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      })
      for (const bar of result) {
        expect(bar.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    })

    it('OHLC 数值合理（high >= low, high >= open, high >= close）', async () => {
      const result = await service.getOHLCV({
        ticker: '600519.SH',
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      })
      for (const bar of result) {
        expect(bar.high).toBeGreaterThanOrEqual(bar.low)
        expect(bar.high).toBeGreaterThanOrEqual(bar.open)
        expect(bar.high).toBeGreaterThanOrEqual(bar.close)
      }
    })

    it('结果按 date 升序排列', async () => {
      const result = await service.getOHLCV({
        ticker: '600519.SH',
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      })
      for (let i = 1; i < result.length; i++) {
        expect(result[i].date >= result[i - 1].date).toBe(true)
      }
    })
  })

  // ── getIndexComponents ────────────────────────────────────
  describe('getIndexComponents', () => {
    it('返回数组，每条含 ticker/name/weight', async () => {
      const result = await service.getIndexComponents({
        indexCode: '000300.SH',
      })
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('ticker')
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('weight')
    })

    it('weight 为正数', async () => {
      const result = await service.getIndexComponents({
        indexCode: '000300.SH',
      })
      for (const row of result) {
        expect(row.weight).toBeGreaterThan(0)
      }
    })
  })
})
```

### 6.3 llm.contract.test.ts

```typescript
// tests/services/llm.contract.test.ts

import { describe, it, expect } from 'vitest'
import { MockLLMService } from '@/services/llm/mock'
import { AnthropicLLMService } from '@/services/llm/anthropic'
import type { StreamEvent } from '@/services/types'

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY ?? ''
const realService = ANTHROPIC_KEY ? new AnthropicLLMService(ANTHROPIC_KEY) : null

const services: [string, MockLLMService | AnthropicLLMService][] = [
  ['MockLLMService', new MockLLMService()],
  ...(realService ? [['AnthropicLLMService', realService] as const] : []),
]

describe.each(services)('%s', (_, service) => {
  it('chat 返回 AsyncGenerator', () => {
    const gen = service.chat([
      { id: '1', role: 'user', content: '你好', createdAt: new Date() },
    ])
    expect(gen[Symbol.asyncIterator]).toBeDefined()
  })

  it('chat 流中包含 text_delta 和 done 事件', async () => {
    const events: StreamEvent[] = []
    for await (const event of service.chat([
      { id: '1', role: 'user', content: '你好', createdAt: new Date() },
    ])) {
      events.push(event)
    }

    const hasTextDelta = events.some(e => e.type === 'text_delta')
    const hasDone = events.some(e => e.type === 'done')

    expect(hasTextDelta).toBe(true)
    expect(hasDone).toBe(true)
  }, 30000)  // Real 模式超时 30s

  it('done 事件包含 messageId', async () => {
    const events: StreamEvent[] = []
    for await (const event of service.chat([
      { id: '1', role: 'user', content: '你好', createdAt: new Date() },
    ])) {
      events.push(event)
    }

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    if (doneEvent && doneEvent.type === 'done') {
      expect(doneEvent.messageId).toBeTruthy()
    }
  }, 30000)

  it('abort 后不再 yield 新事件', async () => {
    const events: StreamEvent[] = []
    const gen = service.chat([
      { id: '1', role: 'user', content: '写一篇 500 字的文章', createdAt: new Date() },
    ])

    // 读取前几个事件后 abort
    let count = 0
    for await (const event of gen) {
      events.push(event)
      count++
      if (count >= 3) {
        service.abort()
        break
      }
    }

    // abort 后不应有新事件
    expect(events.length).toBeGreaterThanOrEqual(1)
  }, 30000)
})
```

---

## 8. HTCR 测试集

### 8.1 测试集设计原则

- 覆盖 S01（财报查询 + ROE 分析）和 S05（横向对比）各 10 条，共 20 条
- 每条标注：输入文本、预期工具调用、预期输出类型、判定规则
- 判定规则基于骨架 PRD §1.2 的 HTCR 测量方法：
  - 工具在 <= 3 轮对话内完成任务，无追问
  - 金融工具被正确调用（参数合理，ticker/日期格式正确）
  - 最终输出包含预期类型的结构化内容（代码块/图表/表格，至少一项）
  - 输出不包含任何占位符（`YOUR_TICKER`、`TODO` 等）

### 8.2 S01 场景测试集：财报查询 + ROE 分析（10 条）

```typescript
// tests/htcr/s01-roe-analysis.ts

export const S01_TEST_CASES = [
  {
    id: 'S01-01',
    input: '帮我看茅台最近三年的季度 ROE 趋势',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '600519.SH',
        fields: ['roe'],
        freq: 'quarterly',
      },
    },
    expectedOutputTypes: ['chart', 'text'],
    judgmentRules: [
      '工具调用 ticker 为 600519.SH',
      'fields 包含 roe',
      '输出包含趋势图表（chart_data）或表格（table_data）',
      '文字分析中提及 ROE 数值或趋势方向',
      '无占位符',
    ],
  },
  {
    id: 'S01-02',
    input: '查一下宁德时代 2023 年全年的营收和净利润',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '300750.SZ',
        fields: ['revenue', 'net_profit'],
        freq: 'annual',
      },
    },
    expectedOutputTypes: ['text', 'table'],
    judgmentRules: [
      '工具调用 ticker 为 300750.SZ',
      'fields 包含 revenue 和 net_profit',
      'freq 为 annual 或时间范围限定在 2023 年',
      '输出包含营收和净利润的具体数值',
      '无占位符',
    ],
  },
  {
    id: 'S01-03',
    input: '画一下招商银行过去两年的 ROE 变化',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '600036.SH',
        fields: ['roe'],
      },
    },
    expectedOutputTypes: ['chart', 'code'],
    judgmentRules: [
      '工具调用 ticker 为 600036.SH',
      'fields 包含 roe',
      '输出包含图表（chart_data）或可绘图的代码块',
      '时间范围覆盖约 2 年',
      '无占位符',
    ],
  },
  {
    id: 'S01-04',
    input: '比亚迪最近四个季度的毛利率和净利率分别是多少',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '002594.SZ',
        fields: ['gross_margin', 'net_margin'],
        freq: 'quarterly',
      },
    },
    expectedOutputTypes: ['table', 'text'],
    judgmentRules: [
      '工具调用 ticker 为 002594.SZ',
      'fields 包含 gross_margin 和 net_margin',
      '输出包含 4 个季度的数据',
      '毛利率和净利率以百分比或小数形式呈现',
      '无占位符',
    ],
  },
  {
    id: 'S01-05',
    input: '帮我查茅台的 PE 和 PB 历史走势',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '600519.SH',
        fields: ['pe_ttm', 'pb'],
      },
    },
    expectedOutputTypes: ['chart', 'text'],
    judgmentRules: [
      '工具调用 ticker 为 600519.SH',
      'fields 包含 pe_ttm 和 pb',
      '输出包含估值走势图或数据表格',
      '无占位符',
    ],
  },
  {
    id: 'S01-06',
    input: '亿纬锂能的资产负债率是什么水平？和行业比怎么样？',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '300014.SZ',
        fields: ['debt_ratio'],
      },
    },
    expectedOutputTypes: ['text'],
    judgmentRules: [
      '工具调用 ticker 为 300014.SZ',
      'fields 包含 debt_ratio',
      '文字分析中提及资产负债率数值',
      '可能包含行业对比的定性分析',
      '无占位符',
    ],
  },
  {
    id: 'S01-07',
    input: '用 Python 画茅台 2021-2024 的季度营收柱状图',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '600519.SH',
        fields: ['revenue'],
        freq: 'quarterly',
      },
    },
    expectedOutputTypes: ['code'],
    judgmentRules: [
      '工具调用 ticker 为 600519.SH',
      'fields 包含 revenue',
      '输出包含 Python 代码块',
      '代码中使用工具返回的真实数据（内联 dict/list），不使用占位符',
      '代码包含 matplotlib 或 plotly 的绑图调用',
      '代码包含 fig.show() 或 plt.show()',
    ],
  },
  {
    id: 'S01-08',
    input: '给我看宁德时代最近三年的营收同比增速',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '300750.SZ',
        fields: ['revenue_yoy'],
      },
    },
    expectedOutputTypes: ['chart', 'text'],
    judgmentRules: [
      '工具调用 ticker 为 300750.SZ',
      'fields 包含 revenue_yoy',
      '输出包含增速数据的图表或表格',
      '文字中提及增速趋势',
      '无占位符',
    ],
  },
  {
    id: 'S01-09',
    input: '帮我分析招商银行的盈利能力，看 ROE 和 ROA',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '600036.SH',
        fields: ['roe', 'roa'],
      },
    },
    expectedOutputTypes: ['text', 'chart'],
    judgmentRules: [
      '工具调用 ticker 为 600036.SH',
      'fields 包含 roe 和 roa',
      '文字分析中包含盈利能力的判断',
      '提及 ROE 和 ROA 的具体数值',
      '无占位符',
    ],
  },
  {
    id: 'S01-10',
    input: '比亚迪 2024 年前三季度净利润同比增长了多少',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: {
        ticker: '002594.SZ',
        fields: ['net_profit', 'profit_yoy'],
        freq: 'quarterly',
      },
    },
    expectedOutputTypes: ['text', 'table'],
    judgmentRules: [
      '工具调用 ticker 为 002594.SZ',
      'fields 包含 profit_yoy 或 net_profit',
      '时间范围覆盖 2024 年 Q1-Q3',
      '输出包含同比增速的具体数值',
      '无占位符',
    ],
  },
]
```

### 8.3 S05 场景测试集：横向对比（10 条）

```typescript
// tests/htcr/s05-comparison.ts

export const S05_TEST_CASES = [
  {
    id: 'S05-01',
    input: '对比宁德时代和比亚迪的最新 ROE 和毛利率',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '300750.SZ', fields: ['roe', 'gross_margin'] },
        { ticker: '002594.SZ', fields: ['roe', 'gross_margin'] },
      ],
    },
    expectedOutputTypes: ['table', 'text'],
    judgmentRules: [
      '对两家公司分别调用 get_financial_report',
      'fields 包含 roe 和 gross_margin',
      '输出包含横向对比表格',
      '文字中有对比分析（谁高谁低、差异原因）',
      '无占位符',
    ],
  },
  {
    id: 'S05-02',
    input: '比较茅台和招商银行的 PE 估值',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '600519.SH', fields: ['pe_ttm'] },
        { ticker: '600036.SH', fields: ['pe_ttm'] },
      ],
    },
    expectedOutputTypes: ['table', 'text'],
    judgmentRules: [
      '对两家公司分别调用工具',
      'fields 包含 pe_ttm',
      '输出对比 PE 数值',
      '文字中可能提及行业差异（消费 vs 金融）',
      '无占位符',
    ],
  },
  {
    id: 'S05-03',
    input: '宁德、比亚迪、亿纬三家的净利润谁最高？画个对比图',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '300750.SZ', fields: ['net_profit'] },
        { ticker: '002594.SZ', fields: ['net_profit'] },
        { ticker: '300014.SZ', fields: ['net_profit'] },
      ],
    },
    expectedOutputTypes: ['chart', 'text'],
    judgmentRules: [
      '对三家公司分别调用工具',
      'fields 包含 net_profit',
      '输出包含对比图表',
      '文字中指出净利润最高的公司',
      '无占位符',
    ],
  },
  {
    id: 'S05-04',
    input: '用 Python 代码画一张宁德时代和比亚迪 2021-2024 的营收增速对比折线图',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '300750.SZ', fields: ['revenue_yoy'] },
        { ticker: '002594.SZ', fields: ['revenue_yoy'] },
      ],
    },
    expectedOutputTypes: ['code'],
    judgmentRules: [
      '对两家公司分别调用工具',
      'fields 包含 revenue_yoy',
      '输出包含 Python 代码块',
      '代码内联真实数据，不使用占位符',
      '代码绘制折线图，包含两家公司的数据',
      '代码包含 fig.show() 或 plt.show()',
    ],
  },
  {
    id: 'S05-05',
    input: '帮我对比茅台和五粮液的毛利率走势',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '600519.SH', fields: ['gross_margin'] },
        { ticker: '000858.SZ', fields: ['gross_margin'] },
      ],
    },
    expectedOutputTypes: ['chart', 'text'],
    judgmentRules: [
      '正确识别五粮液的 ticker 为 000858.SZ',
      'fields 包含 gross_margin',
      '输出包含走势图或数据表格',
      '文字中提及毛利率对比',
      '无占位符',
    ],
  },
  {
    id: 'S05-06',
    input: '比较沪深 300 指数中权重最大的 5 只股票的 ROE',
    expectedTools: ['get_index_components', 'get_financial_report'],
    expectedToolParams: {
      get_index_components: { indexCode: '000300.SH' },
      get_financial_report: { fields: ['roe'] },
    },
    expectedOutputTypes: ['table', 'text'],
    judgmentRules: [
      '先调用 get_index_components 获取成分股',
      '再对权重最大的 5 只股票调用 get_financial_report',
      '输出包含 5 只股票的 ROE 对比',
      '无占位符',
    ],
  },
  {
    id: 'S05-07',
    input: '宁德时代和亿纬锂能的资产负债率谁更高？趋势怎样？',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '300750.SZ', fields: ['debt_ratio'] },
        { ticker: '300014.SZ', fields: ['debt_ratio'] },
      ],
    },
    expectedOutputTypes: ['chart', 'text'],
    judgmentRules: [
      '对两家公司分别调用工具',
      'fields 包含 debt_ratio',
      '输出对比两家的资产负债率',
      '文字中指出谁更高以及趋势方向',
      '无占位符',
    ],
  },
  {
    id: 'S05-08',
    input: '做一张表格对比茅台、比亚迪、宁德时代的最新 PE PB ROE',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '600519.SH', fields: ['pe_ttm', 'pb', 'roe'] },
        { ticker: '002594.SZ', fields: ['pe_ttm', 'pb', 'roe'] },
        { ticker: '300750.SZ', fields: ['pe_ttm', 'pb', 'roe'] },
      ],
    },
    expectedOutputTypes: ['table'],
    judgmentRules: [
      '对三家公司分别调用工具',
      'fields 包含 pe_ttm、pb、roe',
      '输出包含横向对比表格（table_data）',
      '表格含 PE、PB、ROE 三列',
      '无占位符',
    ],
  },
  {
    id: 'S05-09',
    input: '比亚迪和宁德时代最近一年的股价走势对比',
    expectedTools: ['get_market_data'],
    expectedToolParams: {
      get_market_data: [
        { ticker: '002594.SZ' },
        { ticker: '300750.SZ' },
      ],
    },
    expectedOutputTypes: ['chart', 'code'],
    judgmentRules: [
      '对两家公司分别调用 get_market_data',
      '时间范围约一年',
      '输出包含走势对比图',
      '无占位符',
    ],
  },
  {
    id: 'S05-10',
    input: '帮我对比锂电三杰（宁德时代、比亚迪、亿纬锂能）的净利率趋势，用 Python 画图',
    expectedTools: ['get_financial_report'],
    expectedToolParams: {
      get_financial_report: [
        { ticker: '300750.SZ', fields: ['net_margin'] },
        { ticker: '002594.SZ', fields: ['net_margin'] },
        { ticker: '300014.SZ', fields: ['net_margin'] },
      ],
    },
    expectedOutputTypes: ['code'],
    judgmentRules: [
      '正确理解"锂电三杰"指三家公司',
      '对三家公司分别调用工具',
      'fields 包含 net_margin',
      '输出包含 Python 代码块',
      '代码内联真实数据',
      '代码绘制三条折线并包含图例',
      '无占位符',
    ],
  },
]
```

### 8.4 HTCR 自动评测脚本

```typescript
// tests/htcr/run-htcr.ts
// 用法：VITE_ANTHROPIC_API_KEY=sk-ant-xxx VITE_TUSHARE_TOKEN=xxx npx vitest run tests/htcr/

import { describe, it, expect } from 'vitest'
import { AnthropicLLMService } from '@/services/llm/anthropic'
import type { StreamEvent } from '@/services/types'
import { TOOL_DEFINITIONS } from '@/services/tool_definitions'
import { BASE_SYSTEM_PROMPT } from '@/services/llm/system-prompt'
import { S01_TEST_CASES } from './s01-roe-analysis'
import { S05_TEST_CASES } from './s05-comparison'

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
if (!API_KEY) throw new Error('VITE_ANTHROPIC_API_KEY is required for HTCR tests')

const service = new AnthropicLLMService(API_KEY)

interface HTCRResult {
  id: string
  passed: boolean
  toolsCalled: string[]
  outputTypes: Set<string>
  hasPlaceholder: boolean
  roundCount: number
  error?: string
}

async function evaluateCase(testCase: {
  id: string
  input: string
  expectedTools: string[]
  expectedOutputTypes: string[]
}): Promise<HTCRResult> {
  const events: StreamEvent[] = []

  try {
    for await (const event of service.chat(
      [{ id: '1', role: 'user', content: testCase.input, createdAt: new Date() }],
      { tools: TOOL_DEFINITIONS, systemPrompt: BASE_SYSTEM_PROMPT, maxTokens: 4096 },
    )) {
      events.push(event)
    }
  } catch (err) {
    return {
      id: testCase.id,
      passed: false,
      toolsCalled: [],
      outputTypes: new Set(),
      hasPlaceholder: false,
      roundCount: 0,
      error: String(err),
    }
  }

  // 分析事件流
  const toolsCalled = events
    .filter(e => e.type === 'tool_start')
    .map(e => (e as { tool: string }).tool)

  const outputTypes = new Set<string>()
  let fullText = ''

  for (const event of events) {
    switch (event.type) {
      case 'text_delta':
        fullText += event.delta
        outputTypes.add('text')
        break
      case 'chart_data':
        outputTypes.add('chart')
        break
      case 'table_data':
        outputTypes.add('table')
        break
      case 'code_block':
        outputTypes.add('code')
        break
    }
  }

  // 检查文本中的代码块（LLM 可能在 text 中用 markdown 代码块输出）
  if (fullText.includes('```python') || fullText.includes('```py')) {
    outputTypes.add('code')
  }

  // 检查占位符
  const placeholders = ['YOUR_TICKER', 'TODO', 'YOUR_TOKEN', 'REPLACE_WITH',
    'your_api_key', 'INSERT_HERE', 'FILL_IN']
  const hasPlaceholder = placeholders.some(p =>
    fullText.toUpperCase().includes(p.toUpperCase()),
  )

  // 判定规则
  const roundCount = events.filter(e => e.type === 'thinking').length

  // 1. 轮次 <= 3
  const roundOk = roundCount <= 3

  // 2. 预期工具被调用
  const toolsOk = testCase.expectedTools.every(t => toolsCalled.includes(t))

  // 3. 预期输出类型至少有一个匹配
  const outputOk = testCase.expectedOutputTypes.some(t => outputTypes.has(t))

  // 4. 无占位符
  const noPlaceholder = !hasPlaceholder

  const passed = roundOk && toolsOk && outputOk && noPlaceholder

  return {
    id: testCase.id,
    passed,
    toolsCalled,
    outputTypes,
    hasPlaceholder,
    roundCount,
  }
}

describe('HTCR S01 - ROE 分析', () => {
  for (const testCase of S01_TEST_CASES) {
    it(
      `${testCase.id}: ${testCase.input}`,
      async () => {
        const result = await evaluateCase(testCase)
        console.log(`[${result.id}] passed=${result.passed} tools=${result.toolsCalled} outputs=${[...result.outputTypes]} rounds=${result.roundCount}`)
        expect(result.passed).toBe(true)
      },
      120000,  // 2 分钟超时（含工具调用时间）
    )
  }
})

describe('HTCR S05 - 横向对比', () => {
  for (const testCase of S05_TEST_CASES) {
    it(
      `${testCase.id}: ${testCase.input}`,
      async () => {
        const result = await evaluateCase(testCase)
        console.log(`[${result.id}] passed=${result.passed} tools=${result.toolsCalled} outputs=${[...result.outputTypes]} rounds=${result.roundCount}`)
        expect(result.passed).toBe(true)
      },
      120000,
    )
  }
})

// 最终统计
describe('HTCR Summary', () => {
  it('HTCR >= 55%', async () => {
    const allCases = [...S01_TEST_CASES, ...S05_TEST_CASES]
    const results: HTCRResult[] = []

    for (const testCase of allCases) {
      const result = await evaluateCase(testCase)
      results.push(result)
    }

    const passedCount = results.filter(r => r.passed).length
    const htcr = passedCount / results.length

    console.log(`\n===== HTCR Results =====`)
    console.log(`Total: ${results.length}`)
    console.log(`Passed: ${passedCount}`)
    console.log(`Failed: ${results.length - passedCount}`)
    console.log(`HTCR: ${(htcr * 100).toFixed(1)}%`)
    console.log(`\nFailed cases:`)
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ${r.id}: tools=${r.toolsCalled} outputs=${[...r.outputTypes]} placeholder=${r.hasPlaceholder} rounds=${r.roundCount} ${r.error ?? ''}`)
    }

    expect(htcr).toBeGreaterThanOrEqual(0.55)
  }, 600000)  // 10 分钟总超时
})
```

---

## 9. 文件创建/修改顺序

按依赖关系排列，每一步完成后需通过 `pnpm tsc --noEmit` 检查。

| 步骤 | 文件 | 操作 | 说明 |
|------|------|------|------|
| 1 | `src/services/types.ts` | 修改 | 新增 `UsageEvent` StreamEvent 类型（Token 用量上报） |
| 2 | `src/services/llm/anthropic.ts` | 重写 | 将 stub（`NotImplementedError`）替换为 §3.3 完整实现 |
| 3 | `src/services/finance/tushare.ts` | 重写 | 将 stub 替换为 §4.3 完整实现 |
| 4 | `src/stores/config.store.ts` | 修改 | 新增 Token 预算控制字段和方法（§5.1） |
| 5 | `src/hooks/useChat.ts` | 修改 | 集成 Token 预算检查（§5.3） |
| 6 | `src/components/layout/DevToolbar.tsx` | 修改 | 新增 Token 用量显示（§5.4） |
| 7 | `tests/services/finance.contract.test.ts` | 修改 | 取消注释 TushareService 行，添加新断言（§6.2） |
| 8 | `tests/services/llm.contract.test.ts` | 修改 | 取消注释 AnthropicLLMService 行，添加新断言（§6.3） |
| 9 | `tests/htcr/s01-roe-analysis.ts` | 新建 | S01 测试集数据（§7.2） |
| 10 | `tests/htcr/s05-comparison.ts` | 新建 | S05 测试集数据（§7.3） |
| 11 | `tests/htcr/run-htcr.ts` | 新建 | HTCR 自动评测脚本（§7.4） |

---

## 10. 集成陷阱

### 9.1 Anthropic SDK 浏览器端 CORS

**问题**：Anthropic API（`api.anthropic.com`）支持浏览器直连，但必须设置 `dangerouslyAllowBrowser: true`。

**解决**：`AnthropicLLMService` 构造函数中已设置（见 §3.3 代码第 5 行）。

**注意**：如果未来需要隐藏 API Key（不在客户端暴露），需要引入 BFF 代理层。阶段 0.5 不做此项，因为产品定位为个人工具，Key 存储在用户本地。

### 9.2 tushare API 频率限制

**问题**：tushare Pro 限制每分钟 200 次调用。多标的并行查询（如 S05 对比 3 家公司，每家需调用 fina_indicator + daily_basic = 2 次 = 共 6 次）可能触发限流。

**解决**：`TushareService` 内部的 `waitForRateLimit()` 确保每次 `callApi` 调用间隔至少 310ms。6 次调用需要约 1.9 秒，在用户可接受范围内。

**监控**：tushare 返回 `code === 40203` 时抛出明确错误，`AnthropicLLMService.executeTool()` 会将错误传回 LLM 作为 `tool_result.is_error`。

### 9.3 Tool Use 多轮循环的消息格式

**问题**：Claude Tool Use 要求消息历史严格交替 user/assistant，且 tool_result 必须作为 user 消息紧跟 assistant 的 tool_use 内容。

**解决**：Agentic Loop（§3.3）中，`finalMessage.content`（包含 tool_use block）作为 assistant 消息追加，`toolResults`（包含 tool_result block）作为 user 消息追加，保证消息格式正确。

**易错点**：如果 LLM 在一轮中同时请求多个工具（parallel tool use），`toolResults` 数组会包含多个 `tool_result`，它们属于同一个 user 消息。代码已正确处理此情况。

### 9.4 stream 中断后的状态恢复

**问题**：流式传输中途断开（网络抖动、服务端超时），已 yield 的 StreamEvent 已被 `useChat` 消费并渲染到 UI。

**解决**：
- 已 yield 的事件不回收，`streamingBlocks` 保留已渲染内容。
- catch 块中 yield `error` 事件，UI 显示"回复中断，已保留已生成内容"。
- 不自动重试 stream（与请求级重试不同），因为无法从断点续传。

### 9.5 tushare 数据单位与 AimeCode 内部约定不一致

**问题**：tushare 的百分比字段返回百分数（如 92.1 表示 92.1%），而 AimeCode 约定使用小数（0.921）。成交量单位也不同。

**解决**：`TushareService` 在 `getFinancialReport` 和 `getOHLCV` 的转换层统一处理（见 §4.7 数据单位对齐表）。合约测试 §6.2 中的"百分比字段值为小数"断言确保转换正确。

### 9.6 Anthropic usage 字段获取

**问题**：Token 预算控制需要每次调用后累加实际消耗的 token 数，但 `finalMessage.usage` 只在 Agentic Loop 最后一轮可用，且多轮循环的总用量需要累加。

**解决**：在 Agentic Loop 的每一轮中，`finalMessage.usage.input_tokens + output_tokens` 累加到局部变量 `totalTokensUsed`，循环结束后通过新增的 `{ type: 'usage', inputTokens, outputTokens }` StreamEvent 传给 `useChat`。

---

## 11. 验证检查点

### 检查点 1：TypeScript 编译通过

```bash
pnpm tsc --noEmit
# 0 errors
```

### 检查点 2：合约测试通过（Mock）

```bash
pnpm vitest run tests/services/
# finance.contract.test.ts: MockFinanceService — 全部通过
# llm.contract.test.ts: MockLLMService — 全部通过
```

### 检查点 3：合约测试通过（Real）

```bash
VITE_ANTHROPIC_API_KEY=sk-ant-xxx VITE_TUSHARE_TOKEN=xxx pnpm vitest run tests/services/
# finance.contract.test.ts: TushareService — 全部通过
# llm.contract.test.ts: AnthropicLLMService — 全部通过
```

### 检查点 4：DevToolbar 切换

1. 启动 `pnpm dev`
2. 打开 DevToolbar，确认当前为 Mock 模式（琥珀色）
3. 输入 Anthropic Key 和 tushare Token
4. 切换到 Real 模式（绿色）
5. 发送"帮我看茅台 ROE 趋势"
6. 验证：tool_start badge 出现 → tool_end badge 出现（真实数据） → 文字分析 → 图表渲染

### 检查点 5：Token 预算控制

1. 设置 `dailyTokenBudget = 1000`（极低值）
2. 发送一条消息，验证 token 用量累加
3. 再发一条消息，验证超预算时被拒绝
4. 在 DevToolbar 查看用量显示

### 检查点 6：Disclaimer 正确性

1. Real 模式下发送"帮我看茅台 ROE 趋势" → 回复末尾应有 disclaimer
2. Real 模式下发送"写一个 Python 的快速排序" → 回复末尾不应有 disclaimer

### 检查点 7：HTCR 基线

```bash
VITE_ANTHROPIC_API_KEY=sk-ant-xxx VITE_TUSHARE_TOKEN=xxx pnpm vitest run tests/htcr/
# HTCR >= 55%
```

### 检查点 8：错误恢复

1. 使用无效的 Anthropic Key → 显示明确的错误信息（不是白屏或无响应）
2. 使用无效的 tushare Token → 工具调用失败时 LLM 收到错误并给出说明
3. 发送消息后立即点击停止 → 已生成内容保留，无白屏

---

## 附录 A：StreamEvent 类型扩展

M0.5 新增一个 StreamEvent 类型，用于 Token 用量上报：

```typescript
// 在 src/services/types.ts 的 StreamEvent union 中新增：
| { type: 'usage'; inputTokens: number; outputTokens: number }
```

`useChat` 的 `appendStreamEvent` 处理此事件时调用 `configStore.addTokenUsage(inputTokens + outputTokens)`。

---

## 附录 B：BASE_SYSTEM_PROMPT 完整文本

以下为 `src/services/llm/system-prompt.ts` 中 `BASE_SYSTEM_PROMPT` 常量的完整文本，Real 模式通过 `ChatOptions.systemPrompt` 传入每次 LLM 调用：

```typescript
export const BASE_SYSTEM_PROMPT = `你是 AimeCode，一个面向金融从业者的 AI 分析助手。你的核心能力是将用户的自然语言请求转化为"数据查询 + 代码生成 + 结果呈现"的完整链路。

## 身份与边界

- 你是金融数据分析工具，不是投资顾问。
- 你可以呈现数据、计算指标、生成代码、绘制图表。
- 你绝不提供买卖建议、持仓推荐或市场预测性结论。
- 你生成的所有分析内容仅供参考。

## 工具调用规则

你可以使用以下工具查询金融数据：
- get_financial_report：查询上市公司财报数据（ROE、营收、净利润、毛利率、PE、PB 等）
- get_market_data：查询股票/指数历史行情（OHLCV 日线数据）
- get_index_components：查询指数成分股和权重

调用规则：
1. 用户请求涉及具体公司数据时，必须先调用工具获取真实数据，不可编造或使用训练数据中的记忆。
2. 股票代码格式：xxxxxx.SH（上交所）或 xxxxxx.SZ（深交所）。如果用户说公司名，你需要使用正确的股票代码。系统可能在 system prompt 末尾附加实体预解析结果供你参考。
3. 时间范围：用户未指定时，默认使用最近 1 年。"最近三年"指从今天往前推 3 年。
4. 多标的查询时，对每个标的分别调用工具（最多 5 个并行）。
5. 纯代码请求（"写一个函数"、"帮我优化这段代码"）不要调用任何金融工具。

## 代码生成规则

当需要生成代码时，必须遵守以下规则：

**R1 · 内联数据**：代码中必须使用工具返回的真实数据，以 dict / list 形式硬编码。禁止使用 fetch_data()、YOUR_TICKER、TODO 等任何占位符。

**R2 · 关键步骤注释**：每个逻辑段落前有一行中文注释，说明该步骤目的。

**R3 · 标准库优先**：按优先级使用 pandas / numpy / matplotlib / plotly。不引入未预装的包。

**R4 · 图表自包含**：若代码生成图表，末尾必须调用 fig.show() 或 plt.show()。图表标题使用中文，包含标的名称和时间范围。

代码输出格式：使用 code_block 类型输出，language 字段设为 "python"。

## 输出结构

你的回复应按以下结构组织（根据实际需要选择）：

1. **工具调用**（如需要）：先调用工具获取数据
2. **文字分析**：简要说明数据含义、趋势解读（2-4 句话，不啰嗦）
3. **图表/表格**：如用户要求可视化，输出 Plotly JSON spec（chart_data 类型）或表格数据（table_data 类型）
4. **代码块**：如用户需要可复现的代码，输出完整可运行的 Python 代码（code_block 类型）
5. **免责声明**（如适用）：见下方规则

## 表格输出规则

当输出结构化对比数据时，使用 table_data 类型：
- columns：列名数组，第一列通常是标的名称或时间
- rows：二维数组，数值保持原始精度（不格式化），由客户端负责格式化展示
- 百分比类字段传小数（如 0.921 表示 92.1%），金额类字段传元为单位的原始值

## Plotly 图表输出规则

当输出图表时，使用 chart_data 类型，chartSpec 字段为完整的 Plotly JSON：
- data：trace 数组
- layout：布局配置
- K 线图使用 candlestick trace 类型，MA 线叠加在同一 y 轴
- 振荡指标（MACD/RSI）放在下方 subplot
- 中文标题和轴标签
- Y 轴放在右侧（金融图表惯例）

## 免责声明规则

当你的回复满足以下任一条件时，你必须在流的最末尾 emit 一个 { type: "disclaimer" } 事件：
- 使用了金融工具返回的市场数据、财务数据或行情数据
- 对市场走势、公司基本面、股价表现做出分析或评价
- 包含量化回测或风险计算的结果

纯代码编写、纯算法解释、与金融数据无关的通用回复，不需要 emit disclaimer。

## 对话风格

- 简洁专业，不寒暄
- 使用金融术语但给出必要的解释
- 数据引用要注明来源和截止期
- 一次只做用户要求的事，不主动扩展分析范围
- 如果用户的请求模糊，推断最可能的意图执行，不追问（除非完全无法判断）
`
```
