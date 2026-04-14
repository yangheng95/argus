# CLI reference

`opencorvus` is the unified entry (`packages/opencorvus/bin/opencorvus`); subcommands are registered in `packages/opencorvus/src/index.ts`.

## Global flags

| flag | purpose |
|---|---|
| `--help`, `-h` | Help |
| `--version` | Version |
| `--verbose` | Verbose logging |
| `--config PATH` | Config file |

## Subcommands

### `opencorvus` (default)

Launches the local TUI.

```bash
opencorvus
```

### `opencorvus serve`

Starts the headless HTTP API server.

```bash
opencorvus serve [flags]
```

| flag | default | purpose |
|---|---|---|
| `--hostname` | `127.0.0.1` | Listen address |
| `--port` | `7878` | Listen port |
| `--project-dir` | `cwd()` | Target repo |
| `--mdns` | off | Enable mDNS discovery |
| `--password` | — | HTTP Basic Auth (prefer `OPENCORVUS_SERVER_PASSWORD`) |

Endpoints:
- `POST /task` — create
- `GET /tasks` — list
- `GET /task/<id>` — detail
- `GET /task/<id>/events` — SSE
- `POST /task/<id>/message` — append follow-up
- `POST /task/<id>/retry` — retry
- `POST /task/<id>/replan` — replan
- `POST /task/<id>/cancel` — cancel
- `GET /ui/` — Overlay UI static assets

### `opencorvus run`

One-shot task (non-interactive).

```bash
opencorvus run "Add unit tests for src/foo.ts" [flags]
```

| flag | purpose |
|---|---|
| `--command CMD` | Use CMD as task text |
| `--continue`, `-c` | Continue last session |
| `--session ID`, `-s ID` | Continue specific session |
| `--share` | Produce a share link |

### `opencorvus slack`

Starts the embedded Slack adapter. Requires `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`. See [Slack channel](../channels/slack.md).

### `opencorvus acp`

Starts the [Agent Client Protocol](https://github.com/agentclientprotocol) server for ACP clients (e.g., Zed).

### `opencorvus auth`

LLM provider authentication.

```bash
opencorvus auth              # login
opencorvus auth --logout     # logout
```

### `opencorvus models`

```bash
opencorvus models --list
```

### `opencorvus doctor`

Diagnose installation: dependencies, network, provider connectivity, config validity.

### `opencorvus generate`

Config-driven code generation (behavior depends on `generate` in config).

### `opencorvus agent`

Local agent management.

### `opencorvus debug`

```bash
opencorvus debug --task-id <id>
```

### `opencorvus export`

```bash
opencorvus export --format html
```

### `opencorvus db`

Direct SQLite access.

```bash
opencorvus db --query "SELECT id, status FROM task ORDER BY id DESC LIMIT 20"
```

## Exit codes

| code | meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure |
| 2 | Config error |
| 3 | Task failure (evaluator rejected + budget exhausted) |
| 130 | Interrupted (Ctrl+C) |

## Shell completions

```bash
opencorvus completions bash > /etc/bash_completion.d/opencorvus
opencorvus completions zsh  > ~/.zsh/completions/_opencorvus
```
