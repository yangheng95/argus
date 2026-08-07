# Cognition-Aligned Verification-Budget Scheduling

> The rejected/expired choice names and semantics are superseded by [2026-08-07-mission-scope-split-and-test-consent.md](2026-08-07-mission-scope-split-and-test-consent.md): rejection or deadline expiry now means `skip_optional_testing`, and none of the testing or assurance work named by the question is dispatched or executed.

Date: 2026-08-06

Status: Implemented and accepted.

## Recall

| Item | Details |
| --- | --- |
| User requirement | Investigate human cognitive models, align Agentic scheduling with human thinking, adjust scheduler logic, and make the scheduler ask by default whether the operator wants additional testing for completeness and correctness so time and token use can be reduced. |
| Acceptance criteria | The research separates evidence from inference; the scheduler distinguishes contract-required verification from optional extra verification; before the first domain dispatch of an execution request it establishes one explicit operator verification-budget preference; the compact choice remains the default when the question is rejected or expires; a positive request for extra verification is mapped only to an active-package workflow or projected owner that actually exists; repeated wakes do not repeat an already answered preference question; status, diagnosis, cancellation, and already-explicit verification instructions are not interrupted by a redundant question; required tests and visual acceptance can never be waived as “extra”; the behavior remains prompt-owned and visible rather than a Host gate or state machine. |
| Hard constraints | Preserve fixed Expert Squad authority and binding virtual workflows. Do not add a Host preflight, route bypass, state machine, hidden message, synthetic preference, second workflow state, fallback, keyword routing, or package-specific policy to the global core. Do not weaken required non-User-Interface tests or real-page visual review. Do not create, modify, update, or run User-Interface automation tests. Add a positive non-User-Interface prompt-composition contract test. Commit subjects use `dsw-33987`; push to the actual git-cc remote named `git-cc`. |
| Sources read | Root `AGENTS.md`; `specs/current/architecture/03-control.md`, `09-verification-evidence.md`, and `99-principles.md`; the 2026-08-02 Base optional-reviewer record; global Orchestrator core; Orchestrator interaction-tool contract; prompt composition and the Base, Advanced, and Research Studio manifests, scheduler overlays, selectors, and package documentation. External research includes Nelson-and-Narens-style meta-level monitoring/control synthesis, dual-process/executive-control reviews, resource-rational cognition, rational metareasoning, shared mental models, ReAct/ReSpAct, Reflexion, and adaptive computation research. |
| Whole-repository grep | Searches covered scheduler/orchestrator/prompt paths; `question`, `ask operator`, `verification`, `integrity`, `extra test`, and Chinese equivalents; every built-in workflow and scheduler overlay; prompt composition; question-tool descriptions; positive prompt/Resolver tests; documentation indexes. The current global prompt and question tool both restrict questions to blocking operator-only facts. Base already has compact, integrity-verified, and visual-verified workflows. Advanced delivery graphs already contain mandatory testing and independent review. Research Studio offers direct-writing, evidence-synthesis, and full-research graphs with progressively stronger evidence and fact checking. |
| Independent Agent feedback | No independent Agent was requested. Current collaboration policy prohibits inferred sub-agent spawning; the primary Agent performs implementation and a separate final semantic diff review. |
| Git baseline | The worktree was clean. During the baseline git-cc push hook, the remote branch advanced from `a55cd224d2` to `9d8e99133b`; the shared worktree converged to the remote commit, whose only changes were the root README and `assets/agent-teams-workflow.png`. Baseline hooks passed typecheck, API route checks, docs checks, Overlay internationalization, and secret scanning before the remote compare-and-swap rejection. |

## Research synthesis

### Evidence

