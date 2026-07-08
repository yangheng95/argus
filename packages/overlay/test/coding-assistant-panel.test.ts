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

test("Coding Assistant chats are selected through Work Ledger and created through composer Chat mode", () => {
  const html = readOverlay("src/index.html")
  const main = readOverlay("src/main.tsx")
  const composer = readOverlay("src/components/ChatComposer.tsx")
  const workLedger = readOverlay("src/components/WorkLedger.tsx")
  const workLedgerService = readOverlay("src/services/work-ledger.ts")
  const chat = readOverlay("src/services/chat.ts")
  const en = readOverlay("src/i18n/en-US.json")
  const zh = readOverlay("src/i18n/zh-CN.json")

  expect(html).toContain('id="chatMessagePane"')
  expect(html).toContain('id="chatScroll"')
  expect(html).toContain('id="solidChatComposer"')
  expect(html).toContain('id="workLedgerPanel"')
  expect(html).not.toContain('id="leftPanelAssistant"')
  expect(html).not.toContain('id="codingAssistantSessionListPanel"')
  expect(html).not.toContain('id="btnCreateCodingAssistantSession"')

  expect(main).toContain("async function openWorkLedgerChat(row: WorkLedgerChatRow)")
  expect(main).toContain('runMainAsync("work-ledger.select-chat"')
  expect(main).toContain("await selectCodingAssistantSession({ sessionID: row.sessionID, directory: row.directory })")
  expect(main).toContain('const [composerMode, setComposerMode] = createSignal<ComposerMode>("chat")')
  expect(main).toContain("function assistantSubmitActive(): boolean")
  expect(main).toContain('return composerMode() === "chat" && !activeTaskID() && !activeSessionID()')
  expect(main).toContain("await createCodingAssistantSession({ directory: activeDirectory() })")
  expect(main).toContain("const result = await panelMessage(text, attachments, metadata)")
  expect(main).not.toContain("<CodingAssistantSessionList")
  expect(main).not.toContain("activateCodingAssistantSessionList")
  expect(main).not.toContain("openCodingAssistantLauncher")

  expect(composer).toContain('triggerDataUI="composer-mode-selector"')
  expect(composer).toContain("<SelectControl<ComposerModeOption>")
  expect(workLedger).toContain('data-kind={row().kind}')
  expect(workLedger).toContain('if (current.kind === "chat") return props.onStopChat(current)')
  expect(workLedgerService).toContain('kind: "chat"')
  expect(workLedgerService).toContain("status: WorkLedgerChatStatus")
  expect(chat).toContain("session/${encodeURIComponent(sessionID)}/prompt_async")
  expect(chat).toContain('const directory = conversationSourceDirectory({ kind: "session", id: sessionID })')

  expect(en).toContain('"coding_assistant.title": "Coding Assistant"')
  expect(zh).toContain('"coding_assistant.title": "Coding Assistant"')
  expect(en).toContain('"chat.panel_title": "Chat"')
  expect(zh).toContain('"chat.panel_title": "Chat"')
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
