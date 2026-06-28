import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  buildScreenshotBrowserRows,
  collectScreenshotBrowserItemsFromCard,
  collectScreenshotBrowserItemsFromCardTree,
  collectScreenshotBrowserItems,
  groupScreenshotBrowserItems,
  isScreenshotBrowserThumbnailUrl,
  isStoredAttachmentUrl,
  mergeScreenshotBrowserItemSets,
  SCREENSHOT_BROWSER_ITEM_LIMIT,
  SCREENSHOT_BROWSER_THUMBNAIL_VARIANT,
  screenshotBrowserThumbnailUrl,
  type ScreenshotBrowserItem,
} from "../src/utils/screenshot-browser"
import type { CardNode } from "../src/store/card-tree"

const ROOT = path.resolve(import.meta.dir, "..")

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function withScreenshotCaches<T extends Record<string, CardNode>>(cards: T): T {
  const fill = (id: string, visiting = new Set<string>()): ScreenshotBrowserItem[] => {
    const card = cards[id]
    if (!card) return []
    if (visiting.has(id)) throw new Error(`cycle in screenshot cache fixture at ${id}`)
    visiting.add(id)
    const itemSets: ScreenshotBrowserItem[][] = [collectScreenshotBrowserItemsFromCard(card)]
    for (const childID of card.childIDs ?? []) itemSets.push(fill(childID, visiting))
    visiting.delete(id)
    card.subtreeScreenshotItems = mergeScreenshotBrowserItemSets(itemSets)
    return card.subtreeScreenshotItems
  }
  for (const id of Object.keys(cards)) fill(id)
  return cards
}

function screenshotItem(
  input: Partial<ScreenshotBrowserItem> & Pick<ScreenshotBrowserItem, "src" | "time">,
): ScreenshotBrowserItem {
  const src = input.src
  const role = input.role ?? "visual-qa"
  const messageID = input.messageID ?? `msg:${src}`
  const ownerRole = input.ownerRole ?? role
  const ownerSessionID = input.ownerSessionID ?? "ses_visual"
  const ownerMessageID = input.ownerMessageID ?? messageID
  const ownerTime = input.ownerTime ?? input.time
  return {
    id: input.id ?? `file:${src}`,
    role,
    ownerKey: input.ownerKey ?? `${ownerRole}:session:${ownerSessionID}:message:${ownerMessageID}:time:${ownerTime}`,
    ownerRole,
    ownerSessionID,
    ownerMessageID,
    ownerTime,
    src,
    thumbnailSrc: input.thumbnailSrc ?? screenshotBrowserThumbnailUrl(src),
    alt: input.alt ?? src,
    title: input.title ?? src,
    detail: input.detail ?? "image/png",
    time: input.time,
    messageID,
    partID: input.partID ?? `part:${src}`,
    source: input.source ?? "file",
  }
}

