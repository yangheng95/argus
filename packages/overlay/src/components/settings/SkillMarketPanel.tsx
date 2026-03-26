// ── SkillMarketPanel ──
// Solid.js component for managing skills, MCP servers, and marketplace.
// Displays:
// • Installed custom skills with add/remove/open actions
// • Installed MCP servers with add/remove actions
// • Skill market catalog with install / open-site actions
// All CRUD operations are self-contained — no dependency on static HTML dialogs.

import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { t } from "../../utils/i18n";
import { apiJson } from "../../services/api";
import { appStore } from "../../store/app";
import { updateConfig } from "../../services/config";
import { nativeOpen } from "../../utils/native";
import {
  loadExtensions,
  loadSkillMarket,
} from "../../services/extensions";

// ── Types ──

interface SkillItem {
  name: string;
  description?: string;
  location?: string;
  source?: string;
  source_type?: string;
  builtin?: boolean;
}

interface McpItem {
  status?: string;
  error?: string;
}

interface MarketItem {
  id: string;
  name: string;
  provider: string;
  trust: string;
  install_kind: string;
  description?: string;
  notes?: string;
  homepage?: string;
  source?: string;
  recommended_policy?: string;
}

// ── Helpers ──

function skillRemoveKind(item: SkillItem): string {
  if (item.source_type === "managed_git") return "git";
  if (item.source_type === "config_url") return "url";
  if (item.source_type === "config_path") return "path";
  return "";
}

function skillRemovable(item: SkillItem): boolean {
  return !item.builtin && !!item.source && !!skillRemoveKind(item);
}

function mcpStatusLabel(status: string): string {
  const map: Record<string, string> = {
    connected: t("mcp.status.connected"),
    disabled: t("mcp.status.disabled"),
    error: t("mcp.status.error"),
    connecting: t("mcp.status.connecting"),
  };
  return map[status] || status;
}

function policyLabel(policy: string): string {
  if (policy === "ask") return t("skill.policy.ask");
  if (policy === "allow") return t("skill.policy.allow");
  if (policy === "deny") return t("skill.policy.deny");
  return policy;
}

// ── SkillMarketPanel ──

