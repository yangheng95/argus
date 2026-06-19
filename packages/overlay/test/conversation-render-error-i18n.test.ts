import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CONVERSATION_SOURCE = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")
const EN_US = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")) as Record<
  string,
  string
>
const ZH_CN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")) as Record<
  string,
  string
>

test("Conversation render-error fallback uses i18n for visible and accessible copy", () => {
  expect(CONVERSATION_SOURCE).toContain('t("chat.render_error_title")')
  expect(CONVERSATION_SOURCE).toContain('t("chat.render_error_unknown")')
  expect(CONVERSATION_SOURCE).toContain("aria-label={title()}")
  expect(CONVERSATION_SOURCE).toContain('<div class="card__title">{title()}</div>')
  expect(CONVERSATION_SOURCE).not.toContain('aria-label="Card render failed"')
  expect(CONVERSATION_SOURCE).not.toContain(">Card render failed<")
  expect(CONVERSATION_SOURCE).not.toContain('"Unknown render error"')
})

test("Conversation render-error fallback has complete locale strings", () => {
  expect(EN_US["chat.render_error_title"]).toBe("Card render failed")
  expect(EN_US["chat.render_error_unknown"]).toBe("Unknown render error")
  expect(ZH_CN["chat.render_error_title"]).toBe("卡片渲染失败")
  expect(ZH_CN["chat.render_error_unknown"]).toBe("未知渲染错误")
})
