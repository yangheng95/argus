import { createMemo, createResource, createSignal, For, Match, Switch } from "solid-js"
import { loadBrowserPreviewTarget, verifyBrowserPreviewTarget, type BrowserPreviewViewportID } from "../services/browser-preview"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { Tab, Tabs } from "./ui/Tabs"

export function BrowserPreviewPanel() {
  let frameElement: HTMLIFrameElement | undefined
  const [draftUrl, setDraftUrl] = createSignal("")
  const [targetUrl, setTargetUrl] = createSignal("")
  const [viewportID, setViewportID] = createSignal<BrowserPreviewViewportID>("desktop")
  const [refreshToken, setRefreshToken] = createSignal(0)
  const [frameToken, setFrameToken] = createSignal(0)
  const [verificationRequest, setVerificationRequest] = createSignal<{ url: string; viewportID: BrowserPreviewViewportID; token: number }>()
  const [target] = createResource(
    () => ({ url: targetUrl(), refreshToken: refreshToken() }),
    ({ url }) => loadBrowserPreviewTarget(url || undefined),
  )
  const [verification] = createResource(
    verificationRequest,
    (request) => verifyBrowserPreviewTarget({ url: request.url, viewportID: request.viewportID }),
  )

  const viewports = createMemo(() => target()?.viewports ?? [])
  const viewport = createMemo(() => viewports().find((item) => item.id === viewportID()) ?? viewports()[0])
  const frameUrl = createMemo(() => target()?.url)

  const submitUrl = (event: Event) => {
    event.preventDefault()
    setTargetUrl(draftUrl().trim())
    setRefreshToken((value) => value + 1)
  }

  const reloadFrame = () => {
    setFrameToken((value) => value + 1)
    setRefreshToken((value) => value + 1)
    const frameSrc = frameElement?.src
    if (frameElement && frameSrc) {
      frameElement.src = frameSrc
    }
  }

  const captureEvidence = () => {
    const url = frameUrl()
    if (!url) return
    setVerificationRequest({ url, viewportID: viewportID(), token: Date.now() })
  }

  return (
    <section class="browser-preview-panel" aria-label={t("browser_preview.title")}>
      <form class="browser-preview-toolbar" onSubmit={submitUrl}>
        <label class="browser-preview-url-field">
          <Icon name="external-link" size={13} />
          <input
            value={draftUrl()}
            onInput={(event) => setDraftUrl(event.currentTarget.value)}
            placeholder={t("browser_preview.url_placeholder")}
            aria-label={t("browser_preview.url_label")}
          />
        </label>
        <Button type="submit" variant="solid" size="icon" tone="accent" title={t("browser_preview.load")} aria-label={t("browser_preview.load")}>
          <Icon name="external-link" size={13} />
        </Button>
        <Button type="button" variant="outline" size="icon" tone="neutral" title={t("browser_preview.refresh")} aria-label={t("browser_preview.refresh")} onClick={reloadFrame}>
          <Icon name="refresh" size={13} />
        </Button>
      </form>

      <div class="browser-preview-viewport-tabs">
        <Switch>
          <Match when={viewports().length > 0}>
            <Tabs size="sm" tone="neutral" value={viewportID()} onValueChange={(value) => setViewportID(value as BrowserPreviewViewportID)} aria-label={t("browser_preview.viewport.label")} data-ui="browser-preview-viewports">
              <For each={viewports()}>
                {(item) => (
                  <Tab value={item.id} active={viewportID() === item.id} size="sm" tone="neutral" data-ui="browser-preview-viewport" onClick={() => setViewportID(item.id)}>
                    {viewportLabel(item.id)}
                  </Tab>
                )}
              </For>
            </Tabs>
          </Match>
        </Switch>
      </div>

      <div class="browser-preview-status" data-status={target()?.status ?? "loading"}>
        <Switch>
          <Match when={target.loading}>
            <span class="card__spinner" />
            <span>{t("browser_preview.loading")}</span>
          </Match>
          <Match when={target.error}>
            <Icon name="status-failed" size={14} />
            <span>{String(target.error)}</span>
          </Match>
          <Match when={target()}>
            {(resolved) => (
              <>
                <Icon name={resolved().status === "ready" ? "status-completed" : resolved().status === "failed" ? "status-failed" : "info-circle"} size={14} />
                <span>{statusLabel(resolved().status)}</span>
              </>
            )}
          </Match>
        </Switch>
      </div>

      <div class="browser-preview-stage">
        <Switch>
          <Match when={frameUrl()}>
            {(url) => (
              <Switch>
                <Match when={viewport()}>
                  {(currentViewport) => (
                    <div class="browser-preview-frame-shell" style={{ "--browser-preview-width": `${currentViewport().width}px`, "--browser-preview-height": `${currentViewport().height}px` }}>
                      <iframe
                        data-frame-token={`${frameToken()}:${viewportID()}`}
                        class="browser-preview-frame"
                        src={url()}
                        title={t("browser_preview.frame_title")}
                        sandbox="allow-forms allow-modals allow-popups allow-scripts"
                        referrerPolicy="no-referrer"
                        ref={(element) => {
                          frameElement = element
                        }}
                      />
                    </div>
                  )}
                </Match>
              </Switch>
            )}
          </Match>
          <Match when={target()}>
            {(resolved) => (
              <div class="browser-preview-empty" data-status={resolved().status}>
                <Icon name={resolved().status === "failed" ? "status-failed" : "info-circle"} size={18} />
                <p>{emptyMessage(resolved().status)}</p>
                <For each={resolved().diagnostics}>
                  {(item) => <code>{item}</code>}
                </For>
                <ShowCommand command={resolved().command} />
              </div>
            )}
          </Match>
        </Switch>
      </div>

      <div class="browser-preview-evidence">
        <Button type="button" variant="outline" size="sm" tone="neutral" title={t("browser_preview.capture")} aria-label={t("browser_preview.capture")} disabled={!frameUrl() || verification.loading} onClick={captureEvidence}>
          <Icon name="inspect" size={13} />
          <span>{t("browser_preview.capture")}</span>
        </Button>
        <div class="browser-preview-evidence-status" data-status={verification()?.status ?? (verification.loading ? "loading" : "idle")}>
          <Switch>
            <Match when={verification.loading}>
              <span class="card__spinner" />
              <span>{t("browser_preview.capture_loading")}</span>
            </Match>
            <Match when={verification()}>
              {(resolved) => (
                <>
                  <Icon name={resolved().status === "passed" ? "status-completed" : "status-failed"} size={14} />
                  <span>{resolved().capture?.summary ?? resolved().diagnostics.join(" ")}</span>
                </>
              )}
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  )
}

function viewportLabel(id: BrowserPreviewViewportID): string {
  const labels: Record<BrowserPreviewViewportID, string> = {
    desktop: t("browser_preview.viewport.desktop"),
    tablet: t("browser_preview.viewport.tablet"),
    mobile: t("browser_preview.viewport.mobile"),
  }
  return labels[id]
}

function statusLabel(status: string): string {
  switch (status) {
    case "ready":
      return t("browser_preview.status.ready")
    case "configured":
      return t("browser_preview.status.configured")
    case "failed":
      return t("browser_preview.status.failed")
    default:
      return t("browser_preview.status.missing")
  }
}

function emptyMessage(status: string): string {
  switch (status) {
    case "configured":
      return t("browser_preview.empty.configured")
    case "failed":
      return t("browser_preview.empty.failed")
    default:
      return t("browser_preview.empty.missing")
  }
}

function ShowCommand(props: { command?: string }) {
  return (
    <Switch>
      <Match when={props.command}>
        {(command) => (
          <div class="browser-preview-command">
            <span>{t("browser_preview.command")}</span>
            <code>{command()}</code>
          </div>
        )}
      </Match>
    </Switch>
  )
}
