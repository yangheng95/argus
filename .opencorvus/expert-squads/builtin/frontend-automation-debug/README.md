---
expert_squad_display_prefix: Builtin
---

# Frontend Automation Debug

Frontend automation, browser runtime debugging, visual regression, and reproducible evidence focused expert squad.

## Expert Debug Contract

This squad treats "expert" as a falsifiable causal-debug standard. A frontend debug result is expert-grade only when it preserves the original failure path and explains the failure through this evidence chain:

1. Evidence anchor: exact command, page, interaction, selector, fixture/state, screenshot, trace, console or runtime error, network failure, preview target, or visual acceptance defect.
2. Reproduction: rerun the failure before repair when not already proven, or cite durable evidence that proves the same path.
3. Layered ownership: separate automation harness, browser runner, preview target, fixture/state, selector/assertion, component/service/style, runtime environment, and acceptance evidence.
4. Hypothesis discipline: list plausible causes, then state which evidence supports or rejects each one.
5. Causal chain: observable symptom -> direct trigger -> owning code or tool path -> deeper design or data-flow cause -> why prior or superficial fixes did not root-cause it.
6. Root repair: change the proven owner without fallback, broad sleeps, selector churn, route gates, compatibility aliases, or unrelated cleanup.
7. Proof and review: rerun the original path, add or update targeted regression evidence, include browser or screenshot proof for visible behavior, and perform a second review for false-green risk.

Do not call a task debugged when it only changed a selector, increased a timeout, silenced a console error, refreshed a preview, passed an unrelated typecheck, or explained the last terminal status without proving the causal chain.

## Agent Communication

The Orchestrator keeps visible selection and scheduling in the root session. Role agents consume only their own system prompt overlay from this package plus the shared OpenCorvus base prompt.

Package prompt overlays:

- coding: agents/coding/system.md
- coding-assistant: agents/coding-assistant/system.md
- general: agents/general/system.md
- explore: agents/explore/system.md
- mission: agents/mission/system.md
- intent-analysis: agents/intent-analysis/system.md
- requirements: agents/requirements/system.md
- architect: agents/architect/system.md
- frontend-design: agents/frontend-design/system.md
- frontend-research: agents/frontend-research/system.md
- build: agents/build/system.md
- visual-qa: agents/visual-qa/system.md
- deep-research: agents/deep-research/system.md
- fact-check: agents/fact-check/system.md
- goal-workload-analyst: agents/goal-workload-analyst/system.md
- integrity: agents/integrity/system.md
- orchestrator: agents/orchestrator/system.md
