import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import { ApiError } from "../services/api"
import {
  captureTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewTarget,
  loadTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewEvidenceCaptureObjectUrl,
  selectTaskBrowserPreviewTarget,
  type BrowserPreviewEvidence,
  type BrowserPreviewTarget,
  type BrowserPreviewViewportID,
} from "../services/browser-preview"
import {
  browserPreviewNativeSurfaceAvailable,
  closeBrowserPreviewNativeSurface,
  navigateBrowserPreviewNativeSurface,
  syncBrowserPreviewNativeSurface,
} from "../services/browser-preview-native"
import type { BrowserPreviewNativeBounds, BrowserPreviewNativeNavigationAction } from "../services/host-transport"
import { t } from "../utils/i18n"
import { createAnimationFrameScheduler } from "../utils/animation-frame"
import { Icon } from "./Icon"
import { PreviewableImage } from "./ImagePreview"
import { Button } from "./ui/Button"
import { SelectControl } from "./ui/SelectControl"
import { SegmentedControl } from "./ui/SegmentedControl"
import { SurfaceHeader } from "./ui/SurfaceHeader"

type BrowserPreviewCandidate = BrowserPreviewTarget["candidates"][number]

type BrowserPreviewEvidenceImage = {
  directory: string
  taskID: string
  evidenceID: string
  viewportID: BrowserPreviewViewportID
  url: string
}

type BrowserPreviewNativeScope = {
  directory: string
  taskID: string
  targetID: string
  url: string
}

export interface BrowserPreviewPanelProps {
  active: () => boolean
  directory: () => string
  refreshKey: () => unknown
  scrollElement: () => HTMLElement | null
  taskID: () => string | undefined
  onReady?: (target: BrowserPreviewTarget) => void
}

