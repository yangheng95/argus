// ── ChannelsPanel ──
// Solid.js component for channel configuration.
// Data source: appStore.channels + appStore.config (populated by loadConfigInfo).
// Save: channel config via PATCH /config (same as pre-Solid original).
//        public URL via PATCH /config (updateConfig pattern).

import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import { t } from "../../utils/i18n"
import { appStore } from "../../store/app"
import { updateConfig } from "../../services/config"
import { getHostTransport } from "../../services/host-transport"
import { nativeOpen } from "../../utils/native"
import { Dialog } from "../primitives/Dialog"
import { useAsyncAction } from "../../solid/async-action"
import { Button } from "../ui/Button"

// ── Tutorial docs (matches pre-Solid OPENCLAW_DOCS constant) ──

const OPENCLAW_DOCS: Record<string, string> = Object.freeze({
  overview: "https://docs.openclaw.ai/channels",
  credit: "OpenClaw Docs",
  slack: "https://docs.openclaw.ai/channels/slack",
  telegram: "https://docs.openclaw.ai/channels/telegram",
  discord: "https://docs.openclaw.ai/channels/discord",
  feishu: "https://docs.openclaw.ai/channels/feishu",
  whatsapp: "https://docs.openclaw.ai/channels/whatsapp",
  googlechat: "https://docs.openclaw.ai/channels/googlechat",
  msteams: "https://docs.openclaw.ai/channels/msteams",
  line: "https://docs.openclaw.ai/channels/line",
  matrix: "https://docs.openclaw.ai/channels/matrix",
  mattermost: "https://docs.openclaw.ai/channels/mattermost",
  signal: "https://docs.openclaw.ai/channels/signal",
  wecom: "https://docs.openclaw.ai/channels",
  dingtalk: "https://docs.openclaw.ai/channels",
})

function channelTutorialUrl(channelID: string): string {
  return OPENCLAW_DOCS[channelID] || OPENCLAW_DOCS.overview
}

// ── Types ──

interface ChannelField {
  key: string
  label: string
  type: "text" | "secret" | "boolean" | string
  placeholder?: string
}

interface ChannelEntry {
  id: string
  name: string
  summary: string
  status: string
  fields: ChannelField[]
}

// ── Status helpers ──

function channelStatusLabel(status: string): string {
  const map: Record<string, string> = {
    configured: t("channel.status.configured"),
    partial: t("channel.status.partial"),
    missing: t("channel.status.missing"),
    disabled: t("channel.status.disabled"),
  }
  return map[status] || status
}

// ── Component ──

