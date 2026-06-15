import * as Select from "@kobalte/core/select"
import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import {
  captureTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewLiveSnapshotObjectUrl,
  loadTaskBrowserPreviewTarget,
  loadTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewEvidenceCaptureObjectUrl,
  selectTaskBrowserPreviewTarget,
  sendTaskBrowserPreviewLiveInputObjectUrl,
  type BrowserPreviewEvidence,
  type BrowserPreviewLiveInput,
  type BrowserPreviewTarget,
  type BrowserPreviewViewportID,
} from "../services/browser-preview"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { SurfaceHeader } from "./ui/SurfaceHeader"
import { Tab, Tabs } from "./ui/Tabs"

type BrowserPreviewCandidate = BrowserPreviewTarget["candidates"][number]

export interface BrowserPreviewPanelProps {
  active: () => boolean
  directory: () => string
  refreshKey: () => unknown
  taskID: () => string | undefined
  onReady?: (target: BrowserPreviewTarget) => void
}

export function BrowserPreviewPanel(props: BrowserPreviewPanelProps) {
  const [viewportID, setViewportID] = createSignal<BrowserPreviewViewportID>("desktop")
  const [viewportScopeKey, setViewportScopeKey] = createSignal("")
  const [refreshToken, setRefreshToken] = createSignal(0)
  const [lastAutoFocusedPreviewKey, setLastAutoFocusedPreviewKey] = createSignal("")
  const [lastAutoCapturedPreviewKey, setLastAutoCapturedPreviewKey] = createSignal("")
  const [liveImageUrl, setLiveImageUrl] = createSignal("")
  const [liveError, setLiveError] = createSignal("")
  const [liveLoading, setLiveLoading] = createSignal(false)
  const [manualUrl, setManualUrl] = createSignal("")
  const [manualUrlError, setManualUrlError] = createSignal("")
  const [manualUrlSubmitting, setManualUrlSubmitting] = createSignal(false)
  const [verificationRequest, setVerificationRequest] = createSignal<{
    taskID: string
    targetID: string
    viewportIDs: BrowserPreviewViewportID[]
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
      viewportIDs: request.viewportIDs,
    }),
  )
  const panelActive = createMemo(() => props.active())
  const currentTarget = createMemo(() => (props.taskID() && props.directory() ? target() : undefined))
  const [latestEvidence] = createResource(
    () => {
      const taskID = props.taskID()
      const evidenceID = currentTarget()?.latestEvidenceID
      if (!taskID || !evidenceID) return undefined
      return { taskID, evidenceID }
    },
    (scope) => loadTaskBrowserPreviewEvidence(scope),
  )
  const currentTargetError = createMemo(() => (props.taskID() && props.directory() ? target.error : undefined))
  const candidates = createMemo(() => currentTarget()?.candidates ?? [])
  const selectedCandidate = createMemo(
    () =>
      candidates().find((item) => item.selected) ??
      candidates().find((item) => item.id === currentTarget()?.id) ??
      null,
  )
  const viewports = createMemo(() => currentTarget()?.viewports ?? [])
  const selectedViewport = createMemo(() => viewports().find((viewport) => viewport.id === viewportID()))
  const targetUrl = createMemo(() => currentTarget()?.url)
  const liveScope = createMemo(() => {
    const taskID = props.taskID()
    const resolved = currentTarget()
    const viewport = selectedViewport()
    if (!panelActive() || !taskID || resolved?.status !== "ready" || !resolved.id || !viewport) return undefined
    return { taskID, targetID: resolved.id, viewportID: viewport.id, viewport }
  })
  const renderedEvidence = createMemo<BrowserPreviewEvidence | undefined>(() => {
    const verified = verification()
    const request = verificationRequest()
    if (verified && request) {
      return evidenceFromVerification(verified, viewportID(), {
        taskID: request.taskID,
        targetID: request.targetID,
      })
    }
    return latestEvidence()
  })
  const [captureImageUrl] = createResource(
    () => {
      const evidence = renderedEvidence()
      if (!evidence?.capture?.captured || !evidence.capture.path) return undefined
      return { taskID: evidence.taskID, evidenceID: evidence.id, viewportID: evidence.viewportID }
    },
    (scope) => loadTaskBrowserPreviewEvidenceCaptureObjectUrl(scope),
  )

  createEffect<string | undefined>((previous) => {
    const current = captureImageUrl()
    if (previous && previous !== current) URL.revokeObjectURL(previous)
    return current
  })

  onCleanup(() => {
    const current = captureImageUrl()
    if (current) URL.revokeObjectURL(current)
    const live = liveImageUrl()
    if (live) URL.revokeObjectURL(live)
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
    setViewportID(ids.includes(viewportID()) ? viewportID() : ids[0])
  })

  createEffect(() => {
    const taskID = props.taskID()
    const resolved = currentTarget()
    const viewportIDs = viewports().map((viewport) => viewport.id)
    if (!panelActive() || !taskID || resolved?.status !== "ready" || !resolved.url || !resolved.id) return
    if (viewportIDs.length === 0 || resolved.latestEvidenceID || verification.loading) return
    const key = `${taskID}:${resolved.id}:${viewportIDs.join(",")}`
    if (lastAutoCapturedPreviewKey() === key) return
    setLastAutoCapturedPreviewKey(key)
    setVerificationRequest({ taskID, targetID: resolved.id, viewportIDs, token: Date.now() })
  })

  const selectCandidate = (candidate: BrowserPreviewCandidate | null) => {
    const taskID = props.taskID()
    if (!taskID || !candidate || candidate.selected) return
    void selectTaskBrowserPreviewTarget({ taskID, targetID: candidate.id }).then(() =>
      setRefreshToken((value) => value + 1),
    )
  }

  const submitManualUrl: JSX.EventHandlerUnion<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault()
    const taskID = props.taskID()
    const url = manualUrl().trim()
    if (!taskID || !url || manualUrlSubmitting()) return
    setManualUrlSubmitting(true)
    setManualUrlError("")
    void selectTaskBrowserPreviewTarget({ taskID, url })
      .then(() => {
        setManualUrl("")
        setRefreshToken((value) => value + 1)
      })
      .catch((error) => setManualUrlError(String(error)))
      .finally(() => setManualUrlSubmitting(false))
  }

  const captureEvidence = () => {
    const taskID = props.taskID()
    const resolved = currentTarget()
    if (!taskID || !resolved?.url || !resolved.id) return
    const viewportIDs = viewports().map((viewport) => viewport.id)
    if (viewportIDs.length === 0) return
    setVerificationRequest({ taskID, targetID: resolved.id, viewportIDs, token: Date.now() })
  }

  let liveFrameRequestSequence = 0

  const replaceLiveImageUrl = (next: string) => {
    const previous = liveImageUrl()
    setLiveImageUrl(next)
    if (previous && previous !== next) URL.revokeObjectURL(previous)
  }

  const clearLiveImageUrl = () => {
    const previous = liveImageUrl()
    if (!previous) return
    setLiveImageUrl("")
    URL.revokeObjectURL(previous)
  }

  const loadLiveFrame = async (scope: NonNullable<ReturnType<typeof liveScope>>, input?: BrowserPreviewLiveInput) => {
    const sequence = ++liveFrameRequestSequence
    setLiveLoading(true)
    setLiveError("")
    try {
      const next = input
        ? await sendTaskBrowserPreviewLiveInputObjectUrl({ ...scope, input })
        : await loadTaskBrowserPreviewLiveSnapshotObjectUrl(scope)
      if (sequence !== liveFrameRequestSequence) {
        URL.revokeObjectURL(next)
        return
      }
      replaceLiveImageUrl(next)
    } catch (error) {
      if (sequence === liveFrameRequestSequence) setLiveError(String(error))
    } finally {
      if (sequence === liveFrameRequestSequence) setLiveLoading(false)
    }
  }

  const livePoint = (event: MouseEvent | WheelEvent, element: HTMLElement) => {
    const viewport = selectedViewport()
    const image = element.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
    if (!viewport || !image) return undefined
    const rect = image.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return undefined
    return {
      x: Math.max(0, Math.min(viewport.width, ((event.clientX - rect.left) / rect.width) * viewport.width)),
      y: Math.max(0, Math.min(viewport.height, ((event.clientY - rect.top) / rect.height) * viewport.height)),
    }
  }

  const sendLiveInput = (input: BrowserPreviewLiveInput) => {
    const scope = liveScope()
    if (!scope) return
    void loadLiveFrame(scope, input)
  }

  const handleLivePointerDown: JSX.EventHandlerUnion<HTMLElement, PointerEvent> = (event) => {
    if (event.button > 2) return
    const point = livePoint(event, event.currentTarget)
    if (!point) return
    event.currentTarget.focus()
    event.preventDefault()
    const button = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left"
    sendLiveInput({ kind: "click", ...point, button })
  }

  const handleLiveWheel: JSX.EventHandlerUnion<HTMLElement, WheelEvent> = (event) => {
    const point = livePoint(event, event.currentTarget)
    if (!point) return
    event.preventDefault()
    sendLiveInput({ kind: "wheel", ...point, deltaX: event.deltaX, deltaY: event.deltaY })
  }

  const handleLiveKeyDown: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent> = (event) => {
    if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") return
    event.preventDefault()
    sendLiveInput({ kind: "key", key: event.key })
  }

  createEffect(() => {
    const scope = liveScope()
    if (!scope) {
      clearLiveImageUrl()
      setLiveError("")
      return
    }
    void loadLiveFrame(scope)
  })

  return (
    <section class="browser-preview-panel" aria-label={t("browser_preview.title")} data-active={String(panelActive())}>
      <div class="browser-preview-command-surface">
        <SurfaceHeader
          variant="panel"
          title={t("browser_preview.title")}
          actions={
            <Button
              type="button"
              variant="outline"
              size="icon"
              tone="neutral"
              title={t("browser_preview.refresh_title")}
              aria-label={t("browser_preview.refresh_title")}
              disabled={!props.taskID()}
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              <Icon name="refresh" size={13} />
            </Button>
          }
        />

        <div class="browser-preview-controls">
          <div class="browser-preview-status" data-status={currentTarget()?.status ?? "loading"}>
            <Switch
              fallback={
                <>
                  <Icon name="info-circle" size={14} />
                  <span>{t("browser_preview.status.missing")}</span>
                </>
              }
            >
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

          <Select.Root<BrowserPreviewCandidate>
            class="browser-preview-candidate-select"
            options={candidates()}
            optionValue="id"
            optionTextValue="url"
            value={selectedCandidate()}
            onChange={selectCandidate}
            itemComponent={BrowserPreviewCandidateOption}
            disabled={candidates().length <= 1}
            disallowEmptySelection
            gutter={4}
            sameWidth
          >
            <Icon name="external-link" size={13} />
            <Select.Trigger
              class="browser-preview-candidate-trigger"
              aria-label={t("browser_preview.candidates.label")}
              data-ui="browser-preview-candidate-trigger"
            >
              <Select.Value<BrowserPreviewCandidate>>
                {(state) => <span>{state.selectedOption()?.url ?? targetUrl() ?? ""}</span>}
              </Select.Value>
              <Select.Icon>
                <Icon name="caret-down" size={12} />
              </Select.Icon>
            </Select.Trigger>
            <Select.HiddenSelect aria-label={t("browser_preview.candidates.label")} />
            <Select.Portal>
              <Select.Content class="browser-preview-candidate-content">
                <Select.Listbox class="browser-preview-candidate-listbox" />
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          <form class="browser-preview-url-form" onSubmit={submitManualUrl} data-ui="browser-preview-url-form">
            <input
              class="browser-preview-url-input"
              value={manualUrl()}
              type="text"
              inputMode="url"
              spellcheck={false}
              placeholder={t("browser_preview.url_placeholder")}
              aria-label={t("browser_preview.url_label")}
              disabled={!props.taskID() || manualUrlSubmitting()}
              onInput={(event) => {
                setManualUrl(event.currentTarget.value)
                setManualUrlError("")
              }}
            />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              tone="neutral"
              title={t("browser_preview.url_submit")}
              aria-label={t("browser_preview.url_submit")}
              disabled={!props.taskID() || !manualUrl().trim() || manualUrlSubmitting()}
            >
              <Show when={manualUrlSubmitting()} fallback={<Icon name="send" size={13} />}>
                <span class="card__spinner" />
              </Show>
            </Button>
          </form>

          <Show when={viewports().length > 0}>
            <div class="browser-preview-viewport-controls">
              <Tabs
                size="sm"
                tone="neutral"
                value={viewportID()}
                onValueChange={(value) => setViewportID(value as BrowserPreviewViewportID)}
                aria-label={t("browser_preview.viewport.label")}
                data-ui="browser-preview-viewports"
                data-orientation="horizontal"
              >
                <For each={viewports()}>
                  {(item) => (
                    <Tab
                      value={item.id}
                      active={viewportID() === item.id}
                      size="sm"
                      tone="neutral"
                      data-ui="browser-preview-viewport"
                    >
                      {viewportLabel(item.id)}
                    </Tab>
                  )}
                </For>
              </Tabs>
            </div>
          </Show>

          <Button
            type="button"
            variant="outline"
            size="sm"
            tone="neutral"
            title={t("browser_preview.capture_title")}
            aria-label={t("browser_preview.capture_title")}
            disabled={!props.taskID() || !targetUrl() || !currentTarget()?.id || verification.loading}
            onClick={captureEvidence}
          >
            <Icon name="inspect" size={13} />
            <span>{t("browser_preview.capture")}</span>
          </Button>

          <div
            class="browser-preview-evidence-status"
            data-status={
              manualUrlError()
                ? "failed"
                : verification.error
                  ? "failed"
                  : (verification()?.status ?? (verification.loading ? "loading" : "idle"))
            }
          >
            <Switch>
              <Match when={manualUrlError()}>
                {(error) => (
                  <>
                    <Icon name="status-failed" size={14} />
                    <span>{error()}</span>
                  </>
                )}
              </Match>
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
                    <span>{resolved().captures[viewportID()]?.summary ?? resolved().diagnostics.join(" ")}</span>
                  </>
                )}
              </Match>
            </Switch>
          </div>
        </div>
      </div>

      <div class="browser-preview-stage">
        <Switch
          fallback={
            <div class="browser-preview-empty" data-status="missing">
              <Icon name="info-circle" size={18} />
              <p>{t("browser_preview.empty.missing")}</p>
            </div>
          }
        >
          <Match when={target.loading}>
            <div class="browser-preview-empty" data-status="loading">
              <span class="card__spinner" />
              <p>{t("browser_preview.loading")}</p>
            </div>
          </Match>
          <Match when={liveImageUrl()}>
            {(url) => (
              <section
                class="browser-preview-live"
                data-ui="browser-preview-live"
                data-status={liveError() ? "failed" : liveLoading() ? "loading" : "ready"}
              >
                <figure
                  class="browser-preview-live-frame"
                  tabIndex={0}
                  onPointerDown={handleLivePointerDown}
                  onWheel={handleLiveWheel}
                  onKeyDown={handleLiveKeyDown}
                  aria-label={t("browser_preview.title")}
                >
                  <img
                    src={url()}
                    alt={targetUrl() ?? t("browser_preview.title")}
                    data-ui="browser-preview-live-screenshot"
                    decoding="async"
                    draggable={false}
                  />
                </figure>
                <Show when={liveError()}>{(error) => <code>{error()}</code>}</Show>
              </section>
            )}
          </Match>
          <Match when={liveLoading()}>
            <div class="browser-preview-empty" data-status="loading" data-ui="browser-preview-live-loading">
              <span class="card__spinner" />
              <p>{t("browser_preview.loading")}</p>
              <Show when={targetUrl()}>{(url) => <code>{url()}</code>}</Show>
            </div>
          </Match>
          <Match when={liveError()}>
            {(error) => (
              <div class="browser-preview-empty" data-status="failed" data-ui="browser-preview-live-error">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.failed")}</p>
                <Show when={targetUrl()}>{(url) => <code>{url()}</code>}</Show>
                <code>{error()}</code>
              </div>
            )}
          </Match>
          <Match when={renderedEvidence()}>
            {(evidence) => (
              <section
                class="browser-preview-evidence"
                data-status={evidence().status}
                data-ui="browser-preview-evidence"
              >
                <div class="browser-preview-evidence-header">
                  <Icon name={evidence().status === "passed" ? "status-completed" : "status-failed"} size={16} />
                  <span>{statusLabel(evidence().status)}</span>
                  <code>{evidence().id}</code>
                </div>
                <p>{evidence().summary}</p>
                <Show when={captureImageUrl()}>
                  {(url) => (
                    <figure class="browser-preview-evidence-shot">
                      <img src={url()} alt={evidence().summary} data-ui="browser-preview-screenshot" decoding="async" />
                    </figure>
                  )}
                </Show>
                <dl class="browser-preview-evidence-facts">
                  <div>
                    <dt>{t("browser_preview.viewport.label")}</dt>
                    <dd>{viewportLabel(evidence().viewportID)}</dd>
                  </div>
                  <Show when={evidence().capture?.url}>
                    {(url) => (
                      <div>
                        <dt>{t("browser_preview.url_label")}</dt>
                        <dd>{url()}</dd>
                      </div>
                    )}
                  </Show>
                  <Show when={evidence().capture?.path}>
                    {(path) => (
                      <div>
                        <dt>path</dt>
                        <dd>{path()}</dd>
                      </div>
                    )}
                  </Show>
                </dl>
                <For each={evidence().diagnostics}>{(item) => <code>{item}</code>}</For>
              </section>
            )}
          </Match>
          <Match when={currentTarget()?.status === "failed" ? currentTarget() : undefined}>
            {(resolved) => (
              <div class="browser-preview-empty" data-status="failed" data-ui="browser-preview-target-failed">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.failed")}</p>
                <Show when={resolved().url}>{(url) => <code>{url()}</code>}</Show>
                <For each={resolved().diagnostics}>{(item) => <code>{item}</code>}</For>
              </div>
            )}
          </Match>
          <Match when={targetUrl()}>
            <div class="browser-preview-empty" data-status="ready" data-ui="browser-preview-evidence-missing">
              <Icon name="inspect" size={18} />
              <p>{t("browser_preview.capture_title")}</p>
              <code>{targetUrl()}</code>
            </div>
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
    </section>
  )
}