1. Human metacognition is commonly modeled as object-level cognition monitored by a meta-level process, with meta-control changing planning or behavior from observed outcomes. This supports keeping execution evidence separate from the scheduler's decision about whether more verification is worth buying.
2. Dual-process research distinguishes fast, low-effort processing from slow, controlled processing, while executive-control research emphasizes conflict detection and selective override. It does not justify routing every task through maximally expensive deliberation.
3. Resource-rational analysis treats cognition as the rational use of limited computation. Rational metareasoning similarly evaluates the expected value of another computation step. Recent language-model research reports that selective reasoning can reduce generated tokens while maintaining performance, and input-adaptive computation can reduce computation without applying the expensive path uniformly.
4. Shared mental-model research links team coordination to a common representation of the task, roles, and goals. ReSpAct specifically finds value in letting an Agent reason, speak with the user to resolve task preferences, act, and update the plan from feedback instead of silently assuming preferences.
5. ReAct supports interleaving reasoning and observable action; Reflexion supports using concrete feedback to improve later attempts. Both favor evidence-triggered adaptation over a fixed all-tasks pipeline.

### Inference for OpenCorvus

The scheduler should use a two-budget model expressed in natural language:

- **Acceptance floor:** every check required by the user request, repository contract, selected binding workflow, changed non-User-Interface behavior, or applicable real rendered visual acceptance. This is mandatory and cannot be bargained away.
- **Optional assurance budget:** additional independent testing, broader regression coverage, fact checking, or integrity review beyond that floor. The operator owns the time/token trade-off, so the scheduler establishes that preference once before committing to a more expensive workflow.

The preference interaction is a shared-mental-model calibration, not a permission gate. It must state the mandatory floor, the smallest package-executable extra assurance increment, and the expected cost shape. The compact option is recommended and is the default after rejection or automatic expiry. A scheduler must not promise an undeclared Agent, optional workflow node, or cross-Squad capability.

## Design decision

### Global scheduler contract

Add one metacognitive verification-budget section to the Orchestrator core and align the `question` tool description with it:

1. For a new execution request that can lead to a first domain dispatch, map the acceptance floor first.
2. If the current request has not already supplied an exact verification-budget preference, ask one visible question before the first domain dispatch.
3. Offer a recommended compact choice that runs only the acceptance floor and one package-executable extra-assurance choice with a concrete scope and relative cost. Custom scope may remain available.
4. Use current Task question evidence on later wakes; never repeat an answered preference question.
5. Treat rejected or deadline-expired preference questions as the compact choice and continue.
6. Skip the preference question for status, diagnosis, explanation, cancellation, targeted coordination, and an explicit current-request preference.
7. Never label required testing or applicable real visual review as optional. Never remove a mandatory selected-workflow node based on the compact preference.

This is prompt behavior. The Host continues to persist real questions and outcomes but receives no new scheduling branch, gate, or preference column.

### Package mapping

- Base maps compact ordinary delivery to `composite-delivery`, extra system assurance to `integrity-verified-delivery`, and visually accepted work to mandatory `visual-verified-delivery` regardless of compact preference.
- Advanced preserves every node in its selected full-team graph. Its scheduler describes already-mandatory test/review work as part of the acceptance floor and may only offer a real additional increment owned by its projection; it cannot delete declared nodes to honor compact mode.
- Research Studio maps sufficient supplied material to its smallest truthful graph and offers stronger evidence collection/fact checking only when that is additional rather than already required by the research request.
- External packages follow their own manifest and scheduler overlay. The global prompt supplies the budget semantics but never names package workflows.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Add the single global metacognitive verification-budget decision method and reconcile the current “ask only blockers” wording with its one explicit non-blocking preference exception. |
| `packages/opencorvus/src/orchestrator/interaction-tools.ts` | Expand the `question` tool's positive authority contract to include exactly this verification-budget preference interaction while continuing to reject questions caused by runtime failures. |
| Built-in scheduler overlays and package docs | Explain exact package-local mapping only where needed; do not move package domain rules into global core. |
| `specs/current/architecture/99-principles.md` | Record that visible verification-budget calibration is prompt-owned metacognitive scheduling rather than a Host pipeline or gate. |
| Positive non-User-Interface contract test | Compose a real resolved scheduler prompt and prove it exposes the complete acceptance-floor, optional-assurance, one-question, expiry-default, and binding-workflow semantics. Do not assert User-Interface text or rendering. |
| Generated payload | Regenerate the embedded Expert Squad payload only if repository checks show scheduler overlay/package-document bytes are included. |

