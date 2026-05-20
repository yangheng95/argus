You are doing a READ-ONLY architecture decision review for the opencorvus
repo (cwd = repo root C:\Users\chuan\myhexin-local\opecorvus). Do NOT edit
files. Produce a definitive decision + an implementation contract.

CONTEXT: read specs/delivery-live-review-card-2026-05-19.md fully. It
documents: integrity review streams a live overlay card via
integrity.review.{started,progress,chunk,completed} events
(integrity/agent.ts → engine/model.ts schemas → tree-writer.ts
handleIntegrity* → IntegrityCard.tsx). Delivery verification
(delivery/service.ts DeliveryService.verify + delivery/agent.ts) runs
~20 min emitting NO during-run events, so the conversation has no deliver
card at all. We must give the WHOLE DeliveryService.verify span (manifest →
runtime → visual → specialist → delivery-agent) a live streaming card like
integrity's.

DECIDE between design A (parallel delivery.review.* family), B (fully
unified review.stream.* family, migrate integrity), C (share only the
streaming half — generic running review-session card + reasoning stream
with a `phase` tag — keep completed verdict bodies phase-specific).

Hard rules (CLAUDE.md, must obey): rule 8 no double source / no
compat-fallback; rule 9 abstract repeated design patterns, no copy-paste;
rule 5/6 no over-engineering, trust LLM, first-principles; rule 13 NO state
machines (no if/else/switch state enums for flow — but data-shape gates &
host gates are allowed); rule 16 no tech debt / delete old paths; rule 28/36
every change needs tests; constraint from
specs/delivery-fresh-eyes-decoupling-2026-05-18.md: delivery agent runs
blind, single business verdict artifact `delivery-agent-verdict` — the
streaming card MUST NOT add a second verdict source nor feed host-gate
conclusions into the agent prompt.

Investigate the real code to ground your answer (read at least:
packages/opencorvus/src/integrity/agent.ts emit path,
packages/opencorvus/src/engine/model.ts integrity schemas,
packages/opencorvus/src/delivery/service.ts,
packages/opencorvus/src/delivery/agent.ts,
packages/opencorvus/src/orchestrator/tools.ts deliver tool,
packages/overlay/src/services/tree-writer.ts integrity handlers,
packages/overlay/src/components/IntegrityCard.tsx, Card.tsx). rule 35:
enumerate ALL call sites / emitters / schema regs you would touch.

OUTPUT (write nothing to disk, just print):
1. DECISION: A | B | C (+ one-paragraph why, citing the rules).
2. Whether the shared streaming mechanism should also retrofit integrity
   (and the regression risk / how to keep integrity green).
3. IMPLEMENTATION CONTRACT: exact files + functions to add/modify, new
   event names + Zod schema shape + tiers, where emitters go inside
   DeliveryService.verify so the card covers the host-gate-only rejection
   path (not just the agent), tree-writer handler/card-id strategy, render
   component, i18n keys, and the test list (unit/e2e) per rule 28/36.
4. Any rule-8/9/13 trap in the obvious implementation and how to avoid it.
Be decisive and specific; this contract will be implemented verbatim.
