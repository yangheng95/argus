import { Show, createSignal } from "solid-js";
import { displayToolIcon } from "../utils/tool";
import {
  collectCardText,
  collectLatestActivityText,
  collectTodoSummary,
  type CardNode,
} from "../utils/card-tree";
import { statusBadge } from "../utils/status-badge";
import { t } from "../utils/i18n";
import { goalRevisionLabel } from "../utils/goal-label";
import { showAppDialog } from "../services/app-dialog";
import { Icon } from "./Icon";

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

/** Format a cost in USD as a tight badge value: under $0.01 → "<$0.01",
 *  under $1 → 3-decimal cents-wise, otherwise 2 decimals. The composer is
 *  scanning hundreds of these so we stay under 7 chars. */
function formatCostUSD(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 1) return "$" + n.toFixed(3);
  return "$" + n.toFixed(2);
}

/** Human-friendly duration in ms → "12s" / "3m 14s" / "1h 02m". Used by the
 *  CardHeader running-or-finished duration chip. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return mm === 0 ? `${hours}h` : `${hours}h ${String(mm).padStart(2, "0")}m`;
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

/** Sanitize markdown noise but PRESERVE line breaks — the operator wants
 *  to read the latest message in full (line-clamped to N lines by CSS,
 *  not by string truncation). Only collapses runs of horizontal
 *  whitespace inside a line; newlines stay intact. */
