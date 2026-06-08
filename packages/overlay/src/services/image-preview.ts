import { createSignal } from "solid-js"

export interface ImagePreviewState {
  open: boolean
  src: string
  alt: string
}

const [imagePreviewState, setImagePreviewState] = createSignal<ImagePreviewState>({
  open: false,
  src: "",
  alt: "",
})

export { imagePreviewState }

export function openImagePreview(src: string, alt = ""): void {
  if (!src) return
  setImagePreviewState({ open: true, src, alt })
}

export function closeImagePreview(): void {
  setImagePreviewState({ open: false, src: "", alt: "" })
}
