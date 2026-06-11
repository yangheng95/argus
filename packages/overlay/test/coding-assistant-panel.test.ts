import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const REPO = path.resolve(ROOT, "../..")

function readOverlay(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function readRepo(rel: string): string {
  return readFileSync(path.join(REPO, rel), "utf8")
}

test("coding assistant activity selects an independent session in the shared message panel", () => {
  const html = readOverlay("src/index.html")
  const main = readOverlay("src/main.tsx")
  const icons = readOverlay("src/components/Icon.tsx")
  const service = readOverlay("src/services/coding-assistant.ts")
  const chat = readOverlay("src/services/chat.ts")
  const en = readOverlay("src/i18n/en-US.json")
  const zh = readOverlay("src/i18n/zh-CN.json")

  expect(html).toContain('id="chatMessagePane"')
  expect(html).toContain('id="chatScroll"')
  expect(html).toContain('id="solidChatComposer"')
  expect(html).toContain('id="centerWorkbenchWorkflow"')
  expect(html).toContain('id="centerWorkbenchInspector"')
  expect(html).toContain('id="centerWorkbenchNotifications"')
  expect(html).toContain('id="leftPanelAssistant"')
  expect(html).toContain('id="codingAssistantSessionListPanel"')
  expect(html).not.toContain('id="centerWorkbenchAssistant"')
  expect(html).not.toContain('id="solidCodingAssistantMount"')
  expect(html).not.toContain('id="chatPluginPane"')
  expect(html).not.toContain('id="chatPluginOutlet"')
  expect(html).not.toContain('id="chatTuiPane"')
  expect(html).not.toContain('id="solidTuiHostMount"')

  expect(main).toContain(
    'type CenterWorkbenchPanel = "workflow" | "inspector" | "notifications" | "explorer" | "diff" | "browser" | "file"',
  )
  expect(main).toContain('type RightActivity = Exclude<CenterWorkbenchPanel, "file">')
  expect(main).toContain('type LeftActivity = "tasks" | "assistant" | "memory" | "skill" | "mcp"')
  expect(main).toContain(
    'id: "assistant", icon: "message", labelKey: "coding_assistant.title", tooltipKey: "activity.tooltip.assistant"',
  )
  expect(main).toContain('setSelectedLeftActivity("assistant")')
  expect(main).toContain('openCenterWorkbenchPanel("workflow")')
  expect(main).toContain("abortCodingAssistantActivation()")
  expect(main).toContain('if (isCodingAssistantSource()) void selectTask("")')
  expect(main).toContain('isCodingAssistantSource() ? t("chat.assistant_title") : t("chat.title")')
  expect(main).toContain("<CodingAssistantSessionList")
  expect(main).toContain("activateCodingAssistantSessionList")
  expect(main).toContain("loadCodingAssistantSessions({ signal: controller.signal })")
  expect(main).toContain("selectCodingAssistantSession({ sessionID: session.id })")
  expect(main).toContain("createCodingAssistantSession()")
  expect(main).not.toContain('document.getElementById("solidCodingAssistantMount")')
  expect(main).not.toContain('assistant: document.getElementById("centerWorkbenchAssistant")')
  expect(service).toContain("export async function loadCodingAssistantSessions")
  expect(service).toContain("codingAssistantSessionsPath({ limit: 30, append })")
  expect(service).toContain('apiJson("coding/session", {')
  expect(service).toContain("return selectCodingAssistantSession({ sessionID: sessionIDFromResponse(response), signal: options.signal })")
  expect(service).toContain("assertNotAborted(options.signal)")
  expect(service).toContain('setBoardStore("selectedSource", source)')
  expect(service).toContain("startSSE(source)")
  expect(main).toContain("render(() => <Conversation container={chatScroll} />, chatScroll)")
  expect(main).toContain("<ChatComposer")
  expect(main).toContain("panelMessage(text, attachments")
  expect(main).toContain('composerDraftKey("session", sessionID)')
  expect(chat).toContain("session/${encodeURIComponent(sessionID)}/prompt_async")
  expect(chat).toContain("activeSessionID()")
  expect(main).not.toContain("overlayRightActivityPlugins")
  expect(main).not.toContain("PluginPanel")
  expect(main).not.toContain("coding-agent-tui")
  expect(main).not.toContain("TuiHostPanel")

  expect(icons).toContain('| "message"')
  expect(icons).toContain("message: { component: MessageSquare }")
  expect(en).toContain('"coding_assistant.title": "Coding Assistant"')
  expect(zh).toContain('"coding_assistant.title": "Coding Assistant"')
  expect(en).toContain('"chat.assistant_title": "Assistant"')
  expect(zh).toContain('"chat.assistant_title": "Assistant"')
})

test("retired embedded TUI plugin is absent from overlay packaging and source", () => {
  const overlayPackage = readOverlay("package.json")
  const activityCss = readOverlay("src/styles/surfaces/activity.css")
  const build = readRepo("packages/opencorvus/script/build.ts")
  const buildLocal = readRepo("packages/opencorvus/script/build.local.ts")
  const opencorvusPackage = readRepo("packages/opencorvus/package.json")
  const engineSql = readRepo("packages/opencorvus/src/engine/engine.sql.ts")

  for (const source of [overlayPackage, activityCss, build, buildLocal, opencorvusPackage, engineSql]) {
    expect(source).not.toContain("@opencorvus-ai/coding-agent-tui")
    expect(source).not.toContain("coding-agent-tui")
    expect(source).not.toContain("coding-agent-tui-worker")
    expect(source).not.toContain("opencorvus-tui-runtime")
    expect(source).not.toContain("embedded-worker")
    expect(source).not.toContain("@opencorvus-ai/tui-app")
    expect(source).not.toContain("coding_agent_tui")
  }

  expect(activityCss).not.toContain(".tui-host")
  expect(overlayPackage).not.toContain("generate-overlay-plugins")
  expect(existsSync(path.join(REPO, "packages/coding-agent-tui"))).toBe(false)
  expect(existsSync(path.join(REPO, "packages/tui-app"))).toBe(false)
  expect(existsSync(path.join(ROOT, "src/generated/overlay-plugins.ts"))).toBe(false)
  expect(existsSync(path.join(ROOT, "script/generate-overlay-plugins.ts"))).toBe(false)
})
