import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

test("coding assistant panel is project-bound and uses canonical session transport", () => {
  const component = readText("src/components/CodingAssistantPanel.tsx")
  const service = readText("src/services/coding-assistant.ts")
  const transcript = readText("src/services/coding-assistant-transcript.ts")
  const tabs = readText("src/components/RightPanelTabs.tsx")
  const html = readText("src/index.html")
  const main = readText("src/main.tsx")
  const css = readText("src/styles/surfaces/inspector.css")

  expect(tabs).toContain('"assistant"')
  expect(tabs).toContain('props.onSelect("assistant")')
  expect(html).toContain('id="rightPanelAssistant"')
  expect(html).toContain('id="solidCodingAssistantMount"')
  expect(main).toContain('<CodingAssistantPanel active={() => rightPanelTab() === "assistant"}')
  expect(main).toContain('assistant.dataset.active = String(active === "assistant")')

  expect(component).toContain("props.active()")
  expect(component).toContain("settingsStore.directory.trim()")
  expect(component).toContain("listCodingAssistantSessions(1)")
  expect(component).toContain("createCodingAssistantSession()")
  expect(component).toContain("hydrateCodingAssistantTranscript")
  expect(component).toContain("transport.openStream")
  expect(component).toContain('path: `session/${encodeURIComponent(sessionID)}/events`')
  expect(component).toContain("scheduleReconnect(sessionID)")
  expect(component).toContain('aria-label={t("coding_assistant.placeholder")}')
  expect(component).not.toContain("new EventSource")
  expect(component).not.toContain("fetch(")
  expect(component).not.toContain("coding/message/stream")
  expect(component).not.toContain("coding/session/${")

  expect(service).toContain("apiJson(`coding/sessions?limit=")
  expect(service).toContain('apiJson("coding/session", { method: "POST" })')
  expect(service).toContain('apiJson(`session/${encodeURIComponent(sessionID)}/prompt_async`')
  expect(service).toContain('apiJson(`session/${encodeURIComponent(sessionID)}/conversation?tail_limit=80`')
  expect(service).not.toContain("message/stream")
  expect(service).not.toContain("/messages")

  expect(transcript).toContain("applyAssistantSessionEvent")
  expect(transcript).toContain('"message.part.delta"')
  expect(css).toContain(".sections-assistant-tab")
  expect(css).toContain(".coding-assistant-panel")
  expect(css).toContain(".coding-assistant-transcript")
})
