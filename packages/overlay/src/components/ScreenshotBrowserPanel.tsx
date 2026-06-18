import { createMemo, createResource, For, Show } from "solid-js"
import { cardTreeStore } from "../store/card-tree"
import {
  collectScreenshotBrowserItemsFromCardTree,
  groupScreenshotBrowserItems,
  type ScreenshotBrowserItem,
} from "../utils/screenshot-browser"
import { fetchResourceAsObjectUrl, peekResourceObjectUrl, resolveResourceUrl } from "../services/api"
import { fullStampWithRelative } from "../utils/time"
import { t } from "../utils/i18n"
import { roleLabel } from "../utils/message"
import { Icon } from "./Icon"
import { PreviewableImage } from "./ImagePreview"
import { SurfaceHeader } from "./ui/SurfaceHeader"

function needsAuthedFetch(url: string): boolean {
  return url.startsWith("/")
}

function ScreenshotThumbnail(props: { item: ScreenshotBrowserItem }) {
  const authed = () => needsAuthedFetch(props.item.src)
  const [objectUrl] = createResource(
    () => (authed() ? props.item.src : null),
    (url: string | null) => (url ? fetchResourceAsObjectUrl(url) : null),
    { initialValue: authed() ? (peekResourceObjectUrl(props.item.src) ?? null) : null },
  )
  const src = () => (authed() ? objectUrl() : resolveResourceUrl(props.item.src))

  return (
    <Show when={!objectUrl.error}>
      <Show when={src()}>
        {(resolved) => (
          <PreviewableImage
            src={resolved()}
            alt={props.item.alt}
            triggerClass="screenshot-browser__thumb-trigger"
            imageClass="screenshot-browser__thumb-image"
          />
        )}
      </Show>
    </Show>
  )
}

export function ScreenshotBrowserPanel(props: { active: () => boolean }) {
  const active = createMemo(() => props.active())
  const items = createMemo(() => {
    if (!active()) return []
    void cardTreeStore.visibleVersion
    return collectScreenshotBrowserItemsFromCardTree(cardTreeStore.order, cardTreeStore.cards)
  })
  const groups = createMemo(() => groupScreenshotBrowserItems(items()))

  return (
    <section class="screenshot-browser-panel" data-active={String(active())} aria-label={t("screenshots.title")}>
      <SurfaceHeader
        variant="panel"
        title={t("screenshots.title")}
        actions={
          <span class="screenshot-browser-panel__count" aria-label={t("screenshots.count", { count: items().length })}>
            {items().length}
          </span>
        }
      />
      <Show
        when={groups().length > 0}
        fallback={
          <div class="screenshot-browser-empty">
            <Icon name="screenshots" size={18} />
            <p>{t("screenshots.empty")}</p>
          </div>
        }
      >
        <div class="screenshot-browser-groups">
          <For each={groups()}>
            {(group) => (
              <section class="screenshot-browser-group" data-agent-role={group.role}>
                <header class="screenshot-browser-group__header">
                  <span>{roleLabel(group.role)}</span>
                  <small>{t("screenshots.group_count", { count: group.items.length })}</small>
                </header>
                <div class="screenshot-browser-grid">
                  <For each={group.items}>
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
              </section>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
