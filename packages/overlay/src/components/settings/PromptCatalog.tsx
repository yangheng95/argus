// ── PromptCatalog ──
// Solid.js component that mirrors renderPromptCatalog, renderPromptPreview,
// and all supporting helpers from app.js:
//   promptEntryID, promptEntry, promptEntryValue, syncPromptDrafts,
//   promptGroupLabel, promptDescription, promptStatus, promptHelper,
//   promptDirty, savePromptEntry, resetPromptEntry.
//
// Data is fetched from `config/prompt` on mount.

import {
  createSignal,
  createMemo,
  For,
  Show,
  onMount,
} from "solid-js";
import { createStore } from "solid-js/store";
import { t } from "../../utils/i18n";
import { renderMarkdown } from "../../utils/markdown";
import { apiJson } from "../../services/api";

// ── Types ──

interface PromptEntry {
  key: string;
  label?: string;
  group: string;
  mode?: string;
  scope: string;
  description?: string;
  inherits_core?: boolean;
  prompt?: string;
  configured_prompt: string | null;
  default_prompt?: string;
}

interface PromptStatus {
  label: string;
  tone: string;
}

// ── Helpers ──

function promptEntryID(entry: PromptEntry): string {
  return `${entry.scope}:${entry.key}`;
}

function promptGroupLabel(group: string): string {
  if (group === "core") return t("prompt.group.core");
  if (group === "generator") return t("prompt.group.generator");
  if (group === "orchestrator") return t("prompt.group.orchestrator");
  if (group === "subagent") return t("prompt.group.subagent");
  if (group === "hidden_agent") return t("prompt.group.hidden_agent");
  if (group === "custom_agent") return t("prompt.group.custom_agent");
  return t("prompt.group.primary_agent");
}

function promptDescription(entry: PromptEntry): string {
  if (entry.key === "core_header") return t("prompt.desc.core_header");
  if (entry.key === "agent_generate") return t("prompt.desc.agent_generate");
  if (entry.key === "planner_system") return t("prompt.desc.planner_system");
  if (entry.key === "spec_system") return t("prompt.desc.spec_system");
  if (entry.key === "evaluator_system") return t("prompt.desc.evaluator_system");
  if (entry.key === "delivery_system") return t("prompt.desc.delivery_system");
  return entry.description || "";
}

function promptStatus(entry: PromptEntry): PromptStatus {
  if (entry.configured_prompt !== null) {
    return { label: t("prompt.status.custom"), tone: "active" };
  }
  if (entry.scope === "system") {
    return { label: t("prompt.status.default"), tone: "ready" };
  }
  if (entry.inherits_core) {
    return { label: t("prompt.status.inherits_core"), tone: "warn" };
  }
  if (entry.prompt) {
    return { label: t("prompt.status.default"), tone: "ready" };
  }
  return { label: t("prompt.status.empty"), tone: "" };
}

function promptHelper(entry: PromptEntry): string {
  if (entry.scope === "system") {
    return entry.configured_prompt !== null
      ? t("prompt.help.custom_system")
      : t("prompt.help.default_system");
  }
  if (entry.inherits_core) return t("prompt.help.inherits_core");
  if (entry.configured_prompt !== null) return t("prompt.help.custom_agent");
  if (entry.prompt) return t("prompt.help.default_agent");
  return t("prompt.help.optional_agent");
}

function promptPreviewHtml(value: string): string {
  if (!value.trim()) {
    return `<p class="empty-hint">${t("prompt.preview_empty")}</p>`;
  }
  return renderMarkdown(value);
}

// ── Component ──

