import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

import {
  HOST_CAPABILITIES,
  __setHostTransportForTest,
  type HostTransport,
  type StreamHandlers,
} from "../src/services/host-transport"
import { submitMessage } from "../src/services/task"

const ROOT = path.resolve(import.meta.dir, "..")

function readOverlaySource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

afterEach(() => {
  __setHostTransportForTest(undefined)
})

test("submitMessage rejects its parent request when async stream hooks reject", async () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window
  ;(globalThis as typeof globalThis & { window?: unknown }).window = globalThis
  let handlers: StreamHandlers | undefined
  let closed = 0
  const transport: HostTransport = {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request() {
      throw new Error("request should not be used by the stream path")
    },
    openStream(_input, nextHandlers) {
      handlers = nextHandlers
      return {
        close() {
          closed += 1
        },
      }
    },
    async native() {
      throw new Error("native should not be used by the stream path")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }

  try {
    __setHostTransportForTest(transport)

    const request = submitMessage("hello", [], {
      onEvent: async () => {
        throw new Error("hook failed")
      },
    })

    handlers?.onOpen?.()
    handlers?.onEvent(JSON.stringify({ type: "progress" }))

    await expect(request).rejects.toThrow("hook failed")
    expect(closed).toBe(1)
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: unknown }).window
    } else {
      ;(globalThis as typeof globalThis & { window?: unknown }).window = previousWindow
    }
  }
})

test("overlay keeps the global unhandledrejection diagnostic but assigns known async owners", () => {
  const main = readOverlaySource("src/main.tsx")
  const board = readOverlaySource("src/store/board.ts")
  const sse = readOverlaySource("src/services/sse.ts")
  const task = readOverlaySource("src/services/task.ts")
  const browserPreview = readOverlaySource("src/components/BrowserPreviewPanel.tsx")
  const titlebar = readOverlaySource("src/components/titlebar/TitlebarMenubar.tsx")
  const workspaceLauncher = readOverlaySource("src/components/WorkspaceSplitLauncher.tsx")
  const windowControls = readOverlaySource("src/components/WindowControls.tsx")
  const cardHeadActions = readOverlaySource("src/hooks/use-card-head-actions.ts")
  const tauriTransport = readOverlaySource("src/services/tauri-transport.ts")
  const notify = readOverlaySource("src/services/notify.ts")
  const conversation = readOverlaySource("src/services/conversation.ts")
  const conversationAgentRail = readOverlaySource("src/components/ConversationAgentRail.tsx")
  const taskProgressBar = readOverlaySource("src/components/TaskProgressBar.tsx")
  const projectLedgerGroup = readOverlaySource("src/components/ProjectLedgerGroup.tsx")
  const notificationCenter = readOverlaySource("src/components/NotificationCenter.tsx")
  const missionList = readOverlaySource("src/components/MissionList.tsx")

  expect(main).toContain('"unhandledrejection"')
  expect(main).toContain('reportOverlayRuntimeError("window.unhandledrejection", event.reason)')
  expect(main).toContain("function runMainAsync")
  expect(main).not.toContain("void selectTask(")
  expect(main).not.toContain("void (async () =>")

  expect(board).toContain("function observeScheduledBoardLoad")
  expect(board).toContain('observeScheduledBoardLoad("retry"')
  expect(board).toContain('observeScheduledBoardLoad("queued"')
  expect(board).toContain('observeScheduledBoardLoad("debounced"')
  expect(board).not.toContain("void loadBoard(")

  expect(sse).toContain("function observeSseReconnect")
  expect(sse).not.toContain("void performSseReconnect")

  expect(task).toContain("observeStreamHook")
  expect(task).toContain("void Promise.resolve(hookResult).catch(rejectStream)")
  expect(task).toContain('void selectTask("").catch')

  expect(browserPreview).toContain("const refetchTargetFromPanel = () =>")
  expect(browserPreview).not.toContain("void refetchTarget()")

  expect(titlebar).toContain("function runTitlebarMenuAction")
  expect(titlebar).not.toContain("void props.onClick")
  expect(titlebar).not.toContain("void props.onChange")
  expect(titlebar).not.toContain(".finally(closeMenu)")

  expect(workspaceLauncher).toContain("function runWorkspaceLauncherAction")
  expect(workspaceLauncher).not.toContain("void props.onPrimaryClick")
  expect(workspaceLauncher).not.toContain("void props.onSelect")

  expect(windowControls).toContain("function runWindowControlAction")
  expect(windowControls).not.toContain("onMount(async")
  expect(windowControls).not.toContain("void handleMaximize")
  expect(windowControls).not.toContain("void handleClose")

  expect(cardHeadActions).toContain("function runCardHeadAction")
  expect(cardHeadActions).not.toContain("void (async () =>")

  expect(tauriTransport).toContain('closeWithReason("post-stream-unhandled-error")')

  expect(notify).toContain("function observeNotifyBackground")
  expect(notify).toContain('observeNotifyBackground("desktop notification dispatch"')
  expect(notify).toContain('observeNotifyBackground("dock badge projection"')
  expect(notify).toContain('observeNotifyBackground("tray attention projection"')
  expect(notify).not.toContain("void sendDesktopIfAllowed(")
  expect(notify).not.toContain("void setDockBadge(")
  expect(notify).not.toContain("void setTrayAttention(")

  expect(conversation).toContain("scheduled tail merge owner failed")
  expect(conversation).not.toContain("void run()\n")

  expect(conversationAgentRail).toContain("card scroll request failed")
  expect(taskProgressBar).toContain("goal card scroll request failed")

  expect(projectLedgerGroup).toContain("function runProjectAction")
  expect(projectLedgerGroup).not.toContain("void props.onCopyProject")
  expect(projectLedgerGroup).not.toContain("void props.onRenameProject")
  expect(projectLedgerGroup).not.toContain("void props.onDeleteProject")

  expect(notificationCenter).toContain("function runTaskNotificationAction")
  expect(notificationCenter).toContain("void activateTaskNotification(item).catch")

  expect(missionList).toContain("void Promise.resolve(props.onRenameMission")
  expect(missionList).not.toContain("void props.onRenameMission")
})
