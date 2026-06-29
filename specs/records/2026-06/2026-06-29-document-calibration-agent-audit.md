# Document Calibration Agent Audit

Date: 2026-06-29

## Objective

Use independent read-only agents to audit repository documentation, repair
confirmed drift in the maintained documentation sources, and repeat review until
the independent agents report no new document-health issues.

## Acronyms

- API: Application Programming Interface, the route and schema contract exposed
  to callers.
- CLI: Command Line Interface, the terminal entrypoint and commands documented
  for operators.
- MCP: Model Context Protocol, the protocol used by external tool servers.
- SDK: Software Development Kit, the generated client package under
  `packages/sdk`.
- SSE: Server-Sent Events, the streaming HTTP event mechanism used by the
  runtime.
- TUI: Terminal User Interface, the retired terminal-style overlay surface kept
  only in historical notes.

## Recalled Sources

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no compatibility path, no broad git reset, no new worktree without explicit authorization, and commit/push must use hooks. |
| `specs/records/2026-06/2026-06-15-historical-docs-consolidation.md` | Human-facing product docs live only in `packages/web/src/content/docs/**`; do not recreate the removed product-docs tree. |
| `specs/records/2026-06/2026-06-17-document-health-audit.md` | Existing document-health checks already reject stale public docs, missing historical indexes, retired paths, and fallback wording. |
| `specs/README.md` | Specs use one root storage model: current architecture, monthly records, and artifacts. |
| `specs/current/architecture/README.md` and `specs/records/2026-06/2026-06-29-spec-consolidation.md` | Core architecture chapters are indexed in the current architecture README; dated June records live in the June records bucket. |
| `packages/opencorvus/test/script/historical-docs-links.test.ts` | Hard-disk documentation inventory is the test source, including untracked markdown files in the current worktree. |
| `packages/opencorvus/test/script/product-docs-single-source.test.ts` | The deleted product docs tree must remain absent and public docs must remain in the web docs tree. |
| `packages/opencorvus/test/script/document-health.test.ts` | Public docs, workflow docs, helper comments, and prompt/tool text must not publish retired contracts. |

## Current Worktree Boundary

The worktree already contains unrelated code and test changes plus a spec
consolidation move that removed the old architecture and package-local spec
trees. This audit will not revert or rewrite unrelated changes. Documentation
edits are limited to maintained docs and documentation tests needed to make the
hard-disk documentation set internally consistent.

## Inventory Commands

These repository-wide sweeps were run before writing this plan:

```powershell
git status --short --branch
rg --files -g 'AGENTS.md' -g '*.md' -g '*.mdx' -g '*.rst' -g '*.adoc' -g '*.txt' -g '*.docx' -g '*.pdf'
rg --files | rg -i '(plan|spec|design|decision|proposal|doc|docs|adr|record)'
rg -n "docs:check|document-health|historical-docs|product-docs|render-api-md|retired-reference" -g "*.ts" -g "*.json" -g "*.yml" -g "*.md"
rg -n "removed product docs|fallback|deprecated|DEPRECATED|Superseded|legacy|not wired|planner|gateway|TUI" README.md CONTRIBUTING.md CLAUDE.md docs packages\web\src\content\docs specs
rg -n "2026-06-29|side-by-side|layout-geometry|task-active-sse|scheduler-owned|screenshot-browser-agent|remove-region-diff|a2a-stale" specs/records/2026-06/2026-06-29-spec-consolidation.md specs/current/architecture/README.md specs\README.md
```

## Independent Agent Split

| Agent scope | Read-only question |
| --- | --- |
| Public product docs | Find stale, contradictory, unlinked, or source-drifted content in `packages/web/src/content/docs/**` and `packages/web/README.md`. |
| Historical architecture docs | Find missing indexes, stale status banners, retired-reference issues, and contradictions in `specs/current/architecture/**` and `specs/records/2026-06/**`. |
| Root and operational docs | Find stale repo names, commands, workflow/action versions, install instructions, fallback wording, and machine-specific paths in root and ops docs. |
| Source-contract docs | Compare CLI, environment, SDK, API, provider/model, config, MCP, and mission/task docs against current source and generated-doc tooling. |

Each agent is read-only, must not edit files, must not commit, and must not
spawn another agent.

## Initial Confirmed Issue

| Issue | Evidence | Repair |
| --- | --- | --- |
| Historical links test was deleted during spec consolidation. | `git status --short -- packages/opencorvus/test/script` shows `D packages/opencorvus/test/script/historical-docs-links.test.ts`. | Recreate the test so the consolidated spec tree is enforced instead of accepting test deletion. |

## Verification Loop

1. `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
2. `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
3. `bun test packages/opencorvus/test/script/document-health.test.ts`
4. `bun run docs:check`
5. `git diff --check` on touched documentation files
6. A second independent-agent review pass over changed documentation and current
   tests. Completion requires no new non-duplicate document-health findings.
