// ── SkillMarketPanel ──
// Solid.js component for managing skills, MCP servers, and marketplace.
//
// Displays:
//   • Installed custom skills with add/remove/open actions
//   • Installed MCP servers with add/remove actions
//   • Skill market catalog with install / open-site actions
//
// All CRUD operations are self-contained — no dependency on static HTML dialogs.

import {
  createSignal,
  createMemo,
  For,
  Show,
  onMount,
} from "solid-js";
import { createStore } from "solid-js/store";
import { t, tc } from "../../utils/i18n";
import { apiJson } from "../../services/api";

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
  const [skills, setSkills] = createSignal<SkillItem[]>([]);
  const [mcp, setMcp] = createSignal<Record<string, McpItem>>({});
  const [market, setMarket] = createSignal<MarketItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [notice, setNotice] = createSignal("");

  const customSkills = createMemo(() => skills().filter((item) => !item.builtin));
  const removableSkills = createMemo(() => customSkills().filter(skillRemovable));
  const builtinCount = createMemo(() => skills().length - customSkills().length);
  const mcpEntries = createMemo(() => Object.entries(mcp()));

  async function loadAll() {
    setLoading(true);
    try {
      const [skillData, mcpData, marketData] = await Promise.all([
        apiJson("skill").catch(() => []),
        apiJson("mcp").catch(() => ({})),
        apiJson("skill/market").catch(() => []),
      ]);
      setSkills(Array.isArray(skillData) ? skillData : []);
      setMcp(mcpData && typeof mcpData === "object" && !Array.isArray(mcpData) ? mcpData : {});
      setMarket(Array.isArray(marketData) ? marketData : []);
    } finally {
      setLoading(false);
    }
  }

  onMount(loadAll);

  async function handleRemoveSkill(source: string, kind: string, name: string) {
    if (!confirm(t("skill.confirm_delete", { name }))) return;
    try {
      await apiJson("skill/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value: source }),
      });
      await loadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpenSkill(location: string) {
    try {
      await apiJson("open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: location }),
      });
    } catch {
      // ignore
    }
  }

  async function handleDeleteAllSkills() {
    if (!confirm(t("skill.confirm_delete_all"))) return;
    try {
      await Promise.all(
        removableSkills().map((item) =>
          apiJson("skill/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: skillRemoveKind(item), value: item.source }),
          }),
        ),
      );
      await loadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteAllMcp() {
    if (!confirm(t("mcp.confirm_delete_all"))) return;
    try {
      await Promise.all(
        mcpEntries().map(([name]) =>
          apiJson("mcp/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          }),
        ),
      );
      await loadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleInstall(id: string) {
    try {
      await apiJson("skill/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "id", value: id }),
      });
      await loadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpenHomepage(url: string | undefined) {
    if (!url) return;
    try {
      await apiJson("open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    } catch {
      window.open(url, "_blank", "noopener");
    }
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
      await loadAll();
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
    await loadAll();
  }

  async function handleOpenSkillDir() {
    try {
      await apiJson("skill/open-root", { method: "POST" });
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
      await loadAll();
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
      <section class="config-section">
        <div class="config-section-head">
          <h3 class="config-section-title">{t("skill.title")}</h3>
          <div class="config-section-actions">
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
          <div class="inline-form">
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
        <div class="skill-list" id="skillList">
          <Show
            when={customSkills().length > 0}
            fallback={
              <div class="empty-hint">
                {builtinCount() > 0
                  ? t("skill.none_custom_with_builtin", { count: builtinCount() })
                  : t("skill.none_custom")}
              </div>
            }
          >
            <For each={customSkills()}>
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
                      {t("common.loaded")}
                    </span>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>

      {/* ── MCP Servers ── */}
      <section class="config-section">
        <div class="config-section-head">
          <h3 class="config-section-title">{t("mcp.title")}</h3>
          <div class="config-section-actions">
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
          <div class="inline-form">
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
        <div class="mcp-list" id="mcpList">
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
      </section>

      {/* ── Skill Market ── */}
      <section class="config-section">
        <div class="config-section-head">
          <h3 class="config-section-title">{t("skill.market.title")}</h3>
        </div>
        <div class="skill-market-list" id="skillMarketList">
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
                          onClick={() => handleInstall(item.id)}
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
      </section>
    </>
  );
}
