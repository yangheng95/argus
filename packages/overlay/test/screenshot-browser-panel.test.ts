import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  collectScreenshotBrowserItems,
  groupScreenshotBrowserItems,
  isStoredAttachmentUrl,
  SCREENSHOT_BROWSER_ITEM_LIMIT,
} from "../src/utils/screenshot-browser"

const ROOT = path.resolve(import.meta.dir, "..")

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

describe("screenshot browser panel", () => {
  test("collects appeared screenshots from message file parts and tool metadata by canonical agent", () => {
    const messages = [
      {
        info: {
          id: "m1",
          agent: "coding",
          time: { created: 100 },
        },
        parts: [
          { id: "p1", type: "file", url: "/attachment/project/a.png", mime: "image/png", filename: "a.png" },
          { id: "p2", type: "file", url: "/attachment/project/doc.pdf", mime: "application/pdf", filename: "doc.pdf" },
          { id: "p2b", type: "file", url: "data:image/png;base64,AAAA", mime: "image/png", filename: "inline.png" },
          { id: "p2c", type: "file", url: "https://example.test/external.png", mime: "image/png", filename: "external.png" },
          { id: "p2d", type: "file", url: "/api/local.png", mime: "image/png", filename: "api.png" },
          {
            id: "p2e",
            type: "file",
            url: "/browser-preview/local.png",
            mime: "image/png",
            filename: "preview.png",
          },
          {
            id: "p2f",
            type: "file",
            url: "/attachment/project/bad.png/extra",
            mime: "image/png",
            filename: "bad.png",
          },
        ],
      },
      {
        info: {
          id: "m2",
          resolvedRole: "visual-qa",
          time: { created: 200 },
        },
        parts: [
          {
            id: "p3",
            type: "tool",
            tool: "browser_observe",
            state: {
              metadata: {
                browser: {
                  url: "https://example.test",
                  title: "Observed page",
                  viewport: { width: 1440, height: 900 },
                  screenshot: { attachmentUrl: "/attachment/project/browser.png" },
                },
              },
            },
          },
          {
            id: "p3b",
            type: "tool",
            tool: "browser_observe",
            state: {
              metadata: {
                browser: {
                  screenshot: { attachmentUrl: "data:image/png;base64,BBBB" },
                },
              },
            },
          },
          {
            id: "p3c",
            type: "tool",
            tool: "browser_observe",
            state: {
              metadata: {
                browser: {
                  screenshot: { attachmentUrl: "https://example.test/browser.png" },
                },
              },
            },
          },
          {
            id: "p3d",
            type: "tool",
            tool: "browser_observe",
            state: {
              metadata: {
                browser: {
                  screenshot: { attachmentUrl: "/api/browser.png" },
                },
              },
            },
          },
          {
            id: "p4",
            type: "tool",
            tool: "url_screenshot",
            state: {
              attachments: [
                { url: "/attachment/project/tool.webp", mime: "image/webp", filename: "tool.webp" },
                { url: "/attachment/project/data.json", mime: "application/json", filename: "data.json" },
                { url: "data:image/webp;base64,CCCC", mime: "image/webp", filename: "inline-tool.webp" },
                { url: "https://example.test/tool.webp", mime: "image/webp", filename: "external-tool.webp" },
                { url: "/browser-preview/tool.webp", mime: "image/webp", filename: "preview-tool.webp" },
              ],
            },
          },
        ],
      },
    ]

    const items = collectScreenshotBrowserItems(messages)
    const groups = groupScreenshotBrowserItems(items)

    expect(items.map((item) => item.src)).toEqual([
      "/attachment/project/browser.png",
      "/attachment/project/tool.webp",
      "/attachment/project/a.png",
    ])
    expect(groups.map((group) => group.role)).toEqual(["visual-qa", "build"])
    expect(groups[0].items.map((item) => item.source)).toEqual(["tool-browser-evidence", "tool-attachment"])
    expect(groups[1].items.map((item) => item.source)).toEqual(["file"])
    expect(items.every((item) => item.src.startsWith("/attachment/"))).toBe(true)
  })

  test("accepts only canonical stored attachment urls", () => {
    expect(isStoredAttachmentUrl("/attachment/project/a.png")).toBe(true)
    expect(isStoredAttachmentUrl("/attachment/project/sha.webp")).toBe(true)
    expect(isStoredAttachmentUrl("/attachment/project/a.png/extra")).toBe(false)
    expect(isStoredAttachmentUrl("/attachment/project/a.png?size=thumb")).toBe(false)
    expect(isStoredAttachmentUrl("/attachment/project/a.png#hash")).toBe(false)
    expect(isStoredAttachmentUrl("/api/a.png")).toBe(false)
    expect(isStoredAttachmentUrl("/browser-preview/a.png")).toBe(false)
    expect(isStoredAttachmentUrl("https://example.test/a.png")).toBe(false)
    expect(isStoredAttachmentUrl("data:image/png;base64,AAAA")).toBe(false)
  })

  test("bounds derived history before rendering", () => {
    const messages = Array.from({ length: SCREENSHOT_BROWSER_ITEM_LIMIT + 10 }, (_item, index) => ({
      info: {
        id: `m${index}`,
        agent: "executor",
        time: { created: index + 1 },
      },
      parts: [
        {
          id: `p${index}`,
          type: "file",
          url: `/attachment/project/${index}.png`,
          mime: "image/png",
          filename: `${index}.png`,
        },
      ],
    }))

    const items = collectScreenshotBrowserItems(messages)

    expect(items).toHaveLength(SCREENSHOT_BROWSER_ITEM_LIMIT)
    expect(items[0].src).toBe(`/attachment/project/${SCREENSHOT_BROWSER_ITEM_LIMIT + 9}.png`)
    expect(items.at(-1)?.src).toBe("/attachment/project/10.png")
  })

  test("component reuses shared image resource and preview paths without local screenshot storage", () => {
    const component = read("src/components/ScreenshotBrowserPanel.tsx")
    const main = read("src/main.tsx")
    const html = read("src/index.html")
    const css = read("src/styles/surfaces/activity.css")
    const icon = read("src/components/Icon.tsx")
    const en = read("src/i18n/en-US.json")
    const zh = read("src/i18n/zh-CN.json")

    expect(html).toContain('id="centerWorkbenchScreenshots"')
    expect(html).toContain('id="solidScreenshotBrowserMount"')
    expect(main).toContain('<ScreenshotBrowserPanel active={() => isCenterWorkbenchPanelOpen("screenshots")} />')
    expect(main).toContain('screenshots: document.getElementById("centerWorkbenchScreenshots")')
    expect(main).toContain('id: "screenshots"')
    expect(main).toContain('icon: "screenshots"')
    expect(icon).toContain("Images")
    expect(component).toContain("messageStore.messages")
    expect(component).toContain("active() ? collectScreenshotBrowserItems(messageStore.messages) : []")
    expect(component).toContain("collectScreenshotBrowserItems")
    expect(component).toContain("groupScreenshotBrowserItems")
    expect(component).toContain("fetchResourceAsObjectUrl")
    expect(component).toContain("peekResourceObjectUrl")
    expect(component).toContain("<PreviewableImage")
    expect(component).not.toContain("URL.createObjectURL")
    expect(component).not.toContain("URL.revokeObjectURL")
    expect(component).not.toContain("new EventSource")
    expect(component).not.toContain("<iframe")
    expect(component).not.toContain("fetch(")
    expect(component).not.toContain("localStorage")
    expect(component).not.toContain("sessionStorage")
    expect(css).toContain(".screenshot-browser-panel")
    expect(css).toContain(".screenshot-browser-grid")
    expect(css).toContain("grid-template-rows: calc(86px * var(--ui-scale))")
    for (const key of [
      "screenshots.title",
      "screenshots.empty",
      "screenshots.count",
      "screenshots.group_count",
      "activity.tooltip.screenshots",
    ]) {
      expect(en).toContain(`"${key}"`)
      expect(zh).toContain(`"${key}"`)
    }
  })
})
