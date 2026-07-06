---
expert_squad_display_prefix: Builtin
---

# Algorithm

Correctness, complexity, benchmark, and adversarial-case focused expert squad.

## Expert Contract

This squad treats "expert" as a falsifiable algorithm contract. An algorithm result is expert-grade only when it proves the exact claim being made:

1. Claim boundary: state the function, data shape, input domain, output guarantee, and numeric or ordering semantics that must hold.
2. Invariant model: name the invariants, monotonicity, conservation rules, recurrence, graph property, probabilistic assumption, or precision rule the implementation depends on.
3. Oracle and counterexample discipline: use a reference method, mathematical proof sketch, brute-force checker, property test, or independently derived expected values; include adversarial and boundary inputs that could falsify the claim.
4. Complexity account: tie time and memory bounds to input variables, selected data structures, and hot paths instead of asserting performance in prose.
5. Measurement proof: when performance matters, provide reproducible benchmark inputs, command, environment notes, and variance or threshold interpretation.
6. Implementation ownership: show the code path that owns the algorithm and remove or update obsolete branches touched by the change.
7. Acceptance proof: final evidence must connect implementation, tests, adversarial cases, and benchmark or proof obligations to the original claim.

Do not call an algorithm task expert-grade when it only passes happy-path examples, lacks a reference oracle, ignores precision or overflow behavior, claims complexity without measurement or reasoning, or verifies a narrower behavior than the requested algorithm.

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
- build: agents/build/system.md
- deep-research: agents/deep-research/system.md
- fact-check: agents/fact-check/system.md
- goal-workload-analyst: agents/goal-workload-analyst/system.md
- integrity: agents/integrity/system.md
- orchestrator: agents/orchestrator/system.md
