# Research Studio Report Contract Recovery

## Recall

| Item | Evidence and constraint |
| --- | --- |
| User request | Recover the code commits omitted from the `v0.0.31beta` integration line and explain how to save them. |
| Acceptance criteria | Restore every still-current report-generation, command-line input, tool-evidence, and capability-discovery contract without reviving the old global Skill or Work/Research Studio dual source; prove the active package projection with positive non-User-Interface tests; preserve concurrent work; commit and push to legacy remote. |
| Hard constraints | Research Studio remains an embedded self-contained Expert Squad; no compatibility fallback, host workflow gate, blind cherry-pick, User Interface automation test, negative test, reset, or unrelated staging. |
| Sources read | Recovery record `2026-08-07-v0031-unmerged-commit-recovery.md`; current architecture `04-extensions.md`; unmerged commits `0bc4d2cd75`, `0d3c5186d9`, and `0bafc424198`; current Registry, Resolver, runtime tool pool, Session input persistence, command-line runner, capability catalog, and generated-source scripts. |
| Whole-repository search | The Research Studio prompts and report model were absent; `browser_preview_capture` was not projectable to its scheduler or Build runtime; Fact Check lacked command execution; `opencorvus run` still labeled every file as text and omitted the selected in-process directory; tool input persistence still applied result attachment rewriting; shared capability/Skill discovery had lost aliases and the Unicode/typo scorer. The `0d3c5186d9` Session implementation was superseded by current occurrence, cancellation, Computer, and exact-input architecture; its remaining Phase-closure contract belongs in the package prompts. The `0bafc424198` Worker Turn settlement schema was already recovered in `403c17250a`. |
| Independent agent feedback | None; the user did not request delegated agents. |

## Root cause and recovery decision

The missing behavior came from the same branch-integration omission recorded in the parent recovery plan. The historical report commit cannot be replayed as a unit: it made `analysis-report-quality` a platform-default Skill shared by Work and Research Studio, while the current Expert Squad architecture requires each package to own its complete private runtime closure.

The repair therefore ports the durable behavior semantically:

1. Research Studio owns `skills/analysis-report-quality/**`, including the fixed report template and strict JSON Schema.
2. Its manifest projects that package Skill to Analyst, Fact Checker, and Writer. The scheduler projects canonical browser capture; Build projects the same capture surface; Fact Check projects command execution for bounded read-only recalculation.
3. Analyst → Fact Checker → Writer remains the binding evidence order. The Writer derives all report formats from one validated model, and Writer plus Orchestrator perform independent real-image review for browser-visible delivery.
4. `opencorvus run` preserves the selected project directory and actual Office MIME type.
5. Executed tool input is cloned exactly, while only actual tool results and metadata cross the content-addressed attachment materialization boundary. Empty data-URL headers in source remain ordinary source text.
6. Capability and Skill discovery share one Unicode-normalized weighted fuzzy scorer and declared aliases, restoring Chinese and typo discovery without a second search authority.
7. A Task-bound delegated reviewer inherits the exact parent Task identity, and its terminal tool result carries the real visible assistant handoff instead of hiding the child conclusion behind a Session identifier.

The old Work-specific Skill mount and report prompt are intentionally not restored because they would recreate a second owner. The old Session-loop snapshot is also not restored: current occurrence and cancellation authority supersede it, while the still-current Phase-closure semantics now live in the self-contained package prompts.

## Verification

- Focused positive contracts cover the complete package Skill closure, strict report Schema, exact scheduler and worker projection, Unicode/Chinese/typo relevance, in-process project identity, Office MIME, content-addressed result attachments, and exact source-input persistence.
- Package and repository TypeScript checking, route inventory, generated documentation, internationalization, historical-link, and document-health checks must pass before push.
- This recovery changes runtime/package contracts but no product User Interface surface; no UI automation or screenshot baseline is created.
