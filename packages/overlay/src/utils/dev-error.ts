/**
 * Dev Error Overlay — 在 overlay UI 顶层弹出错误面板。
 *
 * 设计约束（per CLAUDE.md "no fallback, fix at source"）:
 *
 * 1. **生产模式 no-op**: import.meta.env.DEV=false 时只 console.warn/error，
 *    不创建任何 DOM。Overlay 只在开发期出现。
 * 2. **dedup**: 同一个 (level, location, message) 只创建一个 DOM 节点。
 *    后续调用累加 count，最多触发一次 DOM 更新。
 * 3. **ring buffer 上限**: MAX_DEV_ENTRIES=200。超出时移除最早的（含 DOM）。
 * 4. **事件委托**: 列表容器一个 click listener，不是每条 entry 一个。
 *    避免 SSE 高频 fire 时累积成千上万个 closure。
 * 5. **textContent**: 不用 innerHTML（避免 HTML parser 开销 + XSS 表面）。
 * 6. **增量计数**: errorCount/warnCount 维护差值，updateBadge 不再做 O(n) filter。
 *
 * 历史背景: 此 panel 之前因调用方在 createMemo 内部触发副作用 +
 * 自身没有上限/dedup, 导致长任务运行后 DOM 节点累积到数万个，
 * overlay 整体卡顿。修复双管齐下: 调用方移出 memo 副作用 + 此处加固。
 * 详见 specs/实施进度对照.md "性能修复 2026-04-10"。
 */

interface DevEntry {
  level: "warn" | "error"
  message: string
  location: string
  timestamp: number
  count: number
  el: HTMLElement | null
}

const MAX_DEV_ENTRIES = 200
const isDev: boolean = !!(import.meta as any).env?.DEV

// Dedup map keyed by `${level}:${location}:${message}` → entry
// + ordered list for ring-buffer eviction (oldest at index 0)
const entriesByKey = new Map<string, DevEntry>()
const orderedKeys: string[] = []

let errorCount = 0
let warnCount = 0
let collapsed = false

let containerEl: HTMLElement | null = null
let listEl: HTMLElement | null = null
let badgeEl: HTMLElement | null = null

// ── Container setup (lazy, only in dev) ──

function ensureContainer(): { container: HTMLElement; list: HTMLElement; badge: HTMLElement } {
  if (containerEl && listEl && badgeEl) {
    return { container: containerEl, list: listEl, badge: badgeEl }
  }

  containerEl = document.createElement("div")
  containerEl.id = "devErrorOverlay"

  // Build header DOM via API (no innerHTML)
  const header = document.createElement("div")
  header.className = "dev-error-header"
  const title = document.createElement("span")
  title.className = "dev-error-title"
  title.textContent = "Dev Errors"
  badgeEl = document.createElement("span")
  badgeEl.className = "dev-error-badge"
  badgeEl.textContent = "0"
  const clearBtn = document.createElement("button")
  clearBtn.className = "dev-error-clear"
  clearBtn.title = "Clear all"
  clearBtn.textContent = "\u2715"
  header.append(title, badgeEl, clearBtn)

  listEl = document.createElement("div")
  listEl.className = "dev-error-list"

  containerEl.append(header, listEl)

  // Inject styles once
  if (!document.getElementById("devErrorStyles")) {
    const style = document.createElement("style")
    style.id = "devErrorStyles"
    style.textContent = DEV_ERROR_CSS
    document.head.appendChild(style)
  }

  document.body.appendChild(containerEl)

  // Header click → toggle collapse (skip when target is the clear button)
  header.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".dev-error-clear")) return
    collapsed = !collapsed
    containerEl!.classList.toggle("dev-error--collapsed", collapsed)
  })

  // Clear all
  clearBtn.addEventListener("click", () => {
    entriesByKey.clear()
    orderedKeys.length = 0
    errorCount = 0
    warnCount = 0
    listEl!.replaceChildren()
    updateBadge()
  })

  // Event delegation: a single click handler for all dismiss buttons.
  // Avoids attaching one closure per entry, which previously leaked.
  listEl.addEventListener("click", (e) => {
    const dismissBtn = (e.target as HTMLElement).closest(".dev-error-dismiss")
    if (!dismissBtn) return
    const entryEl = dismissBtn.closest(".dev-error-entry") as HTMLElement | null
    if (!entryEl) return
    const key = entryEl.dataset.key
    if (key) removeEntry(key)
  })

  return { container: containerEl, list: listEl, badge: badgeEl }
}

