# OpenClaw and Signal Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Signal as experimental.
- Signal channel is plugin-based in OpenClaw.
- Docs require external `signal-cli` environment and registered account.
- Docs include channel add/update commands with account and CLI path options.
- Docs do not rely on webhook setup as primary transport.

## OpenCorvus mapping

OpenCorvus source of truth:
- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/signal.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:
- Required: `SIGNAL_SERVICE_URL`, `SIGNAL_ACCOUNT`
- Compatibility fallback: `OPENCLAW_SIGNAL_SERVICE_URL`, `OPENCLAW_SIGNAL_ACCOUNT`

Runtime notes:
- Adapter expects a running signal REST service and polls `/v1/receive/<account>`.
- Outbound send uses `/v2/send`.
- Image output uses base64 attachments through the same send API.

## Differences to keep explicit

- OpenClaw docs discuss local CLI path and plugin workflow.
- OpenCorvus adapter targets a REST bridge service endpoint (`SIGNAL_SERVICE_URL`) instead of direct CLI invocation.

## Verification checklist

1. Ensure signal REST service is reachable at `SIGNAL_SERVICE_URL`.
2. Start bot and confirm Signal receive loop starts.
3. Send one Signal message and confirm one reply.
4. Optional: verify image attachment send path.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Signal docs: https://docs.openclaw.ai/channels/signal
- signal-cli REST bridge docs: https://github.com/bbernhard/signal-cli-rest-api
