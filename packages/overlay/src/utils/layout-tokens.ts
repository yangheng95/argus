let layoutTokenProbe: HTMLElement | null = null
const layoutTokenCache = new Map<string, { signature: string; value: number }>()

function tokenSignature(root: HTMLElement): string {
  return getComputedStyle(root).getPropertyValue("--ui-scale").trim()
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

export function layoutTokenPx(name: string): number {
  if (typeof document === "undefined") {
    throw new Error(`Layout token ${name} cannot be resolved without a document.`)
  }
  const root = document.documentElement
  if (!root) {
    throw new Error(`Layout token ${name} cannot be resolved without documentElement.`)
  }
  const signature = tokenSignature(root)
  const cached = layoutTokenCache.get(name)
  if (cached?.signature === signature) return cached.value

  const probe = probeElement()
  probe.style.width = `var(${name})`
  const value = probe.getBoundingClientRect().width
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Layout token ${name} resolved to invalid width: ${value}`)
  }
  layoutTokenCache.set(name, { signature, value })
  return value
}
