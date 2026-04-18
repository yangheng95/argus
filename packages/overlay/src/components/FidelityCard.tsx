import { For, Show } from "solid-js";
import type { CardNode } from "../store/card-tree";
import { t } from "../utils/i18n";

/**
 * FidelityBody — structured renderer for a requirements fidelity review
 * verdict. Driven by the `fidelity.review.completed` event emitted by
 * `packages/opencorvus/src/requirements/fidelity.ts`. Replaces the
 * raw-JSON reasoning block that used to appear in the requirements agent
 * card whenever the fidelity LLM streamed its JSON contract through
 * `ProviderLLM.stream.onChunk`.
 *
 * Layout:
 *   [verdict badge]
 *   Issues (N)
 *     • [type] description
 *   Corrections (N)
 *     • [action] goalID — reason
 *                 title → "...", objective → "..."
 *   Missing goals (N)
 *     • title
 *                 objective
 *                 reason
 */

type Fidelity = NonNullable<CardNode["fidelity"]>;

function verdictLabel(verdict: Fidelity["verdict"]): string {
  return verdict === "faithful"
    ? t("fidelity.verdict.faithful")
    : t("fidelity.verdict.needs_correction");
}

export function FidelityBody(props: { fidelity: Fidelity }) {
  const hasIssues = () => props.fidelity.issues.length > 0;
  const hasCorrections = () => props.fidelity.corrections.length > 0;
  const hasMissing = () => props.fidelity.missingGoals.length > 0;
  const nothing = () => !hasIssues() && !hasCorrections() && !hasMissing();

  return (
    <div class="fidelity" data-verdict={props.fidelity.verdict}>
      <div class="fidelity__header">
        <span
          class="fidelity__verdict"
          data-verdict={props.fidelity.verdict}
        >
          {verdictLabel(props.fidelity.verdict)}
        </span>
        <Show when={props.fidelity.attempts > 1}>
          <span class="fidelity__attempts">
            {t("fidelity.attempts", { n: String(props.fidelity.attempts) })}
          </span>
        </Show>
      </div>

      <Show when={nothing()}>
        <p class="fidelity__empty">{t("fidelity.no_findings")}</p>
      </Show>

      <Show when={hasIssues()}>
        <section class="fidelity__section">
          <h4 class="fidelity__section-title">
            {t("fidelity.issues_heading", { n: String(props.fidelity.issues.length) })}
          </h4>
          <ul class="fidelity__list">
            <For each={props.fidelity.issues}>
              {(issue) => (
                <li class="fidelity__issue" data-type={issue.type}>
                  <span class="fidelity__tag">{issue.type}</span>
                  <span class="fidelity__issue-desc">{issue.description}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={hasCorrections()}>
        <section class="fidelity__section">
          <h4 class="fidelity__section-title">
            {t("fidelity.corrections_heading", { n: String(props.fidelity.corrections.length) })}
          </h4>
          <ul class="fidelity__list">
            <For each={props.fidelity.corrections}>
              {(c) => (
                <li class="fidelity__correction" data-action={c.action}>
                  <div class="fidelity__correction-head">
                    <span class="fidelity__tag" data-action={c.action}>{c.action}</span>
                    <code class="fidelity__goal-id">{c.goalID}</code>
                    <span class="fidelity__correction-reason">{c.reason}</span>
                  </div>
                  <Show when={c.updatesTitle || c.updatesObjective}>
                    <dl class="fidelity__diff">
                      <Show when={c.updatesTitle}>
                        <dt>{t("fidelity.update_title")}</dt>
                        <dd>{c.updatesTitle}</dd>
                      </Show>
                      <Show when={c.updatesObjective}>
                        <dt>{t("fidelity.update_objective")}</dt>
                        <dd>{c.updatesObjective}</dd>
                      </Show>
                    </dl>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={hasMissing()}>
        <section class="fidelity__section">
          <h4 class="fidelity__section-title">
            {t("fidelity.missing_heading", { n: String(props.fidelity.missingGoals.length) })}
          </h4>
          <ul class="fidelity__list">
            <For each={props.fidelity.missingGoals}>
              {(g) => (
                <li class="fidelity__missing">
                  <div class="fidelity__missing-title">{g.title}</div>
                  <div class="fidelity__missing-objective">{g.objective}</div>
                  <Show when={g.reason}>
                    <div class="fidelity__missing-reason">{g.reason}</div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
