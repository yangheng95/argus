// ── ChannelsPanel ──
// Solid.js component that mirrors renderChannels, renderChannelFields,
// renderChannelPublicUrl, configValueForChannel, channelTutorial,
// channelTutorialCredit, channelTutorialButton, channelTutorialCard,
// and channelStatusLabel from app.js.
//
// Displays the list of available channels and lets the user configure each one
// through an inline edit dialog.

import {
  createSignal,
  createMemo,
  For,
  Show,
  onMount,
} from "solid-js";
import { t } from "../../utils/i18n";
import { apiJson } from "../../services/api";

// ── Types ──

interface ChannelField {
  key: string;
  label: string;
  type: "text" | "secret" | "boolean" | string;
  placeholder?: string;
}

interface ChannelEntry {
  id: string;
  name: string;
  summary: string;
  status: string;
  fields: ChannelField[];
}

interface ChannelConfig {
  [channelID: string]: Record<string, any>;
}

interface Config {
  channel?: ChannelConfig;
  server?: { publicUrl?: string };
}

// ── Channel documentation URLs ──
// Ported from the legacy OPENCLAW_DOCS app.js global.

const CHANNEL_DOCS: Record<string, string> = {
  slack: "https://github.com/yangheng95/argus/wiki/channels#slack",
  telegram: "https://github.com/yangheng95/argus/wiki/channels#telegram",
  discord: "https://github.com/yangheng95/argus/wiki/channels#discord",
  "google-chat": "https://github.com/yangheng95/argus/wiki/channels#google-chat",
  "microsoft-teams": "https://github.com/yangheng95/argus/wiki/channels#microsoft-teams",
  line: "https://github.com/yangheng95/argus/wiki/channels#line",
  dingtalk: "https://github.com/yangheng95/argus/wiki/channels#dingtalk",
  lark: "https://github.com/yangheng95/argus/wiki/channels#lark",
  overview: "https://github.com/yangheng95/argus/wiki/channels",
};

function getDocsUrl(channelID: string): string {
  return CHANNEL_DOCS[channelID] || CHANNEL_DOCS.overview || "";
}

function docsCredit(): string {
  return t("channel.tutorial_credit", { source: "GitHub Wiki" });
}

// ── Status helpers ──

function channelStatusLabel(status: string): string {
  const map: Record<string, string> = {
    connected: t("channel.status.connected"),
    configured: t("channel.status.configured"),
    disabled: t("channel.status.disabled"),
    error: t("channel.status.error"),
  };
  return map[status] || status;
}

// ── Component ──

