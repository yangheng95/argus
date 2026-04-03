/**
 * OrchestrationPanel — Workflow selection, Agent configuration, Behavior toggles.
 *
 * All values read/write via Config.Info (server-side config through PATCH /config).
 * Nothing in localStorage.
 */
import { createMemo, For, Show } from "solid-js";
import { appStore, setAppStore } from "../../store/app";
import { t } from "../../utils/i18n";

// ── Config PATCH helper (same as used in GeneralPanel) ──

async function patchConfig(patch: Record<string, unknown>): Promise<void> {
  const { patchConfig: doPatch } = await import("../../services/config");
  await doPatch(patch);
}

// ── Types ──

interface AgentConfigValues {
  max_steps?: number;
  timeout_ms?: number;
  quality_threshold?: number;
  max_attempts?: number;
  model?: string;
  tier?: string;
  max_retries?: number;
}

// ── Helpers ──

function assistantConfig(): Record<string, any> {
  return (appStore.config as any)?.assistant ?? {};
}

function experimentalConfig(): Record<string, any> {
  return (appStore.config as any)?.experimental ?? {};
}

function agentConfig(name: string): AgentConfigValues {
  return assistantConfig()[name] ?? {};
}

// ── Agent Config Card ──

interface AgentCardProps {
  name: string;
  label: string;
  fields: Array<{ key: string; label: string; type: "number" | "select"; options?: string[] }>;
}

function AgentConfigCard(props: AgentCardProps) {
  const cfg = createMemo(() => agentConfig(props.name));

  function updateField(key: string, value: unknown) {
    void patchConfig({ assistant: { [props.name]: { [key]: value } } });
  }

  return (
    <details class="orch-agent-card">
      <summary class="orch-agent-header">{props.label}</summary>
      <div class="orch-agent-body">
        <For each={props.fields}>
          {(field) => (
            <div class="orch-field">
              <label class="orch-field-label">{field.label}</label>
              {field.type === "number" ? (
                <input
                  class="orch-field-input"
                  type="number"
                  value={cfg()[field.key as keyof AgentConfigValues] ?? ""}
                  onChange={(e) => {
                    const v = parseInt(e.currentTarget.value, 10);
                    if (Number.isFinite(v)) updateField(field.key, v);
                  }}
                />
              ) : field.type === "select" && field.options ? (
                <select
                  class="orch-field-select"
                  value={String(cfg()[field.key as keyof AgentConfigValues] ?? "")}
                  onChange={(e) => updateField(field.key, e.currentTarget.value)}
                >
                  <For each={field.options}>
                    {(opt) => <option value={opt}>{opt}</option>}
                  </For>
                </select>
              ) : null}
            </div>
          )}
        </For>
      </div>
    </details>
  );
}

// ── Toggle ──

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <label class="orch-toggle">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span class="orch-toggle-label">{props.label}</span>
      <Show when={props.description}>
        <span class="orch-toggle-desc">{props.description}</span>
      </Show>
    </label>
  );
}

// ── Main Panel ──