export function BrowserPreviewPanel(props: BrowserPreviewPanelProps) {
  const [viewportID, setViewportID] = createSignal<BrowserPreviewViewportID>("desktop")
  const [viewportScopeKey, setViewportScopeKey] = createSignal("")
  const [refreshToken, setRefreshToken] = createSignal(0)
  const [lastAutoFocusedPreviewKey, setLastAutoFocusedPreviewKey] = createSignal("")
  const [pendingSelectedTargetID, setPendingSelectedTargetID] = createSignal("")
  const [targetSelectionError, setTargetSelectionError] = createSignal("")
  const [nativePreviewError, setNativePreviewError] = createSignal("")
  const [nativePreviewSyncing, setNativePreviewSyncing] = createSignal(false)
  const [targetLoadError, setTargetLoadError] = createSignal<{ taskID: string; message: string }>()
  const panelActive = createMemo(() => props.active())
  const [verificationRequest, setVerificationRequest] = createSignal<{
    directory: string
    taskID: string
    targetID: string
    viewportIDs: BrowserPreviewViewportID[]
    token: number
  }>()
  const [target, { refetch: refetchTarget }] = createResource(
    () => {
      const taskID = props.taskID()
      const directory = props.directory()
      if (!panelActive() || !taskID || !directory) return undefined
      return { taskID, directory, refreshKey: props.refreshKey(), refreshToken: refreshToken() }
    },
    async (scope) => {
      try {
        return await loadTaskBrowserPreviewTarget({ taskID: scope.taskID, directory: scope.directory })
      } catch (error) {
        setTargetLoadError({ taskID: scope.taskID, message: String(error) })
        return undefined
      }
    },
  )
  const [verification] = createResource(verificationRequest, (request) =>
    captureTaskBrowserPreviewEvidence({
      taskID: request.taskID,
      directory: request.directory,
      targetID: request.targetID,
      viewportIDs: request.viewportIDs,
    }),
  )
  const currentTarget = createMemo(() => {
    if (!panelActive()) return undefined
    const taskID = props.taskID()
    if (!taskID || !props.directory()) return undefined
    const resolved = target()
    if (!resolved || resolved.taskID !== taskID) return undefined
    const pendingTargetID = pendingSelectedTargetID()
    if (pendingTargetID && resolved.id !== pendingTargetID) return undefined
    return resolved
  })
  const currentTargetError = createMemo(() => {
    const taskID = props.taskID()
    if (!taskID || !props.directory()) return undefined
    const loadError = targetLoadError()
    if (loadError?.taskID === taskID) return loadError.message
    return targetSelectionError() || target.error
  })
  const targetTransitionPending = createMemo(() =>
    Boolean(pendingSelectedTargetID() && !currentTarget() && !currentTargetError()),
  )
  const latestEvidenceScope = createMemo(() => {
    const taskID = props.taskID()
    const targetID = currentTarget()?.id
    const evidenceID = currentTarget()?.latestEvidenceIDs?.[viewportID()]
    const directory = props.directory()
    if (!taskID || !directory || !targetID || !evidenceID) return undefined
    return { taskID, directory, evidenceID, targetID, viewportID: viewportID() }
  })
  const [latestEvidence] = createResource(latestEvidenceScope, (scope) => loadTaskBrowserPreviewEvidence(scope))
  const candidates = createMemo(() => currentTarget()?.candidates ?? [])
  const selectedCandidate = createMemo(
    () =>
      candidates().find((item) => item.selected) ??
      candidates().find((item) => item.id === currentTarget()?.id) ??
      null,
  )
  const viewports = createMemo(() => currentTarget()?.viewports ?? [])
  const viewportOptions = createMemo(() =>
    viewports().map((viewport) => ({
      value: viewport.id,
      label: viewportLabel(viewport.id),
    })),
  )
  const targetUrl = createMemo(() => currentTarget()?.url)
  const readyTarget = createMemo(() => {
    const resolved = currentTarget()
    return resolved?.status === "ready" && Boolean(resolved.id && resolved.url)
  })
  const currentVerificationRequest = createMemo(() => {
    const request = verificationRequest()
    const taskID = props.taskID()
    const directory = props.directory()
    const resolved = currentTarget()
    if (!request || !taskID || !directory || resolved?.status !== "ready" || !resolved.id) return undefined
    if (request.taskID !== taskID || request.directory !== directory || request.targetID !== resolved.id)
      return undefined
    return request
  })
  const currentVerification = createMemo(() => (currentVerificationRequest() ? verification() : undefined))
  const currentVerificationError = createMemo(() => (currentVerificationRequest() ? verification.error : undefined))
  const currentVerificationLoading = createMemo(() => Boolean(currentVerificationRequest() && verification.loading))
  const renderedEvidence = createMemo<BrowserPreviewEvidence | undefined>(() => {
    const resolved = currentTarget()
    if (resolved?.status !== "ready" || !resolved.id) return undefined
    const verified = currentVerification()
    const request = currentVerificationRequest()
    if (verified && request) {
      return evidenceFromVerification(verified, viewportID(), {
        taskID: request.taskID,
        targetID: request.targetID,
      })
    }
    const evidence = latestEvidence()
    const taskID = props.taskID()
    const targetID = resolved.id
    if (!evidence || !taskID || !targetID) return undefined
    if (evidence.taskID !== taskID || evidence.targetID !== targetID || evidence.viewportID !== viewportID()) {
      return undefined
    }
    return evidence
  })
  const nativePreviewScope = createMemo<BrowserPreviewNativeScope | undefined>(() => {
    const taskID = props.taskID()
    const directory = props.directory()
    const resolved = currentTarget()
    if (!panelActive() || !taskID || !directory || resolved?.status !== "ready" || !resolved.id || !resolved.url) {
      return undefined
    }
    if (latestEvidenceScope() || renderedEvidence()) {
      return undefined
    }
    return { taskID, directory, targetID: resolved.id, url: resolved.url }
  })
  const [captureImage] = createResource(
    () => {
      const evidence = renderedEvidence()
      if (!evidence?.capture?.captured) return undefined
      const directory = props.directory()
      if (!directory) return undefined
      return { taskID: evidence.taskID, directory, evidenceID: evidence.id, viewportID: evidence.viewportID }
    },
    async (scope): Promise<BrowserPreviewEvidenceImage> => ({
      ...scope,
      url: await loadTaskBrowserPreviewEvidenceCaptureObjectUrl(scope),
    }),
  )
  const currentCaptureImage = createMemo(() => {
    const evidence = renderedEvidence()
    const image = captureImage()
    if (!evidence || !image) return undefined
    if (
      image.taskID !== evidence.taskID ||
      image.evidenceID !== evidence.id ||
      image.viewportID !== evidence.viewportID
    ) {
      return undefined
    }
    return image
  })

  const refetchTargetFromPanel = () => {
    const taskID = props.taskID()
    if (!taskID) return
    void Promise.resolve(refetchTarget()).catch((error) => {
      if (props.taskID() !== taskID) return
      setTargetLoadError({ taskID, message: browserPreviewErrorMessage(error) })
    })
  }

  createEffect(() => {
    const taskID = props.taskID()
    if (!taskID || !props.directory()) {
      setTargetLoadError(undefined)
      return
    }
    const error = target.error
    if (error) setTargetLoadError({ taskID, message: String(error) })
  })

  createEffect(() => {
    const taskID = props.taskID()
    const resolved = target()
    if (taskID && resolved?.taskID === taskID) setTargetLoadError(undefined)
  })

  createEffect<BrowserPreviewEvidenceImage | undefined>((previous) => {
    const current = captureImage()
    if (previous?.url && previous.url !== current?.url) URL.revokeObjectURL(previous.url)
    return current
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
    const pendingTargetID = pendingSelectedTargetID()
    const resolved = target()
    if (pendingTargetID && resolved?.id === pendingTargetID) setPendingSelectedTargetID("")
  })

  createEffect(() => {
    props.taskID()
    props.directory()
    setPendingSelectedTargetID("")
    setTargetSelectionError("")
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
    const error = currentVerificationError()
    if (error instanceof ApiError && error.status === 404) {
      setVerificationRequest(undefined)
      refetchTargetFromPanel()
    }
  })

  const selectCandidate = (candidate: BrowserPreviewCandidate | null) => {
    const taskID = props.taskID()
    const directory = props.directory()
    if (!taskID || !directory || !candidate || candidate.selected) return
    setPendingSelectedTargetID(candidate.id)
    setTargetSelectionError("")
    setVerificationRequest(undefined)
    requestNativePreviewClose(false)
    void selectTaskBrowserPreviewTarget({ taskID, directory, targetID: candidate.id })
      .then(() => setRefreshToken((value) => value + 1))
      .catch((error) => {
        if (props.taskID() !== taskID) return
        if (pendingSelectedTargetID() !== candidate.id) return
        setPendingSelectedTargetID("")
        setTargetSelectionError(browserPreviewErrorMessage(error))
        refetchTargetFromPanel()
      })
  }

  const captureEvidence = () => {
    const taskID = props.taskID()
    const directory = props.directory()
    const resolved = currentTarget()
    if (!taskID || !directory || resolved?.status !== "ready" || !resolved.url || !resolved.id) return
    const viewportIDs = viewports().map((viewport) => viewport.id)
    if (viewportIDs.length === 0) return
    setVerificationRequest({ taskID, directory, targetID: resolved.id, viewportIDs, token: Date.now() })
  }

  let nativeSurfaceElement: HTMLElement | null = null
  let nativeSurfaceScrollElement: HTMLElement | null = null
  let nativeSurfaceResizeObserver: ResizeObserver | null = null
  let lastNativePreviewSyncKey = ""
  let nativePreviewSyncSequence = 0

  const syncNativePreviewOnFrame = createAnimationFrameScheduler(() => {
    void syncNativePreviewSurface()
  })

  const scheduleNativePreviewSync = () => {
    syncNativePreviewOnFrame.schedule()
  }

  const disconnectNativePreviewElement = () => {
    nativeSurfaceResizeObserver?.disconnect()
    nativeSurfaceResizeObserver = null
    nativeSurfaceScrollElement?.removeEventListener("scroll", scheduleNativePreviewSync)
    nativeSurfaceScrollElement = null
    if (typeof window !== "undefined") window.removeEventListener("resize", scheduleNativePreviewSync)
    nativeSurfaceElement = null
    lastNativePreviewSyncKey = ""
  }

  const bindNativePreviewElement = (element: HTMLElement) => {
    if (nativeSurfaceElement === element) {
      scheduleNativePreviewSync()
      return
    }
    nativeSurfaceResizeObserver?.disconnect()
    nativeSurfaceScrollElement?.removeEventListener("scroll", scheduleNativePreviewSync)
    if (typeof window !== "undefined") window.removeEventListener("resize", scheduleNativePreviewSync)
    const scrollElement = props.scrollElement()
    if (!scrollElement) {
      throw new Error("Browser preview native surface must mount inside the center workbench scroll body.")
    }
    nativeSurfaceElement = element
    nativeSurfaceScrollElement = scrollElement
    nativeSurfaceScrollElement.addEventListener("scroll", scheduleNativePreviewSync, { passive: true })
    if (typeof window !== "undefined") window.addEventListener("resize", scheduleNativePreviewSync)
    if (typeof ResizeObserver !== "undefined") {
      nativeSurfaceResizeObserver = new ResizeObserver(scheduleNativePreviewSync)
      nativeSurfaceResizeObserver.observe(element)
    } else {
      nativeSurfaceResizeObserver = null
    }
    lastNativePreviewSyncKey = ""
    scheduleNativePreviewSync()
  }

  function requestNativePreviewClose(reportError = true): void {
    lastNativePreviewSyncKey = ""
    nativePreviewSyncSequence += 1
    setNativePreviewSyncing(false)
    if (!browserPreviewNativeSurfaceAvailable()) return
    void closeBrowserPreviewNativeSurface().catch((error) => {
      if (!reportError) return
      setNativePreviewError(browserPreviewErrorMessage(error))
    })
  }

  async function syncNativePreviewSurface(): Promise<void> {
    const scope = nativePreviewScope()
    const element = nativeSurfaceElement
    if (!scope || !element) return
    if (!browserPreviewNativeSurfaceAvailable()) {
      setNativePreviewSyncing(false)
      setNativePreviewError(t("browser_preview.empty.native_unsupported"))
      return
    }
    const bounds = browserPreviewNativeElementBounds(element)
    if (!bounds) {
      lastNativePreviewSyncKey = ""
      return
    }
    const syncKey = `${browserPreviewNativeScopeKey(scope)}:${browserPreviewNativeBoundsKey(bounds)}`
    if (lastNativePreviewSyncKey === syncKey) return
    const sequence = ++nativePreviewSyncSequence
    setNativePreviewSyncing(true)
    setNativePreviewError("")
    try {
      await syncBrowserPreviewNativeSurface({ url: scope.url, bounds })
      if (sequence === nativePreviewSyncSequence) lastNativePreviewSyncKey = syncKey
    } catch (error) {
      if (sequence === nativePreviewSyncSequence) {
        lastNativePreviewSyncKey = ""
        setNativePreviewError(browserPreviewErrorMessage(error))
        requestNativePreviewClose(false)
      }
    } finally {
      if (sequence === nativePreviewSyncSequence) setNativePreviewSyncing(false)
    }
  }

  function navigateNativePreview(action: BrowserPreviewNativeNavigationAction): void {
    if (!nativePreviewScope() || !browserPreviewNativeSurfaceAvailable()) return
    setNativePreviewError("")
    void navigateBrowserPreviewNativeSurface(action).catch((error) => {
      setNativePreviewError(browserPreviewErrorMessage(error))
    })
  }

  onCleanup(() => {
    syncNativePreviewOnFrame.cancel()
    disconnectNativePreviewElement()
    requestNativePreviewClose(false)
    const current = captureImage()
    if (current) URL.revokeObjectURL(current.url)
  })

  const taskScopeKey = createMemo(() => {
    const taskID = props.taskID()
    const directory = props.directory()
    return taskID && directory ? `${taskID}:${directory}` : ""
  })

  createEffect<string>((previous) => {
    const key = taskScopeKey()
    if (previous !== key) {
      setPendingSelectedTargetID("")
      setTargetSelectionError("")
      setVerificationRequest(undefined)
      setNativePreviewError("")
      if (previous) requestNativePreviewClose(false)
    }
    return key
  })

  createEffect<string | undefined>((previous) => {
    const scope = nativePreviewScope()
    const key = scope ? browserPreviewNativeScopeKey(scope) : undefined
    if (previous && previous !== key) requestNativePreviewClose(false)
    if (previous !== key) {
      nativePreviewSyncSequence += 1
      lastNativePreviewSyncKey = ""
      setNativePreviewError("")
    }
    if (!scope) {
      setNativePreviewSyncing(false)
      return key
    }
    if (!browserPreviewNativeSurfaceAvailable()) {
      setNativePreviewSyncing(false)
      setNativePreviewError(t("browser_preview.empty.native_unsupported"))
      return key
    }
    scheduleNativePreviewSync()
    return key
  })

  return (
    <section class="browser-preview-panel" aria-label={t("browser_preview.title")} data-active={String(panelActive())}>
      <div class="browser-preview-command-surface">
        <SurfaceHeader
          variant="panel"
          title={t("browser_preview.title")}
          actions={
            <>
              <div
                class="browser-preview-status"
                data-status={
                  targetSelectionError() || currentTargetError()
                    ? "failed"
                    : targetTransitionPending()
                      ? "loading"
                      : (currentTarget()?.status ?? "loading")
                }
                role={target.loading || targetTransitionPending() ? "status" : undefined}
                aria-live={target.loading || targetTransitionPending() ? "polite" : undefined}
              >
                <Switch
                  fallback={
                    <>
                      <Icon name="info-circle" size={14} />
                      <span>{t("browser_preview.status.missing")}</span>
                    </>
                  }
                >
                  <Match when={target.loading || targetTransitionPending()}>
                    <span class="card__spinner" />
                    <span>{t("browser_preview.loading")}</span>
                  </Match>
                  <Match when={targetSelectionError()}>
                    <Icon name="status-failed" size={14} />
                    <span>{t("browser_preview.status.failed")}</span>
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
              <Button
                type="button"
                variant="outline"
                size="icon"
                tone="neutral"
                title={t("browser_preview.refresh_title")}
                aria-label={t("browser_preview.refresh_title")}
                disabled={!props.taskID()}
                onClick={() => {
                  setTargetSelectionError("")
                  setRefreshToken((value) => value + 1)
                }}
              >
                <Icon name="refresh" size={13} />
              </Button>
            </>
          }
        />

        <div class="browser-preview-controls" data-ui="browser-preview-toolbar">
          <div class="browser-preview-toolbar-row" data-row="address">
            <Show when={readyTarget()}>
              <div class="browser-preview-browser-controls" data-ui="browser-preview-navigation-controls">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tone="neutral"
                  title={t("browser_preview.navigation.back_title")}
                  aria-label={t("browser_preview.navigation.back_title")}
                  disabled={!nativePreviewScope() || !browserPreviewNativeSurfaceAvailable()}
                  onClick={() => navigateNativePreview("back")}
                >
                  <Icon name="nav-back" size={13} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tone="neutral"
                  title={t("browser_preview.navigation.forward_title")}
                  aria-label={t("browser_preview.navigation.forward_title")}
                  disabled={!nativePreviewScope() || !browserPreviewNativeSurfaceAvailable()}
                  onClick={() => navigateNativePreview("forward")}
                >
                  <Icon name="nav-forward" size={13} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tone="neutral"
                  title={t("browser_preview.navigation.reload_title")}
                  aria-label={t("browser_preview.navigation.reload_title")}
                  disabled={!nativePreviewScope() || !browserPreviewNativeSurfaceAvailable()}
                  onClick={() => navigateNativePreview("reload")}
                >
                  <Icon name="refresh" size={13} />
                </Button>
              </div>
            </Show>

            <Show when={readyTarget() && candidates().length > 0}>
              <SelectControl<BrowserPreviewCandidate>
                class="browser-preview-candidate-select"
                options={candidates()}
                value={selectedCandidate()}
                onChange={selectCandidate}
                optionValue="id"
                optionTextValue="url"
                disabled={candidates().length <= 1}
                disallowEmptySelection
                gutter={4}
                sameWidth
                beforeTrigger={<Icon name="external-link" size={13} />}
                triggerClass="browser-preview-candidate-trigger"
                triggerDataUI="browser-preview-candidate-trigger"
                ariaLabel={t("browser_preview.candidates.label")}
                contentClass="browser-preview-candidate-content"
                listboxClass="browser-preview-candidate-listbox"
                optionClass="browser-preview-candidate-option"
                indicatorClass="browser-preview-candidate-indicator"
                optionData={(candidate) => ({
                  "data-ui": "browser-preview-candidate-option",
                  "data-target-id": candidate.id,
                })}
                renderValue={(candidate) => <span>{candidate?.url ?? targetUrl() ?? ""}</span>}
                renderOptionLabel={(candidate) => candidate.url}
              />
            </Show>

          </div>

          <div class="browser-preview-toolbar-row" data-row="tools">
            <Show when={readyTarget() && viewports().length > 0}>
              <div
                class="browser-preview-viewport-controls"
                data-ui="browser-preview-viewports"
                data-orientation="horizontal"
              >
                <SegmentedControl<BrowserPreviewViewportID>
                  options={viewportOptions()}
                  value={viewportID()}
                  onChange={setViewportID}
                  ariaLabel={t("browser_preview.viewport.label")}
                  class="oc-tabs"
                  itemClass="oc-tab"
                  itemAttributes={(option) => ({
                    "data-ui": "browser-preview-viewport",
                    "data-viewport-id": option.value,
                    "data-size": "sm",
                  })}
                />
              </div>
            </Show>

            <Button
              type="button"
              variant="outline"
              size="sm"
              tone="neutral"
              class="browser-preview-capture-button"
              title={t("browser_preview.capture_title")}
              aria-label={t("browser_preview.capture_title")}
              disabled={!props.taskID() || !readyTarget() || currentVerificationLoading()}
              onClick={captureEvidence}
            >
              <Icon name="inspect" size={13} />
              <span>{t("browser_preview.capture")}</span>
            </Button>

            <Show
              when={
                currentVerificationError() || currentVerificationLoading() || currentVerification() || renderedEvidence()
              }
            >
              <div
                class="browser-preview-evidence-status"
                data-status={
                  currentVerificationError()
                    ? "failed"
                    : (currentVerification()?.status ??
                      renderedEvidence()?.status ??
                      (currentVerificationLoading() ? "loading" : "idle"))
                }
                role={currentVerificationLoading() ? "status" : undefined}
                aria-live={currentVerificationLoading() ? "polite" : undefined}
              >
                <Switch>
                  <Match when={currentVerificationError()}>
                    {(error) => (
                      <>
                        <Icon name="status-failed" size={14} />
                        <span>{String(error())}</span>
                      </>
                    )}
                  </Match>
                  <Match when={currentVerificationLoading()}>
                    <span class="card__spinner" />
                    <span>{t("browser_preview.capture_loading")}</span>
                  </Match>
                  <Match when={currentVerification()}>
                    {(resolved) => (
                      <>
                        <Icon name={resolved().status === "passed" ? "status-completed" : "status-failed"} size={14} />
                        <span>{resolved().captures[viewportID()]?.summary ?? resolved().diagnostics.join(" ")}</span>
                      </>
                    )}
                  </Match>
                  <Match when={renderedEvidence()}>
                    {(evidence) => (
                      <>
                        <Icon name={evidence().status === "passed" ? "status-completed" : "status-failed"} size={14} />
                        <span>{evidence().summary}</span>
                      </>
                    )}
                  </Match>
                </Switch>
              </div>
            </Show>
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
          <Match when={targetSelectionError()}>
            {(error) => (
              <div class="browser-preview-empty" data-status="failed" data-ui="browser-preview-selection-failed">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.selection_failed")}</p>
                <code>{error()}</code>
              </div>
            )}
          </Match>
          <Match when={currentTargetError()}>
            {(error) => (
              <div class="browser-preview-empty" data-status="failed" data-ui="browser-preview-target-load-failed">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.failed")}</p>
                <code>{String(error())}</code>
              </div>
            )}
          </Match>
          <Match when={target.loading || targetTransitionPending()}>
            <div class="browser-preview-empty" data-status="loading" role="status" aria-live="polite">
              <span class="card__spinner" />
              <p>{t("browser_preview.loading")}</p>
            </div>
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
          <Match when={nativePreviewError()}>
            {(error) => (
              <div class="browser-preview-empty" data-status="failed" data-ui="browser-preview-native-error">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.native_failed")}</p>
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
                  <span>{evidenceStatusLabel(evidence().status)}</span>
                  <code>{evidence().id}</code>
                </div>
                <p>{evidence().summary}</p>
                <Show when={currentCaptureImage()}>
                  {(image) => (
                    <PreviewableImage
                      src={image().url}
                      alt={evidence().summary}
                      triggerClass="browser-preview-evidence-shot"
                      imageClass="browser-preview-evidence-image"
                      imageDataUI="browser-preview-screenshot"
                      imageAttributes={{
                        "data-evidence-id": image().evidenceID,
                        decoding: "async",
                      }}
                    />
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
                </dl>
                <For each={evidence().diagnostics}>{(item) => <code>{item}</code>}</For>
              </section>
            )}
          </Match>
          <Match when={nativePreviewScope()}>
            {(scope) => (
              <section
                class="browser-preview-live"
                data-ui="browser-preview-live"
                data-status={nativePreviewSyncing() ? "loading" : "ready"}
                data-target-id={scope().targetID}
              >
                <div class="browser-preview-native-frame">
                  <div
                    ref={bindNativePreviewElement}
                    class="browser-preview-native-surface"
                    data-ui="browser-preview-native-surface"
                    role="application"
                    aria-label={t("browser_preview.title")}
                  >
                    <Show when={nativePreviewSyncing()}>
                      <span class="card__spinner" aria-hidden="true" />
                    </Show>
                  </div>
                </div>
              </section>
            )}
          </Match>
          <Match when={targetUrl()}>
            <div class="browser-preview-empty" data-status="ready" data-ui="browser-preview-evidence-missing">
              <Icon name="inspect" size={18} />
              <p>{t("browser_preview.capture_title")}</p>
              <code>{targetUrl()}</code>
            </div>
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

function evidenceStatusLabel(status: string): string {
  switch (status) {
    case "passed":
      return t("browser_preview.evidence.passed")
    case "failed":
      return t("browser_preview.evidence.failed")
    default:
      return status
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

function browserPreviewErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

function browserPreviewNativeScopeKey(input: BrowserPreviewNativeScope): string {
  return `${input.directory}:${input.taskID}:${input.targetID}:${input.url}`
}

function browserPreviewNativeBoundsKey(bounds: BrowserPreviewNativeBounds): string {
  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
}

function browserPreviewNativeElementBounds(element: HTMLElement): BrowserPreviewNativeBounds | undefined {
  const rect = element.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const x = Math.max(0, rect.left)
  const y = Math.max(0, rect.top)
  const right = Math.min(viewportWidth, rect.right)
  const bottom = Math.min(viewportHeight, rect.bottom)
  const width = right - x
  const height = bottom - y
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined
  }
  return { x, y, width, height }
}
