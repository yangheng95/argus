import { render } from "solid-js/web"
import { Icon, LUCIDE_ICON_NAMES, REGISTERED_ICONS, type IconName } from "../components/Icon"

const REGISTERED_ICON_NAMES = new Set<string>(REGISTERED_ICONS)
const LUCIDE_ICON_NAME_SET = new Set<string>(LUCIDE_ICON_NAMES)

function iconName(name: string): IconName {
  if (!REGISTERED_ICON_NAMES.has(name)) throw new Error(`Unknown icon "${name}"`)
  return name as IconName
}

function iconClassName(name: string, className?: string): string {
  if (LUCIDE_ICON_NAME_SET.has(name)) return className ?? ""
  return ["lucide", `lucide-${name}`, className].filter(Boolean).join(" ")
}

export function iconHtml(name: string, size = 16, className?: string): string {
  if (typeof document === "undefined") throw new Error("iconHtml requires a browser DOM")
  const resolvedName = iconName(name)
  const safeSize = Number.isFinite(size) && size > 0 ? size : 16
  const root = document.createElement("span")
  const dispose = render(
    () => <Icon name={resolvedName} size={safeSize} class={iconClassName(resolvedName, className)} />,
    root,
  )
  try {
    return root.innerHTML
  } finally {
    dispose()
  }
}

export function hydrateIconPlaceholders(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-oc-icon]")) {
    const name = node.dataset.ocIcon
    if (!name) continue
    const size = Number(node.dataset.ocIconSize || "16")
    node.innerHTML = iconHtml(name, Number.isFinite(size) ? size : 16)
  }
}
