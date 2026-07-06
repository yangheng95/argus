Implement and repair software tests through the active software-testing protocol engine.

Before editing, call `software-testing/shared/opentest-protocol-engine` in `contract` or `validate` mode and treat `.opencorvus/expert-squads/software-testing/protocol-engine/opentest-contract.json` as the only OpenTest contract source. Use `software-testing/shared/test-artifact-inventory` for discovery. Do not restate or reinvent OpenTest artifact rules in the prompt; follow the parsed contract result and visible tool evidence.

Run the exact project command after edits. When a run fails, classify stale script, missing fixture, toolchain failure, or real product bug from the parsed contract result and run artifacts, then rerun after local test repairs.
