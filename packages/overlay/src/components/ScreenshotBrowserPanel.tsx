import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js"
import { Virtualizer, type CustomContainerComponentProps, type CustomItemComponentProps } from "virtua/solid"
import { currentUIScale } from "../utils/layout-tokens"
import { cardTreeStore } from "../store/card-tree"
import { createAnimationFrameScheduler } from "../utils/animation-frame"
import {
  buildScreenshotBrowserRows,
  groupScreenshotBrowserItems,
  isScreenshotBrowserThumbnailUrl,
  isStoredAttachmentUrl,
  type ScreenshotBrowserItem,
  type ScreenshotBrowserRow,
} from "../utils/screenshot-browser"
import { fetchResourceAsObjectUrl, peekResourceObjectUrl } from "../services/api"
import { fullStampWithRelative, stamp } from "../utils/time"
import { t } from "../utils/i18n"
import { roleLabel } from "../utils/message"
import { Icon } from "./Icon"
import { PreviewableImage } from "./ImagePreview"
import { SurfaceHeader } from "./ui/SurfaceHeader"

const SCREENSHOT_BROWSER_ROW_OVERSCAN = 1
const SCREENSHOT_BROWSER_CARD_WIDTH = 132
const SCREENSHOT_BROWSER_MAX_COLUMNS = 3
const SCREENSHOT_BROWSER_GRID_GAP = 8
const SCREENSHOT_BROWSER_LAZY_ROOT_MARGIN = "96px"
const SCREENSHOT_BROWSER_THUMBNAIL_LOADS_PER_FRAME = 1
const SCREENSHOT_BROWSER_ITEM_RENDER_CHUNK_SIZE = 12

interface ScreenshotThumbnailLoadJob {
  readonly load: () => void
}

const pendingThumbnailLoads: ScreenshotThumbnailLoadJob[] = []
let thumbnailLoadFrame = 0

function scheduleThumbnailLoadPump(): void {
  if (thumbnailLoadFrame) return
  thumbnailLoadFrame = requestAnimationFrame(() => {
    thumbnailLoadFrame = 0
    const batch = pendingThumbnailLoads.splice(0, SCREENSHOT_BROWSER_THUMBNAIL_LOADS_PER_FRAME)
    for (const job of batch) job.load()
    if (pendingThumbnailLoads.length > 0) scheduleThumbnailLoadPump()
  })
}

function enqueueScreenshotThumbnailLoad(load: () => void): () => void {
  const job: ScreenshotThumbnailLoadJob = { load }
  pendingThumbnailLoads.push(job)
  scheduleThumbnailLoadPump()
  return () => {
    const index = pendingThumbnailLoads.indexOf(job)
    if (index >= 0) pendingThumbnailLoads.splice(index, 1)
    if (pendingThumbnailLoads.length === 0 && thumbnailLoadFrame) {
      cancelAnimationFrame(thumbnailLoadFrame)
      thumbnailLoadFrame = 0
    }
  }
}

function ScreenshotVirtualWindow(props: CustomContainerComponentProps) {
  const setRef = (node: HTMLDivElement) => {
    if (typeof props.ref === "function") props.ref(node)
  }
  return (
    <div ref={setRef} class="screenshot-browser-virtual-window" style={props.style}>
      {props.children}
    </div>
  )
}

function ScreenshotVirtualItem(props: CustomItemComponentProps) {
  const setRef = (node: HTMLDivElement) => {
    if (typeof props.ref === "function") props.ref(node)
  }
  return (
    <div ref={setRef} class="screenshot-browser-virtual-item" style={props.style}>
      {props.children}
    </div>
  )
}