function collapsedPreviewText(text: string, title?: string): string {
  const sanitized = previewPlainText(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
  if (!sanitized) return "";
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim();
  let preview = sanitized;
  // Strip a leading title duplication only when it sits on the very first
  // line — preserves intentional repetition deeper in the body.
  if (normalizedTitle) {
    const firstLine = preview.split("\n", 1)[0];
    if (firstLine.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
      const stripped = firstLine.slice(normalizedTitle.length).replace(/^[\s:：-]+/, "");
      preview = (stripped + preview.slice(firstLine.length)).replace(/^\s+/, "");
    }
  }
  return preview;
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
  onExpand: () => void;
  /** Invoked when the user clicks the rewind (↶) button. Receives the
   *  card's `time` (ms — becomes cursorTime on the backend) and id
   *  (anchorEventID for audit). Parent routes it to POST /task/:id/rewind. */
  onRewind?: (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => void | Promise<void>;
  /** Set on cards that map 1:1 to an opencorvus session (kind="agent"
   *  cards whose id follows `<stage>:session:<sid>`). When present the
   *  header renders a 🔍 button that calls `onTrace` to toggle the
   *  AgentTrace panel for that session inside the card body. */
  traceSessionID?: string;
  /** Whether the trace panel is currently open in the parent. */
  traceOpen?: boolean;
  /** Toggle the trace panel for this card. */
  onTrace?: () => void;
  /** Child-agent cancel control. Root orchestrator/task session is not
   *  passed. Reply moved to <AgentSessionReplyBox/> at the END of the card
   *  body — see Card.tsx. */
  agentSessionID?: string;
  onAgentCancel?: (sessionID: string) => void | Promise<void>;
}) {
  const badge = () => statusBadge(props.node);
  const glyph = () => leadingGlyph(props.node);
  const [copied, setCopied] = createSignal(false);
  const [rewinding, setRewinding] = createSignal(false);
  const [agentCancelling, setAgentCancelling] = createSignal(false);
  const canCopy = () => !!collectCardText(props.node);
  const canRewind = () =>
    !!props.onRewind &&
    isStageCard(props.node) &&
    typeof props.node.time === "number" &&
    props.node.time > 0;
  const collapsedActive = () =>
    !props.expanded && isStageCard(props.node) && props.node.kind !== "tool";
  const collapsedPreview = () =>
    collapsedActive()
      ? collapsedPreviewText(collectLatestActivityText(props.node), props.node.title)
      : "";
  const todoSummary = () => (collapsedActive() ? collectTodoSummary(props.node) : null);
  const todoProgressPct = () => {
    const s = todoSummary();
    if (!s || s.total === 0) return 0;
    return Math.round((s.completed / s.total) * 100);
  };
  // Drives `card__head--with-meta` (flex-start vs center). Only true when
  // we render a row BELOW the title row — subtitle is inline, so it does
  // not count toward "needs vertical alignment to top".
  const hasSecondaryText = () => !!collapsedPreview() || !!todoSummary();
  const stepRevisionLabel = () =>
    props.node.kind === "step"
      ? goalRevisionLabel(props.node.round, props.node.attempt)
      : "";
  const canAgentCancel = () =>
    props.node.status === "running" && !!props.agentSessionID && !!props.onAgentCancel;

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
    const choice = await showAppDialog({
      title: t("card.rewind_confirm.title"),
      message: t("card.rewind_confirm.message"),
      select: true,
      selectValue: "view",
      selectOptions: [
        { value: "view", label: t("card.rewind_confirm.audit_only") },
        { value: "worktree", label: t("card.rewind_confirm.with_worktree") },
      ],
      okLabel: t("card.rewind_confirm.apply"),
      cancel: true,
      cancelLabel: t("common.cancel"),
    });
    if (!choice.confirmed || !choice.value) return;
    setRewinding(true);
    try {
      await props.onRewind(props.node.time, props.node.id, { resetWorktree: choice.value === "worktree" });
    } finally {
      setTimeout(() => setRewinding(false), 800);
    }
  };

  const onAgentCancel = async (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    if (!props.agentSessionID || !props.onAgentCancel || agentCancelling()) return;
    setAgentCancelling(true);
    try {
      await props.onAgentCancel(props.agentSessionID);
    } finally {
      setTimeout(() => setAgentCancelling(false), 800);
    }
  };

  return (
    <div
      class="card__head"
      classList={{ "card__head--with-meta": hasSecondaryText() }}
      role={props.collapsible ? "button" : undefined}
      tabindex={props.collapsible ? 0 : undefined}
      aria-expanded={props.collapsible ? props.expanded : undefined}
      onClick={() => {
        if (!props.collapsible || props.expanded) return;
        props.onExpand();
      }}
      onKeyDown={(e) => {
        if (!props.collapsible || props.expanded) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onExpand();
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
          <Show when={stepRevisionLabel()} fallback={
            <Show when={(props.node.round ?? 0) > 0}>
              <span class="card__round card__round--lead">#{props.node.round}</span>
            </Show>
          }>
            <span class="card__round card__round--lead">{stepRevisionLabel()}</span>
          </Show>
          <span class="card__title">{t(props.node.title)}</span>
          <Show when={(() => {
            const start = props.node.time;
            const end = props.node.timeCompleted;
            if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
            return (end as number) > (start as number);
          })()}>
            <span
              class="card__duration"
              title={t("card.duration_tooltip", {
                value: formatDuration((props.node.timeCompleted as number) - props.node.time),
              })}
              onClick={(e) => e.stopPropagation()}
            >
              {formatDuration((props.node.timeCompleted as number) - props.node.time)}
            </span>
          </Show>
          <Show when={props.node.subtitle}>
            <span class="card__subtitle" title={props.node.subtitle}>{props.node.subtitle}</span>
          </Show>
          <Show when={props.node.status === "error" && !!props.node.errorReason}>
            <button
              type="button"
              class="card__error-reason"
              classList={{ "card__error-reason--copied": copied() }}
              title={t("card.error_reason_title", { reason: props.node.errorReason || "" })}
              aria-label={t("card.error_reason", { reason: props.node.errorReason || "" })}
              onClick={async (e) => {
                e.stopPropagation();
                const reason = props.node.errorReason || "";
                if (!reason) return;
                const ok = await writeClipboard(reason);
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {props.node.errorReason}
            </button>
          </Show>
          <span class="card__title-spacer" aria-hidden="true" />
        </div>
        <Show when={collapsedPreview()}>
          <div class="card__preview-row">
            <span class="card__collapsed-preview" title={collapsedPreview()}>{collapsedPreview()}</span>
          </div>
        </Show>
        <Show when={todoSummary()}>
          {(summary) => (
            <div
              class="card__todo-summary"
              title={`${summary().completed}/${summary().total} done${summary().current ? ` · ${summary().current}` : ""}`}
            >
              <span
                class="card__todo-progress"
                role="progressbar"
                aria-valuenow={summary().completed}
                aria-valuemin={0}
                aria-valuemax={summary().total}
                style={{ "--pct": `${todoProgressPct()}%` }}
              />
              <span class="card__todo-count">
                {summary().completed}/{summary().total}
              </span>
              <Show when={summary().current}>
                <span class="card__todo-current">{summary().current}</span>
              </Show>
            </div>
          )}
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
        <Show when={(() => {
          const u = props.node.usage;
          if (!u) return false;
          return (u.totalTokens ?? 0) > 0 || (u.costUSD ?? 0) > 0;
        })()}>
          {(_) => {
            const u = () => props.node.usage!;
            const totalLabel = () => {
              const t = u().totalTokens ?? 0;
              const inT = u().inputTokens ?? 0;
              const outT = u().outputTokens ?? 0;
              if (t > 0) return formatTokenCount(t);
              if (inT > 0 || outT > 0) return formatTokenCount(inT + outT);
              return "";
            };
            const costLabel = () => {
              const c = u().costUSD ?? 0;
              return c > 0 ? formatCostUSD(c) : "";
            };
            const tip = () => {
              const u_ = u();
              const parts: string[] = [];
              if ((u_.inputTokens ?? 0) > 0) parts.push(`↑ ${u_.inputTokens} in`);
              if ((u_.outputTokens ?? 0) > 0) parts.push(`↓ ${u_.outputTokens} out`);
              if ((u_.totalTokens ?? 0) > 0) parts.push(`Σ ${u_.totalTokens} total`);
              if ((u_.costUSD ?? 0) > 0) parts.push(formatCostUSD(u_.costUSD!));
              return parts.join(" · ");
            };
            return (
              <span class="card__usage-hint" title={tip()} onClick={(e) => e.stopPropagation()}>
                <Show when={totalLabel()}>
                  <span class="card__usage-tokens">{totalLabel()} tok</span>
                </Show>
                <Show when={costLabel()}>
                  <span class="card__usage-cost">{costLabel()}</span>
                </Show>
              </span>
            );
          }}
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
            <Show when={copied()} fallback={<Icon name="copy" size={13} />}>
              <Icon name="check" size={13} />
            </Show>
          </button>
        </Show>
        <Show when={!!props.traceSessionID && !!props.onTrace}>
          <button
            type="button"
            class="card__trace"
            classList={{ "card__trace--open": !!props.traceOpen }}
            title={t("card.inspect_agent_trace")}
            aria-label={t("card.inspect_agent_trace")}
            aria-pressed={!!props.traceOpen}
            onClick={(e) => {
              e.stopPropagation();
              props.onTrace?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                props.onTrace?.();
              }
            }}
          >
            <Icon name="inspect" size={13} />
          </button>
        </Show>
        <Show when={canAgentCancel()}>
          <button
            type="button"
            class="card__agent-cancel"
            classList={{ "card__agent-cancel--pending": agentCancelling() }}
            title={t("card.agent_cancel")}
            aria-label={t("card.agent_cancel")}
            disabled={agentCancelling()}
            onClick={onAgentCancel}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void onAgentCancel(e);
              }
            }}
          >
            <Icon name="cancel" size={13} />
          </button>
        </Show>
        <Show when={canRewind()}>
          <button
            type="button"
            class="card__rewind"
            classList={{ "card__rewind--pending": rewinding() }}
            title={t("card.rewind")}
            aria-label={t("card.rewind_step")}
            disabled={rewinding()}
            onClick={onRewind}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void onRewind(e);
              }
            }}
          >
            <Icon name="rewind" size={13} />
          </button>
        </Show>
      </div>
    </div>
  );
}