export default function PromptCatalog() {
  const [entries, setEntries] = createSignal<PromptEntry[]>([]);
  const [drafts, setDrafts] = createStore<Record<string, string>>({});
  const [loading, setLoading] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [noticeTone, setNoticeTone] = createSignal("");

  const taskActive = createMemo(() => false); // parent may pass board task status; defaulting to false here

  function draftValue(entry: PromptEntry): string {
    const id = promptEntryID(entry);
    return Object.prototype.hasOwnProperty.call(drafts, id)
      ? (drafts as Record<string, string>)[id]
      : entry.prompt || "";
  }

  function isDirty(entry: PromptEntry): boolean {
    return draftValue(entry) !== (entry.prompt || "");
  }

  function syncDrafts(items: PromptEntry[]) {
    const next: Record<string, string> = {};
    for (const entry of items) {
      const id = promptEntryID(entry);
      next[id] = Object.prototype.hasOwnProperty.call(drafts, id)
        ? (drafts as Record<string, string>)[id]
        : entry.prompt || "";
    }
    // Batch update using setStore with a replace-all approach
    for (const [k, v] of Object.entries(next)) {
      setDrafts(k, v);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const data = await apiJson("config/prompt");
      const items: PromptEntry[] = Array.isArray(data) ? data : [];
      setEntries(items);
      syncDrafts(items);
    } catch (e) {
      console.error("PromptCatalog: load failed", e);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  onMount(load);

  function handleDraftChange(entryID: string, value: string) {
    setDrafts(entryID, value);
  }

  async function handleSave(entry: PromptEntry) {
    const entryID = promptEntryID(entry);
    const value = draftValue(entry);
    try {
      // POST the updated value to the config/prompt endpoint
      await apiJson("config/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: entry.scope,
          key: entry.key,
          value: value.trim() || null,
        }),
      });
      showNotice(t("common.saved"), "active");
      await load();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function handleReset(entry: PromptEntry) {
    const entryID = promptEntryID(entry);
    setDrafts(entryID, entry.prompt || "");
    if (entry.configured_prompt === null) return;
    try {
      await apiJson("config/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: entry.scope,
          key: entry.key,
          value: null,
        }),
      });
      showNotice(t("prompt.reset_done"), "active");
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

  const configuredCount = createMemo(
    () => entries().filter((e) => e.configured_prompt !== null).length,
  );

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

      <Show when={taskActive()}>
        <div
          class="config-status-box"
          data-status="warn"
          style="margin-bottom:var(--sp-2)"
        >
          {t("prompt.active_task_notice")}
        </div>
      </Show>

      <Show
        when={entries().length > 0}
        fallback={
          <div class="empty-hint">{t("prompt.none")}</div>
        }
      >
        <div class="prompt-grid">
          <For each={entries()}>
            {(entry) => {
              const entryID = promptEntryID(entry);
              const status = createMemo(() => promptStatus(entry));
              const description = promptDescription(entry);
              const dirty = createMemo(() => isDirty(entry));
              const currentDraft = createMemo(() => draftValue(entry));

              return (
                <div class="prompt-card" data-prompt-entry={entryID}>
                  <div class="prompt-card-head">
                    <div class="prompt-card-copy">
                      <strong>{entry.label || entry.key}</strong>
                      <span>
                        {promptGroupLabel(entry.group)}
                        {entry.mode ? ` · ${entry.mode}` : ""}
                        {entry.inherits_core ? " · ← core_header" : ""}
                      </span>
                      <Show when={description}>
                        <small>{description}</small>
                      </Show>
                    </div>
                    <span
                      class="extension-status"
                      data-state={status().tone}
                    >
                      {status().label}
                    </span>
                  </div>

                  <label class="field">
                    <span class="field-label">{t("prompt.editor_label")}</span>
                    <textarea
                      class="field-input prompt-textarea"
                      rows={8}
                      value={currentDraft()}
                      onInput={(e) =>
                        handleDraftChange(entryID, e.currentTarget.value)
                      }
                    />
                  </label>

                  <div class="prompt-toolbar">
                    <span
                      class="config-status-box"
                      data-status={status().tone}
                    >
                      {promptHelper(entry)}
                    </span>
                    <div class="dialog-actions compact">
                      <button
                        type="button"
                        class="btn btn-ghost mini"
                        disabled={entry.configured_prompt === null && !dirty()}
                        onClick={() => handleReset(entry)}
                      >
                        {t("prompt.reset")}
                      </button>
                      <button
                        type="button"
                        class="btn btn-primary mini"
                        disabled={!dirty()}
                        onClick={() => handleSave(entry)}
                      >
                        {t("common.save")}
                      </button>
                    </div>
                  </div>

                  <Show
                    when={
                      entry.configured_prompt !== null && entry.default_prompt
                    }
                  >
                    <details class="prompt-diff-details">
                      <summary class="prompt-diff-summary">
                        {t("prompt.show_default")}
                      </summary>
                      <div
                        class="prompt-preview-card"
                        style="margin-top:0;border-top:none;opacity:0.7"
                      >
                        <div class="prompt-preview-head">
                          {t("prompt.default_label")}
                        </div>
                        <div
                          class="md-content prompt-preview-body"
                          innerHTML={promptPreviewHtml(entry.default_prompt!)}
                        />
                      </div>
                    </details>
                  </Show>

                  <details class="prompt-diff-details">
                    <summary class="prompt-diff-summary">
                      {t("prompt.preview")}
                    </summary>
                    <div
                      class="prompt-preview-card"
                      style="border-top:none;border-radius:0 0 var(--radius) var(--radius)"
                    >
                      <div
                        class="md-content prompt-preview-body"
                        innerHTML={promptPreviewHtml(currentDraft())}
                      />
                    </div>
                  </details>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </>
  );
}
