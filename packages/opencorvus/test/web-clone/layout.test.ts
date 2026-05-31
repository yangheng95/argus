import { describe, expect, test } from "bun:test"
import {
  extractArchiveHtml,
  mergeExtractedLayoutIntoPageIr,
  WebClonePageIrSchema,
} from "../../src/web-clone"

describe("web-clone layout merge", () => {
  test("attaches browser bounds and computed styles to canonical DOM nodes", () => {
    const extraction = extractArchiveHtml({
      html: `<html><body><main id="app"><section class="hero"><h1>Markets</h1><a href="/calendar">Calendar</a></section></main></body></html>`,
    })

    const pageIr = mergeExtractedLayoutIntoPageIr(extraction.pageIr, {
      tree: [
        {
          selector: "main#app",
          tag: "main",
          bounds: { x: 0, y: 0, w: 1440, h: 800 },
          styles: { display: "block", backgroundColor: "rgb(255, 255, 255)" },
          children: [
            {
              selector: "section.hero",
              tag: "section",
              role: "hero",
              bounds: { x: 24, y: 32, w: 900, h: 320 },
              styles: { display: "grid", gap: "16px" },
              children: [
                {
                  selector: "h1",
                  tag: "h1",
                  bounds: { x: 40, y: 48, w: 220, h: 52 },
                  styles: { fontSize: "32px", fontWeight: "700" },
                  text: "Markets",
                },
                {
                  selector: "a",
                  tag: "a",
                  bounds: { x: 40, y: 120, w: 100, h: 24 },
                  styles: { color: "rgb(41, 98, 255)" },
                  text: "Calendar",
                  href: "/calendar",
                },
              ],
            },
          ],
        },
      ],
    })

    expect(() => WebClonePageIrSchema.parse(pageIr)).not.toThrow()
    expect(pageIr.stats.layoutElements).toBe(4)
    expect(pageIr.stats.layoutMatchedElements).toBe(4)
    const serialized = JSON.stringify(pageIr)
    expect(serialized).toContain('"sourcePath"')
    expect(serialized).toContain('"selector":"section.hero"')
    expect(serialized).toContain('"bounds":{"x":24,"y":32,"w":900,"h":320}')
    expect(serialized).toContain('"fontSize":"32px"')
    expect(serialized).toContain('"href":"/calendar"')
  })
})
