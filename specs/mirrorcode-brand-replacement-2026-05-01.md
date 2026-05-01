# MirrorCode Brand Replacement - 2026-05-01

## Goal

Replace user-visible `opencode` branding with `MirrorCode`.

## Scope

Change:

- UI executor labels and capability titles.
- API executor `label` for the built-in executor.
- Product documentation and website documentation where `opencode` is presented as a user-facing product/executor name.
- Tests and fixtures that assert user-visible labels.

Do not change:

- Protocol/API enum value `"opencode"`.
- Source filenames such as `executor/opencode.ts`.
- Class/function names such as `OpencodeExecutor`.
- Environment variables such as `OPENCORVUS_EXECUTOR_OPENCODE_BIN`.
- Third-party package names such as `@opencode-ai/*`, `opencode-anthropic-auth`, and `@gitlab/opencode-gitlab-auth`.
- Historical upstream references, repository URLs, private import paths, benchmark log filenames, generated SDK enum types, or lockfiles.

## Reasoning

The executor id is part of the persisted task protocol and generated SDK surface. Renaming it would require a schema migration and compatibility plan. The requested trademark change can be completed without breaking storage or executor routing by changing the display brand while preserving the machine id.

## Verification

- Search for remaining user-visible `Opencode` / `opencode` occurrences in UI and product docs.
- Run targeted executor/overlay tests if labels changed.
- Run `bun run typecheck`, `bun run api:routes-check`, and `bun run docs:check`.
