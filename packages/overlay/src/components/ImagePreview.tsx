import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { closeImagePreview, imagePreviewState, openImagePreview } from "../services/image-preview"
import {
  calculateImagePreviewFitScale,
  calculateImagePreviewOpenScale,
  calculateImagePreviewWidthScale,
  clampImagePreviewScale,
  type ImagePreviewSize,
} from "../utils/image-preview-scale"
import { Dialog } from "./primitives/Dialog"
import { Button } from "./ui/Button"
import { Icon } from "./Icon"

const SCALE_STEP = 0.25
const IMAGE_COPY_SUCCESS_MESSAGE = "Copied"
const IMAGE_COPY_LOADING_MESSAGE = "Copy failed: image loading"
const IMAGE_COPY_CLIPBOARD_UNAVAILABLE_MESSAGE = "Copy failed: clipboard unavailable"
const IMAGE_COPY_SOURCE_MESSAGE = "Copy failed: source bytes unavailable"
const IMAGE_COPY_FORMAT_MESSAGE = "Copy failed: PNG source required"
const IMAGE_COPY_BLOCKED_MESSAGE = "Copy failed: clipboard blocked"

type CopyFeedback = {
  tone: "success" | "error"
  message: string
}

class ImageCopyError extends Error {}

export function PreviewableImage(props: { src: string; alt?: string; triggerClass?: string; imageClass?: string }) {
  const alt = () => props.alt || ""
  const triggerClass = () => ["msg-image-trigger", props.triggerClass].filter(Boolean).join(" ")
  const imageClass = () => ["md-img", props.imageClass].filter(Boolean).join(" ")

  return (
    <button
      type="button"
      class={triggerClass()}
      data-image-preview-trigger="true"
      title="Open image preview"
      aria-label="Open image preview"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        openImagePreview(props.src, alt())
      }}
    >
      <img class={imageClass()} src={props.src} alt={alt()} loading="lazy" />
    </button>
  )
}

