# Mission Dispatch Verbatim User Input - 2026-06-06

## Trigger

Mission-created tasks can drift when Mission compresses the user's original request into its own task brief. New Mission-dispatched engine tasks must quote the task-relevant original user input verbatim inside `panel.create_task.request` so downstream requirements, architect, build, and integrity stages audit the real request instead of Mission's paraphrase.

## Grep Coverage

| Surface | Findings | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/prompt/core/mission-core.txt` | The `panel.create_task` section requires a complete request but does not require verbatim original user input. | Add the contract here: every Mission-created task request must include an `Original user input` section with task-relevant user text quoted verbatim. |
| `packages/opencorvus/src/tool/panel.ts` | `panel.create_task` already uses `ctx.extra.originalText` for control-plane callers and stamps Mission provenance from session metadata. Mission tool calls do not carry a host-side original text source. | Do not add a host-side gate or parallel request builder. This is a Mission dispatch prompt contract, not a generic panel mutation change. |
| `packages/opencorvus/src/control/message.ts` | ControlMessage passes `originalText: input.text` into panel tool context. | Leave unchanged; ordinary panel/channel task creation already has a source-preserving path. |
| `packages/opencorvus/src/panel/capability.ts` | `create_task` is the shared capability schema and description for all surfaces. | Leave generic schema unchanged to avoid mission-only policy leaking into panel UI, channel, and right-sidebar assistant callers. |
| `packages/opencorvus/test/agent/agent.test.ts` | Existing Mission test validates coordinator prompt boundaries and task granularity. | Extend it to assert the verbatim user-input dispatch contract. |

## Contract

When Mission calls `panel action=create_task`, `request` must contain:

- a short task brief and mission background;
- a heading named `Original user input`;
- verbatim quote block(s) or exact substrings from the user's task-relevant messages;
- acceptance criteria and output expectations.

Mission may omit unrelated conversation, but it must not paraphrase the task-relevant user text it passes downstream.
