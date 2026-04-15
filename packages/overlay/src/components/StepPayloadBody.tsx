// ── StepPayloadBody ──
// Single renderer for a workflow step's structured payload. Used by both the
// main conversation (via Card) and the sidebar Goals panel (via
// GoalWorkflowGroup) so per-step detail (plan nodes / changed files /
// diffstats / eval checks / verdict / executor session link) is emitted from
// one place — no drift between the two surfaces.

import { For, Show } from "solid-js";
import type { StepPayload } from "../utils/card-tree";
import { t } from "../utils/i18n";
import { openExecutorSessionDialog } from "../services/dialog";

function verdictClass(verdict: string): string {
  if (verdict === "accepted") return "gwg-verdict--accepted";
  if (verdict === "rejected") return "gwg-verdict--rejected";
  return "gwg-verdict--inconclusive";
}

function checkStatusIcon(status: string): string {
  if (status === "passed") return "\u2713";
  if (status === "failed") return "\u2717";
  return "\u00B7";
}

function checkStatusClass(status: string): string {
  if (status === "passed") return "gwg-check--passed";
  if (status === "failed") return "gwg-check--failed";
  return "gwg-check--pending";
}

export function StepPayloadBody(props: {
  payload: StepPayload | undefined;
  stepID: string;
  goalTitle?: string;
}) {
  const hasPlanNodes = () => !!props.payload?.planNodes?.length;
  const hasChangedFiles = () => !!props.payload?.changedFiles?.length;
  const hasDiffStats = () => props.payload?.diffStats?.files !== undefined;
  const hasChecks = () => !!props.payload?.checks?.length;
  const hasOpenSession = () =>
    props.stepID === "execute" && !!props.payload?.executorSessionID;

  return (
    <Show when={props.payload}>
      <div class="step-payload">
        {/* Plan nodes */}
        <Show when={hasPlanNodes()}>
          <div class="gwg-plan-nodes">
            <For each={props.payload!.planNodes}>
              {(node) => (
                <div class="gwg-plan-node">
                  <div class="gwg-plan-node-title">{node.title}</div>
                  <Show when={node.brief}>
                    <div class="gwg-plan-node-brief">{node.brief}</div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Changed files + diff stats */}
        <Show when={hasChangedFiles() || hasDiffStats()}>
          <div class="gwg-changed-files">
            <Show when={hasDiffStats()}>
              <div class="gwg-diff-stats">
                <span class="gwg-diff-files">{props.payload!.diffStats!.files} files</span>
                <Show when={props.payload!.diffStats!.additions !== undefined}>
                  <span class="gwg-diff-additions">+{props.payload!.diffStats!.additions}</span>
                </Show>
                <Show when={props.payload!.diffStats!.deletions !== undefined}>
                  <span class="gwg-diff-deletions">-{props.payload!.diffStats!.deletions}</span>
                </Show>
              </div>
            </Show>
            <For each={props.payload!.changedFiles}>
              {(file) => <div class="gwg-changed-file">{file}</div>}
            </For>
          </div>
        </Show>

        {/* Open executor session */}
        <Show when={hasOpenSession()}>
          <div class="gwg-open-session">
            <button
              type="button"
              class="gwg-open-session-btn"
              onClick={(e) => {
                e.stopPropagation();
                void openExecutorSessionDialog(
                  props.payload!.executorSessionID!,
                  props.goalTitle ?? "",
                );
              }}
            >
              {t("goal.open_session")}
            </button>
          </div>
        </Show>

        {/* Eval verdict + summary + checks */}
        <Show when={props.payload?.verdict}>
          <div class={`gwg-verdict ${verdictClass(props.payload!.verdict!)}`}>
            {props.payload!.verdict}
          </div>
        </Show>
        <Show when={props.payload?.evalSummary}>
          <div class="gwg-eval-summary">{props.payload!.evalSummary}</div>
        </Show>
        <Show when={hasChecks()}>
          <div class="gwg-checks">
            <For each={props.payload!.checks}>
              {(check) => (
                <div class={`gwg-check ${checkStatusClass(check.status)}`}>
                  <span class="gwg-check-icon">{checkStatusIcon(check.status)}</span>
                  <span class="gwg-check-name">{check.name}</span>
                  <Show when={check.evidence}>
                    <span class="gwg-check-evidence">{check.evidence}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
