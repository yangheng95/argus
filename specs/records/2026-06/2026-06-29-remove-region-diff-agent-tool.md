# Remove Region Diff Agent Tool

Date: 2026-06-29

## Task

Remove only the agent-callable browser preview region diff wrapper that produced
source/local side-by-side artifacts and optional red pixel-diff images. Keep the
backend region/reference comparison evidence pipeline, persisted evidence
records, route contracts, and `reference_comparison_evidence_refs` semantics.

## Recalled Plans

- `2026-06-15-region-comparison-evidence-runner.md` introduced focused
  source/local region comparison artifacts.
- `2026-06-20-reference-comparison-evidence-chain-root-repair.md` tied those
  artifacts into reference-parity evidence.
- `2026-06-23-visual-skeleton-region-comparison-root-repair.md` tightened the
  artifact semantics to true-size comparison.

The current operator instruction supersedes those tool-exposure decisions.

## Call Point Inventory

Command used:

```powershell
rg -n "browser preview region comparison|reference-comparison|include_diff|browser-preview/compare" packages specs AGENTS.md -S --glob '!**/target*'
```

Affected surfaces:

| Surface | Current role | Change |
| --- | --- | --- |
| Agent private tool registry | Exposes the region diff tool to coding/build/visual review roles. | Remove the entry. |
| Visual review static tool list | Includes the region diff tool. | Remove the entry. |
| Integrity preview tools | Loads the region diff tool with preview helpers. | Remove the loader entry. |
| Build and visual review prompts | Direct agents to call the wrapper by name. | Remove that call path while preserving region comparison evidence and reference-comparison refs. |
| Binding puzzle tool text | Describes itself as input to the region diff wrapper. | Keep it as source-binding investigation evidence only. |
| Tool-specific tests | Assert tool visibility and schema behavior. | Delete or rewrite as absence checks. |
| Backend comparison route/evidence store | Owns persisted region/reference comparison evidence. | Preserve. |

## Acceptance

- No agent role exposes the region diff tool id.
- No active prompt instructs agents to call the region diff wrapper by name.
- Region/reference comparison evidence text and API contracts remain intact.
- The binding puzzle tool does not name the region diff tool.
- Focused tests cover absence from tool registries and prompts.
- Typecheck validates there are no stale imports.
