# AimeCode M2-2 · 设置与 API 密钥

> **自包含文档**：一个 AI 模型只读这一个文件，就能实现完整的设置面板和 API 密钥管理。
> **前置条件**：M0-2（UI 组件库）+ M0-3（设计系统）+ M2-1（前后端切换机制）已完成。
> **包含**：设置弹窗 UI、API Key 管理（Anthropic + Tushare）、密钥验证、本地安全存储、Mock/Real 模式切换 UI、服务状态指示器、DevToolbar。
> **不包含**：后端鉴权（M4-1）、用户登录（M4-1）、审计日志（M4-3）。

---

## 1. 目标与验收标准

### 1.1 里程碑目标

提供用户友好的设置界面，允许用户配置 API 密钥、切换 Mock/Real 模式、查看服务连接状态。密钥在本地安全存储，永远不发送到第三方。

### 1.2 验收标准

| # | 验收项 | 操作 | 预期结果 |
|---|---|---|---|
| V1 | 设置弹窗打开 | 点击 Header 右侧齿轮图标 | 弹出设置弹窗，有三个 Tab：通用、API 密钥、关于 |
| V2 | API Key 输入 | 在 API 密钥 Tab 输入 `sk-ant-xxx` | 输入框显示为密码模式（••••），有 👁 切换可见 |
| V3 | 密钥验证 | 输入 Key 后点击"验证" | 调用后端 health 或 Anthropic API，成功显示绿色 ✓，失败显示红色 ✗ + 错误原因 |
| V4 | 保存持久化 | 输入 Key → 保存 → 刷新 F5 → 重新打开设置 | Key 仍然存在（localStorage 持久化） |
| V5 | 密钥安全 | 检查 localStorage | Key 存储在 `aimecode-config` 中，整个 JSON 值可读但不明文暴露在 URL 或请求 log 中 |
| V6 | Mock/Real 切换 | 在设置中切换到 Real 模式 | 旧的 Mock 服务 abort，新 Real 服务实例化，下次发消息走后端 |
| V7 | 状态指示器 | Real 模式下后端在线 | Header 右侧小圆点：绿色（连接正常） |
| V8 | 状态指示器离线 | 关闭后端 | 小圆点变红，hover 提示 "服务器离线" |
| V9 | Tushare Token 输入 | 在 API 密钥 Tab 输入 Tushare Token | 保存成功，可用于真实金融数据查询 |
| V10 | DevToolbar | 按 `Ctrl+Shift+D` | 底部出现 DevToolbar：显示当前模式、服务状态、最后一次请求耗时、Token 用量 |
| V11 | 清除数据 | 在设置中点击"清除所有数据" | 确认弹窗 → 清除 localStorage + IndexedDB → 回到初始状态 |
| V12 | TypeScript 零错误 | `pnpm tsc --noEmit` | 0 errors |

---

## 2. 设置弹窗结构

```
┌───────────────────────────────────────────────────────┐
│  设置                                          [×]    │
├───────────────────────────────────────────────────────┤
│  [通用]  [API 密钥]  [关于]                           │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ◻ 运行模式                                          │
│  ┌──────────────────────────────────────────────┐    │
│  │ ◉ Mock 模式（使用内置示例数据）               │    │
│  │ ○ Real 模式（连接真实 API 服务器）            │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ◻ API 服务器地址                                    │
│  ┌──────────────────────────────────────────────┐    │
│  │ http://localhost:3001                        │    │
│  └──────────────────────────────────────────────┘    │
│  ⓘ Real 模式下，所有请求发送到此地址                  │
│                                                       │
│  ◻ 主题                                              │
│  ┌──────────────────────────────────────────────┐    │
│  │ ◉ 深色   ○ 浅色   ○ 跟随系统                │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ◻ 危险区域                                          │
│  [清除所有数据]  ← btn-danger btn-sm                  │
│                                                       │
├───────────────────────────────────────────────────────┤
│                              [取消]  [保存]           │
└───────────────────────────────────────────────────────┘
```

