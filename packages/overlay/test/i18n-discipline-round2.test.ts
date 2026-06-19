import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SRC_ROOT = join(OVERLAY_ROOT, "src")

function read(relPath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relPath), "utf8")
}

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(read(relPath))
}

function walkFiles(dir: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walkFiles(path, predicate))
    else if (predicate(path)) out.push(path)
  }
  return out
}

describe("round 2 i18n discipline", () => {
  test("t() calls do not carry string fallbacks", () => {
    const matches: string[] = []
    for (const file of walkFiles(SRC_ROOT, (path) => /\.(?:ts|tsx)$/.test(path))) {
      const text = readFileSync(file, "utf8")
      for (const match of text.matchAll(/\bt\([^)]*\)\s*\|\|\s*["']/g)) {
        matches.push(`${relative(OVERLAY_ROOT, file)}:${match.index}`)
      }
    }
    expect(matches).toEqual([])
  })

  test("R2-4 title and aria label keys exist in both locale catalogs", () => {
    const en = readJson("src/i18n/en-US.json")
    const zh = readJson("src/i18n/zh-CN.json")
    const required = [
      "card.activity_summary",
      "card.activity.tools",
      "card.activity.messages",
      "card.activity.agents",
      "card.activity.skills",
      "card.error_reason",
      "card.error_reason_title",
      "card.inspect_agent_trace",
      "card.rewind_step",
      "chat.attachment.remove",
      "command_palette.label",
      "trace.copy_json",
      "trace.copy_failed",
      "trace.title_session",
      "trace.title_task",
      "trace.title_unselected",
      "trace.empty_select_task",
      "trace.loading",
      "trace.fetch_failed",
      "trace.empty_no_events",
      "trace.disabled_server",
      "trace.disabled_server_hint",
      "trace.server_trace_dir",
      "trace.trace_dir_mismatch_before",
      "trace.trace_dir_mismatch_after",
      "trace.auto_refresh",
      "trace.collector.specs",
      "trace.collector.requirements",
      "trace.collector.goals",
      "trace.collector.items",
      "trace.collector.slots",
      "trace.event.open",
      "trace.event.session",
      "trace.event.more_tools",
      "trace.event.messages",
      "trace.event.structured_ok",
      "trace.event.structured_missing",
      "trace.event.stream_errors",
      "trace.event.no_message",
    ]
    for (const key of required) {
      expect(Object.hasOwn(en, key)).toBe(true)
      expect(Object.hasOwn(zh, key)).toBe(true)
    }
  })

  test("locale catalogs keep identical top-level key sets", () => {
    const enKeys = Object.keys(readJson("src/i18n/en-US.json")).sort()
    const zhKeys = Object.keys(readJson("src/i18n/zh-CN.json")).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  test("R2-4 placeholders separate localized input hints from fixed examples", () => {
    const providers = read("src/components/settings/ProvidersPanel.tsx")
    const channels = read("src/components/settings/ChannelsPanel.tsx")
    const skills = read("src/components/settings/SkillMarketPanel.tsx")
    const en = readJson("src/i18n/en-US.json")
    const zh = readJson("src/i18n/zh-CN.json")
    for (const key of [
      "provider.form.id_placeholder",
      "provider.form.name_placeholder",
      "provider.form.api_placeholder",
      "provider.form.env_placeholder",
    ]) {
      expect(providers).toContain(`t("${key}"`)
      expect(Object.hasOwn(en, key)).toBe(true)
      expect(Object.hasOwn(zh, key)).toBe(true)
    }
    expect(providers).toContain(
      'placeholder={t("provider.form.api_placeholder", { value: "https://my-gateway.com/v1" })}',
    )
    expect(providers).toContain('placeholder={t("provider.form.id_placeholder", { value: "opentoken" })}')
    expect(providers).toContain('placeholder={t("provider.form.name_placeholder", { value: "OpenToken CN2" })}')
    expect(providers).toContain('placeholder={t("provider.form.env_placeholder", { value: "OPENTOKEN_API_KEY" })}')
    expect(providers).toContain('placeholder={"gpt-5.4-mini:GPT-5.4 Mini\\ngpt-5.4:GPT-5.4"}')
    expect(channels).toContain("Fixed example URL")
    expect(channels).toContain("Channel schemas own these placeholders")
    expect(skills).toContain("Fixed MCP server-name example")
    expect(skills).toContain("Fixed remote MCP URL example")
    expect(skills).toContain("Fixed command example")
    expect(skills).toContain("Fixed command-line argument example")
  })

  test("OpenCorvus menubar label is an explicit brand whitelist", () => {
    const titlebar = read("src/components/titlebar/TitlebarMenubar.tsx")
    expect(titlebar).toContain("OpenCorvus is the product brand name")
    expect(titlebar).toContain("<Menubar.Root")
    expect(titlebar).toContain('aria-label="OpenCorvus"')
  })
})
