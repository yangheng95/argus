# Prism source dispatch input stability

## Recall

- Continue the real Prism Mission on 6888 and repair evidence, path, persistence, repeated-tool, pollution, and deadlock defects.
- Keep Expert Squad domain policy inside the Expert Squad package; do not add it to core.
- A single corrected model-tool input is tolerated, but repeated invalid dispatch construction is a defect.
- Preserve unrelated work and add no gate, fallback, compatibility, retry, or host routing rule.

## Evidence and cause

In canonical-database Mission `c3c74a65eaf04ed7`, Orchestrator Session `ses_06473971cffeA6iFFGo3okUD7r` emitted two consecutive invalid source-research dispatches:

1. part `prt_f9b8ca3a0001BmHnbx1dZp58aq` sent `source_urls: null`;
2. part `prt_f9b8cf1ff001kt9zDPPHqcgGmg` corrected the URL but sent `focus` as an array.

Both were rejected by the real `dispatch_agent` schema before creating a worker. The third call, part `prt_f9b8d446a001ewJhn0bxQhBUIF`, used a non-empty URL array and scalar focus and started exactly one researcher. The shared tool schema is correct; the Prism Orchestrator prompt describes the source node semantically but does not state the two polymorphic dispatch fields' required shapes for this target.

## Call-point scan

Repository scans covered `source_urls`, `focus`, `dispatch_agent`, the Prism Orchestrator system prompt, Mission collaboration references, package tests, shared dispatch adapter, and core prompt. The shared adapter and core prompt have unrelated parallel modifications and are not changed. The repair belongs solely to `expert-squads/mirror/prism/agents/orchestrator/system.md`, with its package contract test.

## Repair and acceptance

State in the Prism Orchestrator prompt that `mirror-prd-general-researcher` receives a non-empty URL-string array and one scalar focus string, never null or array-valued focus. This is model-visible package guidance, not a host gate. The current successful Mission remains running; the prompt repair applies after the package is rebuilt/reinstalled for later Tasks.
