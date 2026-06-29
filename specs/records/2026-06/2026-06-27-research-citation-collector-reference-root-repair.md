# Research Collector Reference Root Repair - 2026-06-27

## Incident Evidence

- Local rerun task `tsk_f085ffc1e001zC44iOKCvzhE3I` reached `frontend_research`, then cancelled after repeated `submit_research_brief` failures.
- The repeated finalizer output was:
  - `research bundle failed semantic validation: bundle.citation_map references unknown claim id: claim_nine_major_regions.`
- The agent repeatedly called `update_research_citation` for `fact_major_sections`, but the invalid `claim_nine_major_regions` citation remained in the collector.
- This is not an LLM retry problem. The collector accepted an invalid key into `bundle.citation_map`, and `update_research_citation` upserts by `claim_id`. There is no delete/rename tool, so a bad `claim_id` becomes unrecoverable inside that session except by inventing a matching claim.
- A full reference-field audit showed the same design problem existed beyond citations: several `evidence_ids` writers allowed unknown evidence into the collector and deferred the error to `submit_research_brief`. That makes correction indirect and can keep a task stuck in finalization loops.

## Call-Site Audit

Command:

```powershell
rg -n "evidence_ids|evidence_id|fact_ids|based_on_fact_ids|related_fact_ids|citation_map|update_research_citation|update_research_evidence_note|update_research_bundle_section|validateResearchBundleInputSemantics|inspect_research_result_status|submit_research_brief" packages/opencorvus/src/research packages/opencorvus/test/research specs/new-arch -S
```

Relevant findings:

| Surface | Current behavior | Repair decision |
| --- | --- | --- |
| `update_research_fact.evidence_ids` | Could register facts citing evidence ids that had never been registered. | Reject unknown evidence ids before mutation. |
| `update_research_document_section.evidence_ids` | Could register document outline entries with unknown evidence ids. | Reject unknown evidence ids before mutation. |
| `update_webpage_contract_source.reference_image_evidence_ids` | Could register reference-image ids before the corresponding evidence existed. | Reject unknown evidence ids before mutation while still allowing the existing empty list for pages without screenshots. |
| `update_webpage_* .evidence_ids` | Functional surface, visual layout, style requirement, interaction state, data inventory, fidelity acceptance, and fidelity risk chunks could all persist unknown evidence ids and only fail at final submit. | Reject unknown evidence ids before mutation using the same semantic path labels as final validation. |
| `update_subpage_research_task.evidence_ids` | Could persist unknown evidence ids and report them only at final submit. | Reject unknown evidence ids before mutation. |
| `packages/opencorvus/src/research/output-tools.ts::update_research_citation` | Parses and writes a citation without checking whether `claim_id` or `evidence_ids` are already registered. A bad `claim_id` cannot be removed because the upsert key is the same bad `claim_id`. | Reject unknown claim/evidence references before mutation. Return known ids and `Collector unchanged` so the agent registers the missing claim/evidence or uses the correct existing id. |
| `packages/opencorvus/src/research/output-tools.ts::update_research_evidence_note` | Parses and writes an evidence note keyed by `evidence_id` without checking that the evidence exists. A typo leaves an orphan note that finalization later rejects. | Reject unknown evidence ids before mutation. |
| `packages/opencorvus/src/research/output-tools.ts::update_research_bundle_section` | Can be overwritten by title, so it is recoverable, but finalizer still reports late unknown evidence ids. | Reject unknown evidence ids before mutation so semantic failures are local to the update tool. |
| `packages/opencorvus/src/research/output-tools.ts::validateResearchBundleInputSemantics` | Still needed as final canonical validation and replay safety. | Keep final validation; update-time validation prevents new bad collector state, final validation catches replay or historical data. |
| `packages/opencorvus/test/research/output-tools.test.ts` | Covered late finalizer semantic errors but not update-time rejection for all unknown claim/evidence references. | Add regression tests proving bad evidence references across every collector writer and the observed bad citation claim leave the collector unchanged. |

## Acceptance

- Every `update_*` tool that writes `evidence_ids`, `evidence_id`, or `reference_image_evidence_ids` rejects unknown evidence ids before writing.
- `update_research_citation` rejects unknown `claim_id` before writing.
- Bad updates return the unknown id, known ids, and `Collector unchanged`.
- Final canonical semantic validation still rejects invalid replay/historical bundles.
- Existing valid research output tests and typecheck pass.