export default function SkillMarketPanel() {
  const [notice, setNotice] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  // Reactive data from appStore (populated by loadExtensions/loadSkillMarket after connect)
  const skills = createMemo((): SkillItem[] => {
    const raw = appStore.skills;
    return Array.isArray(raw) ? raw as SkillItem[] : [];
  });
  const mcp = createMemo((): Record<string, McpItem> => {
    const raw = appStore.mcp;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, McpItem> : {};
  });
  const market = createMemo((): MarketItem[] => {
    const raw = appStore.skillMarket;
    return Array.isArray(raw) ? raw as MarketItem[] : [];
  });

  const customSkills = createMemo(() => skills().filter((item) => !item.builtin));
  const removableSkills = createMemo(() => customSkills().filter(skillRemovable));
  const builtinCount = createMemo(() => skills().length - customSkills().length);
  const mcpEntries = createMemo(() => Object.entries(mcp()));

  async function reloadAll() {
    setLoading(true);
    try {
      await Promise.all([loadExtensions(), loadSkillMarket()]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveSkill(source: string, kind: string, name: string) {
    if (!confirm(t("skill.delete_confirm", { name }))) return;
    try {
      await apiJson("skill/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, kind }),
      });
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpenSkill(location: string) {
    try {
      await nativeOpen(location);
    } catch {
 // ignore
    }
  }

  async function handleDeleteAllSkills() {
    const list = removableSkills();
    if (list.length === 0) return;
    const message = list.length === customSkills().length
      ? t("skill.delete_all_confirm_all", { count: list.length })
      : t("skill.delete_all_confirm_partial", { removable: list.length, blocked: customSkills().length - list.length });
    if (!confirm(message)) return;
    try {
      for (const item of list) {
        await apiJson("skill/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: item.source, kind: skillRemoveKind(item) }),
        });
      }
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteAllMcp() {
    const names = mcpEntries().map(([name]) => name);
    if (names.length === 0) return;
    if (!confirm(t("mcp.delete_all_confirm", { count: names.length }))) return;
    try {
      await Promise.all(names.map((name) =>
        apiJson(`mcp/${encodeURIComponent(name)}/disconnect`, { method: "POST" }).catch(() => void 0),
      ));
      await Promise.all(names.map((name) =>
        apiJson(`mcp/${encodeURIComponent(name)}/auth`, { method: "DELETE" }).catch(() => void 0),
      ));
      await updateConfig((current: any) => {
        delete current.mcp;
      });
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleInstall(item: MarketItem) {
    if (!item.source || item.install_kind === "manual") return;
    try {
      await apiJson("skill/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: item.install_kind,
          value: item.source,
          policy: item.recommended_policy || undefined,
        }),
      });
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpenHomepage(url: string | undefined) {
    if (!url) return;
    await nativeOpen(url);
  }

 // ── Add Skill inline form ──

  const [showAddSkill, setShowAddSkill] = createSignal(false);
  const [skillForm, setSkillForm] = createStore({
    type: "path" as "path" | "url" | "git",
    value: "",
    policy: "ask" as "ask" | "allow" | "deny",
  });

  async function handleAddSkill() {
    const value = skillForm.value.trim();
    if (!value) return;
    try {
      await apiJson("skill/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: skillForm.type,
          value,
          policy: skillForm.policy,
        }),
      });
      setSkillForm({ type: "path", value: "", policy: "ask" });
      setShowAddSkill(false);
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleBrowseFolder() {
    try {
      const tauri = (window as any).__TAURI__;
      if (!tauri) return;
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setSkillForm("value", selected);
      }
    } catch {
 // Tauri dialog not available in browser mode
    }
  }

  async function handleReloadSkills() {
    await reloadAll();
  }

  // Ensure market data is loaded once skills are available
  createEffect(() => {
    if (market().length === 0 && skills().length > 0) {
      loadSkillMarket().catch(() => {});
    }
  });

  async function handleOpenSkillDir() {
    try {
      const dirs = await apiJson("skill/directories");
      const target = (dirs as any)?.global_config || (dirs as any)?.managed_skills;
      if (!target) return;
      await nativeOpen(target);
    } catch {
 // ignore
    }
  }

 // ── Add MCP inline form ──

  const [showAddMcp, setShowAddMcp] = createSignal(false);
  const [mcpForm, setMcpForm] = createStore({
    name: "",
    type: "remote" as "remote" | "local",
    url: "",
    command: "",
    args: "",
  });

  async function handleAddMcp() {
    const name = mcpForm.name.trim();
    if (!name) return;
    const payload: Record<string, any> = { name, type: mcpForm.type };
    if (mcpForm.type === "remote") {
      payload.url = mcpForm.url.trim();
      if (!payload.url) return;
    } else {
      payload.command = mcpForm.command.trim();
      if (!payload.command) return;
      if (mcpForm.args.trim()) payload.args = mcpForm.args.trim();
    }
    try {
      await apiJson("mcp/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMcpForm({ name: "", type: "remote", url: "", command: "", args: "" });
      setShowAddMcp(false);
      await reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Show when={loading()}>
        <div class="loading-hint">{t("common.loading")}</div>
      </Show>

      <Show when={notice()}>
        <div class="config-status-box" data-status="error">
          {notice()}
          <button
            type="button"
            class="btn btn-ghost mini"
            onClick={() => setNotice("")}
          >
            {t("common.dismiss")}
          </button>
        </div>
      </Show>

      {/* ── Installed Skills ── */}
      <details class="config-subsection" open>
        <summary class="config-subsection-head">{t("skill.title")}</summary>
        <div class="config-subsection-body">
          <div class="extension-head">
            <div class="dialog-actions compact">
              <button type="button" class="btn btn-ghost mini" onClick={handleReloadSkills}>
                {t("common.reload")}
              </button>
              <button type="button" class="btn btn-ghost mini" onClick={handleOpenSkillDir}>
                {t("skill.open_dir")}
              </button>
              <button type="button" class="btn btn-ghost mini" onClick={() => setShowAddSkill(!showAddSkill())}>
                {t("skill.add")}
              </button>
              <button
                type="button"
                class="btn btn-ghost mini danger"
                disabled={removableSkills().length === 0}
                onClick={handleDeleteAllSkills}
              >
                {t("skill.delete_all")}
              </button>
            </div>
          </div>

        {/* Add Skill inline form */}
        <Show when={showAddSkill()}>
          <div class="config-inline-form">
            <label class="field">
              <span class="field-label">{t("skill.source_type")}</span>
              <select
                class="field-input"
                value={skillForm.type}
                onChange={(e) => setSkillForm("type", e.currentTarget.value as any)}
              >
                <option value="path">{t("skill.source.path")}</option>
                <option value="url">{t("skill.source.url")}</option>
                <option value="git">{t("skill.source.git")}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">{t("skill.value")}</span>
              <div class="field-input-group">
                <input
                  class="field-input"
                  type="text"
                  value={skillForm.value}
                  placeholder={t("skill.value_placeholder")}
                  onInput={(e) => setSkillForm("value", e.currentTarget.value)}
                />
                <Show when={skillForm.type === "path"}>
                  <button type="button" class="btn btn-ghost mini" onClick={handleBrowseFolder}>
                    {t("skill.browse_folder")}
                  </button>
                </Show>
              </div>
            </label>
            <label class="field">
              <span class="field-label">{t("skill.policy")}</span>
              <select
                class="field-input"
                value={skillForm.policy}
                onChange={(e) => setSkillForm("policy", e.currentTarget.value as any)}
              >
                <option value="ask">{t("skill.policy.ask")}</option>
                <option value="allow">{t("skill.policy.allow")}</option>
                <option value="deny">{t("skill.policy.deny")}</option>
              </select>
            </label>
            <div class="dialog-actions compact">
              <button type="button" class="btn btn-ghost" onClick={() => setShowAddSkill(false)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled={!skillForm.value.trim()}
                onClick={handleAddSkill}
              >
                {t("skill.install")}
              </button>
            </div>
          </div>
        </Show>
          <div class="extension-list" id="skillList">
            <Show
              when={skills().length > 0}
              fallback={<div class="empty-hint">{t("skill.none_custom")}</div>}
            >
              <For each={skills()}>
                {(item) => (
                  <div class="extension-row">
                    <div class="extension-row-main">
                      <strong>{item.name}</strong>
                      <span>{item.description || ""}</span>
                      <small>{item.location || ""}</small>
                    </div>
                    <div class="extension-row-actions">
                      <Show when={skillRemovable(item)}>
                        <button
                          type="button"
                          class="btn btn-ghost mini danger"
                          title={t("skill.delete_button_title")}
                          aria-label={t("skill.delete_button_title")}
                          onClick={() =>
                            handleRemoveSkill(
                              item.source || "",
                              skillRemoveKind(item),
                              item.name,
                            )
                          }
                        >
                          {t("common.delete")}
                        </button>
                      </Show>
                      <Show when={item.location && item.location !== "builtin"}>
                        <button
                          type="button"
                          class="btn btn-ghost mini"
                          title={t("skill.open_button_title")}
                          aria-label={t("skill.open_button_title")}
                          onClick={() => handleOpenSkill(item.location!)}
                        >
                          {t("common.open")}
                        </button>
                      </Show>
                      <span class="extension-status" data-state="connected">
                        {item.builtin ? t("skill.builtin") : t("common.loaded")}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </details>

      {/* ── MCP Servers ── */}
      <details class="config-subsection" open>
        <summary class="config-subsection-head">{t("mcp.title")}</summary>
        <div class="config-subsection-body">
          <div class="extension-head">
            <div class="dialog-actions compact">
              <button type="button" class="btn btn-ghost mini" onClick={() => setShowAddMcp(!showAddMcp())}>
                {t("mcp.add_action")}
              </button>
              <button
                type="button"
                class="btn btn-ghost mini danger"
                disabled={mcpEntries().length === 0}
                onClick={handleDeleteAllMcp}
            >
              {t("mcp.delete_all")}
            </button>
          </div>
        </div>

        {/* Add MCP inline form */}
        <Show when={showAddMcp()}>
          <div class="config-inline-form">
            <label class="field">
              <span class="field-label">{t("mcp.name")}</span>
              <input
                class="field-input"
                type="text"
                value={mcpForm.name}
                placeholder="exa"
                onInput={(e) => setMcpForm("name", e.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span class="field-label">{t("mcp.type")}</span>
              <select
                class="field-input"
                value={mcpForm.type}
                onChange={(e) => setMcpForm("type", e.currentTarget.value as any)}
              >
                <option value="remote">{t("mcp.type.remote")}</option>
                <option value="local">{t("mcp.type.local")}</option>
              </select>
            </label>
            <Show when={mcpForm.type === "remote"}>
              <label class="field">
                <span class="field-label">{t("mcp.remote_url")}</span>
                <input
                  class="field-input"
                  type="url"
                  value={mcpForm.url}
                  placeholder="https://example.com/mcp"
                  onInput={(e) => setMcpForm("url", e.currentTarget.value)}
                />
              </label>
            </Show>
            <Show when={mcpForm.type === "local"}>
              <label class="field">
                <span class="field-label">{t("mcp.command")}</span>
                <input
                  class="field-input"
                  type="text"
                  value={mcpForm.command}
                  placeholder="npx"
                  onInput={(e) => setMcpForm("command", e.currentTarget.value)}
                />
              </label>
              <label class="field">
                <span class="field-label">{t("mcp.arguments")}</span>
                <input
                  class="field-input"
                  type="text"
                  value={mcpForm.args}
                  placeholder="-y @modelcontextprotocol/server-filesystem C:\repo"
                  onInput={(e) => setMcpForm("args", e.currentTarget.value)}
                />
              </label>
            </Show>
            <div class="dialog-actions compact">
              <button type="button" class="btn btn-ghost" onClick={() => setShowAddMcp(false)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled={!mcpForm.name.trim() || (mcpForm.type === "remote" ? !mcpForm.url.trim() : !mcpForm.command.trim())}
                onClick={handleAddMcp}
              >
                {t("mcp.add_action")}
              </button>
            </div>
          </div>
        </Show>
          <div class="extension-list" id="mcpList">
            <Show
              when={mcpEntries().length > 0}
              fallback={<div class="empty-hint">{t("mcp.none")}</div>}
            >
              <For each={mcpEntries()}>
                {([name, item]) => {
                  const status = item?.status || "disabled";
                  const detail = item?.error || "";
                  return (
                    <div class="extension-row">
                      <div class="extension-row-main">
                        <strong>{name}</strong>
                        <span>{detail ? detail : mcpStatusLabel(status)}</span>
                      </div>
                      <span class="extension-status" data-state={status}>
                        {mcpStatusLabel(status)}
                      </span>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </details>

      {/* ── Skill Market ── */}
      <details class="config-subsection">
        <summary class="config-subsection-head">{t("skill.market.title")}</summary>
        <div class="config-subsection-body">
          <div class="extension-list" id="skillMarketList">
            <Show
              when={market().length > 0}
              fallback={<div class="empty-hint">{t("skill.market.none")}</div>}
            >
              <For each={market()}>
                {(item) => {
                  const installable = !!item.source && item.install_kind !== "manual";
                  return (
                    <div class="market-card">
                      <div class="market-card-main">
                        <strong>{item.name}</strong>
                        <span>
                          {item.provider} · {item.trust} · {item.install_kind}
                        </span>
                        <small>{item.description || ""}</small>
                        <Show when={item.notes}>
                          <small>{item.notes}</small>
                        </Show>
                      </div>
                      <div class="market-card-actions">
                        <span
                          class="extension-status"
                          data-state={item.recommended_policy || ""}
                        >
                          {policyLabel(item.recommended_policy || "")}
                        </span>
                        <Show
                          when={installable}
                          fallback={
                            <button
                              type="button"
                              class="btn btn-ghost mini"
                              title={t("skill.market.open_site_title")}
                              aria-label={t("skill.market.open_site_title")}
                              onClick={() => handleOpenHomepage(item.homepage)}
                            >
                              {t("skill.market.open_site")}
                            </button>
                          }
                        >
                          <button
                            type="button"
                            class="btn btn-primary mini"
                            title={t("skill.market.install_button_title")}
                            aria-label={t("skill.market.install_button_title")}
                            onClick={() => handleInstall(item)}
                          >
                            {t("skill.install")}
                          </button>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </details>
    </>
  );
}