function ScreenshotThumbnail(props: { item: ScreenshotBrowserItem }) {
  let thumbnailHost: HTMLDivElement | undefined
  let cancelQueuedLoad: (() => void) | undefined
  let thumbnailLoadController: AbortController | undefined
  const [loadAllowed, setLoadAllowed] = createSignal(false)
  const sourceError = createMemo(() =>
    loadAllowed() &&
    (!isStoredAttachmentUrl(props.item.src) || !isScreenshotBrowserThumbnailUrl(props.item.thumbnailSrc))
      ? t("screenshots.thumbnail_invalid_source")
      : "",
  )
  const [objectUrl] = createResource(
    () => (loadAllowed() && !sourceError() ? props.item.thumbnailSrc : null),
    async (url: string | null) => {
      thumbnailLoadController?.abort(new DOMException("Screenshot thumbnail source changed", "AbortError"))
      thumbnailLoadController = undefined
      if (!url) return null
      const cached = peekResourceObjectUrl(url)
      if (cached) return cached
      const controller = new AbortController()
      thumbnailLoadController = controller
      try {
        return await fetchResourceAsObjectUrl(url, { signal: controller.signal })
      } finally {
        if (thumbnailLoadController === controller) thumbnailLoadController = undefined
      }
    },
  )
  const src = () => (loadAllowed() && !sourceError() ? objectUrl() : null)
  const thumbnailError = () => sourceError() || (objectUrl.error ? t("screenshots.thumbnail_load_failed") : "")

  onMount(() => {
    if (!thumbnailHost) throw new Error("Screenshot thumbnail host was not mounted")
    if (typeof IntersectionObserver === "undefined") {
      throw new Error("Screenshot thumbnail lazy loading requires IntersectionObserver")
    }
    const root = thumbnailHost.closest<HTMLElement>('.screenshot-browser-groups[data-virtualized="true"]')
    if (!root) throw new Error("Screenshot thumbnail must mount inside the virtual screenshot browser list")
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        cancelQueuedLoad = enqueueScreenshotThumbnailLoad(() => setLoadAllowed(true))
        observer.disconnect()
      },
      { root, rootMargin: SCREENSHOT_BROWSER_LAZY_ROOT_MARGIN },
    )
    observer.observe(thumbnailHost)
    onCleanup(() => {
      cancelQueuedLoad?.()
      thumbnailLoadController?.abort(new DOMException("Screenshot thumbnail unmounted", "AbortError"))
      thumbnailLoadController = undefined
      observer.disconnect()
    })
  })

  return (
    <div ref={thumbnailHost} class="screenshot-browser__thumb-slot">
      <Show
        when={!thumbnailError()}
        fallback={
          <div
            class="screenshot-browser__thumb-trigger screenshot-browser__thumb-error"
            role="img"
            aria-label={thumbnailError()}
            title={thumbnailError()}
          >
            <Icon name="status-failed" size={16} />
            <span>{thumbnailError()}</span>
          </div>
        }
      >
        <Show
          when={src()}
          fallback={
            <div class="screenshot-browser__thumb-trigger screenshot-browser__thumb-placeholder" aria-hidden="true" />
          }
        >
          {(resolved) => (
            <PreviewableImage
              src={resolved()}
              alt={props.item.alt}
              previewLoader={() => fetchResourceAsObjectUrl(props.item.src)}
              triggerClass="screenshot-browser__thumb-trigger"
              imageClass="screenshot-browser__thumb-image"
              imageAttributes={{
                decoding: "async",
                fetchpriority: "low",
              }}
            />
          )}
        </Show>
      </Show>
    </div>
  )
}

function ScreenshotBrowserVirtualRow(props: { row: ScreenshotBrowserRow; columns: number }) {
  if (props.row.kind === "group") {
    const row = props.row
    const ownerLabel = () => row.label || roleLabel(row.role)
    const ownerTitle = () =>
      row.label && row.label !== roleLabel(row.role) ? `${row.label} · ${roleLabel(row.role)}` : roleLabel(row.role)
    const label = () => (row.time > 0 ? `${ownerLabel()} · ${stamp(row.time)}` : ownerLabel())
    const labelTitle = () =>
      row.time > 0 ? `${ownerTitle()} · ${fullStampWithRelative(row.time)}` : ownerTitle()
    return (
      <section class="screenshot-browser-group" data-agent-role={row.role} data-owner-key={row.groupKey}>
        <header class="screenshot-browser-group__header">
          <span title={labelTitle()}>{label()}</span>
          <small>{t("screenshots.group_count", { count: props.row.count })}</small>
        </header>
      </section>
    )
  }
  return (
    <div
      class="screenshot-browser-row-grid"
      data-agent-role={props.row.role}
      data-owner-key={props.row.groupKey}
      style={`--screenshot-browser-columns: ${props.columns}`}
    >
      <For each={props.row.items}>
        {(item) => (
          <article class="screenshot-browser-card" data-source={item.source}>
            <ScreenshotThumbnail item={item} />
            <div class="screenshot-browser-card__body">
              <strong title={item.title}>{item.title}</strong>
              <Show when={item.detail}>
                <span title={item.detail}>{item.detail}</span>
              </Show>
              <Show when={item.time > 0}>
                <time datetime={new Date(item.time).toISOString()} title={fullStampWithRelative(item.time)}>
                  {fullStampWithRelative(item.time)}
                </time>
              </Show>
            </div>
          </article>
        )}
      </For>
    </div>
  )
}

