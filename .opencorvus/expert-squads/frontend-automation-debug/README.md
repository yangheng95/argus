---
expert_squad_display_prefix: Builtin
---

# Frontend Automation Debug

Frontend automation, browser runtime debugging, visual regression, and reproducible evidence focused expert squad.

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