### API 密钥 Tab

```
┌───────────────────────────────────────────────────────┐
│  [通用]  [API 密钥]  [关于]                           │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ◻ Anthropic API Key                                  │
│  ┌────────────────────────────────┐  [👁] [验证]     │
│  │ sk-ant-••••••••••••••••        │                   │
│  └────────────────────────────────┘                   │
│  ✓ 验证通过 · claude-sonnet-4-6 可用                 │
│  ⓘ 密钥仅存储在本地浏览器，不会发送给第三方           │
│                                                       │
│  ◻ Tushare Pro Token                                  │
│  ┌────────────────────────────────┐  [👁] [验证]     │
│  │ ••••••••••••••••••••           │                   │
│  └────────────────────────────────┘                   │
│  ✓ 验证通过 · 积分 5000                              │
│                                                       │
│  ◻ Token 预算（每日）                                 │
│  ┌────────────────────────────────┐                   │
│  │ 1,000,000 tokens               │                   │
│  └────────────────────────────────┘                   │
│  今日已用: 45,230 / 1,000,000 (4.5%)                  │
│  ▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░                     │
│                                                       │
├───────────────────────────────────────────────────────┤
│                              [取消]  [保存]           │
└───────────────────────────────────────────────────────┘
```

---

## 3. 设置组件实现

文件路径：`src/components/SettingsModal.tsx`

