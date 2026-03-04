# OpenCorvus CLI Package

This package provides the `opencorvus` CLI and runtime used by the OpenCorvus project.

For full install instructions and product overview, see the repository root README:

- ../../README.md

## Core Features

- AI agent workflow for code edits, command execution, and desktop UI operations.
- Session-based execution that supports task continuation.
- Multiple run modes: interactive TUI and API server (`serve`).
- Integration-ready for overlay manager and channel bots.

## Typical Use Cases

- Implement or refactor features in a real repository.
- Investigate and fix regressions with command + UI verification loops.
- Run OpenCorvus as an API service for external tooling.

## Local Development

```bash
# from repo root
bun install
bun run --cwd packages/opencorvus dev
```

Build:

```bash
bun run --cwd packages/opencorvus build
```

## FAQ

### Is this package intended for standalone use?

Mostly as part of the monorepo workflow. For normal usage, install the published CLI.

### Where should I start if I only want to use OpenCorvus?

Use the repository root README quick-start path (`opencorvus` in your project directory).

### Where can I find configuration details?

- Root docs: ../../README.md
- Online docs: https://opencorvus.ai/docs
