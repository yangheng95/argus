# Spec Consolidation - 2026-06-29

## Objective

Consolidate repository specifications so there is one storage model, no package-local or `new-arch`
parallel trees, and no dated specification file earlier than 2026-06-01 remains on disk.

## Recall

User request: use several independent agents to update and calibrate all specs, delete every spec before June 2026, organize spec storage so it is not scattered, update `AGENTS.md`, and keep iterating until independent agents cannot find new issues.

Acceptance criteria:

- No spec file dated before 2026-06-01 remains on disk.
- Specs use one storage model rooted at `specs/`: current architecture, monthly records, and artifacts.
- Active references and tests stop depending on package-local spec trees, retired ledgers, or the old architecture-history tree.
- `AGENTS.md` preserves the new storage and recall rules for future agents.
- Independent read-only agent review runs after implementation, and any new findings are fixed before completion.

Hard constraints recalled from `AGENTS.md`:

- No fallback, compatibility ledger, gate, or dual-source design.
- Read the on-disk plan and current references before edits.
- Do not use git reset or worktree escape hatches.
- Any spec move/delete/update must be backed by validation tests.
- Context compression must preserve objective, acceptance criteria, hard constraints, and remaining review items.

Evidence already read before implementation:

- Root `AGENTS.md` and `CLAUDE.md`.
- Existing `specs/README.md` and architecture README.
- Whole-repository spec inventory and old-path search results.
- Independent agent findings from James, Arendt, and Curie.

## Inventory Evidence Before Changes

`rg --files -g '*.md' -g '*.txt' -g '*.svg'` with spec-path filters found:

| Class | Count | Evidence |
| --- | ---: | --- |
| Total spec-path files | 859 | `specs/**`, `packages/*/specs/**`, and spec-named files |
| Files dated before 2026-06-01 | 68 | 61 under `specs/new-arch/**`, 6 under `packages/opencorvus/specs/**`, 1 under root `specs/**` |
| Root `specs/*` files | 37 | Root mixed historical notes and prompt artifacts |
| `specs/new-arch/**` files | 814 | Current architecture chapters mixed with dated records |
| `packages/opencorvus/specs/**` files | 8 | Package-local source that creates a second spec tree |

## Storage Model

`specs/README.md` is the only public entry point for specs.

| Path | Purpose | Rule |
| --- | --- | --- |
| `specs/current/**` | Current long-lived normative specs | Must be kept calibrated with code and AGENTS.md. |
| `specs/current/architecture/**` | Current architecture chapters and diagrams | Replaces `specs/new-arch/**`. |
| `specs/records/2026-06/**` | Dated June 2026 implementation and investigation records | Replaces root historical notes and June `new-arch` notes. |
| `specs/artifacts/**` | Task input artifacts that are not normative specs | Keeps prompt/reference inputs out of spec indexes. |

Forbidden storage after this change:

- `specs/new-arch/**`
- `packages/*/specs/**`
- Root-level spec records under `specs/*.md` except `specs/README.md`
- Any spec markdown file with a date before `2026-06-01`

## Migration Plan

| Source | Destination | Action |
| --- | --- | --- |
| `specs/current/architecture/01-*.md` through `16-*.md`, `99-principles.md`, and current SVG diagrams | `specs/current/architecture/**` | Move and rewrite local links. |
| `deleted pre-June record spec-vscode-extension` | Delete | It is a 2026-04-27 draft and fails the before-June deletion rule. |
| `specs/new-arch/2026-04-*` and `specs/new-arch/2026-05-*` | Delete | Explicitly before June. |
| `specs/records/2026-06/2026-06-*.md` and named `*-2026-06-*.md` | `specs/records/2026-06/**` | Move and rewrite references. |
| Root `specs/*-2026-06-*.md` and `specs/2026-06-*.md` | `specs/records/2026-06/**` | Move and rewrite references. |
| `specs/records/2026-06/opencorvus-research-frontend-design-boundary-2026-06-03.md` | `specs/records/2026-06/opencorvus-research-frontend-design-boundary-2026-06-03.md` | Move and rewrite references. |
| `deleted pre-June record *2026-05*` | Delete | Package-local and before June. |
| Root prompt/reference artifacts | `specs/artifacts/**` | Move out of spec indexes. |
| `specs/records/2026-06/2026-06-29-spec-consolidation.md` | Keep | This is the current task record and Recall source, not a compatibility ledger. |

## Reference Update Plan

Use whole-repository search for these names and update every live reference:

- `specs/new-arch`
- `packages/opencorvus/specs`
- root June spec filenames moved to `specs/records/2026-06`
- pre-June spec filenames that are deleted

References to deleted pre-June specs must not be redirected to a compatibility ledger. They must either cite the
current implementation source/test, cite a current spec, or describe the historical incident without a path.

## Test And Review Plan

1. Update `packages/opencorvus/test/script/historical-docs-links.test.ts` so it enforces the new single spec tree.
2. Update `packages/opencorvus/test/script/document-health.test.ts` and `product-docs-single-source.test.ts` references.
3. Run targeted document tests:
   - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
   - `bun test packages/opencorvus/test/script/document-health.test.ts`
   - `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
4. Run `git diff --check` on changed docs/tests.
5. Run independent read-only agent review after migration. If reviewers find new issues, fix and rerun review.

## 2026-06-29 Final Review Addendum

Independent review after the initial document calibration found one remaining
class of spec drift: active source/test comments and June records still cited
deleted pre-June spec filenames without paths. Those references were rewritten
to current behavior descriptions or current source/test ownership, not to a
compatibility ledger.

The guard was extended so bare deleted pre-June spec filenames are rejected
outside this migration evidence record and the historical document-health guard.

## 2026-06-29 Second Final Review Addendum

Independent review after the first final addendum found active overlay script,
test, and dev-error comments still cited deleted overlay flat-redesign and
implementation-progress spec paths. Those references were rewritten to current
contract descriptions (`flat redesign migration contract` and `historical
implementation progress repair note`) without restoring the deleted specs.

Validation after this addendum:

- HEAD-level retired spec path grep returned no active hits outside the
  migration evidence record and negative guard tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
