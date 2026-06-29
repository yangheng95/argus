# Tool Pending Start Time Contract

Date: 2026-06-28
Status: Implemented and runtime-verified

## Failure

Overlay rendering still fails after the 2026-06-27 part `orderKey` repair:

```text
Error: tool part prt_f09f6b043001bud3iBjTG1VSFy start time missing positive timestamp
```

The live `message.part.updated` payload is now correctly split between the
owning message key and part key:

- `payload.orderKey`: `...:message:msg_f09f6a73e001WIMQXCqJchMyZj`
- `payload.part.orderKey`: `...:part:prt_f09f6b043001bud3iBjTG1VSFy`

The remaining malformed field is the tool lifecycle timestamp:

```json
"state": {
  "status": "pending",
  "input": {},
  "raw": ""
}
```

`toolToCardNode()` is correct to fail. The overlay duration source is the tool
part state, not event time, wall-clock render time, or a locally inferred
observation timestamp.

## Prior Constraints Recalled

| Record | Constraint |
| --- | --- |
| `2026-06-04-overlay-tool-agent-timer-single-source.md` | Tool cards render duration from `part.state.time.start/end`, not mount time. |
| `2026-06-27-persisted-tool-part-orderkey-hydrate-root-repair.md` | Frontend projection must keep requiring backend-owned part identity; missing fields are backend contract bugs. |
| `2026-06-27-message-card-orderkey-convergence.md` | Live/hydrate/replay message parts must be backend-derived and strict. |

## Call Point Inventory

Grep covered `ToolStatePending`, `tool-input-start`, `ensureToolPart`, `partFromToolCall`,
`state.status === "pending"`, and direct pending tool fixtures.

| Call point | Current behavior | Required behavior |
| --- | --- | --- |
| `session/message.ts::ToolStatePending` | Allows pending tool state without `time`. | Require `time.start` just like running tool state. |
| `session/processor.ts::tool-input-start` | Creates pending tool parts with no time. | Stamp `time.start` at first tool observation and preserve it on repeated starts. |
| `session/processor.ts::ensureToolPart` | Preserves start only for existing running parts. | Preserve existing pending or running start when promoting to running. |
| `session/processor.ts::tool-call` | Promotes pending to running with a new `Date.now()`. | Preserve the pending start. |
| `session/processor.ts::tool-result` / `tool-error` / lost-open failure | Pending terminalization uses a new `Date.now()`. | Preserve the pending start. |
| `session/loop.ts::metadata()` | Running metadata update resets `time.start`. | Preserve the running start. |
| SDK/OpenAPI generated `ToolStatePending` | Public type omits `time`. | Public contract requires `time.start`. |
| Direct pending tool fixtures | Some tests still build malformed pending tool parts. | Update only true `Message.ToolPart` fixtures. |

## Repair

- Make `ToolStatePending.time.start` required.
- Introduce one processor helper that reads start from any open tool part
  (`pending` or `running`) so every promotion/terminalization uses the same
  source.
- Stamp pending tool-input-start events with `time.start` before they reach the
  session bus / task bridge.
- Parse persisted transcript parts with `Message.VisiblePart` at the read
  boundary. Corrupt rows must fail in the backend with the offending part id
  and schema path instead of reaching the overlay renderer.
- Keep overlay strict; no frontend fallback is added.

## Runtime Evidence

The later report for `prt_f09ff42fb001wH6Kf6InoOTIy3` was not a missing source
call path. A read-only DB inspection showed both reported parts completed with
valid `state.time.start/end`; the renderer failure happened on the live pending
event emitted before completion. Process inspection showed the running overlay
sidecar was:

```text
C:\Users\chuan\AppData\Local\ai.opencorvus.overlay\embedded\sidecar-12072-29172b708c854654\opencorvus.exe
```

started at `2026-06-28 00:41:20 +08:00`, before this source repair. That
running process cannot load the source change until the overlay/sidecar is
rebuilt and restarted.

The same DB inspection found one pre-existing malformed pending row from the
old process:

```text
prt_f0a0eb5f0001MiYJI5b46kjblz
state.status = pending
state.time.start = missing
```

This is corrupted persisted data, not a valid runtime state. It must be removed
by an explicit data reset/cleanup decision; the renderer must not infer or patch
a start timestamp.

After the source repair, the Windows sidecar was rebuilt at:

```text
packages/opencorvus/dist/opencorvus-overlay-server-windows-x64/opencorvus.exe
```

and an isolated Tauri build was produced without replacing the currently
running overlay executable:

```text
packages/overlay/src-tauri/target-codex-repaired/release/opencorvus-overlay.exe
```

That build embeds sidecar stamp `sidecar-12072-e07811c69eede28c`. The still
running overlay is using AppData sidecar stamp `sidecar-12072-29172b708c854654`,
so it is definitively an older runtime. Final runtime verification requires
stopping the current overlay process, replacing or launching the repaired overlay
binary, and observing a new tool pending event from the new sidecar.

After the authorized overlay rebuild/restart, the running processes are:

```text
opencorvus-overlay.exe PID 37484
opencorvus.exe serve --hostname 127.0.0.1 --port 7878
embedded sidecar stamp sidecar-12072-260d6ffd38cc303e
```

`/global/health` reports the live database path:

```text
C:\Users\chuan\.local\share\opencorvus\opencorvus.db
```

A read-only SQLite scan of that DB found:

```text
pending tool parts: 0
tool parts checked: 3169
tool parts missing state.time.start: 0
legacy part prt_f0a0eb5f0001MiYJI5b46kjblz: completed with valid start/end
```

The old corrupt pending row is therefore not a current runtime residue.

## Acceptance

- `Message.ToolStatePending.safeParse({ status: "pending", input: {}, raw: "" })` fails.
- A `tool-input-start` live processor event writes a pending tool part with
  `state.time.start`.
- A pending tool part promoted to running/completed/error keeps the same start.
- The generated SDK/OpenAPI `ToolStatePending` contract requires `time.start`.
- `Session.messages()` rejects a persisted pending tool part that lacks
  `state.time.start` before it can be sent to the overlay.
- Overlay `toolToCardNode()` remains strict and receives well-formed pending
  tool parts from backend events.

## Verification

```bash
bun test --timeout 120000 packages/opencorvus/test/session/message.test.ts packages/opencorvus/test/session/part-delta.test.ts packages/opencorvus/test/session/session.test.ts packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts
bun test packages/overlay/test/tool-call-generation-stream.test.ts packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/status-labels.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/sdk/js build
bun run api:routes-check
bun run docs:check
```
