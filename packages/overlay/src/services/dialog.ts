// ── Dialog Service ──
// Manages dialog open/close and config tab switching.
// Uses direct imports.
// imports as of Phase 4 cleanup.

import { boardStore, loadBoard, activeTaskID } from "../store/board"
import { appStore } from "../store/app"
import { loadSettingsInfo } from "./init"
import { apiJson } from "./api"
import { selectedTaskDirectory } from "../store/board"
import { t } from "../utils/i18n"
import { renderMarkdown, escapeHtml } from "../utils/markdown"
import { describeToolPart } from "../utils/tool"
import { dialogStore, setDialogStore, CONFIG_SECTIONS, type ConfigDialogTab } from "../store/dialog"
import { panelMessage } from "./chat"
import { OPENCORVUS_VERSION_LABEL, OVERLAY_VERSION } from "../utils/version"
import { clampConfigSidebarWidth, configSidebarResizeBounds } from "../utils/config-sidebar-resizer"
import { currentUIScale } from "../utils/layout-tokens"

let sessionDialogSeq = 0
const CONFIG_DIALOG_TABS = new Set<ConfigDialogTab>(CONFIG_SECTIONS.map((section) => section.id))

const CONFIG_SECTION_TARGETS: Record<string, { tab: ConfigDialogTab; elementID?: string }> = {
  skill: { tab: "skill", elementID: "skillList" },
  "skill-market": { tab: "skill-market", elementID: "skillMarketList" },
  mcp: { tab: "mcp", elementID: "mcpList" },
}

function normalizeConfigTab(tabName: string): ConfigDialogTab {
  return CONFIG_DIALOG_TABS.has(tabName as ConfigDialogTab) ? (tabName as ConfigDialogTab) : "general"
}

function renderSessionToolChip(part: any): string {
  const display = describeToolPart(part, selectedTaskDirectory())
  if (!display) return ""
  const statusAttr = display.status ? ` data-status="${escapeHtml(display.status)}"` : ""
  const detail = display.detail ? `<span class="tool-detail">${escapeHtml(display.detail)}</span>` : ""
  const status = display.statusLabel
    ? `<span class="tool-status" data-status="${escapeHtml(display.status || "pending")}" title="${escapeHtml(display.statusLabel)}">${escapeHtml(display.statusLabel)}</span>`
    : ""
  return `<div class="msg-tool"${statusAttr}>
    <span class="tool-icon">${escapeHtml(display.icon)}</span>
    <span class="tool-name">${escapeHtml(display.label)}</span>
    ${detail}
    ${status}
  </div>`
}

// ── Public API ──

/**
 * Open the channel configuration dialog.
 * ChannelsPanel.tsx handles its own inline editing, so this function
 * simply opens the config dialog and switches to the channel tab.
 */
export async function openChannelSettings(_channelID?: string): Promise<void> {
  openConfigDialog("channel")
}

/**
 * Switch the active tab in the config sidebar.
 */
export function switchConfigTab(tabName: string): void {
  setDialogStore("config", "activeTab", normalizeConfigTab(tabName))
}

/**
 * Focus a named config section inside the config dialog.
 */
export function focusConfigSection(name: string): void {
  if (!name) return
  const target = CONFIG_SECTION_TARGETS[name]
  switchConfigTab(target?.tab ?? name)
  if (name === "channel") {
    queueMicrotask(() => {
      const channelList = document.getElementById("channelList") as HTMLElement | null
      channelList?.scrollTo?.({ top: 0 })
    })
  }
  if (target?.elementID) {
    queueMicrotask(() => {
      const element = document.getElementById(target.elementID!) as HTMLElement | null
      element?.scrollIntoView?.({ block: "start" })
    })
  }
}

/**
 * Populate the About panel runtime grid with server/platform info.
 */
export function renderAboutVersion(): void {
  const config = appStore.config
  const chatVersion = document.getElementById("chatVersion")
  if (chatVersion) {
    const connected = config !== null
    const text = connected
      ? t("version.overlay", { version: OVERLAY_VERSION })
      : `${t("version.overlay", { version: OVERLAY_VERSION })} / ${t("version.core_unknown")}`
    chatVersion.textContent = OPENCORVUS_VERSION_LABEL
    chatVersion.title = text
  }
}

/**
 * Open the config dialog, optionally scrolling to a specific section.
 * Pre-loads config info and refreshes the about panel.
 */
export function openConfigDialog(
  section?: string,
  options: { agentModelsScope?: "project" | "session"; sessionID?: string } = {},
): void {
  setDialogStore("config", {
    agentModelsScope: options.agentModelsScope ?? "project",
    agentModelsSessionID: options.sessionID ?? null,
  })
  setDialogStore("config", "open", true)
  void loadSettingsInfo().then(() => renderAboutVersion())

  if (section) {
    focusConfigSection(section)
  }
}

