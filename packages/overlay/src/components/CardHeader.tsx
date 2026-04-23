import { Show, createSignal } from "solid-js";
import { displayToolIcon } from "../utils/tool";
import { collectCardText, type CardNode } from "../utils/card-tree";
import { t } from "../utils/i18n";
import { goalRevisionLabel } from "../utils/goal-label";

function statusBadge(node: CardNode): { tone: string; glyph: string } {
  const s = node.status;
  if (s === "running") return { tone: "running", glyph: "" };
  if (s === "error") return { tone: "error", glyph: "\u2717" };
  if (s === "skipped") return { tone: "skipped", glyph: "\u2014" };
  if (s === "pending") return { tone: "pending", glyph: "\u00B7" };
  if (s === "completed") return { tone: "done", glyph: "\u2713" };
  if (node.kind === "message") return { tone: "neutral", glyph: "" };
  return { tone: "done", glyph: "\u2713" };
}

function leadingGlyph(node: CardNode): string {
  if (node.kind === "tool") return displayToolIcon(node.stage || node.title);
  return "";
}

function isStageCard(node: CardNode): boolean {
  return node.kind === "agent" || node.kind === "phase" || node.kind === "step";
}

/** Compact token count — "8.4k" rather than "8432", so the low-contrast
 *  header hint reads at a glance without dominating the row. */
function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

function previewPlainText(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, (block) =>
      block
        .replace(/^```[^\n]*\n?/, "")
        .replace(/\n?```$/, "")
        .trim(),
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][\w:-]*>/g, " ");
}

