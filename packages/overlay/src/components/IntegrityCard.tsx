import { For, Show } from "solid-js";
import type { CardNode } from "../store/card-tree";
import { t } from "../utils/i18n";

type Integrity = NonNullable<CardNode["integrity"]>;
type Verdict = Integrity["verdict"];

function verdictLabel(verdict: Verdict): string {
  if (verdict === "pass") return t("integrity.verdict.pass");
  if (verdict === "concerns") return t("integrity.verdict.concerns");
  return t("integrity.verdict.needs_correction");
}

export function IntegrityBody(props: { integrity: Integrity }) {
  const hasFindings = () => props.integrity.findings.length > 0;
  const hasRepairs = () => props.integrity.requiredRepairs.length > 0;
  const hasDisagreements = () => props.integrity.unresolvedDisagreements.length > 0;
  const nothing = () => !hasFindings() && !hasRepairs() && !hasDisagreements();

  return (
    <div class="integrity" data-verdict={props.integrity.verdict}>
      <div class="integrity__header">
        <span class="verdict-pill" data-verdict={props.integrity.verdict}>
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

      <Show when={props.integrity.teamReportMarkdown}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">{t("integrity.team_report_heading")}</h4>
          <pre class="integrity__report">{props.integrity.teamReportMarkdown}</pre>
        </section>
      </Show>

      <Show when={props.integrity.reviewers.length > 0}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">{t("integrity.reviewers_heading")}</h4>
          <ul class="integrity__list">
            <For each={props.integrity.reviewers}>
              {(reviewer) => (
                <li class="integrity__issue">
                  <span class="verdict-pill" data-verdict={reviewer.verdict}>
                    {verdictLabel(reviewer.verdict)}
                  </span>
                  <span class="integrity__issue-desc">
                    {reviewer.reviewerID}: {reviewer.summary}
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

      <Show when={hasFindings()}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("integrity.findings_heading", { n: String(props.integrity.findings.length) })}
          </h4>
          <ul class="integrity__list">
            <For each={props.integrity.findings}>
              {(finding) => (
                <li class="integrity__issue" data-type={finding.severity}>
                  <span class="integrity__tag">{finding.severity}</span>
                  <span class="integrity__issue-desc">{finding.title}: {finding.description}</span>
                  <Show when={finding.repair}>
                    <span class="integrity__missing-reason">{finding.repair}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={hasRepairs()}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("integrity.repairs_heading", { n: String(props.integrity.requiredRepairs.length) })}
          </h4>
          <ul class="integrity__list">
            <For each={props.integrity.requiredRepairs}>
              {(repair) => (
                <li class="integrity__correction">
                  <div class="integrity__correction-head">
                    <span class="integrity__tag">{repair.id}</span>
                    <span class="integrity__correction-reason">{repair.description}</span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={hasDisagreements()}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("integrity.disagreements_heading", { n: String(props.integrity.unresolvedDisagreements.length) })}
          </h4>
          <ul class="integrity__list">
            <For each={props.integrity.unresolvedDisagreements}>
              {(item) => (
                <li class="integrity__missing">
                  <div class="integrity__missing-title">{item.description}</div>
                  <div class="integrity__missing-reason">{item.consequence}</div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
