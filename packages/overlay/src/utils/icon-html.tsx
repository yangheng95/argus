import { render } from "solid-js/web"
import { Icon, type IconName } from "../components/Icon"

export function iconHtml(name: IconName, size = 16, className?: string): string {
  const host = document.createElement("span")
  const dispose = render(() => <Icon name={name} size={size} class={className} />, host)
  const html = host.innerHTML
  dispose()
  return html
}

export function hydrateIconPlaceholders(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-oc-icon]")) {
    const name = node.dataset.ocIcon as IconName | undefined
    if (!name) continue
    const size = Number(node.dataset.ocIconSize || "16")
    node.innerHTML = iconHtml(name, Number.isFinite(size) ? size : 16)
  }
}
