# Five-client Real-requirement Benchmark Catalog

Date: 2026-07-30

Status: Revision 2 implemented and verified

Owner: Codex

## Recall

### User request

- Merge the existing E01–E10 tasks and the added non-development cases into one benchmark document.
- Adjust the benchmark to compare the real requirement-delivery performance of OpenCorvus, WorkBuddy, QoderWork, Multica, and Codex.
- Do not design a case around one client's distinctive feature. Every case must be meaningful and runnable for all five clients.
- Cover multiple industries and the common capability envelope implied by all five products.
- Compare actual deliverables, then derive OpenCorvus's strengths and weaknesses from run evidence instead of product positioning.

### Acceptance criteria

1. One canonical catalog under `specs/artifacts/` contains E01–E10 and N01–N10.
2. Every case sends the same business prompt, source pack, change request, time limit, and delivery contract to all five clients.
3. No case uses WorkBuddy, QoderWork, Multica, Codex, OpenCorvus, Agent, Squad, Skill, automation, or another client-specific mechanism as the business goal.
4. The suite covers finance, procurement, public service, retail, customer service, manufacturing/technical operations, healthcare operations, education, legal/compliance, marketing, product, software engineering, travel/hospitality, and general management.
5. Every case requires inspectable output such as XLSX, DOCX, PPTX, PDF, a runnable website/application, a code change, or a reusable operating package. A chat answer alone is not a pass.
6. Priority reflects business representativeness, discrimination power, execution cost, and input volatility—not a preferred product.
7. The scorecard separates deliverable quality, factual correctness, execution reliability, change handling, evidence/auditability, efficiency, and human intervention.
8. OpenCorvus strengths and weaknesses are reported only after execution, using artifact-level evidence, reviewer scores, time/cost, interventions, failures, and cross-case consistency.
9. Root and July indexes point to the renamed five-client catalog, with no stale canonical path.

### Hard constraints

