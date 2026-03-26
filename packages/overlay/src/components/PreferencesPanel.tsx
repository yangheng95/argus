// ── PreferencesPanel Component ──
// Knowledge/preferences panel that lists key-value preference entries, supports
// add/edit via a dialog, and allows deletion. Ports renderPreferences
// ( 10638–10666), preferenceScopeLabel (10668–10673), openPrefEdit
// (10675–10691), savePrefEdit (10693–10709), deletePreference (10711–10719),
// and loadPreferences (10623–10636).

import {
  createSignal,
  createMemo,
  For,
  Show,
} from "solid-js";
import { t } from "../utils/i18n";
import { apiJson } from "../services/api";
import { appStore } from "../store/app";
import { loadPreferences as svcLoadPreferences, deletePreference as svcDeletePreference } from "../services/memory";

// ── Types ──

export interface Preference {
  id: string;
  key: string;
  value: string;
  scope: string;
  source: string;
}

// ── Helpers ──

function preferenceScopeLabel(pref: Pick<Preference, "scope" | "source">): string {
  if (pref?.scope === "cwd") return t("preference.scope.cwd");
  if (pref?.scope === "session") return t("preference.scope.session");
  if (pref?.scope === "global") return t("preference.scope.global");
  return pref?.scope || "";
}

// ── PrefEditDialog ──

interface PrefEditDialogProps {
  /** Pass an existing Preference to edit; pass null to add a new one. */
  pref: Preference | null;
  onClose: () => void;
  onSaved: () => void;
}

function PrefEditDialog(props: PrefEditDialogProps) {
  let dialogRef: HTMLDialogElement | undefined;

  const [key, setKey] = createSignal(props.pref?.key ?? "");
  const [value, setValue] = createSignal(props.pref?.value ?? "");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  const isEdit = () => !!props.pref;
  const title = () => (isEdit() ? t("preference.edit") : t("preference.add"));

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const k = key().trim();
    const v = value().trim();
    if (!k || !v) return;
    setSaving(true);
    setError("");
    try {
      const prefId = props.pref?.id ?? "";
      await apiJson(
        prefId
          ? `panel/knowledge/preference/${encodeURIComponent(prefId)}`
          : "panel/knowledge/preference",
        {
          method: prefId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k, value: v }),
        },
      );
      dialogRef?.close();
      props.onSaved();
    } catch (e: any) {
      setError(e?.message || t("preference.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      class="dialog"
      ref={(el) => {
        dialogRef = el;
        if (el) queueMicrotask(() => el.showModal());
      }}
      onClose={props.onClose}
    >
      <form class="dialog-form" onSubmit={(e) => void handleSubmit(e)}>
        <div class="dialog-head">
          <span class="dialog-title">
            {title()}
          </span>
        </div>

        <label class="field">
          <span class="field-label">{t("preference.key")}</span>
          <input
            type="text"
            class="field-input"
            required
            value={key()}
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          />
        </label>

        <label class="field">
          <span class="field-label">{t("preference.value")}</span>
          <textarea
            class="field-input"
            required
            rows={4}
            value={value()}
            onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
          />
        </label>

        <Show when={!!error()}>
          <div class="config-status-box" data-status="error">{error()}</div>
        </Show>

        <div class="dialog-actions">
          <button
            type="button"
            class="btn btn-ghost"
            onClick={() => {
              dialogRef?.close();
              props.onClose();
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            disabled={saving()}
          >
            {saving() ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ── PreferencesPanel ──

export interface PreferencesPanelProps {
  /** Pass through to influence which preferences are shown, if applicable. */
  taskID?: string;
}

export function PreferencesPanel(_props: PreferencesPanelProps) {
  const [loading, setLoading] = createSignal(false);
  const [editPref, setEditPref] = createSignal<Preference | null | "new">(
    undefined as any,
  );
  const [dialogOpen, setDialogOpen] = createSignal(false);

  // Reactive data from appStore (populated by loadPreferences after connect)
  const prefs = createMemo((): Preference[] => {
    const raw = appStore.preferences;
    return Array.isArray(raw) ? raw as Preference[] : [];
  });

  const reloadPreferences = async () => {
    setLoading(true);
    try {
      await svcLoadPreferences();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (prefId: string) => {
    if (!prefId) return;
    try {
      await svcDeletePreference(prefId);
    } catch {
      // ignore
    }
  };

  const openAdd = () => {
    setEditPref(null);
    setDialogOpen(true);
  };

  const openEdit = (pref: Preference) => {
    setEditPref(pref);
    setDialogOpen(true);
  };

  const handleSaved = () => {
    setDialogOpen(false);
    void reloadPreferences();
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
  };

  const badge = createMemo(() => {
    const n = prefs().length;
    return n > 0 ? String(n) : "";
  });

  return (
    <>
      {/* Toolbar */}
      <div class="knowledge-toolbar">
        <button
          type="button"
          class="btn btn-ghost mini"
          onClick={() => void reloadPreferences()}
          disabled={loading()}
        >
          {t("common.refresh")}
        </button>
        <button
          type="button"
          class="btn btn-ghost mini"
          onClick={openAdd}
        >
          {t("preference.add")}
        </button>
      </div>

      {/* List */}
      <div id="preferenceList" class="knowledge-list">
        <Show
          when={prefs().length > 0}
          fallback={<div class="empty-hint">{t("preference.none")}</div>}
        >
          <For each={prefs()}>
            {(p) => (
              <div
                class="pref-item"
                data-pref-id={p.id}
                onClick={() => openEdit(p)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openEdit(p);
                }}
              >
                <div class="pref-item-head">
                  <span class="pref-item-key">{p.key}</span>
                  <span
                    class="knowledge-scope"
                    data-scope={p.scope}
                    data-source={p.source}
                  >
                    {preferenceScopeLabel(p)}
                  </span>
                  <div class="pref-item-actions">
                    <button
                      type="button"
                      class="btn btn-ghost mini danger"
                      data-pref-action="delete"
                      data-pref-id={p.id}
                      title={t("preference.delete_button_title")}
                      aria-label={t("preference.delete_button_title")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(p.id);
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
                <div class="pref-item-value">{p.value}</div>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Edit / Add dialog */}
      <Show when={dialogOpen()}>
        <PrefEditDialog
          pref={editPref() === null ? null : (editPref() as Preference | null)}
          onClose={handleDialogClose}
          onSaved={handleSaved}
        />
      </Show>
    </>
  );
}
