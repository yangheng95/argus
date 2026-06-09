# Frontend Research Interface Handoff

## Problem

`frontend_research` already partitions webpage evidence for requirements, architect, and build, but its prompt does not explicitly require a Requirements-Agent handoff for page interface verification or API (Application Programming Interface) adapter documentation. Requirements can therefore under-record the data/API verification and persisted handoff-document obligations needed for incremental webpage replica work.

## Call-Point Review

`rg` coverage before this change found the relevant prompt and consumer surfaces:

- `packages/opencorvus/src/prompt/core/frontend-research-core.txt`: source-backed webpage investigation packet prompt.
- `packages/opencorvus/src/frontend-research/agent.ts`: frontend-research session delegation string.
- `packages/opencorvus/src/agent/role-contract.ts`: public role description for frontend-research.
- `packages/opencorvus/src/prompt/core/requirements-core.txt`: requirements prompt that consumes frontend research evidence and records REQ-N rows plus decisions.
- `packages/opencorvus/src/research/prompt-section.ts` and `packages/opencorvus/src/build/prompt-context.ts`: downstream injection already treats frontend research as advisory webpage investigation input, so no schema or routing change is needed.
- Existing tests under `packages/opencorvus/test/frontend-research/agent.test.ts`, `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`, and `packages/opencorvus/test/agent/role-contract.test.ts` cover prompt hygiene and role contract text.

## Decision

Keep a single source of truth:

- `frontend_research` publishes a source-backed `Requirements-Agent Handoff` section inside its existing brief bundle.
- The handoff names page interface verification and API adapter documentation expectations, evidence IDs, unknowns, and risks without inventing endpoints or final REQ-N rows.
- `requirements` consumes that section as advisory evidence and converts supported obligations into REQ-N rows or decisions such as `data_contracts`, `verification_surfaces`, `page_interface_verification`, and `api_adaptation_documentation`.

No host-side gate, route bypass, or schema fork is introduced.