// ── Entry creation (DOM API, no innerHTML) ──

function createEntryDom(entry: DevEntry, key: string): HTMLElement {
  const el = document.createElement("div")
  el.className = `dev-error-entry dev-error-entry--${entry.level}`
  el.dataset.key = key

  const levelSpan = document.createElement("span")
  levelSpan.className = "dev-error-level"
  levelSpan.textContent = entry.level.toUpperCase()

  const timeSpan = document.createElement("span")
  timeSpan.className = "dev-error-time"
  timeSpan.textContent = new Date(entry.timestamp).toLocaleTimeString()

  const locSpan = document.createElement("span")
  locSpan.className = "dev-error-loc"
  locSpan.textContent = entry.location

  const countSpan = document.createElement("span")
  countSpan.className = "dev-error-count"
  countSpan.textContent = entry.count > 1 ? `\u00d7${entry.count}` : ""

  const msgDiv = document.createElement("div")
  msgDiv.className = "dev-error-msg"
  msgDiv.textContent = entry.message

  const dismissBtn = document.createElement("button")
  dismissBtn.className = "dev-error-dismiss"
  dismissBtn.title = "Dismiss"
  dismissBtn.textContent = "\u00d7"

  el.append(levelSpan, timeSpan, locSpan, countSpan, msgDiv, dismissBtn)
  return el
}

function updateEntryDom(entry: DevEntry): void {
  const el = entry.el
  if (!el) return
  const countEl = el.querySelector(".dev-error-count") as HTMLElement | null
  if (countEl) countEl.textContent = entry.count > 1 ? `\u00d7${entry.count}` : ""
  const timeEl = el.querySelector(".dev-error-time") as HTMLElement | null
  if (timeEl) timeEl.textContent = new Date(entry.timestamp).toLocaleTimeString()
}

function removeEntry(key: string): void {
  const entry = entriesByKey.get(key)
  if (!entry) return
  if (entry.level === "error") errorCount = Math.max(0, errorCount - 1)
  else warnCount = Math.max(0, warnCount - 1)
  entry.el?.remove()
  entriesByKey.delete(key)
  const idx = orderedKeys.indexOf(key)
  if (idx >= 0) orderedKeys.splice(idx, 1)
  updateBadge()
}

function updateBadge(): void {
  if (!badgeEl || !containerEl) return
  const total = errorCount + warnCount
  badgeEl.textContent = errorCount > 0 ? String(errorCount) : String(warnCount)
  badgeEl.className = `dev-error-badge ${errorCount > 0 ? "dev-error-badge--error" : "dev-error-badge--warn"}`
  containerEl.classList.toggle("dev-error--empty", total === 0)
}

// ── Push entry with dedup + ring-buffer eviction ──

