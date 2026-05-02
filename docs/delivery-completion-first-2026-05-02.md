# Delivery Completion-First Gate — 2026-05-02

## Problem

Delivery could run auxiliary programmatic checks before establishing whether the
requested deliverable was actually complete. A typecheck, lint, or broad test
failure could become the headline even when the more useful rejection was that
the requested behavior, interface, output, or presentation was missing.

## Decision

Delivery now treats completion evidence as the primary gate:

1. detect the changed delivery surfaces
2. evaluate goal/requirement coverage
3. verify applicable runtime/output/specialist completion evidence
4. run auxiliary programmatic checks only if the completion gate is clean

When completion is already incomplete, required programmatic checks are recorded
as `skipped` with an explicit reason and do not populate `failedCheckIds`.

## Scope

This is intentionally generic. The policy is not tied to web apps, frontend,
backend, TypeScript, or any single ecosystem. Any requested artifact can have a
completion surface: UI, API, CLI, library API, generated files, documentation,
configuration, data workflow, or another project-specific contract.

Programmatic checks still matter. If completion passes and a build, typecheck,
lint, test, or configured verification command fails, delivery rejects on that
auxiliary failure.
