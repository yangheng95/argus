// ── BoardIntro ──
//
// Right-panel empty state shown when no task is selected. Briefly explains
// the two task kinds (workflow / build) and the main agents in the pipeline,
// so a first-time operator (or a returning one staring at a blank panel) sees
// what each mode is for and what each agent contributes. Replaces what was
// otherwise an empty <div id="taskActionsBar"> + collapsed Show on Board.tsx.
//
// Mounted by Board.tsx via <Show when={!boardStore.selectedTaskID}>.
//
// All i18n keys are referenced via template-literal prefixes so the
// `check:i18n` linter (script/check-panel-i18n.ts) sees `intro.mode.*` and
// `intro.agent.*` as live keyspaces — the linter recognizes the static head
// before the first `${` interpolation as a dotted prefix.

import { For, Show } from "solid-js";
import { t } from "../utils/i18n";
import { settingsStore } from "../store/settings";

const MODES = ["workflow", "build"] as const;

type AgentDef = {
  /** i18n key suffix under intro.agent.<key>.desc — uses underscores. */
  key: string;
  /** i18n key suffix under chat.role.<role> — preserves the existing hyphenated style. */
  role: string;
};

const AGENTS: AgentDef[] = [
  { key: "orchestrator", role: "orchestrator" },
  { key: "requirements", role: "requirements" },
  { key: "design_analyst", role: "design-analyst" },
  { key: "architect", role: "architect" },
  { key: "build", role: "build" },
  { key: "delivery", role: "delivery" },
  { key: "integrity", role: "integrity" },
];

export function BoardIntro() {
  return (
    <div class="board-intro" role="region" aria-label={t("intro.aria_label")}>
      <header class="board-intro__head">
        <h2 class="board-intro__title">{t("intro.headline")}</h2>
        <p class="board-intro__tagline">{t("intro.tagline")}</p>
      </header>

      {/* Cold-start blocker: when no working directory is set, the
          composer is silently disabled and there's no other signal
          telling the operator what to do. Surface a high-contrast
          callout here pointing at the cwd dropdown in the title bar. */}
      <Show when={!settingsStore.directory}>
        <div
          class="board-intro__cta board-intro__cta--directory"
          role="status"
          aria-live="polite"
        >
          <span class="board-intro__cta-icon" aria-hidden="true">📁</span>
          <span class="board-intro__cta-body">
            <strong class="board-intro__cta-title">{t("intro.directory_required_title")}</strong>
            <span class="board-intro__cta-text">{t("intro.directory_required_body")}</span>
          </span>
        </div>
      </Show>

      <section class="board-intro__section" aria-labelledby="board-intro-modes-h">
        <h3 id="board-intro-modes-h" class="board-intro__section-title">
          {t("intro.modes_heading")}
        </h3>
        <ul class="board-intro__modes">
          <For each={MODES}>
            {(mode) => (
              <li class="board-intro__mode" data-mode={mode}>
                <div class="board-intro__mode-label">{t(`intro.mode.${mode}.label`)}</div>
                <div class="board-intro__mode-desc">{t(`intro.mode.${mode}.desc`)}</div>
              </li>
            )}
          </For>
        </ul>
      </section>

      <section class="board-intro__section" aria-labelledby="board-intro-agents-h">
        <h3 id="board-intro-agents-h" class="board-intro__section-title">
          {t("intro.agents_heading")}
        </h3>
        <ul class="board-intro__agents">
          <For each={AGENTS}>
            {(agent) => (
              <li class="board-intro__agent" data-role={agent.role}>
                <div class="board-intro__agent-name">{t(`chat.role.${agent.role}`)}</div>
                <div class="board-intro__agent-desc">{t(`intro.agent.${agent.key}.desc`)}</div>
              </li>
            )}
          </For>
        </ul>
      </section>

      <footer class="board-intro__foot">
        <p class="board-intro__hint">{t("intro.hint")}</p>
      </footer>
    </div>
  );
}
