const IMAGE_PREVIEW_TRIGGER_BASE_LABEL = "Open image preview"

export function imagePreviewTriggerLabel(alt?: string): string {
  const label = alt?.trim() ?? ""
  return label ? `${IMAGE_PREVIEW_TRIGGER_BASE_LABEL}: ${label}` : IMAGE_PREVIEW_TRIGGER_BASE_LABEL
}
