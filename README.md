<p align="center">
  <a href="https://github.com/yangheng95/opencorvus">
    <img src="assets/readme-head-gemini.png" alt="OpenCorvus head image">
  </a>
</p>

<h2 align="center">From prompt to shipped result: one agent for code, terminal, and desktop UI.</h2>

---

## What Is OpenCorvus

OpenCorvus is an AI execution agent for real software work.

- It can work on your repository (read/edit code, run commands, apply fixes).
- It can operate desktop UI (click/type/scroll and validate visual states).
- It can run in local TUI, API server mode, or optional chat channels.

## Core Features

- One workflow for code + terminal + desktop UI automation.
- Session-based work, so tasks can continue from previous context.
- Multiple entry points: TUI (`opencorvus`), API server (`opencorvus serve`), and overlay manager.
- Optional channel integrations (Slack, Telegram, Feishu/Lark).
- Human-in-the-loop control with approval and runtime visibility.

## Typical Use Cases

- Fix a bug from a short natural-language description and apply patch in repo.
- Implement a feature across backend + frontend, then verify behavior in UI.
- Run repetitive engineering tasks (refactor, tests, config cleanup, regression checks).
- Drive coding tasks from chat channels when your team operates in Slack/Telegram.
- Review and continue old work by loading previous sessions.

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
# 1) Go to your project
cd /path/to/your/project

# 2) Launch OpenCorvus TUI
opencorvus
```

Now you can start giving natural-language tasks directly.

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

## Optional: Overlay + Channel Bot

```bash
# 1) Start overlay manager
bun dev

# 2) (optional) run bot runtime directly
bun dev:bot
```

In overlay:

- Open `Bot Config` -> `Environment Variables`.
- Fill required channel credentials.
- Click `Save Config`, then click `Start` in runtime section.

Minimal env keys:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` (optional `SLACK_SIGNING_SECRET`)
- Telegram: `TELEGRAM_BOT_TOKEN`
- Feishu/Lark: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`

## Use From Source (Repo Developers)

```bash
# repo root
bun install
bun dev
```

If desktop input breaks after reinstall:

```bash
bun run patch:follow-redirects
```

## FAQ

### Is OpenCorvus production-ready?

Not fully. It is usable, but still early-stage and changing quickly.

### What is the fastest way to start?

Run `opencorvus` inside your project directory and give it a concrete task.

### When should I use `opencorvus serve`?

Use it when you need API/server mode, automation scripts, or bot integrations.

### Can it drive desktop applications, not just code files?

Yes. OpenCorvus can operate desktop UI and verify screen-level behavior.

### Can I trigger tasks from Slack/Telegram?

Yes. Configure credentials in overlay environment settings and run the channel bot.

### Can I continue an old task/session?

Yes. Session history can be loaded and reused from the overlay manager.

### Where should I configure environment variables?

Use overlay `Environment Variables` panel, or set env vars directly in your shell.

### Where are detailed config references?

- Docs: <https://opencorvus.ai/docs>
- Bot env reference: `packages/bot/.env.example`
- Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## Early-stage Notice

OpenCorvus is still in early development.

- It is usable now, but commands, config keys, and UI details may change quickly.
- This README focuses on how to use it, not internal architecture.
- For deeper internals, see source code and docs.

## Acknowledgments

OpenCorvus is built upon code originally from [OpenCode](https://github.com/nicepkg/opencode). We are grateful to the OpenCode contributors for their foundational work.

## License

[MIT](./LICENSE)
