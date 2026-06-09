import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import {
  captureTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewTarget,
  saveTaskBrowserPreviewTarget,
  type BrowserPreviewTarget,
  type BrowserPreviewViewportID,
} from "../services/browser-preview"
import { getHostTransport } from "../services/host-transport"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { Tab, Tabs } from "./ui/Tabs"

export interface BrowserPreviewPanelProps {
  active: () => boolean
  directory: () => string
  refreshKey: () => unknown
  taskID: () => string | undefined
  onReady?: (target: BrowserPreviewTarget) => void
}

export function BrowserPreviewPanel(props: BrowserPreviewPanelProps) {
  const frameElements: Partial<Record<BrowserPreviewViewportID, HTMLIFrameElement>> = {}
  const [draftUrl, setDraftUrl] = createSignal("")
  const [viewportID, setViewportID] = createSignal<BrowserPreviewViewportID>("desktop")
  const [visibleViewportIDs, setVisibleViewportIDs] = createSignal<BrowserPreviewViewportID[]>([])
  const [viewportScopeKey, setViewportScopeKey] = createSignal("")
  const [refreshToken, setRefreshToken] = createSignal(0)
  const [frameToken, setFrameToken] = createSignal(0)
  const [lastAutoFocusedPreviewKey, setLastAutoFocusedPreviewKey] = createSignal("")
  const [verificationRequest, setVerificationRequest] = createSignal<{
    taskID: string
    targetID: string
    viewportID: BrowserPreviewViewportID
    token: number
  }>()
  const [target] = createResource(
    () => {
      const taskID = props.taskID()
      const directory = props.directory()
      if (!taskID || !directory) return undefined
      return { taskID, directory, refreshKey: props.refreshKey(), refreshToken: refreshToken() }
    },
    (scope) => loadTaskBrowserPreviewTarget(scope.taskID),
  )
  const [verification] = createResource(verificationRequest, (request) =>
    captureTaskBrowserPreviewEvidence({
      taskID: request.taskID,
      targetID: request.targetID,
      viewportID: request.viewportID,
    }),
  )

  const panelActive = createMemo(() => props.active())
  const currentTarget = createMemo(() => (props.taskID() && props.directory() ? target() : undefined))
  const currentTargetError = createMemo(() => (props.taskID() && props.directory() ? target.error : undefined))
  const candidates = createMemo(() => currentTarget()?.candidates ?? [])
  const selectedCandidateID = createMemo(
    () => candidates().find((item) => item.selected)?.id ?? currentTarget()?.id ?? "",
  )
  const viewports = createMemo(() => currentTarget()?.viewports ?? [])
  const viewportByID = createMemo(
    () =>
      Object.fromEntries(viewports().map((item) => [item.id, item])) as Partial<
        Record<BrowserPreviewViewportID, BrowserPreviewTarget["viewports"][number]>
      >,
  )
  const visibleViewportCount = createMemo(() => visibleViewportIDs().length)
  const frameUrl = createMemo(() => currentTarget()?.url)
  const canEmbedPreviewFrame = createMemo(() => getHostTransport().kind !== "vscode")
  const embeddableFrameUrl = createMemo(() => (canEmbedPreviewFrame() ? frameUrl() : undefined))

  createEffect(() => {
    const resolved = currentTarget()
    if (resolved?.source === "task-artifact" && resolved.url) setDraftUrl(resolved.url)
    if (!props.taskID()) setDraftUrl("")
  })

  createEffect(() => {
    const resolved = currentTarget()
    const taskID = props.taskID()
    if (!taskID || resolved?.status !== "ready" || !resolved.url) return
    const previewKey = `${taskID}:${resolved.id ?? resolved.url}`
    if (lastAutoFocusedPreviewKey() === previewKey) return
    setLastAutoFocusedPreviewKey(previewKey)
    props.onReady?.(resolved)
  })

  createEffect(() => {
    const taskID = props.taskID()
    const resolved = currentTarget()
    const ids = viewports().map((item) => item.id)
    if (!taskID || ids.length === 0) return
    const key = `${taskID}:${resolved?.id ?? resolved?.url ?? "missing"}:${ids.join(",")}`
    if (viewportScopeKey() === key) return
    setViewportScopeKey(key)
    setVisibleViewportIDs(ids)
    setViewportID(ids.includes(viewportID()) ? viewportID() : ids[0])
  })

  const submitUrl = (event: Event) => {
    event.preventDefault()
    const taskID = props.taskID()
    const url = draftUrl().trim()
    if (!taskID || !url) return
    void saveTaskBrowserPreviewTarget({ taskID, url }).then(() => setRefreshToken((value) => value + 1))
  }

  const selectCandidate = (event: Event) => {
    const taskID = props.taskID()
    const candidateID = (event.currentTarget as HTMLSelectElement).value
    const candidate = candidates().find((item) => item.id === candidateID)
    if (!taskID || !candidate || candidate.selected) return
    void saveTaskBrowserPreviewTarget({ taskID, url: candidate.url }).then(() => setRefreshToken((value) => value + 1))
  }

  const reloadFrame = () => {
    setFrameToken((value) => value + 1)
    for (const frame of Object.values(frameElements)) {
      const frameSrc = frame?.src
      if (frame && frameSrc) {
        frame.src = frameSrc
      }
    }
  }

  const closeViewport = (id: BrowserPreviewViewportID) => {
    const next = visibleViewportIDs().filter((item) => item !== id)
    setVisibleViewportIDs(next)
    if (viewportID() === id && next[0]) setViewportID(next[0])
  }

  const setViewportVisible = (id: BrowserPreviewViewportID, visible: boolean) => {
    if (visible) {
      setVisibleViewportIDs((current) => (current.includes(id) ? current : [...current, id]))
      setViewportID(id)
      return
    }
    closeViewport(id)
  }

  const captureEvidence = () => {
    const taskID = props.taskID()
    const resolved = currentTarget()
    if (!taskID || !resolved?.url || !resolved.id) return
    setVerificationRequest({ taskID, targetID: resolved.id, viewportID: viewportID(), token: Date.now() })
  }

  return (
    <section class="browser-preview-panel" aria-label={t("browser_preview.title")} data-active={String(panelActive())}>
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
        <Button
          type="submit"
          variant="solid"
          size="icon"
          tone="accent"
          title={t("browser_preview.load_title")}
          aria-label={t("browser_preview.load_title")}
          disabled={!props.taskID()}
        >
          <Icon name="external-link" size={13} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          tone="neutral"
          title={t("browser_preview.refresh_title")}
          aria-label={t("browser_preview.refresh_title")}
          disabled={!embeddableFrameUrl()}
          onClick={reloadFrame}
        >
          <Icon name="refresh" size={13} />
        </Button>
      </form>

      <label class="browser-preview-candidate-select">
        <Icon name="external-link" size={13} />
        <select
          value={selectedCandidateID()}
          onChange={selectCandidate}
          disabled={candidates().length <= 1}
          aria-label={t("browser_preview.candidates.label")}
        >
          <For each={candidates()}>{(candidate) => <option value={candidate.id}>{candidate.url}</option>}</For>
        </select>
      </label>

      <div class="browser-preview-viewport-layout">
        <Switch>
          <Match when={viewports().length > 0}>
            <Tabs
              size="sm"
              tone="neutral"
              value={viewportID()}
              onValueChange={(value) => setViewportID(value as BrowserPreviewViewportID)}
              aria-label={t("browser_preview.viewport.label")}
              data-ui="browser-preview-viewports"
              data-orientation="vertical"
            >
              <For each={viewports()}>
                {(item) => (
                  <div class="browser-preview-viewport-tab-row" data-visible={visibleViewportIDs().includes(item.id) ? "true" : "false"}>
                    <Tab
                      value={item.id}
                      active={viewportID() === item.id}
                      size="sm"
                      tone="neutral"
                      data-ui="browser-preview-viewport"
                      onClick={() => setViewportID(item.id)}
                    >
                      {viewportLabel(item.id)}
                    </Tab>
                    <label
                      class="browser-preview-viewport-toggle"
                      title={t("browser_preview.viewport.toggle", { viewport: viewportLabel(item.id) })}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={visibleViewportIDs().includes(item.id)}
                        disabled={visibleViewportIDs().includes(item.id) && visibleViewportCount() <= 1}
                        aria-label={t("browser_preview.viewport.toggle", { viewport: viewportLabel(item.id) })}
                        onChange={(event) => setViewportVisible(item.id, event.currentTarget.checked)}
                      />
                    </label>
                  </div>
                )}
              </For>
            </Tabs>
          </Match>
        </Switch>

        <div class="browser-preview-main">
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
                    <Icon
                      name={
                        resolved().status === "ready"
                          ? "status-completed"
                          : resolved().status === "failed"
                            ? "status-failed"
                            : "info-circle"
                      }
                      size={14}
                    />
                    <span>{statusLabel(resolved().status)}</span>
                  </>
                )}
              </Match>
            </Switch>
          </div>

          <div class="browser-preview-stage">
            <Switch>
              <Match when={frameUrl() && !canEmbedPreviewFrame()}>
                <div class="browser-preview-empty" data-status="host-blocked" data-ui="browser-preview-host-blocked">
                  <Icon name="info-circle" size={18} />
                  <p>{t("browser_preview.empty.host_blocked")}</p>
                  <code>{t("browser_preview.empty.host_blocked_detail")}</code>
                </div>
              </Match>
              <Match when={embeddableFrameUrl()}>
                {(url) => (
                  <div class="browser-preview-frame-grid">
                    <For each={visibleViewportIDs()}>
                      {(currentViewportID) => {
                        const currentViewport = createMemo(() => viewportByID()[currentViewportID])
                        return (
                          <Show when={currentViewport()}>
                            {(currentViewport) => (
                              <section
                                class="browser-preview-frame-shell"
                                data-viewport={currentViewport().id}
                                data-active={viewportID() === currentViewport().id ? "true" : "false"}
                                style={{
                                  "--browser-preview-width": `${currentViewport().width}px`,
                                  "--browser-preview-height": `${currentViewport().height}px`,
                                }}
                              >
                                <div class="browser-preview-frame-header">
                                  <span class="browser-preview-frame-title">{viewportLabel(currentViewport().id)}</span>
                                  <div class="browser-preview-frame-actions">
                                    <span>
                                      {currentViewport().width} × {currentViewport().height}
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      tone="neutral"
                                      data-ui="browser-preview-frame-close"
                                      title={t("browser_preview.viewport.close", {
                                        viewport: viewportLabel(currentViewport().id),
                                      })}
                                      aria-label={t("browser_preview.viewport.close", {
                                        viewport: viewportLabel(currentViewport().id),
                                      })}
                                      disabled={visibleViewportCount() <= 1}
                                      onClick={() => closeViewport(currentViewport().id)}
                                    >
                                      <Icon name="close" size={12} />
                                    </Button>
                                  </div>
                                </div>
                                <iframe
                                  data-frame-token={`${frameToken()}:${currentViewport().id}`}
                                  class="browser-preview-frame"
                                  src={url()}
                                  title={`${t("browser_preview.frame_title")} - ${viewportLabel(currentViewport().id)}`}
                                  sandbox="allow-forms allow-modals allow-popups allow-scripts"
                                  referrerPolicy="no-referrer"
                                  ref={(element) => {
                                    frameElements[currentViewport().id] = element
                                  }}
                                />
                              </section>
                            )}
                          </Show>
                        )
                      }}
                    </For>
                  </div>
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
                    <For each={resolved().diagnostics}>{(item) => <code>{item}</code>}</For>
                  </div>
                )}
              </Match>
            </Switch>
          </div>
        </div>
      </div>

      <div class="browser-preview-evidence">
        <Button
          type="button"
          variant="outline"
          size="sm"
          tone="neutral"
          title={t("browser_preview.capture_title")}
          aria-label={t("browser_preview.capture_title")}
          disabled={!props.taskID() || !frameUrl() || !currentTarget()?.id || verification.loading}
          onClick={captureEvidence}
        >
          <Icon name="inspect" size={13} />
          <span>{t("browser_preview.capture")}</span>
        </Button>
        <div
          class="browser-preview-evidence-status"
          data-status={
            verification.error ? "failed" : (verification()?.status ?? (verification.loading ? "loading" : "idle"))
          }
        >
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
