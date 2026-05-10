import { For, Show } from "solid-js";
import type { CardNode } from "../store/card-tree";
import { t } from "../utils/i18n";

/**
 * IntegrityBody — structured renderer for an architecture integrity review
 * verdict. Driven by the `integrity.review.completed` event emitted by
 * `packages/opencorvus/src/integrity/agent.ts`. Replaces the
 * raw-JSON reasoning block that used to appear in the requirements agent
 * card whenever the integrity LLM streamed its JSON contract through
 * `ProviderLLM.stream.onChunk`.
 *
 * Layout:
 *   [verdict badge]  [summary]
 *   Dimensions
 *     • [dimension verdict pill]  dimension id  (issues / corrections / missing)
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

type Integrity = NonNullable<CardNode["integrity"]>;
type Verdict = Integrity["verdict"];

function verdictLabel(verdict: Verdict): string {
  if (verdict === "pass") return t("integrity.verdict.pass");
  if (verdict === "concerns") return t("integrity.verdict.concerns");
  return t("integrity.verdict.needs_correction");
}

function dimensionLabel(id: string): string {
  return t(`integrity.dimension.${id}`);
}

export function IntegrityBody(props: { integrity: Integrity }) {
  const hasIssues = () => props.integrity.issues.length > 0;
  const hasCorrections = () => props.integrity.corrections.length > 0;
  const hasMissing = () => props.integrity.missingGoals.length > 0;
  const hasDimensions = () => props.integrity.dimensions.length > 0;
  const nothing = () => !hasIssues() && !hasCorrections() && !hasMissing();

  return (
    <div class="integrity" data-verdict={props.integrity.verdict}>
      <div class="integrity__header">
        <span
          class="verdict-pill"
          data-verdict={props.integrity.verdict}
        >
          {verdictLabel(props.integrity.verdict)}
        </span>
        <Show when={props.integrity.attempts > 1}>
          <span class="integrity__attempts">
            {t("integrity.attempts", { n: String(props.integrity.attempts) })}
          </span>
        </Show>
      </div>

      <Show when={props.integrity.summary}>
        <p class="integrity__summary">{props.integrity.summary}</p>
      </Show>

      <Show when={hasDimensions()}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("integrity.dimensions_heading")}
          </h4>
          <ul class="integrity__list">
            <For each={props.integrity.dimensions}>
              {(d) => (
                <li class="integrity__dimension" data-verdict={d.verdict}>
                  <span class="verdict-pill" data-verdict={d.verdict}>
                    {verdictLabel(d.verdict)}
                  </span>
                  <span class="integrity__dimension-name">{dimensionLabel(d.id)}</span>
                  <span class="integrity__dimension-counts">
                    {t("integrity.dimension_counts", {
                      issues: String(d.issueCount),
                      corrections: String(d.correctionCount),
                      missing: String(d.missingGoalCount),
                    })}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={nothing()}>
        <p class="empty-hint empty-hint--card">{t("integrity.no_findings")}</p>
      </Show>

      <Show when={hasIssues()}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("integrity.issues_heading", { n: String(props.integrity.issues.length) })}
          </h4>
          <ul class="integrity__list">
            <For each={props.integrity.issues}>
              {(issue) => (
                <li class="integrity__issue" data-type={issue.type}>
                  <span class="integrity__tag">{issue.type}</span>
                  <span class="integrity__issue-desc">{issue.description}</span>
                  <Show when={issue.requirement_ids && issue.requirement_ids.length > 0}>
                    <span class="integrity__chips integrity__chips--req">
                      <For each={issue.requirement_ids}>
                        {(rid) => <span class="integrity__chip integrity__chip--req">{rid}</span>}
                      </For>
                    </span>
                  </Show>
                  <Show when={issue.spec_ids && issue.spec_ids.length > 0}>
                    <span class="integrity__chips integrity__chips--spec">
                      <For each={issue.spec_ids}>
                        {(sid) => <span class="integrity__chip integrity__chip--spec">{sid}</span>}
                      </For>
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={hasCorrections()}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("integrity.corrections_heading", { n: String(props.integrity.corrections.length) })}
          </h4>
          <ul class="integrity__list">
            <For each={props.integrity.corrections}>
              {(c) => (
                <li class="integrity__correction" data-action={c.action}>
                  <div class="integrity__correction-head">
                    <span class="integrity__tag" data-action={c.action}>{c.action}</span>
                    <code class="integrity__goal-id">{c.goalID}</code>
                    <span class="integrity__correction-reason">{c.reason}</span>
                  </div>
                  <Show when={c.updatesTitle || c.updatesObjective}>
                    <dl class="integrity__diff">
                      <Show when={c.updatesTitle}>
                        <dt>{t("integrity.update_title")}</dt>
                        <dd>{c.updatesTitle}</dd>
                      </Show>
                      <Show when={c.updatesObjective}>
                        <dt>{t("integrity.update_objective")}</dt>
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
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("integrity.missing_heading", { n: String(props.integrity.missingGoals.length) })}
          </h4>
          <ul class="integrity__list">
            <For each={props.integrity.missingGoals}>
              {(g) => (
                <li class="integrity__missing">
                  <div class="integrity__missing-title">{g.title}</div>
                  <div class="integrity__missing-objective">{g.objective}</div>
                  <Show when={g.reason}>
                    <div class="integrity__missing-reason">{g.reason}</div>
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