function collapsedPreviewText(text: string, title?: string, limit = 96): string {
  const normalized = previewPlainText(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim();
  let preview = normalized;
  if (normalizedTitle && preview.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
    preview = preview.slice(normalizedTitle.length).replace(/^[\s:：-]+/, "").trim();
  }
  if (!preview) return "";
  if (preview.length <= limit) return preview;
  return `${preview.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export function CardHeader(props: {
  node: CardNode;
  expanded: boolean;
  collapsible: boolean;
  onToggle: () => void;
  /** Invoked when the user clicks the rewind (↶) button. Receives the
   *  card's `time` (ms — becomes cursorTime on the backend) and id
   *  (anchorEventID for audit). Parent routes it to POST /task/:id/rewind. */
  onRewind?: (cursorTime: number, anchorID: string) => void | Promise<void>;
}) {
  const badge = () => statusBadge(props.node);
  const glyph = () => leadingGlyph(props.node);
  const [copied, setCopied] = createSignal(false);
  const [rewinding, setRewinding] = createSignal(false);
  const canCopy = () => !!collectCardText(props.node);
  const canRewind = () =>
    !!props.onRewind &&
    isStageCard(props.node) &&
    typeof props.node.time === "number" &&
    props.node.time > 0;
  const collapsedPreview = () =>
    !props.expanded && isStageCard(props.node) && props.node.kind !== "tool"
      ? collapsedPreviewText(collectCardText(props.node), props.node.title)
      : "";
  const hasSecondaryText = () => !!props.node.subtitle || !!collapsedPreview();
  const stepRevisionLabel = () =>
    props.node.kind === "step"
      ? goalRevisionLabel(props.node.round, props.node.attempt)
      : "";

  const onCopy = async (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    const text = collectCardText(props.node);
    if (!text) return;
    const ok = await writeClipboard(text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const onRewind = async (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    if (!props.onRewind || !canRewind()) return;
    if (rewinding()) return;
    const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(
          t("card.rewind_confirm") ||
            "撤回到这张卡片之前？此操作只过滤数据库视图，不改动项目代码。",
        )
      : true;
    if (!confirmed) return;
    setRewinding(true);
    try {
      await props.onRewind(props.node.time, props.node.id);
    } finally {
      setTimeout(() => setRewinding(false), 800);
    }
  };

  return (
    <div
      class="card__head"
      classList={{ "card__head--with-meta": hasSecondaryText() }}
      role={props.collapsible ? "button" : undefined}
      tabindex={props.collapsible ? 0 : undefined}
      aria-expanded={props.collapsible ? props.expanded : undefined}
      onClick={() => props.collapsible && props.onToggle()}
      onKeyDown={(e) => {
        if (!props.collapsible) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onToggle();
        }
      }}
    >
      <Show
        when={props.node.status !== "running"}
        fallback={
          <span class="card__badge card__badge--running" title="running">
            <span class="card__spinner" />
          </span>
        }
      >
        <span class={`card__badge card__badge--${badge().tone}`} title={props.node.status || ""}>
          {badge().glyph}
        </span>
      </Show>
      <Show when={glyph()}>
        <span class="card__icon">{glyph()}</span>
      </Show>
      <div class="card__main">
        <div class="card__title-row">
          <span class="card__title">{t(props.node.title)}</span>
          <Show when={stepRevisionLabel()} fallback={
            <Show when={(props.node.round ?? 0) > 0}>
              <span class="card__round">#{props.node.round}</span>
            </Show>
          }>
            <span class="card__round">{stepRevisionLabel()}</span>
          </Show>
        </div>
        <Show when={hasSecondaryText()}>
          <div class="card__meta-row">
            <Show when={props.node.subtitle}>
              <span class="card__subtitle" title={props.node.subtitle}>{props.node.subtitle}</span>
            </Show>
            <Show when={collapsedPreview()}>
              <span class="card__collapsed-preview" title={collapsedPreview()}>{collapsedPreview()}</span>
            </Show>
          </div>
        </Show>
      </div>
      <div class="card__actions">
        <Show when={typeof props.node.contextTokens === "number" && (props.node.contextTokens as number) > 0}>
          <span
            class="card__token-hint"
            data-estimated={props.node.contextTokensEstimated ? "true" : "false"}
            title={t(
              props.node.contextTokensEstimated
                ? "card.context_tokens_tooltip_estimated"
                : "card.context_tokens_tooltip",
              { value: String(props.node.contextTokens) },
            )}
            aria-label={t(
              props.node.contextTokensEstimated
                ? "card.context_tokens_tooltip_estimated"
                : "card.context_tokens_tooltip",
              { value: String(props.node.contextTokens) },
            )}
            onClick={(e) => e.stopPropagation()}
          >
            ~{formatTokenCount(props.node.contextTokens as number)} tok{props.node.contextTokensEstimated ? " · est." : ""}
          </span>
        </Show>
        <Show when={canCopy()}>
          <button
            type="button"
            class="card__copy"
            classList={{ "card__copy--done": copied() }}
            title={copied() ? t("common.copied") : t("common.copy")}
            aria-label={copied() ? t("common.copied") : t("common.copy")}
            onClick={onCopy}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void onCopy(e);
              }
            }}
          >
            <Show
              when={copied()}
              fallback={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="5" y="3" width="8" height="10" rx="1.3" stroke="currentColor" stroke-width="1.3" />
                  <path d="M3.5 5.5V12a1.5 1.5 0 0 0 1.5 1.5h5.5" stroke="currentColor" stroke-width="1.3" fill="none" />
                </svg>
              }
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </Show>
          </button>
        </Show>
        <Show when={canRewind()}>
          <button
            type="button"
            class="card__rewind"
            classList={{ "card__rewind--pending": rewinding() }}
            title={t("card.rewind") || "撤回到这张卡片之前（仅过滤时间线，不改动代码）"}
            aria-label={t("card.rewind") || "rewind to before this card"}
            disabled={rewinding()}
            onClick={onRewind}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void onRewind(e);
              }
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6.5 3.5L3 7l3.5 3.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M13 12.5c0-2.7-2.1-4.9-4.8-4.9H3.4"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </Show>
        <Show when={props.collapsible}>
          <span class="card__chevron" aria-hidden="true">
            {"\u25BC"}
          </span>
        </Show>
      </div>
    </div>
  );
}
