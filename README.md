<p align="center">
  <a href="https://github.com/yangheng95/opencorvus">
    <img src="assets/readme-head-gemini.png" alt="OpenCorvus head image">
  </a>
</p>

<p align="center">From prompt to shipped result: one agent for code and GUI.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencorvus-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencorvus-ai?style=flat-square" /></a>
  <a href="https://github.com/yangheng95/opencorvus/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/yangheng95/opencorvus/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://github.com/yangheng95/opencorvus/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/yangheng95/opencorvus?style=flat-square" /></a>
</p>

---

## Early-stage Notice

OpenCorvus is still in early development.

- The product is usable today, but APIs, config keys, and UI details can change quickly.
- README focuses on **how to run and use it now**.
- If you need deep internals, use docs + source code.

## What You Can Do

OpenCorvus is an execution agent for software tasks.

- Work on real repositories: read/edit code, run commands, fix issues
- Operate desktop UI: click/type/scroll and verify pages visually
- Continue from chat channels (optional): Slack, Telegram, and more

## Install

```bash
# npm
npm i -g opencorvus-ai@latest

# Homebrew (macOS/Linux)
brew install yangheng95/tap/opencorvus

# Windows
scoop install opencorvus
# or
choco install opencorvus

# Arch Linux
sudo pacman -S opencorvus

# Nix
nix run nixpkgs#opencorvus
```

## 3-Minute Start

```bash
# 1) Enter your project
cd /path/to/your/project

# 2) Launch OpenCorvus TUI
opencorvus
```

That is enough to start giving tasks in natural language.

## Common Commands

```bash
# Run TUI in current directory
opencorvus

# Run TUI for a target project
opencorvus /path/to/project

# Start API server only (headless)
opencorvus serve

# Custom server port
opencorvus serve --port 8080
```

## Use From Source (Repo Developers)

```bash
# at repo root
bun install
bun dev
```

Notes:

- `bun dev` starts the overlay console (local chat entry).
- Install includes an automatic compatibility patch for desktop input.
- If desktop input breaks after reinstall, run:

```bash
bun run patch:follow-redirects
```

## Optional: Remote Chat Channels (Slack / Telegram / More)

If you want to drive OpenCorvus from chat tools, use bot runtime.

### Fast Path (Recommended)

1. Start overlay locally:

```bash
bun dev
```

2. In overlay, open:
   `Bot Config` -> `Environment Variables`

3. Fill channel credentials in `Channel Integrations` (or add custom envs).

4. Click `Save Config`, then in `Runtime` click `Start`.

### CLI Path

```bash
# 1) prepare bot env
cp packages/bot/.env.example packages/bot/.env

# 2) run bot runtime
bun dev:bot
```

Minimal env keys to begin:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` (optional `SLACK_SIGNING_SECRET`)
- Telegram: `TELEGRAM_BOT_TOKEN`
- Feishu/Lark: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`

`bun dev:bot` only loads `packages/bot/.env` (plus system env), not root `.env`.

## FAQ

### Why do behaviors change between versions?

Because the project is still evolving quickly in early stage.

### Where are full configuration details?

- Docs: https://opencorvus.ai/docs
- Bot env reference: `packages/bot/.env.example`
- Contribution guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## Acknowledgments

OpenCorvus is built upon code originally from [OpenCode](https://github.com/nicepkg/opencode). We are grateful to the OpenCode contributors for their foundational work.

## License

[MIT](./LICENSE)
