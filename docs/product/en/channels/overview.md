# Channels overview

`packages/channel-runtime/` is OpenCorvus's multi-IM ingress. Every external platform is abstracted to a **triple**:

```
platform : channel : thread
```

Each thread maps to one OpenCorvus session; all messages in a thread share the same task context.

## Supported 14 channels

| Channel                         | Adapter                      | Transport             |
| ------------------------------- | ---------------------------- | --------------------- |
| [Slack](./slack.md)             | `src/adapters/slack.ts`      | Socket Mode           |
| [Telegram](./telegram.md)       | `src/adapters/telegram.ts`   | Long polling          |
| [Discord](./discord.md)         | `src/adapters/discord.ts`    | Gateway WebSocket     |
| [Feishu / Lark](./feishu.md)    | `src/adapters/feishu.ts`     | Webhook               |
| [WhatsApp](./whatsapp.md)       | `src/adapters/whatsapp.ts`   | Webhook (WA Business) |
| [Google Chat](./googlechat.md)  | `src/adapters/googlechat.ts` | Webhook               |
| [Microsoft Teams](./msteams.md) | `src/adapters/msteams.ts`    | Webhook               |
| [LINE](./line.md)               | `src/adapters/line.ts`       | Webhook               |
| [Matrix](./matrix.md)           | `src/adapters/matrix.ts`     | Long polling          |
| [Mattermost](./mattermost.md)   | `src/adapters/mattermost.ts` | Webhook               |
| [Signal](./signal.md)           | `src/adapters/signal.ts`     | signal-cli REST       |
| [WeCom](./wecom.md)             | `src/adapters/wecom.ts`      | Webhook               |
| [DingTalk](./dingtalk.md)       | `src/adapters/dingtalk.ts`   | Webhook               |
| [QQ](./qq.md)                   | `src/adapters/qq.ts`         | QQ Bot                |

Registry: `packages/channel-config/src/index.ts` `ChannelCatalog`.

## Run channel-runtime

```bash
cd packages/channel-runtime
cp .env.example .env
bun run dev
```

`registerAdapters()` (`src/registry.ts:242`) auto-scans env and **starts only the channels with required tokens**; others are skipped. It does not crash when one channel is unconfigured.

## Backend comms

| Direction                    | Protocol         | Endpoints                                                                                                           |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| channel-runtime → OpenCorvus | HTTP REST (JSON) | `/session`, `/session/{sessionID}/prompt_async`, `/task`, `/task/{taskID}/message`, `/permission/{requestID}/reply` |
| OpenCorvus → channel-runtime | SSE              | `/event`                                                                                                            |

SDK: `@opencorvus-ai/sdk`.

Two modes:

1. **Embedded**: `createOpenCorvus()` launches the backend in-process.
2. **External**: `createOpenCorvusClient({ baseUrl })` connects to an existing `opencorvus serve`.

## Message flow (generic)

```
User posts on IM
  ↓
<Platform>Adapter.onMessage(IncomingMessage)
  ↓
ChannelRuntime.handleMessage()          [src/core.ts:235]
  ├─ audio → STTPipeline.transcribe()
  ├─ SessionCoordinator.get(threadKey)
  ├─ new thread → client.session.create()
  └─ client.session.promptAsync()

Backend processes → SSE pushes events back
  ↓
handleEvent(event)                      [src/core.ts:1132]
  ├─ task.report → safeSend() progress
  ├─ message.updated → text buffer → safeSend()
  ├─ part.updated(image) → uploadImage()
  └─ permission.asked → reply automatically or @ operator
```

## Adding a new channel

1. **Register** — add a `define({...})` entry to `ChannelCatalog` in `packages/channel-config/src/index.ts`; add the id to the `ChannelId` enum.
2. **Adapter** — implement the `ChannelAdapter` interface (`src/adapter.ts:9`): `start / stop / sendMessage / onMessage`; optionally `uploadImage / startThread`.
3. **Wire** — add a case to `AdapterOptions` and `build()` in `packages/channel-runtime/src/registry.ts`; pass the factory into `registerAdapters()` in `main.ts`.

Reference: [Slack implementation](./slack.md).

## Shared features

| Feature            | Env control                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| STT                | `STT_PROVIDERS=groq,openai-whisper,deepgram,google-gemini,local-cli`                  |
| Vision             | `OPENCORVUS_VISION_MODEL`                                                             |
| Permission profile | `OPENCORVUS_CHANNEL_PERMISSION_PROFILE=restricted\|standard\|permissive\|passthrough` |
| Attachment upload  | `POST /channel/attachment`                                                            |

See [Environment reference](../reference/env.md).
