import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import {
  captureTaskBrowserPreviewEvidence,
  loadTaskBrowserPreviewTarget,
  loadTaskBrowserPreviewEvidence,
  saveTaskBrowserPreviewTarget,
  type BrowserPreviewEvidence,
  type BrowserPreviewTarget,
  type BrowserPreviewViewportID,
} from "../services/browser-preview"
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
  const [draftUrl, setDraftUrl] = createSignal("")
  const [viewportID, setViewportID] = createSignal<BrowserPreviewViewportID>("desktop")
  const [viewportScopeKey, setViewportScopeKey] = createSignal("")
  const [refreshToken, setRefreshToken] = createSignal(0)
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
  const frameUrl = createMemo(() => currentTarget()?.url)
  const renderedEvidence = createMemo<BrowserPreviewEvidence | undefined>(() => {
    const verified = verification()
    if (verified) return evidenceFromVerification(verified)
    return latestEvidence()
  })

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

  const captureEvidence = () => {
    const taskID = props.taskID()
    const resolved = currentTarget()
    if (!taskID || !resolved?.url || !resolved.id) return
    setVerificationRequest({ taskID, targetID: resolved.id, viewportID: viewportID(), token: Date.now() })
  }

  return (
    <section class="browser-preview-panel" aria-label={t("browser_preview.title")} data-active={String(panelActive())}>
      <div class="browser-preview-command-surface">
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
            disabled={!props.taskID()}
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            <Icon name="refresh" size={13} />
          </Button>
        </form>

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
                      onClick={() => setViewportID(item.id)}
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
          <Match when={frameUrl()}>
            <div class="browser-preview-empty" data-status="ready" data-ui="browser-preview-evidence-missing">
              <Icon name="inspect" size={18} />
              <p>{t("browser_preview.capture_title")}</p>
              <code>{frameUrl()}</code>
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

function evidenceFromVerification(input: ReturnType<typeof captureTaskBrowserPreviewEvidence> extends Promise<infer T>
  ? T
  : never): BrowserPreviewEvidence {
  return {
    id: input.target.latestEvidenceID ?? `${input.target.id ?? "target"}:${input.viewport.id}`,
    taskID: input.target.taskID ?? "",
    targetID: input.target.id ?? "",
    viewportID: input.viewport.id,
    status: input.status,
    summary: input.capture?.summary ?? input.diagnostics.join(" "),
    capture: input.capture,
    diagnostics: input.diagnostics,
    timeCompleted: Date.now(),
    timeCreated: Date.now(),
  }
}
