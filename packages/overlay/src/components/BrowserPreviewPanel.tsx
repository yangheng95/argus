import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch, untrack } from "solid-js"
import type { JSX } from "solid-js"
import { ApiError } from "../services/api"
import {
  captureTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewLiveSnapshotObjectUrl,
  loadTaskBrowserPreviewTarget,
  loadTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewEvidenceCaptureObjectUrl,
  selectTaskBrowserPreviewTarget,
  sendTaskBrowserPreviewLiveInputsObjectUrl,
  type BrowserPreviewEvidence,
  type BrowserPreviewLiveInput,
  type BrowserPreviewTarget,
  type BrowserPreviewViewportID,
} from "../services/browser-preview"
import { t } from "../utils/i18n"
import { createAnimationFrameScheduler } from "../utils/animation-frame"
import { Icon } from "./Icon"
import { PreviewableImage } from "./ImagePreview"
import { Button } from "./ui/Button"
import { SelectControl } from "./ui/SelectControl"
import { SegmentedControl } from "./ui/SegmentedControl"
import { SurfaceHeader } from "./ui/SurfaceHeader"
import { browserPreviewLivePoint, type BrowserPreviewLiveImageRect } from "./browser-preview-live-point"

type BrowserPreviewCandidate = BrowserPreviewTarget["candidates"][number]

type BrowserPreviewLiveImage = {
  directory: string
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  url: string
}

