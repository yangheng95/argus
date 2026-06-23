import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { calculateImagePreviewFitScale, calculateImagePreviewOpenScale } from "../src/utils/image-preview-scale"
import { imagePreviewTriggerLabel } from "../src/utils/image-preview-label"
import { imagePreviewTriggerHtmlAttributes } from "../src/utils/image-preview-trigger"
import { setLocale, setLocaleData } from "../src/utils/i18n"
import { renderMarkdown } from "../src/utils/markdown"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const IMAGE_PREVIEW_I18N_KEYS = [
  "image_preview.title",
  "image_preview.open_trigger",
  "image_preview.open_trigger_with_alt",
  "image_preview.controls",
  "image_preview.zoom_out",
  "image_preview.current_zoom",
  "image_preview.zoom_in",
  "image_preview.fit_width",
  "image_preview.fit_width_short",
  "image_preview.fit_image_title",
  "image_preview.fit_image",
  "image_preview.fit_image_short",
  "image_preview.original_size",
  "image_preview.copy_image",
  "image_preview.copy_status.copied",
  "image_preview.copy_status.loading",
  "image_preview.copy_status.clipboard_unavailable",
  "image_preview.copy_status.source_unavailable",
  "image_preview.copy_status.png_required",
  "image_preview.copy_status.clipboard_blocked",
] as const
const RETIRED_IMAGE_PREVIEW_LITERALS = [
  "Image preview",
  "Image preview controls",
  "Zoom out",
  "Current zoom",
  "Zoom in",
  "Fit width",
  "Fit whole image",
  "Fit image",
  "Original size",
  "Copy image",
  "Copy failed: image loading",
  "Copy failed: clipboard unavailable",
  "Copy failed: source bytes unavailable",
  "Copy failed: PNG source required",
  "Copy failed: clipboard blocked",
] as const

function read(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>
}

setLocaleData("en-US", readJson("src/i18n/en-US.json"))
setLocaleData("zh-CN", readJson("src/i18n/zh-CN.json"))
await setLocale("en-US")

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? ""
}

function escapeTestAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

