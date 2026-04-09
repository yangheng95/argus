/**
 * Dev Error Overlay — 在 overlay UI 顶层弹出错误面板。
 *
 * 每条错误显示：严重级别、消息、代码位置（file:line）。
 * 纯 DOM 操作，不依赖 Solid，任何模块都可以调用。
 * 面板可折叠/展开，点击 × 清除单条，点击标题栏折叠。
 */

interface DevEntry {
  level: "warn" | "error";
  message: string;
  location: string; // e.g. "store/messages.ts:708"
  timestamp: number;
}

const entries: DevEntry[] = [];
let containerEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let badgeEl: HTMLElement | null = null;
let collapsed = false;

function ensureContainer(): { container: HTMLElement; list: HTMLElement; badge: HTMLElement } {
  if (containerEl && listEl && badgeEl) return { container: containerEl, list: listEl, badge: badgeEl };

  containerEl = document.createElement("div");
  containerEl.id = "devErrorOverlay";
  containerEl.innerHTML = `
    <div class="dev-error-header">
      <span class="dev-error-title">Dev Errors</span>
      <span class="dev-error-badge">0</span>
      <button class="dev-error-clear" title="Clear all">&#x2715;</button>
    </div>
    <div class="dev-error-list"></div>
  `;

  // Inject styles once
  if (!document.getElementById("devErrorStyles")) {
    const style = document.createElement("style");
    style.id = "devErrorStyles";
    style.textContent = DEV_ERROR_CSS;
    document.head.appendChild(style);
  }

  document.body.appendChild(containerEl);

  listEl = containerEl.querySelector(".dev-error-list") as HTMLElement;
  badgeEl = containerEl.querySelector(".dev-error-badge") as HTMLElement;

  // Header click → toggle collapse
  const header = containerEl.querySelector(".dev-error-header") as HTMLElement;
  header.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".dev-error-clear")) return;
    collapsed = !collapsed;
    containerEl!.classList.toggle("dev-error--collapsed", collapsed);
  });

  // Clear all
  const clearBtn = containerEl.querySelector(".dev-error-clear") as HTMLElement;
  clearBtn.addEventListener("click", () => {
    entries.length = 0;
    listEl!.innerHTML = "";
    badgeEl!.textContent = "0";
    containerEl!.classList.add("dev-error--empty");
  });

  return { container: containerEl, list: listEl, badge: badgeEl };
}

function renderEntry(entry: DevEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = `dev-error-entry dev-error-entry--${entry.level}`;

  const time = new Date(entry.timestamp).toLocaleTimeString();
  el.innerHTML = `
    <span class="dev-error-level">${entry.level.toUpperCase()}</span>
    <span class="dev-error-time">${time}</span>
    <span class="dev-error-loc">${escapeForHTML(entry.location)}</span>
    <div class="dev-error-msg">${escapeForHTML(entry.message)}</div>
    <button class="dev-error-dismiss" title="Dismiss">&times;</button>
  `;

  el.querySelector(".dev-error-dismiss")!.addEventListener("click", () => {
    const idx = entries.indexOf(entry);
    if (idx >= 0) entries.splice(idx, 1);
    el.remove();
    updateBadge();
  });

  return el;
}

function updateBadge() {
  const { badge, container } = ensureContainer();
  const errorCount = entries.filter(e => e.level === "error").length;
  const warnCount = entries.filter(e => e.level === "warn").length;
  badge.textContent = errorCount > 0 ? String(errorCount) : String(warnCount);
  badge.className = `dev-error-badge ${errorCount > 0 ? "dev-error-badge--error" : "dev-error-badge--warn"}`;
  container.classList.toggle("dev-error--empty", entries.length === 0);
}

function escapeForHTML(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Public API ──

export function devWarn(location: string, message: string) {
  const entry: DevEntry = { level: "warn", message, location, timestamp: Date.now() };
  entries.push(entry);
  const { list } = ensureContainer();
  list.appendChild(renderEntry(entry));
  updateBadge();
  // Also keep in console for stack traces
  console.warn(`[${location}] ${message}`);
}

export function devError(location: string, message: string) {
  const entry: DevEntry = { level: "error", message, location, timestamp: Date.now() };
  entries.push(entry);
  const { list } = ensureContainer();
  list.appendChild(renderEntry(entry));
  updateBadge();
  // Uncollapse on error
  if (collapsed) {
    collapsed = false;
    containerEl?.classList.remove("dev-error--collapsed");
  }
  console.error(`[${location}] ${message}`);
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
  background: rgba(20, 20, 24, 0.96);
  border: 1px solid rgba(255, 80, 80, 0.4);
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  pointer-events: auto;
}
#devErrorOverlay.dev-error--empty { display: none; }
#devErrorOverlay.dev-error--collapsed .dev-error-list { display: none; }

.dev-error-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: rgba(255, 60, 60, 0.15);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.dev-error-title {
  font-weight: 600;
  color: #ff6b6b;
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
  color: #fff;
}
.dev-error-badge--error { background: #d43f3f; }
.dev-error-badge--warn { background: #b8860b; }
.dev-error-clear {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}
.dev-error-clear:hover { color: #fff; }

.dev-error-list {
  overflow-y: auto;
  max-height: calc(50vh - 32px);
  padding: 2px 0;
}

.dev-error-entry {
  position: relative;
  padding: 4px 24px 4px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.dev-error-entry--error { border-left: 3px solid #d43f3f; }
.dev-error-entry--warn { border-left: 3px solid #b8860b; }

.dev-error-level {
  font-weight: 700;
  margin-right: 4px;
}
.dev-error-entry--error .dev-error-level { color: #ff6b6b; }
.dev-error-entry--warn .dev-error-level { color: #f0c040; }

.dev-error-time {
  color: #666;
  margin-right: 6px;
}
.dev-error-loc {
  color: #7cb3ff;
  word-break: break-all;
}
.dev-error-msg {
  color: #ccc;
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
  color: #666;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0;
}
.dev-error-dismiss:hover { color: #fff; }
`;
