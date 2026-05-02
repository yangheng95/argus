import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { boardStore } from "../store/board";
import { cardTreeStore } from "../store/card-tree";
import { fetchTaskTrace, invalidateTraceCache } from "../services/trace";
import { buildAgentWorkflow, type AgentWorkflowRecord } from "../utils/agent-workflow";
import { orderedReachableCardIDs } from "../utils/card-tree";
import { agentStageLabel } from "../utils/message";
import { t } from "../utils/i18n";

function formatClock(ms: number | undefined): string {
  if (!Number.isFinite(ms || 0) || !ms) return "-";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function compactSessionID(sessionID: string): string {
  if (!sessionID) return "-";
  return sessionID.length > 10 ? sessionID.slice(-10) : sessionID;
}

function durationLabel(record: AgentWorkflowRecord): string {
  const end = record.completedAt || record.report?.ts || 0;
  if (!record.startedAt || !end || end <= record.startedAt) return "";
  const seconds = Math.round((end - record.startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain === 0 ? `${minutes}m` : `${minutes}m ${remain}s`;
}

function reportTitle(record: AgentWorkflowRecord): string {
  return `${agentStageLabel(record.agentName)} · ${compactSessionID(record.sessionID)}`;
}

function recordSummary(record: AgentWorkflowRecord): string {
  return record.report?.summary || t("agent_workflow.no_report");
}

function statusGlyph(status: AgentWorkflowRecord["status"]): string {
  if (status === "completed") return "ok";
  if (status === "error") return "!";
  if (status === "running") return "..";
  if (status === "skipped") return "-";
  return "*";
}

export function AgentWorkflowPanel() {
  const taskID = createMemo(() => boardStore.selectedTaskID || boardStore.board?.task?.id || "");
  const [refreshTick, setRefreshTick] = createSignal(0);
  const [selected, setSelected] = createSignal<AgentWorkflowRecord | null>(null);
  const [trace] = createResource(
    () => ({ taskID: taskID(), tick: refreshTick() }),
    async ({ taskID, tick }) => {
      if (!taskID) return { events: [], traceDir: "", enabled: true };
      return fetchTaskTrace(taskID, { force: tick > 0 });
    },
  );
  const projection = createMemo(() =>
    buildAgentWorkflow({
      cards: cardTreeStore.cards,
      order: orderedReachableCardIDs(),
      traceEvents: trace()?.events || [],
    }),
  );
  const records = createMemo(() => projection().records);
  const stacks = createMemo(() => projection().stacks);
  const traceEnabled = createMemo(() => trace()?.enabled !== false);

  const refresh = () => {
    const id = taskID();
    if (id) invalidateTraceCache({ taskID: id });
    setRefreshTick((v) => v + 1);
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    if (timer) clearInterval(timer);
    if (!taskID()) return;
    timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, 5_000);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  return (
    <section class="agent-workflow-panel" aria-label={t("agent_workflow.title")}>
      <header class="agent-workflow-toolbar">
        <div class="agent-workflow-heading">
          <span class="agent-workflow-title">{t("agent_workflow.title")}</span>
          <span class="agent-workflow-count">
            {t("agent_workflow.count", { count: String(records().length) })}
          </span>
        </div>
        <button
          type="button"
          class="agent-workflow-refresh"
          title={t("agent_workflow.refresh")}
          onClick={refresh}
        >
          {trace.loading ? t("common.loading") : t("common.refresh")}
        </button>
      </header>

      <Show when={trace.loading && records().length === 0}>
        <div class="agent-workflow-empty">{t("agent_workflow.loading")}</div>
      </Show>

      <Show when={!traceEnabled()}>
        <div class="agent-workflow-warning">{t("agent_workflow.trace_disabled")}</div>
      </Show>

      <Show when={!trace.loading && records().length === 0}>
        <div class="agent-workflow-empty">{t("agent_workflow.empty")}</div>
      </Show>

      <div class="agent-workflow-canvas" role="list">
        <For each={stacks()}>
          {(stack, stackIndex) => (
            <div
              class="agent-workflow-row"
              role="listitem"
              style={{ "--workflow-depth": String(Math.min(stack.depth, 6)) }}
              data-stacked={stack.records.length > 1 ? "true" : "false"}
            >
              <div class="agent-workflow-rail" aria-hidden="true">
                <span class="agent-workflow-orb">
                  {String(stackIndex() + 1).padStart(2, "0")}
                </span>
                <svg class="agent-workflow-beam" viewBox="0 0 28 104" preserveAspectRatio="none">
                  <path class="agent-workflow-beam-base" d="M14 0 C14 28 4 30 4 52 C4 74 14 76 14 104" />
                  <path class="agent-workflow-beam-flow" d="M14 0 C14 28 4 30 4 52 C4 74 14 76 14 104" />
                </svg>
              </div>
              <div
                class="agent-workflow-stack"
                style={{
                  "--stack-size": String(stack.records.length),
                  "--stack-pad": `${Math.min(Math.max(stack.records.length - 1, 0), 3) * 7}px`,
                }}
              >
                <For each={stack.records}>
                  {(record, index) => (
                    <button
                      type="button"
                      class="agent-workflow-card"
                      data-status={record.status}
                      data-stack-index={index()}
                      style={{
                        "--stack-index": String(index()),
                        "--stack-offset": `${Math.min(index(), 3) * 7}px`,
                      }}
                      onClick={() => setSelected(record)}
                    >
                      <span class="agent-workflow-card-head">
                        <span class="agent-workflow-agent-wrap">
                          <span class="agent-workflow-status-dot" aria-hidden="true">
                            {statusGlyph(record.status)}
                          </span>
                          <span class="agent-workflow-agent">{agentStageLabel(record.agentName)}</span>
                        </span>
                        <span class="agent-workflow-time">{formatClock(record.startedAt)}</span>
                      </span>
                      <span class="agent-workflow-card-body">
                        {recordSummary(record)}
                      </span>
                      <span class="agent-workflow-card-foot">
                        <span class="agent-workflow-session">{compactSessionID(record.sessionID)}</span>
                        <Show when={record.attempts > 1 || stack.records.length > 1}>
                          <span class="agent-workflow-attempt">
                            {t("agent_workflow.attempt", {
                              current: String(index() + 1),
                              total: String(Math.max(record.attempts, stack.records.length)),
                            })}
                          </span>
                        </Show>
                        <Show when={durationLabel(record)}>
                          <span>{durationLabel(record)}</span>
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={selected()}>
        {(record) => (
          <div
            class="agent-workflow-report-popover"
            role="presentation"
            onClick={(event) => {
              if (event.currentTarget === event.target) setSelected(null);
            }}
          >
            <article class="agent-workflow-report" role="dialog" aria-modal="true" aria-label={t("agent_workflow.report_title")}>
              <header class="agent-workflow-report-head">
                <div>
                  <h2>{reportTitle(record())}</h2>
                  <p>
                    {t("agent_workflow.report_meta", {
                      status: record().status,
                      time: formatClock(record().report?.ts || record().completedAt || record().startedAt),
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  class="agent-workflow-report-close"
                  title={t("common.close")}
                  aria-label={t("common.close")}
                  onClick={() => setSelected(null)}
                >
                  x
                </button>
              </header>
              <section class="agent-workflow-report-section">
                <h3>{t("agent_workflow.output_summary")}</h3>
                <p>{recordSummary(record())}</p>
              </section>
              <Show when={record().model}>
                <section class="agent-workflow-report-section">
                  <h3>{t("agent_workflow.model")}</h3>
                  <p>{record().model}</p>
                </section>
              </Show>
              <section class="agent-workflow-report-section">
                <h3>{t("agent_workflow.output_report")}</h3>
                <pre>{record().report?.detail || t("agent_workflow.no_report")}</pre>
              </section>
            </article>
          </div>
        )}
      </Show>
    </section>
  );
}