function BrowserPreviewCandidateOption(
  props: Select.SelectRootItemComponentProps<BrowserPreviewCandidate>,
): JSX.Element {
  const candidate = () => props.item.rawValue
  return (
    <Select.Item
      item={props.item}
      class="browser-preview-candidate-option"
      data-ui="browser-preview-candidate-option"
      data-target-id={candidate().id}
    >
      <Select.ItemLabel>{candidate().url}</Select.ItemLabel>
      <Select.ItemIndicator class="browser-preview-candidate-indicator">
        <Icon name="status-completed" size={12} />
      </Select.ItemIndicator>
    </Select.Item>
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
    case "passed":
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

function evidenceFromVerification(
  input: ReturnType<typeof captureTaskBrowserPreviewEvidence> extends Promise<infer T> ? T : never,
  viewportID: BrowserPreviewViewportID,
  scope: { taskID: string; targetID: string },
): BrowserPreviewEvidence {
  const capture = input.captures[viewportID]
  const evidenceID = input.evidenceIDs[viewportID]
  if (!evidenceID) {
    throw new Error(`Browser preview verification missing persisted evidence ID for viewport ${viewportID}`)
  }
  const summary = capture?.summary ?? input.diagnostics.join(" ")
  return {
    id: evidenceID,
    taskID: scope.taskID,
    targetID: scope.targetID,
    viewportID,
    status: capture?.captured && capture.passed ? "passed" : "failed",
    summary,
    capture,
    diagnostics: input.diagnostics,
    timeCompleted: 0,
    timeCreated: 0,
  }
}
