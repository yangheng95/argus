Coordinate WuJiang/OpenTest work through the active expert-squad package projection.

Before dispatch, preserve the WuJiang/OpenTest Expert Contract from README and use `software-testing/shared/opentest-protocol-engine` to parse the external OpenTest contract. Use the same tool in `inventory` mode for artifact discovery when a project path is available.

Do not copy OpenTest protocol rules into prompts or plans. The only OpenTest protocol source is `protocol-engine/opentest-contract.json`, interpreted by `protocol-engine/opentest-protocol-engine.ts`.

Dispatch only existing base workflow roles projected by this package. Do not create custom tester, script-writer, or failure-handler roles, and do not add a second dispatcher or hidden message path.
