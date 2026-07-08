import { t } from "../utils/i18n"

export function AgentSummaryBlock(props: { text: string }) {
  return (
    <span class="card__agent-summary" data-ui="agent-summary" title={props.text}>
      <span class="card__agent-summary-label">{t("card.agent_summary_label")}</span>
      <span class="card__agent-summary-text">{props.text}</span>
    </span>
  )
}
