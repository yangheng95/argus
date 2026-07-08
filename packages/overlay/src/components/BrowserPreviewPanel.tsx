import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { ApiError } from "../services/api"
import {
  captureTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewTarget,
  loadTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewEvidenceCaptureObjectUrl,
  saveTaskBrowserPreviewTarget,
  type BrowserPreviewEvidence,
  type BrowserPreviewTarget,
  type BrowserPreviewViewportID,
} from "../services/browser-preview"
import {
  browserPreviewNativeSurfaceAvailable,
  closeBrowserPreviewNativeSurface,
  navigateBrowserPreviewNativeSurface,
  setNativeSelectionEnabled,
  syncBrowserPreviewNativeSurface,
  takeNativeSelection,
} from "../services/browser-preview-native"
import type { BrowserPreviewNativeBounds, BrowserPreviewNativeNavigationAction } from "../services/host-transport"
import { t } from "../utils/i18n"
import { createAnimationFrameScheduler } from "../utils/animation-frame"
import { Icon } from "./Icon"
import { PreviewableImage } from "./ImagePreview"
import { Button } from "./ui/Button"

type BrowserPreviewScopedTarget = BrowserPreviewTarget & { directory: string }

type BrowserPreviewEvidenceImage = {
  directory: string
  taskID: string
  evidenceID: string
  viewportID: BrowserPreviewViewportID
  url: string
}

type BrowserPreviewEvidenceImageRequest = Omit<BrowserPreviewEvidenceImage, "url">

type BrowserPreviewEvidenceImageLoadResult =
  | (BrowserPreviewEvidenceImage & { status: "loaded" })
  | (BrowserPreviewEvidenceImageRequest & { status: "failed"; message: string })

type BrowserPreviewRenderedEvidence = Omit<BrowserPreviewEvidence, "id"> & { id?: string }
type BrowserPreviewLatestEvidenceScope = {
  directory: string
  taskID: string
  targetID: string
  evidenceID: string
  viewportID: BrowserPreviewViewportID
}
type BrowserPreviewLatestEvidenceResult =
  | (BrowserPreviewLatestEvidenceScope & { status: "loaded"; evidence: BrowserPreviewEvidence })
  | (BrowserPreviewLatestEvidenceScope & { status: "failed"; message: string })
type BrowserPreviewVerification = Awaited<ReturnType<typeof captureTaskBrowserPreviewEvidence>>
type BrowserPreviewVerificationRequest = {
  directory: string
  taskID: string
  targetID: string
  viewportIDs: BrowserPreviewViewportID[]
  targetKey: string
  token: number
}
type BrowserPreviewVerificationResult =
  | (BrowserPreviewVerificationRequest & { status: "loaded"; verification: BrowserPreviewVerification })
  | (BrowserPreviewVerificationRequest & { status: "failed"; error: unknown })

type BrowserPreviewNativeScope = {
  directory: string
  taskID: string
  targetID: string
  url: string
}

type BrowserPreviewNodeSelection = {
  x: number
  y: number
  width: number
  height: number
  label: string
  tagName?: string
  selector?: string
  jsPath?: string
  domPath?: string
  textPreview?: string
  role?: string
  accessibleName?: string
  pageUrl?: string
  pageTitle?: string
  sourceHint?: string
  computedColor?: string
  computedFont?: string
  capturedAt?: number
}