```typescript
import { useState, useCallback } from 'react'
import { X, Eye, EyeOff, Check, AlertCircle, Loader2 } from 'lucide-react'
import { useConfigStore } from '@/stores/config.store'
import { useTheme } from '@/hooks/useTheme'
import { resetServiceCache } from '@/services/registry'
import { apiSessionService } from '@/services/api/api-session-service'

interface Props {
  isOpen: boolean
  onClose: () => void
}

type Tab = 'general' | 'api-keys' | 'about'

export function SettingsModal({ isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('general')

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>设置</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tab 栏 */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', padding: '0 24px' }}>
          {([
            ['general', '通用'],
            ['api-keys', 'API 密钥'],
            ['about', '关于'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                padding: '10px 16px',
                fontSize: 13,
                color: activeTab === id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                borderBottom: activeTab === id ? '2px solid var(--color-accent)' : '2px solid transparent',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'api-keys' && <ApiKeysTab />}
          {activeTab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  )
}

function GeneralTab() {
  const { useServerApi, serverApiUrl, setUseServerApi, setServerApiUrl } = useConfigStore()
  const { theme, setTheme } = useTheme()

  const handleModeChange = (useServer: boolean) => {
    setUseServerApi(useServer)
    resetServiceCache()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 运行模式 */}
      <SettingGroup label="运行模式">
        <RadioOption
          checked={!useServerApi}
          onChange={() => handleModeChange(false)}
          label="Mock 模式"
          description="使用内置示例数据，无需配置 API Key"
        />
        <RadioOption
          checked={useServerApi}
          onChange={() => handleModeChange(true)}
          label="Real 模式"
          description="连接真实 API 服务器，使用 Claude + Tushare"
        />
      </SettingGroup>

      {/* API 服务器地址 */}
      {useServerApi && (
        <SettingGroup label="API 服务器地址">
          <input
            className="input"
            value={serverApiUrl}
            onChange={e => setServerApiUrl(e.target.value)}
            placeholder="http://localhost:3001"
          />
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Real 模式下所有请求发送到此地址
          </p>
        </SettingGroup>
      )}

      {/* 主题 */}
      <SettingGroup label="主题">
        <div style={{ display: 'flex', gap: 12 }}>
          {(['dark', 'light'] as const).map(t => (
            <RadioOption
              key={t}
              checked={theme === t}
              onChange={() => setTheme(t)}
              label={t === 'dark' ? '深色' : '浅色'}
            />
          ))}
        </div>
      </SettingGroup>

      {/* 清除数据 */}
      <SettingGroup label="危险区域">
        <button
          className="btn btn-danger btn-sm"
          onClick={() => {
            if (confirm('确定清除所有本地数据？此操作不可撤销。')) {
              localStorage.clear()
              window.location.reload()
            }
          }}
        >
          清除所有数据
        </button>
      </SettingGroup>
    </div>
  )
}

function ApiKeysTab() {
  const {
    anthropicApiKey, setApiKey,
    tushareToken, setTushareToken,
    dailyTokenBudget, setDailyTokenBudget,
  } = useConfigStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ApiKeyInput
        label="Anthropic API Key"
        value={anthropicApiKey}
        onChange={setApiKey}
        placeholder="sk-ant-..."
        validateFn={validateAnthropicKey}
        hint="密钥仅存储在本地浏览器，不会发送给第三方"
      />

      <ApiKeyInput
        label="Tushare Pro Token"
        value={tushareToken}
        onChange={setTushareToken}
        placeholder="输入 Tushare Token"
        validateFn={validateTushareToken}
      />

      <SettingGroup label="Token 预算（每日）">
        <input
          className="input"
          type="number"
          value={dailyTokenBudget}
          onChange={e => setDailyTokenBudget(Number(e.target.value))}
          min={0}
          step={100000}
        />
        <TokenUsageBar />
      </SettingGroup>
    </div>
  )
}

function AboutTab() {
  return (
    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
      <h3 style={{ fontSize: 16, color: 'var(--color-text-primary)', marginBottom: 12 }}>
        AimeCode
      </h3>
      <p>面向金融从业者的 AI 数据分析助手</p>
      <p style={{ marginTop: 12 }}>版本：0.1.0-dev</p>
      <p>模型：Claude Sonnet 4.6</p>
      <p>数据源：Tushare Pro</p>
    </div>
  )
}

// ── 子组件 ──────────────────────────────────────────────────

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 8, display: 'block' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function RadioOption({ checked, onChange, label, description }: {
  checked: boolean; onChange: () => void; label: string; description?: string
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
      <input type="radio" checked={checked} onChange={onChange} style={{ marginTop: 2 }} />
      <div>
        <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{label}</span>
        {description && (
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{description}</p>
        )}
      </div>
    </label>
  )
}

function ApiKeyInput({ label, value, onChange, placeholder, validateFn, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; validateFn?: (key: string) => Promise<string | true>;
  hint?: string
}) {
  const [visible, setVisible] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<string | true | null>(null)

  const handleValidate = async () => {
    if (!value || !validateFn) return
    setValidating(true)
    try {
      const result = await validateFn(value)
      setValidationResult(result)
    } catch (err: any) {
      setValidationResult(err.message || '验证失败')
    }
    setValidating(false)
  }

  return (
    <SettingGroup label={label}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input input-password"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => { onChange(e.target.value); setValidationResult(null) }}
          placeholder={placeholder}
          style={{ flex: 1 }}
        />
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        {validateFn && (
          <button className="btn btn-secondary btn-sm" onClick={handleValidate} disabled={!value || validating}>
            {validating ? <Loader2 size={14} className="animate-spin" /> : '验证'}
          </button>
        )}
      </div>
      {validationResult === true && (
        <p style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Check size={12} /> 验证通过
        </p>
      )}
      {typeof validationResult === 'string' && (
        <p style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertCircle size={12} /> {validationResult}
        </p>
      )}
      {hint && (
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>ⓘ {hint}</p>
      )}
    </SettingGroup>
  )
}

function TokenUsageBar() {
  // 简化版 — 从 config store 读取已用量
  const { dailyTokensUsed, dailyTokenBudget } = useConfigStore()
  const pct = dailyTokenBudget > 0 ? (dailyTokensUsed / dailyTokenBudget * 100) : 0
  const color = pct > 90 ? 'var(--color-error)' : pct > 70 ? 'var(--color-warning)' : 'var(--color-accent)'

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        今日已用: {dailyTokensUsed.toLocaleString()} / {dailyTokenBudget.toLocaleString()} ({pct.toFixed(1)}%)
      </p>
      <div className="progress-bar" style={{ marginTop: 4 }}>
        <div className="progress-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
    </div>
  )
}

// ── 验证函数 ─────────────────────────────────────────────────

async function validateAnthropicKey(key: string): Promise<string | true> {
  if (!key.startsWith('sk-ant-')) {
    return 'Key 格式不正确，应以 sk-ant- 开头'
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    if (res.ok || res.status === 200) return true
    if (res.status === 401) return 'API Key 无效或已过期'
    if (res.status === 429) return true // 限流但 key 有效
    return `验证返回 ${res.status}`
  } catch {
    return '网络错误，无法连接 Anthropic API'
  }
}

async function validateTushareToken(token: string): Promise<string | true> {
  try {
    const res = await fetch('https://api.tushare.pro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_name: 'trade_cal',
        token,
        params: { start_date: '20240101', end_date: '20240102' },
      }),
    })
    const json = await res.json()
    if (json.code === 0) return true
    if (json.code === -2001) return 'Token 无效或已过期'
    return `Tushare 返回错误: ${json.msg}`
  } catch {
    return '网络错误，无法连接 Tushare API'
  }
}
```

