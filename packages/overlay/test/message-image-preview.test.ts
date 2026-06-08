import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderMarkdown } from "../src/utils/markdown"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? ""
}

describe("message image preview", () => {
  test("markdown images emit preview trigger metadata", () => {
    const html = renderMarkdown("![tiny](https://example.com/tiny.png)")

    expect(html).toContain('data-image-preview-trigger="true"')
    expect(html).toContain('data-image-preview-src="https://example.com/tiny.png"')
    expect(html).toContain('data-image-preview-alt="tiny"')
    expect(html).toContain('class="md-img"')
  })

  test("file image parts use the shared previewable image component", () => {
    const source = read("src/components/FilePart.tsx")

    expect(source).toContain('import { PreviewableImage } from "./ImagePreview";')
    expect(source).toContain("<PreviewableImage src={resolveResourceUrl(url())} alt={name()} />")
    expect(source).toContain("<PreviewableImage src={resolved()} alt={props.alt} />")
  })

  test("markdown delegated clicks open the shared image preview", () => {
    const source = read("src/main.tsx")

    expect(source).toContain('target.closest<HTMLElement>("[data-image-preview-trigger]")')
    expect(source).toContain("openImagePreview(src, alt)")
    expect(source).toContain("<ImagePreviewHost />")
  })

  test("message thumbnails keep intrinsic size while capped by max bounds", () => {
    const markdownCss = read("src/styles/surfaces/markdown.css")
    const messagesCss = read("src/styles/surfaces/messages.css")
    const mdImg = block(markdownCss, ".md-img")
    const trigger = block(messagesCss, ".msg-image-trigger")

    expect(mdImg).toContain("width: auto;")
    expect(mdImg).toContain("height: auto;")
    expect(mdImg).toContain("max-width: min(100%, calc(720px * var(--ui-scale)));")
    expect(mdImg).toContain("max-height: calc(420px * var(--ui-scale));")
    expect(trigger).toContain("display: inline-flex;")
    expect(trigger).toContain("cursor: zoom-in;")
  })

  test("modal preview owns zoom controls and does not cap the image to thumbnail size", () => {
    const component = read("src/components/ImagePreview.tsx")
    const css = read("src/styles/surfaces/messages.css")
    const image = block(css, ".image-preview-dialog__image")

    expect(component).toContain("event.stopPropagation()")
    expect(component).toContain("const MIN_SCALE = 0.25")
    expect(component).toContain("const MAX_SCALE = 4")
    expect(component).toContain('aria-label="Zoom in"')
    expect(component).toContain('aria-label="Zoom out"')
    expect(component).toContain('aria-label="Reset zoom"')
    expect(image).toContain("max-width: none;")
    expect(image).toContain("transform: scale(var(--image-preview-scale, 1));")
  })
})
