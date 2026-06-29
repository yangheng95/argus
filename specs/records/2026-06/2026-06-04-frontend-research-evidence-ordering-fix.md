# Frontend Research Evidence Ordering Fix

## Problem

Task `tsk_e91667747001GO51fJ0cD2PmmK` dispatched `frontend_research` before
`frontend_design` for a TradingView webpage clone request. The research agent is
configured to read existing prepared webpage evidence only, so it produced
source-URL-level guesses, invented a `ref-img-missing` placeholder to satisfy
`reference_image_evidence_ids`, and then failed `submit_research_brief` because
each `evidence_index` item lacked the required `bundle_ref`.

## Evidence

| Surface                                                      | Current behavior                                                                                                                                 | Decision                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ResearchEvidenceRefSchema.bundle_ref`                       | Required model-authored field, no prompt coverage, no runtime consumers outside tests.                                                           | Host normalizes a missing value to `research-bundle.md#<evidence_id>`.                                                      |
| `ResearchWebpageContractSchema.reference_image_evidence_ids` | Requires at least one evidence id even when no visual capture exists.                                                                            | Allow an empty array so missing visual evidence is represented honestly.                                                    |
| `frontend-research-core.txt`                                 | Says to submit reference image ids but does not explain the no-capture case.                                                                     | Tell the agent to use `[]` and never create placeholder evidence.                                                           |
| `orchestrator-core.txt` / tool descriptions / workflow hint  | Says frontend tools are siblings, but not that webpage clone implementation usually needs `frontend_design` evidence before `frontend_research`. | Prompt the orchestrator to dispatch `frontend_design` first when implementation-template/source handoff evidence is absent. |

## Validation

- Research output tests cover omitted `bundle_ref` normalization.
- Research output tests cover empty `reference_image_evidence_ids`.
- Orchestrator prompt/tool-description tests pin the prepared-evidence ordering guidance without turning it into a host gate.