---

## 4. 服务状态指示器

文件路径：`src/components/StatusIndicator.tsx`

```typescript
import { useState, useEffect } from 'react'
import { useConfigStore } from '@/stores/config.store'
import { apiSessionService } from '@/services/api/api-session-service'

type Status = 'connected' | 'disconnected' | 'mock'

export function StatusIndicator() {
  const { useServerApi } = useConfigStore()
  const [status, setStatus] = useState<Status>(useServerApi ? 'disconnected' : 'mock')

  useEffect(() => {
    if (!useServerApi) {
      setStatus('mock')
      return
    }

    let cancelled = false

    const check = async () => {
      try {
        await apiSessionService.checkHealth()
        if (!cancelled) setStatus('connected')
      } catch {
        if (!cancelled) setStatus('disconnected')
      }
    }

    check()
    const interval = setInterval(check, 30_000) // 每 30s 检查

    return () => { cancelled = true; clearInterval(interval) }
  }, [useServerApi])

  const color = {
    connected: 'var(--color-success)',
    disconnected: 'var(--color-error)',
    mock: 'var(--color-text-tertiary)',
  }[status]

  const label = {
    connected: '服务器在线',
    disconnected: '服务器离线',
    mock: 'Mock 模式',
  }[status]

  return (
    <div title={label} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: color,
        boxShadow: status === 'connected' ? `0 0 6px ${color}` : undefined,
      }} />
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</span>
    </div>
  )
}
```

---

## 5. 集成陷阱

| # | 问题 | 解决方案 |
|---|---|---|
| T1 | Anthropic API 验证时 CORS 阻止浏览器直连 | 使用 `anthropic-dangerous-direct-browser-access: true` header |
| T2 | Tushare API 无 CORS 限制（任何 Origin 可调） | 直接 fetch 即可 |
| T3 | 密码框自动填充覆盖 API Key | 用 `autoComplete="off"` + `name="aimecode-key"` 避免浏览器自动填充 |
| T4 | localStorage 在隐私模式下容量受限 | catch setItem 错误，提示用户 |
| T5 | 切换 Mock/Real 时进行中的流未中止 | `resetServiceCache()` 内部调用 `abort()` |
| T6 | 验证请求被 429 但 key 实际有效 | 429 视为验证通过（限流 = key 合法） |
| T7 | Token 预算仅在前端计算 | M2 阶段用前端 store 记录，M4+ 迁移到后端 |
