let layoutTokenProbe: HTMLElement | null = null
const layoutTokenCache = new Map<string, { signature: string; value: number }>()

export interface LayoutTokenResolver {
  tokenPx(name: string): number
}

function tokenSignature(root: HTMLElement, container: HTMLElement): string {
  const scale = getComputedStyle(root).getPropertyValue("--ui-scale").trim()
  const containerInlineSize = container.getBoundingClientRect().width
  if (!Number.isFinite(containerInlineSize) || containerInlineSize <= 0) {
    throw new Error(`Layout token cache container resolved to invalid width: ${containerInlineSize}`)
  }
  return `${scale}|${containerInlineSize.toFixed(3)}`
}

function probeElement(): HTMLElement {
  if (typeof document === "undefined") {
    throw new Error("Layout token resolution requires a document.")
  }
  if (!document.body) {
    throw new Error("Layout token resolution requires document.body.")
  }
  if (layoutTokenProbe?.isConnected) return layoutTokenProbe

  const probe = document.createElement("div")
  probe.setAttribute("aria-hidden", "true")
  probe.style.position = "absolute"
  probe.style.left = "-10000px"
  probe.style.top = "-10000px"
  probe.style.height = "0"
  probe.style.overflow = "hidden"
  probe.style.pointerEvents = "none"
  probe.style.visibility = "hidden"
  document.body.appendChild(probe)
  layoutTokenProbe = probe
  return probe
}

export function currentUIScale(): number {
  if (typeof document === "undefined") {
    throw new Error("UI scale cannot be resolved without a document.")
  }
  const root = document.documentElement
  if (!root) {
    throw new Error("UI scale cannot be resolved without documentElement.")
  }
  const raw = getComputedStyle(root).getPropertyValue("--ui-scale").trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`UI scale resolved to invalid value: ${raw}`)
  }
  return value
}

export function layoutTokenPx(name: string): number {
  return createLayoutTokenResolver().tokenPx(name)
}

export function createLayoutTokenResolver(): LayoutTokenResolver {
  if (typeof document === "undefined") {
    throw new Error("Layout token resolution requires a document.")
  }
  const root = document.documentElement
  if (!root) {
    throw new Error("Layout token resolution requires documentElement.")
  }
  const probe = probeElement()
  const signature = tokenSignature(root, document.body)

  return {
    tokenPx(name: string): number {
      const cached = layoutTokenCache.get(name)
      if (cached?.signature === signature) return cached.value

      probe.style.width = `var(${name})`
      const value = probe.getBoundingClientRect().width
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Layout token ${name} resolved to invalid width: ${value}`)
      }
      layoutTokenCache.set(name, { signature, value })
      return value
    },
  }
}
