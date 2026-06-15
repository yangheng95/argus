import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { CardNode } from "../src/store/card-tree"
import {
  collectScreenshotBrowserItemsFromCards,
  groupScreenshotBrowserItems,
  isStoredAttachmentUrl,
  SCREENSHOT_BROWSER_ITEM_LIMIT,
} from "../src/utils/screenshot-browser"

const ROOT = path.resolve(import.meta.dir, "..")

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

describe("screenshot browser panel", () => {
  test("collects appeared screenshots from reachable card tree nodes by canonical agent", () => {
    const cards: Record<string, CardNode> = {
      root: {
        id: "root",
        kind: "agent",
        stage: "build",
        title: "Build",
        time: 100,
        messageID: "m1",
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
        childIDs: ["visual"],
      },
      visual: {
        id: "visual",
        kind: "agent",
        stage: "visual-qa",
        title: "Visual QA",
        time: 200,
        messageID: "m2",
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
            state: { metadata: { browser: { screenshot: { attachmentUrl: "data:image/png;base64,BBBB" } } } },
          },
          {
            id: "p3c",
            type: "tool",
            tool: "browser_observe",
            state: { metadata: { browser: { screenshot: { attachmentUrl: "https://example.test/browser.png" } } } },
          },
          {
            id: "p3d",
            type: "tool",
            tool: "browser_observe",
            state: { metadata: { browser: { screenshot: { attachmentUrl: "/api/browser.png" } } } },
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
        childIDs: ["promoted"],
      },
      promoted: {
        id: "promoted",
        kind: "tool",
        stage: "visual-qa",
        title: "Promoted tool",
        time: 300,
        parts: [],
        childIDs: [],
        toolPart: {
          id: "p5",
          type: "tool",
          tool: "url_screenshot",
          state: {
            attachments: [{ url: "/attachment/project/promoted.png", mime: "image/png", filename: "promoted.png" }],
          },
        },
      },
      orphan: {
        id: "orphan",
        kind: "agent",
        stage: "build",
        title: "Orphan",
        time: 400,
        parts: [{ id: "orphan-file", type: "file", url: "/attachment/project/orphan.png", mime: "image/png" }],
        childIDs: [],
      },
    }

    const items = collectScreenshotBrowserItemsFromCards(["root"], cards)
    const groups = groupScreenshotBrowserItems(items)

    expect(items.map((item) => item.src)).toEqual([
      "/attachment/project/promoted.png",
      "/attachment/project/browser.png",
      "/attachment/project/tool.webp",
      "/attachment/project/a.png",
    ])
    expect(groups.map((group) => group.role)).toEqual(["visual-qa", "build"])
    expect(groups[0].items.map((item) => item.source)).toEqual([
      "tool-attachment",
      "tool-browser-evidence",
      "tool-attachment",
    ])
    expect(groups[1].items.map((item) => item.source)).toEqual(["file"])
    expect(items.every((item) => item.src.startsWith("/attachment/"))).toBe(true)
    expect(items.some((item) => item.src.includes("orphan"))).toBe(false)
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
    const cards = Object.fromEntries(
      Array.from({ length: SCREENSHOT_BROWSER_ITEM_LIMIT + 10 }, (_item, index) => [
        `card-${index}`,
        {
          id: `card-${index}`,
          kind: "agent",
          stage: "executor",
          title: "Executor",
          time: index + 1,
          messageID: `m${index}`,
          childIDs: index < SCREENSHOT_BROWSER_ITEM_LIMIT + 9 ? [`card-${index + 1}`] : [],
          parts: [
            {
              id: `p${index}`,
              type: "file",
              url: `/attachment/project/${index}.png`,
              mime: "image/png",
              filename: `${index}.png`,
            },
          ],
        } satisfies CardNode,
      ]),
    ) as Record<string, CardNode>

    const items = collectScreenshotBrowserItemsFromCards(["card-0"], cards)

    expect(items).toHaveLength(SCREENSHOT_BROWSER_ITEM_LIMIT)
    expect(items[0].src).toBe(`/attachment/project/${SCREENSHOT_BROWSER_ITEM_LIMIT + 9}.png`)
    expect(items.at(-1)?.src).toBe("/attachment/project/10.png")
  })

  test("skips cards without explicit agent identity instead of normalizing them to assistant", () => {
    const cards: Record<string, CardNode> = {
      root: {
        id: "root",
        kind: "message",
        title: "No stage",
        time: 100,
        parts: [{ id: "p1", type: "file", url: "/attachment/project/no-stage.png", mime: "image/png" }],
        childIDs: ["child"],
      },
      child: {
        id: "child",
        kind: "agent",
        stage: "build",
        title: "Build",
        time: 200,
        parts: [{ id: "p2", type: "file", url: "/attachment/project/build.png", mime: "image/png" }],
        childIDs: [],
      },
    }

    const items = collectScreenshotBrowserItemsFromCards(["root"], cards)

    expect(items.map((item) => item.src)).toEqual(["/attachment/project/build.png"])
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
    expect(component).toContain("cardTreeStore.order")
    expect(component).toContain("cardTreeStore.cards")
    expect(component).not.toContain("messageStore")
    expect(component).toContain("collectScreenshotBrowserItemsFromCards")
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
