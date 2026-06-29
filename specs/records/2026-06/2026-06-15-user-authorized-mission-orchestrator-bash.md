# User-authorized Mission and Orchestrator command surface

Date: 2026-06-15

## Request

Give Mission and Orchestrator bash / run-command capability, but only for
responding to user needs. They must not use it without authorization.

## Callsite inventory

| Area                             | Evidence                                                                                                                                                               | Decision                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission tool whitelist           | `packages/opencorvus/src/agent/agent.ts` `mission.tools.include` excludes `bash`; `mission-core.txt` says Mission has no bash and must dispatch if it wants a command. | Add registry `bash` to Mission and prompt it as a user-authorized command evidence surface only.                                                                |
| Mission permission               | `mission.permission` allows coordination/read tools only.                                                                                                              | Add `bash: "allow"` so the included tool is usable under the built-in permission model.                                                                         |
| Orchestrator tool implementation | `packages/opencorvus/src/orchestrator/tools.ts` defines custom `bash` and `validateOrchestratorBashCommand`; currently git-only.                                       | Keep the existing single tool name `bash`; broaden validation from git-only to single-command shape guard. Do not create a second `run_command` implementation. |
| Orchestrator prompt              | `orchestrator-core.txt` has `Git Merge Repair Bash` and many git-only references.                                                                                      | Replace with `User-Authorized Bash`: allowed only when the latest user/operator request asks for command evidence or answering the request requires it.         |
| Integrity run_command            | `packages/opencorvus/src/integrity/acceptance-tools.ts` owns `run_command` for integrity reviewer evidence.                                                            | Do not reuse or duplicate it. Mission/Orchestrator use the existing `bash` surface; `run_command` remains integrity-specific.                                   |
| Tests                            | `agent.test.ts`, `role-contract.test.ts`, `core-prompt-hygiene.test.ts`, `orchestrator/bash-tool.test.ts` pin old exclusions/git-only scope.                           | Update them to assert user-authorized command scope and no generic execution bypass.                                                                            |

## Constraints

- No fallback / compatibility surface. There is one Mission command tool:
  registry `bash`; one Orchestrator command tool: custom `bash`.
- No host-side authorization state machine. The user's authorization boundary is
  a role contract/prompt constraint, because trying to infer user intent in host
  code would become a route gate and would be brittle.
- No code editing through Mission/Orchestrator bash. File mutations remain owned
  by Build or direct coding agents.
- No research/crawling/screenshots through bash. Use the existing specialist
  tools and dispatched tasks.

## Acceptance

- `Agent.get("mission")` includes `bash` and allows it.
- `Agent.get("orchestrator")` includes `bash`.
- Orchestrator bash accepts non-git single commands such as `npm test`, while
  still rejecting chained commands, pipelines, redirects, command substitution,
  embedded newlines, and host-killing patterns.
- Core prompts state that command execution is only for user-authorized command
  evidence and must not be used proactively or as an executor bypass.
