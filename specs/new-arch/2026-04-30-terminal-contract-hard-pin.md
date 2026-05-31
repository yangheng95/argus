# 2026-04-30 Terminal Contract Hard Pin

## Evidence

Live build attempts failed with `TerminalToolMissingError`:

- `finish=stop`
- text prose summary was emitted
- no terminal build tool was called
- the later `BuildResultSchema.safeParse(undefined)` was secondary because the collector had no result

The shared session loop already detects this class of failure, but the outgoing `toolChoice` only uses `"required"` for terminal collector tools. Kimi on DashScope can ignore `"required"` and stop with prose, so the protocol needs a named terminal tool once the collector has enough facts to close.

## Exhaustive Grep

Commands run before design:

- `rg -n "terminalTool|report_build_passed|report_build_failed|forceTerminalTool|allowHardPin|TerminalToolMissingError|StructuredOutputError|structuredOutputToolChoice|terminalToolChoice" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md"`
- `rg -n "submit_requirements|submit_architect|submit_integrity_review|register_requirement|register_goal|submit_.*_verdict" packages/opencorvus/src/requirements packages/opencorvus/src/architect packages/opencorvus/src/integrity -g "*.ts"`
- `rg -n "report_build_passed|report_build_failed|report_build_result|terminalTool\\?|toolNames\\?|allowHardPin|forceTerminalTool|forceStructuredOutput|structuredOutputToolChoice\\(|terminalToolChoice\\(" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md" -g "*.txt"`

| Call point | Current role | Decision |
| --- | --- | --- |
| `session/loop.ts::TerminalToolContract.toolNames` | lets build describe two terminal tools | delete; terminal contract has one named terminal tool |
| `session/loop.ts::TerminalToolContract.allowHardPin` | disables named pin for build | delete; readiness decides whether named pin is valid |
| `session/loop.ts::terminalToolChoice` | returns `"required"` unless unused force flag is true | replace with readiness-based choice |
| `session/loop.ts::structuredOutputToolChoice` | has unused `forceStructuredOutput` option | delete option; structured output still uses `"required"` because work tools can precede final schema output |
| `agent/runner.ts::terminalTool.toolNames` | passes multi-name terminal contract | delete |
| `agent/runner.ts::terminalTool.allowHardPin` | passes dead hard-pin veto | delete |
| `requirements/agent.ts` | terminal tool after requirement collection | keep `submit_requirements`; add readiness from collector facts |
| `architect/agent.ts` | terminal tool after goal graph collection | keep `submit_architect`; add readiness from collector facts |
| `integrity/agent.ts` | terminal tool after all dimension verdicts | keep `submit_integrity_review`; add readiness from collector facts |
| `build/agent.ts` | two terminal tools discriminate passed/failed | replace with one `report_build_result` tool whose payload has `status` |
| `prompt/core/build-core.txt` | instructs two build terminal tools | update to single terminal tool |
| `test/session/terminal-tool-recovery.test.ts` | locks old force and two-tool behavior | update to readiness hard-pin behavior |
| `test/agent/visible-brief-hygiene.test.ts` | forbids old visible protocol string | update forbidden snippet |

## Design

Terminal collector tools have two distinct phases:

1. Work phase: collector facts are not ready. The loop sends `toolChoice: "required"` so the model can call any available work tool.
2. Finalization phase: collector facts are ready but the terminal contract is not satisfied. The loop sends `{ type: "tool", toolName }`.

The phase boundary is not a retry counter or a hidden state machine. It is derived from the collector:

- requirements: at least one requirement is registered
- architect: at least two goals are registered; the named terminal `submit_architect` call itself must supply decomposition analysis
- integrity: every dimension verdict is registered
- build: merge has succeeded for pass; failure can still be reported through `"required"` before merge

Build had two terminal tools, which made named pin unsafe. The replacement is a single `report_build_result` tool with `status: "passed" | "failed"`. The pass branch keeps the existing merge gate. The failed branch records the concrete blocker.

Structured output is not changed into unconditional named pin in this pass. Intent analysis and frontend design may need work tools before final schema output, and there is no collector readiness predicate for those agents yet. The dead `forceStructuredOutput` parameter is removed so there is no pretend hard-pin path.

## Verification

- Unit test terminal tool choice: not ready -> `"required"`, ready -> named pin, satisfied -> `undefined`, missing tool -> `undefined`.
- Unit test structured output choice no longer accepts force options.
- Agent tests assert terminal readiness predicates.
- Build tests and prompt hygiene tests use `report_build_result`.
- Run targeted tests, then typecheck.
