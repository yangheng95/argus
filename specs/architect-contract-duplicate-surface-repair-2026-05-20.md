# Architect Contract Duplicate Surface Repair - 2026-05-20

## Evidence

- Task `tsk_e442da414001gcnrckoOwUXomM` produced one `architect_contract_graph` artifact with 13 contracts.
- The architect did not restart as a whole. In one architect session it first registered three useful contracts, then repeatedly registered the same audit report surface under new ids.
- The trigger was a legitimate `register_dependency_contract(reason="contract")` rejection: the referenced contract had `consumer_goal_ids: []`, so it did not belong to the requested edge.
- After that rejection, `register_contract` accepted new ids such as `contract_audit_report_v2`, `contract_gap_report`, and `contract_gap_linked` for the same producer/name/artifact surface.

## Call Points Checked

`rg -n "register_contract|register_dependency_contract|architect_contract_graph|register_goal|modify_goal|validateArchitectContractGraph" packages/opencorvus/src packages/opencorvus/test specs -S`

Relevant implementation points:

- `packages/opencorvus/src/architect/output-tools.ts`: `register_contract` mutates the collector and currently overwrites only by exact id.
- `packages/opencorvus/src/architect/output-tools.ts`: `register_dependency_contract` rejects edge mismatch but its repair hint does not say to re-register the same contract id with corrected `consumer_goal_ids`.
- `packages/opencorvus/src/architect/contract-graph.ts`: graph validation already rejects duplicate ids and edge mismatches after collection.
- `packages/opencorvus/test/architect/output-tools.test.ts`: existing coverage rejects unknown and edge-mismatched dependency contracts, but not semantic duplicate contract surfaces.

## Fix

1. Add a single semantic identity helper in `architect/output-tools.ts` for `register_contract`.
2. If a new contract has a different id but the same producer, kind, name, artifact paths, and route/component/IR surface as an existing contract, reject it without mutating the collector.
3. The rejection must instruct the agent to re-register the existing id to overwrite it when the intended repair is changing `consumer_goal_ids`.
4. Improve the dependency edge mismatch message to point at the same repair path.
5. Add focused tests for both behaviours.
