/**
 * ArchitectPanel — Architect Agent consensus summary.
 *
 * Two states:
 * 1. Generating — shows streaming indicator when architect step is running
 * 2. Complete — shows contract count, categories, and blueprint summary
 */
import { For, Show } from "solid-js";
import { t } from "../utils/i18n";
import { renderMarkdown } from "../utils/markdown";

interface ArchitectData {
  summary: string;
  contractCount: number;
  categories: string[];
}

interface ArchitectPanelProps {
  architect: ArchitectData | undefined;
  /** Whether the architect step is currently running */
  isGenerating?: boolean;
}

export function ArchitectPanel(props: ArchitectPanelProps) {
  return (
    <div class="arch-panel">
      <Show when={props.isGenerating && !props.architect}>
        <div class="arch-generating">
          <span class="agent-card-spinner" />
          <span class="arch-generating-label">{t("workflow.architect_generating")}</span>
        </div>
      </Show>
      <Show when={props.architect}>
        <div class="arch-summary">
          <span class="arch-count">{props.architect!.contractCount}</span>
          <span class="arch-count-label">{t("workflow.architect_contracts")}</span>
        </div>
        <Show when={props.architect!.categories.length > 0}>
          <div class="arch-categories">
            <For each={props.architect!.categories}>
              {(cat) => (
                <span class="arch-cat-badge" title={cat}>
                  {cat.replace(/_/g, " ")}
                </span>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.architect!.summary}>
          <div class="arch-detail md-content" innerHTML={renderMarkdown(props.architect!.summary)} />
        </Show>
      </Show>
    </div>
  );
}
