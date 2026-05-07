# MirrorCode Brand Replacement - 2026-05-01

## Goal

Replace `opencode` branding and the public executor id with `MirrorCode` /
`mirrorcode`.

## Scope

Change:

- UI executor labels and capability titles.
- API executor `label` for the built-in executor.
- Protocol/API executor enum value from `"opencode"` to `"mirrorcode"`.
- Persisted task executor defaults from `"opencode"` to `"mirrorcode"`.
- Overlay settings defaults, fixtures, generated OpenAPI, and generated SDK
  executor unions to use `"mirrorcode"`.
- Product documentation and website documentation where `opencode` is presented as a user-facing product/executor name.
- Tests and fixtures that assert user-visible labels.

Do not change:

- Source filenames such as `executor/opencode.ts`.
- Class/function names such as `OpencodeExecutor`.
- Environment variables such as `OPENCORVUS_EXECUTOR_OPENCODE_BIN`.
- Third-party package names such as `@opencode-ai/*`, `opencode-anthropic-auth`, and `@gitlab/opencode-gitlab-auth`.
- Historical upstream references, repository URLs, private import paths, benchmark log filenames, binary names, or lockfiles.

## Reasoning

The executor id is part of the persisted task protocol and generated SDK
surface. The product is still unpublished, so the correct no-compatibility fix is
to replace the public id in place and let local development databases be reset
under the current schema. Keeping both `"opencode"` and `"mirrorcode"` would
create a dual-source executor identity and make routing/debugging ambiguous.

Implementation names that identify the upstream implementation remain unchanged:
`executor/opencode.ts`, `OpencodeExecutor`, the `opencode` binary lookup names,
and package names are implementation details rather than the public executor id.

## Verification

- Search for remaining public executor id `"opencode"` occurrences in protocol,
  API, overlay, SDK, and tests.
- Run targeted executor/overlay tests if labels changed.
- Run `bun run typecheck`, `bun run api:routes-check`, and `bun run docs:check`.
