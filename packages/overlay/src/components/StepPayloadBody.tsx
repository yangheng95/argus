// ── StepPayloadBody ──
// Single renderer for a workflow step's structured content: plan nodes,
// evaluation checks, verdict, and summary.
//
// Deliberately does NOT render the "Open session" button — that's a
// sidebar-only affordance (the main conversation IS the session, so the
// button would be redundant and the sidebar-tuned styling looks out of
// place there). The sidebar Goals panel renders its own button next to
// this component.

import { For, Show } from "solid-js"
import type { StepPayload } from "../utils/card-tree"
import { statusIconName } from "../utils/status-mapping"
import { Icon } from "./Icon"
import { StaticTextPart } from "./TextPart"

function verdictClass(verdict: string): string {
  if (verdict === "accepted") return "gwg-verdict--accepted"
  if (verdict === "rejected") return "gwg-verdict--rejected"
  return "gwg-verdict--inconclusive"
}

export function StepPayloadBody(props: { payload: StepPayload | undefined; stepID: string }) {
  const hasPlanNodes = () => !!props.payload?.planNodes?.length
  const hasChecks = () => !!props.payload?.checks?.length

  return (
    <Show when={props.payload}>
      <div class="step-payload">
        {/* Plan nodes */}
        <Show when={hasPlanNodes()}>
          <div class="gwg-plan-nodes">
            <For each={props.payload!.planNodes}>
              {(node) => (
                <div class="gwg-plan-node">
                  <div class="gwg-plan-node-title">
                    <StaticTextPart text={node.title} />
                  </div>
                  <Show when={node.brief}>
                    <div class="gwg-plan-node-brief">
                      <StaticTextPart text={node.brief} />
                    </div>
                  </Show>
                  <Show when={node.fileActions && node.fileActions.length > 0}>
                    <div class="gwg-plan-node-brief">
                      <StaticTextPart
                        text={`Planned file actions:\n${(node.fileActions ?? []).map((item) => `- ${item.path}: ${item.intent}`).join("\n")}`}
                      />
                    </div>
                  </Show>
                  <Show when={node.verificationCommands && node.verificationCommands.length > 0}>
                    <div class="gwg-plan-node-brief">
                      <StaticTextPart
                        text={`Planner verification commands:\n${(node.verificationCommands ?? []).map((item) => `- ${item.command} — ${item.purpose}`).join("\n")}`}
                      />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        {/* Eval verdict + summary + checks */}
        <Show when={props.payload?.verdict}>
          <div class={`gwg-verdict ${verdictClass(props.payload!.verdict!)}`}>{props.payload!.verdict}</div>
        </Show>
        <Show when={props.payload?.evalSummary}>
          <div class="gwg-eval-summary">
            <StaticTextPart text={props.payload!.evalSummary!} />
          </div>
        </Show>
        <Show when={hasChecks()}>
          <div class="gwg-checks">
            <For each={props.payload!.checks}>
              {(check) => (
                <div class="gwg-check" data-check-status={check.status}>
                  <span class="gwg-check-icon" aria-hidden="true">
                    <Icon name={statusIconName(check.status)} />
                  </span>
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
  )
}