const DEFAULT_BROWSER_PREVIEW_VIEWPORTS = [
  { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
  { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 927, height: 1201 },
  { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 412, height: 915 },
] satisfies BrowserPreviewTarget["viewports"]

export interface BrowserPreviewPanelProps {
  active: () => boolean
  directory: () => string
  refreshKey: () => unknown
  scrollElement: () => HTMLElement | null
  taskID: () => string | undefined
  onCommentDraft?: (text: string) => void
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
  const [nodeSelectionEnabled, setNodeSelectionEnabled] = createSignal(false)
  const [nodeSelection, setNodeSelection] = createSignal<BrowserPreviewNodeSelection>()
  const [nodeCommentText, setNodeCommentText] = createSignal("")
  const [addressDraft, setAddressDraft] = createSignal("")
  const [addressDirty, setAddressDirty] = createSignal(false)
  const [addressSaving, setAddressSaving] = createSignal(false)
  const [addressError, setAddressError] = createSignal("")
  const [targetLoadError, setTargetLoadError] = createSignal<{ taskID: string; directory: string; message: string }>()
  const panelActive = createMemo(() => props.active())
  const [verificationRequest, setVerificationRequest] = createSignal<BrowserPreviewVerificationRequest>()
  const [target, { refetch: refetchTarget }] = createResource(
    () => {
      const taskID = props.taskID()
      const directory = props.directory()
      if (!panelActive() || !taskID || !directory) return undefined
      return { taskID, directory, refreshKey: props.refreshKey(), refreshToken: refreshToken() }
    },
    async (scope) => {
      try {
        return {
          ...(await loadTaskBrowserPreviewTarget({ taskID: scope.taskID, directory: scope.directory })),
          directory: scope.directory,
        } satisfies BrowserPreviewScopedTarget
      } catch (error) {
        setTargetLoadError({ taskID: scope.taskID, directory: scope.directory, message: String(error) })
        return undefined
      }
    },
  )
  const [verification] = createResource(
    verificationRequest,
    async (request): Promise<BrowserPreviewVerificationResult> => {
      try {
        return {
          ...request,
          status: "loaded",
          verification: await captureTaskBrowserPreviewEvidence({
            taskID: request.taskID,
            directory: request.directory,
            targetID: request.targetID,
            viewportIDs: request.viewportIDs,
          }),
        }
      } catch (error) {
        return { ...request, status: "failed", error }
      }
    },
  )
  const currentTarget = createMemo(() => {
    if (!panelActive()) return undefined
    const taskID = props.taskID()
    const directory = props.directory()
    if (!taskID || !directory) return undefined
    const resolved = target()
    if (!resolved || resolved.taskID !== taskID || resolved.directory !== directory) return undefined
    const pendingTargetID = pendingSelectedTargetID()
    if (pendingTargetID && resolved.id !== pendingTargetID) return undefined
    return resolved
  })
  const currentTargetError = createMemo(() => {
    if (target.loading) return undefined
    const taskID = props.taskID()
    const directory = props.directory()
    if (!taskID || !directory) return undefined
    const loadError = targetLoadError()
    if (loadError?.taskID === taskID && loadError.directory === directory) return loadError.message
    return targetSelectionError() || addressError() || target.error
  })
  const targetTransitionPending = createMemo(() =>
    Boolean(pendingSelectedTargetID() && !currentTarget() && !currentTargetError()),
  )
  const targetRequestKey = createMemo(() => {
    const taskID = props.taskID()
    const directory = props.directory()
    if (!panelActive() || !taskID || !directory) return ""
    return `${taskID}:${directory}:${String(props.refreshKey())}:${refreshToken()}`
  })
  const latestEvidenceScope = createMemo<BrowserPreviewLatestEvidenceScope | undefined>(() => {
    const taskID = props.taskID()
    const targetID = currentTarget()?.id
    const evidenceID = currentTarget()?.latestEvidenceIDs?.[viewportID()]
    const directory = props.directory()
    if (!taskID || !directory || !targetID || !evidenceID) return undefined
    return { taskID, directory, evidenceID, targetID, viewportID: viewportID() }
  })
  const [latestEvidence] = createResource(
    latestEvidenceScope,
    async (scope): Promise<BrowserPreviewLatestEvidenceResult> => {
      try {
        return { ...scope, status: "loaded", evidence: await loadTaskBrowserPreviewEvidence(scope) }
      } catch (error) {
        return { ...scope, status: "failed", message: browserPreviewErrorMessage(error) }
      }
    },
  )
  const viewports = createMemo(() => currentTarget()?.viewports ?? [])
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
    if (request.targetKey !== browserPreviewTargetKey(resolved)) return undefined
    return request
  })
  const currentVerificationResult = createMemo(() => {
    const request = currentVerificationRequest()
    const result = verification()
    if (!request || !result) return undefined
    if (
      result.taskID !== request.taskID ||
      result.directory !== request.directory ||
      result.targetID !== request.targetID ||
      result.token !== request.token
    ) {
      return undefined
    }
    return result
  })
  const currentVerification = createMemo(() => {
    const result = currentVerificationResult()
    return result?.status === "loaded" ? result.verification : undefined
  })
  const currentVerificationError = createMemo(() => {
    const result = currentVerificationResult()
    return result?.status === "failed" ? result.error : undefined
  })
  const currentVerificationLoading = createMemo(() => Boolean(currentVerificationRequest() && verification.loading))
  const renderedEvidence = createMemo<BrowserPreviewRenderedEvidence | undefined>(() => {
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
    const scope = latestEvidenceScope()
    const latest = latestEvidence()
    const taskID = props.taskID()
    const targetID = resolved.id
    if (!scope || !latest || latest.status !== "loaded" || !taskID || !targetID) return undefined
    if (
      latest.taskID !== scope.taskID ||
      latest.directory !== scope.directory ||
      latest.targetID !== scope.targetID ||
      latest.evidenceID !== scope.evidenceID ||
      latest.viewportID !== scope.viewportID
    ) {
      return undefined
    }
    const evidence = latest.evidence
    if (evidence.taskID !== taskID || evidence.targetID !== targetID || evidence.viewportID !== viewportID()) {
      return undefined
    }
    if (evidence.id !== scope.evidenceID) {
      return undefined
    }
    return evidence
  })
  const currentLatestEvidenceError = createMemo(() => {
    const scope = latestEvidenceScope()
    if (!scope || latestEvidence.loading || renderedEvidence()) return undefined
    const latest = latestEvidence()
    if (!latest || latest.status !== "failed") return undefined
    if (
      latest.taskID !== scope.taskID ||
      latest.directory !== scope.directory ||
      latest.targetID !== scope.targetID ||
      latest.evidenceID !== scope.evidenceID ||
      latest.viewportID !== scope.viewportID
    ) {
      return undefined
    }
    return latest
  })
  const currentLatestEvidenceLoading = createMemo(() =>
    Boolean(latestEvidenceScope() && latestEvidence.loading && !renderedEvidence()),
  )
  const previewActionPending = createMemo(() =>
    Boolean(
      target.loading || targetTransitionPending() || currentVerificationLoading() || currentLatestEvidenceLoading(),
    ),
  )
  const nativePreviewScope = createMemo<BrowserPreviewNativeScope | undefined>(() => {
    const taskID = props.taskID()
    const directory = props.directory()
    const resolved = currentTarget()
    if (!panelActive() || !taskID || !directory || resolved?.status !== "ready" || !resolved.id || !resolved.url) {
      return undefined
    }
    if (!browserPreviewNativeSurfaceAvailable()) {
      return undefined
    }
    if (currentVerificationRequest()) {
      return undefined
    }
    if ((latestEvidenceScope() || renderedEvidence()) && !nodeSelectionEnabled() && !nodeSelection()) {
      return undefined
    }
    return { taskID, directory, targetID: resolved.id, url: resolved.url }
  })
  const [captureImage] = createResource(
    () => {
      const evidence = renderedEvidence()
      if (!evidence?.capture?.captured || !evidence.id) return undefined
      const directory = props.directory()
      if (!directory) return undefined
      return { taskID: evidence.taskID, directory, evidenceID: evidence.id, viewportID: evidence.viewportID }
    },
    async (scope): Promise<BrowserPreviewEvidenceImageLoadResult> => {
      try {
        return {
          ...scope,
          status: "loaded",
          url: await loadTaskBrowserPreviewEvidenceCaptureObjectUrl(scope),
        }
      } catch (error) {
        return {
          ...scope,
          status: "failed",
          message: `${t("browser_preview.evidence.image_failed")}: ${browserPreviewErrorMessage(error)}`,
        }
      }
    },
  )
  const currentCaptureImage = createMemo(() => {
    const evidence = renderedEvidence()
    const image = captureImage()
    const directory = props.directory()
    if (!evidence?.id || !image) return undefined
    if (image.status !== "loaded") return undefined
    if (
      image.taskID !== evidence.taskID ||
      image.evidenceID !== evidence.id ||
      image.viewportID !== evidence.viewportID ||
      image.directory !== directory
    ) {
      return undefined
    }
    return image
  })
  const currentCaptureImageError = createMemo(() => {
    const evidence = renderedEvidence()
    if (!evidence?.capture?.captured || !evidence.id) return undefined
    const result = captureImage()
    if (!result || result.status !== "failed") return undefined
    if (
      result.taskID !== evidence.taskID ||
      result.evidenceID !== evidence.id ||
      result.viewportID !== evidence.viewportID ||
      result.directory !== props.directory()
    ) {
      return undefined
    }
    return result.message
  })

  const refetchTargetFromPanel = () => {
    const taskID = props.taskID()
    const directory = props.directory()
    if (!taskID || !directory) return
    void Promise.resolve(refetchTarget()).catch((error) => {
      if (props.taskID() !== taskID || props.directory() !== directory) return
      setTargetLoadError({ taskID, directory, message: browserPreviewErrorMessage(error) })
    })
  }

  createEffect(() => {
    const taskID = props.taskID()
    const directory = props.directory()
    if (!taskID || !directory) {
      setTargetLoadError(undefined)
      return
    }
    const error = target.error
    if (error) setTargetLoadError({ taskID, directory, message: String(error) })
  })

  createEffect(() => {
    const taskID = props.taskID()
    const directory = props.directory()
    const resolved = target()
    if (taskID && directory && resolved?.taskID === taskID && resolved.directory === directory)
      setTargetLoadError(undefined)
  })

  createEffect<BrowserPreviewEvidenceImage | undefined>((previous) => {
    const current = captureImage()
    if (previous?.url && (current?.status !== "loaded" || previous.url !== current.url))
      URL.revokeObjectURL(previous.url)
    return current?.status === "loaded" ? current : undefined
  })

  createEffect(() => {
    const resolved = currentTarget()
    const taskID = props.taskID()
    const directory = props.directory()
    if (!taskID || !directory || resolved?.status !== "ready" || !resolved.url) return
    const previewKey = `${taskID}:${directory}:${resolved.id ?? resolved.url}`
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
    const url = targetUrl() ?? ""
    if (addressDirty()) return
    setAddressDraft(url)
  })

  createEffect(() => {
    const error = currentVerificationError()
    if (error instanceof ApiError && error.status === 404) {
      setVerificationRequest(undefined)
      refetchTargetFromPanel()
    }
  })

  const saveAddressTarget = () => {
    const taskID = props.taskID()
    const directory = props.directory()
    const url = addressDraft().trim()
    if (!taskID || !directory || !url || addressSaving()) return
    setAddressSaving(true)
    setAddressError("")
    setTargetSelectionError("")
    setVerificationRequest(undefined)
    requestNativePreviewClose(false)
    void saveTaskBrowserPreviewTarget({
      taskID,
      directory,
      url,
      viewports: viewports().length > 0 ? viewports() : [...DEFAULT_BROWSER_PREVIEW_VIEWPORTS],
    })
      .then((saved) => {
        if (props.taskID() !== taskID) return
        setPendingSelectedTargetID(saved.id ?? "")
        setAddressDirty(false)
        setRefreshToken((value) => value + 1)
      })
      .catch((error) => {
        if (props.taskID() !== taskID) return
        setPendingSelectedTargetID("")
        setAddressError(browserPreviewErrorMessage(error))
      })
      .finally(() => {
        if (props.taskID() === taskID) setAddressSaving(false)
      })
  }

  const disableNativeSelection = (reportError: boolean): void => {
    if (!browserPreviewNativeSurfaceAvailable()) return
    void setNativeSelectionEnabled(false).catch((error) => {
      if (reportError) setNativePreviewError(browserPreviewErrorMessage(error))
    })
  }

  const clearNodeSelection = (reportNativeDisableError = false) => {
    setNodeSelection(undefined)
    setNodeSelectionEnabled(false)
    setNodeCommentText("")
    disableNativeSelection(reportNativeDisableError)
  }

  const submitNodeCommentDraft = () => {
    const selection = nodeSelection()
    const comment = nodeCommentText().trim()
    const url = targetUrl() ?? ""
    if (!selection || !comment) return
    const details = [
      `Browser preview comment: ${comment}`,
      "",
      `Page: ${selection.pageTitle || currentTarget()?.url || url}`,
      `URL: ${selection.pageUrl || url}`,
      `Target: ${selection.pageTitle || selection.label} <${selection.tagName || selection.label}>`,
      `Source: ${selection.sourceHint || selection.domPath || selection.selector || "DOM"}`,
      `Node: ${selection.label}`,
      `Region: x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}`,
    ]
    if (selection.textPreview) details.push(`Text: ${selection.textPreview}`)
    if (selection.computedColor) details.push(`Color: ${selection.computedColor}`)
    if (selection.computedFont) details.push(`Font: ${selection.computedFont}`)
    if (selection.jsPath) details.push(`JS path: ${selection.jsPath}`)
    props.onCommentDraft?.(details.join("\n"))
    clearNodeSelection()
  }

  let nativeSurfaceElement: HTMLElement | null = null
  let nativeSurfaceScrollElement: HTMLElement | null = null
  let nativeSurfaceResizeObserver: ResizeObserver | null = null
  let lastNativePreviewSyncKey = ""
  let nativePreviewSyncSequence = 0

  const syncNativePreviewOnFrame = createAnimationFrameScheduler(() => {
    void syncNativePreviewSurface()
  })

  function currentNativePreviewSyncKey(): string {
    const scope = nativePreviewScope()
    const element = nativeSurfaceElement
    if (!scope || !element || !browserPreviewNativeSurfaceAvailable()) return ""
    const bounds = browserPreviewNativeElementBounds(element)
    if (!bounds) return ""
    return `${browserPreviewNativeScopeKey(scope)}:${browserPreviewNativeBoundsKey(bounds)}`
  }

  const nativePreviewNavigationReady = createMemo(() => {
    nativePreviewSyncing()
    const syncKey = currentNativePreviewSyncKey()
    return Boolean(syncKey && lastNativePreviewSyncKey === syncKey && !previewActionPending())
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
      await syncBrowserPreviewNativeSurface({ scopeKey: browserPreviewNativeScopeKey(scope), url: scope.url, bounds })
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
    if (!nativePreviewNavigationReady()) return
    const syncKey = currentNativePreviewSyncKey()
    if (!syncKey) return
    setNativePreviewError("")
    void navigateBrowserPreviewNativeSurface(action).catch((error) => {
      if (lastNativePreviewSyncKey !== syncKey || currentNativePreviewSyncKey() !== syncKey) return
      setNativePreviewError(browserPreviewErrorMessage(error))
    })
  }

  function navigatePreview(action: BrowserPreviewNativeNavigationAction): void {
    if (action === "reload") {
      setTargetSelectionError("")
      setRefreshToken((value) => value + 1)
      clearNodeSelection()
    }
    if (nativePreviewScope() && browserPreviewNativeSurfaceAvailable()) {
      navigateNativePreview(action)
      return
    }
  }

  onCleanup(() => {
    syncNativePreviewOnFrame.cancel()
    disconnectNativePreviewElement()
    requestNativePreviewClose(false)
    const current = captureImage()
    if (current?.status === "loaded") URL.revokeObjectURL(current.url)
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
      setTargetLoadError(undefined)
      setVerificationRequest(undefined)
      setNativePreviewError("")
      clearNodeSelection()
      if (previous) requestNativePreviewClose(false)
    }
    return key
  })

  createEffect<string>((previous) => {
    const key = targetRequestKey()
    if (previous && previous !== key) setTargetSelectionError("")
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
    scheduleNativePreviewSync()
    return key
  })

  createEffect(() => {
    const scope = nativePreviewScope()
    if (!scope && !nodeSelection()) clearNodeSelection()
  })

  // Native child-webview element picker (matches open-mirror-app): when the
  // live native preview is active and selection mode is on, arm the in-guest
  // picker and poll the host for the resolved node. The overlay renders its
  // existing selection box + comment popover from the pulled rect. Clicks are
  // captured INSIDE the native webview, so no host overlay is required.
  createEffect(() => {
    const scope = nativePreviewScope()
    const enabled = nodeSelectionEnabled()
    if (!scope || !enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void setNativeSelectionEnabled(true).catch((error) => {
      setNativePreviewError(browserPreviewErrorMessage(error))
    })
    const poll = () => {
      void takeNativeSelection()
        .then((result) => {
          if (cancelled) return
          if (result.kind === "captured") {
            setNodeSelection(result.selection)
            setNodeSelectionEnabled(false)
            return
          }
          if (result.kind === "canceled") {
            setNodeSelectionEnabled(false)
            return
          }
          timer = setTimeout(poll, 80)
        })
        .catch((error) => {
          if (cancelled) return
          setNativePreviewError(browserPreviewErrorMessage(error))
        })
    }
    poll()
    onCleanup(() => {
      cancelled = true
      if (timer) clearTimeout(timer)
      disableNativeSelection(Boolean(scope))
    })
  })

  return (
    <section class="browser-preview-panel" aria-label={t("browser_preview.title")} data-active={String(panelActive())}>
      <div class="browser-preview-command-surface" data-ui="browser-preview-chrome">
        <div class="browser-preview-chrome-grid" data-ui="browser-preview-toolbar">
          <form
            class="browser-preview-address-form"
            data-ui="browser-preview-address-form"
            onSubmit={(event) => {
              event.preventDefault()
              saveAddressTarget()
            }}
          >
            <input
              class="browser-preview-address-input"
              data-ui="browser-preview-address-input"
              value={addressDraft()}
              placeholder="about:blank"
              aria-label={t("browser_preview.address.label")}
              disabled={!props.taskID() || addressSaving()}
              spellcheck={false}
              onInput={(event) => {
                setAddressDraft(event.currentTarget.value)
                setAddressDirty(true)
                setAddressError("")
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              title={t("browser_preview.navigation.reload_title")}
              aria-label={t("browser_preview.navigation.reload_title")}
              disabled={!readyTarget()}
              onClick={() => navigatePreview("reload")}
            >
              <Icon name="refresh" size={18} />
            </Button>
          </form>

          <div class="browser-preview-chrome-actions">
            <Button
              type="button"
              variant={nodeSelectionEnabled() ? "solid" : "ghost"}
              size="icon"
              tone="neutral"
              class="browser-preview-comment-mode-button"
              title={t("browser_preview.selection.title")}
              aria-label={t("browser_preview.selection.title")}
              aria-pressed={nodeSelectionEnabled()}
              disabled={!readyTarget()}
              onClick={() => {
                const nextEnabled = !nodeSelectionEnabled()
                setNodeSelectionEnabled(nextEnabled)
                setNodeSelection(undefined)
              }}
            >
              <Icon name="message" size={18} />
            </Button>
          </div>
        </div>
        <Show when={target.loading || targetTransitionPending()}>
          <div class="browser-preview-progress" data-ui="browser-preview-progress" />
        </Show>
      </div>

      <div class="browser-preview-stage">
        <Switch
          fallback={
            <section class="browser-preview-local-home" data-status="missing" data-ui="browser-preview-local-home">
              <div class="browser-preview-local-empty">
                <Icon name="web-search" size={86} />
                <p>{t("browser_preview.local.empty_title")}</p>
              </div>
            </section>
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
          <Match when={currentVerificationLoading()}>
            <div class="browser-preview-empty" data-status="loading" data-ui="browser-preview-capture-loading">
              <span class="card__spinner" aria-hidden="true" />
              <p>{t("browser_preview.capture_loading")}</p>
            </div>
          </Match>
          <Match when={currentLatestEvidenceLoading()}>
            <div class="browser-preview-empty" data-status="loading" data-ui="browser-preview-evidence-loading">
              <span class="card__spinner" aria-hidden="true" />
              <p>{t("browser_preview.empty.evidence_loading")}</p>
            </div>
          </Match>
          <Match when={currentLatestEvidenceError()}>
            {(error) => (
              <div class="browser-preview-empty" data-status="failed" data-ui="browser-preview-evidence-load-failed">
                <Icon name="status-failed" size={18} />
                <p>{t("browser_preview.empty.evidence_failed")}</p>
                <code>{error().evidenceID}</code>
                <code>{error().message}</code>
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
          <Match when={!nodeSelectionEnabled() && !nodeSelection() ? renderedEvidence() : undefined}>
            {(evidence) => (
              <section
                class="browser-preview-evidence"
                data-status={currentCaptureImageError() ? "failed" : evidence().status}
                data-ui="browser-preview-evidence"
              >
                <div class="browser-preview-evidence-header">
                  <Icon
                    name={
                      !currentCaptureImageError() && evidence().status === "passed"
                        ? "status-completed"
                        : "status-failed"
                    }
                    size={16}
                  />
                  <span>
                    {currentCaptureImageError()
                      ? t("browser_preview.evidence.image_failed")
                      : evidenceStatusLabel(evidence().status)}
                  </span>
                  <Show when={evidence().id}>{(id) => <code>{id()}</code>}</Show>
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
                <Show when={currentCaptureImageError()}>
                  {(error) => (
                    <code data-ui="browser-preview-capture-image-error" data-status="failed">
                      {error()}
                    </code>
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
                    data-selecting={nodeSelectionEnabled() ? "true" : undefined}
                    role="application"
                    aria-label={t("browser_preview.title")}
                  >
                    <Show when={nativePreviewSyncing()}>
                      <span class="card__spinner" aria-hidden="true" />
                    </Show>
                    <BrowserPreviewNodeSelectionLayer selection={nodeSelection()} />
                    <BrowserPreviewNodeCommentPopover
                      selection={nodeSelection()}
                      value={nodeCommentText()}
                      onInput={setNodeCommentText}
                      onCancel={clearNodeSelection}
                      onSubmit={submitNodeCommentDraft}
                    />
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
): BrowserPreviewRenderedEvidence {
  const capture = input.captures[viewportID]
  const evidenceID = input.evidenceIDs[viewportID]
  if (!evidenceID && input.status === "passed") {
    throw new Error(`Browser preview verification missing persisted evidence ID for viewport ${viewportID}`)
  }
  const summary =
    capture?.summary ??
    (input.diagnostics.length
      ? input.diagnostics.join(" ")
      : t("browser_preview.evidence.missing_persisted", { viewport: viewportLabel(viewportID) }))
  return {
    ...(evidenceID ? { id: evidenceID } : {}),
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

function browserPreviewTargetKey(target: BrowserPreviewScopedTarget): string {
  return JSON.stringify({
    id: target.id,
    url: target.url,
    viewports: target.viewports.map((viewport) => ({
      id: viewport.id,
      width: viewport.width,
      height: viewport.height,
    })),
  })
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

function BrowserPreviewNodeSelectionLayer(props: { selection?: BrowserPreviewNodeSelection }) {
  return (
    <Show when={props.selection}>
      {(selection) => (
        <div
          class="browser-preview-node-selection-box"
          data-ui="browser-preview-node-selection"
          style={{
            left: `${selection().x}px`,
            top: `${selection().y}px`,
            width: `${selection().width}px`,
            height: `${selection().height}px`,
          }}
        >
          <span class="browser-preview-node-selection-label">1</span>
        </div>
      )}
    </Show>
  )
}

function BrowserPreviewNodeCommentPopover(props: {
  selection?: BrowserPreviewNodeSelection
  value: string
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const position = createMemo(() => {
    const selection = props.selection
    if (!selection) return undefined
    return {
      left: Math.max(8, selection.x),
      top: Math.max(8, selection.y + selection.height + 8),
    }
  })
  return (
    <Show when={props.selection && position()}>
      {(pos) => (
        <form
          class="browser-preview-node-comment-popover"
          data-ui="browser-preview-node-comment"
          style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
          onSubmit={(event) => {
            event.preventDefault()
            props.onSubmit()
          }}
        >
          <div class="browser-preview-node-comment-title">#1 {props.selection?.label}</div>
          <dl class="browser-preview-node-comment-details">
            <div>
              <dt>{t("browser_preview.comment.page")}</dt>
              <dd>{props.selection?.pageTitle || props.selection?.pageUrl || "—"}</dd>
            </div>
            <div>
              <dt>{t("browser_preview.comment.target")}</dt>
              <dd>{props.selection?.accessibleName || props.selection?.label || "—"}</dd>
            </div>
            <div>
              <dt>{t("browser_preview.comment.source")}</dt>
              <dd>{props.selection?.sourceHint || props.selection?.domPath || props.selection?.selector || "DOM"}</dd>
            </div>
          </dl>
          <textarea
            class="browser-preview-node-comment-input"
            value={props.value}
            placeholder={t("browser_preview.comment.placeholder")}
            aria-label={t("browser_preview.comment.label")}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
          <div class="browser-preview-node-comment-actions">
            <Button type="button" variant="ghost" size="sm" tone="neutral" onClick={props.onCancel}>
              {t("browser_preview.comment.cancel")}
            </Button>
            <Button type="submit" variant="solid" size="sm" tone="neutral" disabled={!props.value.trim()}>
              {t("browser_preview.comment.send")}
            </Button>
          </div>
        </form>
      )}
    </Show>
  )
}
