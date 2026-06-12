import { createEffect, createSignal } from "solid-js"
import { appStore } from "../../store/app"
import { patchConfig } from "../../services/config"
import { t } from "../../utils/i18n"
import { Button } from "../ui/Button"
import { SurfaceHeader } from "../ui/SurfaceHeader"

function configuredProxy(): {
  llmProvider: boolean
  webResearch: boolean
  url: string
  username: string
  password: string
} {
  const proxy = (appStore.config as any)?.network?.proxy
  const url = typeof proxy?.url === "string" ? proxy.url : ""
  return {
    llmProvider: proxy?.llmProvider === true,
    webResearch: proxy?.webResearch === true,
    url,
    username: typeof proxy?.username === "string" ? proxy.username : "",
    password: typeof proxy?.password === "string" ? proxy.password : "",
  }
}

function validProxyUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

export default function NetworkPanel() {
  const [llmProvider, setLlmProvider] = createSignal(false)
  const [webResearch, setWebResearch] = createSignal(false)
  const [url, setUrl] = createSignal("")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    const proxy = configuredProxy()
    setLlmProvider(proxy.llmProvider)
    setWebResearch(proxy.webResearch)
    setUrl(proxy.url)
    setUsername(proxy.username)
    setPassword(proxy.password)
  })

  async function saveProxy() {
    if (saving()) return
    setError(null)
    setSaved(false)
    const proxyUrl = url().trim()
    const proxyUsername = username().trim()
    const proxyPassword = password().trim()
    const proxyEnabled = llmProvider() || webResearch()
    if (proxyEnabled && !proxyUrl) {
      setError(t("network.proxy.url_required"))
      return
    }
    if (proxyUrl && !validProxyUrl(proxyUrl)) {
      setError(t("network.proxy.url_invalid"))
      return
    }
    if (proxyPassword && !proxyUsername) {
      setError(t("network.proxy.username_required"))
      return
    }

    setSaving(true)
    try {
      const nextProxy = proxyUrl
        ? {
            url: proxyUrl,
            llmProvider: llmProvider(),
            webResearch: webResearch(),
            ...(proxyUsername ? { username: proxyUsername } : {}),
            ...(proxyPassword ? { password: proxyPassword } : {}),
          }
        : null
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
                {t("network.proxy.llm_provider_label")}
                <span class="toggle-hint">{t("network.proxy.llm_provider_hint")}</span>
              </span>
              <input
                type="checkbox"
                checked={llmProvider()}
                onChange={(e) => setLlmProvider(e.currentTarget.checked)}
              />
            </label>
            <label class="config-toggle-list-item">
              <span class="toggle-label">
                {t("network.proxy.web_research_label")}
                <span class="toggle-hint">{t("network.proxy.web_research_hint")}</span>
              </span>
              <input
                type="checkbox"
                checked={webResearch()}
                onChange={(e) => setWebResearch(e.currentTarget.checked)}
              />
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

          <label class="field">
            <span class="field-label">{t("network.proxy.username_label")}</span>
            <input
              class="field-input"
              type="text"
              value={username()}
              autocomplete="username"
              onInput={(e) => {
                setUsername(e.currentTarget.value)
                setError(null)
                setSaved(false)
              }}
            />
          </label>

          <label class="field">
            <span class="field-label">{t("network.proxy.password_label")}</span>
            <input
              class="field-input"
              type="password"
              value={password()}
              autocomplete="current-password"
              onInput={(e) => {
                setPassword(e.currentTarget.value)
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