describe("message image preview", () => {
  test("markdown images emit preview trigger metadata", async () => {
    await setLocale("en-US")
    const html = renderMarkdown("![tiny](https://example.com/tiny.png)")
    const expectedAttrs = imagePreviewTriggerHtmlAttributes(
      { src: "https://example.com/tiny.png", alt: "tiny" },
      escapeTestAttr,
    )

    expect(html).toContain(`<button ${expectedAttrs}>`)
    expect(html).toContain('data-image-preview-trigger="true"')
    expect(html).toContain('class="oc-button msg-image-trigger"')
    expect(html).toContain('data-ui="image-preview-trigger"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="md"')
    expect(html).toContain('data-tone="neutral"')
    expect(html).toContain('data-image-preview-src="https://example.com/tiny.png"')
    expect(html).toContain('data-image-preview-alt="tiny"')
    expect(html).toContain('title="Open image preview: tiny"')
    expect(html).toContain('aria-label="Open image preview: tiny"')
    expect(html).not.toMatch(/aria-label="Open image preview"/)
    expect(html).toContain('class="md-img"')
  })

  test("markdown image preview labels follow the active locale", async () => {
    await setLocale("zh-CN")
    const html = renderMarkdown("![tiny](https://example.com/tiny.png)")

    expect(imagePreviewTriggerLabel("tiny")).toBe("打开图片预览：tiny")
    expect(imagePreviewTriggerLabel("")).toBe("打开图片预览")
    expect(html).toContain('title="打开图片预览：tiny"')
    expect(html).toContain('aria-label="打开图片预览：tiny"')
    expect(html).not.toContain("Open image preview")
    await setLocale("en-US")
  })

  test("image preview trigger labels include alt text from one i18n helper", async () => {
    await setLocale("en-US")
    expect(imagePreviewTriggerLabel("tiny")).toBe("Open image preview: tiny")
    expect(imagePreviewTriggerLabel("  browser evidence  ")).toBe("Open image preview: browser evidence")
    expect(imagePreviewTriggerLabel("")).toBe("Open image preview")

    const component = read("src/components/ImagePreview.tsx")
    const labelHelper = read("src/utils/image-preview-label.ts")
    const triggerHelper = read("src/utils/image-preview-trigger.ts")
    const markdown = read("src/utils/markdown.ts")
    expect(component).toContain("imagePreviewTriggerContract({ src: props.src, alt: alt() })")
    expect(component).toContain("previewLoader?: PreviewImageLoader")
    expect(component).toContain("const delegatedPreview = () => !props.previewLoader")
    expect(component).toContain(
      "const loadPreviewSource = async () => (props.previewLoader ? await props.previewLoader() : props.src)",
    )
    expect(component).toContain("openImagePreview(await loadPreviewSource(), alt())")
    expect(component).toContain("notifyError({")
    expect(component).toContain("<Button")
    expect(component).toContain("data-ui={trigger().dataUi}")
    expect(component).toContain("data-image-preview-trigger={delegatedPreview() ? trigger().triggerFlag : undefined}")
    expect(markdown).toContain('imagePreviewTriggerHtmlAttributes({ src, alt: text || "" }, escapeAttr)')
    expect(markdown).not.toContain('class="oc-button msg-image-trigger"')
    expect(markdown).not.toContain('data-ui="image-preview-trigger"')
    expect(markdown).not.toContain('data-image-preview-trigger="true"')
    expect(markdown).not.toContain('data-image-preview-src="')
    expect(triggerHelper).toContain('IMAGE_PREVIEW_TRIGGER_DATA_UI = "image-preview-trigger"')
    expect(triggerHelper).toContain('IMAGE_PREVIEW_TRIGGER_VARIANT = "ghost"')
    expect(triggerHelper).toContain("imagePreviewTriggerHtmlAttributes")
    expect(labelHelper).toContain('t("image_preview.open_trigger_with_alt"')
    expect(labelHelper).toContain('t("image_preview.open_trigger")')
    expect(labelHelper).not.toContain('"Open image preview"')
    expect(component).not.toMatch(/aria-label="Open image preview"/)
    expect(markdown).not.toMatch(/aria-label="Open image preview"/)
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
    const app = read("src/components/App.tsx")

    expect(source).toContain('target.closest<HTMLElement>("[data-image-preview-trigger]")')
    expect(source).toContain("openImagePreview(src, alt)")
    expect(source).not.toContain("<ImagePreviewHost />")
    expect(app).toContain("<ImagePreviewHost />")
    expect(app).toContain('id="imagePreviewHost"')
  })

  test("message thumbnails keep intrinsic size while capped by max bounds", () => {
    const markdownCss = read("src/styles/surfaces/markdown.css")
    const messagesCss = read("src/styles/surfaces/messages.css")
    const mdImg = block(markdownCss, ".md-img")
    const trigger = block(messagesCss, '.oc-button[data-ui="image-preview-trigger"].msg-image-trigger')

    expect(mdImg).toContain("width: auto;")
    expect(mdImg).toContain("height: auto;")
    expect(mdImg).toContain("max-width: min(100%, calc(720px * var(--ui-scale)));")
    expect(mdImg).toContain("max-height: calc(420px * var(--ui-scale));")
    expect(trigger).toContain("--oc-button-height: auto;")
    expect(trigger).toContain("--oc-button-padding-x: 0;")
    expect(trigger).toContain("cursor: zoom-in;")
    expect(messagesCss).not.toMatch(/(^|\n)\.msg-image-trigger:focus-visible\s*\{/)
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

  test("browser evidence title uses the shared strong font-weight token", () => {
    const messagesCss = read("src/styles/surfaces/messages.css")
    const title = block(messagesCss, ".msg-browser-evidence__title")

    expect(title).toContain("font-weight: var(--ui-font-weight-strong);")
    expect(title).not.toMatch(/font-weight:\s*[0-9]+;/)
  })

  test("modal preview owns zoom controls and does not cap the image to thumbnail size", () => {
    const component = read("src/components/ImagePreview.tsx")
    const labelHelper = read("src/utils/image-preview-label.ts")
    const css = read("src/styles/surfaces/messages.css")
    const form = block(css, ".dialog .image-preview-dialog__form")
    const body = block(css, ".image-preview-dialog__body")
    const stage = block(css, ".image-preview-dialog__stage")
    const image = block(css, ".image-preview-dialog__image")
    const copyStatus = block(css, ".image-preview-dialog__copy-status")

    expect(component).toContain("event.stopPropagation()")
    expect(component).toContain("void handlePreviewOpen(event)")
    const scaleHelper = read("src/utils/image-preview-scale.ts")
    expect(scaleHelper).toContain("IMAGE_PREVIEW_MIN_SCALE = 0.02")
    expect(scaleHelper).toContain("IMAGE_PREVIEW_MAX_SCALE = 8")
    for (const key of IMAGE_PREVIEW_I18N_KEYS) {
      const owner = key.startsWith("image_preview.open_trigger") ? labelHelper : component
      expect(owner).toContain(`"${key}"`)
    }
    for (const literal of RETIRED_IMAGE_PREVIEW_LITERALS) {
      expect(component).not.toContain(`"${literal}"`)
    }
    expect(component).toContain('aria-label={t("image_preview.zoom_in")}')
    expect(component).toContain('aria-label={t("image_preview.zoom_out")}')
    expect(component).toContain('aria-label={t("image_preview.fit_width")}')
    expect(component).toContain('aria-label={t("image_preview.fit_image")}')
    expect(component).toContain('aria-label={t("image_preview.original_size")}')
    expect(component).toContain('aria-label={t("image_preview.copy_image")}')
    expect(component).toContain("calculateImagePreviewOpenScale")
    expect(component).toContain("calculateImagePreviewFitScale")
    expect(component).toContain("onPointerDown={startPan}")
    expect(component).toContain('bodyRef.addEventListener("wheel", handleWheel, { passive: false })')
    expect(component).toContain('bodyRef?.removeEventListener("wheel", handleWheel)')
    expect(component).toContain("event.stopPropagation()")
    expect(component).toContain("!event.ctrlKey && !event.metaKey")
    expect(component).not.toContain("onWheel={handleWheel}")
    expect(component).toContain("const applyWheelScaleOnFrame = createAnimationFrameScheduler")
    expect(component).toContain("pendingWheelScale = {")
    expect(component).toContain("applyWheelScaleOnFrame.schedule()")
    expect(component).not.toContain("viewportSizeValue")
    expect(component).not.toContain("bodyGeometry?.viewportSize ?? viewportSizeValue")
    const wheelHandlerStart = component.indexOf("function handleWheel")
    const wheelHandlerEnd = component.indexOf("function startPan", wheelHandlerStart)
    expect(wheelHandlerStart).toBeGreaterThan(0)
    expect(wheelHandlerEnd).toBeGreaterThan(wheelHandlerStart)
    const wheelHandler = component.slice(wheelHandlerStart, wheelHandlerEnd)
    expect(wheelHandler).not.toContain("getBoundingClientRect")
    expect(wheelHandler).not.toContain("clientWidth")
    expect(wheelHandler).not.toContain("clientHeight")
    expect(wheelHandler).not.toContain("applyScale(")
    expect(form).toContain("width: min(calc(1040px * var(--ui-scale)), calc(100cqw - calc(72px * var(--ui-scale))));")
    expect(form).toContain("max-width: calc(100cqw - calc(32px * var(--ui-scale)));")
    expect(form).toContain("height: min(calc(760px * var(--ui-scale)), calc(var(--ui-overlay-shell-height) * 0.78));")
    expect(form).toContain("max-height: calc(var(--ui-overlay-shell-height) - calc(72px * var(--ui-scale)));")
    expect(form).not.toContain("100vh")
    expect(form).not.toContain("78vh")
    expect(form).not.toContain("100vw")
    expect(form).not.toContain("width: calc(100vw - calc(16px * var(--ui-scale)));")
    expect(body).toContain("overflow: auto;")
    expect(body).toContain("cursor: grab;")
    expect(body).toContain("scrollbar-gutter: stable both-edges;")
    expect(stage).toContain("width: max(100%, var(--image-preview-rendered-width, 0px));")
    expect(stage).toContain("height: max(100%, var(--image-preview-rendered-height, 0px));")
    expect(image).toContain("width: var(--image-preview-rendered-width, auto);")
    expect(image).toContain("height: var(--image-preview-rendered-height, auto);")
    expect(image).toContain("max-width: none;")
    expect(image).not.toContain("transform: scale")
    expect(copyStatus).toContain("overflow-wrap: anywhere;")
    expect(copyStatus).toContain("max-width: min(calc(240px * var(--ui-scale)), 52cqw);")
    expect(copyStatus).not.toContain("52vw")
  })

  test("modal preview dialog labels are localized from complete locale bundles", () => {
    const enUS = readJson("src/i18n/en-US.json")
    const zhCN = readJson("src/i18n/zh-CN.json")

    for (const key of IMAGE_PREVIEW_I18N_KEYS) {
      expect(enUS[key]).toEqual(expect.any(String))
      expect(zhCN[key]).toEqual(expect.any(String))
      expect(enUS[key]).not.toBe(key)
      expect(zhCN[key]).not.toBe(key)
    }
    expect(enUS["image_preview.copy_image"]).toBe("Copy image")
    expect(zhCN["image_preview.copy_image"]).toBe("复制图片")
    expect(enUS["image_preview.open_trigger_with_alt"]).toBe("Open image preview: {{alt}}")
    expect(zhCN["image_preview.open_trigger_with_alt"]).toBe("打开图片预览：{{alt}}")
    expect(enUS["image_preview.copy_status.clipboard_unavailable"]).toBe("Copy failed: clipboard unavailable")
    expect(zhCN["image_preview.copy_status.clipboard_unavailable"]).toBe("复制失败：剪贴板不可用")
  })

  test("modal preview copies fetched PNG bytes without canvas fallback", () => {
    const component = read("src/components/ImagePreview.tsx")

    expect(component).toContain("navigator.clipboard?.write")
    expect(component).not.toContain("navigator.clipboard?.writeText")
    expect(component).toContain("fetchPreviewImageBlob")
    expect(component).toContain("fetch(src)")
    expect(component).not.toContain("canvasPreviewImageBlob")
    expect(component).not.toContain("canvas.toBlob")
    expect(component).not.toContain("catch(() => undefined)")
    expect(component).toContain('"image/png"')
    expect(component).toContain("new ClipboardItem")
    expect(component).toContain("readonly key: ImageCopyFeedbackKey")
    expect(component).toContain('setCopyFeedback({ tone: "success", key: IMAGE_COPY_SUCCESS_KEY })')
    expect(component).toContain("imageCopyStatusText(feedback().key)")
    expect(component).toContain('role={feedback().tone === "error" ? "alert" : "status"}')
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
