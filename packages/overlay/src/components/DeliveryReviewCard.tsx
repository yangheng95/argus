import { For, Show } from "solid-js";
import type { CardNode } from "../store/card-tree";
import { t } from "../utils/i18n";

type DeliveryReview = NonNullable<CardNode["deliveryReview"]>;

export function DeliveryReviewBody(props: { review: DeliveryReview }) {
  const verdictLabel = () =>
    props.review.verdict === "accepted"
      ? t("delivery.review.verdict.accepted")
      : t("delivery.review.verdict.rejected");
  const sourceLabel = () =>
    props.review.source === "llm"
      ? t("delivery.review.source.llm")
      : t("delivery.review.source.host_gate");

  return (
    <div class="integrity delivery-review" data-verdict={props.review.verdict}>
      <div class="integrity__header">
        <span class="verdict-pill" data-verdict={props.review.verdict}>
          {verdictLabel()}
        </span>
        <span class="integrity__attempts">{sourceLabel()}</span>
      </div>

      <Show when={props.review.summary}>
        <p class="integrity__summary">{props.review.summary}</p>
      </Show>

      <section class="integrity__section">
        <h4 class="integrity__section-title">{t("delivery.review.title")}</h4>
        <ul class="integrity__list">
          <li class="integrity__issue">
            <span class="integrity__tag">
              {props.review.hostGatePassed
                ? t("delivery.review.host_gate_passed")
                : t("delivery.review.host_gate_failed")}
            </span>
            <span class="integrity__issue-desc">
              {t("delivery.review.rejections_heading", { n: String(props.review.rejectionCount) })}
            </span>
          </li>
        </ul>
      </section>

      <Show when={props.review.details.length > 0} fallback={<p class="empty-hint empty-hint--card">{t("delivery.review.no_rejections")}</p>}>
        <section class="integrity__section">
          <h4 class="integrity__section-title">
            {t("delivery.review.rejections_heading", { n: String(props.review.details.length) })}
          </h4>
          <ul class="integrity__list">
            <For each={props.review.details}>
              {(detail) => (
                <li class="integrity__issue">
                  <span class="integrity__tag">{props.review.failureKinds[0] || props.review.verdict}</span>
                  <span class="integrity__issue-desc">{detail}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