- Preserve the historical E01–E10 source artifact and its record as source evidence.
- Replace the old three-client catalog as the canonical source; do not retain a parallel active catalog.
- Keep this work documentation-only: no product runtime, route, UI, state machine, gate, compatibility path, or benchmark runner.
- Do not run UI automated tests.
- The mandatory historical-document test path was touched during verification. Remove its existing negative assertions and replace them with positive canonical-index and complete-catalog contracts before running it.
- Preserve all unrelated dirty-worktree changes and stage only the benchmark document, this record, and their index entries.
- Commit subjects must start with `dsw-33987`; push only to `myhexin`.

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- The former three-client benchmark catalog (superseded by this revision)
- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-07/2026-07-25-research-deliverable-case-benchmark.md`
- `specs/records/2026-07/2026-07-30-cross-product-benchmark-catalog.md`
- `specs/current/architecture/04-extensions.md`
- WorkBuddy official product page and documentation, retrieved 2026-07-30
- QoderWork official introduction and product page, retrieved 2026-07-30
- Multica official documentation, retrieved 2026-07-30
- OpenAI official Codex app introduction, retrieved 2026-07-30

### Repository-wide grep result

| Search surface | Result and disposition |
| --- | --- |
| Existing benchmark catalog and indexes | The active catalog was named for only OpenCorvus, WorkBuddy, and Multica and linked from both required indexes. Rename it and update both links atomically. |
| E01–E10 | The historical source remains authoritative input evidence. Keep the IDs and business intent, but express the new common five-client execution contract in the combined catalog. |
| WorkBuddy references | Public and repository material emphasizes direct office artifacts, research, local files, and multi-step delivery. Cover those through ordinary business outputs that every client must attempt. |
| QoderWork references | Official material emphasizes local file work, data analysis, research, Office output, browser work, and reusable workflows. Cover those as shared task dimensions, not QoderWork-only prompts. |
| Multica references | Official material emphasizes issue/task collaboration and local coding-tool execution. Cover handoff, change handling, traceability, and software delivery through shared requirements, not Multica-specific Issue or Agent definitions. |
| Codex references | Official material emphasizes parallel work, Skills, and Automations. Cover decomposition, repeatability, coding, and long tasks through shared deliverables, not Codex-specific Skills or Automations. |
| OpenCorvus references | Repository material includes long-running orchestration, durable artifacts, research, recovery, and reusable capability packages. These are implementation hypotheses to evaluate, not privileged benchmark tasks. |

### Independent review status

- No sub-agent was started because the user did not request delegated or parallel Agents.
- A read-only local Codex review was attempted with `codex-cli 0.132.0`. It produced no review because the installed CLI could not use the requested model with the ChatGPT account and its WebSocket connection failed certificate validation.
- The missing independent feedback is recorded as unavailable; it is not replaced with invented feedback. The primary Agent owns the required second review.

## Revision decisions

1. Preserve E01–E10 and N01–N10 as stable case identities.
2. Replace the old primary/secondary comparator taxonomy with one five-client execution contract.
3. Replace product-specific cases with neutral business requirements:
   - N05 becomes healthcare capacity planning.
   - N06 becomes a regulatory policy difference and remediation package.
   - N07 becomes a reusable retail monthly-review package.
4. Give every case two identical phases. Phase B changes data or constraints after the first result so requirement propagation can be compared without demanding a proprietary recovery mechanism.
5. Require real artifacts or runnable software from every case; prose-only completion cannot pass.
6. Use eight P0 cases as the minimum comparable set. Do not issue a five-client overall conclusion with fewer runs.
7. Derive OpenCorvus strengths and weaknesses only from repeated cross-case evidence and the five-client median.

## Source-to-target inventory

| Existing ID | Revised real requirement | Industry | Priority |
| --- | --- | --- | --- |
| E01 | NVIDIA research, valuation, and decision website | Technology investment | P1 |
| E02 | AI coding-tool selection platform | Engineering management | P2 |
| E03 | Listed-company financial model and investment brief | Finance | P0 |
| E04 | City cost-of-living decision website | Workforce mobility | P2 |
| E05 | Shanghai business-dinner decision page | Business travel/hospitality | P2 |
| E06 | Global electric-vehicle public-data dashboard | Automotive/energy | P1 |
| E07 | Original desktop marketing site from reference evidence | Digital marketing | P1 |
| E08 | Offline personal-finance web application | Personal finance | P2 |
| E09 | Reproduce and fix an open-source CSV parsing defect | Software engineering | P0 |
| E10 | One hundred user-feedback items to product roadmap | SaaS product | P0 |
| N01 | Cross-city shared-service-center location | Public/general service | P0 |
| N02 | Software procurement with changed hard constraints | Procurement | P0 |
| N03 | Disputed energy-storage market research | Market research/energy | P0 |
| N04 | Customer-service system incident investigation | Technical operations | P1 |
| N05 | Outpatient capacity and waiting-time improvement | Healthcare operations | P1 |
| N06 | Policy difference and business-remediation package | Legal/compliance | P1 |
| N07 | Reusable monthly retail operating-review package | Retail | P1 |
| N08 | Two-week customer-service schedule with hard constraints | Customer service/workforce | P0 |
| N09 | Store operating diagnosis and action plan | Retail | P1 |
| N10 | Front-line anti-fraud training package | Education/risk | P0 |

## Implementation

1. Replaced the former three-client artifact with `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md`.
2. Added the five-client fairness protocol, immutable input-pack contract, time and intervention limits, two-phase execution, and repeated P0 runs.
3. Added all 20 concrete prompts with deliverables and acceptance focus.
4. Added one 100-point artifact scorecard, severe-error markers, raw efficiency fields, and per-run/per-case result tables.
5. Added evidence thresholds for reporting OpenCorvus strengths and weaknesses without pre-judging the result.
6. Updated `specs/README.md` and `specs/records/2026-07/README.md`.
7. Replaced the touched historical-document suite's retired-path and absence assertions with two positive contracts that verify readable canonical links, exact participant identity, and the complete ordered case inventory.

## Verification plan

- Confirm exactly 20 case headings and 20 priority rows.
- Confirm no active comparator-specific labels or product-specific execution requirements remain.
- Confirm no stale canonical link to the former three-client catalog remains.
- Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`.
- Run `git diff --check`.
- Perform a second manual review of industry coverage, artifact coverage, P0 minimum set, scoring totals, and OpenCorvus conclusion thresholds.

## Verification result

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` — 2 passed, 0 failed.
- Structural inventory — 20 Case headings, 20 Phase A prompts, 20 Phase B prompts, and 20 acceptance sections.
- Priority inventory — 8 P0, 8 P1, and 4 P2 cases.
- Scorecard arithmetic — 20 + 20 + 15 + 10 + 10 + 10 + 10 + 5 = 100.
- Five-client identity — OpenCorvus, WorkBuddy, QoderWork, Multica, and Codex each appear exactly once in the mandatory participant list.
- Comparator-bias scan — zero matches for primary/secondary comparator labels, OpenCorvus-specific cases, or prompts requiring a proprietary Agent, Squad, Skill, or automation mechanism.
- Canonical-path scan — zero active references to the former three-client catalog path or title.
- Negative-test scan of the touched historical-document suite — zero negative-test markers after replacement with positive contracts.
- `git diff --check` — passed.

## Second review

- Confirmed the eight-case P0 minimum set covers cited research, spreadsheet/report delivery, product-feedback synthesis, changed procurement constraints, location planning, hard scheduling, code repair, and presentation/training output.
- Confirmed the full suite spans at least fourteen business domains and requires XLSX, DOCX, PPTX, PDF, runnable websites/applications, data files, and code.
- Confirmed every case uses the same two-phase business requirement for all five clients and permits product-specific mechanisms only as invisible implementation choices.
- Confirmed dynamic web cases are lower priority where their data volatility or execution cost would otherwise distort the first comparison.
- Confirmed the final report template separates per-case observations from cross-case OpenCorvus strengths and weaknesses.
- Confirmed OpenCorvus may be labelled a strength only after repeated multi-industry evidence and may be labelled a weakness only after a stable repeated deficit or failure pattern.
- Confirmed no benchmark result or OpenCorvus advantage/disadvantage has been invented before real five-client execution.
