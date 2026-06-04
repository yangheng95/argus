import { createEffect, createMemo, createResource, createSignal, For, Match, Switch } from "solid-js"
import { captureTaskBrowserPreviewEvidence, loadTaskBrowserPreviewTarget, saveTaskBrowserPreviewTarget, type BrowserPreviewViewportID } from "../services/browser-preview"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { Tab, Tabs } from "./ui/Tabs"

export interface BrowserPreviewPanelProps {
  active: () => boolean
  directory: () => string
  taskID: () => string | undefined
}

export function BrowserPreviewPanel(props: BrowserPreviewPanelProps) {
  let frameElement: HTMLIFrameElement | undefined
  const [draftUrl, setDraftUrl] = createSignal("")
  const [viewportID, setViewportID] = createSignal<BrowserPreviewViewportID>("desktop")
  const [refreshToken, setRefreshToken] = createSignal(0)
  const [frameToken, setFrameToken] = createSignal(0)
  const [verificationRequest, setVerificationRequest] = createSignal<{ taskID: string; targetID?: string; viewportID: BrowserPreviewViewportID; token: number }>()
  const [target] = createResource(
    () => {
      const taskID = props.taskID()
      const directory = props.directory()
      if (!props.active() || !taskID || !directory) return undefined
      return { taskID, directory, refreshToken: refreshToken() }
    },
    (scope) => loadTaskBrowserPreviewTarget(scope.taskID),
  )
  const [verification] = createResource(
    verificationRequest,
    (request) => captureTaskBrowserPreviewEvidence({ taskID: request.taskID, targetID: request.targetID, viewportID: request.viewportID }),
  )

  const currentTarget = createMemo(() => (props.active() && props.taskID() && props.directory() ? target() : undefined))
  const currentTargetError = createMemo(() => (props.active() && props.taskID() && props.directory() ? target.error : undefined))
  const viewports = createMemo(() => currentTarget()?.viewports ?? [])
  const viewport = createMemo(() => viewports().find((item) => item.id === viewportID()) ?? viewports()[0])
  const frameUrl = createMemo(() => currentTarget()?.url)

  createEffect(() => {
    const resolved = currentTarget()
    if (resolved?.source === "task-artifact" && resolved.url) setDraftUrl(resolved.url)
    if (!props.taskID()) setDraftUrl("")
  })

  const submitUrl = (event: Event) => {
    event.preventDefault()
    const taskID = props.taskID()
    const url = draftUrl().trim()
    if (!taskID || !url) return
    void saveTaskBrowserPreviewTarget({ taskID, url }).then(() => setRefreshToken((value) => value + 1))
  }

  const reloadFrame = () => {
    setFrameToken((value) => value + 1)
    const frameSrc = frameElement?.src
    if (frameElement && frameSrc) {
      frameElement.src = frameSrc
    }
  }

  const captureEvidence = () => {
    const taskID = props.taskID()
    const resolved = currentTarget()
    if (!taskID || !resolved?.url) return
    setVerificationRequest({ taskID, targetID: resolved.id, viewportID: viewportID(), token: Date.now() })
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
            disabled={!props.taskID()}
          />
        </label>
        <Button type="submit" variant="solid" size="icon" tone="accent" title={t("browser_preview.load")} aria-label={t("browser_preview.load")} disabled={!props.taskID()}>
          <Icon name="external-link" size={13} />
        </Button>
        <Button type="button" variant="outline" size="icon" tone="neutral" title={t("browser_preview.refresh")} aria-label={t("browser_preview.refresh")} disabled={!frameUrl()} onClick={reloadFrame}>
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

      <div class="browser-preview-status" data-status={currentTarget()?.status ?? "loading"}>
        <Switch>
          <Match when={target.loading}>
            <span class="card__spinner" />
            <span>{t("browser_preview.loading")}</span>
          </Match>
          <Match when={currentTargetError()}>
            <Icon name="status-failed" size={14} />
            <span>{String(currentTargetError())}</span>
          </Match>
          <Match when={currentTarget()}>
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
          <Match when={currentTargetError()}>
            {(error) => (
              <div class="browser-preview-empty" data-status="failed">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.failed")}</p>
                <code>{String(error())}</code>
              </div>
            )}
          </Match>
          <Match when={currentTarget()}>
            {(resolved) => (
              <div class="browser-preview-empty" data-status={resolved().status}>
                <Icon name={resolved().status === "failed" ? "status-failed" : "info-circle"} size={18} />
                <p>{emptyMessage(resolved().status)}</p>
                <For each={resolved().diagnostics}>
                  {(item) => <code>{item}</code>}
                </For>
              </div>
            )}
          </Match>
        </Switch>
      </div>

      <div class="browser-preview-evidence">
        <Button type="button" variant="outline" size="sm" tone="neutral" title={t("browser_preview.capture")} aria-label={t("browser_preview.capture")} disabled={!props.taskID() || !frameUrl() || verification.loading} onClick={captureEvidence}>
          <Icon name="inspect" size={13} />
          <span>{t("browser_preview.capture")}</span>
        </Button>
        <div class="browser-preview-evidence-status" data-status={verification.error ? "failed" : verification()?.status ?? (verification.loading ? "loading" : "idle")}>
          <Switch>
            <Match when={verification.error}>
              {(error) => (
                <>
                  <Icon name="status-failed" size={14} />
                  <span>{String(error())}</span>
                </>
              )}
            </Match>
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
    case "failed":
      return t("browser_preview.status.failed")
    default:
      return t("browser_preview.status.missing")
  }
}

function emptyMessage(status: string): string {
  switch (status) {
    case "failed":
      return t("browser_preview.empty.failed")
    default:
      return t("browser_preview.empty.missing")
  }
}