function pushEntry(level: "warn" | "error", location: string, message: string): void {
  const key = `${level}:${location}:${message}`
  const existing = entriesByKey.get(key)

  if (existing) {
    // Dedup hit: bump count + timestamp, refresh DOM in place. No new node.
    existing.count += 1
    existing.timestamp = Date.now()
    updateEntryDom(existing)
    return
  }

  // New entry
  const entry: DevEntry = {
    level,
    message,
    location,
    timestamp: Date.now(),
    count: 1,
    el: null,
  }
  entriesByKey.set(key, entry)
  orderedKeys.push(key)
  if (level === "error") errorCount += 1
  else warnCount += 1

  // Ring-buffer eviction — drop oldest when over the cap
  while (orderedKeys.length > MAX_DEV_ENTRIES) {
    const oldKey = orderedKeys.shift()
    if (!oldKey) break
    const oldEntry = entriesByKey.get(oldKey)
    if (oldEntry) {
      if (oldEntry.level === "error") errorCount = Math.max(0, errorCount - 1)
      else warnCount = Math.max(0, warnCount - 1)
      oldEntry.el?.remove()
      entriesByKey.delete(oldKey)
    }
  }

  // Create DOM lazily — only attach if container exists or we're going to create one
  const { list } = ensureContainer()
  entry.el = createEntryDom(entry, key)
  list.appendChild(entry.el)
  updateBadge()
}

// ── Public API ──

export function devWarn(location: string, message: string): void {
  // Always log to console (works in both dev and prod, gives stack traces)
  console.warn(`[${location}] ${message}`)
  // Skip DOM in production builds
  if (!isDev) return
  pushEntry("warn", location, message)
}

export function devError(location: string, message: string): void {
  console.error(`[${location}] ${message}`)
  if (!isDev) return
  pushEntry("error", location, message)
  // Auto-uncollapse on error so it surfaces immediately
  if (collapsed && containerEl) {
    collapsed = false
    containerEl.classList.remove("dev-error--collapsed")
  }
}

// ── Styles ──

const DEV_ERROR_CSS = `
#devErrorOverlay {
  position: fixed;
  bottom: 8px;
  right: 8px;
  z-index: 99999;
  width: 420px;
  max-height: 50vh;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  overflow: hidden;
  font-family: var(--mono, "Consolas", "Monaco", monospace);
  font-size: 11px;
  background: var(--menu-panel-bg);
  border: var(--oc-border-width) solid color-mix(in srgb, var(--bad) 44%, var(--border));
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}
#devErrorOverlay.dev-error--empty { display: none; }
#devErrorOverlay.dev-error--collapsed .dev-error-list { display: none; }

.dev-error-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--bad-dim);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.dev-error-title {
  font-weight: 600;
  color: var(--bad);
  flex: 1;
}
.dev-error-badge {
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;
  border: var(--oc-border-width) solid transparent;
}
.dev-error-badge--error {
  background: var(--bad-dim);
  border-color: color-mix(in srgb, var(--bad) 42%, transparent);
  color: var(--bad);
}
.dev-error-badge--warn {
  background: var(--warn-dim);
  border-color: color-mix(in srgb, var(--warn) 42%, transparent);
  color: var(--warn);
}
.dev-error-clear {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}
.dev-error-clear:hover { color: var(--text-strong); }

.dev-error-list {
  overflow-y: auto;
  max-height: calc(50vh - 32px);
  padding: 2px 0;
}

.dev-error-entry {
  position: relative;
  padding: 4px 24px 4px 8px;
  border-bottom: var(--oc-border-width) solid var(--divider-soft);
}
.dev-error-entry--error { border-left: calc(3px * var(--ui-scale)) solid var(--bad); }
.dev-error-entry--warn { border-left: calc(3px * var(--ui-scale)) solid var(--warn); }

.dev-error-level {
  font-weight: 700;
  margin-right: 4px;
}
.dev-error-entry--error .dev-error-level { color: var(--bad); }
.dev-error-entry--warn .dev-error-level { color: var(--warn); }

.dev-error-time {
  color: var(--text-muted);
  margin-right: 6px;
}
.dev-error-loc {
  color: var(--info);
  word-break: break-all;
}
.dev-error-count {
  color: var(--warn);
  font-weight: 700;
  margin-left: 4px;
}
.dev-error-msg {
  color: var(--text);
  margin-top: 2px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
.dev-error-dismiss {
  position: absolute;
  top: 3px;
  right: 4px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0;
}
.dev-error-dismiss:hover { color: var(--text-strong); }
`