type BrowserPreviewEvidenceImage = {
  directory: string
  taskID: string
  evidenceID: string
  viewportID: BrowserPreviewViewportID
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
  const [liveImage, setLiveImage] = createSignal<BrowserPreviewLiveImage>()
  const [liveError, setLiveError] = createSignal("")
  const [liveLoading, setLiveLoading] = createSignal(false)
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
  const targetTransitionPending = createMemo(
    () => Boolean(pendingSelectedTargetID() && !currentTarget() && !currentTargetError()),
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
  const selectedViewport = createMemo(() => viewports().find((viewport) => viewport.id === viewportID()))
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
    if (request.taskID !== taskID || request.directory !== directory || request.targetID !== resolved.id) return undefined
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
  const liveScope = createMemo(() => {
    const taskID = props.taskID()
    const directory = props.directory()
    const resolved = currentTarget()
    const viewport = selectedViewport()
    if (!panelActive() || !taskID || !directory || resolved?.status !== "ready" || !resolved.id || !viewport) {
      return undefined
    }
    if (latestEvidenceScope() || renderedEvidence()) {
      return undefined
    }
    return { taskID, directory, targetID: resolved.id, viewportID: viewport.id, viewport }
  })
  const liveImageUrl = createMemo(() => {
    const scope = liveScope()
    const image = liveImage()
    if (!scope || !image || !browserPreviewLiveImageMatchesScope(image, scope)) return ""
    return image.url
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
      void refetchTarget()
    }
  })

  const selectCandidate = (candidate: BrowserPreviewCandidate | null) => {
    const taskID = props.taskID()
    const directory = props.directory()
    if (!taskID || !directory || !candidate || candidate.selected) return
    setPendingSelectedTargetID(candidate.id)
    setTargetSelectionError("")
    setVerificationRequest(undefined)
    clearLiveImageUrl()
    void selectTaskBrowserPreviewTarget({ taskID, directory, targetID: candidate.id })
      .then(() => setRefreshToken((value) => value + 1))
      .catch((error) => {
        if (props.taskID() !== taskID) return
        if (pendingSelectedTargetID() !== candidate.id) return
        setPendingSelectedTargetID("")
        setTargetSelectionError(browserPreviewErrorMessage(error))
        void refetchTarget()
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

  let liveFrameRequestSequence = 0
  let liveInputRequestInFlight = false
  let pendingLiveInputScopeKey = ""
  let pendingLiveInputs: BrowserPreviewLiveInput[] = []
  let liveImageElement: HTMLImageElement | null = null
  let liveImageScrollElement: HTMLElement | null = null
  let liveImageRect: BrowserPreviewLiveImageRect | undefined
  let liveImageRectScopeKey = ""
  let liveImageResizeObserver: ResizeObserver | null = null

  const flushLiveInputOnFrame = createAnimationFrameScheduler(() => {
    void flushLiveInputBatch()
  })

  const clearLiveImageRect = () => {
    liveImageRect = undefined
    liveImageRectScopeKey = ""
  }

  const measureLiveImageRectOnFrame = createAnimationFrameScheduler(() => {
    const scope = liveScope()
    const image = liveImage()
    const element = liveImageElement
    if (!scope || !image || !element || !browserPreviewLiveImageMatchesScope(image, scope)) {
      clearLiveImageRect()
      return
    }
    const rect = element.getBoundingClientRect()
    liveImageRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }
    liveImageRectScopeKey = browserPreviewLiveScopeKey(scope)
  })

  const scheduleLiveImageRectMeasure = () => {
    measureLiveImageRectOnFrame.schedule()
  }

  const disconnectLiveImageElement = () => {
    liveImageResizeObserver?.disconnect()
    liveImageResizeObserver = null
    liveImageScrollElement?.removeEventListener("scroll", scheduleLiveImageRectMeasure)
    liveImageScrollElement = null
    liveImageElement = null
    clearLiveImageRect()
  }

  const bindLiveImageElement = (element: HTMLImageElement) => {
    if (liveImageElement === element) {
      scheduleLiveImageRectMeasure()
      return
    }
    liveImageResizeObserver?.disconnect()
    liveImageScrollElement?.removeEventListener("scroll", scheduleLiveImageRectMeasure)
    const scrollElement = props.scrollElement()
    if (!scrollElement) {
      throw new Error("Browser preview live image must mount inside the center workbench scroll body.")
    }
    liveImageElement = element
    liveImageScrollElement = scrollElement
    clearLiveImageRect()
    liveImageScrollElement.addEventListener("scroll", scheduleLiveImageRectMeasure, { passive: true })
    if (typeof ResizeObserver !== "undefined") {
      liveImageResizeObserver = new ResizeObserver(scheduleLiveImageRectMeasure)
      liveImageResizeObserver.observe(element)
    } else {
      liveImageResizeObserver = null
    }
    scheduleLiveImageRectMeasure()
  }

  onCleanup(() => {
    flushLiveInputOnFrame.cancel()
    measureLiveImageRectOnFrame.cancel()
    disconnectLiveImageElement()
    const current = captureImage()
    if (current) URL.revokeObjectURL(current.url)
    const live = liveImage()
    if (live) URL.revokeObjectURL(live.url)
  })

  const replaceLiveImageUrl = (scope: NonNullable<ReturnType<typeof liveScope>>, next: string) => {
    const previous = liveImage()
    setLiveImage({
      directory: scope.directory,
      taskID: scope.taskID,
      targetID: scope.targetID,
      viewportID: scope.viewportID,
      url: next,
    })
    if (previous && previous.url !== next) URL.revokeObjectURL(previous.url)
    scheduleLiveImageRectMeasure()
  }

  const clearLiveImageUrl = () => {
    const previous = untrack(liveImage)
    if (!previous) return
    setLiveImage(undefined)
    disconnectLiveImageElement()
    URL.revokeObjectURL(previous.url)
  }

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
      setLiveError("")
      clearLiveImageUrl()
    }
    return key
  })

  const loadLiveFrame = async (scope: NonNullable<ReturnType<typeof liveScope>>, inputs?: BrowserPreviewLiveInput[]) => {
    const sequence = ++liveFrameRequestSequence
    setLiveLoading(true)
    setLiveError("")
    try {
      const next = inputs
        ? await sendTaskBrowserPreviewLiveInputsObjectUrl({ ...scope, inputs })
        : await loadTaskBrowserPreviewLiveSnapshotObjectUrl(scope)
      if (sequence !== liveFrameRequestSequence) {
        URL.revokeObjectURL(next)
        return
      }
      replaceLiveImageUrl(scope, next)
    } catch (error) {
      if (sequence === liveFrameRequestSequence) {
        setLiveError(error instanceof Error ? error.message : String(error))
        clearLiveImageUrl()
        if (error instanceof ApiError && error.status === 404) {
          void refetchTarget()
        }
      }
    } finally {
      if (sequence === liveFrameRequestSequence) {
        setLiveLoading(false)
      }
    }
  }

  const clearPendingLiveInputs = () => {
    pendingLiveInputs = []
    pendingLiveInputScopeKey = ""
    liveInputRequestInFlight = false
    flushLiveInputOnFrame.cancel()
  }

  const queueLiveInput = (input: BrowserPreviewLiveInput) => {
    const previous = pendingLiveInputs[pendingLiveInputs.length - 1]
    if (input.kind === "wheel" && previous?.kind === "wheel") {
      pendingLiveInputs[pendingLiveInputs.length - 1] = {
        kind: "wheel",
        x: input.x,
        y: input.y,
        deltaX: previous.deltaX + input.deltaX,
        deltaY: previous.deltaY + input.deltaY,
      }
      return
    }
    pendingLiveInputs.push(input)
  }

  async function flushLiveInputBatch() {
    if (liveInputRequestInFlight) return
    const scope = liveScope()
    if (!scope) {
      clearPendingLiveInputs()
      return
    }
    const key = browserPreviewLiveScopeKey(scope)
    if (pendingLiveInputScopeKey && pendingLiveInputScopeKey !== key) {
      clearPendingLiveInputs()
      return
    }
    if (pendingLiveInputs.length === 0) return
    const inputs = pendingLiveInputs
    pendingLiveInputs = []
    pendingLiveInputScopeKey = key
    liveInputRequestInFlight = true
    try {
      await loadLiveFrame(scope, inputs)
    } finally {
      const current = liveScope()
      liveInputRequestInFlight = false
      if (!current || browserPreviewLiveScopeKey(current) !== key) {
        clearPendingLiveInputs()
        return
      }
      if (pendingLiveInputs.length > 0) flushLiveInputOnFrame.schedule()
    }
  }

  const livePoint = (event: MouseEvent | WheelEvent) => {
    const viewport = selectedViewport()
    const scope = liveScope()
    const image = liveImage()
    if (!viewport || !scope || !image || !browserPreviewLiveImageMatchesScope(image, scope)) return undefined
    const key = browserPreviewLiveScopeKey(scope)
    if (!liveImageRect || liveImageRectScopeKey !== key) {
      scheduleLiveImageRectMeasure()
      return undefined
    }
    return browserPreviewLivePoint(event, liveImageRect, viewport)
  }

  const sendLiveInput = (input: BrowserPreviewLiveInput) => {
    const scope = liveScope()
    const image = liveImage()
    if (!scope || !image || !browserPreviewLiveImageMatchesScope(image, scope)) return
    const key = browserPreviewLiveScopeKey(scope)
    if (pendingLiveInputScopeKey && pendingLiveInputScopeKey !== key) clearPendingLiveInputs()
    pendingLiveInputScopeKey = key
    queueLiveInput(input)
    flushLiveInputOnFrame.schedule()
  }

  const handleLiveImageDecodeError = (url: string) => {
    const scope = liveScope()
    const image = liveImage()
    if (!scope || !image || image.url !== url || !browserPreviewLiveImageMatchesScope(image, scope)) return
    setLiveError(t("browser_preview.empty.live_decode_failed"))
    setLiveLoading(false)
    clearLiveImageUrl()
  }

  const handleLivePointerDown: JSX.EventHandlerUnion<HTMLElement, PointerEvent> = (event) => {
    if (event.button > 2) return
    const point = livePoint(event)
    if (!point) return
    event.currentTarget.focus()
    event.preventDefault()
    const button = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left"
    sendLiveInput({ kind: "click", ...point, button })
  }

  const handleLiveWheel: JSX.EventHandlerUnion<HTMLElement, WheelEvent> = (event) => {
    const point = livePoint(event)
    if (!point) return
    event.preventDefault()
    sendLiveInput({ kind: "wheel", ...point, deltaX: event.deltaX, deltaY: event.deltaY })
  }

  const handleLiveKeyDown: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent> = (event) => {
    if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") return
    if (event.key === "Tab" || event.key === "Escape") return
    event.preventDefault()
    sendLiveInput({ kind: "key", key: event.key })
  }

  createEffect<string | undefined>((previous) => {
    const scope = liveScope()
    const key = scope ? browserPreviewLiveScopeKey(scope) : undefined
    if (previous !== key) {
      liveFrameRequestSequence += 1
      clearPendingLiveInputs()
      clearLiveImageUrl()
      setLiveError("")
    }
    if (!scope) {
      clearPendingLiveInputs()
      setLiveLoading(false)
      return key
    }
    void loadLiveFrame(scope)
    return key
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
              onClick={() => {
                setTargetSelectionError("")
                setRefreshToken((value) => value + 1)
              }}
            >
              <Icon name="refresh" size={13} />
            </Button>
          }
        />

        <div class="browser-preview-controls">
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

          <Show when={readyTarget() && viewports().length > 0}>
            <div class="browser-preview-viewport-controls" data-ui="browser-preview-viewports" data-orientation="horizontal">
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
            title={t("browser_preview.capture_title")}
            aria-label={t("browser_preview.capture_title")}
            disabled={!props.taskID() || !readyTarget() || currentVerificationLoading()}
            onClick={captureEvidence}
          >
            <Icon name="inspect" size={13} />
            <span>{t("browser_preview.capture")}</span>
          </Button>

          <Show when={currentVerificationError() || currentVerificationLoading() || currentVerification() || renderedEvidence()}>
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
          <Match when={liveError()}>
            {(error) => (
              <div class="browser-preview-empty" data-status="failed" data-ui="browser-preview-live-error">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.live_failed")}</p>
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
          <Match when={liveImageUrl()}>
            {(url) => (
              <section
                class="browser-preview-live"
                data-ui="browser-preview-live"
                data-status={liveError() ? "failed" : liveLoading() ? "loading" : "ready"}
              >
                <figure
                  class="browser-preview-live-frame"
                  role="application"
                  tabIndex={0}
                  onPointerDown={handleLivePointerDown}
                  onWheel={handleLiveWheel}
                  onKeyDown={handleLiveKeyDown}
                  aria-label={t("browser_preview.title")}
                >
                  <img
                    ref={bindLiveImageElement}
                    src={url()}
                    alt={targetUrl() ?? t("browser_preview.title")}
                    data-ui="browser-preview-live-screenshot"
                    decoding="async"
                    draggable={false}
                    onLoad={scheduleLiveImageRectMeasure}
                    onError={() => handleLiveImageDecodeError(url())}
                  />
                </figure>
                <Show when={liveError()}>{(error) => <code>{error()}</code>}</Show>
              </section>
            )}
          </Match>
          <Match when={liveLoading()}>
            <div
              class="browser-preview-empty"
              data-status="loading"
              data-ui="browser-preview-live-loading"
              role="status"
              aria-live="polite"
            >
              <span class="card__spinner" />
              <p>{t("browser_preview.loading")}</p>
              <Show when={targetUrl()}>{(url) => <code>{url()}</code>}</Show>
            </div>
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

function browserPreviewLiveScopeKey(input: {
  directory: string
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
}): string {
  return `${input.directory}:${input.taskID}:${input.targetID}:${input.viewportID}`
}

function browserPreviewLiveImageMatchesScope(
  image: BrowserPreviewLiveImage,
  scope: { directory: string; taskID: string; targetID: string; viewportID: BrowserPreviewViewportID },
): boolean {
  return browserPreviewLiveScopeKey(image) === browserPreviewLiveScopeKey(scope)
}
