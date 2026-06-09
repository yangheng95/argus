import { createEffect, createSignal } from "solid-js"
import { closeImagePreview, imagePreviewState, openImagePreview } from "../services/image-preview"
import { Dialog } from "./primitives/Dialog"
import { Button } from "./ui/Button"
import { Icon } from "./Icon"

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const SCALE_STEP = 0.25

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(value) ? value : 1))
}

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

  createEffect(() => {
    if (imagePreviewState().open) setScale(1)
  })

  const updateScale = (delta: number) => setScale((current) => clampScale(current + delta))
  const scaleLabel = () => `${Math.round(scale() * 100)}%`

  return (
    <Dialog
      id="imagePreviewDialog"
      class="image-preview-dialog"
      formClass="image-preview-dialog__form"
      open={imagePreviewState().open}
      title={imagePreviewState().alt || "Image preview"}
      onClose={closeImagePreview}
      draggable={false}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            tone="neutral"
            title="Reset zoom"
            aria-label="Reset zoom"
            onClick={() => setScale(1)}
          >
            {scaleLabel()}
          </Button>
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
      <div class="image-preview-dialog__body">
        <img
          class="image-preview-dialog__image"
          src={imagePreviewState().src}
          alt={imagePreviewState().alt}
          style={{ "--image-preview-scale": String(scale()) }}
        />
      </div>
    </Dialog>
  )
}
