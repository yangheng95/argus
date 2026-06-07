const ICON_PATHS: Record<string, string[]> = {
  close: [
    `<path d="M18 6 6 18"></path>`,
    `<path d="m6 6 12 12"></path>`,
  ],
  copy: [
    `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>`,
    `<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>`,
  ],
  folder: [
    `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>`,
  ],
  mission: [
    `<rect width="8" height="8" x="3" y="3" rx="2"></rect>`,
    `<path d="M7 11v4a2 2 0 0 0 2 2h4"></path>`,
    `<rect width="8" height="8" x="13" y="13" rx="2"></rect>`,
  ],
  plus: [
    `<path d="M5 12h14"></path>`,
    `<path d="M12 5v14"></path>`,
  ],
  square: [
    `<rect width="18" height="18" x="3" y="3" rx="2"></rect>`,
  ],
}

function escapeAttr(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function iconHtml(name: string, size = 16, className?: string): string {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 16
  const classes = ["lucide", `lucide-${name}`, className].filter(Boolean).map((part) => escapeAttr(String(part))).join(" ")
  const paths = ICON_PATHS[name] ?? ICON_PATHS.square
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${safeSize}" height="${safeSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${classes}" aria-hidden="true">`,
    ...paths,
    `</svg>`,
  ].join("")
}

export function hydrateIconPlaceholders(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-oc-icon]")) {
    const name = node.dataset.ocIcon
    if (!name) continue
    const size = Number(node.dataset.ocIconSize || "16")
    node.innerHTML = iconHtml(name, Number.isFinite(size) ? size : 16)
  }
}