describe("screenshot browser panel", () => {
  test("collects appeared screenshots from message file parts and tool metadata by canonical agent", () => {
    const messages = [
      {
        info: {
          id: "m1",
          sessionID: "ses_build",
          agent: "coding",
          time: { created: 100 },
        },
        parts: [
          { id: "p1", type: "file", url: "/attachment/project/a.png", mime: "image/png", filename: "a.png" },
          { id: "p2", type: "file", url: "/attachment/project/doc.pdf", mime: "application/pdf", filename: "doc.pdf" },
          { id: "p2b", type: "file", url: "data:image/png;base64,AAAA", mime: "image/png", filename: "inline.png" },
          {
            id: "p2c",
            type: "file",
            url: "https://example.test/external.png",
            mime: "image/png",
            filename: "external.png",
          },
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
          sessionID: "ses_visual",
          resolvedRole: "visual-qa",
          time: { created: 200 },
        },
        parts: [
          {
            id: "p3",
            type: "tool",
            tool: "browser_observe",
            state: {
              attachments: [
                { url: "/attachment/project/browser.png", mime: "image/png", filename: "browser-duplicate.png" },
              ],
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
    expect(items.map((item) => item.thumbnailSrc)).toEqual([
      `/attachment/project/browser.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
      `/attachment/project/tool.webp?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
      `/attachment/project/a.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
    ])
    expect(groups.map((group) => group.role)).toEqual(["visual-qa", "build"])
    expect(groups.map((group) => group.key)).toEqual([
      "visual-qa:session:ses_visual:message:m2:time:200",
      "build:session:ses_build:message:m1:time:100",
    ])
    expect(groups.map((group) => group.time)).toEqual([200, 100])
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
    expect(screenshotBrowserThumbnailUrl("/attachment/project/a.png")).toBe(
      `/attachment/project/a.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
    )
    expect(() => screenshotBrowserThumbnailUrl("/api/a.png")).toThrow("stored attachment")
    expect(
      isScreenshotBrowserThumbnailUrl(`/attachment/project/a.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`),
    ).toBe(true)
    expect(isScreenshotBrowserThumbnailUrl("/attachment/project/a.png")).toBe(false)
    expect(isScreenshotBrowserThumbnailUrl("/attachment/project/a.png?variant=unknown")).toBe(false)
    expect(
      isScreenshotBrowserThumbnailUrl(
        `/attachment/project/a.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}&other=1`,
      ),
    ).toBe(false)
  })

  test("does not create screenshot owners for non-image parts", () => {
    expect(
      collectScreenshotBrowserItems([
        {
          info: { role: "assistant" },
          parts: [
            { id: "text_without_owner", type: "text", text: "plain text" },
            {
              id: "pdf_without_owner",
              type: "file",
              url: "/attachment/project/doc.pdf",
              mime: "application/pdf",
              filename: "doc.pdf",
            },
            {
              id: "tool_without_owner",
              type: "tool",
              tool: "bash",
              state: {
                attachments: [
                  { url: "/attachment/project/data.json", mime: "application/json", filename: "data.json" },
                ],
              },
            },
          ],
        },
      ]),
    ).toEqual([])
  })

  test("groups screenshots by concrete agent turn instead of collapsing one build role", () => {
    const messages = [
      {
        info: {
          id: "msg_build_first",
          sessionID: "ses_build",
          channel: "build",
          resolvedRole: "build",
          time: { created: 1_780_000_010_000 },
        },
        parts: [
          {
            id: "part_build_first",
            type: "tool",
            messageID: "msg_build_first",
            sessionID: "ses_build",
            tool: "browser_observe",
            state: {
              metadata: {
                browser: {
                  title: "first build observe",
                  screenshot: { attachmentUrl: "/attachment/project/build-first.png" },
                },
              },
            },
          },
        ],
      },
      {
        info: {
          id: "msg_build_second",
          sessionID: "ses_build",
          channel: "build",
          resolvedRole: "build",
          time: { created: 1_780_000_020_000 },
        },
        parts: [
          {
            id: "part_build_second",
            type: "tool",
            messageID: "msg_build_second",
            sessionID: "ses_build",
            tool: "webpage_runtime_state",
            state: {
              attachments: [
                {
                  url: "/attachment/project/build-second.png",
                  mime: "image/png",
                  filename: "build-second.png",
                },
              ],
            },
          },
        ],
      },
    ]

    const groups = groupScreenshotBrowserItems(collectScreenshotBrowserItems(messages))

    expect(groups.map((group) => group.key)).toEqual([
      "build:session:ses_build:message:msg_build_second:time:1780000020000",
      "build:session:ses_build:message:msg_build_first:time:1780000010000",
    ])
    expect(groups.map((group) => group.role)).toEqual(["build", "build"])
    expect(groups.map((group) => group.time)).toEqual([1_780_000_020_000, 1_780_000_010_000])
    expect(groups.map((group) => group.items.map((item) => item.src))).toEqual([
      ["/attachment/project/build-second.png"],
      ["/attachment/project/build-first.png"],
    ])
  })

  test("phase card screenshots inherit the boundary agent turn and time", () => {
    const items = collectScreenshotBrowserItems([
      {
        info: {
          id: "phase_card",
          sessionID: "ses_build",
          channel: "build",
          resolvedRole: "build",
          time: { created: 1_780_000_000_000 },
        },
        parts: [
          {
            type: "boundary",
            messageID: "msg_build_first",
            role: "build",
            time: 1_780_000_010_000,
          },
          {
            id: "part_first",
            type: "file",
            messageID: "msg_build_first",
            sessionID: "ses_build",
            url: "/attachment/project/phase-first.png",
            mime: "image/png",
            filename: "phase-first.png",
          },
          {
            type: "boundary",
            messageID: "msg_build_second",
            role: "build",
            time: 1_780_000_020_000,
          },
          {
            id: "part_second",
            type: "tool",
            messageID: "msg_build_second",
            sessionID: "ses_build",
            tool: "browser_observe",
            state: {
              metadata: {
                browser: {
                  title: "phase second observe",
                  screenshot: { attachmentUrl: "/attachment/project/phase-second.png" },
                },
              },
            },
          },
        ],
      },
    ])
    const groups = groupScreenshotBrowserItems(items)

    expect(items.map((item) => item.ownerKey)).toEqual([
      "build:session:ses_build:message:msg_build_second:time:1780000020000",
      "build:session:ses_build:message:msg_build_first:time:1780000010000",
    ])
    expect(groups.map((group) => group.key)).toEqual([
      "build:session:ses_build:message:msg_build_second:time:1780000020000",
      "build:session:ses_build:message:msg_build_first:time:1780000010000",
    ])
  })

  test("collects screenshots from hydrated card tree as the panel source", () => {
    const cards = withScreenshotCaches({
      card_visual: {
        id: "card_visual",
        kind: "agent",
        sessionID: "ses_visual",
        messageID: "msg_visual",
        role: "visual-qa",
        stage: "visual-qa",
        title: "Visual QA",
        time: 200,
        parts: [
          {
            id: "part_visual",
            type: "file",
            messageID: "msg_visual",
            sessionID: "ses_visual",
            url: "/attachment/project/visual.png",
            mime: "image/png",
            filename: "visual.png",
          },
        ],
        childIDs: ["card_child"],
      },
      card_child: {
        id: "card_child",
        kind: "tool",
        sessionID: "ses_visual",
        messageID: "msg_tool",
        role: "visual-qa",
        stage: "visual-qa",
        title: "Browser observe",
        time: 250,
        parts: [
          {
            id: "part_browser",
            type: "tool",
            messageID: "msg_tool",
            tool: "browser_observe",
            state: {
              metadata: {
                browser: {
                  url: "https://example.test",
                  title: "Observed page",
                  screenshot: { attachmentUrl: "/attachment/project/browser.png" },
                },
              },
            },
          },
        ],
        childIDs: [],
      },
      card_build: {
        id: "card_build",
        kind: "agent",
        sessionID: "ses_build",
        messageID: "msg_build",
        role: "build",
        stage: "build",
        title: "Build",
        time: 100,
        parts: [
          {
            id: "part_build",
            type: "file",
            messageID: "msg_build",
            sessionID: "ses_build",
            url: "/attachment/project/build.png",
            mime: "image/png",
            filename: "build.png",
          },
        ],
        childIDs: [],
      },
    })
    const items = collectScreenshotBrowserItemsFromCardTree(["card_visual", "card_build"], cards)

    expect(items.map((item) => item.src)).toEqual([
      "/attachment/project/browser.png",
      "/attachment/project/visual.png",
      "/attachment/project/build.png",
    ])
    expect(items.map((item) => item.thumbnailSrc)).toEqual([
      `/attachment/project/browser.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
      `/attachment/project/visual.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
      `/attachment/project/build.png?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
    ])
    expect(groupScreenshotBrowserItems(items).map((group) => group.key)).toEqual([
      "visual-qa:session:ses_visual:message:msg_tool:time:250",
      "visual-qa:session:ses_visual:message:msg_visual:time:200",
      "build:session:ses_build:message:msg_build:time:100",
    ])
  })

  test("bounds derived history before rendering", () => {
    const messages = Array.from({ length: SCREENSHOT_BROWSER_ITEM_LIMIT + 10 }, (_item, index) => ({
      info: {
        id: `m${index}`,
        sessionID: "ses_executor",
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

  test("card tree collection keeps a bounded newest set without full message materialization", () => {
    const count = 5_000
    const order = Array.from({ length: count }, (_item, index) => `card_${index}`)
    const entries: Array<[string, CardNode]> = order.map((id, index) => [
      id,
      {
        id,
        kind: "agent",
        sessionID: "ses_visual",
        messageID: `msg_${index}`,
        role: "visual-qa",
        stage: "visual-qa",
        title: `Visual ${index}`,
        time: index + 1,
        parts:
          index % 10 === 0
            ? [
                {
                  id: `part_${index}`,
                  type: "file",
                  messageID: `msg_${index}`,
                  sessionID: "ses_visual",
                  url: `/attachment/project/${index}.png`,
                  mime: "image/png",
                  filename: `${index}.png`,
                },
              ]
            : [],
        childIDs: [],
      },
    ])
    const cards = withScreenshotCaches(Object.fromEntries(entries))

    const items = collectScreenshotBrowserItemsFromCardTree(order, cards)
    const source = read("src/utils/screenshot-browser.ts")
    const statsSource = read("src/store/card-tree-stats.ts")

    expect(items).toHaveLength(SCREENSHOT_BROWSER_ITEM_LIMIT)
    expect(items[0].src).toBe("/attachment/project/4990.png")
    expect(items.at(-1)?.src).toBe("/attachment/project/3800.png")
    expect(source).toContain("function insertBoundedNewestFirst")
    expect(source).toContain("subtreeScreenshotItems")
    expect(statsSource).toContain("collectScreenshotBrowserItemsFromCard(card)")
    expect(statsSource).not.toContain("mergeScreenshotBrowserItemSets(topLevelScreenshotItemSets.values())")
    expect(source).not.toContain("function collectCardTreeScreenshots")
    expect(source).not.toContain("collectCardTreeScreenshots(")
    expect(source).not.toContain("const messages: any[] = []")
    expect(source).not.toContain("items.sort(")
  })

  test("card tree collection reads cached subtree screenshots without walking parts or childIDs", () => {
    let partsReads = 0
    let childIDReads = 0
    const cached = Array.from({ length: SCREENSHOT_BROWSER_ITEM_LIMIT }, (_item, index) =>
      screenshotItem({
        src: `/attachment/project/cached-${index}.png`,
        time: SCREENSHOT_BROWSER_ITEM_LIMIT - index,
      }),
    )
    const root = new Proxy(
      {
        id: "root",
        kind: "agent",
        role: "visual-qa",
        stage: "visual-qa",
        title: "Root",
        time: 1,
        subtreeScreenshotItems: cached,
      } as CardNode,
      {
        get(target, property, receiver) {
          if (property === "parts") partsReads += 1
          if (property === "childIDs") childIDReads += 1
          return Reflect.get(target, property, receiver)
        },
      },
    )
    const cards = new Proxy(
      { root },
      {
        get(target, property, receiver) {
          if (typeof property === "string" && property !== "root") {
            throw new Error(`collector read unexpected card ${property}`)
          }
          return Reflect.get(target, property, receiver)
        },
      },
    )

    const items = collectScreenshotBrowserItemsFromCardTree(["root"], cards)

    expect(items.map((item) => item.src)).toEqual(cached.map((item) => item.src))
    expect(partsReads).toBe(0)
    expect(childIDReads).toBe(0)
  })

  test("card tree collection fails when writer-maintained screenshot cache is missing", () => {
    expect(() =>
      collectScreenshotBrowserItemsFromCardTree(["uncached"], {
        uncached: {
          id: "uncached",
          kind: "agent",
          role: "visual-qa",
          stage: "visual-qa",
          title: "Uncached",
          time: 1,
          parts: [],
          childIDs: [],
        },
      }),
    ).toThrow("missing subtreeScreenshotItems cache")
  })

  test("builds virtual rows with group headers and bounded column chunks", () => {
    const messages = [
      {
        info: {
          id: "m_visual",
          sessionID: "ses_visual",
          agent: "visual-qa",
          time: { created: 1 },
        },
        parts: Array.from({ length: 5 }, (_item, index) => ({
          id: `p${index}`,
          type: "file",
          messageID: "m_visual",
          sessionID: "ses_visual",
          url: `/attachment/project/${index}.png`,
          mime: "image/png",
          filename: `${index}.png`,
        })),
      },
    ]
    const groups = groupScreenshotBrowserItems(collectScreenshotBrowserItems(messages))
    const rows = buildScreenshotBrowserRows(groups, 2)

    expect(rows.map((row) => row.kind)).toEqual(["group", "items", "items", "items"])
    expect(rows[0]).toMatchObject({ kind: "group", role: "visual-qa", count: 5 })
    expect(rows.slice(1).map((row) => (row.kind === "items" ? row.items.length : 0))).toEqual([2, 2, 1])
  })

  test("component reuses shared image resource and preview paths without local screenshot storage", () => {
    const component = read("src/components/ScreenshotBrowserPanel.tsx")
    const main = read("src/main.tsx")
    const html = read("src/index.html")
    const css = read("src/styles/surfaces/activity.css")
    const normalizedCss = css.replace(/\r\n/g, "\n")
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
    expect(component).toContain("cardTreeStore")
    expect(component).toContain("return cardTreeStore.screenshotItems")
    expect(component).not.toContain("collectScreenshotBrowserItemsFromCardTree")
    expect(component).not.toContain("cardTreeStore.order")
    expect(component).not.toContain("cardTreeStore.cards")
    expect(read("src/services/tree-writer.ts")).not.toContain('setCardTreeStore("order"')
    expect(read("src/store/card-tree.ts")).toContain("export function replaceCardTreeOrder")
    expect(component).not.toContain("messageStore.messages")
    expect(component).toContain('from "virtua/solid"')
    expect(component).toContain("<Virtualizer")
    expect(component).not.toContain("ESTIMATED_SCREENSHOT_BROWSER_ROW_HEIGHT")
    expect(component).not.toContain("itemSize={")
    expect(component).toContain("SCREENSHOT_BROWSER_CARD_WIDTH = 132")
    expect(component).not.toContain("SCREENSHOT_BROWSER_CARD_MIN_WIDTH")
    expect(component).toContain("const cardWidth = createMemo(() => SCREENSHOT_BROWSER_CARD_WIDTH * currentUIScale())")
    expect(component).toContain("buildScreenshotBrowserRows(groups(), columnCount())")
    expect(component).toContain("IntersectionObserver")
    expect(component).toContain("SCREENSHOT_BROWSER_THUMBNAIL_LOADS_PER_FRAME")
    expect(component).toContain("SCREENSHOT_BROWSER_THUMBNAIL_LOADS_PER_FRAME = 1")
    expect(component).toContain("interface ScreenshotThumbnailLoadJob")
    expect(component).toContain("enqueueScreenshotThumbnailLoad")
    expect(component).toContain("pendingThumbnailLoads.indexOf(job)")
    expect(component).toContain("pendingThumbnailLoads.splice(index, 1)")
    expect(component).toContain("cancelAnimationFrame(thumbnailLoadFrame)")
    expect(component).not.toContain("let cancelled = false")
    expect(component).not.toContain("if (!cancelled) load()")
    expect(component).toContain("createAnimationFrameScheduler(commitWidth)")
    expect(component).toContain("new ResizeObserver((entries) =>")
    expect(component).toContain("pendingWidth = entry.contentRect.width")
    expect(component).not.toContain("element.clientWidth")
    expect(component).toContain('style={`--screenshot-browser-card-width: ${cardWidth()}px`}')
    expect(component).toContain("groupScreenshotBrowserItems")
    expect(component).toContain("isStoredAttachmentUrl")
    expect(component).toContain("isScreenshotBrowserThumbnailUrl")
    expect(component).not.toContain("needsAuthedFetch")
    expect(component).not.toContain("resolveResourceUrl")
    expect(component).toContain("fetchResourceAsObjectUrl")
    expect(component).toContain("peekResourceObjectUrl")
    expect(component).toContain("let thumbnailLoadController: AbortController | undefined")
    expect(component).toContain('new DOMException("Screenshot thumbnail source changed", "AbortError")')
    expect(component).toContain('new DOMException("Screenshot thumbnail unmounted", "AbortError")')
    expect(component).toContain(
      "!isStoredAttachmentUrl(props.item.src) || !isScreenshotBrowserThumbnailUrl(props.item.thumbnailSrc)",
    )
    expect(component).toContain("props.item.thumbnailSrc")
    expect(component).toContain("const cached = peekResourceObjectUrl(url)")
    expect(component).toContain("if (cached) return cached")
    expect(component).toContain("fetchResourceAsObjectUrl(url, { signal: controller.signal })")
    expect(component).toContain("const src = () => (loadAllowed() && !sourceError() ? objectUrl() : null)")
    expect(component).toContain('t("screenshots.thumbnail_invalid_source")')
    expect(component).toContain('t("screenshots.thumbnail_load_failed")')
    expect(component).toContain('class="screenshot-browser__thumb-trigger screenshot-browser__thumb-error"')
    expect(component).not.toContain("initialValue: authed() ?")
    expect(component).not.toContain("peekResourceObjectUrl(props.item.src)")
    expect(component).not.toContain("fetchResourceAsObjectUrl(props.item.src, { signal")
    expect(component).toContain("<PreviewableImage")
    expect(component).toContain("previewLoader={() => fetchResourceAsObjectUrl(props.item.src)}")
    expect(component).toContain("imageAttributes={{")
    expect(component).toContain('decoding: "async"')
    expect(component).toContain('fetchpriority: "low"')
    expect(component).not.toContain("<For each={group.items}>")
    expect(component).not.toContain("URL.createObjectURL")
    expect(component).not.toContain("URL.revokeObjectURL")
    expect(component).not.toContain("new EventSource")
    expect(component).not.toContain("<iframe")
    expect(component).not.toContain("fetch(")
    expect(component).not.toContain("localStorage")
    expect(component).not.toContain("sessionStorage")
    const screenshotUtils = read("src/utils/screenshot-browser.ts")
    expect(screenshotUtils).toContain('from "@opencorvus-ai/transport-protocol"')
    expect(screenshotUtils).toContain("export { SCREENSHOT_BROWSER_THUMBNAIL_VARIANT }")
    expect(screenshotUtils).toContain("thumbnailSrc: screenshotBrowserThumbnailUrl(src)")
    expect(screenshotUtils).toContain("isScreenshotBrowserThumbnailUrl")
    expect(screenshotUtils).not.toContain("canvas")
    expect(css).toContain(".screenshot-browser-panel")
    expect(normalizedCss).toContain(
      '.screenshot-browser-groups[data-virtualized="true"] {\n  display: block;\n  gap: 0;\n  overflow-x: hidden;\n  overflow-y: auto;\n}',
    )
    expect(normalizedCss).toContain(
      ".screenshot-browser-virtual-window {\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n}",
    )
    expect(css).toContain(".screenshot-browser-virtual-item")
    expect(css).toContain(".screenshot-browser-row-grid")
    expect(css).toContain(
      "grid-template-columns: repeat(var(--screenshot-browser-columns), minmax(0, var(--screenshot-browser-card-width)))",
    )
    expect(css).not.toContain("grid-template-columns: repeat(var(--screenshot-browser-columns), minmax(0, 1fr))")
    expect(css).not.toContain(".screenshot-browser-grid")
    expect(css).toContain("grid-template-rows: calc(86px * var(--ui-scale))")
    expect(css).toContain(".screenshot-browser__thumb-trigger .screenshot-browser__thumb-image")
    expect(css).toContain(".screenshot-browser__thumb-error")
    expect(css).toContain("max-width: none")
    expect(css).toContain("max-height: none")
    for (const key of [
      "screenshots.title",
      "screenshots.empty",
      "screenshots.count",
      "screenshots.group_count",
      "screenshots.thumbnail_invalid_source",
      "screenshots.thumbnail_load_failed",
      "activity.tooltip.screenshots",
    ]) {
      expect(en).toContain(`"${key}"`)
      expect(zh).toContain(`"${key}"`)
    }
  })
})
