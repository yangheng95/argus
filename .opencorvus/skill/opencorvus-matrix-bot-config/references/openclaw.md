# OpenClaw and Matrix Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Matrix as experimental.
- Matrix channel is plugin-based in OpenClaw.
- Docs state polling mode (Matrix `/sync`) and do not require webhook setup.
- Docs support either access-token auth or username/password login flow.
- Example env names in docs use `MATRIX_HOMESERVER` and `MATRIX_ACCESS_TOKEN`.

## OpenCorvus mapping

OpenCorvus source of truth:
- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/matrix.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:
- Required: `MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN`
- Optional: `MATRIX_SINCE_TOKEN`
- Compatibility fallback: `OPENCLAW_MATRIX_HOMESERVER_URL`, `OPENCLAW_MATRIX_ACCESS_TOKEN`

Runtime notes:
- Adapter starts sync loop and tracks `next_batch` (`since`) state in memory.
- Adapter resolves own user id through `/_matrix/client/v3/account/whoami` to skip self messages.
- Outbound image is supported via Matrix media upload API.

## Differences to keep explicit

- OpenClaw docs mention token mode and username/password mode.
- OpenCorvus adapter currently supports token mode only.
- OpenClaw docs use `MATRIX_HOMESERVER`; OpenCorvus uses `MATRIX_HOMESERVER_URL`.

## Verification checklist

1. Start bot and confirm Matrix sync loop starts.
2. Send one room text message and confirm one reply.
3. Verify bot ignores its own events.
4. Optional: verify outbound image upload to Matrix media API.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Matrix docs: https://docs.openclaw.ai/channels/matrix
- Matrix client-server API docs: https://spec.matrix.org/latest/client-server-api/
