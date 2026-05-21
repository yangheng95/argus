# 2026-05-21 Build Prompt Migration Fidelity Plan

## Problem

The current Build system prompt correctly retired repository-investigation-only
Build sessions, but it overcorrects implementation work by telling Build to
read only the files needed for a narrow local edit and by warning external
executors away from broad inventories. That conflicts with implementation
requests whose acceptance criteria explicitly require source-to-target parity,
for example C# component rewrites into TS/React where Build must inspect every
relevant source member, API hook, interaction, and existing target convention
before editing.

This is not a request to restore read-only Build. Build remains an
implementation agent. The fix is to distinguish implementation-bound discovery
from pure repository investigation.

## Evidence And Call Sites

- `packages/opencorvus/src/prompt/core/build-core.txt`
  - Goal execution says not to spend time surveying unrelated systems once
    enough context exists.
  - "What you do" says start with repo reads, but does not explicitly require
    exhaustive source/target parity reads when the request is a migration,
    rewrite, clone, port, or fidelity task.
- `packages/opencorvus/src/build/agent.ts`
  - `externalBuildSystemContract` says: "Read only the files needed..." and
    "Do not perform broad inventories..." for codex/claude-code executors.
  - `buildUserPrompt` carries request/goal context but has no explicit
    migration/parity evidence contract.
- Tests locking the prompt:
  - `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
  - `packages/opencorvus/test/build-agent/prompt-context.test.ts`
  - `packages/opencorvus/test/build-agent/external-system.test.ts`

## Decision

Keep the retired inspect-only boundary:

- Build must fail repository-investigation-only prompts.
- Build must not act as a generic explore agent.

Add the missing implementation-bound evidence rule:

- When the implementation is a port/rewrite/migration/clone/parity task, Build
  must inspect the complete relevant source surface and target conventions
  before writing.
- "Depth-first" means stay scoped to the requested component/goal, not skip
  source evidence needed to satisfy parity.
- If the named source surface is absent or incomplete, fail loudly instead of
  inventing behavior or substituting mock behavior as a fallback.

## Acceptance

- Build core prompt explicitly says implementation-bound migration/parity tasks
  require complete relevant source and target investigation.
- External executor system prompt carries the same rule and no longer frames
  source/target parity reads as disallowed broad inventory.
- Direct request prompt includes the parity investigation rule for implementation
  requests while still rejecting pure repository investigation.
- Targeted prompt tests pass.
