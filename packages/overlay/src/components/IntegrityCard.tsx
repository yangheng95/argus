import { For, Show, createSignal } from "solid-js"
import type { CardNode } from "../store/card-tree"
import { t } from "../utils/i18n"

type Integrity = NonNullable<CardNode["integrity"]>
type Verdict = Integrity["verdict"]
type Reviewer = Integrity["reviewers"][number]
type Finding = Integrity["findings"][number]
type Repair = Integrity["requiredRepairs"][number]

function verdictLabel(verdict: Verdict): string {
  if (verdict === "pass") return t("integrity.verdict.pass")
  if (verdict === "concerns") return t("integrity.verdict.concerns")
  return t("integrity.verdict.needs_correction")
}

function reviewerLabel(reviewer: Reviewer): string {
  return reviewer.reviewerID || reviewer.scope || t("chat.role.integrity")
}

function ReviewerCard(props: { reviewer: Reviewer }) {
  const evidence = () => props.reviewer.evidence.filter(Boolean)
  const openQuestions = () => props.reviewer.openQuestions.filter(Boolean)
  const findingCount = () => (Array.isArray(props.reviewer.findings) ? props.reviewer.findings.length : 0)

  return (
    <li class="integrity__reviewer" data-verdict={props.reviewer.verdict}>
      <div class="integrity__reviewer-head">
        <div class="integrity__reviewer-title">
          <span class="integrity__reviewer-name">{reviewerLabel(props.reviewer)}</span>
          <Show when={props.reviewer.scope && props.reviewer.scope !== props.reviewer.reviewerID}>
            <span class="integrity__reviewer-scope">{props.reviewer.scope}</span>
          </Show>
        </div>
        <span class="verdict-pill" data-verdict={props.reviewer.verdict}>
          {verdictLabel(props.reviewer.verdict)}
        </span>
      </div>
      <Show when={props.reviewer.summary}>
        <p class="integrity__reviewer-summary">{props.reviewer.summary}</p>
      </Show>
      <Show when={evidence().length > 0 || openQuestions().length > 0 || findingCount() > 0}>
        <div class="integrity__reviewer-meta">
          <Show when={findingCount() > 0}>
            <span class="integrity__reviewer-chip">
              {t("integrity.reviewer_findings", { n: String(findingCount()) })}
            </span>
          </Show>
          <Show when={evidence().length > 0}>
            <span class="integrity__reviewer-chip">
              {t("integrity.reviewer_evidence", { n: String(evidence().length) })}
            </span>
          </Show>
          <Show when={openQuestions().length > 0}>
            <span class="integrity__reviewer-chip" data-tone="warn">
              {t("integrity.reviewer_questions", { n: String(openQuestions().length) })}
            </span>
          </Show>
        </div>
      </Show>
    </li>
  )
}

function IntegrityTeamReport(props: { markdown: string }) {
  const [open, setOpen] = createSignal(false)

  return (
    <details class="integrity__report-detail" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary class="integrity__report-summary">
        <span>{t("integrity.team_report_heading")}</span>
        <span class="integrity__report-meta">{t("integrity.team_report_detail")}</span>
      </summary>
      <Show when={open()}>
        <pre class="integrity__report">{props.markdown}</pre>
      </Show>
    </details>
  )
}

function ManifestMeta(props: { item: Finding | Repair }) {
  const verifyCount = () => props.item.verify?.length ?? 0
  return (
    <Show when={props.item.fingerprint || props.item.canonicalSymptom || verifyCount() > 0}>
      <div class="integrity__manifest-meta">
        <Show when={props.item.fingerprint}>
          <span>{props.item.fingerprint}</span>
        </Show>
        <Show when={props.item.canonicalSymptom}>
          <span>{props.item.canonicalSymptom}</span>
        </Show>
        <Show when={verifyCount() > 0}>
          <span>{t("integrity.verify_count", { n: String(verifyCount()) })}</span>
        </Show>
      </div>
    </Show>
  )
}

export function IntegrityBody(props: { integrity: Integrity }) {
  const hasFindings = () => props.integrity.findings.length > 0
  const hasRepairs = () => props.integrity.requiredRepairs.length > 0
  const hasDisagreements = () => props.integrity.unresolvedDisagreements.length > 0
  const nothing = () => !hasFindings() && !hasRepairs() && !hasDisagreements()

  return (
    <div class="integrity" data-verdict={props.integrity.verdict}>
      <div class="integrity__header">
        <span class="verdict-pill" data-verdict={props.integrity.verdict}>
          {verdictLabel(props.integrity.verdict)}
        </span>
        <Show when={props.integrity.attempts > 1}>
          <span class="integrity__attempts">{t("integrity.attempts", { n: String(props.integrity.attempts) })}</span>
        </Show>
      </div>

      <Show when={props.integrity.summary}>
        <p class="integrity__summary">{props.integrity.summary}</p>
      </Show>

      <Show when={props.integrity.teamReportMarkdown}>
        <section class="integrity__section">
          <IntegrityTeamReport markdown={props.integrity.teamReportMarkdown} />
        </section>
      </Show>

      <Show when={props.integrity.reviewers.length > 0}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">{t("integrity.reviewers_heading")}</h4>
          <ul class="integrity__reviewer-list">
            <For each={props.integrity.reviewers}>{(reviewer) => <ReviewerCard reviewer={reviewer} />}</For>
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
                  <span class="integrity__issue-desc">
                    {finding.title}: {finding.description}
                  </span>
                  <Show when={finding.repair}>
                    <span class="integrity__missing-reason">{finding.repair}</span>
                  </Show>
                  <ManifestMeta item={finding} />
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
                  <ManifestMeta item={repair} />
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
  )
}