export function OrchestrationPanel() {
  const defaultWorkflow = createMemo(() => assistantConfig().default_workflow ?? "standard");

  return (
    <div class="orch-panel">
      {/* ── Workflow Selection ── */}
      <section class="orch-section">
        <h3 class="orch-section-title">{t("orchestration.workflow") || "Workflow"}</h3>
        <div class="orch-field">
          <label class="orch-field-label">{t("orchestration.default_workflow") || "Default Workflow"}</label>
          <select
            class="orch-field-select"
            value={defaultWorkflow()}
            onChange={(e) => void patchConfig({ assistant: { default_workflow: e.currentTarget.value } })}
          >
            <option value="standard">Standard</option>
            <option value="quick-fix">Quick Fix</option>
            <option value="plan-only">Plan Only</option>
          </select>
        </div>
      </section>

      {/* ── Agent Configuration ── */}
      <section class="orch-section">
        <h3 class="orch-section-title">{t("orchestration.agent_config") || "Agent Configuration"}</h3>

        <AgentConfigCard
          name="decompose"
          label={t("orchestration.agent_requirements") || "Requirements Agent"}
          fields={[
            { key: "max_steps", label: "Max Steps", type: "number" },
            { key: "timeout_ms", label: "Timeout (ms)", type: "number" },
            { key: "quality_threshold", label: "Quality Threshold", type: "number" },
            { key: "max_attempts", label: "Max Attempts", type: "number" },
          ]}
        />

        <AgentConfigCard
          name="architect"
          label={t("orchestration.agent_architect") || "Architect Agent"}
          fields={[
            { key: "max_steps", label: "Max Steps", type: "number" },
            { key: "timeout_ms", label: "Timeout (ms)", type: "number" },
          ]}
        />

        <AgentConfigCard
          name="planner"
          label={t("orchestration.agent_planner") || "Planner Agent"}
          fields={[
            { key: "max_steps", label: "Max Steps", type: "number" },
            { key: "timeout_ms", label: "Timeout (ms)", type: "number" },
            { key: "quality_threshold", label: "Quality Threshold", type: "number" },
          ]}
        />

        <AgentConfigCard
          name="evaluator"
          label={t("orchestration.agent_evaluator") || "Evaluator Agent"}
          fields={[
            { key: "max_steps", label: "Max Steps", type: "number" },
            { key: "timeout_ms", label: "Timeout (ms)", type: "number" },
            { key: "tier", label: "Tier", type: "select", options: ["core", "standard", "full"] },
          ]}
        />

        <AgentConfigCard
          name="delivery"
          label={t("orchestration.agent_delivery") || "Delivery Agent"}
          fields={[
            { key: "max_steps", label: "Max Steps", type: "number" },
            { key: "timeout_ms", label: "Timeout (ms)", type: "number" },
            { key: "max_retries", label: "Max Retries", type: "number" },
          ]}
        />
      </section>

      {/* ── Orchestration Limits ── */}
      <section class="orch-section">
        <h3 class="orch-section-title">{t("orchestration.limits") || "Orchestration Limits"}</h3>
        <div class="orch-field">
          <label class="orch-field-label">Max Runs</label>
          <input
            class="orch-field-input"
            type="number"
            value={assistantConfig().max_runs ?? 10}
            onChange={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(v)) void patchConfig({ assistant: { max_runs: v } });
            }}
          />
        </div>
        <div class="orch-field">
          <label class="orch-field-label">Max Fix Runs</label>
          <input
            class="orch-field-input"
            type="number"
            value={assistantConfig().max_fix_runs ?? 5}
            onChange={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(v)) void patchConfig({ assistant: { max_fix_runs: v } });
            }}
          />
        </div>
        <div class="orch-field">
          <label class="orch-field-label">Max Executor Groups</label>
          <input
            class="orch-field-input"
            type="number"
            value={assistantConfig().max_executor_groups ?? 1}
            onChange={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(v)) void patchConfig({ assistant: { max_executor_groups: v } });
            }}
          />
        </div>
      </section>

      {/* ── Behavior (migrated from GeneralPanel) ── */}
      <section class="orch-section">
        <h3 class="orch-section-title">{t("orchestration.behavior") || "Behavior"}</h3>
        <Toggle
          label={t("settings.unattended") || "Unattended Mode"}
          checked={!!experimentalConfig().unattended}
          onChange={(v) => void patchConfig({ experimental: { unattended: v } })}
          description={t("orchestration.unattended_desc") || "Auto-approve permissions and auto-reject stale interactions"}
        />
        <Toggle
          label={t("settings.auto_permission") || "Auto-approve Permissions"}
          checked={!!experimentalConfig().auto_permission}
          onChange={(v) => void patchConfig({ experimental: { auto_permission: v } })}
        />
        <Toggle
          label={t("settings.auto_question") || "Auto-answer Questions"}
          checked={!!experimentalConfig().auto_question}
          onChange={(v) => void patchConfig({ experimental: { auto_question: v } })}
        />
      </section>
    </div>
  );
}