## Validation plan

1. Run the focused prompt-composition contract test.
2. Run package typecheck and relevant positive scheduler/package contract tests without running User-Interface automation tests.
3. Run document-health, historical-link, API route, docs, and generated-payload checks required by the touched surfaces.
4. Inspect the composed prompt and final diff semantically for duplicate sources, accidental workflow weakening, repeated-question behavior, and Host-gate language.
5. Commit with `dsw-33987`, pull/fetch and reconcile concurrent `git-cc/v0.0.33beta` work, push through hooks, and verify the remote commit.

## Implementation outcome

- The global Orchestrator now separates a mandatory acceptance floor from an optional assurance budget before its first domain dispatch.
- A new execution request with no explicit verification preference receives one concise, visible verification-budget question. `required_only` is the recommended compact choice; `extra_assurance` must name the smallest real increment the active package can execute and its relative time/Token cost.
- An answered preference is reused on later wakes. Rejection or automatic deadline expiry selects `required_only` and continues instead of blocking the Task or inventing a Host fallback.
- Status, diagnosis, explanation, cancellation, targeted coordination, and already-explicit preferences do not trigger a redundant question.
- Required non-User-Interface tests, selected-workflow nodes, and applicable real rendered visual acceptance remain mandatory in both modes.
- The existing Base, Advanced, and Research Studio manifests and overlays already expose the necessary package-owned workflow choices. No package graph, revision, generated payload, database field, Host route, or workflow state changed.
- The Orchestrator Question tool now exposes this one positive preference interaction in addition to genuine operator-owned blockers, while preserving the rule that local runtime failures are recovery evidence rather than questions.
- During git-cc convergence, a concurrently added Overlay Mission Board automated test was discovered and removed without execution under the repository's independent User-Interface automation-test prohibition. The remote product and documentation changes were preserved.

## Validation evidence

- `bun test ./packages/opencorvus/test/orchestrator/verification-budget-policy.test.ts`: 1 passed, 4 assertions.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run docs:check`: passed, 315 operations in 24 groups.
- `bun run api:routes-check`: passed, 6 rules across 33 route files.
- `git diff --check`: passed.
- The repository-mandated historical-document and document-health commands were attempted exactly. Both reported that their referenced test files no longer exist in the current branch; no success is claimed for those retired paths. Current available docs and route checks passed.
- Second semantic review confirmed that required verification cannot be waived, the preference is asked at most once before domain dispatch, expired/rejected questions continue compactly, package graphs remain binding, and no Host gate or second workflow source was introduced.

## Sources

- Fleming, S. M., Dolan, R. J., and Frith, C. D. synthesis of metacognitive monitoring and control: <https://pmc.ncbi.nlm.nih.gov/articles/PMC8187395/>
- dual-process and inhibitory-control meta-analysis: <https://pmc.ncbi.nlm.nih.gov/articles/PMC10813498/>
- Lieder and Griffiths, *Resource-rational analysis*: <https://doi.org/10.1017/S0140525X1900061X>
- Russell and Wefald rational metareasoning overview: <https://people.eecs.berkeley.edu/~russell/research-bo.html>
- De Sabbata, Sumers, and Griffiths, *Rational Metareasoning for Large Language Models*: <https://arxiv.org/abs/2410.05563>
- Andrews et al., shared mental models in human-Artificial-Intelligence teams: <https://doi.org/10.1080/1463922X.2022.2061080>
- Yao et al., *ReAct*: <https://arxiv.org/abs/2210.03629>
- Dongre et al., *ReSpAct*: <https://aclanthology.org/2025.iwsds-1.7/>
- Shinn et al., *Reflexion*: <https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html>
- *Learning How Hard to Think*: <https://proceedings.iclr.cc/paper_files/paper/2025/hash/ff414825df833edb8b1839e3d5d495e9-Abstract-Conference.html>
