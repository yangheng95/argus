type IconHtmlRenderer = (input: { name: string; size: number; className?: string }) => string

let iconHtmlRenderer: IconHtmlRenderer | undefined

export function installIconHtmlRenderer(renderer: IconHtmlRenderer): () => void {
  iconHtmlRenderer = renderer
  return () => {
    if (iconHtmlRenderer === renderer) iconHtmlRenderer = undefined
  }
}

export function iconHtml(name: string, size = 16, className?: string): string {
  if (!iconHtmlRenderer) throw new Error("iconHtml renderer has not been installed")
  const safeSize = Number.isFinite(size) && size > 0 ? size : 16
  return iconHtmlRenderer({ name, size: safeSize, className })
}

export function hydrateIconPlaceholders(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-oc-icon]")) {
    const name = node.dataset.ocIcon
    if (!name) continue
    const size = Number(node.dataset.ocIconSize || "16")
    node.innerHTML = iconHtml(name, Number.isFinite(size) ? size : 16)
  }
}
