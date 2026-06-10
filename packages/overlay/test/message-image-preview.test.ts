import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { calculateImagePreviewFitScale, calculateImagePreviewOpenScale } from "../src/utils/image-preview-scale"
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

    expect(source).toContain('import { PreviewableImage } from "./ImagePreview"')
    expect(source).toContain("<PreviewableImage src={resolveResourceUrl(url())} alt={name()} />")
    expect(source).toContain("<PreviewableImage src={resolved()} alt={props.alt} />")
  })

  test("browser evidence screenshots use the shared previewable image component", () => {
    const source = read("src/components/InlineToolPart.tsx")

    expect(source).toContain('import { PreviewableImage } from "./ImagePreview"')
    expect(source).toContain("<PreviewableImage")
    expect(source).toContain('imageClass="msg-browser-evidence__image"')
    expect(source).toContain('triggerClass="msg-browser-evidence__trigger"')
    expect(source).not.toContain('class="msg-browser-evidence__image"')
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

  test("browser evidence thumbnails keep intrinsic size while capped by the evidence column", () => {
    const messagesCss = read("src/styles/surfaces/messages.css")
    const image = block(messagesCss, ".msg-browser-evidence__image")
    const trigger = block(messagesCss, ".msg-browser-evidence__trigger")

    expect(image).toContain("width: auto;")
    expect(image).toContain("height: auto;")
    expect(image).toContain("max-width: 100%;")
    expect(image).toContain("max-height: calc(160px * var(--ui-scale));")
    expect(trigger).toContain("justify-self: start;")
  })

  test("modal preview owns zoom controls and does not cap the image to thumbnail size", () => {
    const component = read("src/components/ImagePreview.tsx")
    const css = read("src/styles/surfaces/messages.css")
    const form = block(css, ".dialog .image-preview-dialog__form")
    const body = block(css, ".image-preview-dialog__body")
    const stage = block(css, ".image-preview-dialog__stage")
    const image = block(css, ".image-preview-dialog__image")

    expect(component).toContain("event.stopPropagation()")
    const scaleHelper = read("src/utils/image-preview-scale.ts")
    expect(scaleHelper).toContain("IMAGE_PREVIEW_MIN_SCALE = 0.02")
    expect(scaleHelper).toContain("IMAGE_PREVIEW_MAX_SCALE = 8")
    expect(component).toContain('aria-label="Zoom in"')
    expect(component).toContain('aria-label="Zoom out"')
    expect(component).toContain('aria-label="Fit width"')
    expect(component).toContain('aria-label="Fit image"')
    expect(component).toContain('aria-label="Original size"')
    expect(component).toContain('aria-label="Copy image"')
    expect(component).toContain("calculateImagePreviewOpenScale")
    expect(component).toContain("calculateImagePreviewFitScale")
    expect(component).toContain("onPointerDown={startPan}")
    expect(component).toContain("onWheel={handleWheel}")
    expect(form).toContain("width: calc(100vw - calc(16px * var(--ui-scale)));")
    expect(form).toContain("height: calc(100vh - calc(16px * var(--ui-scale)));")
    expect(body).toContain("overflow: auto;")
    expect(body).toContain("cursor: grab;")
    expect(body).toContain("scrollbar-gutter: stable both-edges;")
    expect(stage).toContain("width: max(100%, var(--image-preview-rendered-width, 0px));")
    expect(stage).toContain("height: max(100%, var(--image-preview-rendered-height, 0px));")
    expect(image).toContain("width: var(--image-preview-rendered-width, auto);")
    expect(image).toContain("height: var(--image-preview-rendered-height, auto);")
    expect(image).toContain("max-width: none;")
    expect(image).not.toContain("transform: scale")
  })

  test("modal preview copies image bytes instead of the image url", () => {
    const component = read("src/components/ImagePreview.tsx")

    expect(component).toContain("navigator.clipboard?.write")
    expect(component).not.toContain("navigator.clipboard?.writeText")
    expect(component).toContain('canvas.toBlob')
    expect(component).toContain('"image/png"')
    expect(component).toContain("new ClipboardItem")
    expect(component).toContain("onClick={() => void copyPreviewImage()}")
  })

  test("modal preview opens tall screenshots at readable width and keeps whole-image fit explicit", () => {
    expect(calculateImagePreviewFitScale({ width: 600, height: 1800 }, { width: 900, height: 720 })).toBe(0.4)
    expect(calculateImagePreviewOpenScale({ width: 600, height: 1800 }, { width: 900, height: 720 })).toBe(1)
    expect(calculateImagePreviewOpenScale({ width: 1200, height: 3600 }, { width: 900, height: 720 })).toBe(0.75)
    expect(calculateImagePreviewOpenScale({ width: 1200, height: 800 }, { width: 900, height: 720 })).toBe(0.75)
    expect(calculateImagePreviewFitScale({ width: 600, height: 400 }, { width: 900, height: 720 })).toBe(1)
    expect(calculateImagePreviewFitScale({ width: 0, height: 400 }, { width: 900, height: 720 })).toBe(1)
  })
})
