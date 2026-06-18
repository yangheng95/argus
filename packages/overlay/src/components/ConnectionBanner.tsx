// ── ConnectionBanner ──
// Floating banner that surfaces a sustained loss of the SSE event stream so
// the operator notices instantly when the overlay stops receiving updates,
// instead of only the small ConnectionBadge in the title bar going gray.
//
// Hide rules: the banner only appears once the offline state has lasted
// more than `OFFLINE_GRACE_MS` so transient reconnects (the SSE retry loop
// in services/sse.ts:79 pings every 2s) don't flash a banner on every blip.

import { Show, createMemo, createEffect, onCleanup } from "solid-js"
import { messageStore } from "../store/messages"
import { appStore } from "../store/app"
import { openConfigDialog } from "../services/dialog"
import { t } from "../utils/i18n"
import { useDisclosure } from "../solid/disclosure"
import { Button } from "./ui/Button"

const OFFLINE_GRACE_MS = 2500

export function ConnectionBanner() {
  const isOffline = createMemo(() => {
    if (messageStore.sseConnected) return false
    return appStore.connectionStatus !== "online"
  })

  const banner = useDisclosure()
  let timer: any = null

  createEffect(() => {
    const offline = isOffline()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!offline) {
      banner.close()
      return
    }
    timer = setTimeout(() => banner.openIt(), OFFLINE_GRACE_MS)
  })

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  const label = createMemo(() =>
    appStore.connectionStatus === "connecting" ? t("titlebar.connection.connecting") : t("titlebar.connection.offline"),
  )

  const reload = () => {
    if (typeof location !== "undefined") location.reload()
  }

  return (
    <Show when={banner.open()}>
      <div class="conn-banner" role="status" aria-live="polite" data-status={appStore.connectionStatus}>
        <span class="conn-banner__dot" aria-hidden="true" />
        <span class="conn-banner__text">{t("connection.banner_text", { status: label() })}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tone="neutral"
          onClick={() => openConfigDialog("general")}
          title={t("titlebar.connection_diagnostics")}
          data-ui="connection-banner-setup"
          data-testid="connection-banner-setup"
        >
          {t("titlebar.setup")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tone="neutral"
          onClick={reload}
          title={t("connection.banner_reload_title")}
          data-ui="connection-banner-reload"
        >
          {t("connection.banner_reload")}
        </Button>
      </div>
    </Show>
  )
}
