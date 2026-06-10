import { createEffect, createSignal } from "solid-js"
import { appStore } from "../../store/app"
import { patchConfig } from "../../services/config"
import { t } from "../../utils/i18n"
import { Button } from "../ui/Button"
import { SurfaceHeader } from "../ui/SurfaceHeader"

function configuredProxy(): { enabled: boolean; url: string } {
  const proxy = (appStore.config as any)?.network?.proxy
  const url = typeof proxy?.url === "string" ? proxy.url : ""
  return {
    enabled: proxy?.enabled !== false && url.trim() !== "",
    url,
  }
}

function validProxyUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export default function NetworkPanel() {
  const [enabled, setEnabled] = createSignal(false)
  const [url, setUrl] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    const proxy = configuredProxy()
    setEnabled(proxy.enabled)
    setUrl(proxy.url)
  })

  async function saveProxy() {
    if (saving()) return
    setError(null)
    setSaved(false)
    const proxyUrl = url().trim()
    if (enabled() && !proxyUrl) {
      setError(t("network.proxy.url_required"))
      return
    }
    if (proxyUrl && !validProxyUrl(proxyUrl)) {
      setError(t("network.proxy.url_invalid"))
      return
    }

    setSaving(true)
    try {
      const nextProxy = proxyUrl ? { enabled: enabled(), url: proxyUrl } : null
      const savedConfig = await patchConfig({ network: { proxy: nextProxy } })
      if (!savedConfig) {
        setError(t("network.proxy.save_failed"))
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="general-panel network-panel">
      <div class="config-panel-group">
        <SurfaceHeader variant="settings-group" title={t("network.proxy.title")} />
        <div class="config-panel-card">
          <div class="config-toggle-list">
            <label class="config-toggle-list-item">
              <span class="toggle-label">
                {t("network.proxy.enabled_label")}
                <span class="toggle-hint">{t("network.proxy.enabled_hint")}</span>
              </span>
              <input type="checkbox" checked={enabled()} onChange={(e) => setEnabled(e.currentTarget.checked)} />
            </label>
          </div>

          <label class="field">
            <span class="field-label">{t("network.proxy.url_label")}</span>
            <input
              class="field-input"
              type="url"
              value={url()}
              placeholder="http://127.0.0.1:7890"
              onInput={(e) => {
                setUrl(e.currentTarget.value)
                setError(null)
                setSaved(false)
              }}
            />
          </label>

          {error() ? (
            <div class="provider-form-error" role="alert" aria-live="polite">
              {error()}
            </div>
          ) : null}

          <div class="dialog-actions compact">
            <Button type="button" variant="solid" size="sm" tone="accent" onClick={() => void saveProxy()}>
              {saving() ? t("common.saving") : saved() ? t("common.saved") : t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
