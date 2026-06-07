# Prompt contract single-source cleanup

Date: 2026-06-07

## Problem

Core prompts currently duplicate implementation contracts across role boundaries:

- `frontend-design-core.txt` owns the webpage replica implementation contract.
- `requirements-core.txt`, `architect-core.txt`, and integrity prompts repeat concrete web-clone file lists, phase algorithms, and maintainability rejection details.
- `integrity-core.txt` plus `acceptance-review-core.txt` are catalog defaults only, while the live integrity runner uses `integrity-team-core.txt`.
- `orchestrator-core.txt` repeats fact-check verdict handling and bash schema rejection details that already belong to the fact-check prompt and bash tool schema.

This creates prompt double sources and a catalog/runtime mismatch.

## Call-point inventory

| Surface | Grep evidence | Decision |
| --- | --- | --- |
| `integrity-core.txt` | Imported by `src/agent/agent.ts`, read by prompt tests only. Live integrity runner imports `integrity-team-core.txt`. | Delete as dead runtime prompt and point native defaults at `integrity-team-core.txt`. |
| `acceptance-review-core.txt` | Imported only by `src/agent/agent.ts`, listed by hygiene test inventory. | Delete with `integrity-core.txt`; acceptance is owned by the team integrity prompt/tool. |
| `integrity-team-core.txt` | Imported by `src/integrity/team-agent.ts` and integrity prompt tests. | Keep as the single integrity prompt source. |
| `AgentRoleContract.integrity` | `promptEditable: true` exposes the stale catalog prompt. | Mark non-editable/host-owned so the catalog no longer advertises a separate editable default. |
| Web-clone tokens in non-owner prompts | `requirements-core.txt`, `architect-core.txt`, and integrity prompts contain `SourceDomPage`, `baseline_replacement_plan`, `source-ir/*`, and detailed source-package files. | Replace with references to frontend-design decision keys and contract ids; keep implementation details in `frontend-design-core.txt`. |
| Orchestrator fact-check handling | `orchestrator-core.txt` repeats full fact-check verdict routing. | Collapse to a pointer: fact-check owns verdict semantics; orchestrator consumes returned recommended actions. |
| Orchestrator bash schema rejection | `orchestrator-core.txt` repeats the schema's negative token list. | Keep merge-scope policy only; leave exact schema rejection list in `orchestrator/tools.ts`. |

## Implementation plan

1. Use `integrity-team-core.txt` as the only native integrity default.
2. Delete the retired integrity and acceptance review prompt files.
3. Decontaminate requirements, architect, integrity, and orchestrator prompts by replacing copied policies with owner references.
4. Update prompt hygiene and role-contract tests to assert the new single-source boundaries.
5. Run targeted prompt/agent tests before committing.