export default function ChannelsPanel() {
  const [channels, setChannels] = createSignal<ChannelEntry[]>([]);
  const [config, setConfig] = createSignal<Config>({});
  const [publicUrl, setPublicUrl] = createSignal("");
  const [editingID, setEditingID] = createSignal<string | null>(null);
  const [fieldValues, setFieldValues] = createSignal<Record<string, any>>({});
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [noticeTone, setNoticeTone] = createSignal("");

  const editingEntry = createMemo(
    () => channels().find((c) => c.id === editingID()) ?? null,
  );

  function configValueForChannel(channelID: string, key: string): any {
    return config()?.channel?.[channelID]?.[key];
  }

  async function load() {
    setLoading(true);
    try {
      const [channelData, configData] = await Promise.all([
        apiJson("channel").catch(() => []),
        apiJson("config").catch(() => ({})),
      ]);
      setChannels(Array.isArray(channelData) ? channelData : []);
      const cfg = configData && typeof configData === "object" ? configData : {};
      setConfig(cfg);
      setPublicUrl(cfg?.server?.publicUrl || "");
    } finally {
      setLoading(false);
    }
  }

  onMount(load);

  function openEdit(channelID: string) {
    const entry = channels().find((c) => c.id === channelID);
    if (!entry) return;
    // Pre-fill field values from current config
    const initial: Record<string, any> = {};
    for (const field of entry.fields) {
      const existing = configValueForChannel(entry.id, field.key);
      if (field.type === "boolean") {
        initial[field.key] = existing !== false; // default true
      } else {
        initial[field.key] = existing != null ? String(existing) : "";
      }
    }
    setFieldValues(initial);
    setEditingID(channelID);
  }

  function closeEdit() {
    setEditingID(null);
    setFieldValues({});
  }

  async function handleSaveChannel() {
    const entry = editingEntry();
    if (!entry) return;
    setSaving(true);
    try {
      // Build channel config patch
      const patch: Record<string, any> = {};
      for (const field of entry.fields) {
        patch[field.key] = fieldValues()[field.key];
      }
      await apiJson(`channel/${entry.id}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      showNotice(t("common.saved"), "active");
      closeEdit();
      await load();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePublicUrl() {
    try {
      await apiJson("config/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl: publicUrl() }),
      });
      showNotice(t("common.saved"), "active");
      await load();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    }
  }

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function showNotice(msg: string, tone = "") {
    if (noticeTimer) clearTimeout(noticeTimer);
    setNotice(msg);
    setNoticeTone(tone);
    if (msg) {
      noticeTimer = setTimeout(() => setNotice(""), 2600);
    }
  }

  function handleFieldChange(key: string, value: any) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleOpenDocs(url: string) {
    if (!url) return;
    try {
      apiJson("open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => window.open(url, "_blank", "noopener"));
    } catch {
      window.open(url, "_blank", "noopener");
    }
  }

  return (
    <>
      <Show when={loading()}>
        <div class="loading-hint">{t("common.loading")}</div>
      </Show>

      <Show when={notice()}>
        <div class="config-status-box" data-status={noticeTone()}>
          {notice()}
        </div>
      </Show>

      {/* ── Public URL ── */}
      <section class="config-section">
        <label class="field">
          <span class="field-label">{t("channel.public_url_label")}</span>
          <div class="field-row">
            <input
              class="field-input"
              type="text"
              id="channelPublicUrl"
              value={publicUrl()}
              placeholder={t("channel.public_url_placeholder")}
              onInput={(e) => setPublicUrl(e.currentTarget.value)}
            />
            <button
              type="button"
              class="btn btn-primary mini"
              onClick={handleSavePublicUrl}
            >
              {t("common.save")}
            </button>
          </div>
        </label>
      </section>

      {/* ── Channel List ── */}
      <section class="config-section">
        <div class="channel-list" id="channelList">
          <Show
            when={channels().length > 0}
            fallback={<div class="empty-hint">{t("channel.none")}</div>}
          >
            <For each={channels()}>
              {(item) => (
                <div class="extension-row">
                  <div class="extension-row-main">
                    <strong>{item.name}</strong>
                    <span>{item.summary}</span>
                    <small class="channel-doc-credit">{docsCredit()}</small>
                  </div>
                  <div class="channel-row-actions">
                    <span
                      class="extension-status"
                      data-state={item.status}
                    >
                      {channelStatusLabel(item.status)}
                    </span>
                    <button
                      type="button"
                      class="btn btn-ghost mini"
                      title={t("channel.tutorial_hint")}
                      aria-label={t("channel.tutorial_hint")}
                      onClick={() => handleOpenDocs(getDocsUrl(item.id))}
                    >
                      {t("channel.tutorial")}
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary mini"
                      title={t("channel.edit_title")}
                      aria-label={t("channel.edit_title")}
                      onClick={() => openEdit(item.id)}
                    >
                      {t("common.edit")}
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>

      {/* ── Channel Edit Dialog ── */}
      <Show when={editingEntry() !== null}>
        {(_) => {
          const entry = editingEntry()!;
          return (
            <div class="dialog-overlay" role="dialog" aria-modal="true">
              <div class="dialog-panel channel-dialog-panel">
                <div class="dialog-head">
                  <h2 class="dialog-title">
                    {t("channel.configuration_title", { name: entry.name })}
                  </h2>
                  <button
                    type="button"
                    class="btn btn-ghost mini"
                    onClick={closeEdit}
                    aria-label={t("common.close")}
                  >
                    ✕
                  </button>
                </div>

                {/* Tutorial card */}
                <div class="channel-doc-card">
                  <div class="channel-doc-copy">
                    <span class="channel-doc-title">
                      {t("channel.tutorial_hint")}
                    </span>
                    <small class="channel-doc-credit">{docsCredit()}</small>
                  </div>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    title={t("channel.tutorial_hint")}
                    aria-label={t("channel.tutorial_hint")}
                    onClick={() => handleOpenDocs(getDocsUrl(entry.id))}
                  >
                    {t("channel.tutorial")}
                  </button>
                </div>

                {/* Fields */}
                <input type="hidden" value={entry.id} />
                <div class="channel-fields" id="channelFields">
                  <For each={entry.fields}>
                    {(field) => {
                      const name = `channel_${entry.id}_${field.key}`;
                      const currentVal = () => fieldValues()[field.key];

                      if (field.type === "boolean") {
                        return (
                          <label class="field field-inline">
                            <span class="field-label">{field.label}</span>
                            <input
                              type="checkbox"
                              name={name}
                              checked={currentVal() !== false}
                              onChange={(e) =>
                                handleFieldChange(
                                  field.key,
                                  e.currentTarget.checked,
                                )
                              }
                            />
                          </label>
                        );
                      }

                      const inputType =
                        field.type === "secret" ? "password" : "text";
                      return (
                        <label class="field">
                          <span class="field-label">{field.label}</span>
                          <input
                            class="field-input"
                            type={inputType}
                            name={name}
                            value={String(currentVal() ?? "")}
                            placeholder={field.placeholder || ""}
                            onInput={(e) =>
                              handleFieldChange(
                                field.key,
                                e.currentTarget.value,
                              )
                            }
                          />
                        </label>
                      );
                    }}
                  </For>
                </div>

                <div class="dialog-actions">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    onClick={closeEdit}
                    disabled={saving()}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    onClick={handleSaveChannel}
                    disabled={saving()}
                  >
                    {saving() ? t("common.saving") : t("common.save")}
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </>
  );
}