export function openSessionAgentModels(sessionID: string): void {
  openConfigDialog("agent-models", { agentModelsScope: "session", sessionID })
}

export function closeConfigDialog(): void {
  setDialogStore("config", "open", false)
}

export function setConfigSidebarWidth(width: number): void {
  if (!Number.isFinite(width) || width <= 0) return
  setDialogStore("config", "sidebarWidth", clampConfigSidebarWidth(width, configSidebarResizeBounds(currentUIScale())))
}

export function openGoalDialog(goalID = "", title = "", acceptance = ""): void {
  setDialogStore("goal", {
    open: true,
    goalID,
    title,
    acceptance,
    saving: false,
  })
}

function resetGoalDialog(): void {
  setDialogStore("goal", {
    open: false,
    goalID: "",
    title: "",
    acceptance: "",
    saving: false,
  })
}

export function closeGoalDialog(): void {
  resetGoalDialog()
}

export async function saveGoalDialog(): Promise<void> {
  if (dialogStore.goal.saving || !activeTaskID()) return
  const goalID = dialogStore.goal.goalID.trim()
  const title = dialogStore.goal.title.trim()
  const acceptanceText = dialogStore.goal.acceptance.trim()
  if (!title) return

  setDialogStore("goal", "saving", true)
  try {
    const taskID = activeTaskID() || undefined
    if (goalID) {
      const criterion = acceptanceText || "The requested change is implemented and acceptance checks pass."
      const acceptanceSpec = {
        id: `acc-operator-${goalID}-${Date.now()}`,
        source_requirement_id: "operator",
        goal_id: goalID,
        title: title.slice(0, 80),
        severity: "essential",
        scorers: [
          {
            type: "llm_judge",
            name: "operator-acceptance",
            criteria: criterion,
            inputs: ["acceptance_summary", "changed_files"],
          },
        ],
      }
      await panelMessage(`Update goal ${goalID}.`, {
        goalID,
        description: title,
        acceptance_specs: [acceptanceSpec],
        taskID,
      })
    } else {
      const payload = acceptanceText ? `/goal ${title}\nAcceptance: ${acceptanceText}` : `/goal ${title}`
      await panelMessage(payload, { taskID })
    }
    resetGoalDialog()
    await loadBoard({ sync: true })
  } catch (err) {
    console.error("Failed to save goal", err)
    setDialogStore("goal", "saving", false)
  }
}

/**
 * Open the Executor Session dialog, loading messages for a given session.
 * Shared by the sidebar Goals panel (GoalWorkflowGroup "Open session" button)
 * and the main conversation (Card step body) so the render logic isn't
 * duplicated across surfaces.
 */
export async function openBuildSessionDialog(sessionID: string, title: string): Promise<void> {
  const openToken = ++sessionDialogSeq
  setDialogStore("session", {
    open: true,
    title: title || "Build Session",
    bodyHtml: '<p class="empty-hint">Loading…</p>',
  })
  try {
    const messages: any[] = await apiJson(`session/${sessionID}/message`)
    if (!messages || messages.length === 0) {
      if (sessionDialogSeq === openToken) {
        setDialogStore("session", "bodyHtml", '<p class="empty-hint">No messages yet.</p>')
      }
      return
    }
    const html = messages
      .map((msg: any) => {
        const role: string = msg.info?.role ?? msg.role ?? "unknown"
        const parts: any[] = Array.isArray(msg.parts) ? msg.parts : []
        const textParts = parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => `<div class="session-msg-text md-content">${renderMarkdown(p.text)}</div>`)
          .join("")
        const toolParts = parts
          .filter((p) => p.type === "tool-invocation" || p.type === "tool-call")
          .map((p) => renderSessionToolChip(p))
          .filter(Boolean)
          .join("")
        if (!textParts && !toolParts) return ""
        return `<div class="session-msg" data-role="${escapeHtml(role)}">
          <span class="session-msg-role">${escapeHtml(role)}</span>
          ${textParts}${toolParts}
        </div>`
      })
      .filter(Boolean)
      .join("")
    if (sessionDialogSeq === openToken) {
      const bodyHtml = html ? html : '<p class="empty-hint">No displayable messages.</p>'
      setDialogStore("session", "bodyHtml", bodyHtml)
    }
  } catch (e) {
    if (sessionDialogSeq === openToken) {
      setDialogStore(
        "session",
        "bodyHtml",
        `<p class="empty-hint">Failed to load session: ${escapeHtml(String(e))}</p>`,
      )
    }
  }
}

export function closeBuildSessionDialog(): void {
  sessionDialogSeq += 1
  setDialogStore("session", "open", false)
}