export function ScreenshotBrowserPanel(props: { active: () => boolean }) {
  const [listEl, setListEl] = createSignal<HTMLDivElement>()
  const [listWidth, setListWidth] = createSignal(0)
  const [renderedItemCount, setRenderedItemCount] = createSignal(0)
  const active = createMemo(() => props.active())
  const cardWidth = createMemo(() => SCREENSHOT_BROWSER_CARD_WIDTH * currentUIScale())
  const sourceItems = createMemo(() => {
    if (!active()) return []
    return cardTreeStore.screenshotItems
  })
  const items = createMemo(() => sourceItems().slice(0, renderedItemCount()))
  const groups = createMemo(() => groupScreenshotBrowserItems(items()))
  const columnCount = createMemo(() => {
    const scale = currentUIScale()
    const fixedCardWidth = cardWidth()
    const gap = SCREENSHOT_BROWSER_GRID_GAP * scale
    const width = listWidth()
    if (width <= 0) return 1
    return Math.min(SCREENSHOT_BROWSER_MAX_COLUMNS, Math.max(1, Math.floor((width + gap) / (fixedCardWidth + gap))))
  })
  const rows = createMemo(() => buildScreenshotBrowserRows(groups(), columnCount()))

  createEffect(() => {
    const total = sourceItems().length
    if (!active() || total <= 0) {
      setRenderedItemCount(0)
      return
    }

    let rendered = Math.min(untrack(renderedItemCount), total)
    if (untrack(renderedItemCount) !== rendered) setRenderedItemCount(rendered)
    if (rendered >= total) return

    let frameID = 0
    const renderNextChunk = () => {
      rendered = Math.min(total, rendered + SCREENSHOT_BROWSER_ITEM_RENDER_CHUNK_SIZE)
      setRenderedItemCount(rendered)
      if (rendered < total) frameID = window.requestAnimationFrame(renderNextChunk)
    }
    if (rendered > 0) {
      frameID = window.requestAnimationFrame(renderNextChunk)
    } else {
      frameID = window.requestAnimationFrame(() => {
        frameID = window.requestAnimationFrame(() => {
          frameID = window.requestAnimationFrame(renderNextChunk)
        })
      })
    }
    onCleanup(() => {
      if (frameID) window.cancelAnimationFrame(frameID)
    })
  })

  createEffect(() => {
    const element = listEl()
    if (!element) return
    let pendingWidth = 0
    const commitWidth = () => setListWidth(pendingWidth)
    const measureOnFrame = createAnimationFrameScheduler(commitWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === element)
      if (!entry) return
      pendingWidth = entry.contentRect.width
      measureOnFrame.schedule()
    })
    observer.observe(element)
    onCleanup(() => {
      measureOnFrame.cancel()
      observer.disconnect()
    })
  })

  return (
    <section class="screenshot-browser-panel" data-active={String(active())} aria-label={t("screenshots.title")}>
      <SurfaceHeader
        variant="panel"
        title={t("screenshots.title")}
        actions={
          <span
            class="screenshot-browser-panel__count"
            aria-label={t("screenshots.count", { count: sourceItems().length })}
          >
            {sourceItems().length}
          </span>
        }
      />
      <Show
        when={sourceItems().length > 0}
        fallback={
          <div class="screenshot-browser-empty">
            <Icon name="screenshots" size={18} />
            <p>{t("screenshots.empty")}</p>
          </div>
        }
      >
        <div
          ref={setListEl}
          class="screenshot-browser-groups"
          data-virtualized="true"
          data-item-count={sourceItems().length}
          data-rendered-count={renderedItemCount()}
          style={`--screenshot-browser-card-width: ${cardWidth()}px`}
        >
          <Show when={renderedItemCount() > 0 && groups().length > 0}>
            <Virtualizer
              data={rows()}
              overscan={SCREENSHOT_BROWSER_ROW_OVERSCAN}
              as={ScreenshotVirtualWindow}
              item={ScreenshotVirtualItem}
            >
              {(row) => (
                <ScreenshotBrowserVirtualRow
                  row={row}
                  columns={row.kind === "items" ? Math.max(columnCount(), row.items.length) : columnCount()}
                />
              )}
            </Virtualizer>
          </Show>
        </div>
      </Show>
    </section>
  )
}