export function ImagePreviewHost() {
  const [scale, setScale] = createSignal(1)
  const [imageSize, setImageSize] = createSignal<ImagePreviewSize>({ width: 0, height: 0 })
  const [copyInFlight, setCopyInFlight] = createSignal(false)
  const [copyFeedback, setCopyFeedback] = createSignal<CopyFeedback | null>(null)
  const [panStart, setPanStart] = createSignal<{
    pointerID: number
    x: number
    y: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  let bodyRef: HTMLDivElement | undefined
  let imageRef: HTMLImageElement | undefined
  let resizeObserver: ResizeObserver | undefined

  createEffect(() => {
    const state = imagePreviewState()
    if (!state.open) return
    setScale(1)
    setImageSize({ width: 0, height: 0 })
    setCopyInFlight(false)
    setCopyFeedback(null)
    setPanStart(null)
    queueMicrotask(() => {
      if (imageRef?.complete) measureLoadedImage(imageRef)
    })
  })

  createEffect(() => {
    const body = bodyRef
    if (!body) return
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(() => {
      const openScale = previewOpenScale()
      if (imagePreviewState().open && imageSize().width > 0 && scale() < openScale) setScale(openScale)
    })
    resizeObserver.observe(body)
  })

  onCleanup(() => resizeObserver?.disconnect())

  const renderedSize = createMemo(() => {
    const size = imageSize()
    return {
      width: size.width * scale(),
      height: size.height * scale(),
    }
  })

  const fitScale = () => calculateImagePreviewFitScale(imageSize(), viewportSize())
  const widthScale = () => calculateImagePreviewWidthScale(imageSize(), viewportSize())
  const previewOpenScale = () => calculateImagePreviewOpenScale(imageSize(), viewportSize())
  const scaleLabel = () => `${Math.round(scale() * 100)}%`
  const stageStyle = () => {
    const rendered = renderedSize()
    return rendered.width > 0 && rendered.height > 0
      ? ({
          "--image-preview-rendered-width": `${rendered.width}px`,
          "--image-preview-rendered-height": `${rendered.height}px`,
        } as Record<string, string>)
      : undefined
  }

  function viewportSize(): ImagePreviewSize {
    const body = bodyRef
    if (!body) return { width: 0, height: 0 }
    const styles = window.getComputedStyle(body)
    const paddingX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight)
    const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
    return {
      width: Math.max(0, body.clientWidth - paddingX),
      height: Math.max(0, body.clientHeight - paddingY),
    }
  }

  function measureLoadedImage(image: HTMLImageElement): void {
    const nextSize = {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    }
    setImageSize(nextSize)
    setScale(calculateImagePreviewOpenScale(nextSize, viewportSize()))
    requestAnimationFrame(() => {
      if (!bodyRef) return
      bodyRef.scrollLeft = 0
      bodyRef.scrollTop = 0
    })
  }

  function applyScale(nextScale: number, anchor?: { x: number; y: number }): void {
    const body = bodyRef
    const size = imageSize()
    const previousScale = scale()
    const resolvedScale = clampImagePreviewScale(nextScale)
    if (!body || size.width <= 0 || size.height <= 0) {
      setScale(resolvedScale)
      return
    }

    const anchorX = anchor?.x ?? body.clientWidth / 2
    const anchorY = anchor?.y ?? body.clientHeight / 2
    const ratioX = (body.scrollLeft + anchorX) / Math.max(1, size.width * previousScale)
    const ratioY = (body.scrollTop + anchorY) / Math.max(1, size.height * previousScale)

    setScale(resolvedScale)
    requestAnimationFrame(() => {
      body.scrollLeft = ratioX * size.width * resolvedScale - anchorX
      body.scrollTop = ratioY * size.height * resolvedScale - anchorY
    })
  }

  function setFitScale(): void {
    applyScale(fitScale(), { x: 0, y: 0 })
    requestAnimationFrame(() => {
      if (!bodyRef) return
      bodyRef.scrollLeft = 0
      bodyRef.scrollTop = 0
    })
  }

  function setWidthScale(): void {
    applyScale(widthScale(), { x: 0, y: 0 })
    requestAnimationFrame(() => {
      if (!bodyRef) return
      bodyRef.scrollLeft = 0
      bodyRef.scrollTop = 0
    })
  }

  function setOriginalScale(): void {
    applyScale(1, { x: 0, y: 0 })
    requestAnimationFrame(() => {
      if (!bodyRef) return
      bodyRef.scrollLeft = 0
      bodyRef.scrollTop = 0
    })
  }

  function updateScale(delta: number): void {
    applyScale(scale() + delta)
  }

  async function fetchPreviewImageBlob(): Promise<Blob> {
    const src = imagePreviewState().src
    if (!src) throw new ImageCopyError(IMAGE_COPY_SOURCE_MESSAGE)
    let response: Response
    try {
      response = await fetch(src)
    } catch {
      throw new ImageCopyError(IMAGE_COPY_SOURCE_MESSAGE)
    }
    if (!response.ok) throw new ImageCopyError(IMAGE_COPY_SOURCE_MESSAGE)
    const blob = await response.blob().catch(() => {
      throw new ImageCopyError(IMAGE_COPY_SOURCE_MESSAGE)
    })
    if (blob.type.toLowerCase() !== "image/png") throw new ImageCopyError(IMAGE_COPY_FORMAT_MESSAGE)
    return blob
  }

  function copyErrorMessage(error: unknown): string {
    return error instanceof ImageCopyError ? error.message : IMAGE_COPY_BLOCKED_MESSAGE
  }

  async function copyPreviewImage(): Promise<void> {
    const image = imageRef
    const clipboardWrite = navigator.clipboard?.write
    setCopyFeedback(null)
    if (!image || !image.complete || imageSize().width <= 0 || imageSize().height <= 0) {
      setCopyFeedback({ tone: "error", message: IMAGE_COPY_LOADING_MESSAGE })
      return
    }
    if (!clipboardWrite || typeof ClipboardItem === "undefined") {
      setCopyFeedback({ tone: "error", message: IMAGE_COPY_CLIPBOARD_UNAVAILABLE_MESSAGE })
      return
    }

    setCopyInFlight(true)
    try {
      const blob = await fetchPreviewImageBlob()
      await clipboardWrite.call(navigator.clipboard, [new ClipboardItem({ "image/png": blob })])
      setCopyFeedback({ tone: "success", message: IMAGE_COPY_SUCCESS_MESSAGE })
    } catch (error) {
      setCopyFeedback({ tone: "error", message: copyErrorMessage(error) })
    } finally {
      setCopyInFlight(false)
    }
  }

  function handleWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return
    const body = bodyRef
    if (!body) return
    event.preventDefault()
    const rect = body.getBoundingClientRect()
    const direction = event.deltaY > 0 ? -1 : 1
    applyScale(scale() + direction * SCALE_STEP, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
  }

  function startPan(event: PointerEvent): void {
    const body = bodyRef
    if (!body || event.button !== 0 || event.isPrimary === false) return
    event.preventDefault()
    body.setPointerCapture(event.pointerId)
    setPanStart({
      pointerID: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: body.scrollLeft,
      scrollTop: body.scrollTop,
    })
  }

  function movePan(event: PointerEvent): void {
    const body = bodyRef
    const start = panStart()
    if (!body || !start || start.pointerID !== event.pointerId) return
    body.scrollLeft = start.scrollLeft - (event.clientX - start.x)
    body.scrollTop = start.scrollTop - (event.clientY - start.y)
  }

  function stopPan(event: PointerEvent): void {
    const body = bodyRef
    const start = panStart()
    if (!body || !start || start.pointerID !== event.pointerId) return
    body.releasePointerCapture(event.pointerId)
    setPanStart(null)
  }

  return (
    <Dialog
      id="imagePreviewDialog"
      class="image-preview-dialog"
      formClass="image-preview-dialog__form"
      open={imagePreviewState().open}
      title={imagePreviewState().alt || "Image preview"}
      onClose={closeImagePreview}
      headerActions={
        <div class="image-preview-dialog__toolbar" role="toolbar" aria-label="Image preview controls">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => updateScale(-SCALE_STEP)}
          >
            <Icon name="minimize" size={13} />
          </Button>
          <span class="image-preview-dialog__scale" role="status" aria-label="Current zoom">
            {scaleLabel()}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => updateScale(SCALE_STEP)}
          >
            <Icon name="maximize" size={13} />
          </Button>
          <span class="image-preview-dialog__separator" aria-hidden="true" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            tone="neutral"
            title="Fit width"
            aria-label="Fit width"
            onClick={setWidthScale}
          >
            Width
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            tone="neutral"
            title="Fit whole image"
            aria-label="Fit image"
            onClick={setFitScale}
          >
            Fit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            tone="neutral"
            title="Original size"
            aria-label="Original size"
            onClick={setOriginalScale}
          >
            1:1
          </Button>
          <span class="image-preview-dialog__separator" aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            title="Copy image"
            aria-label="Copy image"
            disabled={copyInFlight()}
            onClick={() => void copyPreviewImage()}
          >
            <Icon name="copy" size={13} />
          </Button>
          <Show when={copyFeedback()}>
            {(feedback) => (
              <span
                class="image-preview-dialog__copy-status"
                data-status={feedback().tone}
                role={feedback().tone === "error" ? "alert" : "status"}
                aria-live={feedback().tone === "error" ? "assertive" : "polite"}
              >
                {feedback().message}
              </span>
            )}
          </Show>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            title="Close"
            aria-label="Close"
            onClick={closeImagePreview}
          >
            <Icon name="close" size={13} />
          </Button>
        </div>
      }
    >
      <div
        class="image-preview-dialog__body"
        data-panning={panStart() ? "true" : "false"}
        ref={(element) => {
          bodyRef = element
        }}
        onWheel={handleWheel}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        <div class="image-preview-dialog__stage" style={stageStyle()}>
          <img
            class="image-preview-dialog__image"
            src={imagePreviewState().src}
            alt={imagePreviewState().alt}
            ref={(element) => {
              imageRef = element
            }}
            onLoad={(event) => measureLoadedImage(event.currentTarget)}
          />
        </div>
      </div>
    </Dialog>
  )
}
