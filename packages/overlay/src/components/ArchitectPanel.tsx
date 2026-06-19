/**
 * ArchitectPanel — Architect Agent consensus summary.
 *
 * Two states:
 * 1. Generating — shows streaming indicator when architect step is running
 * 2. Complete — shows contract count, categories, and blueprint summary
 */
import { For, Show } from "solid-js"
import { t } from "../utils/i18n"
import { renderMarkdown } from "../utils/markdown"

interface ArchitectDecision {
  key: string
  value: string
  reason: string
  goalID?: string | null
}

interface ArchitectData {
  summary: string
  contractCount: number
  categories: string[]
  decisions?: ArchitectDecision[]
}

interface ArchitectPanelProps {
  architect: ArchitectData | undefined
  /** Whether the architect step is currently running */
  isGenerating?: boolean
}

function readableKey(key: string): string {
  return key.replace(/[_-]+/g, " ").trim() || key
}

function hasMeaningfulSummary(summary: string): boolean {
  return summary.trim().length > 0 && !/^\d+\s+architect decisions across\s+\d+\s+categories$/i.test(summary.trim())
}

export function ArchitectPanel(props: ArchitectPanelProps) {
  const decisions = () => props.architect?.decisions ?? []

  return (
    <div class="arch-panel">
      <Show when={props.isGenerating && !props.architect}>
        <div class="arch-generating" role="status" aria-live="polite" aria-busy="true">
          <span class="card__spinner" />
          <span class="arch-generating-label">{t("workflow.architect_generating")}</span>
        </div>
      </Show>
      <Show when={props.architect}>
        <div class="arch-overview">
          <div class="arch-summary">
            <span class="arch-count">{props.architect!.contractCount}</span>
            <span class="arch-count-label">{t("workflow.architect_contracts")}</span>
          </div>
          <Show when={props.architect!.categories.length > 0}>
            <div class="arch-categories">
              <For each={props.architect!.categories.slice(0, 4)}>
                {(cat) => (
                  <span class="arch-cat-badge" title={cat}>
                    {readableKey(cat)}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={decisions().length > 0}>
          <div class="arch-decisions">
            <For each={decisions()}>
              {(decision) => (
                <article class="arch-decision">
                  <div class="arch-decision-head">
                    <span class="arch-decision-key">{readableKey(decision.key)}</span>
                    <Show when={decision.goalID}>
                      <span class="arch-decision-goal">{decision.goalID}</span>
                    </Show>
                  </div>
                  <div class="arch-decision-value md-content" innerHTML={renderMarkdown(decision.value)} />
                  <Show when={decision.reason}>
                    <div class="arch-decision-reason md-content" innerHTML={renderMarkdown(decision.reason)} />
                  </Show>
                </article>
              )}
            </For>
          </div>
        </Show>
        <Show when={decisions().length === 0 && hasMeaningfulSummary(props.architect!.summary)}>
          <div class="arch-detail md-content" innerHTML={renderMarkdown(props.architect!.summary)} />
        </Show>
        <Show when={decisions().length === 0 && !hasMeaningfulSummary(props.architect!.summary)}>
          <p class="empty-hint empty-hint--card">{t("workflow.architect_empty")}</p>
        </Show>
      </Show>
    </div>
  )
}