export default function ChannelsPanel() {
  const nativeCommands = getHostTransport().capabilities.nativeCommands
  const canOpenTutorialDocs = createMemo(() => nativeCommands["open-url"])
  const [editingID, setEditingID] = createSignal<string | null>(null)
  const [fieldValues, setFieldValues] = createSignal<Record<string, any>>({})
  const [notice, setNotice] = createSignal("")
  const [noticeTone, setNoticeTone] = createSignal("")

  // Reactive data from appStore (populated by loadConfigInfo after connect)
  const channels = createMemo((): ChannelEntry[] => {
    const raw = appStore.channels
    return Array.isArray(raw) ? (raw as ChannelEntry[]) : []
  })

  const publicUrl = createMemo((): string => {
    return (appStore.config as any)?.server?.publicUrl || ""
  })

  const [localPublicUrl, setLocalPublicUrl] = createSignal("")
  const saveAction = useAsyncAction(async (commit: () => Promise<void>) => {
    await commit()
  })
  // Sync local input from store when it changes
  createEffect(() => {
    const storeUrl = publicUrl()
    if (!saveAction.pending()) setLocalPublicUrl(storeUrl)
  })

  const editingEntry = createMemo(() => channels().find((c) => c.id === editingID()) ?? null)

  function configValueForChannel(channelID: string, key: string): any {
    return (appStore.config as any)?.channel?.[channelID]?.[key]
  }

  function openEdit(channelID: string) {
    const entry = channels().find((c) => c.id === channelID)
    if (!entry) return
    const initial: Record<string, any> = {}
    for (const field of entry.fields) {
      const existing = configValueForChannel(entry.id, field.key)
      if (field.type === "boolean") {
        initial[field.key] = existing !== false
      } else {
        initial[field.key] = existing != null ? String(existing) : ""
      }
    }
    setFieldValues(initial)
    setEditingID(channelID)
  }

  function closeEdit() {
    setEditingID(null)
    setFieldValues({})
  }

  async function handleSaveChannel() {
    const entry = editingEntry()
    if (!entry) return
    try {
      await saveAction.run(async () => {
        await updateConfig((config) => {
          config.channel = config.channel || {}
          const next: Record<string, any> = {}
          for (const field of entry.fields) {
            if (field.type === "boolean") {
              next[field.key] = fieldValues()[field.key] !== false
            } else {
              const value = String(fieldValues()[field.key] ?? "").trim()
              if (value) next[field.key] = value
            }
          }
          config.channel[entry.id] = next
        })
        showNotice(t("common.saved"), "active")
        closeEdit()
      })
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error")
    }
  }

  async function handleSavePublicUrl() {
    try {
      await saveAction.run(async () => {
        await updateConfig((current: any) => {
          current.server = current.server || {}
          current.server.publicUrl = localPublicUrl().trim() || undefined
          if (current.server.publicUrl === undefined) delete current.server.publicUrl
          if (Object.keys(current.server).length === 0) delete current.server
        })
        showNotice(t("common.saved"), "active")
      })
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error")
    }
  }

  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  function showNotice(msg: string, tone = "") {
    if (noticeTimer) clearTimeout(noticeTimer)
    setNotice(msg)
    setNoticeTone(tone)
    if (msg) {
      noticeTimer = setTimeout(() => setNotice(""), 2600)
    }
  }

  function handleFieldChange(key: string, value: any) {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <>
      <Show when={notice()}>
        <div class="config-status-box" data-status={noticeTone()}>
          {notice()}
        </div>
      </Show>

      {/* ── Public URL ── */}
      <div class="extension-head">
        <label class="field">
          <span class="field-label">{t("channel.public_url")}</span>
          {/* Fixed example URL; the locale-sensitive field label/hint already carries the instruction. */}
          <input
            class="field-input"
            type="url"
            pattern="https?://.+"
            placeholder="https://opencorvus.example.com"
            value={localPublicUrl()}
            onInput={(e) => setLocalPublicUrl(e.currentTarget.value)}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim()
              e.currentTarget.setCustomValidity(v && !/^https?:\/\/.+/i.test(v) ? t("channel.public_url_invalid") : "")
            }}
          />
        </label>
        <div class="dialog-actions compact">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tone="neutral"
            onClick={handleSavePublicUrl}
            disabled={saveAction.pending()}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
      <div class="empty-hint">{t("channel.public_url_hint")}</div>

      {/* ── Channel List ── */}
      <Show when={channels().length > 0} fallback={<div class="empty-hint">{t("channel.none")}</div>}>
        <For each={channels()}>
          {(item) => (
            <div class="extension-row">
              <div class="extension-row-main">
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
                <small class="channel-doc-credit">
                  {t("channel.tutorial_credit", { source: OPENCLAW_DOCS.credit })}
                </small>
              </div>
              <div class="channel-row-actions">
                <span class="extension-status" data-state={item.status}>
                  {channelStatusLabel(item.status)}
                </span>
                <Show when={canOpenTutorialDocs()}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    tone="neutral"
                    title={t("channel.tutorial_hint")}
                    aria-label={t("channel.tutorial_hint")}
                    onClick={() => nativeOpen(channelTutorialUrl(item.id))}
                  >
                    {t("channel.tutorial")}
                  </Button>
                </Show>
                <Button
                  type="button"
                  variant="solid"
                  size="sm"
                  tone="accent"
                  title={t("channel.edit_title")}
                  aria-label={t("channel.edit_title")}
                  onClick={() => openEdit(item.id)}
                >
                  {t("common.edit")}
                </Button>
              </div>
            </div>
          )}
        </For>
      </Show>

      {/* ── Channel Edit Dialog ── */}
      <Show when={editingEntry() !== null}>
        {(_) => {
          const entry = editingEntry()!
          return (
            <Dialog
              open={true}
              title={t("channel.configuration_title", { name: entry.name })}
              onClose={closeEdit}
              footer={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    tone="neutral"
                    onClick={closeEdit}
                    disabled={saveAction.pending()}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="solid"
                    size="md"
                    tone="accent"
                    onClick={handleSaveChannel}
                    disabled={saveAction.pending()}
                  >
                    {saveAction.pending() ? t("common.saving") : t("common.save")}
                  </Button>
                </>
              }
            >
              {/* Tutorial card — mirrors channelTutorialCard() from pre-Solid */}
              <div class="channel-doc-card">
                <div class="channel-doc-copy">
                  <span class="channel-doc-title">{t("channel.tutorial_hint")}</span>
                  <small class="channel-doc-credit">
                    {t("channel.tutorial_credit", { source: OPENCLAW_DOCS.credit })}
                  </small>
                </div>
                <Show when={canOpenTutorialDocs()}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    tone="neutral"
                    title={t("channel.tutorial_hint")}
                    aria-label={t("channel.tutorial_hint")}
                    onClick={() => nativeOpen(channelTutorialUrl(entry.id))}
                  >
                    {t("channel.tutorial")}
                  </Button>
                </Show>
              </div>

              <For each={entry.fields}>
                {(field) => {
                  const name = `channel_${entry.id}_${field.key}`
                  const currentVal = () => fieldValues()[field.key]

                  if (field.type === "boolean") {
                    return (
                      <label class="field field-inline">
                        <span class="field-label">{field.label}</span>
                        <input
                          type="checkbox"
                          name={name}
                          checked={currentVal() !== false}
                          onChange={(e) => handleFieldChange(field.key, e.currentTarget.checked)}
                        />
                      </label>
                    )
                  }

                  const inputType = field.type === "secret" ? "password" : "text"
                  return (
                    <label class="field">
                      <span class="field-label">{field.label}</span>
                      {/* Channel schemas own these placeholders; render the configured example verbatim. */}
                      <input
                        class="field-input"
                        type={inputType}
                        name={name}
                        value={String(currentVal() ?? "")}
                        placeholder={field.placeholder || ""}
                        onInput={(e) => handleFieldChange(field.key, e.currentTarget.value)}
                      />
                    </label>
                  )
                }}
              </For>
            </Dialog>
          )
        }}
      </Show>
    </>
  )
}
